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

  it("samples glass with a proper dielectric BSDF and MIS contract (#32)", () => {
    const pathtrace = readFileSync(join(shaderDir, "pathtrace.frag"), "utf8");
    // Exact dielectric Fresnel (not Schlick-only) with TIR handling.
    expect(pathtrace).toContain("float fresnelDielectric(");
    expect(pathtrace).toContain("sinThetaT >= 1.0f");
    // Delta-BSDF sampler with explicit MIS/lobe-selection documentation.
    expect(pathtrace).toContain("bool sampleGlassBsdf(");
    expect(pathtrace).toMatch(/MIS/);
    // The tracePath glass branch must route through the BSDF sampler.
    expect(pathtrace).toContain("sampleGlassBsdf(direction, hit.normal, hit.color");
    // Old Schlick-based lobe hack must be gone from the glass path.
    expect(pathtrace).not.toMatch(/MATERIAL_GLASS[\s\S]{0,400}fresnelSchlick/);
  });

  // Issue #58: thin-lens depth of field — the path tracer must declare the
  // aperture/focal uniforms and sample the lens disk after sub-pixel jitter.
  it("implements thin-lens DOF with jitter composition in the path tracer", () => {
    const pathtrace = readFileSync(join(shaderDir, "pathtrace.frag"), "utf8");
    expect(pathtrace).toContain("uniform float u_ApertureRadius");
    expect(pathtrace).toContain("uniform float u_FocalDistance");
    // Aperture sampling happens after (composing with) the pixel jitter.
    const jitterIdx = pathtrace.indexOf("vec2 jitter =");
    const dofIdx = pathtrace.indexOf("u_ApertureRadius > 0.0f");
    expect(jitterIdx).toBeGreaterThan(-1);
    expect(dofIdx).toBeGreaterThan(jitterIdx);
  });
});
