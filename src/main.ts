import vertexCode from "./shaders/shaders.vert";
import pathtraceFragCode from "./shaders/pathtrace.frag";
import displayFragCode from "./shaders/display.frag";
import { createProgram, createShader } from "./utils";
import { vertices, time, flattenedTriangles, flattenedEllipsoids } from "./constants";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const gl = canvas.getContext("webgl2");
if (!gl) {
  alert("WebGL2 not supported");
  throw new Error("WebGL2 not supported");
}

const floatExt = gl.getExtension("EXT_color_buffer_float");
if (!floatExt) {
  alert("Floating-point color buffers are not supported on this device.");
  throw new Error("EXT_color_buffer_float not supported");
}

try {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexCode);
  
  const pathtraceShader = createShader(gl, gl.FRAGMENT_SHADER, pathtraceFragCode);
  const pathtraceProgram = createProgram(gl, vertexShader, pathtraceShader);

  const displayShader = createShader(gl, gl.FRAGMENT_SHADER, displayFragCode);
  const displayProgram = createProgram(gl, vertexShader, displayShader);

  const noiseGenShader = createShader(gl, gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;

in vec2 v_WindowPixels;
out vec4 outColor;

uniform float u_Seed;
uniform vec2 u_Resolution;

uint hash(uint x) {
    x = ((x >> 16u) ^ x) * uint(0x45d9f3b);
    x = ((x >> 16u) ^ x) * uint(0x45d9f3b);
    x = (x >> 16u) ^ x;
    return x;
}

void main() {
    uvec2 pixel = uvec2(gl_FragCoord.xy);
    uint seedInt = uint(u_Seed);
    
    uint h = hash(pixel.x + hash(pixel.y + seedInt));
    float n = float(h) / 4294967295.0;
    
    outColor = vec4(vec3(n), 1.0);
}`);
  const noiseProgram = createProgram(gl, vertexShader, noiseGenShader);

  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  const posLocPathtrace = gl.getAttribLocation(pathtraceProgram, "a_Position");
  const posLocDisplay = gl.getAttribLocation(displayProgram, "a_Position");
  const posLocNoise = gl.getAttribLocation(noiseProgram, "a_Position");

  const textureWidth = canvas.width;
  const textureHeight = canvas.height;

  // --- Noise Texture & FBO ---
  const noiseTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, noiseTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, textureWidth, textureHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const noiseFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, noiseFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, noiseTexture, 0);
  {
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error("noiseFBO is incomplete:", status);
    }
  }

  // --- Ping-Pong Accumulation Textures & FBOs ---
  const accumTextureA = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, accumTextureA);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, textureWidth, textureHeight, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  const accumTextureB = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, accumTextureB);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, textureWidth, textureHeight, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  const fboA = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fboA);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, accumTextureA, 0);
  {
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error("fboA is incomplete:", status);
    }
  }

  const fboB = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fboB);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, accumTextureB, 0);
  {
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error("fboB is incomplete:", status);
    }
  }

  // Clear both accumulation FBOs to black
  gl.bindFramebuffer(gl.FRAMEBUFFER, fboA);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.bindFramebuffer(gl.FRAMEBUFFER, fboB);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // Uniform locations
  const pathtraceUniforms = {
    u_Eye: gl.getUniformLocation(pathtraceProgram, "u_Eye")!,
    u_Light: {
      position: gl.getUniformLocation(pathtraceProgram, "u_Light.position")!,
      color: gl.getUniformLocation(pathtraceProgram, "u_Light.color")!
    },
    u_Ellipsoids: gl.getUniformLocation(pathtraceProgram, "u_Ellipsoids")!,
    u_Triangles: gl.getUniformLocation(pathtraceProgram, "u_Triangles")!,
    u_Time: gl.getUniformLocation(pathtraceProgram, "u_Time")!,
    u_Resolution: gl.getUniformLocation(pathtraceProgram, "u_Resolution")!,
    u_FrameCount: gl.getUniformLocation(pathtraceProgram, "u_FrameCount")!,
    u_NoiseTexture: gl.getUniformLocation(pathtraceProgram, "u_NoiseTexture")!,
    u_AccumTexture: gl.getUniformLocation(pathtraceProgram, "u_AccumTexture")!
  };

  const noiseUniforms = {
    u_Seed: gl.getUniformLocation(noiseProgram, "u_Seed")!,
    u_Resolution: gl.getUniformLocation(noiseProgram, "u_Resolution")!
  };

  const displayUniforms = {
    u_NoiseTexture: gl.getUniformLocation(displayProgram, "u_NoiseTexture")!
  };

  let frameCount = 0;
  let readTex = accumTextureA;
  let writeFbo = fboB;
  let writeTex = accumTextureB;

  function renderNoise() {
    if (!gl) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, noiseFBO);
    gl.viewport(0, 0, textureWidth, textureHeight);
    gl.useProgram(noiseProgram);

    gl.enableVertexAttribArray(posLocNoise);
    gl.vertexAttribPointer(posLocNoise, 2, gl.FLOAT, false, 0, 0);

    const currentSeed = Math.random() * 100000.0;
    gl.uniform1f(noiseUniforms.u_Seed, currentSeed);
    gl.uniform2f(noiseUniforms.u_Resolution, textureWidth, textureHeight);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function renderPathtrace() {
    if (!gl) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, writeFbo);
    gl.viewport(0, 0, textureWidth, textureHeight);
    gl.useProgram(pathtraceProgram);

    gl.enableVertexAttribArray(posLocPathtrace);
    gl.vertexAttribPointer(posLocPathtrace, 2, gl.FLOAT, false, 0, 0);

    // Bind noiseTexture to unit 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, noiseTexture);
    gl.uniform1i(pathtraceUniforms.u_NoiseTexture, 0);

    // Bind read accumulation texture to unit 1
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, readTex);
    gl.uniform1i(pathtraceUniforms.u_AccumTexture, 1);

    gl.uniform3fv(pathtraceUniforms.u_Eye, new Float32Array([0.5, 0.5, -0.4]));
    gl.uniform3fv(pathtraceUniforms.u_Light.position, new Float32Array([0.5, 0.9, 0.3]));
    gl.uniform3fv(pathtraceUniforms.u_Light.color, new Float32Array([1.0, 1.0, 1.0]));
    gl.uniform3fv(pathtraceUniforms.u_Ellipsoids, flattenedEllipsoids);
    gl.uniform3fv(pathtraceUniforms.u_Triangles, flattenedTriangles);
    gl.uniform1f(pathtraceUniforms.u_Time, Date.now() - time);
    gl.uniform2f(pathtraceUniforms.u_Resolution, textureWidth, textureHeight);
    gl.uniform1f(pathtraceUniforms.u_FrameCount, frameCount);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function renderDisplay() {
    if (!gl) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(displayProgram);

    gl.enableVertexAttribArray(posLocDisplay);
    gl.vertexAttribPointer(posLocDisplay, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, writeTex);
    gl.uniform1i(displayUniforms.u_NoiseTexture, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function render() {
    renderNoise();
    renderPathtrace();
    renderDisplay();

    if (readTex === accumTextureA) {
      readTex = accumTextureB;
      writeFbo = fboA;
      writeTex = accumTextureA;
    } else {
      readTex = accumTextureA;
      writeFbo = fboB;
      writeTex = accumTextureB;
    }

    frameCount++;
    if (frameCount < 800) {
      requestAnimationFrame(render);
    } else {
      console.log("Rendering complete after 800 frames");
    }
  }

  requestAnimationFrame(render);

} catch (err) {
  console.error("Error: ", err);
  alert("Error: " + err);
}
