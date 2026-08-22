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
      "noiseGen.frag",
      "pathtrace.frag",
      "shaders.vert",
    ]);
  });

  it.each(shaderFiles)("assembles a non-trivial source for %s", (file) => {
    const source = readFileSync(join(shaderDir, file), "utf8");
    expect(source.trim().length).toBeGreaterThan(0);
    expect(source).toContain("main");
  });
});
