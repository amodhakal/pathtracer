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
  const renderer = new Renderer(canvas, gl, programs, geometry);
  // Issue #59: wire up the progressive display controls (HUD, pause/resume,
  // save-PNG, render-scale slider) declared in index.html.
  wireProgressiveDisplayControls(renderer);
} catch (err) {
  reportError("Error: " + err);
}

/**
 * Issue #59: connect the runtime UI controls to the Renderer.
 *
 * - Pause/Resume button toggles progressive rendering.
 * - Save PNG button downloads the current framebuffer as a PNG.
 * - Render-scale slider adjusts the render resolution multiplier live.
 *
 * The sample-count HUD is updated by the Renderer itself each accumulated
 * frame, so there is nothing to poll here.
 */
function wireProgressiveDisplayControls(renderer: Renderer): void {
  const pauseBtn = document.getElementById("toggle-pause") as HTMLButtonElement | null;
  pauseBtn?.addEventListener("click", () => {
    renderer.setPaused(pauseBtn.textContent?.toLowerCase() !== "resume");
  });

  const saveBtn = document.getElementById("save-png") as HTMLButtonElement | null;
  saveBtn?.addEventListener("click", () => renderer.savePNG());

  const scale = document.getElementById("render-scale") as HTMLInputElement | null;
  const scaleValue = document.getElementById("render-scale-value");
  scale?.addEventListener("input", () => {
    const v = parseFloat(scale.value);
    renderer.setRenderScale(v);
    if (scaleValue) scaleValue.textContent = v.toFixed(2);
  });
}
