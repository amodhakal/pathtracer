import vertexCode from "./shaders/shaders.vert";
import fragmentCode from "./shaders/pathtrace.frag";
import { createProgram, createShader } from "./utils";

const MAX_ELLIPSOID_COUNT = 10; // Same as WebGL
const ELLIPSOID_VEC_VALUE_COUNT = 9;

const vertices = new Float32Array([-1, 1, -1, -1, 1, 1, -1, -1, 1, -1, 1, 1]);
const eye = new Float32Array([0.0, 0.0, -0.5]);
const time = Date.now()
console.log(time)

const light = {
  position: new Float32Array([0.0, 0.9999, 0.5]),
  color: new Float32Array([1.0, 1.0, 1.0]),
};

const ellipsoids = [
  {
    position: new Float32Array([0.0, 0.0, 0.3]),
    radius: new Float32Array([0.3, 0.3, 0.3]),
    color: new Float32Array([1.0, 0.8, 0.0]),
  },
  {
    position: new Float32Array([0.3, 0.5, 0.2]),
    radius: new Float32Array([0.06, 0.06, 0.06]),
    color: new Float32Array([0.7, 0.7, 0.7]),
  },
];

const flattenedEllipsoids = new Float32Array(
  MAX_ELLIPSOID_COUNT * ELLIPSOID_VEC_VALUE_COUNT
);

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
  const uEllipsoids = gl.getUniformLocation(program, "u_Ellipsoids");
  const uTime = gl.getUniformLocation(program, "u_Time")

  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

  gl.clearColor(1, 0, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(program);

  gl.uniform3fv(uEye, eye);
  gl.uniform3fv(uLight_Position, light.position);
  gl.uniform3fv(uLight_Color, light.color);
  gl.uniform3fv(uEllipsoids, flattenedEllipsoids);


  gl.drawArrays(gl.TRIANGLES, 0, 6);
}
