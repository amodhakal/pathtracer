import { describe, expect, it } from "vitest";
import { createShader, createProgram } from "../src/utils";

const COMPILE_STATUS = 35713;
const LINK_STATUS = 35714;

function makeMockGL(compileStatus = true, linkStatus = true) {
  const shaders: MockShader[] = [];
  const programs: MockProgram[] = [];

  class MockShader {
    source = "";
    deleted = false;
    constructor(public type: GLenum) {}
  }
  class MockProgram {
    attached: MockShader[] = [];
    deleted = false;
  }

  const gl = {
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS,
    LINK_STATUS,
    createShader: (type: GLenum) => new MockShader(type),
    shaderSource: (shader: MockShader, source: string) => {
      shader.source = source;
    },
    compileShader: () => {},
    getShaderParameter: (shader: MockShader, param: GLenum) =>
      param === COMPILE_STATUS ? compileStatus : shader.type,
    getShaderInfoLog: () => "mock info log",
    deleteShader: (shader: MockShader) => {
      shader.deleted = true;
    },
    createProgram: () => new MockProgram(),
    attachShader: (program: MockProgram, shader: MockShader) => {
      program.attached.push(shader);
    },
    linkProgram: () => {},
    getProgramParameter: (program: MockProgram, param: GLenum) =>
      param === LINK_STATUS ? linkStatus : program.attached.length,
    getProgramInfoLog: () => "mock info log",
    deleteProgram: (program: MockProgram) => {
      program.deleted = true;
    },
  } as unknown as WebGL2RenderingContext;

  return { gl, shaders, programs };
}

describe("createShader", () => {
  it("returns a compiled shader for valid input", () => {
    const { gl } = makeMockGL();
    const shader = createShader(gl, 35633, "void main() {}");
    expect(shader).toBeTruthy();
  });

  it("throws and deletes the shader when compilation fails", () => {
    const { gl } = makeMockGL(false);
    expect(() => createShader(gl, 35633, "invalid")).toThrow(/Shader compilation failed/);
  });
});

describe("createProgram", () => {
  it("links a program from two shaders", () => {
    const { gl } = makeMockGL();
    const vs = createShader(gl, 35633, "vertex");
    const fs = createShader(gl, 35632, "fragment");
    expect(createProgram(gl, vs, fs)).toBeTruthy();
  });

  it("throws when linking fails", () => {
    const { gl } = makeMockGL(true, false);
    const vs = createShader(gl, 35633, "vertex");
    const fs = createShader(gl, 35632, "fragment");
    expect(() => createProgram(gl, vs, fs)).toThrow(/Program linking failed/);
  });
});
