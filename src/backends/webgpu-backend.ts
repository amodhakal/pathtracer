import type { FrameState, RenderBackend } from "./backend";

/**
 * WebGPU backend (issue #63) — minimal scaffold.
 *
 * Implements device acquisition, canvas surface configuration, and a
 * fullscreen-triangle draw with a trivial gradient fragment shader.
 * This validates the backend seam end-to-end (device -> pipeline ->
 * per-frame command encoding -> present).
 *
 * DEFERRED (full port): translating pathtrace.frag / local.frag /
 * noiseGen.frag / display.frag to WGSL, storage textures for float
 * ping-pong accumulation, scene data as uniform/storage buffers, and
 * the progressive frame-count loop.
 */

const QUAD_WGSL = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VertexOutput {
  // Fullscreen triangle covering clip space [-1,1]x[-1,1].
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  1.0),
  );
  var out: VertexOutput;
  let p = pos[vi];
  out.position = vec4<f32>(p, 0.0, 1.0);
  return out;
}

@fragment
fn fs(out: VertexOutput) -> @location(0) vec4<f32> {
  // Placeholder clear/gradient pattern; replaced by the tracer output
  // during the full WebGPU port.
  let uv = out.position.xy;
  return vec4<f32>(
    fract(uv.x / 256.0),
    fract(uv.y / 256.0),
    0.15,
    1.0
  );
}
`;

export class WebGPURenderBackend implements RenderBackend {
  readonly name = "webgpu";

  private canvas: HTMLCanvasElement;
  private context: GPUCanvasContext | null = null;
  private device: GPUDevice | null = null;
  private format: GPUTextureFormat = "rgba8unorm";
  private pipeline: GPURenderPipeline | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
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

    const module = this.device.createShaderModule({ code: QUAD_WGSL });
    this.pipeline = this.device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: {
        module,
        entryPoint: "fs",
        targets: [{ format: this.format }],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  resize(width: number, height: number): void {
    // Canvas drawing-buffer size is set by the caller (main.ts);
    // reconfiguring the context picks up the new size on next present.
    if (!this.context || !this.device) return;
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "opaque",
    });
    void width;
    void height;
  }

  renderFrame(_state: FrameState): void { // eslint-disable-line @typescript-eslint/no-unused-vars -- state unused until the full tracer port
    if (!this.device || !this.context || !this.pipeline) return;

    const encoder = this.device.createCommandEncoder();
    const view = this.context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  dispose(): void {
    try {
      this.device?.destroy();
    } catch {
      // destroy() may be unavailable on older implementations.
    }
    this.device = null;
    this.pipeline = null;
    this.context = null;
  }
}
