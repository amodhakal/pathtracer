// Issue #47: BVH acceleration structure built on the CPU from the flattened
// scene arrays, uploaded to the GPU as uniform arrays and traversed in
// chunks/bvh.glsl. Replaces the brute-force loops over all triangles and
// ellipsoids in findClosestIntersect and the shadow-ray any-hit loops.
//
// Node layout mirrors the existing uniform packing style (contiguous vec3
// slots per node):
//   slot 0: bounds min (xyz)
//   slot 1: bounds max (xyz)
//   slot 2: (primStart, primCount, unused)
// Children are implicit: left = 2*i + 1, right = 2*i + 2 (heap layout).
// Leaves have primCount > 0; interior nodes have primCount == 0. primStart
// indexes flattenedBvhPrimIndices, a permutation over the combined primitive
// list [0..triangleCount) = triangles, [triangleCount..primitiveCount).
import { flattenedTriangles, flattenedEllipsoids } from "./constants";

export const TRIANGLE_VEC_VALUE_COUNT = 24; // must match constants.ts stride
export const ELLIPSOID_VEC_VALUE_COUNT = 12;
export const BVH_NODE_VEC_SLOTS = 3;

export const triangleCount = flattenedTriangles.length / TRIANGLE_VEC_VALUE_COUNT;
export const ellipsoidCount = flattenedEllipsoids.length / ELLIPSOID_VEC_VALUE_COUNT;
export const primitiveCount = triangleCount + ellipsoidCount;

interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

interface Primitive {
  index: number; // index within its own primitive array
  isTriangle: boolean;
  bounds: Bounds;
  centroid: [number, number, number];
}

interface BvhNode {
  bounds: Bounds;
  primStart: number; // -1 for interior nodes
  primCount: number; // 0 = interior, > 0 = leaf
}

function triangleBounds(i: number): { bounds: Bounds; centroid: [number, number, number] } {
  const o = i * TRIANGLE_VEC_VALUE_COUNT;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const centroid: [number, number, number] = [0, 0, 0];
  for (let v = 0; v < 3; v++) {
    for (let a = 0; a < 3; a++) {
      const val = flattenedTriangles[o + v * 3 + a];
      min[a] = Math.min(min[a], val);
      max[a] = Math.max(max[a], val);
      centroid[a] += val / 3;
    }
  }
  return { bounds: { min, max }, centroid };
}

function ellipsoidBounds(i: number): { bounds: Bounds; centroid: [number, number, number] } {
  const o = i * ELLIPSOID_VEC_VALUE_COUNT;
  const c: [number, number, number] = [
    flattenedEllipsoids[o],
    flattenedEllipsoids[o + 1],
    flattenedEllipsoids[o + 2],
  ];
  const r: [number, number, number] = [
    flattenedEllipsoids[o + 3],
    flattenedEllipsoids[o + 4],
    flattenedEllipsoids[o + 5],
  ];
  return {
    bounds: { min: [c[0] - r[0], c[1] - r[1], c[2] - r[2]], max: [c[0] + r[0], c[1] + r[1], c[2] + r[2]] },
    centroid: c,
  };
}

const primitives: Primitive[] = [];
for (let i = 0; i < triangleCount; i++) {
  const b = triangleBounds(i);
  primitives.push({ index: i, isTriangle: true, ...b });
}
for (let i = 0; i < ellipsoidCount; i++) {
  const b = ellipsoidBounds(i);
  primitives.push({ index: i, isTriangle: false, ...b });
}

function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

export const bvhPrimIndices: number[] = [];
const nodes: BvhNode[] = [];
let primStartCounter = 0;

function ensureNode(index: number): BvhNode {
  while (nodes.length <= index) {
    nodes.push({ bounds: { min: [0, 0, 0], max: [0, 0, 0] }, primStart: -1, primCount: 0 });
  }
  return nodes[index]!;
}

function build(primIndices: number[], depth: number, nodeIndex: number): void {
  let bounds = primitives[primIndices[0]!]!.bounds;
  const centroidMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const centroidMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const pi of primIndices) {
    const p = primitives[pi]!;
    bounds = unionBounds(bounds, p.bounds);
    for (let a = 0; a < 3; a++) {
      centroidMin[a] = Math.min(centroidMin[a], p.centroid[a]);
      centroidMax[a] = Math.max(centroidMax[a], p.centroid[a]);
    }
  }

  const node = ensureNode(nodeIndex);
  node.bounds = bounds;

  if (primIndices.length <= 2 || depth >= 32) {
    node.primStart = primStartCounter;
    node.primCount = primIndices.length;
    for (const pi of primIndices) {
      bvhPrimIndices.push(pi);
    }
    primStartCounter += primIndices.length;
    return;
  }

  // Split along the widest centroid axis at the median.
  let axis = 0;
  let extent = -1;
  for (let a = 0; a < 3; a++) {
    const e = centroidMax[a]! - centroidMin[a]!;
    if (e > extent) {
      extent = e;
      axis = a;
    }
  }
  const sorted = [...primIndices].sort(
    (x, y) => primitives[x]!.centroid[axis]! - primitives[y]!.centroid[axis]!
  );
  const mid = sorted.length >> 1;

  // Allocate both child slots BEFORE recursing so heap layout holds.
  ensureNode(2 * nodeIndex + 2);
  build(sorted.slice(0, mid), depth + 1, 2 * nodeIndex + 1);
  build(sorted.slice(mid), depth + 1, 2 * nodeIndex + 2);
}

if (primitiveCount > 0) {
  build(
    primitives.map((_, i) => i),
    0,
    0
  );
}

export const bvhNodeCount = nodes.length;
export const flattenedBvhNodes = new Float32Array(bvhNodeCount * BVH_NODE_VEC_SLOTS * 3);
for (let i = 0; i < bvhNodeCount; i++) {
  const n = nodes[i]!;
  const o = i * BVH_NODE_VEC_SLOTS * 3;
  flattenedBvhNodes.set(n.bounds.min, o);
  flattenedBvhNodes.set(n.bounds.max, o + 3);
  flattenedBvhNodes[o + 6] = n.primStart;
  flattenedBvhNodes[o + 7] = n.primCount;
  flattenedBvhNodes[o + 8] = 0;
}

export const flattenedBvhPrimIndices = new Float32Array(bvhPrimIndices);

/** Test helper: reconstruct a node's fields from the flat GPU layout. */
export function readFlatNode(flat: Float32Array, i: number) {
  const o = i * BVH_NODE_VEC_SLOTS * 3;
  return {
    min: [flat[o], flat[o + 1], flat[o + 2]],
    max: [flat[o + 3], flat[o + 4], flat[o + 5]],
    primStart: flat[o + 6],
    primCount: flat[o + 7],
  };
}
