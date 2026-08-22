// Issue #39: extracted from main.ts — shader program compilation.
import { createProgram, createShader, injectBvhDefines, resolveIncludes } from "./utils";
import vertexCode from "./shaders/shaders.vert";
import pathtraceFragCode from "./shaders/pathtrace.frag";
import localFragCode from "./shaders/local.frag";
import displayFragCode from "./shaders/display.frag";

export interface Programs {
  pathtrace: WebGLProgram;
  local: WebGLProgram;
  display: WebGLProgram;
}

export function createPrograms(gl: WebGL2RenderingContext): Programs {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexCode);

  const pathtraceShader = createShader(gl, gl.FRAGMENT_SHADER, injectBvhDefines(resolveIncludes(pathtraceFragCode)));
  const pathtrace = createProgram(gl, vertexShader, pathtraceShader);

  const localShader = createShader(gl, gl.FRAGMENT_SHADER, injectBvhDefines(resolveIncludes(localFragCode)));
  const local = createProgram(gl, vertexShader, localShader);

  const displayShader = createShader(gl, gl.FRAGMENT_SHADER, displayFragCode);
  const display = createProgram(gl, vertexShader, displayShader);

  return { pathtrace, local, display };
}
