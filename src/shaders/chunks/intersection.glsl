// Shared GLSL chunk: ray/geometry intersection routines and the numerically
// stable quadratic solver. Included via `#include <intersection>` and
// resolved at load time by resolveIncludes() in src/utils.ts.
// Requires the structs/constants from `#include <common>`.

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
        return Intersect(true, term, intersect, ellipsoid.color, normal, ellipsoid.material);
    }

    return Intersect(false, 0.0f, vec3(0.0f), vec3(0.0f), vec3(0.0f), vec3(0.0f));
}

Intersect calculateRayTriangleIntersect(vec3 point, vec3 direction, Triangle triangle) {
    Intersect noIntersection = Intersect(false, 0.0f, vec3(0.0f), vec3(0.0f), vec3(0.0f), vec3(0.0f));

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
    return Intersect(true, term, intersect, triangle.color, triangle.normal, vec3(0.0f));
}

// Issue #49: occlusion-only ("any-hit") variants for shadow rays. Shadow
// queries only need a yes/no answer within a distance bound — no intersect
// point, geometric normal, color, or material — so these skip all of that
// work and return as soon as one blocker is found. The caller is expected
// to break out of its geometry loop on the first `true`.
bool rayEllipsoidOccluded(vec3 point, vec3 direction, float maxDistance, Ellipsoid ellipsoid) {
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

bool rayTriangleOccluded(vec3 point, vec3 direction, float maxDistance, Triangle triangle) {
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
