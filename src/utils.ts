// Shared GLSL chunk registry. Chunks live in src/shaders/chunks/ and are
// inlined into a shader source by resolving `#include <name>` directives
// before the source is handed to the GL compiler (issue #37).
import commonChunk from "./shaders/chunks/common.glsl";
import intersectionChunk from "./shaders/chunks/intersection.glsl";

const glslChunks: Record<string, string> = {
  common: commonChunk,
  intersection: intersectionChunk,
};

export function resolveIncludes(source: string): string {
  return source.replace(/^[ \t]*#include[ \t]+<([^>]+)>[ \t]*$/gm, (_match, name: string) => {
    const chunk = glslChunks[name];
    if (!chunk) {
      throw new Error(`Unknown GLSL chunk: ${name}`);
    }
    return chunk;
  });
}

export function createShader(
  gl: WebGL2RenderingContext,
  type: GLenum,
  source: string
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Failed to create shader");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    console.error("An error occurred compiling the shaders: " + info);
    gl.deleteShader(shader);
    throw new Error(`Shader compilation failed: ${info ?? "unknown error"}`);
  }
  return shader;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) {
    throw new Error("Failed to create program");
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    console.error("Unable to initialize the shader program: " + info);
    throw new Error(`Program linking failed: ${info ?? "unknown error"}`);
  }
  return program;
}
