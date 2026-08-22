export const IS_PATHTRACING = false;

// Material encoding packed as vec3(x = material type, y = index of refraction, z = opacity)
export const MATERIAL_DIFFUSE = 0;
export const MATERIAL_MIRROR = 1;
export const MATERIAL_GLASS = 2;

export const DEFAULT_IOR = 1.0;
export const DEFAULT_OPACITY = 0.0;
export const GLASS_IOR = 1.33;
export const GLASS_OPACITY = 0.05;

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
];

export const ELLIPSOID_COUNT = ellipsoids.length;
// Upload stride: one vec4 slot per vec3 value. GLSL array uniforms of vec3 are
// packed with a 4-float stride, so uploading only 12 floats per ellipsoid would
// leave the last vec3 slot of each ellipsoid (and trailing ellipsoids when the
// shader's ELLIPSOID_COUNT exceeds the scene data) reading uninitialized zeros.
// Zero-padding keeps every uniform slot initialized.
export const ELLIPSOID_UPLOAD_STRIDE = 16;
const TRIANGLE_VEC_VALUE_COUNT = 15;
export const flattenedTriangles = new Float32Array(triangles.length * TRIANGLE_VEC_VALUE_COUNT);
export const flattenedEllipsoids = new Float32Array(ELLIPSOID_COUNT * ELLIPSOID_UPLOAD_STRIDE);
export const vertices = new Float32Array([-1, 1, -1, -1, 1, 1, -1, -1, 1, -1, 1, 1]);
export const eye = new Float32Array([0.5, 0.5, -0.4]);
export const time = Date.now();
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
  const offset = i * ELLIPSOID_UPLOAD_STRIDE;
  flattenedEllipsoids.set(ellipsoid.position, offset);
  flattenedEllipsoids.set(ellipsoid.radius, offset + 4);
  flattenedEllipsoids.set(ellipsoid.color, offset + 8);
  flattenedEllipsoids.set(ellipsoid.material, offset + 12);
});
