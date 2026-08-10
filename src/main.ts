import vertexCode from "./shaders/shaders.vert";
import noiseGenFragCode from "./shaders/noiseGen.frag";
import displayFragCode from "./shaders/display.frag";
import { createProgram, createShader } from "./utils";
import { vertices } from "./constants";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const gl = canvas.getContext("webgl2");
if (!gl) {
  alert("WebGL2 not supported");
  throw new Error("WebGL2 not supported");
}

try {
  // Compile shaders and create programs
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexCode);
  
  const noiseGenShader = createShader(gl, gl.FRAGMENT_SHADER, noiseGenFragCode);
  const noiseProgram = createProgram(gl, vertexShader, noiseGenShader);

  const displayShader = createShader(gl, gl.FRAGMENT_SHADER, displayFragCode);
  const displayProgram = createProgram(gl, vertexShader, displayShader);

  // Setup vertex buffer
  const vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  // Configure attributes for noiseProgram
  gl.useProgram(noiseProgram);
  const posLocNoise = gl.getAttribLocation(noiseProgram, "a_Position");
  gl.enableVertexAttribArray(posLocNoise);
  gl.vertexAttribPointer(posLocNoise, 2, gl.FLOAT, false, 0, 0);

  // Configure attributes for displayProgram
  gl.useProgram(displayProgram);
  const posLocDisplay = gl.getAttribLocation(displayProgram, "a_Position");
  gl.enableVertexAttribArray(posLocDisplay);
  gl.vertexAttribPointer(posLocDisplay, 2, gl.FLOAT, false, 0, 0);

  // Set canvas size and viewport
  canvas.width = canvas.clientWidth || 600;
  canvas.height = canvas.clientHeight || 600;
  const texWidth = canvas.width;
  const texHeight = canvas.height;

  gl.viewport(0, 0, texWidth, texHeight);

  // Create noise texture to render into
  const noiseTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, noiseTexture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    texWidth,
    texHeight,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Create Framebuffer
  const noiseFBO = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, noiseFBO);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    noiseTexture,
    0
  );

  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("Framebuffer is not complete");
  }

  // Get uniform locations
  gl.useProgram(noiseProgram);
  const uSeed = gl.getUniformLocation(noiseProgram, "u_Seed");
  const uResolutionNoise = gl.getUniformLocation(noiseProgram, "u_Resolution");

  gl.useProgram(displayProgram);
  const uNoiseTexture = gl.getUniformLocation(displayProgram, "u_NoiseTexture");

  let frameCount = 0;
  let lastFrameTime = 0;
  const targetFPS = 4;
  const frameInterval = 1000 / targetFPS;

  function render(currentTime: number) {
    if (!gl) return;

    requestAnimationFrame(render);

    const elapsed = currentTime - lastFrameTime;
    if (elapsed < frameInterval) {
      return;
    }
    lastFrameTime = currentTime - (elapsed % frameInterval);

    // Resize canvas if needed
    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      gl.bindTexture(gl.TEXTURE_2D, noiseTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        canvas.width,
        canvas.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null
      );
    }

    frameCount++;
    const randomSeed = Math.random() * 100000.0 + frameCount * 13.37;

    // --- Pass 1: Generate noise into texture ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, noiseFBO);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(noiseProgram);

    gl.uniform1f(uSeed, randomSeed);
    gl.uniform2f(uResolutionNoise, canvas.width, canvas.height);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // --- Pass 2: Render noise texture to screen ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(displayProgram);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, noiseTexture);
    gl.uniform1i(uNoiseTexture, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  requestAnimationFrame(render);

} catch (err) {
  console.error("Error: ", err);
  alert("Error: " + err);
}
