import vertexCode from "./shaders/shaders.vert";
import fragmentCode from "./shaders/pathtrace.frag";
import { createProgram, createShader } from "./utils";
import {
  eye,
  flattenedEllipsoids,
  flattenedTriangles,
  light,
  time,
  vertices,
} from "./constants";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const gl = canvas.getContext("webgl2");
if (!gl) {
  alert("WebGL2 not supported");
  throw new Error("WebGL2 not supported");
}

console.log("Vertex shader code:", vertexCode);
console.log("Fragment shader code:", fragmentCode.substring(0, 200));

try {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexCode);
  console.log("Vertex shader created:", vertexShader);
  
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentCode);
  console.log("Fragment shader created:", fragmentShader);
  
  const program = createProgram(gl, vertexShader, fragmentShader);
  console.log("Program created:", program);
  
  gl.useProgram(program);
  console.log("Program in use");

  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  console.log("Vertex buffer created");

  const positionAttributeLocation = gl.getAttribLocation(program, "a_Position");
  console.log("Position attribute location:", positionAttributeLocation);
  
  gl.enableVertexAttribArray(positionAttributeLocation);
  gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);
  console.log("Vertex attrib pointer set");

  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  console.log("Viewport set to", gl.canvas.width, gl.canvas.height);

  const uEye = gl.getUniformLocation(program, "u_Eye");
  const uLight_Position = gl.getUniformLocation(program, "u_Light.position");
  const uLight_Color = gl.getUniformLocation(program, "u_Light.color");
  const uEllipsoids = gl.getUniformLocation(program, "u_Ellipsoids");
  const uTriangles = gl.getUniformLocation(program, "u_Triangles");
  const uTime = gl.getUniformLocation(program, "u_Time");
  const uResolution = gl.getUniformLocation(program, "u_Resolution");

  console.log("Uniform locations:", {
    uEye,
    uLight_Position,
    uLight_Color,
    uEllipsoids,
    uTriangles,
    uTime,
    uResolution,
  });

  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  console.log("Setting uniform: uEye");
  gl.uniform3fv(uEye, eye);
  
  console.log("Setting uniform: uLight_Position");
  gl.uniform3fv(uLight_Position, light.position);
  
  console.log("Setting uniform: uLight_Color");
  gl.uniform3fv(uLight_Color, light.color);
  
console.log("Setting uniform: uEllipsoids, size:", flattenedEllipsoids.length);
// Use the explicit overload to send the entire flat array
gl.uniform3fv(uEllipsoids, flattenedEllipsoids, 0, flattenedEllipsoids.length);

console.log("Setting uniform: uTriangles, size:", flattenedTriangles.length);
// Do the same for the triangles
gl.uniform3fv(uTriangles, flattenedTriangles, 0, flattenedTriangles.length);
  
  console.log("Setting uniform: uTime");
  gl.uniform1f(uTime, time);
  
  console.log("Setting uniform: uResolution");
  gl.uniform2f(uResolution, gl.canvas.width, gl.canvas.height);

  console.log("Drawing");
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  
  console.log("Done");
} catch (err) {
  console.error("Error:", err);
  alert("Error: " + err);
}
