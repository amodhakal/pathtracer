// Issue #39: main.ts is now a thin entry point — the renderer lives in
// src/renderer.ts, WebGL bootstrap in src/gl-context.ts, program compilation
// in src/programs.ts, quad VAO setup in src/geometry.ts, and float
// textures/ping-pong FBOs in src/framebuffers.ts.
import { initGLContext } from "./gl-context";
import { reportError } from "./errors";
import { createPrograms } from "./programs";
import { createQuadVAOs } from "./geometry";
import { Renderer } from "./renderer";
import { startWebGPUBackend } from "./backends/webgpu-main";

try {
  // Issue #63: backend selection. WebGPU scaffold is opt-in via
  // ?backend=webgpu; WebGL2 remains the default path.
  const requestedBackend = new URLSearchParams(window.location.search).get("backend");
  if (requestedBackend === "webgpu") {
    const canvasEl = document.getElementById("canvas") as HTMLCanvasElement | null;
    if (!canvasEl) throw new Error("#canvas element not found");
    await startWebGPUBackend(canvasEl);
  }

  const { canvas, gl } = initGLContext();
  const programs = createPrograms(gl);
  const geometry = createQuadVAOs(gl, [
    programs.pathtrace,
    programs.local,
    programs.display,
  ]);
  new Renderer(canvas, gl, programs, geometry);
} catch (err) {
  reportError("Error: " + err);
}
