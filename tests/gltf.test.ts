// Issue #53: unit tests for the dependency-free GLB parser and the triangle
// soup -> scene-triangle flattening used to feed u_Triangles[].
import { describe, expect, it } from "vitest";
import { parseGlb } from "../src/gltf";
import { flattenSoup, type TriangleSoup } from "../src/gltf-loader";

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** Builds a minimal in-memory GLB: one mesh node, one indexed TRIANGLES
 *  primitive with float VEC3 positions and uint16 SCALAR indices. */
function buildGlb(positions: number[], indices: number[]): ArrayBuffer {
  const posBytes = new Float32Array(positions).buffer;
  const idxBytes = new Uint16Array(indices).buffer;
  const pad4 = (n: number) => (n + 3) & ~3;

  const posLen = posBytes.byteLength;
  const idxOffset = pad4(posLen);
  const binLen = pad4(idxOffset + idxBytes.byteLength);

  const json = {
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: "VEC3" },
      { bufferView: 1, componentType: 5123, count: indices.length, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posLen },
      { buffer: 0, byteOffset: idxOffset, byteLength: idxBytes.byteLength },
    ],
    buffers: [{ byteLength: binLen }],
  };

  let jsonText = JSON.stringify(json);
  while (jsonText.length % 4 !== 0) jsonText += " ";
  const jsonBytes = new TextEncoder().encode(jsonText);

  const total = 12 + 8 + jsonBytes.byteLength + 8 + binLen;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);

  view.setUint32(12, jsonBytes.byteLength, true);
  view.setUint32(16, CHUNK_JSON, true);
  bytes.set(jsonBytes, 20);

  const binHeader = 20 + jsonBytes.byteLength;
  view.setUint32(binHeader, binLen, true);
  view.setUint32(binHeader + 4, CHUNK_BIN, true);
  const binStart = binHeader + 8;
  bytes.set(new Uint8Array(posBytes), binStart);
  bytes.set(new Uint8Array(idxBytes), binStart + idxOffset);

  return buffer;
}

describe("parseGlb", () => {
  it("parses an indexed triangle primitive into a triangle soup", () => {
    const glb = buildGlb([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]);
    const mesh = parseGlb(glb);

    expect(mesh.triangleCount).toBe(1);
    expect(mesh.positions).toHaveLength(9);
  });

  it("normalizes geometry into the unit scene box", () => {
    // A large, off-origin triangle must be scaled/translated into [0,1]^3.
    const glb = buildGlb([0, 0, 0, 40, 0, 0, 0, 40, 0], [0, 1, 2]);
    const mesh = parseGlb(glb);

    for (let i = 0; i < mesh.positions.length; i += 3) {
      expect(mesh.positions[i]).toBeGreaterThanOrEqual(0);
      expect(mesh.positions[i]).toBeLessThanOrEqual(1);
      expect(mesh.positions[i + 1]).toBeGreaterThanOrEqual(0);
      expect(mesh.positions[i + 1]).toBeLessThanOrEqual(1);
    }
  });

  it("rejects buffers that are not GLB", () => {
    const notGlb = new ArrayBuffer(16);
    expect(() => parseGlb(notGlb)).toThrow(/bad magic/);
  });
});

describe("flattenSoup", () => {
  const soup: TriangleSoup = {
    // Unit triangle in the XY plane -> +Z face normal.
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    triangleCount: 1,
  };

  it("emits 24 floats per triangle matching TRIANGLE_VECTORS=8", () => {
    expect(flattenSoup(soup)).toHaveLength(24);
  });

  it("copies the three vertices into slots 0-2", () => {
    const flat = flattenSoup(soup);
    expect(Array.from(flat.slice(0, 9))).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it("computes a normalized geometric face normal in slot 3", () => {
    const flat = flattenSoup(soup);
    const [nx, ny, nz] = Array.from(flat.slice(9, 12));
    expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 6);
    expect(Math.abs(nz)).toBeCloseTo(1, 6);
  });

  it("keeps a zero normal for degenerate triangles instead of NaN", () => {
    const degenerate: TriangleSoup = {
      positions: new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]),
      triangleCount: 1,
    };
    const flat = flattenSoup(degenerate);
    expect(Array.from(flat.slice(9, 12))).toEqual([0, 0, 0]);
    expect(Array.from(flat.slice(9, 12)).some(Number.isNaN)).toBe(false);
  });

  it("marks triangles as untextured (-1 texture ids)", () => {
    const flat = flattenSoup(soup);
    expect(flat[21]).toBe(-1);
    expect(flat[22]).toBe(-1);
  });
});
