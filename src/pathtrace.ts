import vertexCode from "./shaders/shaders.vert";
import fragmentCode from "./shaders/pathtrace.frag";
import { createProgram, createShader } from "./utils";

const vertices = new Float32Array([-1, 1, -1, -1, 1, 1, -1, -1, 1, -1, 1, 1]);
const eye = new Float32Array([0.0, 0.0, -0.5]);
const light = {
  position: new Float32Array([0.0, 0.9999, 0.5]),
  color: new Float32Array([1.0, 1.0, 1.0]),
};

export function pathtrace() {
  const canvas = document.getElementById("canvas") as HTMLCanvasElement;
  const gl = canvas.getContext("webgl");
  if (!gl) {
    alert("WebGL not supported");
    throw new Error("WebGL not supported");
  }

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexCode);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentCode);
  const program = createProgram(gl, vertexShader, fragmentShader);

  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  const positionAttributeLocation = gl.getAttribLocation(program, "a_Position");
  gl.enableVertexAttribArray(positionAttributeLocation);
  gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

  const uEye = gl.getUniformLocation(program, "u_Eye");
  const uLight_Position = gl.getUniformLocation(program, "u_Light.position");
  const uLight_Color = gl.getUniformLocation(program, "u_Light.color");

  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

  gl.clearColor(1, 0, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(program);

  gl.uniform3fv(uEye, eye);
  gl.uniform3fv(uLight_Position, light.position);
  gl.uniform3fv(uLight_Color, light.color);

  gl.drawArrays(gl.TRIANGLES, 0, 6);
}
