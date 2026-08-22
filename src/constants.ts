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

const triangles = [
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
  },
  {
    vertex1: new Float32Array([1.0, 0.0, 1.0]),
    vertex2: new Float32Array([1.0, 1.0, 1.0]),
    vertex3: new Float32Array([0.0, 1.0, 1.0]),
    normal: new Float32Array([0.0, 0.0, -1.0]),
    color: new Float32Array([1.0, 1.0, 1.0]),
  },

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

const ELLIPSOID_VEC_VALUE_COUNT = 12;
const TRIANGLE_VEC_VALUE_COUNT = 15;
export const flattenedTriangles = new Float32Array(triangles.length * TRIANGLE_VEC_VALUE_COUNT);
export const flattenedEllipsoids = new Float32Array(ellipsoids.length * ELLIPSOID_VEC_VALUE_COUNT);
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
});

ellipsoids.forEach((ellipsoid, i) => {
  const offset = i * ELLIPSOID_VEC_VALUE_COUNT;
  flattenedEllipsoids.set(ellipsoid.position, offset);
  flattenedEllipsoids.set(ellipsoid.radius, offset + 3);
  flattenedEllipsoids.set(ellipsoid.color, offset + 6);
  flattenedEllipsoids.set(ellipsoid.material, offset + 9);
});
