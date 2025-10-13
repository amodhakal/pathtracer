import vertexCode from "./shaders/shaders.vert";
import fragmentCode from "./shaders/pathtrace.frag";
import { createProgram, createShader } from "./utils";
import { eye, flattenedEllipsoids, flattenedTriangles, light, time, vertices } from "./constants";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const gl = canvas.getContext("webgl2");
if (!gl) {
  alert("WebGL2 not supported");
  throw new Error("WebGL2 not supported");
}

try {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexCode);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentCode);
  const program = createProgram(gl, vertexShader, fragmentShader);
  gl.useProgram(program);
  
  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  const positionAttributeLocation = gl.getAttribLocation(program, "a_Position");
  gl.enableVertexAttribArray(positionAttributeLocation);
  gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

  const uEye = gl.getUniformLocation(program, "u_Eye");
  const uLight_Position = gl.getUniformLocation(program, "u_Light.position");
  const uLight_Color = gl.getUniformLocation(program, "u_Light.color");
  const uEllipsoids = gl.getUniformLocation(program, "u_Ellipsoids");
  const uTriangles = gl.getUniformLocation(program, "u_Triangles");
  const uTime = gl.getUniformLocation(program, "u_Time");
  const uResolution = gl.getUniformLocation(program, "u_Resolution");

  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.uniform3fv(uEye, eye);
  gl.uniform3fv(uLight_Position, light.position);
  gl.uniform3fv(uLight_Color, light.color);
  gl.uniform3fv(uEllipsoids, flattenedEllipsoids, 0, flattenedEllipsoids.length);
  gl.uniform3fv(uTriangles, flattenedTriangles, 0, flattenedTriangles.length);
  gl.uniform1f(uTime, time);
  gl.uniform2f(uResolution, gl.canvas.width, gl.canvas.height);

  gl.drawArrays(gl.TRIANGLES, 0, 6);
} catch (err) {
  console.error("Error: ", err);
  alert("Error: " + err);
}
