import vertexCode from "./shaders/shaders.vert";
import fragmentCode from "./shaders/shaders.frag";
import { createProgram, createShader } from "./utils";

function main() {
  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  const gl = canvas.getContext("webgl");
  if (!gl) {
    alert("WebGL not supported");
    throw new Error("WebGL not supported");
  }

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexCode);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentCode);
  const program = createProgram(gl, vertexShader, fragmentShader);

  const vertices = new Float32Array([-1, 1, -1, -1, 1, 1, -1, -1, 1, -1, 1, 1]);

  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  const positionAttributeLocation = gl.getAttribLocation(program, "a_Position");
  gl.enableVertexAttribArray(positionAttributeLocation);
  gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

  gl.clearColor(1, 0, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(program);

  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

main();
