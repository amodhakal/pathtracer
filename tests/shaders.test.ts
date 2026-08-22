import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const shaderDir = join(__dirname, "../src/shaders");
const shaderFiles = readdirSync(shaderDir, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name);

describe("shader sources", () => {
  it("ships all expected shader files", () => {
    expect(shaderFiles.sort()).toEqual([
      "display.frag",
      "local.frag",
      "pathtrace.frag",
      "shaders.vert",
    ]);
  });

  it.each(shaderFiles)("assembles a non-trivial source for %s", (file) => {
    const source = readFileSync(join(shaderDir, file), "utf8");
    expect(source.trim().length).toBeGreaterThan(0);
    expect(source).toContain("main");
  });

  it("declares the issue #55 material types in the shared chunks", () => {
    const common = readFileSync(join(shaderDir, "chunks/common.glsl"), "utf8");
    expect(common).toContain("#define MATERIAL_GGX 3");
    expect(common).toContain("#define MATERIAL_EMISSIVE 4");
    expect(common).toContain("#define MATERIAL_CLEARCOAT 5");
    expect(common).toContain("#define MATERIAL_THINFILM 6");
  });
  // Issue #29: the noise-texture RNG pass was removed; the RNG now lives in
  // chunks/prng.glsl and pathtrace.frag must include and seed it.
  it("pathtrace.frag uses the in-shader PRNG chunk", () => {
    const source = readFileSync(join(shaderDir, "pathtrace.frag"), "utf8");
    expect(source).toContain("#include <prng>");
    expect(source).toContain("initRng(");
    expect(source).not.toContain("u_NoiseTexture");
  });
});
