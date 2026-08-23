import type { FrameState, RenderBackend } from "./backend";

// WebGPU backend (issue #63).
//
// This is the real, rendering WebGPU path built on top of the existing
// backend seam. It is a faithful port of the WebGL2 path tracer:
//
//   * The scene (triangles, ellipsoids, BVH nodes, BVH primitive indices) is
//     flattened into vec4-packed storage buffers once, matching the GLSL
//     flattening in src/constants.ts / src/bvh.ts.
//   * A WGSL compute pass (wgsl/pathtrace.compute.wgsl) traces one path per
//     pixel and writes a RUNNING SUM into an rgba32float storage texture.
//     Ping-pong accumulation is driven by frameCount, exactly like the GLSL
//     pathtrace.frag ping-pong FBOs.
//   * A WGSL render pass (wgsl/display.wgsl) tonemaps the current sum
//     (divide by frame count -> exposure -> ACES -> gamma) to the canvas.
//
// The backend is fed camera + light + env uniforms each frame (the camera
// basis mirrors src/camera.ts's computeCameraBasis), and exposes a
// `resetAccumulation()` hook so the driver loop can restart accumulation
// when the camera moves.

import pathtraceWGSL from "./wgsl/pathtrace.compute.wgsl?raw";
import displayWGSL from "./wgsl/display.wgsl?raw";

import {
  flattenedTriangles,
  flattenedEllipsoids,
  eye,
  light,
  environment,
  APERTURE_RADIUS,
  FOCAL_DISTANCE,
} from "../constants";
import {
  flattenedBvhNodes,
  flattenedBvhPrimIndices,
  bvhNodeCount,
  triangleCount as bvhTriangleCount,
  ellipsoidCount,
} from "../bvh";
import {
  computeCameraBasis,
  makeInitialCameraState,
  orbit,
  pan,
  zoom,
  type CameraState,
} from "../camera";

const EXPOSURE = 1.0;
const FRAME_COUNT_LIMIT = 12_000;

// TS 5.9 made typed arrays generic over their backing buffer; @webgpu/types
// still expects ArrayBuffer-backed views. Helper to write a Float32Array
// without tripping that generic mismatch.
function writeF32(device: GPUDevice, buffer: GPUBuffer, data: Float32Array): void {
  device.queue.writeBuffer(buffer, 0, data as unknown as GPUAllowSharedBufferSource);
}

// Convert a Float32Array of packed scene data to a vec4-packed f32 array
// (stride 4 floats per source "vec") suitable for a tightly-packed storage
// buffer. srcStride is the number of vec3-typed slots per source record
// (e.g. 4 for ellipsoids, 8 for triangles, 3 for BVH nodes, 1 for prim
// indices). Each vec3 within a record is padded to vec4.
function packVec4(src: Float32Array, srcStride: number): Float32Array {
  const records = src.length / (srcStride * 3);
  const dst = new Float32Array(records * srcStride * 4);
  for (let r = 0; r < records; r++) {
    for (let s = 0; s < srcStride; s++) {
      const srcBase = (r * srcStride + s) * 3;
      const dstBase = (r * srcStride + s) * 4;
      dst[dstBase + 0] = src[srcBase + 0]!;
      dst[dstBase + 1] = src[srcBase + 1]!;
      dst[dstBase + 2] = src[srcBase + 2]!;
      dst[dstBase + 3] = 0;
    }
  }
  return dst;
}

export class WebGPURenderBackend implements RenderBackend {
  readonly name = "webgpu";

  private canvas: HTMLCanvasElement;
  private context: GPUCanvasContext | null = null;
  private device: GPUDevice | null = null;
  private format: GPUTextureFormat = "rgba8unorm";

  // Scene buffers (uploaded once).
  private uniformBuffer: GPUBuffer | null = null;
  private displayUniformBuffer: GPUBuffer | null = null;
  private ellipsoidBuffer: GPUBuffer | null = null;
  private triangleBuffer: GPUBuffer | null = null;
  private bvhNodeBuffer: GPUBuffer | null = null;
  private bvhPrimBuffer: GPUBuffer | null = null;

  // Ping-pong accumulation storage textures.
  private accumA: GPUTexture | null = null;
  private accumB: GPUTexture | null = null;

  private computePipeline: GPUComputePipeline | null = null;
  private displayPipeline: GPURenderPipeline | null = null;
  private computeBindGroupLayout: GPUBindGroupLayout | null = null;
  private displayBindGroupLayout: GPUBindGroupLayout | null = null;
  private computeBindGroupA: GPUBindGroup | null = null;
  private computeBindGroupB: GPUBindGroup | null = null;
  private displayBindGroupA: GPUBindGroup | null = null;
  private displayBindGroupB: GPUBindGroup | null = null;

  private cameraState: CameraState;
  private frameCount = 0;
  private startTimeMs: number | null = null;
  private renderWidth = 1;
  private renderHeight = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.cameraState = makeInitialCameraState(eye);
  }

  async init(): Promise<void> {
    if (!("gpu" in navigator)) {
      throw new Error("WebGPU not supported on this browser");
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("No suitable WebGPU adapter found");
    }
    this.device = await adapter.requestDevice();
    this.device.lost.then((info) => {
      console.error("[wt] WebGPU device lost:", info.message);
    });

    this.context = this.canvas.getContext("webgpu");
    if (!this.context) {
      throw new Error("Failed to acquire WebGPU canvas context");
    }

    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "opaque",
    });

    this.createSceneResources();
    this.createPipelines();
  }

  /** Scene data is static; upload it into storage buffers exactly once. */
  private createSceneResources(): void {
    const device = this.device!;

    const triCount = bvhTriangleCount;
    const ellCount = ellipsoidCount;
    // The uniforms struct mirrors the WGSL `Uniforms` layout.
    this.uniformBuffer = device.createBuffer({
      size: 16 * 4 * 4, // 16 vec4<u32/f32> = 256 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.displayUniformBuffer = device.createBuffer({
      size: 16, // vec4<f32>
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.ellipsoidBuffer = device.createBuffer({
      size: (ellCount * 4) * 4 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    writeF32(device, this.ellipsoidBuffer, packVec4(flattenedEllipsoids, 4));

    this.triangleBuffer = device.createBuffer({
      size: (triCount * 8) * 4 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    writeF32(device, this.triangleBuffer, packVec4(flattenedTriangles, 8));

    this.bvhNodeBuffer = device.createBuffer({
      size: Math.max(1, bvhNodeCount * 3) * 4 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    writeF32(device, this.bvhNodeBuffer, packVec4(flattenedBvhNodes, 3));

    this.bvhPrimBuffer = device.createBuffer({
      size: Math.max(1, flattenedBvhPrimIndices.length) * 4 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    writeF32(device, this.bvhPrimBuffer, packVec4(flattenedBvhPrimIndices, 1));
  }

  private createPipelines(): void {
    const device = this.device!;

    const computeModule = device.createShaderModule({ code: pathtraceWGSL });
    const displayModule = device.createShaderModule({ code: displayWGSL });

    // Compute bind group: uniform + 4 storage buffers + prev texture + next tex.
    this.computeBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "unfilterable-float" } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba32float" } },
      ],
    });

    // Display bind group: uniform + accum sample texture.
    this.displayBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
      ],
    });

    this.computePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.computeBindGroupLayout!] }),
      compute: { module: computeModule, entryPoint: "cs_main" },
    });

    this.displayPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.displayBindGroupLayout!] }),
      vertex: { module: displayModule, entryPoint: "vs" },
      fragment: { module: displayModule, entryPoint: "fs", targets: [{ format: this.format }] },
      primitive: { topology: "triangle-list" },
    });
  }

  /** (Re)allocate the ping-pong accumulation textures at the render size. */
  private ensureAccumTargets(width: number, height: number): void {
    const device = this.device!;
    if (this.accumA && this.accumB && this.renderWidth === width && this.renderHeight === height) {
      return;
    }
    this.accumA?.destroy();
    this.accumB?.destroy();

    const make = () =>
      device.createTexture({
        size: [width, height],
        format: "rgba32float",
        usage:
          GPUTextureUsage.STORAGE_BINDING |
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST,
      });

    this.accumA = make();
    this.accumB = make();
    this.renderWidth = width;
    this.renderHeight = height;

    // Bind groups: compute reads prev, writes next. A: read A write B; B: read B write A.
    this.computeBindGroupA = device.createBindGroup({
      layout: this.computeBindGroupLayout!,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer! } },
        { binding: 1, resource: { buffer: this.ellipsoidBuffer! } },
        { binding: 2, resource: { buffer: this.triangleBuffer! } },
        { binding: 3, resource: { buffer: this.bvhNodeBuffer! } },
        { binding: 4, resource: { buffer: this.bvhPrimBuffer! } },
        { binding: 5, resource: this.accumA.createView() },
        { binding: 6, resource: this.accumB.createView() },
      ],
    });
    this.computeBindGroupB = device.createBindGroup({
      layout: this.computeBindGroupLayout!,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer! } },
        { binding: 1, resource: { buffer: this.ellipsoidBuffer! } },
        { binding: 2, resource: { buffer: this.triangleBuffer! } },
        { binding: 3, resource: { buffer: this.bvhNodeBuffer! } },
        { binding: 4, resource: { buffer: this.bvhPrimBuffer! } },
        { binding: 5, resource: this.accumB.createView() },
        { binding: 6, resource: this.accumA.createView() },
      ],
    });
    // Display reads the just-written texture (the "next" target used this frame).
    this.displayBindGroupA = device.createBindGroup({
      layout: this.displayBindGroupLayout!,
      entries: [
        { binding: 0, resource: { buffer: this.displayUniformBuffer! } },
        { binding: 1, resource: this.accumB.createView() },
      ],
    });
    this.displayBindGroupB = device.createBindGroup({
      layout: this.displayBindGroupLayout!,
      entries: [
        { binding: 0, resource: { buffer: this.displayUniformBuffer! } },
        { binding: 1, resource: this.accumA.createView() },
      ],
    });

    this.resetAccumulation();
  }

  private elapsedSeconds(): number {
    if (this.startTimeMs === null) this.startTimeMs = performance.now();
    return (performance.now() - this.startTimeMs) / 1000.0;
  }

  private uploadUniforms(): void {
    const device = this.device!;
    const basis = computeCameraBasis(this.cameraState);
    const t = this.elapsedSeconds();

    // Pack the Uniforms struct: 16 vec4s.
    const u = new Float32Array(16 * 4);
    // resolutionFrame: xy=resolution, z=frameCount, w=time
    u[0] = this.renderWidth; u[1] = this.renderHeight;
    u[2] = this.frameCount; u[3] = t;
    // eye
    u[4] = basis.eye[0]; u[5] = basis.eye[1]; u[6] = basis.eye[2]; u[7] = 0;
    // camForward
    u[8] = basis.forward[0]; u[9] = basis.forward[1]; u[10] = basis.forward[2]; u[11] = 0;
    // camRight
    u[12] = basis.right[0]; u[13] = basis.right[1]; u[14] = basis.right[2]; u[15] = 0;
    // camUp
    u[16] = basis.up[0]; u[17] = basis.up[1]; u[18] = basis.up[2]; u[19] = 0;
    // lightPosColor: pos.xyz, color.x
    u[20] = light.position[0]; u[21] = light.position[1]; u[22] = light.position[2];
    u[23] = light.color[0];
    // lightColorNormal: color.yz, normal.xy
    u[24] = light.color[1]; u[25] = light.color[2];
    u[26] = light.normal[0]; u[27] = light.normal[1];
    // lightNormalSize: normal.z, size.xy
    u[28] = light.normal[2]; u[29] = light.size[0]; u[30] = light.size[1]; u[31] = 0;
    // envTop
    u[32] = environment.top[0]; u[33] = environment.top[1]; u[34] = environment.top[2]; u[35] = 0;
    // envBottomIntensity: bottom.xyz, intensity
    u[36] = environment.bottom[0]; u[37] = environment.bottom[1]; u[38] = environment.bottom[2];
    u[39] = environment.intensity;
    // params: apertureRadius, focalDistance
    u[40] = APERTURE_RADIUS; u[41] = FOCAL_DISTANCE; u[42] = 0; u[43] = 0;
    // counts: triangleCount, ellipsoidCount, bvhNodeCount
    u[44] = bvhTriangleCount; u[45] = ellipsoidCount; u[46] = bvhNodeCount; u[47] = 0;

    writeF32(device, this.uniformBuffer!, u);

    const du = new Float32Array(4);
    du[0] = this.frameCount + 1; // display divides by frames accumulated so far
    du[1] = EXPOSURE;
    du[2] = 0;
    du[3] = 0;
    writeF32(device, this.displayUniformBuffer!, du);
  }

  resize(width: number, height: number): void {
    if (!this.device || !this.context) return;
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "opaque",
    });
    this.ensureAccumTargets(Math.max(1, width), Math.max(1, height));
  }

  renderFrame(_state: FrameState): void { // eslint-disable-line @typescript-eslint/no-unused-vars -- state unused until the full tracer port
    if (!this.device || !this.context || !this.computePipeline || !this.displayPipeline) return;
    if (!this.accumA || !this.accumB) return;

    const evenFrame = this.frameCount % 2 === 0;
    const computeBind = evenFrame ? this.computeBindGroupA! : this.computeBindGroupB!;
    // The compute pass writes into the "next" texture; display shows that one.
    const isDisplayA = evenFrame ? this.displayBindGroupA! : this.displayBindGroupB!;

    this.uploadUniforms();

    const encoder = this.device.createCommandEncoder();

    const computePass = encoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, computeBind);
    computePass.dispatchWorkgroups(
      Math.ceil(this.renderWidth / 8),
      Math.ceil(this.renderHeight / 8),
    );
    computePass.end();

    const renderPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    renderPass.setPipeline(this.displayPipeline);
    renderPass.setBindGroup(0, isDisplayA);
    renderPass.draw(3);
    renderPass.end();

    this.device.queue.submit([encoder.finish()]);

    this.frameCount++;
    if (this.frameCount >= FRAME_COUNT_LIMIT) {
      this.frameCount = FRAME_COUNT_LIMIT; // hold; wait for reset on camera move
    }
  }

  /** Restart progressive accumulation (called on resize / camera move). */
  resetAccumulation(): void {
    this.frameCount = 0;
    this.startTimeMs = null;
    if (this.device && this.accumA && this.accumB) {
      const z = new Float32Array(this.renderWidth * this.renderHeight * 4);
      const data = z as unknown as GPUAllowSharedBufferSource;
      this.device.queue.writeTexture(
        { texture: this.accumA },
        data,
        { bytesPerRow: this.renderWidth * 16, rowsPerImage: this.renderHeight },
        { width: this.renderWidth, height: this.renderHeight },
      );
      this.device.queue.writeTexture(
        { texture: this.accumB },
        data,
        { bytesPerRow: this.renderWidth * 16, rowsPerImage: this.renderHeight },
        { width: this.renderWidth, height: this.renderHeight },
      );
    }
  }

  // --- camera interaction (mirrors src/renderer.ts pointer handling) ------

  attachCameraControls(): void {
    const canvas = this.canvas;
    let dragState: { pointerId: number; lastX: number; lastY: number; button: number } | null = null;

    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      dragState = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY, button: e.button };
      e.preventDefault();
    });
    canvas.addEventListener("pointermove", (e) => {
      const drag = dragState;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      if (drag.button === 2) {
        pan(this.cameraState, computeCameraBasis(this.cameraState), dx, -dy, canvas.clientHeight);
      } else {
        orbit(this.cameraState, dx, -dy);
      }
      this.resetAccumulation();
    });
    const endDrag = (e: PointerEvent) => {
      if (dragState?.pointerId === e.pointerId) dragState = null;
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        zoom(this.cameraState, e.deltaY);
        this.resetAccumulation();
      },
      { passive: false },
    );
  }

  dispose(): void {
    try {
      this.device?.destroy();
    } catch {
      // ignore
    }
    this.accumA?.destroy();
    this.accumB?.destroy();
    this.device = null;
    this.computePipeline = null;
    this.displayPipeline = null;
    this.context = null;
  }
}
