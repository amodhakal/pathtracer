// Issue #39: extracted from main.ts — renderer orchestration.
//
// Issue #39: adopt VAOs — draw calls bind a preconfigured vertex array object
// instead of re-calling enableVertexAttribArray/vertexAttribPointer per frame.
import {
  flattenedTriangles,
  flattenedEllipsoids,
  light,
  eye,
  // Issue #58: thin-lens depth-of-field parameters.
  APERTURE_RADIUS,
  FOCAL_DISTANCE,
} from "./constants";
import type { Programs } from "./programs";
import type { QuadGeometry } from "./geometry";
import { createRenderTargets, destroyRenderTargets, type RenderTargets } from "./framebuffers";

// Issue #25: path tracing is the default mode on startup. This overrides the
// stale IS_PATHTRACING export in constants.ts (which defaults to false).
const DEFAULT_PATH_TRACING = true;
const pathTracingEnabled = DEFAULT_PATH_TRACING;

const FRAME_COUNT = 12_000;

/**
 * Internal render resolution scale relative to the canvas's CSS size.
 *
 * The framebuffer is sized as clientWidth/Height * RENDER_SCALE while the
 * canvas element stays at its full CSS size (the browser upsamples the
 * drawing buffer). On HiDPI ("retina") displays devicePixelRatio can be 2+
 * which would multiply the fragment cost by 4x or more for little visible
 * benefit in a path tracer — clamping to min(devicePixelRatio, 1) renders
 * at most 1 device pixel per pixel.
 *
 * Single source of truth for render scaling: a future UI control
 * (e.g. issue #59's render-scale slider) should replace/update this
 * constant rather than introducing a parallel factor.
 */
const RENDER_SCALE = Math.min(window.devicePixelRatio || 1, 1);

function getLightUniforms(gl: WebGL2RenderingContext, program: WebGLProgram) {
  return {
    position: gl.getUniformLocation(program, "u_Light.position")!,
    color: gl.getUniformLocation(program, "u_Light.color")!,
    normal: gl.getUniformLocation(program, "u_Light.normal")!,
    size: gl.getUniformLocation(program, "u_Light.size")!,
  };
}

export class Renderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private programs: Programs;
  private geometry: QuadGeometry;

  private targets: RenderTargets | null = null;
  private readTex: WebGLTexture | null = null;
  private writeFbo: WebGLFramebuffer | null = null;
  private writeTex: WebGLTexture | null = null;

  private frameCount = 0;
  private renderLoopActive = false;
  private resizeObserver: ResizeObserver;

  constructor(
    canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
    programs: Programs,
    geometry: QuadGeometry,
  ) {
    this.canvas = canvas;
    this.gl = gl;
    this.programs = programs;
    this.geometry = geometry;

    // Issue #39: uniform locations are resolved here, next to the programs.
    const pathtraceUniforms = {
      u_Eye: gl.getUniformLocation(programs.pathtrace, "u_Eye")!,
      u_Light: getLightUniforms(gl, programs.pathtrace),
      u_Ellipsoids: gl.getUniformLocation(programs.pathtrace, "u_Ellipsoids")!,
      u_Triangles: gl.getUniformLocation(programs.pathtrace, "u_Triangles")!,
      // NOTE: shader-side u_Time declaration removed in pt/prng-sampling; the TS-side
      // dead uniform lookup and per-frame upload were removed here (issue #15).
      u_Resolution: gl.getUniformLocation(programs.pathtrace, "u_Resolution")!,
      u_FrameCount: gl.getUniformLocation(programs.pathtrace, "u_FrameCount")!,
      u_NoiseTexture: gl.getUniformLocation(programs.pathtrace, "u_NoiseTexture")!,
      u_AccumTexture: gl.getUniformLocation(programs.pathtrace, "u_AccumTexture")!,
      // Issue #58: thin-lens DOF.
      u_ApertureRadius: gl.getUniformLocation(programs.pathtrace, "u_ApertureRadius")!,
      u_FocalDistance: gl.getUniformLocation(programs.pathtrace, "u_FocalDistance")!,
    };
    const localUniforms = {
      u_Eye: gl.getUniformLocation(programs.local, "u_Eye")!,
      u_Light: getLightUniforms(gl, programs.local),
      u_Ellipsoids: gl.getUniformLocation(programs.local, "u_Ellipsoids")!,
      u_Triangles: gl.getUniformLocation(programs.local, "u_Triangles")!,
      u_Resolution: gl.getUniformLocation(programs.local, "u_Resolution")!,
    };
    const displayUniforms = {
      // Issue #24: renamed from the misleading u_NoiseTexture — this pass samples
      // the accumulation result, not the noise texture.
      u_AccumTexture: gl.getUniformLocation(programs.display, "u_AccumTexture")!,
      // Issue #11: frame count used to divide the accumulated sum.
      u_FrameCount: gl.getUniformLocation(programs.display, "u_FrameCount")!,
    };
    this.uniforms = { pathtraceUniforms, localUniforms, displayUniforms };

    // Issue #41: static uniforms (scene data + sampler bindings) are uploaded
    // once at init instead of every frame. Only truly per-frame values (seed,
    // frameCount, resolution) are uploaded in the render functions.
    const p = this.uniforms.pathtraceUniforms;
    gl.useProgram(programs.pathtrace);
    gl.uniform3fv(p.u_Eye, eye);
    gl.uniform3fv(p.u_Light.position, light.position);
    gl.uniform3fv(p.u_Light.color, light.color);
    gl.uniform3fv(p.u_Light.normal, light.normal);
    gl.uniform2fv(p.u_Light.size, light.size);
    // WebGL2 note: uniform3fv over a vec3 arr[N] uploads a contiguous
    // 12-float stride — no vec4 padding needed.
    gl.uniform3fv(p.u_Ellipsoids, flattenedEllipsoids);
    gl.uniform3fv(p.u_Triangles, flattenedTriangles);
    gl.uniform1i(p.u_AccumTexture, 1);
    // Issue #58: static thin-lens DOF parameters.
    gl.uniform1f(p.u_ApertureRadius, APERTURE_RADIUS);
    gl.uniform1f(p.u_FocalDistance, FOCAL_DISTANCE);

    gl.useProgram(programs.display);
    gl.uniform1i(this.uniforms.displayUniforms.u_AccumTexture, 0);

    gl.useProgram(programs.local);
    const l = this.uniforms.localUniforms;
    gl.uniform3fv(l.u_Eye, eye);
    gl.uniform3fv(l.u_Light.position, light.position);
    gl.uniform3fv(l.u_Light.color, light.color);
    gl.uniform3fv(l.u_Light.normal, light.normal);
    gl.uniform2fv(l.u_Light.size, light.size);
    gl.uniform3fv(l.u_Ellipsoids, flattenedEllipsoids);
    gl.uniform3fv(l.u_Triangles, flattenedTriangles);

    // Issue #22: ResizeObserver alone handles canvas resizes — it fires whenever
    // the element's size changes, which covers window resizes too. The duplicate
    // window "resize" listener was removed.
    this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
    this.resizeObserver.observe(canvas);

    this.resizeCanvas();
    this.startRenderLoop();
  }

  private uniforms: {
    pathtraceUniforms: {
      u_Eye: WebGLUniformLocation;
      u_Light: { position: WebGLUniformLocation; color: WebGLUniformLocation; normal: WebGLUniformLocation; size: WebGLUniformLocation };
      u_Ellipsoids: WebGLUniformLocation;
      u_Triangles: WebGLUniformLocation;
      u_Resolution: WebGLUniformLocation;
      u_FrameCount: WebGLUniformLocation;
      u_AccumTexture: WebGLUniformLocation;
      // Issue #58: thin-lens DOF.
      u_ApertureRadius: WebGLUniformLocation;
      u_FocalDistance: WebGLUniformLocation;
    };
    localUniforms: {
      u_Eye: WebGLUniformLocation;
      u_Light: { position: WebGLUniformLocation; color: WebGLUniformLocation; normal: WebGLUniformLocation; size: WebGLUniformLocation };
      u_Ellipsoids: WebGLUniformLocation;
      u_Triangles: WebGLUniformLocation;
      u_Resolution: WebGLUniformLocation;
    };
    displayUniforms: { u_AccumTexture: WebGLUniformLocation; u_FrameCount: WebGLUniformLocation };
  };

  /** Rebuild FBOs at a new size and reset accumulation. */
  private setupFramebuffers(width: number, height: number): void {
    if (this.targets) destroyRenderTargets(this.gl, this.targets);
    this.targets = createRenderTargets(this.gl, width, height);
    this.readTex = this.targets.accumTextureA;
    this.writeFbo = this.targets.fboB;
    this.writeTex = this.targets.accumTextureB;
    this.frameCount = 0;
  }

  private renderPathtrace(): void {
    const { gl } = this;
    const t = this.targets!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.writeFbo);
    gl.viewport(0, 0, t.textureWidth, t.textureHeight);
    gl.useProgram(this.programs.pathtrace);
    gl.bindVertexArray(this.geometry.vaos[0]);

    // Issue #41: texture unit bindings are static and set once at init,
    // but which texture is "read" ping-pongs, so bind per frame here.
    // Issue #29: no noise texture — the PRNG lives in-shader now.

    // Bind read accumulation texture to unit 1
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.readTex);

    // Issue #41: static scene uniforms + sampler bindings are uploaded once
    // at init; only dynamic values are uploaded per frame here.
    gl.uniform2f(this.uniforms.pathtraceUniforms.u_Resolution, t.textureWidth, t.textureHeight);
    gl.uniform1f(this.uniforms.pathtraceUniforms.u_FrameCount, this.frameCount);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private renderDisplay(): void {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.programs.display);
    gl.bindVertexArray(this.geometry.vaos[2]);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.writeTex);
    // Issue #11: accumulation buffers hold a sum; divide by the number of
    // samples accumulated so far (frameCount + 1 for the pass just rendered).
    gl.uniform1f(this.uniforms.displayUniforms.u_FrameCount, this.frameCount + 1);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  private renderLocal(): void {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.programs.local);
    gl.bindVertexArray(this.geometry.vaos[1]);

    // Issue #41: static scene uniforms are uploaded once at init; only the
    // dynamic resolution is uploaded here (it depends on canvas size).
    gl.uniform2f(this.uniforms.localUniforms.u_Resolution, this.canvas.width, this.canvas.height);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  private render = (): void => {
    if (pathTracingEnabled) {
      this.renderPathtrace();
      this.renderDisplay();

      if (this.readTex === this.targets?.accumTextureA) {
        this.readTex = this.targets.accumTextureB;
        this.writeFbo = this.targets.fboA;
        this.writeTex = this.targets.accumTextureA;
      } else {
        this.readTex = this.targets!.accumTextureA;
        this.writeFbo = this.targets!.fboB;
        this.writeTex = this.targets!.accumTextureB;
      }

      this.frameCount++;
      if (this.frameCount < FRAME_COUNT) {
        requestAnimationFrame(this.render);
      } else {
        this.renderLoopActive = false;
        console.log(`Rendering complete after ${FRAME_COUNT} frames`);
      }
    } else {
      this.renderLocal();
    }
  };

  startRenderLoop(): void {
    if (this.renderLoopActive) return;
    this.renderLoopActive = true;
    requestAnimationFrame(this.render);
  }

  resizeCanvas(): void {
    const width = Math.max(1, Math.round(this.canvas.clientWidth * RENDER_SCALE));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * RENDER_SCALE));

    if (this.canvas.width === width && this.canvas.height === height) return;

    this.canvas.width = width;
    this.canvas.height = height;
    // Issue #23: only rebuild noise/accumulation FBOs when path tracing is active.
    // In local shading mode rendering goes straight to the backbuffer and the
    // FBOs are unused, so rebuilding them (and resetting frameCount) is wasted work.
    if (pathTracingEnabled) {
      this.setupFramebuffers(width, height);
    }
    this.startRenderLoop();
  }
}
