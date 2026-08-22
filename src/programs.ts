// Issue #39: extracted from main.ts — shader program compilation.
import { createProgram, createShader, resolveIncludes } from "./utils";
import vertexCode from "./shaders/shaders.vert";
import pathtraceFragCode from "./shaders/pathtrace.frag";
import localFragCode from "./shaders/local.frag";
import displayFragCode from "./shaders/display.frag";
import noiseGenFragCode from "./shaders/noiseGen.frag";

export interface Programs {
  pathtrace: WebGLProgram;
  local: WebGLProgram;
  display: WebGLProgram;
  noise: WebGLProgram;
}

export function createPrograms(gl: WebGL2RenderingContext): Programs {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexCode);

  const pathtraceShader = createShader(gl, gl.FRAGMENT_SHADER, resolveIncludes(pathtraceFragCode));
  const pathtrace = createProgram(gl, vertexShader, pathtraceShader);

  const localShader = createShader(gl, gl.FRAGMENT_SHADER, resolveIncludes(localFragCode));
  const local = createProgram(gl, vertexShader, localShader);

  const displayShader = createShader(gl, gl.FRAGMENT_SHADER, displayFragCode);
  const display = createProgram(gl, vertexShader, displayShader);

  const noiseShader = createShader(gl, gl.FRAGMENT_SHADER, noiseGenFragCode);
  const noise = createProgram(gl, vertexShader, noiseShader);

  return { pathtrace, local, display, noise };
}
