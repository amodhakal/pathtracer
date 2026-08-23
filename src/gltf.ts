// Issue #53: minimal GLB (binary glTF 2.0) parser — no external dependencies.
//
// Loads the static mesh in public/lion_crushing_a_serpent.glb and converts it
// into a flat triangle soup (9 floats per triangle: v0.xyz, v1.xyz, v2.xyz)
// suitable for uploading into the path tracer's u_Triangles[] uniform.
//
// Scope / accepted approximations (per the issue body):
//   - Only indexed TRIANGLES primitives (mode 4) are consumed.
//   - Node transforms are composed from `matrix` only (the shipped asset uses
//     matrices exclusively; TRS nodes are ignored).
//   - Materials/textures/skins/animations are ignored; the mesh renders with
//     the scene's diffuse material.
//   - The result is uniformly scaled/translated into the unit scene box.

/** Hard cap on converted triangles: the tracer intersects u_Triangles[]
 *  brute-force per bounce, so unbounded meshes would stall the GPU loop.
 *  Triangles are stride-sampled across all primitives to stay under the cap
 *  while keeping the silhouette representative. */
export const MAX_MESH_TRIANGLES = 20_000;

const COMPONENT_TYPE_FLOAT = 5126;
const COMPONENT_TYPE_UNSIGNED_INT = 5125;
const COMPONENT_TYPE_UNSIGNED_SHORT = 5123;

const COMPONENT_SIZES: Record<number, number> = {
  [COMPONENT_TYPE_FLOAT]: 4,
  [COMPONENT_TYPE_UNSIGNED_INT]: 4,
  [COMPONENT_TYPE_UNSIGNED_SHORT]: 2,
};

const TYPE_COMPONENT_COUNTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
};

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
}

interface GltfBufferView {
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

interface GltfJson {
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  meshes?: { primitives: GltfPrimitive[] }[];
  nodes?: GltfNode[];
  scenes?: { nodes?: number[] }[];
}

interface GltfPrimitive {
  attributes: { POSITION?: number };
  indices?: number;
  mode?: number;
}

interface GltfNode {
  children?: number[];
  mesh?: number;
  matrix?: number[];
}

export interface GltfMesh {
  /** Triangle soup: 9 floats per triangle (3 vertices × xyz). */
  positions: Float32Array;
  /** Number of triangles (= positions.length / 9). */
  triangleCount: number;
}

/** Reads one accessor as a flat numeric array. Supports the component
 *  types/types used by the bundled asset (float vec3 positions, uint32
 *  scalar indices); other encodings throw so callers fall back cleanly. */
function readAccessor(
  json: GltfJson,
  binChunk: Uint8Array,
  accessorIndex: number,
): number[] {
  const accessor = json.accessors?.[accessorIndex];
  if (!accessor) throw new Error(`Missing accessor ${accessorIndex}`);
  const components = TYPE_COMPONENT_COUNTS[accessor.type];
  if (!components) throw new Error(`Unsupported accessor type: ${accessor.type}`);

  const componentSize = COMPONENT_SIZES[accessor.componentType];
  if (!componentSize) throw new Error(`Unsupported component type: ${accessor.componentType}`);

  const view = json.bufferViews?.[accessor.bufferView ?? 0];
  if (!view) throw new Error("Accessor has no buffer view");

  const viewStart = view.byteOffset ?? 0;
  const elementSize = componentSize * components;
  const stride = view.byteStride ?? elementSize;
  const start = viewStart + (accessor.byteOffset ?? 0);
  const dataView = new DataView(binChunk.buffer, binChunk.byteOffset + start);

  const out: number[] = [];
  for (let i = 0; i < accessor.count; i++) {
    const base = i * stride;
    for (let c = 0; c < components; c++) {
      const offset = base + c * componentSize;
      switch (accessor.componentType) {
        case COMPONENT_TYPE_FLOAT:
          out.push(dataView.getFloat32(offset, true));
          break;
        case COMPONENT_TYPE_UNSIGNED_INT:
          out.push(dataView.getUint32(offset, true));
          break;
        case COMPONENT_TYPE_UNSIGNED_SHORT:
          out.push(dataView.getUint16(offset, true));
          break;
        default:
          throw new Error("Unreachable");
      }
    }
  }
  return out;
}

/** Composes each mesh node's world matrix (column-major, glTF convention)
 *  by walking the node graph from the scene roots. */
function collectWorldMatrices(json: GltfJson): Map<number, number[]> {
  const nodes = json.nodes ?? [];
  const worldByNode = new Map<number, number[]>();

  const visit = (nodeIndex: number, parent: number[] | null): void => {
    const node = nodes[nodeIndex];
    if (!node) return;
    const local = node.matrix ?? [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const world = parent ? multiplyMatrices(parent, local) : local;
    worldByNode.set(nodeIndex, world);
    for (const child of node.children ?? []) visit(child, world);
  };

  for (const root of json.scenes?.[0]?.nodes ?? []) visit(root, null);
  // Fallback: assets without a scene still get their top-level nodes visited.
  if (worldByNode.size === 0) {
    nodes.forEach((_, i) => visit(i, null));
  }
  return worldByNode;
}

/** 4x4 matrix multiply, both operands column-major arrays of 16. */
function multiplyMatrices(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row] * b[col * 4 + k];
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function transformPoint(m: number[], p: number[]): [number, number, number] {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** Parses a GLB container: 12-byte header, JSON chunk, optional BIN chunk. */
export function parseGlb(buffer: ArrayBuffer): GltfMesh {
  const header = new DataView(buffer, 0, 12);
  const magic = header.getUint32(0, true);
  if (magic !== 0x46546c67) throw new Error("Not a GLB file (bad magic)");
  const totalLength = header.getUint32(8, true);

  let offset = 12;
  let json: GltfJson | null = null;
  let binChunk: Uint8Array | null = null;

  while (offset + 8 <= Math.min(totalLength, buffer.byteLength)) {
    const chunkHeader = new DataView(buffer, offset, 8);
    const chunkLength = chunkHeader.getUint32(0, true);
    const chunkType = chunkHeader.getUint32(4, true);
    offset += 8;
    if (chunkType === 0x4e4f534a) {
      // "JSON"
      const text = new TextDecoder().decode(new Uint8Array(buffer, offset, chunkLength));
      json = JSON.parse(text) as GltfJson;
    } else if (chunkType === 0x004e4942) {
      // "BIN\0"
      binChunk = new Uint8Array(buffer, offset, chunkLength);
    }
    offset += chunkLength;
  }

  if (!json) throw new Error("GLB has no JSON chunk");
  if (!binChunk) throw new Error("GLB has no BIN chunk");

  const worldMatrices = collectWorldMatrices(json);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  // First pass: gather every primitive's transformed triangle soup so the
  // stride sampler below can thin them proportionally across the whole model.
  const soups: Float32Array[] = [];
  let totalTriangles = 0;

  for (const nodeIndex of worldMatrices.keys()) {
    const node = (json.nodes ?? [])[nodeIndex];
    if (node?.mesh === undefined) continue;
    const mesh = json.meshes?.[node.mesh];
    if (!mesh) continue;
    const world = worldMatrices.get(nodeIndex) ?? identity;

    for (const primitive of mesh.primitives) {
      if ((primitive.mode ?? 4) !== 4) continue; // triangles only
      const positionAccessor = primitive.attributes.POSITION;
      if (positionAccessor === undefined || primitive.indices === undefined) continue;

      const verts = readAccessor(json, binChunk, positionAccessor);
      const indices = readAccessor(json, binChunk, primitive.indices);
      const soup = new Float32Array(indices.length * 3);
      for (let i = 0; i < indices.length; i++) {
        const vi = indices[i] * 3;
        const [x, y, z] = transformPoint(world, [verts[vi], verts[vi + 1], verts[vi + 2]]);
        soup[i * 3] = x;
        soup[i * 3 + 1] = y;
        soup[i * 3 + 2] = z;
      }
      soups.push(soup);
      totalTriangles += soup.length / 9;
    }
  }

  if (totalTriangles === 0) throw new Error("No triangle primitives found in GLB");

  // Stride-sample when over budget, spreading the reduction evenly across
  // primitives so no sub-mesh disappears entirely.
  const step = Math.max(1, Math.ceil(totalTriangles / MAX_MESH_TRIANGLES));
  const chunks: Float32Array[] = [];
  let keptTriangles = 0;
  for (const soup of soups) {
    const primTriangles = soup.length / 9;
    for (let t = 0; t < primTriangles; t += step) {
      chunks.push(soup.subarray(t * 9, t * 9 + 9));
      keptTriangles++;
    }
  }

  const positions = new Float32Array(keptTriangles * 9);
  let cursor = 0;
  for (const chunk of chunks) {
    positions.set(chunk, cursor);
    cursor += chunk.length;
  }

  return normalizeToUnitBox(positions, keptTriangles);
}

/** Uniformly scales/translates the soup so it fits inside the unit box with
 *  its base resting near y=0 and center at x=z=0.5 — the coordinate frame
 *  the Cornell-box scene (camera, light, walls) expects. */
function normalizeToUnitBox(positions: Float32Array, triangleCount: number): GltfMesh {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }

  const extentX = maxX - minX;
  const extentY = maxY - minY;
  const extentZ = maxZ - minZ;
  const largestExtent = Math.max(extentX, extentY, extentZ, 1e-6);
  const scale = 0.9 / largestExtent; // 90% of the unit box

  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;

  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = (positions[i] - centerX) * scale + 0.5;
    positions[i + 1] = (positions[i + 1] - minY) * scale;
    positions[i + 2] = (positions[i + 2] - centerZ) * scale + 0.5;
  }

  return { positions, triangleCount };
}
