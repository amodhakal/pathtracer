// Issue #39: main.ts is now a thin entry point — the renderer lives in
// src/renderer.ts, WebGL bootstrap in src/gl-context.ts, program compilation
// in src/programs.ts, quad VAO setup in src/geometry.ts, and float
// textures/ping-pong FBOs in src/framebuffers.ts.
//
// Issue #53: real GLTF mesh rendering. The GLB asset is parsed at startup by
// src/gltf.ts (dependency-free GLB parser) and its triangle soup replaces the
// hardcoded Cornell-box walls as the scene's triangle geometry. If the mesh
// fails to load or parse, we fall back to the original hardcoded scene so the
// app still renders.
import { initGLContext } from "./gl-context";
import { reportError } from "./errors";
import { createPrograms } from "./programs";
import { createQuadVAOs } from "./geometry";
import { Renderer } from "./renderer";
import { startWebGPUBackend } from "./backends/webgpu-main";
import { loadGltfTriangles } from "./gltf-loader";
import type { TriangleSoup } from "./gltf-loader";

const GLB_URL = "/lion_crushing_a_serpent.glb";

/** Issue #53: scene selection. `?scene=procedural` keeps the original
 *  hardcoded Cornell-box geometry; the default (`?scene=gltf`) renders the
 *  bundled GLB mesh. Any load/parse failure also falls back to procedural. */
function gltfSceneRequested(): boolean {
  const scene = new URLSearchParams(window.location.search).get("scene");
  return scene !== "procedural";
}

async function bootstrap(): Promise<void> {
  // Issue #63: backend selection. WebGPU scaffold is opt-in via
  // ?backend=webgpu; WebGL2 remains the default path.
  const requestedBackend = new URLSearchParams(window.location.search).get("backend");
  if (requestedBackend === "webgpu") {
    const canvasEl = document.getElementById("canvas") as HTMLCanvasElement | null;
    if (!canvasEl) throw new Error("#canvas element not found");
    await startWebGPUBackend(canvasEl);
  }

  let triangles: TriangleSoup | null = null;
  if (gltfSceneRequested()) {
    try {
      triangles = await loadGltfTriangles(GLB_URL);
      console.log(`[gltf] loaded ${triangles.triangleCount} triangles from ${GLB_URL}`);
    } catch (err) {
      console.warn("[gltf] mesh unavailable, falling back to procedural scene:", err);
    }
  }

  const { canvas, gl } = initGLContext();
  const programs = createPrograms(gl, triangles?.triangleCount ?? null);
  const geometry = createQuadVAOs(gl, [
    programs.pathtrace,
    programs.local,
    programs.display,
  ]);
  const renderer = new Renderer(canvas, gl, programs, geometry, triangles);
  // Issue #59: wire up the progressive display controls (HUD, pause/resume,
  // save-PNG, render-scale slider) declared in index.html.
  wireProgressiveDisplayControls(renderer);
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

  // Issue #61: next-event estimation toggle. Flipping it resets accumulation
  // so the two integrators are never averaged into one image.
  const neeToggle = document.getElementById("toggle-nee") as HTMLInputElement | null;
  neeToggle?.addEventListener("change", () => {
    renderer.setNextEventEstimation(neeToggle.checked);
  });
}

bootstrap().catch((err) => reportError("Error: " + err));
