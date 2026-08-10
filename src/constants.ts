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
  },
  {
    position: new Float32Array([0.3, 0.3, 0.3]),
    radius: new Float32Array([0.1, 0.1, 0.1]),
    color: new Float32Array([0.9, 0.9, 0.9]),
  },
];

const ELLIPSOID_VEC_VALUE_COUNT = 9;
const TRIANGLE_VEC_VALUE_COUNT = 15;
export const flattenedTriangles = new Float32Array(triangles.length * TRIANGLE_VEC_VALUE_COUNT);
export const flattenedEllipsoids = new Float32Array(ellipsoids.length * ELLIPSOID_VEC_VALUE_COUNT);
export const vertices = new Float32Array([-1, 1, -1, -1, 1, 1, -1, -1, 1, -1, 1, 1]);
export const eye = new Float32Array([0.5, 0.5, -0.4]);
export const time = Date.now();
export const light = {
  position: new Float32Array([0.5, 0.96, 0.0]),
  color: new Float32Array([1.0, 1.0, 1.0]),
  normal: new Float32Array([0.0, -1.0, 0.0]),
  size: new Float32Array([0.25, 0.25]),
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
});
