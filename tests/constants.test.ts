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
  // Issue #64: participating media.
  MATERIAL_VOLUME,
  SCENE_ELLIPSOID_COUNT,
  SCENE_ELLIPSOID_VECTORS,
  SCENE_TRIANGLE_COUNT,
  SCENE_TRIANGLE_VECTORS,
  generateSceneDefines,
} from "../src/constants";

// Issue #40: buffer sizes are derived from the same metadata that feeds the
// shader defines, so these tests no longer hardcode duplicate counts.
const TRIANGLE_VEC_VALUE_COUNT = SCENE_TRIANGLE_VECTORS * 3;
const ELLIPSOID_VEC_VALUE_COUNT = SCENE_ELLIPSOID_VECTORS * 3;
const NUM_TRIANGLES = SCENE_TRIANGLE_COUNT;
const NUM_ELLIPSOIDS = SCENE_ELLIPSOID_COUNT;

describe("scene/shader metadata consistency (issue #40)", () => {
  it("derives shader defines from the actual scene object counts", () => {
    const defines = generateSceneDefines();
    expect(defines.TRIANGLE_COUNT).toBe(NUM_TRIANGLES);
    expect(defines.TRIANGLE_VECTORS).toBe(SCENE_TRIANGLE_VECTORS);
    expect(defines.ELLIPSOID_COUNT).toBe(NUM_ELLIPSOIDS);
    expect(defines.ELLIPSOID_VECTORS).toBe(SCENE_ELLIPSOID_VECTORS);
    expect(defines.TRIANGLE_COUNT).toBeGreaterThan(0);
    expect(defines.ELLIPSOID_COUNT).toBeGreaterThan(0);
  });

  it("sizes flattened buffers from the exported scene metadata", () => {
    expect(flattenedTriangles.length).toBe(NUM_TRIANGLES * TRIANGLE_VEC_VALUE_COUNT);
    expect(flattenedEllipsoids.length).toBe(NUM_ELLIPSOIDS * ELLIPSOID_VEC_VALUE_COUNT);
  });
});

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
      MATERIAL_VOLUME,
    ];
    for (let i = 0; i < NUM_ELLIPSOIDS; i++) {
      const type = flattenedEllipsoids[i * ELLIPSOID_VEC_VALUE_COUNT + 9];
      // vitest 4 removed expect().oneOf; use toContain on the known set.
      expect(known).toContain(type);
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

  // Issue #64: volumetrics / participating media scene option.
  it("exposes a volumetrics scene option that defaults to disabled", async () => {
    const { volumetrics, MATERIAL_VOLUME } = await import("../src/constants");
    // Density 0 => the shader skips the medium branch entirely, keeping
    // non-volume scenes bit-identical to the surface-only integrator.
    expect(volumetrics.density).toBe(0);
    expect(volumetrics.scatterAlbedo).toBeGreaterThanOrEqual(0);
    expect(volumetrics.scatterAlbedo).toBeLessThanOrEqual(1);
    expect(Math.abs(volumetrics.anisotropy)).toBeLessThan(1);
    expect(volumetrics.color).toHaveLength(3);
    expect(volumetrics.emission).toHaveLength(3);
    expect(MATERIAL_VOLUME).toBe(7);
  });

  it("encodes the bounded volume ellipsoid with a positive density (#64)", async () => {
    const { MATERIAL_VOLUME } = await import("../src/constants");
    let volumeCount = 0;
    for (let i = 0; i < NUM_ELLIPSOIDS; i++) {
      const offset = i * ELLIPSOID_VEC_VALUE_COUNT;
      if (flattenedEllipsoids[offset + 9] !== MATERIAL_VOLUME) continue;
      volumeCount++;
      // y = sigma_t must be positive, z = scattering albedo in [0, 1].
      expect(flattenedEllipsoids[offset + 10]).toBeGreaterThan(0);
      expect(flattenedEllipsoids[offset + 11]).toBeGreaterThanOrEqual(0);
      expect(flattenedEllipsoids[offset + 11]).toBeLessThanOrEqual(1);
    }
    expect(volumeCount).toBeGreaterThan(0);
  });
});
