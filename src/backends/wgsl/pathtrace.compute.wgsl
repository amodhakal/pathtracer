// WebGPU backend path-trace compute kernel (issue #63).
//
// This is a faithful WGSL port of src/shaders/pathtrace.frag + its chunks
// (common, intersection, bvh, prng). The scene is uploaded once as storage
// buffers (vec4-packed to match the GLSL flattening), camera/light/env as a
// uniform, and the previous accumulation sum is read from a storage texture
// while the new sum is written to the ping-pong twin. Progressive accumulation
// (frameCount) is driven by the backend's render loop, exactly like the
// WebGL2 path.

// ---- tunable constants (mirror pathtrace.frag) ---------------------------
const CLIP_VAL: f32 = 0.00001;
const RAY_EPSILON: f32 = 0.001;
const MAX_BOUNCES: i32 = 200;
const LIGHT_SAMPLES: i32 = 4;
const P_BOUNCE: f32 = 0.5;
const FIREFLY_CLAMP: f32 = 10.0;
const GLASS_DISPERSION: f32 = 0.06;
const EMISSIVE_STRENGTH: f32 = 4.0;
const CAMERA_VERTICAL_FOV_DEG: f32 = 102.6802609247;
const MAX_TERM_COUNT: i32 = 2;
const ANIMATION_PERIOD: f32 = 8.0;
const PI: f32 = 3.14159265;

const MATERIAL_DIFFUSE: i32 = 0;
const MATERIAL_MIRROR: i32 = 1;
const MATERIAL_GLASS: i32 = 2;
const MATERIAL_GGX: i32 = 3;
const MATERIAL_EMISSIVE: i32 = 4;
const MATERIAL_CLEARCOAT: i32 = 5;
const MATERIAL_THINFILM: i32 = 6;

// ---- uniform / storage bindings ------------------------------------------
struct Uniforms {
  resolutionFrame: vec4<f32>,   // xy=resolution, z=frameCount, w=time
  eye: vec4<f32>,               // xyz=eye
  camForward: vec4<f32>,        // xyz
  camRight: vec4<f32>,          // xyz
  camUp: vec4<f32>,             // xyz
  lightPosColor: vec4<f32>,     // pos.xyz, color.x
  lightColorNormal: vec4<f32>,  // color.yz, normal.xy
  lightNormalSize: vec4<f32>,   // normal.z, size.xy
  envTop: vec4<f32>,            // xyz
  envBottomIntensity: vec4<f32>,// bottom.xyz, intensity
  params: vec4<f32>,            // apertureRadius, focalDistance, _, _
  counts: vec4<u32>,            // triangleCount, ellipsoidCount, bvhNodeCount, _
};

@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var<storage, read> u_Ellipsoids: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> u_Triangles: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> u_BvhNodes: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> u_BvhPrimIndices: array<vec4<f32>>;
@group(0) @binding(5) var accumPrev: texture_2d<f32>;
@group(0) @binding(6) var accumNext: texture_storage_2d<rgba32float, write>;

// ---- structs --------------------------------------------------------------
struct Light {
  position: vec3<f32>,
  color: vec3<f32>,
  normal: vec3<f32>,
  size: vec2<f32>,
};

struct Ellipsoid {
  center: vec3<f32>,
  radius: vec3<f32>,
  color: vec3<f32>,
  material: vec3<f32>,
};

struct Triangle {
  v1: vec3<f32>,
  v2: vec3<f32>,
  v3: vec3<f32>,
  normal: vec3<f32>,
  color: vec3<f32>,
  uv1: vec2<f32>,
  uv2: vec2<f32>,
  uv3: vec2<f32>,
  textures: vec2<f32>,
};

struct Intersect {
  isExisting: bool,
  distance: f32,
  point: vec3<f32>,
  color: vec3<f32>,
  normal: vec3<f32>,
  material: vec3<f32>,
  uv: vec2<f32>,
  textures: vec2<f32>,
};

struct QuadResult {
  termCount: i32,
  terms: vec2<f32>,
};

struct BvhHit {
  isExisting: bool,
  primIndex: i32,
  isTriangle: bool,
};

struct RefractResult {
  dir: vec3<f32>,
  tir: bool,
};

struct GlassResult {
  dir: vec3<f32>,
  weight: vec3<f32>,
  survived: bool,
};

// ---- PRNG (PCG3D, Jarzynski & Olano 2020) --------------------------------
var<private> prngState: vec3<u32>;

fn initRng(windowPixel: vec2<f32>, frame: f32) {
  prngState = vec3<u32>(
    u32(max(windowPixel.x, 0.0)),
    u32(max(windowPixel.y, 0.0)),
    u32(max(frame, 0.0))
  );
}

fn nextRandom() -> f32 {
  prngState = prngState * 1664525u + 1013904223u;
  var h = prngState;
  h.x = h.x + h.y * h.z;
  h.y = h.y + h.z * h.x;
  h.z = h.z + h.x * h.y;
  h.x = h.x ^ (h.x >> 16u);
  h.y = h.y ^ (h.y >> 16u);
  h.z = h.z ^ (h.z >> 16u);
  return f32(h.x) * (1.0 / 4294967296.0);
}

// ---- small math helpers ---------------------------------------------------
fn basisTangent(n: vec3<f32>) -> vec3<f32> {
  let b = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(n.x) > 0.9);
  return normalize(cross(b, n));
}

fn calculateReflection(incident: vec3<f32>, faceNormal: vec3<f32>) -> vec3<f32> {
  return incident - 2.0 * dot(faceNormal, incident) * faceNormal;
}

fn isEmitter(material: vec3<f32>) -> bool {
  return i32(material.x + 0.5) == MATERIAL_EMISSIVE;
}

fn isEmissiveMaterial(material: vec3<f32>) -> bool {
  return i32(material.x + 0.5) == MATERIAL_EMISSIVE;
}

// ---- issue #65: animated ellipsoid offset ---------------------------------
fn animatedEllipsoidOffset(index: i32) -> vec3<f32> {
  if (index != 0) {
    return vec3<f32>(0.0);
  }
  let phase = 2.0 * PI * U.resolutionFrame.w / ANIMATION_PERIOD;
  return vec3<f32>(0.25 * sin(phase), 0.1 * sin(2.0 * phase), 0.25 * cos(phase));
}

fn ellipsoidCenter(index: i32) -> vec3<f32> {
  return ellipsoidAt(index).center + animatedEllipsoidOffset(index);
}

// ---- scene accessors ------------------------------------------------------
fn ellipsoidAt(i: i32) -> Ellipsoid {
  let b = i * 4;
  var e: Ellipsoid;
  e.center = u_Ellipsoids[b + 0].xyz;
  e.radius = u_Ellipsoids[b + 1].xyz;
  e.color = u_Ellipsoids[b + 2].xyz;
  e.material = u_Ellipsoids[b + 3].xyz;
  return e;
}

fn triangleAt(i: i32) -> Triangle {
  let b = i * 8;
  var t: Triangle;
  t.v1 = u_Triangles[b + 0].xyz;
  t.v2 = u_Triangles[b + 1].xyz;
  t.v3 = u_Triangles[b + 2].xyz;
  t.normal = u_Triangles[b + 3].xyz;
  t.color = u_Triangles[b + 4].xyz;
  t.uv1 = u_Triangles[b + 5].xy;
  t.uv2 = u_Triangles[b + 5].zw;
  t.uv3 = u_Triangles[b + 6].xy;
  t.textures = u_Triangles[b + 6].zw;
  return t;
}

fn bvhNodeMin(i: i32) -> vec3<f32> { return u_BvhNodes[i * 3 + 0].xyz; }
fn bvhNodeMax(i: i32) -> vec3<f32> { return u_BvhNodes[i * 3 + 1].xyz; }
fn bvhNodePrim(i: i32) -> vec2<f32> { return u_BvhNodes[i * 3 + 2].xy; }

fn noHit() -> Intersect {
  return Intersect(false, 0.0, vec3<f32>(0.0), vec3<f32>(0.0), vec3<f32>(0.0),
    vec3<f32>(0.0), vec2<f32>(0.0), vec2<f32>(-1.0));
}

// ---- quadratic solver -----------------------------------------------------
fn solveQuad(quads: vec3<f32>) -> QuadResult {
  let a = quads.x;
  let b = quads.y;
  let c = quads.z;
  let halfB = 0.5 * b;
  let discriminant = halfB * halfB - a * c;
  if (discriminant < 0.0) {
    return QuadResult(0, vec2<f32>(0.0));
  }
  let sqrtDiscriminant = sqrt(discriminant);
  let q = select(-(halfB - sqrtDiscriminant), -(halfB + sqrtDiscriminant), halfB > 0.0);
  let term1 = q / a;
  let term2 = c / q;
  if (term1 < term2) {
    return QuadResult(2, vec2<f32>(term1, term2));
  }
  return QuadResult(2, vec2<f32>(term2, term1));
}

// ---- full ellipsoid intersection -----------------------------------------
fn calculateRayEllipsoidIntersect(point: vec3<f32>, direction: vec3<f32>, ellipsoid: Ellipsoid) -> Intersect {
  let firstResult = direction / ellipsoid.radius;
  let secondResult = point - ellipsoid.center;
  let thirdResult = secondResult / ellipsoid.radius;
  let quadA = dot(firstResult, firstResult);
  let quadB = 2.0 * dot(firstResult, thirdResult);
  let quadC = dot(thirdResult, thirdResult) - 1.0;
  let result = solveQuad(vec3<f32>(quadA, quadB, quadC));
  for (var idx: i32 = 0; idx < MAX_TERM_COUNT; idx = idx + 1) {
    if (idx >= result.termCount) { break; }
    let term = result.terms[idx];
    if (term < CLIP_VAL) { continue; }
    let intersect = point + direction * term;
    var normal = intersect - ellipsoid.center;
    normal = normal / (ellipsoid.radius * ellipsoid.radius);
    normal = normalize(normal);
    return Intersect(true, term, intersect, ellipsoid.color, normal, ellipsoid.material,
      vec2<f32>(0.0), vec2<f32>(-1.0));
  }
  return noHit();
}

// ---- full triangle intersection ------------------------------------------
fn calculateRayTriangleIntersect(point: vec3<f32>, direction: vec3<f32>, triangle: Triangle) -> Intersect {
  let edge1 = triangle.v2 - triangle.v1;
  let edge2 = triangle.v3 - triangle.v1;
  let orthogonal = cross(direction, edge2);
  let determinant = dot(triangle.v1 - point, orthogonal);
  if (abs(determinant) < CLIP_VAL) { return noHit(); }
  let inverseDeterminant = 1.0 / determinant;
  let pointToVertex = point - triangle.v1;
  let uValue = dot(pointToVertex, orthogonal) * inverseDeterminant;
  if (uValue < 0.0 || uValue > 1.0) { return noHit(); }
  let cv = cross(pointToVertex, edge1);
  let vValue = dot(direction, cv) * inverseDeterminant;
  if (vValue < 0.0 || uValue + vValue > 1.0) { return noHit(); }
  let term = dot(edge2, cv) * inverseDeterminant;
  if (term < CLIP_VAL) { return noHit(); }
  let intersect = point + direction * term;
  let uv = triangle.uv1 + uValue * (triangle.uv2 - triangle.uv1) + vValue * (triangle.uv3 - triangle.uv1);
  return Intersect(true, term, intersect, triangle.color, triangle.normal, vec3<f32>(0.0), uv, triangle.textures);
}

// ---- distance-only variants (BVH traversal) ------------------------------
fn ellipsoidHitDistance(point: vec3<f32>, direction: vec3<f32>, ellipsoid: Ellipsoid, maxDistance: f32) -> f32 {
  let firstResult = direction / ellipsoid.radius;
  let secondResult = point - ellipsoid.center;
  let thirdResult = secondResult / ellipsoid.radius;
  let result = solveQuad(vec3<f32>(
    dot(firstResult, firstResult),
    2.0 * dot(firstResult, thirdResult),
    dot(thirdResult, thirdResult) - 1.0));
  for (var idx: i32 = 0; idx < MAX_TERM_COUNT; idx = idx + 1) {
    if (idx >= result.termCount) { break; }
    let term = result.terms[idx];
    if (term >= CLIP_VAL && term < maxDistance) { return term; }
  }
  return -1.0;
}

fn triangleHitDistance(point: vec3<f32>, direction: vec3<f32>, triangle: Triangle, maxDistance: f32) -> f32 {
  let edge1 = triangle.v2 - triangle.v1;
  let edge2 = triangle.v3 - triangle.v1;
  let orthogonal = cross(direction, edge2);
  let determinant = dot(edge1, orthogonal);
  if (abs(determinant) < CLIP_VAL) { return -1.0; }
  let inverseDeterminant = 1.0 / determinant;
  let pointToVertex = point - triangle.v1;
  let uValue = dot(pointToVertex, orthogonal) * inverseDeterminant;
  if (uValue < 0.0 || uValue > 1.0) { return -1.0; }
  let crossVector = cross(pointToVertex, edge1);
  let vValue = dot(direction, crossVector) * inverseDeterminant;
  if (vValue < 0.0 || uValue + vValue > 1.0) { return -1.0; }
  let term = dot(edge2, crossVector) * inverseDeterminant;
  if (term < CLIP_VAL || term >= maxDistance) { return -1.0; }
  return term;
}

fn rayEllipsoidOccluded(point: vec3<f32>, direction: vec3<f32>, maxDistance: f32, ellipsoid: Ellipsoid) -> bool {
  let d = ellipsoidHitDistance(point, direction, ellipsoid, maxDistance);
  return d >= 0.0;
}

fn rayTriangleOccluded(point: vec3<f32>, direction: vec3<f32>, maxDistance: f32, triangle: Triangle) -> bool {
  let d = triangleHitDistance(point, direction, triangle, maxDistance);
  return d >= 0.0;
}

// ---- BVH traversal --------------------------------------------------------
fn bvhRayAabb(origin: vec3<f32>, invDirection: vec3<f32>, maxDistance: f32, bMin: vec3<f32>, bMax: vec3<f32>) -> bool {
  let t0s = (bMin - origin) * invDirection;
  let t1s = (bMax - origin) * invDirection;
  let tSmaller = min(t0s, t1s);
  let tLarger = max(t0s, t1s);
  let tNear = max(max(tSmaller.x, tSmaller.y), tSmaller.z);
  let tFar = min(min(tLarger.x, tLarger.y), tLarger.z);
  return tNear <= tFar && tFar > 0.0 && tNear < maxDistance;
}

fn aabbEntryDistance(origin: vec3<f32>, invDirection: vec3<f32>, nodeIndex: i32) -> f32 {
  let bMin = bvhNodeMin(nodeIndex);
  let bMax = bvhNodeMax(nodeIndex);
  let t0s = (bMin - origin) * invDirection;
  let t1s = (bMax - origin) * invDirection;
  let tSmaller = min(t0s, t1s);
  let tLarger = max(t0s, t1s);
  return max(max(tSmaller.x, tSmaller.y), tSmaller.z);
}

fn bvhClosestPrimitive(point: vec3<f32>, direction: vec3<f32>) -> BvhHit {
  var result: BvhHit;
  result.isExisting = false;
  result.primIndex = -1;
  result.isTriangle = false;
  var closestDistance: f32 = 1e20;
  let invDirection = 1.0 / direction;
  var stack: array<i32, 64>;
  var stackPtr: i32 = 0;
  stack[stackPtr] = 0;
  stackPtr = stackPtr + 1;
  let nodeCount = i32(U.counts.z);
  let triCount = i32(U.counts.x);

  loop {
    if (stackPtr <= 0) { break; }
    stackPtr = stackPtr - 1;
    let nodeIndex = stack[stackPtr];
    let bMin = bvhNodeMin(nodeIndex);
    let bMax = bvhNodeMax(nodeIndex);
    let primInfo = bvhNodePrim(nodeIndex);
    let primStart = i32(primInfo.x + 0.5);
    let primCount = i32(primInfo.y + 0.5);

    if (!bvhRayAabb(point, invDirection, closestDistance, bMin, bMax)) { continue; }

    if (primCount > 0) {
      for (var i: i32 = 0; i < primCount; i = i + 1) {
        let primIndex = i32(u_BvhPrimIndices[primStart + i].x + 0.5);
        var distance: f32 = -1.0;
        var hit: bool = false;
        if (primIndex < triCount) {
          let triangle = triangleAt(primIndex);
          distance = triangleHitDistance(point, direction, triangle, closestDistance);
          hit = distance >= 0.0;
        } else {
          let ell = ellipsoidAt(primIndex - triCount);
          distance = ellipsoidHitDistance(point, direction, ell, closestDistance);
          hit = distance >= 0.0;
        }
        if (hit && distance < closestDistance) {
          closestDistance = distance;
          result.isExisting = true;
          result.primIndex = primIndex;
          result.isTriangle = primIndex < triCount;
        }
      }
    } else {
      let left = 2 * nodeIndex + 1;
      let right = 2 * nodeIndex + 2;
      let leftT = aabbEntryDistance(point, invDirection, left);
      let rightT = aabbEntryDistance(point, invDirection, right);
      if (leftT <= rightT) {
        if (right < nodeCount) { stack[stackPtr] = right; stackPtr = stackPtr + 1; }
        if (left < nodeCount) { stack[stackPtr] = left; stackPtr = stackPtr + 1; }
      } else {
        if (left < nodeCount) { stack[stackPtr] = left; stackPtr = stackPtr + 1; }
        if (right < nodeCount) { stack[stackPtr] = right; stackPtr = stackPtr + 1; }
      }
    }
  }
  return result;
}

fn bvhAnyHit(point: vec3<f32>, direction: vec3<f32>, maxDistance: f32) -> bool {
  let invDirection = 1.0 / direction;
  var stack: array<i32, 64>;
  var stackPtr: i32 = 0;
  stack[stackPtr] = 0;
  stackPtr = stackPtr + 1;
  let nodeCount = i32(U.counts.z);
  let triCount = i32(U.counts.x);

  loop {
    if (stackPtr <= 0) { break; }
    stackPtr = stackPtr - 1;
    let nodeIndex = stack[stackPtr];
    let bMin = bvhNodeMin(nodeIndex);
    let bMax = bvhNodeMax(nodeIndex);
    let primInfo = bvhNodePrim(nodeIndex);
    if (!bvhRayAabb(point, invDirection, maxDistance, bMin, bMax)) { continue; }
    let primCount = i32(primInfo.y + 0.5);
    if (primCount > 0) {
      let primStart = i32(primInfo.x + 0.5);
      for (var i: i32 = 0; i < primCount; i = i + 1) {
        let primIndex = i32(u_BvhPrimIndices[primStart + i].x + 0.5);
        if (primIndex < triCount) {
          if (rayTriangleOccluded(point, direction, maxDistance, triangleAt(primIndex))) {
            return true;
          }
        } else {
          if (rayEllipsoidOccluded(point, direction, maxDistance, ellipsoidAt(primIndex - triCount))) {
            return true;
          }
        }
      }
    } else {
      stack[stackPtr] = 2 * nodeIndex + 1;
      stackPtr = stackPtr + 1;
      stack[stackPtr] = 2 * nodeIndex + 2;
      stackPtr = stackPtr + 1;
    }
  }
  return false;
}

fn findClosestIntersect(point: vec3<f32>, direction: vec3<f32>) -> Intersect {
  let bvhHit = bvhClosestPrimitive(point, direction);
  if (!bvhHit.isExisting || bvhHit.primIndex < 0) {
    return noHit();
  }
  let triCount = i32(U.counts.x);
  if (bvhHit.isTriangle) {
    return calculateRayTriangleIntersect(point, direction, triangleAt(bvhHit.primIndex));
  }
  return calculateRayEllipsoidIntersect(point, direction, ellipsoidAt(bvhHit.primIndex - triCount));
}

// ---- environment & shadow rays -------------------------------------------
fn evaluateEnvironment(direction: vec3<f32>) -> vec3<f32> {
  let t = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
  return mix(U.envBottomIntensity.xyz, U.envTop.xyz, t) * U.envBottomIntensity.w;
}

fn traceShadowRay(origin: vec3<f32>, direction: vec3<f32>) -> bool {
  let ellCount = i32(U.counts.y);
  for (var i: i32 = 0; i < ellCount; i = i + 1) {
    var ell: Ellipsoid;
    ell.center = ellipsoidCenter(i);
    ell.radius = u_Ellipsoids[i * 4 + 1].xyz;
    ell.color = u_Ellipsoids[i * 4 + 2].xyz;
    ell.material = u_Ellipsoids[i * 4 + 3].xyz;
    let shadowHit = calculateRayEllipsoidIntersect(origin, direction, ell);
    if (shadowHit.isExisting && shadowHit.distance > CLIP_VAL) {
      return true;
    }
  }
  let triCount = i32(U.counts.x);
  for (var i: i32 = 0; i < triCount; i = i + 1) {
    let tri = triangleAt(i);
    let shadowHit = calculateRayTriangleIntersect(origin, direction, tri);
    if (shadowHit.isExisting && shadowHit.distance > CLIP_VAL) {
      return true;
    }
  }
  return false;
}

fn sampleEnvironmentIllumination(point: vec3<f32>, normal: vec3<f32>, albedo: vec3<f32>) -> vec3<f32> {
  let basis = basisTangent(normal);
  let tangent = basis; // already normalized tangent
  let bitangent = cross(normal, tangent);
  let u1 = nextRandom();
  let u2 = nextRandom();
  let r = sqrt(u1);
  let phi = 6.283185307179586 * u2;
  let local = vec3<f32>(r * cos(phi), r * sin(phi), sqrt(max(1.0 - u1, 0.0)));
  let sampleDir = normalize(local.x * tangent + local.y * bitangent + local.z * normal);
  let ndotl = dot(normal, sampleDir);
  if (ndotl <= 0.0) { return vec3<f32>(0.0); }
  let shadowOrigin = point + normal * RAY_EPSILON;
  if (traceShadowRay(shadowOrigin, sampleDir)) {
    return vec3<f32>(0.0);
  }
  return evaluateEnvironment(sampleDir) * albedo;
}

fn calculateDirectIllumination(point: vec3<f32>, normal: vec3<f32>, color: vec3<f32>) -> vec3<f32> {
  // Light normal: packed as (color.yz, normal.xy) in lightColorNormal and
  // (normal.z, size.xy) in lightNormalSize. Reconstruct it.xyz here.
  let lnormal = vec3<f32>(U.lightColorNormal.zw, U.lightNormalSize.x);
  let ln = normalize(lnormal);
  let tangentB = basisTangent(ln);
  let lightTangent = tangentB;
  let lightBitangent = cross(ln, lightTangent);
  var accumulated = vec3<f32>(0.0);
  let lsize = U.lightNormalSize.yz;
  let lcolor = vec3<f32>(U.lightPosColor.w, U.lightColorNormal.xy);
  let lpos = U.lightPosColor.xyz;

  for (var s: i32 = 0; s < LIGHT_SAMPLES; s = s + 1) {
    let areaSample = vec2<f32>(nextRandom(), nextRandom());
    let lightPoint = lpos
      + lightTangent * ((areaSample.x - 0.5) * 2.0 * lsize.x)
      + lightBitangent * ((areaSample.y - 0.5) * 2.0 * lsize.y);
    let shadowRayOrigin = point + normal * RAY_EPSILON;
    let pointToLight = lightPoint - shadowRayOrigin;
    let lightDistance = length(pointToLight);
    let lightDirection = pointToLight / lightDistance;
    let ndotl = max(dot(normal, lightDirection), 0.0);
    let cosLight = max(dot(ln, -lightDirection), 0.0);
    if (ndotl <= 0.0 || cosLight <= 0.0) { continue; }

    let occluded = bvhAnyHit(shadowRayOrigin, lightDirection, lightDistance - RAY_EPSILON);
    if (occluded) { continue; }

    let lightArea = 4.0 * lsize.x * lsize.y;
    let pdfArea = 1.0 / max(lightArea, CLIP_VAL);
    let brdf = color * (1.0 / PI);
    let solidAngleConversion = cosLight / max(lightDistance * lightDistance, CLIP_VAL);
    accumulated = accumulated + lcolor * brdf * ndotl * solidAngleConversion / pdfArea;
  }
  return accumulated / f32(LIGHT_SAMPLES);
}

fn sampleBounceDirection(normal: vec3<f32>) -> vec3<f32> {
  let tangent = basisTangent(normal);
  let bitangent = cross(normal, tangent);
  let r = sqrt(nextRandom());
  let phi = 6.28318530718 * nextRandom();
  let x = r * cos(phi);
  let y = r * sin(phi);
  let z = sqrt(max(0.0, 1.0 - x * x - y * y));
  return x * tangent + y * bitangent + z * normal;
}

// ---- Fresnel / refraction / glass ----------------------------------------
fn fresnelSchlick(cosTheta: f32, ior: f32) -> f32 {
  let f0 = (ior - 1.0) / (ior + 1.0);
  let f0sq = f0 * f0;
  return f0sq + (1.0 - f0sq) * pow(1.0 - cosTheta, 5.0);
}

fn fresnelSchlickVec(cosTheta: f32, f0: vec3<f32>) -> vec3<f32> {
  return f0 + (vec3<f32>(1.0) - f0) * pow(1.0 - cosTheta, 5.0);
}

fn calculateRefraction(incident: vec3<f32>, faceNormal: vec3<f32>, ior: f32) -> RefractResult {
  let entering = dot(incident, faceNormal) < 0.0;
  let n = select(-faceNormal, faceNormal, entering);
  let eta = select(ior, 1.0 / ior, entering);
  let cosI = -dot(n, incident);
  let sinT2 = eta * eta * (1.0 - cosI * cosI);
  if (sinT2 >= 1.0) {
    return RefractResult(vec3<f32>(0.0), true);
  }
  let cosT = sqrt(1.0 - sinT2);
  return RefractResult(eta * incident + (eta * cosI - cosT) * n, false);
}

fn fresnelDielectric(cosThetaI: f32, eta: f32) -> f32 {
  let c = clamp(cosThetaI, -1.0, 1.0);
  let entering = c > 0.0;
  let ni = select(eta, 1.0, entering);
  let nt = select(1.0, eta, entering);
  let sinThetaI = sqrt(max(1.0 - c * c, 0.0));
  let sinThetaT = ni / max(nt, CLIP_VAL) * sinThetaI;
  if (sinThetaT >= 1.0) { return 1.0; }
  let cosThetaT = sqrt(max(1.0 - sinThetaT * sinThetaT, 0.0));
  let ca = abs(c);
  let rs = (ni * ca - nt * cosThetaT) / max(ni * ca + nt * cosThetaT, CLIP_VAL);
  let rp = (ni * cosThetaT - nt * ca) / max(ni * cosThetaT + nt * ca, CLIP_VAL);
  return 0.5 * (rs * rs + rp * rp);
}

fn sampleDispersiveIor(baseIor: f32) -> f32 {
  let channel = nextRandom() * 3.0;
  let offset = (floor(channel) - 1.0) * (2.0 / 3.0) * GLASS_DISPERSION;
  return max(baseIor + offset * (baseIor - 1.0), 1.0);
}

fn sampleGlassBsdf(incident: vec3<f32>, faceNormal: vec3<f32>, albedo: vec3<f32>, ior: f32, opacity: f32) -> GlassResult {
  let cosThetaI = dot(-incident, faceNormal);
  let entering = cosThetaI > 0.0;
  let eta = select(ior, 1.0 / ior, entering);
  let fresnel = fresnelDielectric(cosThetaI, eta);
  let refr = calculateRefraction(incident, faceNormal, ior);
  let tir = refr.tir;
  let isReflecting = tir || (nextRandom() < fresnel);
  var outDirection: vec3<f32>;
  var outWeight: vec3<f32>;
  if (isReflecting) {
    outDirection = normalize(calculateReflection(incident, faceNormal));
    outWeight = vec3<f32>(1.0);
  } else {
    outDirection = normalize(refr.dir);
    outWeight = mix(vec3<f32>(1.0), albedo, opacity);
  }
  let survived = max(max(outWeight.r, outWeight.g), outWeight.b) >= 0.001
    && dot(outDirection, faceNormal) != 0.0;
  return GlassResult(outDirection, outWeight, survived);
}

// ---- GGX / thin-film helpers ---------------------------------------------
fn buildOrthonormalBasis(normal: vec3<f32>) -> vec3<f32> {
  return basisTangent(normal);
}

fn ggxDistribution(ndoth: f32, alpha: f32) -> f32 {
  let alpha2 = alpha * alpha;
  let d = ndoth * ndoth * (alpha2 - 1.0) + 1.0;
  return alpha2 / max(PI * d * d, CLIP_VAL);
}

fn smithVisibilityApprox(ndotv: f32, ndotl: f32, alpha: f32) -> f32 {
  return 0.5 / max(mix(2.0 * ndotl * ndotv, ndotl + ndotv, alpha), CLIP_VAL);
}

fn sampleGGXHalfVector(normal: vec3<f32>, roughness: f32) -> vec3<f32> {
  let tangent = basisTangent(normal);
  let bitangent = cross(normal, tangent);
  for (var i: i32 = 0; i < 32; i = i + 1) {
    let u1 = nextRandom();
    let u2 = nextRandom();
    let phi = 2.0 * PI * u1;
    let cosTheta = sqrt((1.0 - u2) / (1.0 + (roughness * roughness - 1.0) * u2));
    let sinTheta = sqrt(max(1.0 - cosTheta * cosTheta, 0.0));
    let local = vec3<f32>(sinTheta * cos(phi), sinTheta * sin(phi), cosTheta);
    if (local.z > 0.0) {
      return normalize(local.x * tangent + local.y * bitangent + local.z * normal);
    }
  }
  return normal;
}

fn thinFilmReflectance(cosTheta: f32, thicknessNm: f32, ior: f32) -> vec3<f32> {
  let sinThetaT2 = (1.0 - cosTheta * cosTheta) / max(ior * ior, 1.0001);
  let cosThetaT = sqrt(max(1.0 - sinThetaT2, 0.0));
  let opd = 2.0 * ior * thicknessNm * cosThetaT;
  let wavelengthNm = vec3<f32>(680.0, 550.0, 440.0);
  let phase = 4.0 * PI * opd / wavelengthNm;
  return clamp(vec3<f32>(0.5) + 0.5 * cos(phase), vec3<f32>(0.0), vec3<f32>(1.0));
}

// ---- path tracing ---------------------------------------------------------
fn tracePath(startPoint: vec3<f32>, startDirection: vec3<f32>) -> vec3<f32> {
  var point = startPoint;
  var direction = startDirection;
  var accumulated = vec3<f32>(0.0);
  var throughput = vec3<f32>(1.0);
  var suppressEnvHit = false;

  for (var depth: i32 = 0; depth < MAX_BOUNCES; depth = depth + 1) {
    let hit = findClosestIntersect(point, direction);
    if (!hit.isExisting) {
      if (!suppressEnvHit) {
        accumulated = accumulated + throughput * evaluateEnvironment(direction);
      }
      break;
    }

    let materialType = i32(hit.material.x + 0.5);

    if (isEmissiveMaterial(hit.material)) {
      accumulated = accumulated + throughput * hit.color * EMISSIVE_STRENGTH;
      break;
    }

    if (materialType == MATERIAL_MIRROR) {
      direction = calculateReflection(direction, hit.normal);
      point = hit.point + hit.normal * RAY_EPSILON;
      throughput = throughput * hit.color;
      suppressEnvHit = false;
      if (depth > 1 && nextRandom() < P_BOUNCE) { break; }
      if (depth > 1) { throughput = throughput / P_BOUNCE; }
      continue;
    }

    if (materialType == MATERIAL_GLASS) {
      let baseIor = hit.material.y;
      let ior = sampleDispersiveIor(baseIor);
      let g = sampleGlassBsdf(direction, hit.normal, hit.color, ior, hit.material.z);
      direction = g.dir;
      suppressEnvHit = false;
      let travelSide = select(hit.normal, -hit.normal, dot(direction, hit.normal) < 0.0);
      point = hit.point + travelSide * CLIP_VAL;
      throughput = throughput * g.weight;
      if (!g.survived) { break; }
      if (depth > 1 && nextRandom() < P_BOUNCE) { break; }
      if (depth > 1) { throughput = throughput / P_BOUNCE; }
      if (max(max(throughput.r, throughput.g), throughput.b) < 0.001) { break; }
      continue;
    }

    if (materialType == MATERIAL_THINFILM) {
      let cosTheta = abs(dot(hit.normal, direction));
      let tint = thinFilmReflectance(cosTheta, hit.material.y, hit.material.z);
      direction = calculateReflection(direction, hit.normal);
      point = hit.point + hit.normal * CLIP_VAL;
      throughput = throughput * tint;
      if (depth > 1 && nextRandom() < P_BOUNCE) { break; }
      continue;
    }

    if (materialType == MATERIAL_GGX) {
      let roughness = clamp(hit.material.y, 0.02, 1.0);
      let metalness = clamp(hit.material.z, 0.0, 1.0);
      let alpha = roughness * roughness;
      let viewDir = -direction;
      let halfVector = sampleGGXHalfVector(hit.normal, roughness);
      let lightDir = reflect(direction, halfVector);
      let ndotl = dot(hit.normal, lightDir);
      let ndotv = dot(hit.normal, viewDir);
      let ndoth = max(dot(hit.normal, halfVector), 0.0);
      let vdoth = max(dot(viewDir, halfVector), 0.0);
      if (ndotl <= 0.0 || ndotv <= 0.0) { break; }
      let f0 = mix(vec3<f32>(0.04), hit.color, metalness);
      let fresnel = fresnelSchlickVec(vdoth, f0);
      let dTerm = ggxDistribution(ndoth, alpha);
      let gTerm = smithVisibilityApprox(ndotv, ndotl, alpha);
      let specular = dTerm * gTerm * fresnel
        / max(4.0 * ndotv * ndotl, CLIP_VAL)
        * ndotl / max(dTerm * ndoth, CLIP_VAL);
      let kd = (vec3<f32>(1.0) - fresnel) * (1.0 - metalness) / PI;
      let brdfWeight = specular + kd * hit.color;
      let bw = clamp(brdfWeight, vec3<f32>(0.0), vec3<f32>(4.0));
      accumulated = accumulated + throughput * calculateDirectIllumination(hit.point, hit.normal, bw);
      direction = normalize(lightDir);
      point = hit.point + hit.normal * CLIP_VAL;
      throughput = throughput * bw;
      if (depth > 1 && nextRandom() < P_BOUNCE) { break; }
      if (max(max(throughput.r, throughput.g), throughput.b) < 0.001) { break; }
      continue;
    }

    if (materialType == MATERIAL_CLEARCOAT) {
      let coatStrength = clamp(hit.material.z, 0.0, 1.0);
      let isCoat = nextRandom() < coatStrength;
      if (isCoat) {
        let fresnel = fresnelSchlick(abs(dot(hit.normal, direction)), 1.5);
        direction = calculateReflection(direction, hit.normal);
        point = hit.point + hit.normal * CLIP_VAL;
        throughput = throughput * vec3<f32>(fresnel);
      } else {
        accumulated = accumulated + throughput * calculateDirectIllumination(hit.point, hit.normal, hit.color);
        let bounceDirection = sampleBounceDirection(hit.normal);
        let weight = max(dot(hit.normal, bounceDirection), 0.0) / max(P_BOUNCE, CLIP_VAL);
        throughput = throughput * hit.color * weight;
        direction = bounceDirection;
        point = hit.point + hit.normal * CLIP_VAL;
      }
      if (depth > 1 && nextRandom() < P_BOUNCE) { break; }
      if (max(max(throughput.r, throughput.g), throughput.b) < 0.001) { break; }
      continue;
    }

    // Diffuse (default) path.
    accumulated = accumulated + throughput * calculateDirectIllumination(hit.point, hit.normal, hit.color);
    accumulated = accumulated + throughput * sampleEnvironmentIllumination(hit.point, hit.normal, hit.color);
    suppressEnvHit = true;
    if (depth > 1 && nextRandom() < P_BOUNCE) { break; }
    let bounceDirection = sampleBounceDirection(hit.normal);
    let weight = max(dot(hit.normal, bounceDirection), 0.0) / P_BOUNCE;
    throughput = throughput * hit.color * weight;
    if (max(max(throughput.r, throughput.g), throughput.b) < 0.001) { break; }
    point = hit.point + hit.normal * RAY_EPSILON;
    direction = bounceDirection;
  }
  return accumulated;
}

// ---- camera ray generation (mirror common.glsl) --------------------------
fn generateCameraRay(ndc: vec2<f32>, resolution: vec2<f32>, eye: vec3<f32>,
                     camForward: vec3<f32>, camRight: vec3<f32>, camUp: vec3<f32>) -> vec3<f32> {
  let aspect = resolution.x / resolution.y;
  let tanHalfFov = tan(radians(CAMERA_VERTICAL_FOV_DEG) * 0.5);
  let offset = ndc * vec2<f32>(tanHalfFov * aspect, tanHalfFov);
  return normalize(camForward + camRight * offset.x + camUp * offset.y);
}

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let px = i32(gid.x);
  let py = i32(gid.y);
  let width = i32(U.resolutionFrame.x);
  let height = i32(U.resolutionFrame.y);
  if (px >= width || py >= height) { return; }

  let ndc = vec2<f32>(
    (f32(px) + 0.5) / U.resolutionFrame.x * 2.0 - 1.0,
    (f32(py) + 0.5) / U.resolutionFrame.y * 2.0 - 1.0
  );

  initRng(vec2<f32>(f32(px), f32(py)), U.resolutionFrame.z);

  let pixelSize = 2.0 / U.resolutionFrame.y;
  let jitter = (vec2<f32>(nextRandom(), nextRandom()) - 0.5) * pixelSize;

  let eye = U.eye.xyz;
  let camForward = U.camForward.xyz;
  let camRight = U.camRight.xyz;
  let camUp = U.camUp.xyz;

  let centerRayDirection = generateCameraRay(vec2<f32>(0.0), U.resolutionFrame.xy, eye,
                                             camForward, camRight, camUp);
  var rayDirection = generateCameraRay(ndc + jitter, U.resolutionFrame.xy, eye,
                                       camForward, camRight, camUp);

  var rayOrigin = eye;
  if (U.params.x > 0.0) {
    let focalT = U.params.y / dot(rayDirection, normalize(centerRayDirection));
    let focalPoint = eye + focalT * rayDirection;
    let u1 = nextRandom();
    let u2 = nextRandom();
    let disk = U.params.x * sqrt(u1) * vec2<f32>(cos(6.283185307179586 * u2), sin(6.283185307179586 * u2));
    let forward = normalize(rayDirection);
    let basis = basisTangent(forward);
    let right = normalize(cross(basis, forward));
    let up = cross(forward, right);
    let lensPoint = eye + disk.x * right + disk.y * up;
    rayOrigin = lensPoint;
    rayDirection = normalize(focalPoint - lensPoint);
  }

  let sampleColor = tracePath(rayOrigin, rayDirection);

  let sampleLuminance = dot(sampleColor, vec3<f32>(0.2126, 0.7152, 0.0722));
  var outColor = sampleColor;
  if (sampleLuminance > FIREFLY_CLAMP) {
    outColor = outColor * (FIREFLY_CLAMP / sampleLuminance);
  }

  let frameCount = U.resolutionFrame.z;
  var prevSum = vec3<f32>(0.0);
  if (frameCount > 0.5) {
    prevSum = textureLoad(accumPrev, vec2<i32>(px, py), 0).rgb;
  }
  let accumulatedSum = prevSum + outColor;

  textureStore(accumNext, vec2<i32>(px, py), vec4<f32>(accumulatedSum, 1.0));
}
