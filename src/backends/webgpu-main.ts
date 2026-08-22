import type { FrameState } from "./backend";
import { WebGPURenderBackend } from "./webgpu-backend";

/**
 * Minimal driver loop for the WebGPU scaffold backend (issue #63).
 *
 * Owns the page when selected via ?backend=webgpu: sizes the canvas,
 * drives renderFrame() per animation frame. The progressive
 * accumulation logic (frame counting, ping-pong) remains WebGL-only
 * until the full tracer port lands.
 */
export async function startWebGPUBackend(canvas: HTMLCanvasElement): Promise<void> {
  const backend = new WebGPURenderBackend(canvas);
  await backend.init();

  console.info("[wt] Using WebGPU backend (scaffold: clear/quad path)");

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

  // The WebGPU backend now owns rendering; callers should not continue
  // into the WebGL2 setup path.
  await new Promise<void>(() => {
    /* never resolves — backend owns the frame loop */
  });
}
