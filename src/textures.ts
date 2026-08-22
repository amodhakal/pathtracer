// Issue #57: scene texture definitions for albedo and normal maps.
//
// Textures are declared as URLs resolved by Vite (or data URLs) and uploaded
// to WebGL2 texture units by src/main.ts at init time. Each triangle in
// constants.ts references a texture by its index in these arrays; -1
// (NO_TEXTURE) means "no texture".
//
// MAX_TEXTURES in pathtrace.frag must stay >= max(albedoTextureSources.length,
// normalTextureSources.length).

export interface SceneTexture {
  url: string;
  // Optional sRGB hint; albedo maps are typically sRGB-encoded.
  srgb?: boolean;
}

// Procedurally generated checkered albedo map (as a data URL) so the feature
// works without external assets. Generated at runtime by makeCheckerTexture().
export function makeCheckerTexture(
  size = 64,
  squares = 8,
  a: [number, number, number] = [255, 255, 255],
  b: [number, number, number] = [40, 40, 40],
): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const cell = size / squares;
  for (let y = 0; y < squares; y++) {
    for (let x = 0; x < squares; x++) {
      const [r, g, bl] = (x + y) % 2 === 0 ? a : b;
      ctx.fillStyle = `rgb(${r},${g},${bl})`;
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  return canvas.toDataURL("image/png");
}

// Procedural tangent-space normal map: flat neutral (128,128,255) with a
// subtle sinusoidal bump so the perturbation is visible on the walls.
export function makeBumpNormalTexture(size = 64, waves = 8): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = Math.sin((x / size) * waves * Math.PI * 2) * 0.15;
      const dy = Math.sin((y / size) * waves * Math.PI * 2) * 0.15;
      img.data[idx] = Math.round((0.5 + dx) * 255);
      img.data[idx + 1] = Math.round((0.5 + dy) * 255);
      img.data[idx + 2] = 255;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

// Texture slot assignments for the scene. Index 0 of each array is texture id
// 0 in a triangle's `textures` pair.
export const albedoTextureSources: SceneTexture[] = [
  { url: makeCheckerTexture(), srgb: true },
];

export const normalTextureSources: SceneTexture[] = [
  { url: makeBumpNormalTexture() },
];
