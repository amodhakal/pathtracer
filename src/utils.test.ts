import { describe, expect, it } from "vitest";
import { createProgram, createShader } from "./utils";

// Minimal WebGL stub — only what createShader/createProgram touch.
function makeGL() {
  const log: string[] = [];
  const shader = { id: "shader" };
  const program = { id: "program" };
  const gl = {
    COMPILE_STATUS: "COMPILE_STATUS",
    LINK_STATUS: "LINK_STATUS",
    createShader: () => shader,
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: (_s: unknown, pname: string) => pname === "COMPILE_STATUS",
    getShaderInfoLog: () => "shader error",
    deleteShader: () => {},
    createProgram: () => program,
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: (_p: unknown, pname: string) => pname === "LINK_STATUS",
    getProgramInfoLog: () => "link error",
  };
  return { gl: gl as unknown as WebGLRenderingContext, log };
}

describe("createShader", () => {
  it("returns the shader on successful compilation", () => {
    const { gl } = makeGL();
    expect(createShader(gl, gl.VERTEX_SHADER, "void main() {}")).toBeTruthy();
  });
});

describe("createProgram", () => {
  it("returns the program on successful linking", () => {
    const { gl } = makeGL();
    const vs = createShader(gl, gl.VERTEX_SHADER, "vs");
    const fs = createShader(gl, gl.FRAGMENT_SHADER, "fs");
    expect(createProgram(gl, vs, fs)).toBeTruthy();
  });

  it("throws when linking fails", () => {
    const { gl } = makeGL();
    const vs = createShader(gl, gl.VERTEX_SHADER, "vs");
    const fs = createShader(gl, gl.FRAGMENT_SHADER, "fs");
    (gl as unknown as Record<string, unknown>).getProgramParameter = () => false;
    expect(() => createProgram(gl, vs, fs)).toThrow("Program linking failed");
  });
});
