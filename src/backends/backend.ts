/**
 * Backend abstraction seam (issue #63).
 *
 * A RenderBackend owns the device context (WebGL2 or WebGPU), its
 * resources, and presents one frame per renderFrame() call. main.ts
 * selects the backend at startup and drives it from a single loop,
 * so future backends plug in without touching the render logic.
 *
 * The full pathtracer port to WebGPU (WGSL shaders, accumulation
 * ping-pong, scene buffers) is deferred; the seam below is the
 * integration contract those ports will implement.
 */

export interface FrameState {
  /** Drawing-buffer width in pixels. */
  width: number;
  /** Drawing-buffer height in pixels. */
  height: number;
}

export interface RenderBackend {
  readonly name: "webgl2" | "webgpu";

  /**
   * Acquire the device/context and build pipelines.
   * May be async for backends that need device negotiation (WebGPU).
   */
  init(): void | Promise<void>;

  /** Handle canvas drawing-buffer resizes. */
  resize(width: number, height: number): void;

  /** Encode and submit one frame. */
  renderFrame(state: FrameState): void;

  /** Release all GPU resources. */
  dispose(): void;
}
