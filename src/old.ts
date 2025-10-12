// Path Tracing Logic
function dirIllum(
  point: vec3,
  normal: vec3,
  material: Material,
  light: LightSource,
): vec4 {
  const lightPosition = vec3.fromValues(
    light.positionX,
    light.positionY,
    light.positionZ
  );
  const toLightVector = vec3.subtract(vec3.create(), lightPosition, point);
  const lightDist = vec3.length(toLightVector);
  const lightDirection = vec3.normalize(vec3.create(), toLightVector);

  const { intersection: shadowIsect } = scene.findClosestIntersection([
    point,
    lightDirection,
  ]);
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
  const { intersection, object /* Normal and color */ } =
    scene.findClosestIntersection(ray);
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
