import { describe, expect, it, vi, afterEach } from "vitest";
import { createShader, createProgram } from "../src/utils";

type GL = WebGLRenderingContext;

function makeGL(compileOk = true, linkOk = true): GL & {
  lastShaderSource: string | null;
} {
  const gl = {
    lastShaderSource: null as string | null,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(function (_shader: unknown, src: string) {
      gl.lastShaderSource = src;
    }),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => compileOk),
    getShaderInfoLog: vi.fn(() => "fake log"),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => linkOk),
    getProgramInfoLog: vi.fn(() => "fake log"),
  };
  return gl as unknown as GL & { lastShaderSource: string | null };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createShader", () => {
  it("returns the shader when compilation succeeds", () => {
    const gl = makeGL(true);
    const shader = createShader(gl, gl.VERTEX_SHADER, "void main() {}");
    expect(shader).toBeDefined();
    expect(gl.lastShaderSource).toBe("void main() {}");
    expect(gl.deleteShader).not.toHaveBeenCalled();
  });

  it("deletes the shader and throws when compilation fails", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const gl = makeGL(false);
    expect(() => createShader(gl, gl.FRAGMENT_SHADER, "bad")).toThrow(
      "Shader compilation failed"
    );
    expect(gl.deleteShader).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("createProgram", () => {
  it("returns the program when linking succeeds", () => {
    const gl = makeGL();
    const program = createProgram(gl, {} as WebGLShader, {} as WebGLShader);
    expect(program).toBeDefined();
    expect(gl.attachShader).toHaveBeenCalledTimes(2);
    expect(gl.linkProgram).toHaveBeenCalledTimes(1);
  });

  it("throws when linking fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const gl = makeGL(false, false);
    expect(() =>
      createProgram(gl, {} as WebGLShader, {} as WebGLShader)
    ).toThrow("Program linking failed");
  });
});
