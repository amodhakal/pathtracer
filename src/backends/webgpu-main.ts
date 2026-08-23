import type { FrameState } from "./backend";
import { WebGPURenderBackend } from "./webgpu-backend";

/**
 * Driver loop for the WebGPU path tracer (issue #63).
 *
 * Owns the page when selected via ?backend=webgpu. Sizes the canvas, drives
 * the backend's progressive accumulation (one renderFrame() per animation
 * frame, ping-ponging the accumulation textures until FRAME_COUNT converges),
 * and resets accumulation on resize via the backend's resize() hook. Camera
 * controls are wired through the backend so orbit/pan/zoom restart accumulation.
 */
export async function startWebGPUBackend(canvas: HTMLCanvasElement): Promise<void> {
  const backend = new WebGPURenderBackend(canvas);
  await backend.init();
  backend.attachCameraControls();

  console.info("[wt] Using WebGPU backend (WGSL path tracer)");

  const state: FrameState = { width: canvas.width, height: canvas.height };

  function syncSize(): boolean {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    if (canvas.width === width && canvas.height === height) return false;
    canvas.width = width;
    canvas.height = height;
    state.width = width;
    state.height = height;
    backend.resize(width, height);
    return true;
  }

  syncSize();

  function frame(): void {
    syncSize();
    backend.renderFrame(state);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  new ResizeObserver(syncSize).observe(canvas);

  // The WebGPU backend now owns rendering; callers should not continue into
  // the WebGL2 setup path.
  await new Promise<void>(() => {
    /* never resolves — backend owns the frame loop */
  });
}
