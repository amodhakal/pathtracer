#version 300 es
precision highp float;

#define MAX_TERM_COUNT 2
#define MAX_BOUNCES 100
#define ELLIPSOID_COUNT 5
#define ELLIPSOID_VECTORS 3
#define TRIANGLE_COUNT 12
#define TRIANGLE_VECTORS 5
#define P_BOUNCE 0.5
#define CLIP_VAL 0.00001
#define SHADOW_CLIP 0.001

struct Light {
    vec3 position;
    vec3 color;
};

struct QuadResult {
    int termCount;
    vec2 terms;
};

struct Ellipsoid {
    vec3 center;
    vec3 radius;
    vec3 color;
};

struct Triangle {
    vec3 vertex1;
    vec3 vertex2;
    vec3 vertex3;
    vec3 normal;
    vec3 color;
};

struct Intersect {
    bool isExisting;
    float distance;
    vec3 intersect;
    vec3 color;
    vec3 normal;
};

in vec2 v_WindowPixels;
out vec4 outColor;

uniform vec3 u_Eye;
uniform Light u_Light;
uniform vec3 u_Ellipsoids[ELLIPSOID_COUNT * ELLIPSOID_VECTORS];
uniform vec3 u_Triangles[TRIANGLE_COUNT * TRIANGLE_VECTORS];
uniform float u_Time;
uniform vec2 u_Resolution;
uniform float u_FrameCount;
uniform sampler2D u_NoiseTexture;
uniform sampler2D u_AccumTexture;

vec3 tracePath(vec3 startPoint, vec3 startDirection);
vec3 calculateDirectIllumination(vec3 point, vec3 normal, vec3 color);
vec3 sampleBounceDirection(vec3 normal);
Intersect calculateRayEllipsoidIntersect(vec3 point, vec3 direction, Ellipsoid ellipsoid);
Intersect calculateRayTriangleIntersect(vec3 point, vec3 direction, Triangle triangle);
Intersect findClosestIntersect(vec3 point, vec3 direction, bool skipFront);
QuadResult solveQuad(vec3 quads);

int randIndex = 0;
float getRand() {
    int idx = randIndex++;
    vec2 pixelCoord = (v_WindowPixels + 1.0) * 0.5;
    vec2 sampleCoord = fract(pixelCoord + vec2(float(idx) * 0.6180339887498949, u_FrameCount * 0.7548776662466927));
    return texture(u_NoiseTexture, sampleCoord).r;
}

vec3 calculateDirectIllumination(vec3 point, vec3 normal, vec3 color) {
    vec3 pointToLight = u_Light.position - point;
    float lightDistance = length(pointToLight);
    vec3 lightDirection = pointToLight / lightDistance;
    vec3 shadowRayOrigin = point + normal * SHADOW_CLIP;

    for(int i = 0; i < ELLIPSOID_COUNT; i++) {
        Ellipsoid ellipsoid;
        ellipsoid.center = u_Ellipsoids[i * ELLIPSOID_VECTORS];
        ellipsoid.radius = u_Ellipsoids[i * ELLIPSOID_VECTORS + 1];
        ellipsoid.color = u_Ellipsoids[i * ELLIPSOID_VECTORS + 2];

        Intersect shadowHit = calculateRayEllipsoidIntersect(shadowRayOrigin, lightDirection, ellipsoid);
        if(shadowHit.isExisting && shadowHit.distance < lightDistance) {
            return vec3(0.0f, 0.0f, 0.0f);
        }
    }

    for(int i = 0; i < TRIANGLE_COUNT; i++) {
        Triangle triangle;
        triangle.vertex1 = u_Triangles[i * TRIANGLE_VECTORS];
        triangle.vertex2 = u_Triangles[i * TRIANGLE_VECTORS + 1];
        triangle.vertex3 = u_Triangles[i * TRIANGLE_VECTORS + 2];
        triangle.normal = u_Triangles[i * TRIANGLE_VECTORS + 3];
        triangle.color = u_Triangles[i * TRIANGLE_VECTORS + 4];

        Intersect shadowHit = calculateRayTriangleIntersect(shadowRayOrigin, lightDirection, triangle);
        if(shadowHit.isExisting && shadowHit.distance < lightDistance) {
            return vec3(0.0f, 0.0f, 0.0f);
        }
    }

    float ndotl = max(dot(normal, lightDirection), 0.0);
    float G = ndotl / (1.0f + lightDistance * lightDistance);
    return u_Light.color * color * G;
}

vec3 sampleBounceDirection(vec3 normal) {
    vec3 basis = abs(normal.x) > 0.9f ? vec3(0.0f, 1.0f, 0.0f) : vec3(1.0f, 0.0f, 0.0f);
    vec3 tangent = normalize(cross(basis, normal));
    vec3 bitangent = cross(normal, tangent);

    const int MAX_ITERS = 64;
    vec3 result = normal;
    for(int i = 0; i < MAX_ITERS; i++) {
        float x = getRand() * 2.0f - 1.0f;
        float y = getRand() * 2.0f - 1.0f;
        float z = getRand() * 2.0f;
        vec3 local = vec3(x, y, z);

        if(dot(local, local) <= 1.0f) {
            local = normalize(local);
            result = local.x * tangent + local.y * bitangent + local.z * normal;
            break;
        }
    }

    return result;
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
        return Intersect(true, term, intersect, ellipsoid.color, normal);
    }

    return Intersect(false, 0.0f, vec3(0.0f), vec3(0.0f), vec3(0.0f));
}

Intersect calculateRayTriangleIntersect(vec3 point, vec3 direction, Triangle triangle) {
    Intersect noIntersection = Intersect(false, 0.0f, vec3(0.0f), vec3(0.0f), vec3(0.0f));

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
    return Intersect(true, term, intersect, triangle.color, triangle.normal);
}

Intersect findClosestIntersect(vec3 point, vec3 direction, bool skipFront) {
    Intersect closestIntersect = Intersect(false, 0.0f, vec3(0.0f), vec3(0.0f), vec3(0.0f));
    float closestDistance = 1e20f;

    for(int i = 0; i < TRIANGLE_COUNT; i++) {
        Triangle triangle;
        triangle.vertex1 = u_Triangles[i * TRIANGLE_VECTORS];
        triangle.vertex2 = u_Triangles[i * TRIANGLE_VECTORS + 1];
        triangle.vertex3 = u_Triangles[i * TRIANGLE_VECTORS + 2];
        triangle.normal = u_Triangles[i * TRIANGLE_VECTORS + 3];
        triangle.color = u_Triangles[i * TRIANGLE_VECTORS + 4];

        if(skipFront
            && abs(triangle.vertex1.z) < 0.001f
            && abs(triangle.vertex2.z) < 0.001f
            && abs(triangle.vertex3.z) < 0.001f) {
            continue;
        }

        Intersect intersect = calculateRayTriangleIntersect(point, direction, triangle);
        if(intersect.isExisting && intersect.distance < closestDistance) {
            closestIntersect = intersect;
            closestDistance = intersect.distance;
        }
    }

    for(int i = 0; i < ELLIPSOID_COUNT; i++) {
        Ellipsoid ellipsoid;
        ellipsoid.center = u_Ellipsoids[i * ELLIPSOID_VECTORS];
        ellipsoid.radius = u_Ellipsoids[i * ELLIPSOID_VECTORS + 1];
        ellipsoid.color = u_Ellipsoids[i * ELLIPSOID_VECTORS + 2];

        Intersect intersect = calculateRayEllipsoidIntersect(point, direction, ellipsoid);
        if(intersect.isExisting && intersect.distance < closestDistance) {
            closestIntersect = intersect;
            closestDistance = intersect.distance;
        }
    }

    return closestIntersect;
}

QuadResult solveQuad(vec3 quads) {
    float a = quads.x;
    float b = quads.y;
    float c = quads.z;

    float discriminant = b * b - 4.0f * a * c;

    if(discriminant < 0.0f) {
        return QuadResult(0, vec2(0.0f));
    }

    float sqrtDiscriminant = sqrt(discriminant);
    float term1 = (-b + sqrtDiscriminant) / (2.0f * a);
    float term2 = (-b - sqrtDiscriminant) / (2.0f * a);

    if(term1 < term2) {
        return QuadResult(2, vec2(term1, term2));
    } else {
        return QuadResult(2, vec2(term2, term1));
    }
}

vec3 tracePath(vec3 startPoint, vec3 startDirection) {
    vec3 point = startPoint;
    vec3 direction = startDirection;
    vec3 accumulated = vec3(0.0f);
    vec3 throughput = vec3(1.0f);

    for(int depth = 0; depth < MAX_BOUNCES; depth++) {
        Intersect hit = findClosestIntersect(point, direction, depth == 0);

        if(!hit.isExisting) {
            break;
        }

        accumulated += throughput * calculateDirectIllumination(hit.intersect, hit.normal, hit.color);

        if(depth > 1 && getRand() < P_BOUNCE) {
            break;
        }

        vec3 bounceDirection = sampleBounceDirection(hit.normal);
        float weight = max(dot(hit.normal, bounceDirection), 0.0f) / P_BOUNCE;
        throughput *= hit.color * weight;

        if(max(throughput.r, max(throughput.g, throughput.b)) < 0.001f) {
            break;
        }

        point = hit.intersect + hit.normal * CLIP_VAL;
        direction = bounceDirection;
    }

    return accumulated;
}

void main() {
    vec2 pos = v_WindowPixels.xy;
    pos.x *= u_Resolution.x / u_Resolution.y;

    vec3 rayOrigin = u_Eye;
    vec3 targetPoint = vec3((pos.xy + 1.0f) * 0.5f, 0.0f);
    vec3 rayDirection = normalize(targetPoint - rayOrigin);

    vec3 sampleColor = tracePath(rayOrigin, rayDirection);

    vec2 uv = (v_WindowPixels + 1.0) * 0.5;
    vec3 prevColor = texture(u_AccumTexture, uv).rgb;

    float weight = 1.0 / (u_FrameCount + 1.0);
    vec3 accumulatedColor = mix(prevColor, sampleColor, weight);

    outColor = vec4(accumulatedColor, 1.0);
}