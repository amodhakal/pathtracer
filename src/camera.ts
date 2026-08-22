// Issue #52: interactive orbit/pan/zoom camera.
//
// Pure math module — no WebGL dependencies — so the orbit/pan/zoom logic
// is unit-testable. The Renderer owns the CameraState and uploads the
// computed eye position + basis vectors as uniforms each time the camera
// moves (accumulation resets then).

export interface CameraState {
  /** Orbit focus point (look-at target), world space. */
  target: [number, number, number];
  /** Distance from target to eye along the view axis. */
  distance: number;
  /** Azimuth angle around the world up axis, radians. */
  yaw: number;
  /** Elevation angle above/below the horizon, clamped, radians. */
  pitch: number;
}

/**
 * Vertical field of view in degrees, shared by both render modes via
 * CAMERA_VERTICAL_FOV_DEG in shaders/chunks/common.glsl (#21). Preserving
 * this value keeps the interactive camera's framing identical to the
 * pre-#52 fixed camera.
 */
export const CAMERA_FOV_DEGREES = 102.6802609247;

const WORLD_UP: readonly [number, number, number] = [0, 1, 0];

/** Default orbit distance used to seed the initial camera state. */
const INITIAL_DISTANCE = 2;

export function makeInitialCameraState(eye: readonly number[] | ArrayLike<number>): CameraState {
  // The legacy fixed camera sat at `eye` looking straight down +Z with the
  // world axes as its basis (see generateCameraRay in common.glsl). Seeding
  // the orbit state as yaw=0 / pitch=0 with the target directly ahead makes
  // computeCameraBasis reproduce that exact initial view.
  return {
    target: [eye[0], eye[1], eye[2] + INITIAL_DISTANCE],
    distance: INITIAL_DISTANCE,
    yaw: 0,
    pitch: 0,
  };
}

export interface CameraBasis {
  eye: [number, number, number];
  /** Unit vector pointing from eye toward target. */
  forward: [number, number, number];
  /** Unit right vector of the camera (screen +x). */
  right: [number, number, number];
  /** Unit up vector of the camera (screen +y). */
  up: [number, number, number];
}

/**
 * Spherical-orbit look-at: eye sits at yaw/pitch around the target at
 * `distance`. Pitch is clamped by the caller to avoid gimbal flip.
 */
export function computeCameraBasis(state: CameraState): CameraBasis {
  const cosPitch = Math.cos(state.pitch);
  const ex =
    state.target[0] + state.distance * Math.sin(state.yaw) * cosPitch;
  const ey =
    state.target[1] + state.distance * Math.sin(state.pitch);
  const ez =
    state.target[2] + state.distance * Math.cos(state.yaw) * cosPitch;

  let fx = state.target[0] - ex;
  let fy = state.target[1] - ey;
  let fz = state.target[2] - ez;
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl;
  fy /= fl;
  fz /= fl;

  // right = normalize(cross(forward, worldUp))
  let rx = fy * WORLD_UP[2] - fz * WORLD_UP[1];
  let ry = fz * WORLD_UP[0] - fx * WORLD_UP[2];
  let rz = fx * WORLD_UP[1] - fy * WORLD_UP[0];
  const rl = Math.hypot(rx, ry, rz);
  rx /= rl;
  ry /= rl;
  rz /= rl;

  // up = normalize(cross(right, forward))
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;
  const ul = Math.hypot(ux, uy, uz);

  return {
    eye: [ex, ey, ez],
    forward: [fx, fy, fz],
    right: [rx, ry, rz],
    up: [ux / ul, uy / ul, uz / ul],
  };
}

/**
 * Rotate the camera around the target. dx/dy are drag deltas in pixels;
 * ORBIT_SENSITIVITY converts them to radians.
 */
export const ORBIT_SENSITIVITY = 0.008;

export function orbit(state: CameraState, dxPixels: number, dyPixels: number): void {
  state.yaw += dxPixels * ORBIT_SENSITIVITY;
  // Clamp pitch to ±89° so "up" never degenerates at the poles.
  state.pitch = clamp(
    state.pitch + dyPixels * ORBIT_SENSITIVITY,
    -Math.PI / 2 + 0.02,
    Math.PI / 2 - 0.02,
  );
}

/**
 * Translate the target (and eye with it) in the camera's screen plane.
 * Panning speed scales with distance so zoomed-in pans feel proportional.
 */
export function pan(
  state: CameraState,
  basis: CameraBasis,
  dxPixels: number,
  dyPixels: number,
  viewportHeightPx: number,
): void {
  // World units per screen pixel at the target's depth, matching the
  // shader's pinhole convention (vertical FOV spans `distance * fovScale`).
  const fovScale =
    2 * state.distance * Math.tan((CAMERA_FOV_DEGREES * Math.PI) / 360);
  const unitsPerPixel = fovScale / Math.max(1, viewportHeightPx);
  for (let i = 0; i < 3; i++) {
    state.target[i] +=
      -dxPixels * unitsPerPixel * basis.right[i] +
      dyPixels * unitsPerPixel * basis.up[i];
  }
}

/** Dolly toward/away from the target. Positive deltaY (wheel down) zooms out. */
export const ZOOM_FACTOR = 1.1;

export function zoom(state: CameraState, deltaY: number): void {
  const factor = deltaY > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
  state.distance = clamp(
    state.distance * factor,
    MIN_DISTANCE,
    MAX_DISTANCE,
  );
}

export const MIN_DISTANCE = 0.05;
export const MAX_DISTANCE = 50;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
