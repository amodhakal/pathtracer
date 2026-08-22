import { describe, expect, it } from "vitest";
import {
  DEFAULT_IOR,
  DEFAULT_OPACITY,
  flattenedEllipsoids,
  flattenedTriangles,
  MATERIAL_DIFFUSE,
  MATERIAL_GLASS,
  MATERIAL_MIRROR,
} from "../src/constants";

const TRIANGLE_VEC_VALUE_COUNT = 15;
const ELLIPSOID_VEC_VALUE_COUNT = 12;
const NUM_TRIANGLES = 14;
const NUM_ELLIPSOIDS = 3;

describe("constants / scene data", () => {
  it("flattens triangles into a correctly sized buffer", () => {
    expect(flattenedTriangles.length).toBe(NUM_TRIANGLES * TRIANGLE_VEC_VALUE_COUNT);
  });

  it("flattens ellipsoids into a correctly sized buffer", () => {
    expect(flattenedEllipsoids.length).toBe(NUM_ELLIPSOIDS * ELLIPSOID_VEC_VALUE_COUNT);
  });

  it("contains only finite values in the scene buffers", () => {
    for (const value of flattenedTriangles) {
      expect(Number.isFinite(value)).toBe(true);
    }
    for (const value of flattenedEllipsoids) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("encodes ellipsoid materials with a known material type", () => {
    const known = [MATERIAL_DIFFUSE, MATERIAL_MIRROR, MATERIAL_GLASS];
    for (let i = 0; i < NUM_ELLIPSOIDS; i++) {
      const type = flattenedEllipsoids[i * ELLIPSOID_VEC_VALUE_COUNT + 9];
      expect(type).oneOf(known);
    }
  });

  it("uses the glass IOR for glass ellipsoids", () => {
    for (let i = 0; i < NUM_ELLIPSOIDS; i++) {
      const offset = i * ELLIPSOID_VEC_VALUE_COUNT;
      if (flattenedEllipsoids[offset + 9] === MATERIAL_GLASS) {
        expect(flattenedEllipsoids[offset + 10]).toBeGreaterThan(1);
      } else {
        expect(flattenedEllipsoids[offset + 10]).toBe(DEFAULT_IOR);
      }
      expect(flattenedEllipsoids[offset + 11]).toBeGreaterThanOrEqual(DEFAULT_OPACITY);
    }
  });
});
