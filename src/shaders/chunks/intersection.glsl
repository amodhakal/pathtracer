// Shared GLSL chunk: ray/geometry intersection routines and the numerically
// stable quadratic solver. Included via `#include <intersection>` and
// resolved at load time by resolveIncludes() in src/utils.ts.
// Requires the structs/constants from `#include <common>`.
// NOTE: forward declarations needed because these functions are defined
// below their first call sites (regression from the #37 chunk extraction).
QuadResult solveQuad(vec3 quads);
Intersect calculateRayEllipsoidIntersect(vec3 point, vec3 direction, Ellipsoid ellipsoid);
Intersect calculateRayTriangleIntersect(vec3 point, vec3 direction, Triangle triangle);

// Issue #47: BVH-accelerated closest-hit. Traversal in <bvh> narrows to one
// primitive, which is then fully intersected. These helpers are defined here
// and used by chunks/bvh.glsl (included AFTER this chunk).
Triangle triangleAt(int i);
Ellipsoid ellipsoidAt(int i);
bool ellipsoidHitDistance(int index, vec3 point, vec3 direction, float maxDistance, out float outDistance);
bool triangleHitDistance(int index, vec3 point, vec3 direction, float maxDistance, out float outDistance);
bool triangleHitDistance(Triangle triangle, vec3 point, vec3 direction, float maxDistance, out float outDistance);

Triangle triangleAt(int i) {
    Triangle triangle;
    triangle.vertex1 = u_Triangles[i * TRIANGLE_VECTORS];
    triangle.vertex2 = u_Triangles[i * TRIANGLE_VECTORS + 1];
    triangle.vertex3 = u_Triangles[i * TRIANGLE_VECTORS + 2];
    triangle.normal = u_Triangles[i * TRIANGLE_VECTORS + 3];
    triangle.color = u_Triangles[i * TRIANGLE_VECTORS + 4];
    // Issue #57: two packed UV slots and one packed texture-id slot.
    triangle.uv1 = u_Triangles[i * TRIANGLE_VECTORS + 5].xy;
    triangle.uv2 = u_Triangles[i * TRIANGLE_VECTORS + 5].zw;
    triangle.uv3 = u_Triangles[i * TRIANGLE_VECTORS + 6].xy;
    triangle.textures = u_Triangles[i * TRIANGLE_VECTORS + 6].zw;
    return triangle;
}

Ellipsoid ellipsoidAt(int i) {
    Ellipsoid ellipsoid;
    ellipsoid.center = u_Ellipsoids[i * ELLIPSOID_VECTORS];
    ellipsoid.radius = u_Ellipsoids[i * ELLIPSOID_VECTORS + 1];
    ellipsoid.color = u_Ellipsoids[i * ELLIPSOID_VECTORS + 2];
    ellipsoid.material = u_Ellipsoids[i * ELLIPSOID_VECTORS + 3];
    return ellipsoid;
}

Intersect calculateRayEllipsoidIntersect(vec3 point, vec3 direction, Ellipsoid ellipsoid) {
    vec3 firstResult = direction / ellipsoid.radius;
    vec3 secondResult = point - ellipsoid.center;
    vec3 thirdResult = secondResult / ellipsoid.radius;

    float quadA = dot(firstResult, firstResult);
    float quadB = 2.0f * dot(firstResult, thirdResult);
    float quadC = dot(thirdResult, thirdResult) - 1.0f;

    QuadResult result = solveQuad(vec3(quadA, quadB, quadC));

    for(int idx = 0; idx < MAX_TERM_COUNT; idx++) {
        if(idx >= result.termCount) {
            break;
        }

        float term = result.terms[idx];
        if(term < CLIP_VAL) {
            continue;
        }

        vec3 intersect = point + direction * term;
        vec3 normal = intersect - ellipsoid.center;
        normal /= ellipsoid.radius * ellipsoid.radius;
        normal = normalize(normal);
        // Issue #57: ellipsoids have no UV mapping yet; report no textures.
        return Intersect(true, term, intersect, ellipsoid.color, normal,
            ellipsoid.material, vec2(0.0f), vec2(-1.0f));
    }

    return Intersect(false, 0.0f, vec3(0.0f), vec3(0.0f), vec3(0.0f),
        vec3(0.0f), vec2(0.0f), vec2(-1.0f));
}

Intersect calculateRayTriangleIntersect(vec3 point, vec3 direction, Triangle triangle) {
    Intersect noIntersection = Intersect(false, 0.0f, vec3(0.0f), vec3(0.0f), vec3(0.0f),
        vec3(0.0f), vec2(0.0f), vec2(-1.0f));

    vec3 triangleEdge1 = triangle.vertex2 - triangle.vertex1;
    vec3 triangleEdge2 = triangle.vertex3 - triangle.vertex1;

    vec3 orthogonal = cross(direction, triangleEdge2);
    float determinant = dot(triangleEdge1, orthogonal);
    if(abs(determinant) < CLIP_VAL) {
        return noIntersection;
    }

    float inverseDeterminant = 1.0f / determinant;
    vec3 pointToVertex = point - triangle.vertex1;
    float uValue = dot(pointToVertex, orthogonal) * inverseDeterminant;
    if(uValue < 0.0f || uValue > 1.0f) {
        return noIntersection;
    }

    vec3 crossVector = cross(pointToVertex, triangleEdge1);
    float vValue = dot(direction, crossVector) * inverseDeterminant;

    if(vValue < 0.0f || uValue + vValue > 1.0f) {
        return noIntersection;
    }

    float term = dot(triangleEdge2, crossVector) * inverseDeterminant;
    if(term < CLIP_VAL) {
        return noIntersection;
    }

    vec3 intersect = point + direction * term;

    // Issue #57: barycentric UV interpolation. The Möller–Trumbore weights
    // (uValue, vValue, 1 - u - v) are exactly the barycentric coordinates of
    // the hit point, so reuse them to blend the per-vertex texture coords.
    vec2 uv = triangle.uv1
        + uValue * (triangle.uv2 - triangle.uv1)
        + vValue * (triangle.uv3 - triangle.uv1);

    return Intersect(true, term, intersect, triangle.color, triangle.normal,
        vec3(0.0f), uv, triangle.textures);
}

// Issue #48: distance-only variants used by the BVH closest-hit traversal.
// These read the packed primitive data straight from the u_Ellipsoids/u_Triangles
// uniforms by index — no Ellipsoid/Triangle struct is allocated per primitive,
// which removes the per-primitive struct churn that previously happened inside
// the (per-ray, per-bounce) BVH leaf loops. The acceptance conditions are
// identical to the full intersect routines, so BVH results match brute force
// bit-for-bit modulo float associativity.
bool ellipsoidHitDistance(int index, vec3 point, vec3 direction, float maxDistance, out float outDistance) {
    Ellipsoid ellipsoid = ellipsoidAt(index);
    vec3 firstResult = direction / ellipsoid.radius;
    vec3 secondResult = point - ellipsoid.center;
    vec3 thirdResult = secondResult / ellipsoid.radius;

    QuadResult result = solveQuad(vec3(
        dot(firstResult, firstResult),
        2.0f * dot(firstResult, thirdResult),
        dot(thirdResult, thirdResult) - 1.0f
    ));

    for(int idx = 0; idx < MAX_TERM_COUNT; idx++) {
        if(idx >= result.termCount) {
            break;
        }
        float term = result.terms[idx];
        if(term >= CLIP_VAL && term < maxDistance) {
            outDistance = term;
            return true;
        }
    }
    return false;
}

bool triangleHitDistance(int index, vec3 point, vec3 direction, float maxDistance, out float outDistance) {
    Triangle triangle = triangleAt(index);
    return triangleHitDistance(triangle, point, direction, maxDistance, outDistance);
}

// Struct-based overload retained so the index-based entry point shares the
// exact acceptance logic; the closest-hit path (findClosestIntersect) also
// builds a Triangle from a single primitive, not in a per-primitive loop.
bool triangleHitDistance(Triangle triangle, vec3 point, vec3 direction, float maxDistance, out float outDistance) {
    vec3 edge1 = triangle.vertex2 - triangle.vertex1;
    vec3 edge2 = triangle.vertex3 - triangle.vertex1;

    vec3 orthogonal = cross(direction, edge2);
    float determinant = dot(edge1, orthogonal);
    if(abs(determinant) < CLIP_VAL) {
        return false;
    }

    float inverseDeterminant = 1.0f / determinant;
    vec3 pointToVertex = point - triangle.vertex1;
    float uValue = dot(pointToVertex, orthogonal) * inverseDeterminant;
    if(uValue < 0.0f || uValue > 1.0f) {
        return false;
    }

    vec3 crossVector = cross(pointToVertex, edge1);
    float vValue = dot(direction, crossVector) * inverseDeterminant;
    if(vValue < 0.0f || uValue + vValue > 1.0f) {
        return false;
    }

    float term = dot(edge2, crossVector) * inverseDeterminant;
    if(term < CLIP_VAL || term >= maxDistance) {
        return false;
    }
    outDistance = term;
    return true;
}

// Issue #47: BVH traversal replaces the brute-force primitive loops. The
// <bvh> chunk must be included AFTER this chunk (it calls the helpers above)
// and the importing shader declares u_BvhNodes / u_BvhPrimIndices.
BvhHit bvhClosestPrimitive(vec3 point, vec3 direction);

Intersect findClosestIntersect(vec3 point, vec3 direction) {
    BvhHit bvhHit = bvhClosestPrimitive(point, direction);

    if(!bvhHit.isExisting || bvhHit.primIndex < 0) {
        return Intersect(false, 0.0f, vec3(0.0f), vec3(0.0f),
            vec3(0.0f), vec3(0.0f), vec2(0.0f), vec2(-1.0f));
    }

    if(bvhHit.isTriangle) {
        return calculateRayTriangleIntersect(point, direction, triangleAt(bvhHit.primIndex));
    }
    return calculateRayEllipsoidIntersect(point, direction,
        ellipsoidAt(bvhHit.primIndex - TRIANGLE_COUNT));
}

// Issue #48: occlusion-only ("any-hit") variants for shadow rays, indexed
// by primitive so no Ellipsoid/Triangle struct is built per primitive. Shadow
// queries only need a yes/no answer within a distance bound — no intersect
// point, geometric normal, color, or material — so these skip all of that
// work and return as soon as one blocker is found. The caller is expected
// to break out of its geometry loop on the first `true`.
bool rayEllipsoidOccluded(int index, vec3 point, vec3 direction, float maxDistance) {
    Ellipsoid ellipsoid = ellipsoidAt(index);
    vec3 firstResult = direction / ellipsoid.radius;
    vec3 secondResult = point - ellipsoid.center;
    vec3 thirdResult = secondResult / ellipsoid.radius;

    float quadA = dot(firstResult, firstResult);
    float quadB = 2.0f * dot(firstResult, thirdResult);
    float quadC = dot(thirdResult, thirdResult) - 1.0f;

    QuadResult result = solveQuad(vec3(quadA, quadB, quadC));

    for(int idx = 0; idx < MAX_TERM_COUNT; idx++) {
        if(idx >= result.termCount) {
            break;
        }

        float term = result.terms[idx];
        if(term >= CLIP_VAL && term < maxDistance) {
            return true;
        }
    }

    return false;
}

// Issue #65/#48: same occlusion test but with an explicit center — used by
// traceShadowRay so the shader-side animated ellipsoid offset (ellipsoidCenter)
// is honored without allocating an Ellipsoid struct per primitive.
bool rayEllipsoidOccluded(vec3 center, int index, vec3 point, vec3 direction, float maxDistance) {
    vec3 radius = u_Ellipsoids[index * ELLIPSOID_VECTORS + 1];
    vec3 firstResult = direction / radius;
    vec3 secondResult = point - center;
    vec3 thirdResult = secondResult / radius;

    float quadA = dot(firstResult, firstResult);
    float quadB = 2.0f * dot(firstResult, thirdResult);
    float quadC = dot(thirdResult, thirdResult) - 1.0f;

    QuadResult result = solveQuad(vec3(quadA, quadB, quadC));

    for(int idx = 0; idx < MAX_TERM_COUNT; idx++) {
        if(idx >= result.termCount) {
            break;
        }

        float term = result.terms[idx];
        if(term >= CLIP_VAL && term < maxDistance) {
            return true;
        }
    }

    return false;
}

bool rayTriangleOccluded(int index, vec3 point, vec3 direction, float maxDistance) {
    Triangle triangle = triangleAt(index);
    vec3 triangleEdge1 = triangle.vertex2 - triangle.vertex1;
    vec3 triangleEdge2 = triangle.vertex3 - triangle.vertex1;

    vec3 orthogonal = cross(direction, triangleEdge2);
    float determinant = dot(triangleEdge1, orthogonal);
    if(abs(determinant) < CLIP_VAL) {
        return false;
    }

    float inverseDeterminant = 1.0f / determinant;
    vec3 pointToVertex = point - triangle.vertex1;
    float uValue = dot(pointToVertex, orthogonal) * inverseDeterminant;
    if(uValue < 0.0f || uValue > 1.0f) {
        return false;
    }

    vec3 crossVector = cross(pointToVertex, triangleEdge1);
    float vValue = dot(direction, crossVector) * inverseDeterminant;
    if(vValue < 0.0f || uValue + vValue > 1.0f) {
        return false;
    }

    float term = dot(triangleEdge2, crossVector) * inverseDeterminant;
    return term >= CLIP_VAL && term < maxDistance;
}
}

QuadResult solveQuad(vec3 quads) {
    float a = quads.x;
    float b = quads.y;
    float c = quads.z;

    // Numerically stable quadratic solve (half-b form).
    float halfB = 0.5f * b;
    float discriminant = halfB * halfB - a * c;

    if(discriminant < 0.0f) {
        return QuadResult(0, vec2(0.0f));
    }

    float sqrtDiscriminant = sqrt(discriminant);

    // Compute one root using the sign that avoids cancellation
    // (larger magnitude), then derive the other from it.
    float q = (halfB > 0.0f)
        ? -(halfB + sqrtDiscriminant)
        : -(halfB - sqrtDiscriminant);
    float term1 = q / a;
    float term2 = c / q;

    if(term1 < term2) {
        return QuadResult(2, vec2(term1, term2));
    } else {
        return QuadResult(2, vec2(term2, term1));
    }
}
