// Issue #47: numeric spot-check that BVH traversal returns the same closest
// hit as brute-force intersection, and that the built tree is well-formed.
// Pure TypeScript — mirrors the GLSL logic in chunks/bvh.glsl + bvh.ts layout.
import { describe, expect, it } from "vitest";
import {
  flattenedBvhNodes,
  flattenedBvhPrimIndices,
  bvhNodeCount,
  triangleCount,
  primitiveCount,
  readFlatNode,
  TRIANGLE_VEC_VALUE_COUNT,
  ELLIPSOID_VEC_VALUE_COUNT,
} from "../src/bvh";
import { flattenedTriangles, flattenedEllipsoids } from "../src/constants";

// Deterministic LCG so the spot-check is reproducible.
function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    // Numerical Recipes LCG constants
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function nodeAt(i: number) {
  return readFlatNode(flattenedBvhNodes, i);
}

function triangleAt(i: number): number[] {
  const o = i * TRIANGLE_VEC_VALUE_COUNT;
  return Array.from(flattenedTriangles.slice(o, o + 9)); // vertices only
}

function ellipsoidAt(i: number): { c: number[]; r: number[] } {
  const o = i * ELLIPSOID_VEC_VALUE_COUNT;
  return {
    c: Array.from(flattenedEllipsoids.slice(o, o + 3)),
    r: Array.from(flattenedEllipsoids.slice(o + 3, o + 6)),
  };
}

function rayTriangle(
  origin: number[],
  dir: number[],
  tri: number[]
): number | null {
  const [v0, v1, v2] = [tri.slice(0, 3), tri.slice(3, 6), tri.slice(6, 9)];
  const e1 = v1.map((x, i) => x - v0[i]!);
  const e2 = v2.map((x, i) => x - v0[i]!);
  const orth = cross(dir, e2);
  const det = dot(e1, orth);
  if (Math.abs(det) < 1e-5) return null;
  const inv = 1 / det;
  const pToV = origin.map((x, i) => x - v0[i]!);
  const u = dot(pToV, orth) * inv;
  if (u < 0 || u > 1) return null;
  const cv = cross(pToV, e1);
  const v = dot(dir, cv) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = dot(e2, cv) * inv;
  if (t < 1e-5) return null;
  return t;
}

function rayEllipsoid(
  origin: number[],
  dir: number[],
  ell: { c: number[]; r: number[] }
): number | null {
  const d = dir.map((x, i) => x / ell.r[i]!);
  const s = origin.map((x, i) => (x - ell.c[i]!) / ell.r[i]!);
  const a = dot(d, d);
  const halfB = 0.5 * dot(d, s);
  const c = dot(s, s) - 1;
  const disc = halfB * halfB - a * c;
  if (disc < 0) return null;
  const sqrtD = Math.sqrt(disc);
  const q = halfB > 0 ? -(halfB + sqrtD) : -(halfB - sqrtD);
  const roots = [q / a, c / q].sort((x, y) => x - y);
  for (const root of roots) {
    if (root >= 1e-5) return root;
  }
  return null;
}

function cross(a: number[], b: number[]): number[] {
  return [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
}
function dot(a: number[], b: number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}

/** Brute-force closest-hit distance over all primitives. */
function bruteForceClosest(origin: number[], dir: number[]): number | null {
  let best: number | null = null;
  for (let i = 0; i < triangleCount; i++) {
    const t = rayTriangle(origin, dir, triangleAt(i));
    if (t !== null && (best === null || t < best)) best = t;
  }
  for (let i = 0; i < primitiveCount - triangleCount; i++) {
    const t = rayEllipsoid(origin, dir, ellipsoidAt(i));
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

function rayAabb(
  origin: number[],
  invDir: number[],
  maxDistance: number,
  min: number[],
  max: number[]
): boolean {
  let tNear = -Infinity;
  let tFar = Infinity;
  for (let a = 0; a < 3; a++) {
    const t0 = (min[a]! - origin[a]!) * invDir[a]!;
    const t1 = (max[a]! - origin[a]!) * invDir[a]!;
    tNear = Math.max(tNear, Math.min(t0, t1));
    tFar = Math.min(tFar, Math.max(t0, t1));
  }
  return tNear <= tFar && tFar > 0 && tNear < maxDistance;
}

/** Mirrors bvhClosestPrimitive in chunks/bvh.glsl. */
function bvhClosestDistance(origin: number[], dir: number[]): number | null {
  const invDir = dir.map((x) => 1 / x);
  let closest: number | null = null;
  const stack = [0];
  while (stack.length > 0) {
    const ni = stack.pop()!;
    const node = nodeAt(ni);
    const bound =
      closest === null ? Number.MAX_VALUE : closest;
    if (!rayAabb(origin, invDir, bound, node.min, node.max)) continue;
    if (node.primCount > 0) {
      for (let i = 0; i < node.primCount; i++) {
        const primIndex = flattenedBvhPrimIndices[node.primStart + i]!;
        let t: number | null;
        if (primIndex < triangleCount) {
          t = rayTriangle(origin, dir, triangleAt(primIndex));
        } else {
          t = rayEllipsoid(
            origin,
            dir,
            ellipsoidAt(primIndex - triangleCount)
          );
        }
        if (t !== null && (closest === null || t < closest)) closest = t;
      }
    } else {
      stack.push(2 * ni + 1, 2 * ni + 2);
    }
  }
  return closest;
}

describe("BVH build (#47)", () => {
  it("covers every primitive exactly once in the leaf permutation", () => {
    expect(flattenedBvhPrimIndices.length).toBe(primitiveCount);
    const seen = new Set(flattenedBvhPrimIndices);
    expect(seen.size).toBe(primitiveCount);
  });

  it("produces leaves with valid prim ranges", () => {
    let leafPrims = 0;
    for (let i = 0; i < bvhNodeCount; i++) {
      const n = nodeAt(i);
      if (n.primCount > 0) {
        expect(n.primStart).toBeGreaterThanOrEqual(0);
        expect(n.primStart + n.primCount).toBeLessThanOrEqual(primitiveCount);
        leafPrims += n.primCount;
      }
    }
    expect(leafPrims).toBe(primitiveCount);
  });
});

describe("BVH vs brute-force equivalence (#47)", () => {
  it("agrees on closest-hit hit/miss over seeded rays", () => {
    const rng = makeRng(20260822);
    const rays = 500;
    let hits = 0;
    for (let i = 0; i < rays; i++) {
      const origin = [rng(), rng(), -0.5 + 1.5 * rng()];
      const target = [-0.5 + 2 * rng(), -0.5 + 2 * rng(), -1 + 2 * rng()];
      const dir = target.map((x, a) => x - origin[a]!);
      const len = Math.hypot(...dir);
      const normalized = dir.map((x) => x / len);

      const brute = bruteForceClosest(origin, normalized);
      const bvh = bvhClosestDistance(origin, normalized);

      if (brute !== null) hits++;
      if (brute === null) {
        expect(bvh).toBeNull();
      } else {
        expect(bvh).not.toBeNull();
        // Same primitive wins up to float tolerance.
        expect(Math.abs(bvh! - brute)).toBeLessThan(1e-4 * Math.max(1, brute));
      }
    }
    // Sanity: the seeded ray set must exercise actual geometry.
    expect(hits).toBeGreaterThan(rays / 10);
  });

  it("matches on shadow-ray occlusion queries toward the light", () => {
    const rng = makeRng(42);
    const lightPos = [0.5, 0.96, 0.0];
    function occludedBrute(origin: number[], dir: number[], maxDist: number) {
      for (let i = 0; i < triangleCount; i++) {
        const t = rayTriangle(origin, dir, triangleAt(i));
        if (t !== null && t < maxDist) return true;
      }
      for (let i = 0; i < primitiveCount - triangleCount; i++) {
        const t = rayEllipsoid(origin, dir, ellipsoidAt(i));
        if (t !== null && t < maxDist) return true;
      }
      return false;
    }
    function occludedBvh(origin: number[], dir: number[], maxDist: number) {
      const invDir = dir.map((x) => 1 / x);
      const stack = [0];
      while (stack.length > 0) {
        const ni = stack.pop()!;
        const node = nodeAt(ni);
        if (!rayAabb(origin, invDir, maxDist, node.min, node.max)) continue;
        if (node.primCount > 0) {
          for (let i = 0; i < node.primCount; i++) {
            const pi = flattenedBvhPrimIndices[node.primStart + i]!;
            let t: number | null;
            if (pi < triangleCount) {
              t = rayTriangle(origin, dir, triangleAt(pi));
            } else {
              t = rayEllipsoid(origin, dir, ellipsoidAt(pi - triangleCount));
            }
            if (t !== null && t < maxDist) return true;
          }
        } else {
          stack.push(2 * ni + 1, 2 * ni + 2);
        }
      }
      return false;
    }

    let agreements = 0;
    for (let i = 0; i < 300; i++) {
      const origin = [rng(), 0.05 + 0.9 * rng(), -0.5 + rng()];
      const toLight = lightPos.map((x, a) => x - origin[a]!);
      const dist = Math.hypot(...toLight);
      const dir = toLight.map((x) => x / dist);
      const maxDist = dist - 0.001;
      const brute = occludedBrute(origin, dir, maxDist);
      const bvh = occludedBvh(origin, dir, maxDist);
      expect(bvh).toBe(brute);
      if (brute) agreements++;
    }
    expect(agreements).toBeGreaterThan(0);
  });
});
