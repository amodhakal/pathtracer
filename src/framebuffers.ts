// Issue #39: extracted from main.ts — float textures and ping-pong FBOs.
export interface RenderTargets {
  textureWidth: number;
  textureHeight: number;
  noiseTexture: WebGLTexture | null;
  noiseFBO: WebGLFramebuffer | null;
  accumTextureA: WebGLTexture | null;
  accumTextureB: WebGLTexture | null;
  fboA: WebGLFramebuffer | null;
  fboB: WebGLFramebuffer | null;
}

function createTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  internalFormat: number,
  format: number,
  type: number,
): WebGLTexture | null {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function attachAndCheck(
  gl: WebGL2RenderingContext,
  fbo: WebGLFramebuffer | null,
  texture: WebGLTexture | null,
  label: string,
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    console.error(`${label} is incomplete:`, status);
  }
}

/** Create the noise FBO plus two ping-pong accumulation FBOs at the given size. */
export function createRenderTargets(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): RenderTargets {
  // --- Noise Texture & FBO ---
  // Issue #3: use a float texture so RNG values aren't quantized to 8 bits.
  const noiseTexture = createTexture(gl, width, height, gl.RGBA32F, gl.RGBA, gl.FLOAT);
  const noiseFBO = gl.createFramebuffer();

  // --- Ping-Pong Accumulation Textures & FBOs ---
  const accumTextureA = createTexture(gl, width, height, gl.RGBA32F, gl.RGBA, gl.FLOAT);
  const accumTextureB = createTexture(gl, width, height, gl.RGBA32F, gl.RGBA, gl.FLOAT);
  const fboA = gl.createFramebuffer();
  const fboB = gl.createFramebuffer();

  attachAndCheck(gl, noiseFBO, noiseTexture, "noiseFBO");
  attachAndCheck(gl, fboA, accumTextureA, "fboA");
  attachAndCheck(gl, fboB, accumTextureB, "fboB");

  // Clear both accumulation FBOs to black
  gl.clearColor(0, 0, 0, 1);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fboA);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fboB);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return {
    textureWidth: width,
    textureHeight: height,
    noiseTexture,
    noiseFBO,
    accumTextureA,
    accumTextureB,
    fboA,
    fboB,
  };
}

/** Delete all resources owned by a previous set of render targets. */
export function destroyRenderTargets(
  gl: WebGL2RenderingContext,
  targets: RenderTargets,
): void {
  if (targets.noiseTexture) gl.deleteTexture(targets.noiseTexture);
  if (targets.noiseFBO) gl.deleteFramebuffer(targets.noiseFBO);
  if (targets.accumTextureA) gl.deleteTexture(targets.accumTextureA);
  if (targets.accumTextureB) gl.deleteTexture(targets.accumTextureB);
  if (targets.fboA) gl.deleteFramebuffer(targets.fboA);
  if (targets.fboB) gl.deleteFramebuffer(targets.fboB);
}
