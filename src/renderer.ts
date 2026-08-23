// Issue #39: extracted from main.ts — renderer orchestration.
//
// Issue #39: adopt VAOs — draw calls bind a preconfigured vertex array object
// instead of re-calling enableVertexAttribArray/vertexAttribPointer per frame.
import {
  flattenedTriangles as defaultTriangles,
  flattenedEllipsoids,
  light,
  eye,
  // Issue #58: thin-lens depth-of-field parameters.
  APERTURE_RADIUS,
  FOCAL_DISTANCE,
  // Issue #64: participating media (volumetrics) scene option.
  volumetrics,
  // Issue #61: next-event estimation toggle.
  nextEventEstimation,
} from "./constants";
import {
  computeCameraBasis,
  makeInitialCameraState,
  orbit,
  pan,
  zoom,
  type CameraState,
} from "./camera";
import type { TriangleSoup } from "./gltf-loader";
import { flattenSoup } from "./gltf-loader";
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
 * The framebuffer is sized as clientWidth/Height * renderScale while the
 * canvas element stays at its full CSS size (the browser upsamples the
 * drawing buffer). On HiDPI ("retina") displays devicePixelRatio can be 2+
 * which would multiply the fragment cost by 4x or more for little visible
 * benefit in a path tracer — clamping to min(devicePixelRatio, 1) renders
 * at most 1 device pixel per pixel.
 *
 * Single source of truth for render scaling: issue #59 exposes this value to
 * a UI slider (setRenderScale) rather than introducing a parallel factor.
 */
function defaultRenderScale(): number {
  return Math.min(window.devicePixelRatio || 1, 1);
}

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
  // Issue #65: performance.now() timestamp (ms) captured when rendering starts;
  // u_Time is derived from it so animation is wall-clock based and unaffected
  // by frame-rate jitter.
  private startTimeMs: number | null = null;
  private renderLoopActive = false;
  private resizeObserver: ResizeObserver;
  // Issue #59: render paused (samples-frozen) state.
  private paused = false;
  // Issue #59: dynamic render resolution scale (replaces the old RENDER_SCALE
  // constant; the UI slider calls setRenderScale to mutate it).
  private renderScale = defaultRenderScale();
  // Issue #61: surface next-event estimation toggle. Defaults to the scene
  // option; the UI checkbox flips it via setNextEventEstimation.
  private neeEnabled = nextEventEstimation.enabled;

  // Issue #52: interactive camera state + active drag info.
  private cameraState!: CameraState;
  private dragState: {
    pointerId: number;
    lastX: number;
    lastY: number;
    button: number;
  } | null = null;
  // Issue #65: seconds since the first frame of the current render loop.
  private elapsedSeconds(): number {
    if(this.startTimeMs === null) {
      this.startTimeMs = performance.now();
    }
    return (performance.now() - this.startTimeMs) / 1000.0;
  }

  constructor(
    canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
    programs: Programs,
    geometry: QuadGeometry,
    meshTriangles: TriangleSoup | null = null,
  ) {
    this.canvas = canvas;
    this.gl = gl;
    this.programs = programs;
    this.geometry = geometry;

    // Issue #53: when a GLB mesh loaded successfully its flattened triangle
    // soup replaces the hardcoded Cornell-box walls; otherwise fall back so
    // the app still renders.
    const triangles = meshTriangles
      ? flattenSoup(meshTriangles)
      : defaultTriangles;

    // Issue #39: uniform locations are resolved here, next to the programs.
    const pathtraceUniforms = {
      u_Eye: gl.getUniformLocation(programs.pathtrace, "u_Eye")!,
      // Issue #52: orbit/pan/zoom camera basis uniforms (see camera.ts).
      u_CamForward: gl.getUniformLocation(programs.pathtrace, "u_CamForward")!,
      u_CamRight: gl.getUniformLocation(programs.pathtrace, "u_CamRight")!,
      u_CamUp: gl.getUniformLocation(programs.pathtrace, "u_CamUp")!,
      u_Light: getLightUniforms(gl, programs.pathtrace),
      u_Ellipsoids: gl.getUniformLocation(programs.pathtrace, "u_Ellipsoids")!,
      u_Triangles: gl.getUniformLocation(programs.pathtrace, "u_Triangles")!,
      // NOTE: shader-side u_Time declaration removed in pt/prng-sampling; the TS-side
      // dead uniform lookup and per-frame upload were removed here (issue #15).
      u_Resolution: gl.getUniformLocation(programs.pathtrace, "u_Resolution")!,
      u_FrameCount: gl.getUniformLocation(programs.pathtrace, "u_FrameCount")!,
      // Issue #65: wall-clock seconds driving scene animation / motion blur.
      // Reintroduced (it was removed as dead in issue #15) now that the
      // shader actually consumes it for temporal features.
      u_Time: gl.getUniformLocation(programs.pathtrace, "u_Time")!,
      u_NoiseTexture: gl.getUniformLocation(programs.pathtrace, "u_NoiseTexture")!,
      u_AccumTexture: gl.getUniformLocation(programs.pathtrace, "u_AccumTexture")!,
      // Issue #58: thin-lens DOF.
      u_ApertureRadius: gl.getUniformLocation(programs.pathtrace, "u_ApertureRadius")!,
      u_FocalDistance: gl.getUniformLocation(programs.pathtrace, "u_FocalDistance")!,
      // Issue #64: participating media. All static — uploaded once at init.
      u_FogDensity: gl.getUniformLocation(programs.pathtrace, "u_FogDensity")!,
      u_FogScatterAlbedo: gl.getUniformLocation(programs.pathtrace, "u_FogScatterAlbedo")!,
      u_FogColor: gl.getUniformLocation(programs.pathtrace, "u_FogColor")!,
      u_FogEmission: gl.getUniformLocation(programs.pathtrace, "u_FogEmission")!,
      u_FogAnisotropy: gl.getUniformLocation(programs.pathtrace, "u_FogAnisotropy")!,
      // Issue #61: surface next-event estimation toggle.
      u_NeeEnabled: gl.getUniformLocation(programs.pathtrace, "u_NeeEnabled")!,
    };
    const localUniforms = {
      u_Eye: gl.getUniformLocation(programs.local, "u_Eye")!,
      // Issue #52: orbit/pan/zoom camera basis uniforms (see camera.ts).
      u_CamForward: gl.getUniformLocation(programs.local, "u_CamForward")!,
      u_CamRight: gl.getUniformLocation(programs.local, "u_CamRight")!,
      u_CamUp: gl.getUniformLocation(programs.local, "u_CamUp")!,
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

    // Issue #52: interactive orbit/pan/zoom camera. The CameraState is owned
    // here; the computed eye + basis vectors are uploaded as uniforms whenever
    // the camera moves and accumulation is reset so stale frames are dropped.
    this.cameraState = makeInitialCameraState(eye);
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.dragState = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY, button: e.button };
      e.preventDefault();
    });
    canvas.addEventListener("pointermove", (e) => {
      const drag = this.dragState;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;

      if (drag.button === 2) {
        // Right-drag pans the target in the screen plane.
        pan(this.cameraState, computeCameraBasis(this.cameraState), dx, -dy, canvas.clientHeight);
      } else {
        // Left-drag orbits around the target.
        orbit(this.cameraState, dx, -dy);
      }
      this.onCameraMoved();
    });
    const endDrag = (e: PointerEvent) => {
      if (this.dragState?.pointerId === e.pointerId) this.dragState = null;
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    // Block the context menu so right-drag panning works.
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        zoom(this.cameraState, e.deltaY);
        this.onCameraMoved();
      },
      { passive: false },
    );
    this.uploadCameraUniforms();

    // Issue #41: static uniforms (scene data + sampler bindings) are uploaded
    // once at init instead of every frame. Only truly per-frame values (seed,
    // frameCount, resolution) are uploaded in the render functions.
    const p = this.uniforms.pathtraceUniforms;
    gl.useProgram(programs.pathtrace);
    gl.uniform3fv(p.u_Light.position, light.position);
    gl.uniform3fv(p.u_Light.color, light.color);
    gl.uniform3fv(p.u_Light.normal, light.normal);
    gl.uniform2fv(p.u_Light.size, light.size);
    // WebGL2 note: uniform3fv over a vec3 arr[N] uploads a contiguous
    // 12-float stride — no vec4 padding needed.
    gl.uniform3fv(p.u_Ellipsoids, flattenedEllipsoids);
    gl.uniform3fv(p.u_Triangles, triangles);
    gl.uniform1i(p.u_AccumTexture, 1);
    // Issue #58: static thin-lens DOF parameters.
    gl.uniform1f(p.u_ApertureRadius, APERTURE_RADIUS);
    gl.uniform1f(p.u_FocalDistance, FOCAL_DISTANCE);
    // Issue #64: static participating-media parameters. density === 0 makes
    // the shader skip the medium branch entirely, so non-volume scenes are
    // unaffected by this upload.
    gl.uniform1f(p.u_FogDensity, volumetrics.density);
    gl.uniform1f(p.u_FogScatterAlbedo, volumetrics.scatterAlbedo);
    gl.uniform3fv(p.u_FogColor, volumetrics.color);
    gl.uniform3fv(p.u_FogEmission, volumetrics.emission);
    gl.uniform1f(p.u_FogAnisotropy, volumetrics.anisotropy);
    // Issue #61: static NEE toggle. u_NeeEnabled == 0 keeps every NEE/MIS
    // call site inert, so the transport is the previous pure path tracer.
    gl.uniform1f(p.u_NeeEnabled, nextEventEstimation.enabled ? 1.0 : 0.0);

    gl.useProgram(programs.display);
    gl.uniform1i(this.uniforms.displayUniforms.u_AccumTexture, 0);

    gl.useProgram(programs.local);
    const l = this.uniforms.localUniforms;
    gl.uniform3fv(l.u_Light.position, light.position);
    gl.uniform3fv(l.u_Light.color, light.color);
    gl.uniform3fv(l.u_Light.normal, light.normal);
    gl.uniform2fv(l.u_Light.size, light.size);
    gl.uniform3fv(l.u_Ellipsoids, flattenedEllipsoids);
    gl.uniform3fv(l.u_Triangles, triangles);

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
      // Issue #52: orbit/pan/zoom camera basis.
      u_CamForward: WebGLUniformLocation;
      u_CamRight: WebGLUniformLocation;
      u_CamUp: WebGLUniformLocation;
      u_Light: { position: WebGLUniformLocation; color: WebGLUniformLocation; normal: WebGLUniformLocation; size: WebGLUniformLocation };
      u_Ellipsoids: WebGLUniformLocation;
      u_Triangles: WebGLUniformLocation;
      u_Resolution: WebGLUniformLocation;
      u_FrameCount: WebGLUniformLocation;
      u_Time: WebGLUniformLocation;
      u_AccumTexture: WebGLUniformLocation;
      // Issue #58: thin-lens DOF.
      u_ApertureRadius: WebGLUniformLocation;
      u_FocalDistance: WebGLUniformLocation;
      // Issue #64: participating media.
      u_FogDensity: WebGLUniformLocation;
      u_FogScatterAlbedo: WebGLUniformLocation;
      u_FogColor: WebGLUniformLocation;
      u_FogEmission: WebGLUniformLocation;
      u_FogAnisotropy: WebGLUniformLocation;
      // Issue #61: surface next-event estimation toggle.
      u_NeeEnabled: WebGLUniformLocation;
    };
    localUniforms: {
      u_Eye: WebGLUniformLocation;
      // Issue #52: orbit/pan/zoom camera basis.
      u_CamForward: WebGLUniformLocation;
      u_CamRight: WebGLUniformLocation;
      u_CamUp: WebGLUniformLocation;
      u_Light: { position: WebGLUniformLocation; color: WebGLUniformLocation; normal: WebGLUniformLocation; size: WebGLUniformLocation };
      u_Ellipsoids: WebGLUniformLocation;
      u_Triangles: WebGLUniformLocation;
      u_Resolution: WebGLUniformLocation;
    };
    displayUniforms: { u_AccumTexture: WebGLUniformLocation; u_FrameCount: WebGLUniformLocation };
  };

  /**
   * Issue #52: upload the current camera eye + basis vectors as uniforms for
   * the pathtrace and local programs. Called at init and on every camera move.
   */
  private uploadCameraUniforms(): void {
    const { gl } = this;
    const basis = computeCameraBasis(this.cameraState);
    const { eye: eyePos, forward, right, up } = basis;

    gl.useProgram(this.programs.pathtrace);
    const p = this.uniforms.pathtraceUniforms;
    gl.uniform3fv(p.u_Eye, eyePos);
    gl.uniform3fv(p.u_CamForward, forward);
    gl.uniform3fv(p.u_CamRight, right);
    gl.uniform3fv(p.u_CamUp, up);

    gl.useProgram(this.programs.local);
    const l = this.uniforms.localUniforms;
    gl.uniform3fv(l.u_Eye, eyePos);
    gl.uniform3fv(l.u_CamForward, forward);
    gl.uniform3fv(l.u_CamRight, right);
    gl.uniform3fv(l.u_CamUp, up);
  }

  /** Issue #52: reset accumulation and restart the render loop after a camera move. */
  private onCameraMoved(): void {
    this.uploadCameraUniforms();
    this.frameCount = 0;
    this.startRenderLoop();
  }

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
    // Issue #61: per-frame NEE toggle so the runtime checkbox applies on the
    // very next accumulated frame without re-initializing the renderer.
    gl.uniform1f(this.uniforms.pathtraceUniforms.u_NeeEnabled, this.neeEnabled ? 1.0 : 0.0);
    // Issue #65: seconds since the render loop started. Drives the animated
    // ellipsoid in the shader; the accumulation average across frames becomes
    // motion blur.
    gl.uniform1f(this.uniforms.pathtraceUniforms.u_Time, this.elapsedSeconds());

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
    if (!pathTracingEnabled) {
      this.renderLocal();
      return;
    }

    // Issue #59: when paused, show the final accumulated frame without
    // advancing the sample count or scheduling another frame.
    if (this.paused) {
      this.renderDisplay();
      return;
    }

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
    // Issue #59: update the sample-count HUD.
    this.updateFrameCounter();
    if (this.frameCount < FRAME_COUNT) {
      requestAnimationFrame(this.render);
    } else {
      this.renderLoopActive = false;
      console.log(`Rendering complete after ${FRAME_COUNT} frames`);
    }
  };

  startRenderLoop(): void {
    if (this.renderLoopActive) return;
    this.renderLoopActive = true;
    requestAnimationFrame(this.render);
  }

  /** Issue #59: current accumulation sample count, for the HUD. */
  getSampleCount(): number {
    return this.frameCount;
  }

  /** Issue #59: sample-count HUD. */
  private updateFrameCounter(): void {
    const el = document.getElementById("frame-counter");
    if (el) el.textContent = `Samples: ${this.frameCount}`;
  }

  /**
   * Issue #59: pause / resume progressive rendering. Pausing freezes the
   * accumulated image (no further samples are taken); resuming continues
   * accumulating from where it stopped.
   */
  setPaused(paused: boolean): void {
    if (!pathTracingEnabled) return;
    if (this.paused === paused) return;
    this.paused = paused;
    if (!paused) {
      // Resuming: keep the current accumulation and continue the loop.
      this.startRenderLoop();
    } else {
      this.renderLoopActive = false;
    }
    const btn = document.getElementById("toggle-pause") as HTMLButtonElement | null;
    if (btn) btn.textContent = paused ? "Resume" : "Pause";
  }

  /** Issue #59: download the current canvas contents as a PNG. */
  savePNG(): void {
    // preserveDrawingBuffer is enabled in gl-context.ts so the buffer is
    // still readable here. Render one final display pass to guarantee the
    // latest accumulation is present, then export.
    if (pathTracingEnabled) this.renderDisplay();
    else this.renderLocal();
    this.canvas.toBlob((blob) => {
      if (!blob) {
        console.error("savePNG: failed to encode canvas");
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pathtrace-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  /**
   * Issue #59: set the render-resolution scale (resolution multiplier). The
   * framebuffer is rebuilt at the new size and accumulation resets, so a
   * lower scale trades quality for speed and a higher scale sharpens output.
   */
  setRenderScale(scale: number): void {
    const clamped = Math.max(0.1, Math.min(scale, 2));
    if (clamped === this.renderScale) return;
    this.renderScale = clamped;
    this.frameCount = 0;
    this.resizeCanvas();
  }

  /**
   * Issue #61: toggle surface next-event estimation (explicit emissive-
   * primitive sampling combined with BSDF sampling via the MIS power
   * heuristic) at runtime. The uniform upload is per-frame so no re-init is
   * needed; accumulation resets so samples from different integrators are
   * never averaged together.
   */
  setNextEventEstimation(enabled: boolean): void {
    this.neeEnabled = enabled;
    this.frameCount = 0;
    this.startRenderLoop();
  }

  resizeCanvas(): void {
    const width = Math.max(1, Math.round(this.canvas.clientWidth * this.renderScale));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * this.renderScale));

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
