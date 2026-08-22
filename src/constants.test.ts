import { describe, expect, it } from "vitest";
import {
  flattenedEllipsoids,
  flattenedTriangles,
  vertices,
  eye,
  light,
  time,
} from "./constants";

const TRIANGLE_VEC_VALUE_COUNT = 15;
const ELLIPSOID_VEC_VALUE_COUNT = 12;
const NUM_TRIANGLES = 14;
const NUM_ELLIPSOIDS = 3;

describe("flattenedTriangles", () => {
  it("has the right size for the scene's triangles", () => {
    expect(flattenedTriangles.length).toBe(
      NUM_TRIANGLES * TRIANGLE_VEC_VALUE_COUNT
    );
  });

  it("contains only finite float values", () => {
    for (const v of flattenedTriangles) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("flattenedEllipsoids", () => {
  it("has the right size for the scene's ellipsoids", () => {
    expect(flattenedEllipsoids.length).toBe(
      NUM_ELLIPSOIDS * ELLIPSOID_VEC_VALUE_COUNT
    );
  });

  it("stores radii as positive values", () => {
    for (let e = 0; e < NUM_ELLIPSOIDS; e++) {
      const offset = e * ELLIPSOID_VEC_VALUE_COUNT + 3;
      for (let i = offset; i < offset + 3; i++) {
        expect(flattenedEllipsoids[i]).toBeGreaterThan(0);
      }
    }
  });
});

describe("shared uniforms", () => {
  it("defines a fullscreen quad with two triangles", () => {
    expect(vertices).toEqual(
      new Float32Array([-1, 1, -1, -1, 1, 1, -1, -1, 1, -1, 1, 1])
    );
  });

  it("places the eye at the expected position", () => {
    expect(eye[0]).toBeCloseTo(0.5);
    expect(eye[1]).toBeCloseTo(0.5);
    expect(eye[2]).toBeCloseTo(-0.4);
  });

  it("defines a light with a downward normal and positive size", () => {
    expect(Array.from(light.normal)).toEqual([0, -1, 0]);
    expect(light.size[0]).toBeGreaterThan(0);
    expect(light.size[1]).toBeGreaterThan(0);
  });

  it("captures a timestamp", () => {
    expect(typeof time).toBe("number");
    expect(time).toBeGreaterThan(0);
  });
});
