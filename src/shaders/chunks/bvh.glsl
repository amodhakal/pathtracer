// Issue #47: BVH traversal for the GPU. Included after <intersection> in
// fragment shaders that declare:
//   uniform vec3 u_BvhNodes[BVH_NODE_COUNT * BVH_NODE_SLOTS];
//   uniform vec3 u_BvhPrimIndices[PRIMITIVE_COUNT];
// with BVH_NODE_COUNT/BVH_NODE_SLOTS/PRIMITIVE_COUNT injected as defines.
// Node slot layout (see src/bvh.ts):
//   slot 0 = bounds min, slot 1 = bounds max,
//   slot 2 = (primStart, primCount, unused); children at 2i+1 / 2i+2.

struct BvhHit {
    bool isExisting;
    int primIndex;      // index into the combined primitive list
    bool isTriangle;    // primIndex < TRIANGLE_COUNT means triangle
};

bool bvhRayAabb(vec3 origin, vec3 invDirection, float maxDistance, vec3 bMin, vec3 bMax) {
    vec3 t0s = (bMin - origin) * invDirection;
    vec3 t1s = (bMax - origin) * invDirection;
    vec3 tSmaller = min(t0s, t1s);
    vec3 tLarger = max(t0s, t1s);
    float tNear = max(max(tSmaller.x, tSmaller.y), tSmaller.z);
    float tFar = min(min(tLarger.x, tLarger.y), tLarger.z);
    return tNear <= tFar && tFar > 0.0f && tNear < maxDistance;
}

float aabbEntryDistance(vec3 origin, vec3 invDirection, int nodeIndex) {
    vec3 bMin = u_BvhNodes[nodeIndex * BVH_NODE_SLOTS];
    vec3 bMax = u_BvhNodes[nodeIndex * BVH_NODE_SLOTS + 1];
    vec3 t0s = (bMin - origin) * invDirection;
    vec3 t1s = (bMax - origin) * invDirection;
    vec3 tSmaller = min(t0s, t1s);
    vec3 tLarger = max(t0s, t1s);
    return max(max(tSmaller.x, tSmaller.y), tSmaller.z);
}

// Issue #61: primitive identity of the last bvhClosestPrimitive result,
// published as module state so tracePath can attribute an Intersect to its
// source primitive (needed for the NEE/MIS pdf of emissive hits) without
// changing findClosestIntersect's signature. Valid only until the next
// closest-hit query on the same invocation.
int bvhLastPrimIndex = -1;
bool bvhLastIsTriangle = false;

// Closest-hit traversal. Returns the primitive index of the nearest hit and
// its distance via out params; the caller re-intersects that single primitive
// to build the full Intersect payload (cheaper than carrying it through the
// traversal and keeps equivalence with the brute-force loop trivial).
BvhHit bvhClosestPrimitive(vec3 point, vec3 direction) {
    BvhHit result;
    result.isExisting = false;
    result.primIndex = -1;
    result.isTriangle = false;

    float closestDistance = 1e20f;
    vec3 invDirection = 1.0f / direction;

    // Fixed-size stack (heap layout depth is O(log n); 64 is ample).
    int stack[64];
    int stackPtr = 0;
    stack[stackPtr++] = 0;

    while(stackPtr > 0) {
        int nodeIndex = stack[--stackPtr];

        vec3 bMin = u_BvhNodes[nodeIndex * BVH_NODE_SLOTS];
        vec3 bMax = u_BvhNodes[nodeIndex * BVH_NODE_SLOTS + 1];
        vec2 primInfo = u_BvhNodes[nodeIndex * BVH_NODE_SLOTS + 2].xy;
        int primStart = int(primInfo.x + 0.5f);
        int primCount = int(primInfo.y + 0.5f);

        if(!bvhRayAabb(point, invDirection, closestDistance, bMin, bMax)) {
            continue;
        }

        if(primCount > 0) {
            for(int i = 0; i < primCount; i++) {
                int primIndex = int(u_BvhPrimIndices[primStart + i].x + 0.5f);
                float distance;
                bool hit;
                if(primIndex < TRIANGLE_COUNT) {
                    hit = triangleHitDistance(primIndex, point, direction, closestDistance, distance);
                } else {
                    hit = ellipsoidHitDistance(primIndex - TRIANGLE_COUNT, point, direction, closestDistance, distance);
                }
                if(hit && distance < closestDistance) {
                    closestDistance = distance;
                    result.isExisting = true;
                    result.primIndex = primIndex;
                    result.isTriangle = primIndex < TRIANGLE_COUNT;
                    // Issue #61: publish the winning primitive identity.
                    bvhLastPrimIndex = primIndex;
                    bvhLastIsTriangle = result.isTriangle;
                }
            }
        } else {
            // Interior node: push children. Push the farther child last so it
            // is popped first (approximate front-to-back ordering).
            int left = 2 * nodeIndex + 1;
            int right = 2 * nodeIndex + 2;
            float leftT = aabbEntryDistance(point, invDirection, left);
            float rightT = aabbEntryDistance(point, invDirection, right);
            if(leftT <= rightT) {
                if(right < BVH_NODE_COUNT) { stack[stackPtr++] = right; }
                if(left < BVH_NODE_COUNT) { stack[stackPtr++] = left; }
            } else {
                if(left < BVH_NODE_COUNT) { stack[stackPtr++] = left; }
                if(right < BVH_NODE_COUNT) { stack[stackPtr++] = right; }
            }
        }
    }

    return result;
}

// Any-hit (occlusion-only) traversal for shadow rays: returns as soon as any
// primitive blocks within [0, maxDistance). Reuses the same occlusion tests
// the linear loops used, so results are identical.
bool bvhAnyHit(vec3 point, vec3 direction, float maxDistance) {
    vec3 invDirection = 1.0f / direction;

    int stack[64];
    int stackPtr = 0;
    stack[stackPtr++] = 0;

    while(stackPtr > 0) {
        int nodeIndex = stack[--stackPtr];

        vec3 bMin = u_BvhNodes[nodeIndex * BVH_NODE_SLOTS];
        vec3 bMax = u_BvhNodes[nodeIndex * BVH_NODE_SLOTS + 1];
        vec2 primInfo = u_BvhNodes[nodeIndex * BVH_NODE_SLOTS + 2].xy;

        if(!bvhRayAabb(point, invDirection, maxDistance, bMin, bMax)) {
            continue;
        }

        int primCount = int(primInfo.y + 0.5f);
        if(primCount > 0) {
            int primStart = int(primInfo.x + 0.5f);
            for(int i = 0; i < primCount; i++) {
                int primIndex = int(u_BvhPrimIndices[primStart + i].x + 0.5f);
                if(primIndex < TRIANGLE_COUNT) {
                    if(rayTriangleOccluded(primIndex, point, direction, maxDistance)) {
                        return true;
                    }
                } else {
                    if(rayEllipsoidOccluded(primIndex - TRIANGLE_COUNT, point, direction, maxDistance)) {
                        return true;
                    }
                }
            }
        } else {
            stack[stackPtr++] = 2 * nodeIndex + 1;
            stack[stackPtr++] = 2 * nodeIndex + 2;
        }
    }

    return false;
}
