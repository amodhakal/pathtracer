import { describe, expect, it } from "vitest";
import {
  DEFAULT_IOR,
  flattenedEllipsoids,
  flattenedTriangles,
  MATERIAL_CLEARCOAT,
  MATERIAL_DIFFUSE,
  MATERIAL_EMISSIVE,
  MATERIAL_GGX,
  MATERIAL_GLASS,
  MATERIAL_MIRROR,
  MATERIAL_THINFILM,
} from "../src/constants";

const TRIANGLE_VEC_VALUE_COUNT = 15;
const ELLIPSOID_VEC_VALUE_COUNT = 12;
const NUM_TRIANGLES = 14;
const NUM_ELLIPSOIDS = 7;

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
    const known = [
      MATERIAL_DIFFUSE,
      MATERIAL_MIRROR,
      MATERIAL_GLASS,
      MATERIAL_GGX,
      MATERIAL_EMISSIVE,
      MATERIAL_CLEARCOAT,
      MATERIAL_THINFILM,
    ];
    for (let i = 0; i < NUM_ELLIPSOIDS; i++) {
      const type = flattenedEllipsoids[i * ELLIPSOID_VEC_VALUE_COUNT + 9];
      expect(type).oneOf(known);
    }
  });

  it("includes one ellipsoid per new material type (issue #55)", () => {
    const types: number[] = [];
    for (let i = 0; i < NUM_ELLIPSOIDS; i++) {
      types.push(flattenedEllipsoids[i * ELLIPSOID_VEC_VALUE_COUNT + 9]);
    }
    expect(types).toContain(MATERIAL_GGX);
    expect(types).toContain(MATERIAL_EMISSIVE);
    expect(types).toContain(MATERIAL_CLEARCOAT);
    expect(types).toContain(MATERIAL_THINFILM);
  });

  it("uses physically valid parameters for the new material types", () => {
    const ROUGHNESS_SLOT = 10;
    for (let i = 0; i < NUM_ELLIPSOIDS; i++) {
      const offset = i * ELLIPSOID_VEC_VALUE_COUNT;
      const type = flattenedEllipsoids[offset + 9];
      if (type === MATERIAL_GGX || type === MATERIAL_CLEARCOAT) {
        // y slot is roughness — must be in (0, 1]
        expect(flattenedEllipsoids[offset + ROUGHNESS_SLOT]).toBeGreaterThan(0);
        expect(flattenedEllipsoids[offset + ROUGHNESS_SLOT]).toBeLessThanOrEqual(1);
      }
      if (type === MATERIAL_THINFILM) {
        // y slot is film thickness in nm
        expect(flattenedEllipsoids[offset + ROUGHNESS_SLOT]).toBeGreaterThan(0);
        expect(flattenedEllipsoids[offset + 11]).toBeGreaterThan(1); // film IOR
      }
    }
  });

  it("uses the glass IOR for glass ellipsoids", () => {
    for (let i = 0; i < NUM_ELLIPSOIDS; i++) {
      const offset = i * ELLIPSOID_VEC_VALUE_COUNT;
      const type = flattenedEllipsoids[offset + 9];
      if (type === MATERIAL_GLASS) {
        expect(flattenedEllipsoids[offset + 10]).toBeGreaterThan(1);
      } else if (type === MATERIAL_DIFFUSE || type === MATERIAL_MIRROR) {
        // Issue #55: newer types repurpose the y/z slots (roughness,
        // thickness, ...), so only the legacy types keep IOR semantics.
        expect(flattenedEllipsoids[offset + 10]).toBe(DEFAULT_IOR);
      }
      expect(Number.isFinite(flattenedEllipsoids[offset + 11])).toBe(true);
    }
  });
});
