import vertexCode from "./shaders/shaders.vert";
import pathtraceFragCode from "./shaders/pathtrace.frag";
import localFragCode from "./shaders/local.frag";
import displayFragCode from "./shaders/display.frag";
import noiseGenFragCode from "./shaders/noiseGen.frag";
import { createProgram, createShader, resolveIncludes } from "./utils";
import { vertices, flattenedTriangles, flattenedEllipsoids, light, eye } from "./constants";

// Issue #25: path tracing is the default mode on startup. This overrides the
// stale IS_PATHTRACING export in constants.ts (which defaults to false).
const DEFAULT_PATH_TRACING = true;
const pathTracingEnabled = DEFAULT_PATH_TRACING;

const FRAME_COUNT = 12_000

// Issue #19: non-blocking error reporting — show errors in an on-page overlay
// (and console.error) instead of alert(), which blocks the main thread.
function reportError(message: string): void {
  console.error(message);
  let overlay = document.getElementById("error-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "error-overlay";
    overlay.setAttribute("role", "alert");
    overlay.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:9999;" +
      "background:#c0392b;color:#fff;font:14px/1.4 sans-serif;" +
      "padding:12px 16px;white-space:pre-wrap;";
    document.body.appendChild(overlay);
  }
  overlay.textContent = overlay.textContent ? overlay.textContent + "\n" + message : message;
}

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const gl = canvas.getContext("webgl2");
if (!gl) {
  reportError("WebGL2 not supported");
  throw new Error("WebGL2 not supported");
}

const floatExt = gl.getExtension("EXT_color_buffer_float");
if (!floatExt) {
  reportError("Floating-point color buffers are not supported on this device.");
  throw new Error("EXT_color_buffer_float not supported");
}

try {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexCode);

  const pathtraceShader = createShader(gl, gl.FRAGMENT_SHADER, resolveIncludes(pathtraceFragCode));
  const pathtraceProgram = createProgram(gl, vertexShader, pathtraceShader);

  const localShader = createShader(gl, gl.FRAGMENT_SHADER, resolveIncludes(localFragCode));
  const localProgram = createProgram(gl, vertexShader, localShader);

  const displayShader = createShader(gl, gl.FRAGMENT_SHADER, displayFragCode);
  const displayProgram = createProgram(gl, vertexShader, displayShader);

  const noiseGenShader = createShader(gl, gl.FRAGMENT_SHADER, noiseGenFragCode);
  const noiseProgram = createProgram(gl, vertexShader, noiseGenShader);

  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  const posLocPathtrace = gl.getAttribLocation(pathtraceProgram, "a_Position");
  const posLocLocal = gl.getAttribLocation(localProgram, "a_Position");
  const posLocDisplay = gl.getAttribLocation(displayProgram, "a_Position");
  const posLocNoise = gl.getAttribLocation(noiseProgram, "a_Position");

  let textureWidth = 0;
  let textureHeight = 0;

  let noiseTexture: WebGLTexture | null = null;
  let noiseFBO: WebGLFramebuffer | null = null;
  let accumTextureA: WebGLTexture | null = null;
  let accumTextureB: WebGLTexture | null = null;
  let fboA: WebGLFramebuffer | null = null;
  let fboB: WebGLFramebuffer | null = null;

  let readTex: WebGLTexture | null = null;
  let writeFbo: WebGLFramebuffer | null = null;
  let writeTex: WebGLTexture | null = null;

  let frameCount = 0;
  let renderLoopActive = false;

  function createTexture(width: number, height: number, internalFormat: number, format: number, type: number) {
    if (!gl) return null;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  function setupFramebuffers(width: number, height: number) {
    if (!gl) return;
    if (noiseTexture) gl.deleteTexture(noiseTexture);
    if (noiseFBO) gl.deleteFramebuffer(noiseFBO);
    if (accumTextureA) gl.deleteTexture(accumTextureA);
    if (accumTextureB) gl.deleteTexture(accumTextureB);
    if (fboA) gl.deleteFramebuffer(fboA);
    if (fboB) gl.deleteFramebuffer(fboB);

    textureWidth = width;
    textureHeight = height;

    // --- Noise Texture & FBO ---
    // Issue #3: use a float texture so RNG values aren't quantized to 8 bits.
    noiseTexture = createTexture(width, height, gl.RGBA32F, gl.RGBA, gl.FLOAT);
    noiseFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, noiseFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, noiseTexture, 0);
    {
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        console.error("noiseFBO is incomplete:", status);
      }
    }

    // --- Ping-Pong Accumulation Textures & FBOs ---
    accumTextureA = createTexture(width, height, gl.RGBA32F, gl.RGBA, gl.FLOAT);
    accumTextureB = createTexture(width, height, gl.RGBA32F, gl.RGBA, gl.FLOAT);

    fboA = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboA);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, accumTextureA, 0);
    {
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        console.error("fboA is incomplete:", status);
      }
    }

    fboB = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, accumTextureB, 0);
    {
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        console.error("fboB is incomplete:", status);
      }
    }

    // Clear both accumulation FBOs to black
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboA);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fboB);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    readTex = accumTextureA;
    writeFbo = fboB;
    writeTex = accumTextureB;
    frameCount = 0;
  }

  // Uniform locations
  const pathtraceUniforms = {
    u_Eye: gl.getUniformLocation(pathtraceProgram, "u_Eye")!,
    u_Light: {
      position: gl.getUniformLocation(pathtraceProgram, "u_Light.position")!,
      color: gl.getUniformLocation(pathtraceProgram, "u_Light.color")!,
      normal: gl.getUniformLocation(pathtraceProgram, "u_Light.normal")!,
      size: gl.getUniformLocation(pathtraceProgram, "u_Light.size")!,
    },
    u_Ellipsoids: gl.getUniformLocation(pathtraceProgram, "u_Ellipsoids")!,
    u_Triangles: gl.getUniformLocation(pathtraceProgram, "u_Triangles")!,
    // NOTE: shader-side u_Time declaration removed in pt/prng-sampling; the TS-side
    // dead uniform lookup and per-frame upload were removed here (issue #15).
    u_Resolution: gl.getUniformLocation(pathtraceProgram, "u_Resolution")!,
    u_FrameCount: gl.getUniformLocation(pathtraceProgram, "u_FrameCount")!,
    u_NoiseTexture: gl.getUniformLocation(pathtraceProgram, "u_NoiseTexture")!,
    u_AccumTexture: gl.getUniformLocation(pathtraceProgram, "u_AccumTexture")!,
  };

  const noiseUniforms = {
    u_Seed: gl.getUniformLocation(noiseProgram, "u_Seed")!,
    u_Resolution: gl.getUniformLocation(noiseProgram, "u_Resolution")!,
  };

  const localUniforms = {
    u_Eye: gl.getUniformLocation(localProgram, "u_Eye")!,
    u_Light: {
      position: gl.getUniformLocation(localProgram, "u_Light.position")!,
      color: gl.getUniformLocation(localProgram, "u_Light.color")!,
      normal: gl.getUniformLocation(localProgram, "u_Light.normal")!,
      size: gl.getUniformLocation(localProgram, "u_Light.size")!,
    },
    u_Ellipsoids: gl.getUniformLocation(localProgram, "u_Ellipsoids")!,
    u_Triangles: gl.getUniformLocation(localProgram, "u_Triangles")!,
    u_Resolution: gl.getUniformLocation(localProgram, "u_Resolution")!,
  };


  const displayUniforms = {
    // Issue #24: renamed from the misleading u_NoiseTexture — this pass samples
    // the accumulation result, not the noise texture.
    u_AccumTexture: gl.getUniformLocation(displayProgram, "u_AccumTexture")!,
    // Issue #11: frame count used to divide the accumulated sum.
    u_FrameCount: gl.getUniformLocation(displayProgram, "u_FrameCount")!,
    // Issue #33: linear exposure applied before tone mapping.
    u_Exposure: gl.getUniformLocation(displayProgram, "u_Exposure")!,
  };

  // Issue #41: static uniforms (scene data + sampler bindings) are uploaded
  // once at init instead of every frame. Only truly per-frame values (seed,
  // frameCount, resolution) are uploaded in the render functions.
  gl.useProgram(pathtraceProgram);
  gl.uniform3fv(pathtraceUniforms.u_Eye, eye);
  gl.uniform3fv(pathtraceUniforms.u_Light.position, light.position);
  gl.uniform3fv(pathtraceUniforms.u_Light.color, light.color);
  gl.uniform3fv(pathtraceUniforms.u_Light.normal, light.normal);
  gl.uniform2fv(pathtraceUniforms.u_Light.size, light.size);
  // WebGL2 note: uniform3fv over a vec3 arr[N] uploads a contiguous
  // 12-float stride — no vec4 padding needed.
  gl.uniform3fv(pathtraceUniforms.u_Ellipsoids, flattenedEllipsoids);
  gl.uniform3fv(pathtraceUniforms.u_Triangles, flattenedTriangles);
  gl.uniform1i(pathtraceUniforms.u_NoiseTexture, 0);
  gl.uniform1i(pathtraceUniforms.u_AccumTexture, 1);

  gl.useProgram(displayProgram);
  gl.uniform1i(displayUniforms.u_AccumTexture, 0);
  // Issue #33: neutral exposure (1.0) — scales linear radiance before tone mapping.
  gl.uniform1f(displayUniforms.u_Exposure, 1.0);

  gl.useProgram(localProgram);
  gl.uniform3fv(localUniforms.u_Eye, eye);
  gl.uniform3fv(localUniforms.u_Light.position, light.position);
  gl.uniform3fv(localUniforms.u_Light.color, light.color);
  gl.uniform3fv(localUniforms.u_Light.normal, light.normal);
  gl.uniform2fv(localUniforms.u_Light.size, light.size);
  gl.uniform3fv(localUniforms.u_Ellipsoids, flattenedEllipsoids);
  gl.uniform3fv(localUniforms.u_Triangles, flattenedTriangles);

  function renderNoise() {
    if (!gl) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, noiseFBO);
    gl.viewport(0, 0, textureWidth, textureHeight);
    gl.useProgram(noiseProgram);

    gl.enableVertexAttribArray(posLocNoise);
    gl.vertexAttribPointer(posLocNoise, 2, gl.FLOAT, false, 0, 0);

    // Issue #4 / #96: deterministic per-run seed that varies per accumulated
    // frame so Monte-Carlo samples decorrelate while runs stay reproducible.
    const FIXED_NOISE_SEED = 19700101.0;
    gl.uniform1f(noiseUniforms.u_Seed, FIXED_NOISE_SEED + frameCount);
    gl.uniform2f(noiseUniforms.u_Resolution, textureWidth, textureHeight);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function renderPathtrace() {
    if (!gl) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, writeFbo);
    gl.viewport(0, 0, textureWidth, textureHeight);
    gl.useProgram(pathtraceProgram);

    gl.enableVertexAttribArray(posLocPathtrace);
    gl.vertexAttribPointer(posLocPathtrace, 2, gl.FLOAT, false, 0, 0);

    // Issue #41: texture unit bindings are static and set once at init.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, noiseTexture);

    // Bind read accumulation texture to unit 1
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, readTex);

    // Issue #41: static scene uniforms + sampler bindings are uploaded once
    // at init; only dynamic values are uploaded per frame here.
    gl.uniform2f(pathtraceUniforms.u_Resolution, textureWidth, textureHeight);
    gl.uniform1f(pathtraceUniforms.u_FrameCount, frameCount);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function renderDisplay() {
    if (!gl) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(displayProgram);

    gl.enableVertexAttribArray(posLocDisplay);
    gl.vertexAttribPointer(posLocDisplay, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, writeTex);
    // Issue #11: accumulation buffers hold a sum; divide by the number of
    // samples accumulated so far (frameCount + 1 for the pass just rendered).
    gl.uniform1f(displayUniforms.u_FrameCount, frameCount + 1);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function renderLocal() {
    if (!gl) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(localProgram);

    gl.enableVertexAttribArray(posLocLocal);
    gl.vertexAttribPointer(posLocLocal, 2, gl.FLOAT, false, 0, 0);

    // Issue #41: static scene uniforms are uploaded once at init; only the
    // dynamic resolution is uploaded here (it depends on canvas size).
    gl.uniform2f(localUniforms.u_Resolution, canvas.width, canvas.height);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function render() {
    if (pathTracingEnabled) {
      renderNoise();
      renderPathtrace();
      renderDisplay();

      if (readTex === accumTextureA) {
        readTex = accumTextureB;
        writeFbo = fboA;
        writeTex = accumTextureA;
      } else {
        readTex = accumTextureA;
        writeFbo = fboB;
        writeTex = accumTextureB;
      }

      frameCount++;
      if (frameCount < FRAME_COUNT) {
        requestAnimationFrame(render);
      } else {
        renderLoopActive = false;
        console.log(`Rendering complete after ${FRAME_COUNT} frames`);
      }
    } else {
      renderLocal();
    }
  }

  function startRenderLoop() {
    if (renderLoopActive) return;
    renderLoopActive = true;
    requestAnimationFrame(render);
  }

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

  function resizeCanvas() {
    const width = Math.max(1, Math.round(canvas.clientWidth * RENDER_SCALE));
    const height = Math.max(1, Math.round(canvas.clientHeight * RENDER_SCALE));

    if (canvas.width === width && canvas.height === height) return;

    canvas.width = width;
    canvas.height = height;
    // Issue #23: only rebuild noise/accumulation FBOs when path tracing is active.
    // In local shading mode rendering goes straight to the backbuffer and the
    // FBOs are unused, so rebuilding them (and resetting frameCount) is wasted work.
    if (pathTracingEnabled) {
      setupFramebuffers(width, height);
    }
    startRenderLoop();
  }

  resizeCanvas();
  // Issue #22: ResizeObserver alone handles canvas resizes — it fires whenever
  // the element's size changes, which covers window resizes too. The duplicate
  // window "resize" listener was removed.
  new ResizeObserver(resizeCanvas).observe(canvas);
  startRenderLoop();
} catch (err) {
  reportError("Error: " + err);
}
