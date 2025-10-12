import { vec3, vec4 } from "gl-matrix";

// Interfaces and Types
interface LightSource {
  positionX: number;
  positionY: number;
  positionZ: number;
  color: [number, number, number];
}

interface Material {
  color: [number, number, number];
}

interface EllipsoidShape extends Material {
  centerX: number;
  centerY: number;
  centerZ: number;
  radiusX: number;
  radiusY: number;
  radiusZ: number;
}

type Point3D = [number, number, number];
type Triangle3D = [Point3D, Point3D, Point3D];
type Ray3D = [vec3, vec3];

type IntersectionFound = {
  exists: true;
  intersectionPoint: vec3;
  distance: number;
};

type IntersectionNotFound = {
  exists: false;
  intersectionPoint: typeof NaN;
  distance: typeof NaN;
};

type Intersection = IntersectionFound | IntersectionNotFound;

interface WallData {
  triangles: Triangle3D[];
  surfaceNormal: vec3;
  material: Material;
}

interface HittableObject {
  intersect(ray: Ray3D, minDistance: number): Intersection;
  material: Material;
  calculateNormal(point: vec3): vec3;
}

// HittableObject Classes
class Ellipsoid implements HittableObject {
  center: vec3;
  radii: vec3;
  radiiSquared: vec3;
  material: Material;

  constructor(ellipsoid: EllipsoidShape) {
    this.center = vec3.fromValues(
      ellipsoid.centerX,
      ellipsoid.centerY,
      ellipsoid.centerZ
    );
    this.radii = vec3.fromValues(
      ellipsoid.radiusX,
      ellipsoid.radiusY,
      ellipsoid.radiusZ
    );
    this.radiiSquared = vec3.multiply(vec3.create(), this.radii, this.radii);
    this.material = ellipsoid;
  }

  calculateNormal(point: vec3): vec3 {
    const normalVector = vec3.subtract(vec3.create(), point, this.center);
    vec3.divide(normalVector, normalVector, this.radiiSquared);
    return vec3.normalize(normalVector, normalVector);
  }

  intersect(ray: Ray3D, minDistance: number): Intersection {
    return calculateRayEllipsoidIntersection(ray, this, minDistance);
  }
}

class Triangle implements HittableObject {
  vertex0: vec3;
  vertex1: vec3;
  vertex2: vec3;
  surfaceNormal: vec3;
  material: Material;

  constructor(triangle: Triangle3D, normal: vec3, material: Material) {
    this.vertex0 = vec3.fromValues(
      triangle[0][0],
      triangle[0][1],
      triangle[0][2]
    );
    this.vertex1 = vec3.fromValues(
      triangle[1][0],
      triangle[1][1],
      triangle[1][2]
    );
    this.vertex2 = vec3.fromValues(
      triangle[2][0],
      triangle[2][1],
      triangle[2][2]
    );
    this.surfaceNormal = normal;
    this.material = material;
  }

  calculateNormal(_point: vec3): vec3 {
    return this.surfaceNormal;
  }

  intersect(ray: Ray3D, minDistance: number): Intersection {
    return calculateRayTriangleIntersection(ray, this, minDistance);
  }
}

class Scene {
  hittableObjects: HittableObject[] = [];

  addObject(object: HittableObject): void {
    this.hittableObjects.push(object);
  }

  findClosestIntersection(
    ray: Ray3D,
    minDistance: number
  ): {
    intersection: Intersection;
    object: HittableObject | null;
  } {
    let closestDistance = Number.MAX_VALUE;
    let closestIntersection: Intersection = {
      exists: false,
      intersectionPoint: NaN,
      distance: NaN,
    };
    let closestObject: HittableObject | null = null;

    for (const object of this.hittableObjects) {
      const intersection = object.intersect(ray, minDistance);
      if (intersection.exists && intersection.distance < closestDistance) {
        closestDistance = intersection.distance;
        closestIntersection = intersection;
        closestObject = object;
      }
    }

    return { intersection: closestIntersection, object: closestObject };
  }
}

// Temp vectors to avoid allocations in critical loops
const triangleEdge1 = vec3.create();
const triangleEdge2 = vec3.create();
const perpendicularVector = vec3.create();
const originToVertex = vec3.create();
const qVector = vec3.create();
const tempIntersectionPoint = vec3.create();

// Constants

const CORNELL_BOX_DATA: { [key: string]: WallData } = {
  leftWall: {
    triangles: [
      [
        [0, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      [
        [0, 1, 0],
        [0, 1, 1],
        [0, 0, 1],
      ],
    ],
    surfaceNormal: vec3.fromValues(1, 0, 0),
    material: { color: [0.8, 0, 0] },
  },
  rightWall: {
    triangles: [
      [
        [1, 0, 0],
        [1, 0, 1],
        [1, 1, 0],
      ],
      [
        [1, 1, 0],
        [1, 0, 1],
        [1, 1, 1],
      ],
    ],
    surfaceNormal: vec3.fromValues(-1, 0, 0),
    material: { color: [0, 0, 0.8] },
  },
  backWall: {
    triangles: [
      [
        [0, 0, 1],
        [0, 1, 1],
        [1, 0, 1],
      ],
      [
        [1, 0, 1],
        [0, 1, 1],
        [1, 1, 1],
      ],
    ],
    surfaceNormal: vec3.fromValues(0, 0, -1),
    material: { color: [0.8, 0.8, 0.8] },
  },
  topWall: {
    triangles: [
      [
        [0, 1, 0],
        [1, 1, 0],
        [0, 1, 1],
      ],
      [
        [1, 1, 0],
        [1, 1, 1],
        [0, 1, 1],
      ],
    ],
    surfaceNormal: vec3.fromValues(0, -1, 0),
    material: { color: [0.8, 0.8, 0.8] },
  },
  bottomWall: {
    triangles: [
      [
        [0, 0, 0],
        [0, 0, 1],
        [1, 0, 0],
      ],
      [
        [1, 0, 0],
        [0, 0, 1],
        [1, 0, 1],
      ],
    ],
    surfaceNormal: vec3.fromValues(0, 1, 0),
    material: { color: [0.8, 0.8, 0.8] },
  },
  frontWall: {
    triangles: [
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
      [
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
      ],
    ],
    surfaceNormal: vec3.fromValues(0, 0, 1),
    material: { color: [0.8, 0.8, 0.8] },
  },
};

const scene = new Scene();
makeYourOwnEllipsoids.forEach((e) => scene.addObject(new Ellipsoid(e)));
Object.values(CORNELL_BOX_DATA).forEach((wall) => {
  wall.triangles.forEach((t) =>
    scene.addObject(new Triangle(t, wall.surfaceNormal, wall.material))
  );
});

// Path Tracing Logic
function dirIllum(
  point: vec3,
  normal: vec3,
  material: Material,
  light: LightSource,
  scene: Scene
): vec4 {
  const lightPosition = vec3.fromValues(
    light.positionX,
    light.positionY,
    light.positionZ
  );
  const toLightVector = vec3.subtract(vec3.create(), lightPosition, point);
  const lightDist = vec3.length(toLightVector);
  const lightDirection = vec3.normalize(vec3.create(), toLightVector);

  const { intersection: shadowIsect } = scene.findClosestIntersection(
    [point, lightDirection],
    0.001
  );
  if (shadowIsect.exists && shadowIsect.distance < lightDist) {
    return vec4.fromValues(0, 0, 0, 255); // In shadow
  }

  const G =
    (Math.max(0, vec3.dot(normal, lightDirection)) * 1.0) /
    (1.0 + lightDist * lightDist);
  const r = Math.min(255, 255 * light.color[0] * material.color[0] * G);
  const g = Math.min(255, 255 * light.color[1] * material.color[1] * G);
  const b = Math.min(255, 255 * light.color[2] * material.color[2] * G);

  return vec4.fromValues(r, g, b, 255);
}

function pathTracer(
  ray: Ray3D,
  light: LightSource,
  scene: Scene,
  depth: number
): vec4 {
  const { intersection, object } = scene.findClosestIntersection(ray, 0.001);
  if (!intersection.exists || !object) {
    return vec4.fromValues(0, 0, 0, 255); // Background color
  }

  const normal = object.calculateNormal(intersection.intersectionPoint);
  const directLight = dirIllum(
    intersection.intersectionPoint,
    normal,
    object.material,
    light,
    scene
  );
  const indirectLight = indirIllum(
    intersection.intersectionPoint,
    normal,
    object.material,
    light,
    scene,
    depth
  );

  const r = Math.min(255, directLight[0] + indirectLight[0]);
  const g = Math.min(255, directLight[1] + indirectLight[1]);
  const b = Math.min(255, directLight[2] + indirectLight[2]);

  return vec4.fromValues(r, g, b, 255);
}
