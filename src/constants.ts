export const IS_PATHTRACING = false;

// Material encoding packed as vec3(x = material type, y = index of refraction, z = opacity)
export const MATERIAL_DIFFUSE = 0;
export const MATERIAL_MIRROR = 1;
export const MATERIAL_GLASS = 2;
// Issue #55: additional material types.
// GGX: packed vec3(type, roughness, metalness)
export const MATERIAL_GGX = 3;
// Decoupled emissive: emits hit.color regardless of brightness (issue #55).
export const MATERIAL_EMISSIVE = 4;
// Clearcoat over a diffuse base: vec3(type, base roughness, coat strength)
export const MATERIAL_CLEARCOAT = 5;
// Thin-film interference over a mirror base: vec3(type, film thickness [nm], IOR)
export const MATERIAL_THINFILM = 6;

export const DEFAULT_IOR = 1.0;
export const DEFAULT_OPACITY = 0.0;
export const GLASS_IOR = 1.33;
export const GLASS_OPACITY = 0.05;
export const DEFAULT_ROUGHNESS = 0.25;
export const DEFAULT_METALNESS = 1.0;
export const EMISSIVE_STRENGTH = 4.0;
export const CLEARCOAT_STRENGTH = 0.5;
export const THINFILM_THICKNESS_NM = 400.0;

// Issue #57: texture id sentinel meaning "no texture bound" for a triangle.
export const NO_TEXTURE = -1;

// Issue #58: thin-lens depth-of-field parameters. The focal plane sits at
// FOCAL_DISTANCE along the view direction; points off that plane blur by an
// amount proportional to APERTURE_RADIUS (0 = pinhole, i.e. no DOF).
export const APERTURE_RADIUS = 0.02;
export const FOCAL_DISTANCE = 1.2;

interface SceneTriangle {
  vertex1: Float32Array;
  vertex2: Float32Array;
  vertex3: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  // Issue #57: per-vertex texture coordinates (optional; defaults applied in
  // the flattening pass) and packed [albedoTextureId, normalTextureId].
  uv?: [Float32Array, Float32Array, Float32Array];
  textures?: [number, number];
}

const triangles: SceneTriangle[] = [
  {
    vertex1: new Float32Array([0.0, 0.0, -1.0]),
    vertex2: new Float32Array([0.0, 1.0, -1.0]),
    vertex3: new Float32Array([0.0, 0.0, 1.0]),
    normal: new Float32Array([1.0, 0.0, 0.0]),
    color: new Float32Array([0.8, 0.0, 0.0]),
  },
  {
    vertex1: new Float32Array([0.0, 1.0, -1.0]),
    vertex2: new Float32Array([0.0, 1.0, 1.0]),
    vertex3: new Float32Array([0.0, 0.0, 1.0]),
    normal: new Float32Array([1.0, 0.0, 0.0]),
    color: new Float32Array([0.8, 0.0, 0.0]),
  },

  {
    vertex1: new Float32Array([1.0, 0.0, -1.0]),
    vertex2: new Float32Array([1.0, 1.0, -1.0]),
    vertex3: new Float32Array([1.0, 0.0, 1.0]),
    normal: new Float32Array([-1.0, 0.0, 0.0]),
    color: new Float32Array([0.0, 0.0, 0.8]),
  },
  {
    vertex1: new Float32Array([1.0, 1.0, -1.0]),
    vertex2: new Float32Array([1.0, 1.0, 1.0]),
    vertex3: new Float32Array([1.0, 0.0, 1.0]),
    normal: new Float32Array([-1.0, 0.0, 0.0]),
    color: new Float32Array([0.0, 0.0, 0.8]),
  },

  {
    vertex1: new Float32Array([0.0, 0.0, 1.0]),
    vertex2: new Float32Array([1.0, 0.0, 1.0]),
    vertex3: new Float32Array([0.0, 1.0, 1.0]),
    normal: new Float32Array([0.0, 0.0, -1.0]),
    color: new Float32Array([1.0, 1.0, 1.0]),
    // Issue #57: textured demo surface (checker albedo id 0 + bump normal id 0).
    uv: [
      new Float32Array([0.0, 0.0]),
      new Float32Array([2.0, 0.0]),
      new Float32Array([0.0, 2.0]),
    ],
    textures: [0, 0],
  },
  {
    vertex1: new Float32Array([1.0, 0.0, 1.0]),
    vertex2: new Float32Array([1.0, 1.0, 1.0]),
    vertex3: new Float32Array([0.0, 1.0, 1.0]),
    normal: new Float32Array([0.0, 0.0, -1.0]),
    color: new Float32Array([1.0, 1.0, 1.0]),
    uv: [
      new Float32Array([2.0, 0.0]),
      new Float32Array([2.0, 2.0]),
      new Float32Array([0.0, 2.0]),
    ],
    textures: [0, 0],
  },
  // Issue #57: textured demo surfaces — checkered albedo map + procedural
  // bump normal map on the z=1 wall.


  {
    vertex1: new Float32Array([0.0, 1.0, -1.0]),
    vertex2: new Float32Array([0.0, 1.0, 1.0]),
    vertex3: new Float32Array([1.0, 1.0, -1.0]),
    normal: new Float32Array([0.0, -1.0, 0.0]),
    color: new Float32Array([0.8, 0.8, 0.8]),
  },
  {
    vertex1: new Float32Array([1.0, 1.0, -1.0]),
    vertex2: new Float32Array([0.0, 1.0, 1.0]),
    vertex3: new Float32Array([1.0, 1.0, 1.0]),
    normal: new Float32Array([0.0, -1.0, 0.0]),
    color: new Float32Array([0.8, 0.8, 0.8]),
  },

  {
    vertex1: new Float32Array([0.0, 0.0, -1.0]),
    vertex2: new Float32Array([1.0, 0.0, -1.0]),
    vertex3: new Float32Array([0.0, 0.0, 1.0]),
    normal: new Float32Array([0.0, 1.0, 0.0]),
    color: new Float32Array([0.8, 0.8, 0.8]),
  },
  {
    vertex1: new Float32Array([1.0, 0.0, -1.0]),
    vertex2: new Float32Array([1.0, 0.0, 1.0]),
    vertex3: new Float32Array([0.0, 0.0, 1.0]),
    normal: new Float32Array([0.0, 1.0, 0.0]),
    color: new Float32Array([0.8, 0.8, 0.8]),
  },

  {
    vertex1: new Float32Array([0.0, 0.0, -1.0]),
    vertex2: new Float32Array([1.0, 0.0, -1.0]),
    vertex3: new Float32Array([0.0, 1.0, -1.0]),
    normal: new Float32Array([0.0, 0.0, 1.0]),
    color: new Float32Array([0.0, 1.0, 0.0]),
  },
  {
    vertex1: new Float32Array([1.0, 0.0, -1.0]),
    vertex2: new Float32Array([1.0, 1.0, -1.0]),
    vertex3: new Float32Array([0.0, 1.0, -1.0]),
    normal: new Float32Array([0.0, 0.0, 1.0]),
    color: new Float32Array([0.0, 1.0, 0.0]),
  },

  {
    vertex1: new Float32Array([0.25, 0.96, -0.25]),
    vertex2: new Float32Array([0.75, 0.96, -0.25]),
    vertex3: new Float32Array([0.75, 0.96, 0.25]),
    normal: new Float32Array([0.0, -1.0, 0.0]),
    color: new Float32Array([2.0, 2.0, 2.0]),
  },
  {
    vertex1: new Float32Array([0.25, 0.96, -0.25]),
    vertex2: new Float32Array([0.75, 0.96, 0.25]),
    vertex3: new Float32Array([0.25, 0.96, 0.25]),
    normal: new Float32Array([0.0, -1.0, 0.0]),
    color: new Float32Array([2.0, 2.0, 2.0]),
  },
];

const ellipsoids = [
  {
    position: new Float32Array([0.5, 0.5, 0.5]),
    radius: new Float32Array([0.2, 0.2, 0.2]),
    color: new Float32Array([1.0, 0.8, 0.0]),
    material: new Float32Array([MATERIAL_DIFFUSE, DEFAULT_IOR, DEFAULT_OPACITY]),
  },
  {
    position: new Float32Array([0.3, 0.3, 0.3]),
    radius: new Float32Array([0.1, 0.1, 0.1]),
    color: new Float32Array([0.9, 0.9, 0.9]),
    material: new Float32Array([MATERIAL_MIRROR, DEFAULT_IOR, DEFAULT_OPACITY]),
  },
  {
    position: new Float32Array([0.7, 0.4, 0.0]),
    radius: new Float32Array([0.15, 0.15, 0.15]),
    color: new Float32Array([1.0, 1.0, 1.0]),
    material: new Float32Array([MATERIAL_GLASS, GLASS_IOR, GLASS_OPACITY]),
  },
  // Issue #55: one ellipsoid per new material type.
  {
    // GGX metalness/roughness: brushed gold
    position: new Float32Array([0.5, 0.2, 0.5]),
    radius: new Float32Array([0.1, 0.1, 0.1]),
    color: new Float32Array([1.0, 0.71, 0.29]),
    material: new Float32Array([MATERIAL_GGX, DEFAULT_ROUGHNESS, DEFAULT_METALNESS]),
  },
  {
    // Decoupled emissive: glows via EMISSIVE_STRENGTH even though color <= 1.
    position: new Float32Array([0.25, 0.75, 0.75]),
    radius: new Float32Array([0.07, 0.07, 0.07]),
    color: new Float32Array([1.0, 0.3, 0.5]),
    material: new Float32Array([MATERIAL_EMISSIVE, DEFAULT_IOR, DEFAULT_OPACITY]),
  },
  {
    // Clearcoat over a colored diffuse base (car paint)
    position: new Float32Array([0.75, 0.75, 0.3]),
    radius: new Float32Array([0.09, 0.09, 0.09]),
    color: new Float32Array([0.7, 0.1, 0.1]),
    material: new Float32Array([
      MATERIAL_CLEARCOAT,
      DEFAULT_ROUGHNESS,
      CLEARCOAT_STRENGTH,
    ]),
  },
  {
    // Thin-film interference over a mirror base (soap-bubble look)
    position: new Float32Array([0.35, 0.45, 0.8]),
    radius: new Float32Array([0.11, 0.11, 0.11]),
    color: new Float32Array([1.0, 1.0, 1.0]),
    material: new Float32Array([
      MATERIAL_THINFILM,
      THINFILM_THICKNESS_NM,
      GLASS_IOR,
    ]),
  },
];

// Issue #40: scene metadata exported as the single source of truth for the
// shader-side geometry bounds. These feed generateSceneDefines() below, which
// injects them as GLSL #defines at program-compile time — so the shader's
// uniform array sizes are derived from the actual scene data instead of being
// hand-maintained duplicates in chunks/common.glsl (the old mismatch risk:
// editing the scene here without bumping the GLSL defines silently truncated
// geometry or read out of bounds).
export const SCENE_TRIANGLE_COUNT = triangles.length;
export const SCENE_TRIANGLE_VECTORS = 8; // 3 verts + normal + color + 2 UV slots + tex ids
export const SCENE_ELLIPSOID_COUNT = ellipsoids.length;
export const SCENE_ELLIPSOID_VECTORS = 4;
export const TRIANGLE_VEC_VALUE_COUNT = SCENE_TRIANGLE_VECTORS * 3;
export const ELLIPSOID_VEC_VALUE_COUNT = SCENE_ELLIPSOID_VECTORS * 3;

export const flattenedTriangles = new Float32Array(triangles.length * TRIANGLE_VEC_VALUE_COUNT);
export const flattenedEllipsoids = new Float32Array(ellipsoids.length * ELLIPSOID_VEC_VALUE_COUNT);

export interface SceneDefines {
  TRIANGLE_COUNT: number;
  TRIANGLE_VECTORS: number;
  ELLIPSOID_COUNT: number;
  ELLIPSOID_VECTORS: number;
}

// Builds the GLSL #define block injected into every shader that includes the
// common chunk. Kept next to the scene data so adding a triangle or ellipsoid
// can never drift out of sync with the shader metadata.
export function generateSceneDefines(): SceneDefines {
  return {
    TRIANGLE_COUNT: SCENE_TRIANGLE_COUNT,
    TRIANGLE_VECTORS: SCENE_TRIANGLE_VECTORS,
    ELLIPSOID_COUNT: SCENE_ELLIPSOID_COUNT,
    ELLIPSOID_VECTORS: SCENE_ELLIPSOID_VECTORS,
  };
}

export const vertices = new Float32Array([-1, 1, -1, -1, 1, 1, -1, -1, 1, -1, 1, 1]);
export const eye = new Float32Array([0.5, 0.5, -0.4]);
export const time = Date.now();
// Issue #56: procedural gradient environment (IBL) — sky above, ground below.
export const environment = {
  top: new Float32Array([0.55, 0.7, 0.95]),
  bottom: new Float32Array([0.25, 0.2, 0.15]),
  intensity: 1.0,
};

export const light = {
  position: new Float32Array([0.5, 0.96, 0.0]),
  color: new Float32Array([9.0, 9.0, 9.0]),
  normal: new Float32Array([0.0, -1.0, 0.0]),
  size: new Float32Array([0.1, 0.15]),
};

triangles.forEach((triangle, i) => {
  const offset = i * TRIANGLE_VEC_VALUE_COUNT;
  flattenedTriangles.set(triangle.vertex1, offset);
  flattenedTriangles.set(triangle.vertex2, offset + 3);
  flattenedTriangles.set(triangle.vertex3, offset + 6);
  flattenedTriangles.set(triangle.normal, offset + 9);
  flattenedTriangles.set(triangle.color, offset + 12);
  // Issue #57: slots 5-6 carry two packed UV pairs and the packed texture ids
  // (albedo id in slot-6 .z, normal id in slot-6 .w; -1 = no texture).
  // Triangles without explicit UVs get a default (0,0)-(1,0)-(1,1) mapping.
  const uvOffset = offset + 15;
  const uvs = triangle.uv ?? [
    new Float32Array([0, 0]),
    new Float32Array([1, 0]),
    new Float32Array([1, 1]),
  ];
  // Slot 5 = vec4(uv1.x, uv1.y, uv2.x, uv2.y), slot 6 = vec4(uv3.x, uv3.y, texIdA, texIdB).
  flattenedTriangles.set(uvs[0], uvOffset);
  flattenedTriangles.set(uvs[1], uvOffset + 2);
  flattenedTriangles.set(uvs[2], uvOffset + 4);
  const textures = triangle.textures ?? [NO_TEXTURE, NO_TEXTURE];
  flattenedTriangles[uvOffset + 6] = textures[0];
  flattenedTriangles[uvOffset + 7] = textures[1];
});

ellipsoids.forEach((ellipsoid, i) => {
  const offset = i * ELLIPSOID_VEC_VALUE_COUNT;
  flattenedEllipsoids.set(ellipsoid.position, offset);
  flattenedEllipsoids.set(ellipsoid.radius, offset + 3);
  flattenedEllipsoids.set(ellipsoid.color, offset + 6);
  flattenedEllipsoids.set(ellipsoid.material, offset + 9);
});
