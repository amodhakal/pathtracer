const ELLIPSOID_VEC_VALUE_COUNT = 9;
const TRIANGLE_VEC_VALUE_COUNT = 15;

export const vertices = new Float32Array([
  -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, 1, 1,
]);

// Camera INSIDE the box, near the back, looking forward
// Scaled to [-1, 1] viewport space
export const eye = new Float32Array([0.5, 0.5, -0.5]);

export const time = Date.now();

export const light = {
  // Light source inside the box
  position: new Float32Array([0.5, 0.9, 0.3]),
  color: new Float32Array([1.0, 1.0, 1.0]),
};

// Scene geometry (unit cube from 0-1 in all axes)
const triangles = [
  // Left face (x=0, red)
  {
    vertex1: new Float32Array([0.0, 0.0, 0.0]),
    vertex2: new Float32Array([0.0, 1.0, 0.0]),
    vertex3: new Float32Array([0.0, 0.0, 1.0]),
    normal: new Float32Array([1.0, 0.0, 0.0]),  // Points inward
    color: new Float32Array([0.8, 0.0, 0.0]),
  },
  {
    vertex1: new Float32Array([0.0, 1.0, 0.0]),
    vertex2: new Float32Array([0.0, 1.0, 1.0]),
    vertex3: new Float32Array([0.0, 0.0, 1.0]),
    normal: new Float32Array([1.0, 0.0, 0.0]),
    color: new Float32Array([0.8, 0.0, 0.0]),
  },

  // Right face (x=1, blue)
  {
    vertex1: new Float32Array([1.0, 0.0, 0.0]),
    vertex2: new Float32Array([1.0, 1.0, 0.0]),
    vertex3: new Float32Array([1.0, 0.0, 1.0]),
    normal: new Float32Array([-1.0, 0.0, 0.0]),  // Points inward
    color: new Float32Array([0.0, 0.0, 0.8]),
  },
  {
    vertex1: new Float32Array([1.0, 1.0, 0.0]),
    vertex2: new Float32Array([1.0, 1.0, 1.0]),
    vertex3: new Float32Array([1.0, 0.0, 1.0]),
    normal: new Float32Array([-1.0, 0.0, 0.0]),
    color: new Float32Array([0.0, 0.0, 0.8]),
  },

  // Back face (z=1, white)
  {
    vertex1: new Float32Array([0.0, 0.0, 1.0]),
    vertex2: new Float32Array([1.0, 0.0, 1.0]),
    vertex3: new Float32Array([0.0, 1.0, 1.0]),
    normal: new Float32Array([0.0, 0.0, -1.0]),  // Points inward
    color: new Float32Array([1.0, 1.0, 1.0]),
  },
  {
    vertex1: new Float32Array([1.0, 0.0, 1.0]),
    vertex2: new Float32Array([1.0, 1.0, 1.0]),
    vertex3: new Float32Array([0.0, 1.0, 1.0]),
    normal: new Float32Array([0.0, 0.0, -1.0]),
    color: new Float32Array([1.0, 1.0, 1.0]),
  },

  // Top face (y=1, gray)
  {
    vertex1: new Float32Array([0.0, 1.0, 0.0]),
    vertex2: new Float32Array([0.0, 1.0, 1.0]),
    vertex3: new Float32Array([1.0, 1.0, 0.0]),
    normal: new Float32Array([0.0, -1.0, 0.0]),  // Points inward
    color: new Float32Array([0.8, 0.8, 0.8]),
  },
  {
    vertex1: new Float32Array([1.0, 1.0, 0.0]),
    vertex2: new Float32Array([0.0, 1.0, 1.0]),
    vertex3: new Float32Array([1.0, 1.0, 1.0]),
    normal: new Float32Array([0.0, -1.0, 0.0]),
    color: new Float32Array([0.8, 0.8, 0.8]),
  },

  // Bottom face (y=0, gray)
  {
    vertex1: new Float32Array([0.0, 0.0, 0.0]),
    vertex2: new Float32Array([1.0, 0.0, 0.0]),
    vertex3: new Float32Array([0.0, 0.0, 1.0]),
    normal: new Float32Array([0.0, 1.0, 0.0]),  // Points inward
    color: new Float32Array([0.8, 0.8, 0.8]),
  },
  {
    vertex1: new Float32Array([1.0, 0.0, 0.0]),
    vertex2: new Float32Array([1.0, 0.0, 1.0]),
    vertex3: new Float32Array([0.0, 0.0, 1.0]),
    normal: new Float32Array([0.0, 1.0, 0.0]),
    color: new Float32Array([0.8, 0.8, 0.8]),
  },


  // front face (z=1, white)
  {
    vertex1: new Float32Array([0.0, 0.0, -1.0]),
    vertex2: new Float32Array([1.0, 0.0, -1.0]),
    vertex3: new Float32Array([0.0, 1.0, -1.0]),
    normal: new Float32Array([0.0, 0.0, 1.0]),  // Points inward
    color: new Float32Array([1.0, 1.0, 1.0]),
  },
  {
    vertex1: new Float32Array([1.0, 0.0,- 1.0]),
    vertex2: new Float32Array([1.0, 1.0, -1.0]),
    vertex3: new Float32Array([0.0, 1.0, -1.0]),
    normal: new Float32Array([0.0, 0.0, 1.0]),
    color: new Float32Array([1.0, 1.0, 1.0]),
  },
];

export const flattenedTriangles = new Float32Array(
  triangles.length * TRIANGLE_VEC_VALUE_COUNT
);

// Ellipsoids positioned inside the cube
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

triangles.forEach((triangle, i) => {
  const offset = i * TRIANGLE_VEC_VALUE_COUNT;
  flattenedTriangles.set(triangle.vertex1, offset);
  flattenedTriangles.set(triangle.vertex2, offset + 3);
  flattenedTriangles.set(triangle.vertex3, offset + 6);
  flattenedTriangles.set(triangle.normal, offset + 9);
  flattenedTriangles.set(triangle.color, offset + 12);
});

export const flattenedEllipsoids = new Float32Array(
  ellipsoids.length * ELLIPSOID_VEC_VALUE_COUNT
);

ellipsoids.forEach((ellipsoid, i) => {
  const offset = i * ELLIPSOID_VEC_VALUE_COUNT;
  flattenedEllipsoids.set(ellipsoid.position, offset);
  flattenedEllipsoids.set(ellipsoid.radius, offset + 3);
  flattenedEllipsoids.set(ellipsoid.color, offset + 6);
});
