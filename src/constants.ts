const ELLIPSOID_VEC_VALUE_COUNT = 9;
const TRIANGLE_VEC_VALUE_COUNT = 15;

export const vertices = new Float32Array([
  -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, 1, 1,
]);
export const eye = new Float32Array([0.0, 0.0, -0.5]);

export const light = {
  position: new Float32Array([0.0, 0.9999, 0.5]),
  color: new Float32Array([1.0, 1.0, 1.0]),
};

const triangles = [
  {
    vertex1: new Float32Array([0.0, 0.0, 0.0]),
    vertex2: new Float32Array([0.0, 1.0, 0.0]),
    vertex3: new Float32Array([0.0, 0.0, 1.0]),
    normal: new Float32Array([1.0, 0.0, 0.0]),
    color: new Float32Array([0.8, 0.0, 0.0]),
  },
  {
    vertex1: new Float32Array([0.0, 1.0, 0.0]),
    vertex2: new Float32Array([0.0, 1.0, 1.0]),
    vertex3: new Float32Array([0.0, 0.0, 1.0]),
    normal: new Float32Array([1.0, 0.0, 0.0]),
    color: new Float32Array([0.8, 0.0, 0.0]),
  },

  {
    vertex1: new Float32Array([1.0, 0.0, 0.0]),
    vertex2: new Float32Array([1.0, 0.0, 1.0]),
    vertex3: new Float32Array([1.0, 1.0, 0.0]),
    normal: new Float32Array([-1.0, 0.0, 0.0]),
    color: new Float32Array([0.0, 0.0, 0.8]),
  },
  {
    vertex1: new Float32Array([1.0, 1.0, 0.0]),
    vertex2: new Float32Array([1.0, 0.0, 1.0]),
    vertex3: new Float32Array([1.0, 1.0, 1.0]),
    normal: new Float32Array([-1.0, 0.0, 0.0]),
    color: new Float32Array([0.0, 0.0, 0.8]),
  },

  {
    vertex1: new Float32Array([0.0, 0.0, 1.0]),
    vertex2: new Float32Array([0.0, 1.0, 1.0]),
    vertex3: new Float32Array([1.0, 0.0, 1.0]),
    normal: new Float32Array([0.0, 0.0, -1.0]),
    color: new Float32Array([0.8, 0.8, 0.8]),
  },
  {
    vertex1: new Float32Array([1.0, 0.0, 1.0]),
    vertex2: new Float32Array([0.0, 1.0, 1.0]),
    vertex3: new Float32Array([1.0, 1.0, 1.0]),
    normal: new Float32Array([0.0, 0.0, -1.0]),
    color: new Float32Array([0.8, 0.8, 0.8]),
  },

  {
    vertex1: new Float32Array([0.0, 1.0, 0.0]),
    vertex2: new Float32Array([1.0, 1.0, 0.0]),
    vertex3: new Float32Array([0.0, 1.0, 1.0]),
    normal: new Float32Array([0.0, -1.0, 0.0]),
    color: new Float32Array([0.8, 0.8, 0.8]),
  },
  {
    vertex1: new Float32Array([1.0, 1.0, 0.0]),
    vertex2: new Float32Array([1.0, 1.0, 1.0]),
    vertex3: new Float32Array([0.0, 1.0, 1.0]),
    normal: new Float32Array([0.0, -1.0, 0.0]),
    color: new Float32Array([0.8, 0.8, 0.8]),
  },

  {
    vertex1: new Float32Array([0.0, 0.0, 0.0]),
    vertex2: new Float32Array([0.0, 0.0, 1.0]),
    vertex3: new Float32Array([1.0, 0.0, 0.0]),
    normal: new Float32Array([0.0, 1.0, 0.0]),
    color: new Float32Array([0.8, 0.8, 0.8]),
  },
  {
    vertex1: new Float32Array([1.0, 0.0, 0.0]),
    vertex2: new Float32Array([0.0, 0.0, 1.0]),
    vertex3: new Float32Array([1.0, 0.0, 1.0]),
    normal: new Float32Array([0.0, 1.0, 0.0]),
    color: new Float32Array([0.8, 0.8, 0.8]),
  },

  {
    vertex1: new Float32Array([0.0, 0.0, 0.0]),
    vertex2: new Float32Array([1.0, 0.0, 0.0]),
    vertex3: new Float32Array([0.0, 1.0, 0.0]),
    normal: new Float32Array([0.0, 0.0, 1.0]),
    color: new Float32Array([0.8, 0.8, 0.8]),
  },
  {
    vertex1: new Float32Array([1.0, 0.0, 0.0]),
    vertex2: new Float32Array([1.0, 1.0, 0.0]),
    vertex3: new Float32Array([0.0, 1.0, 0.0]),
    normal: new Float32Array([0.0, 0.0, 1.0]),
    color: new Float32Array([0.8, 0.8, 0.8]),
  },
];

export const flattenedTriangles = new Float32Array(
  triangles.length * TRIANGLE_VEC_VALUE_COUNT
);

const ellipsoids = [
  {
    position: new Float32Array([0.0, 0.0, 0.3]),
    radius: new Float32Array([0.3, 0.3, 0.3]),
    color: new Float32Array([1.0, 0.8, 0.0]),
  },
  {
    position: new Float32Array([0.3, 0.5, 0.2]),
    radius: new Float32Array([0.06, 0.06, 0.06]),
    color: new Float32Array([0.7, 0.7, 0.7]),
  },
];

export const flattenedEllipsoids = new Float32Array(
  ellipsoids.length * ELLIPSOID_VEC_VALUE_COUNT
);
