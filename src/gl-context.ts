// Issue #39: extracted from main.ts — WebGL2 context bootstrap.
import { reportError } from "./errors";

export interface GLContext {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
}

/**
 * Acquire the canvas and a WebGL2 context with float color-buffer support.
 * Throws (after reporting via the error overlay) if unsupported.
 */
export function initGLContext(): GLContext {
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

  return { canvas, gl };
}
