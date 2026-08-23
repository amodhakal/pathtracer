// Issue #53: fetch + cache the GLB asset and expose it as a flat triangle
// soup for the path tracer. Kept separate from the pure parser (gltf.ts) so
// the parsing logic stays unit-testable without network/DOM.
import { parseGlb, type GltfMesh } from "./gltf";

export interface TriangleSoup {
  positions: Float32Array;
  triangleCount: number;
}

export async function loadGltfTriangles(url: string): Promise<TriangleSoup> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const mesh: GltfMesh = parseGlb(buffer);
  return { positions: mesh.positions, triangleCount: mesh.triangleCount };
}

// Must match TRIANGLE_VECTORS (= 8) in src/shaders/chunks/common.glsl:
// 3 vertices + normal + color + 2 packed UV slots + texture ids = 8 vec3/vec4
// slots = 24 floats per triangle.
const TRIANGLE_VEC_VALUE_COUNT = 24;
const NO_TEXTURE = -1;

/** Converts a raw triangle soup into the flattened scene-triangle buffer the
 *  shader expects (same layout as constants.ts's flattenedTriangles):
 *  slots 0-2 vertices, slot 3 face normal (computed geometrically), slot 4
 *  diffuse color, slots 5-6 default UVs + "no texture" ids. */
export function flattenSoup(soup: TriangleSoup): Float32Array {
  const out = new Float32Array(soup.triangleCount * TRIANGLE_VEC_VALUE_COUNT);
  for (let t = 0; t < soup.triangleCount; t++) {
    const src = t * 9;
    const dst = t * TRIANGLE_VEC_VALUE_COUNT;

    const ax = soup.positions[src];
    const ay = soup.positions[src + 1];
    const az = soup.positions[src + 2];
    const bx = soup.positions[src + 3];
    const by = soup.positions[src + 4];
    const bz = soup.positions[src + 5];
    const cx = soup.positions[src + 6];
    const cy = soup.positions[src + 7];
    const cz = soup.positions[src + 8];

    // Face normal via cross product of edges, normalized (degenerate
    // triangles keep a zero normal rather than NaN).
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-12) {
      nx /= len;
      ny /= len;
      nz /= len;
    } else {
      nx = ny = nz = 0;
    }

    out.set([ax, ay, az], dst);
    out.set([bx, by, bz], dst + 3);
    out.set([cx, cy, cz], dst + 6);
    out.set([nx, ny, nz], dst + 9);
    out.set([0.75, 0.7, 0.65], dst + 12); // stone-ish diffuse color
    // Slot 5 = vec4(uv1.xy, uv2.xy); slot 6 = vec4(uv3.xy, texIdA, texIdB).
    out.set([0, 0, 1, 0, 0, 1, NO_TEXTURE, NO_TEXTURE], dst + 15);
  }
  return out;
}
