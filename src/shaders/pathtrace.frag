#version 300 es
precision highp float;

#define MAX_TERM_COUNT 2
#define MAX_BOUNCES 200
#define ELLIPSOID_COUNT 5
#define ELLIPSOID_VECTORS 4
#define TRIANGLE_COUNT 14
#define TRIANGLE_VECTORS 5
#define LIGHT_SAMPLES 4
#define P_BOUNCE 0.5
#define CLIP_VAL 0.00001
#define SHADOW_CLIP 0.001

struct Light {
    vec3 position;
    vec3 color;
    vec3 normal;
    vec2 size;
};

struct QuadResult {
    int termCount;
    vec2 terms;
};

struct Ellipsoid {
    vec3 center;
    vec3 radius;
    vec3 color;
    vec3 material;
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
    vec3 material;
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
bool isEmitter(float r, float g, float b);
float fresnelSchlick(float cosTheta, float ior);
vec3 calculateReflection(vec3 incident, vec3 faceNormal);
vec3 calculateRefraction(vec3 incident, vec3 faceNormal, float ior);

int randIndex = 0;
float getRand() {
    int idx = randIndex++;
    vec2 pixelCoord = (v_WindowPixels + 1.0) * 0.5;
    vec2 sampleCoord = fract(pixelCoord + vec2(float(idx) * 0.6180339887498949, u_FrameCount * 0.7548776662466927));
    return texture(u_NoiseTexture, sampleCoord).r;
}

bool isEmitter(float r, float g, float b) {
    return r > 1.0f || g > 1.0f || b > 1.0f;
}

float fresnelSchlick(float cosTheta, float ior) {
    float f0 = (ior - 1.0f) / (ior + 1.0f);
    f0 *= f0;
    return f0 + (1.0f - f0) * pow(1.0f - cosTheta, 5.0f);
}

vec3 calculateReflection(vec3 incident, vec3 faceNormal) {
    return incident - 2.0f * dot(faceNormal, incident) * faceNormal;
}

vec3 calculateRefraction(vec3 incident, vec3 faceNormal, float ior) {
    float entering = dot(incident, faceNormal) < 0.0f ? 1.0f : 0.0f;
    vec3 n = entering > 0.5f ? faceNormal : -faceNormal;
    float eta = entering > 0.5f ? 1.0f / ior : ior;

    float cosI = -dot(n, incident);
    float sinT2 = eta * eta * (1.0f - cosI * cosI);
    if(sinT2 >= 1.0f) {
        return vec3(0.0f);
    }

    float cosT = sqrt(1.0f - sinT2);
    return eta * incident + (eta * cosI - cosT) * n;
}

vec3 calculateDirectIllumination(vec3 point, vec3 normal, vec3 color) {
    vec3 lightNormal = normalize(u_Light.normal);
    vec3 basis = abs(lightNormal.x) > 0.9f ? vec3(0.0f, 1.0f, 0.0f) : vec3(1.0f, 0.0f, 0.0f);
    vec3 lightTangent = normalize(cross(basis, lightNormal));
    vec3 lightBitangent = cross(lightNormal, lightTangent);

    vec3 accumulated = vec3(0.0f);

    for(int s = 0; s < LIGHT_SAMPLES; s++) {
        vec2 areaSample = vec2(getRand(), getRand());
        vec3 lightPoint = u_Light.position
            + lightTangent * ((areaSample.x - 0.5f) * 2.0f * u_Light.size.x)
            + lightBitangent * ((areaSample.y - 0.5f) * 2.0f * u_Light.size.y);

        vec3 shadowRayOrigin = point + normal * SHADOW_CLIP;
        vec3 pointToLight = lightPoint - shadowRayOrigin;
        float lightDistance = length(pointToLight);
        vec3 lightDirection = pointToLight / lightDistance;

        bool occluded = false;

        for(int i = 0; i < ELLIPSOID_COUNT && !occluded; i++) {
            Ellipsoid ellipsoid;
            ellipsoid.center = u_Ellipsoids[i * ELLIPSOID_VECTORS];
            ellipsoid.radius = u_Ellipsoids[i * ELLIPSOID_VECTORS + 1];
            ellipsoid.color = u_Ellipsoids[i * ELLIPSOID_VECTORS + 2];
            ellipsoid.material = u_Ellipsoids[i * ELLIPSOID_VECTORS + 3];

            Intersect shadowHit = calculateRayEllipsoidIntersect(shadowRayOrigin, lightDirection, ellipsoid);
            if(shadowHit.isExisting && shadowHit.distance < lightDistance - SHADOW_CLIP) {
                occluded = true;
            }
        }

        for(int i = 0; i < TRIANGLE_COUNT && !occluded; i++) {
            Triangle triangle;
            triangle.vertex1 = u_Triangles[i * TRIANGLE_VECTORS];
            triangle.vertex2 = u_Triangles[i * TRIANGLE_VECTORS + 1];
            triangle.vertex3 = u_Triangles[i * TRIANGLE_VECTORS + 2];
            triangle.normal = u_Triangles[i * TRIANGLE_VECTORS + 3];
            triangle.color = u_Triangles[i * TRIANGLE_VECTORS + 4];

            Intersect shadowHit = calculateRayTriangleIntersect(shadowRayOrigin, lightDirection, triangle);
            if(shadowHit.isExisting && shadowHit.distance < lightDistance - SHADOW_CLIP) {
                occluded = true;
            }
        }

        if(occluded) {
            continue;
        }

        float ndotl = max(dot(normal, lightDirection), 0.0);
        float G = ndotl / (1.0f + lightDistance * lightDistance);
        accumulated += u_Light.color * color * G;
    }

    return accumulated / float(LIGHT_SAMPLES);
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

Intersect findClosestIntersect(vec3 point, vec3 direction, bool skipFront) {
    Intersect closestIntersect = Intersect(false, 0.0f, vec3(0.0f), vec3(0.0f), vec3(0.0f), vec3(0.0f));
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
        ellipsoid.material = u_Ellipsoids[i * ELLIPSOID_VECTORS + 3];

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

        if(isEmitter(hit.color.r, hit.color.g, hit.color.b)) {
            accumulated += throughput * hit.color;
            break;
        }

        int materialType = int(hit.material.x + 0.5f);

        if(materialType == 1) {
            direction = calculateReflection(direction, hit.normal);
            point = hit.intersect + hit.normal * CLIP_VAL;
            throughput *= hit.color;

            if(depth > 1 && getRand() < P_BOUNCE) {
                break;
            }

            continue;
        }

        if(materialType == 2) {
            float opacity = hit.material.z;

            if(getRand() >= opacity) {
                accumulated += throughput * calculateDirectIllumination(hit.intersect, hit.normal, hit.color);

                vec3 refracted = calculateRefraction(direction, hit.normal, hit.material.y);
                vec3 reflected = calculateReflection(direction, hit.normal);

                float cosTheta = abs(dot(hit.normal, direction));
                float fresnel = fresnelSchlick(cosTheta, hit.material.y);

                bool isReflecting = refracted == vec3(0.0f) || getRand() < fresnel;
                direction = isReflecting ? reflected : refracted;
                vec3 travelSide = dot(direction, hit.normal) < 0.0f ? -hit.normal : hit.normal;
                point = hit.intersect + travelSide * CLIP_VAL;
                throughput *= mix(vec3(1.0f), hit.color, opacity);

                if(depth > 1 && getRand() < P_BOUNCE) {
                    break;
                }

                if(max(throughput.r, max(throughput.g, throughput.b)) < 0.001f) {
                    break;
                }

                continue;
            }
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