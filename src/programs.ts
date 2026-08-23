// Issue #39: extracted from main.ts — shader program compilation.
//
// Issue #40: scene-derived metadata (geometry counts/strides) is injected as
// GLSL #defines at compile time via generateSceneDefines(), so shader array
// bounds always match the actual scene data in constants.ts.
//
// Issue #53: when a GLB mesh is loaded its triangle count replaces the
// procedural scene's TRIANGLE_COUNT in that same define block, so the shader's
// u_Triangles[] bound matches the uploaded mesh soup.
import { createProgram, createShader, resolveIncludes } from "./utils";
import { generateSceneDefines } from "./constants";
import { albedoTextureSources, normalTextureSources } from "./textures";
import vertexCode from "./shaders/shaders.vert";
import pathtraceFragCode from "./shaders/pathtrace.frag";
import localFragCode from "./shaders/local.frag";
import displayFragCode from "./shaders/display.frag";

export interface Programs {
  pathtrace: WebGLProgram;
  local: WebGLProgram;
  display: WebGLProgram;
}

/** Issue #53: `meshTriangleCount` (when non-null) overrides the procedural
 *  scene's TRIANGLE_COUNT so the shader array bound matches the loaded mesh. */
function buildSceneDefineBlock(meshTriangleCount: number | null): string {
  const defines: Record<string, number> = { ...generateSceneDefines() };
  if (meshTriangleCount !== null) {
    defines.TRIANGLE_COUNT = meshTriangleCount;
  }
  const lines = Object.entries(defines).map(([name, value]) => `#define ${name} ${value}`);
  // Issue #57/#40: the texture array bound must cover every declared texture.
  const maxTextures = Math.max(albedoTextureSources.length, normalTextureSources.length, 1);
  lines.push(`#define MAX_TEXTURES ${maxTextures}`);
  return lines.join("\n");
}

export function createPrograms(
  gl: WebGL2RenderingContext,
  meshTriangleCount: number | null = null,
): Programs {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexCode);

  const sceneDefineBlock = buildSceneDefineBlock(meshTriangleCount);

  const withSceneDefines = (source: string): string =>
    source.replace(/^(\s*#version[^\n]*\n)/m, `$1\n${sceneDefineBlock}\n`);

  const pathtraceShader = createShader(
    gl,
    gl.FRAGMENT_SHADER,
    withSceneDefines(resolveIncludes(pathtraceFragCode)),
  );
  const pathtrace = createProgram(gl, vertexShader, pathtraceShader);

  const localShader = createShader(
    gl,
    gl.FRAGMENT_SHADER,
    withSceneDefines(resolveIncludes(localFragCode)),
  );
  const local = createProgram(gl, vertexShader, localShader);

  const displayShader = createShader(gl, gl.FRAGMENT_SHADER, displayFragCode);
  const display = createProgram(gl, vertexShader, displayShader);

  return { pathtrace, local, display };
}
