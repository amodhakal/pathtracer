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
