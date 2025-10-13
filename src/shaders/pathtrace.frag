#version 300 es

precision highp float;

#define MAX_TERM_COUNT 2
#define MAX_BOUNCES 20
#define MAX_SAMPLE_COUNT 800
#define ELLIPSOID_COUNT 2
#define ELLIPSOID_VECTORS 3
#define TRIANGLE_COUNT 12
#define TRIANGLE_VECTORS 5
#define BOUNCE_SUCCESS_PROBABILITY 0.8
#define CLIP_VAL 0.00001

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

vec3 tracePath(vec3 startPoint, vec3 startDirection, float sampleId);
vec3 calculateDirectIllumination(vec3 point, vec3 normal, vec3 color);
vec3 getBounceDirection(vec3 normal, float seed);
Intersect calculateRayEllipsoidIntersect(vec3 point, vec3 direction, Ellipsoid ellipsoid);
Intersect calculateRayTriangleIntersect(vec3 point, vec3 direction, Triangle triangle);
Intersect findClosestIntersect(vec3 point, vec3 direction);
QuadResult solveQuad(vec3 quads);
float rand();

uvec4 seed;

uint hash(uint x) {
    x = ((x >> 16u) ^ x) * uint(0x45d9f3b);
    x = ((x >> 16u) ^ x) * uint(0x45d9f3b);
    x = (x >> 16u) ^ x;
    return x;
}

void InitRNG(vec2 p, int frame) {

    ivec2 pixel = ivec2(p);

    uint uniqueID1 = uint(pixel.x) + uint(pixel.y) * uint(u_Resolution.x);
    uint uniqueID2 = uint(frame);

    uint seed1 = hash(uniqueID1 + uniqueID2);
    uint seed2 = hash(seed1);
    uint seed3 = hash(seed2);
    uint seed4 = hash(seed3);
    seed = uvec4(seed1, seed2, seed3, seed4);
}

void pcg4d(inout uvec4 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.w;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    v.w += v.y * v.z;
    v = v ^ (v >> 16u);
    v.x += v.y * v.w;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    v.w += v.y * v.z;
}

float rand() {
    pcg4d(seed);
    return float(seed.x) / float(0xffffffffu);
}

vec3 calculateDirectIllumination(vec3 point, vec3 normal, vec3 color) {
    vec3 pointToLight = u_Light.position - point;
    vec3 lightDirection = normalize(pointToLight);
    float lightDistance = length(pointToLight);

    vec3 shadowRayOrigin = point + normal * CLIP_VAL;
    Intersect intersect = findClosestIntersect(shadowRayOrigin, lightDirection);
    if(intersect.isExisting && intersect.distance < lightDistance) {
        return vec3(0.0f, 0.0f, 0.0f);
    }

    float numerator = max(dot(normal, lightDirection), 0.0f);
    float denominator = 1.0f + lightDistance * lightDistance;
    float weight = numerator / denominator;

    vec3 finalColor = u_Light.color * color * weight;
    return finalColor;
}

vec3 getBounceDirection(vec3 normal, float seed) {
    vec3 direction;
    bool isValidValue = false;

    for(int idx = 0; idx < MAX_BOUNCES; idx++) {
        float s = seed + float(idx) * 0.01f;
        float firstRand = rand();
        float secondRand = rand();
        float thirdRand = rand();
        direction = vec3(2.0f * firstRand - 1.0f, 2.0f * secondRand - 1.0f, 2.0f * thirdRand - 1.0f);
        if(dot(direction, direction) <= 1.0f) {
            isValidValue = true;
            break;
        }
    }

    if(!isValidValue) {
        return normal;
    }

    direction = normalize(direction);
    if(dot(direction, normal) < 0.0f) {
        direction = -direction;
    }

    return direction;
}

Intersect calculateRayEllipsoidIntersect(vec3 point, vec3 direction, Ellipsoid ellipsoid) {
    vec3 firstResult = direction / ellipsoid.radius;
    vec3 secondResult = point - ellipsoid.center;
    vec3 thirdResult = secondResult / ellipsoid.radius;

    float quadA = dot(firstResult, firstResult);
    float quadB = 2.0f * dot(firstResult, thirdResult);
    float quadC = dot(thirdResult, thirdResult) - 1.0f;

    vec3 quads = vec3(quadA, quadB, quadC);
    QuadResult result = solveQuad(quads);

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

    return Intersect(false, 0.0f, vec3(0.0f, 0.0f, 0.0f), vec3(0.0f, 0.0f, 0.0f), vec3(0.0f, 0.0f, 0.0f));
}

Intersect calculateRayTriangleIntersect(vec3 point, vec3 direction, Triangle triangle) {
    Intersect noIntersection = Intersect(false, 0.0f, vec3(0.0f, 0.0f, 0.0f), vec3(0.0f, 0.0f, 0.0f), vec3(0.0f, 0.0f, 0.0f));
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

Intersect findClosestIntersect(vec3 point, vec3 direction) {
    Intersect closestIntersect = Intersect(false, 0.0f, vec3(0.0f, 0.0f, 0.0f), vec3(0.0f, 0.0f, 0.0f), vec3(0.0f, 0.0f, 0.0f));
    float closestDistance = 1e20f;

    for(int idx = 0; idx < TRIANGLE_COUNT; idx++) {
        int baseIdx = idx * TRIANGLE_VECTORS;
        Triangle triangle = Triangle(u_Triangles[baseIdx], u_Triangles[baseIdx + 1], u_Triangles[baseIdx + 2], u_Triangles[baseIdx + 3], u_Triangles[baseIdx + 4]);
        Intersect intersect = calculateRayTriangleIntersect(point, direction, triangle);
        if(intersect.isExisting && intersect.distance < closestDistance) {
            closestDistance = intersect.distance;
            closestIntersect = intersect;
        }
    }

    for(int idx = 0; idx < ELLIPSOID_COUNT; idx++) {
        int baseIdx = idx * ELLIPSOID_VECTORS;
        Ellipsoid ellipsoid = Ellipsoid(u_Ellipsoids[baseIdx], u_Ellipsoids[baseIdx + 1], u_Ellipsoids[baseIdx + 2]);
        Intersect intersect = calculateRayEllipsoidIntersect(point, direction, ellipsoid);
        if(intersect.isExisting && intersect.distance < closestDistance) {
            closestDistance = intersect.distance;
            closestIntersect = intersect;
        }
    }

    return closestIntersect;
}

QuadResult solveQuad(vec3 quads) {
    float discriminant = pow(quads.y, 2.0f) - 4.0f * quads.x * quads.z;

    if(discriminant < 0.0f) {
        return QuadResult(0, vec2(0.0f, 0.0f));
    } else if(discriminant == 0.0f) {
        float term = -quads.y / (2.0f * quads.x);
        return QuadResult(1, vec2(term, 0.0f));
    }

    float denominator = 0.5f / quads.x;
    float term1 = -quads.y;
    float term2 = sqrt(discriminant);
    float positiveTerm = denominator * (term1 + term2);
    float negativeTerm = denominator * (term1 - term2);

    if(positiveTerm < negativeTerm) {
        return QuadResult(2, vec2(positiveTerm, negativeTerm));
    } else {
        return QuadResult(2, vec2(negativeTerm, positiveTerm));
    }
}

void main() {
    vec2 pos = v_WindowPixels.xy;
    pos.x *= u_Resolution.x / u_Resolution.y;

    vec3 rayOrigin = u_Eye;
    vec2 world_xy = (pos.xy + 1.0f) * 0.5f;
    vec3 targetPoint = vec3(world_xy, u_Eye.z + 0.5f);
    vec3 rayDirection = normalize(targetPoint - rayOrigin);
    vec3 finalColor = vec3(0.0f);

    for(int i = 0; i < MAX_SAMPLE_COUNT; i++) {
        InitRNG(v_WindowPixels, int(u_Time) + i);
        float sampleId = float(i) * 0.1337f;
        finalColor += tracePath(rayOrigin, rayDirection, sampleId);
    }

    finalColor /= float(MAX_SAMPLE_COUNT);
    finalColor = pow(finalColor, vec3(1.0f / 2.2f));
    outColor = vec4(finalColor, 1.0f);
}

vec3 tracePath(vec3 startPoint, vec3 startDirection, float sampleId) {
    vec3 point = startPoint;
    vec3 direction = startDirection;
    vec3 finalColor = vec3(0.0f);
    vec3 throughput = vec3(1.0f);

    for(int bounce = 0; bounce < MAX_BOUNCES; bounce++) {
        Intersect intersect = findClosestIntersect(point, direction);
        if(!intersect.isExisting) {

            break;
        }

        finalColor += calculateDirectIllumination(intersect.intersect, intersect.normal, intersect.color) * throughput;
        throughput *= intersect.color;
        float r = rand();
        if(bounce > 0 && r > BOUNCE_SUCCESS_PROBABILITY) {
            break;
        }

        float probability = (bounce > 0) ? BOUNCE_SUCCESS_PROBABILITY : 1.0f;
        throughput /= probability;
        if(max(throughput.r, max(throughput.g, throughput.b)) < 0.001f) {
            break;
        }

        point = intersect.intersect + intersect.normal * CLIP_VAL;
        direction = getBounceDirection(intersect.normal, r);
    }

    return finalColor;
}
