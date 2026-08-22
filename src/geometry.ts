// Issue #39: extracted from main.ts — fullscreen-quad geometry + VAO setup.
//
// Issue #39: adopt Vertex Array Objects. All four programs share the same
// single-attribute fullscreen quad layout, so one VAO is created per program
// up front; draw calls no longer re-bind vertexAttribPointer every frame.
import { vertices } from "./constants";

export interface QuadGeometry {
  /** One VAO per program, keyed in the same order the programs were created. */
  vaos: WebGLVertexArrayObject[];
}

/**
 * Upload the shared quad vertex buffer and create one VAO per program that
 * binds `a_Position` to it. After this, rendering only needs bindVertexArray.
 */
export function createQuadVAOs(
  gl: WebGL2RenderingContext,
  programs: WebGLProgram[],
): QuadGeometry {
  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  const vaos: WebGLVertexArrayObject[] = [];
  for (const program of programs) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const posLoc = gl.getAttribLocation(program, "a_Position");
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    vaos.push(vao);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  return { vaos };
}
