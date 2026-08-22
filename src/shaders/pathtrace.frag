#version 300 es
precision highp float;

#include <common>

#define MAX_BOUNCES 200
#define LIGHT_SAMPLES 4
#define P_BOUNCE 0.5
#define SHADOW_CLIP 0.001

// Issue #35: firefly clamping — bound each sample's radiance before it is
// accumulated, so rare high-energy spikes (fireflies) can't dominate the
// running average. Applied per-sample in main(), not per-bounce.
#define FIREFLY_CLAMP 10.0

// Material encoding packed as vec3(x = material type, y = IOR, z = opacity)
#define MATERIAL_DIFFUSE 0
#define MATERIAL_MIRROR 1
#define MATERIAL_GLASS 2

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

#include <intersection>

vec3 tracePath(vec3 startPoint, vec3 startDirection);
vec3 calculateDirectIllumination(vec3 point, vec3 normal, vec3 color);
vec3 sampleBounceDirection(vec3 normal);
bool isEmitter(float r, float g, float b);
float fresnelSchlick(float cosTheta, float ior);
vec3 calculateReflection(vec3 incident, vec3 faceNormal);
vec3 calculateRefraction(vec3 incident, vec3 faceNormal, float ior);

int randIndex = 0;
float getRand() {
    int idx = randIndex++;
    vec2 pixelCoord = (v_WindowPixels + 1.0) * 0.5;
    vec2 offsets = vec2(
        float(idx) * 0.6180339887498949,
        u_FrameCount * 0.7548776662466927 + float(idx) * 0.2971213928707494
    );
    vec2 sampleCoord = fract(pixelCoord + offsets);
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
        float cosLight = max(dot(lightNormal, -lightDirection), 0.0);

        // Area-to-area geometry term for uniform area sampling:
        // Lo = Le * brdf * cos(theta_i) * cos(theta_l) * V / (r^2 * pdf)
        // pdf = 1 / lightArea for uniform sampling over the quad.
        if(ndotl <= 0.0 || cosLight <= 0.0) {
            continue;
        }

        float lightArea = 4.0f * u_Light.size.x * u_Light.size.y;
        float pdf = 1.0f / max(lightArea, CLIP_VAL);
        float geometryTerm = ndotl * cosLight
            / max(lightDistance * lightDistance, CLIP_VAL);
        accumulated += u_Light.color * color * geometryTerm / pdf;
    }

    return accumulated / float(LIGHT_SAMPLES);
}

vec3 sampleBounceDirection(vec3 normal) {
    vec3 basis = abs(normal.x) > 0.9f ? vec3(0.0f, 1.0f, 0.0f) : vec3(1.0f, 0.0f, 0.0f);
    vec3 tangent = normalize(cross(basis, normal));
    vec3 bitangent = cross(normal, tangent);

    const int MAX_ITERS = 32;
    vec3 result = normalize(tangent + bitangent + normal);
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

vec3 tracePath(vec3 startPoint, vec3 startDirection) {
    vec3 point = startPoint;
    vec3 direction = startDirection;
    vec3 accumulated = vec3(0.0f);
    vec3 throughput = vec3(1.0f);

    for(int depth = 0; depth < MAX_BOUNCES; depth++) {
        Intersect hit = findClosestIntersect(point, direction);

        if(!hit.isExisting) {
            break;
        }

        if(isEmitter(hit.color.r, hit.color.g, hit.color.b)) {
            accumulated += throughput * hit.color;
            break;
        }

        int materialType = int(hit.material.x + 0.5f);

        if(materialType == MATERIAL_MIRROR) {
            direction = calculateReflection(direction, hit.normal);
            point = hit.intersect + hit.normal * CLIP_VAL;
            throughput *= hit.color;

            if(depth > 1 && getRand() < P_BOUNCE) {
                break;
            }

            // Survived Russian roulette: compensate for terminated paths by
            // dividing by the survival probability so transport stays unbiased.
            if(depth > 1) {
                throughput /= P_BOUNCE;
            }

            continue;
        }

        if(materialType == MATERIAL_GLASS) {
            float opacity = hit.material.z;

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

            // Survived Russian roulette: compensate for terminated paths by
            // dividing by the survival probability so transport stays unbiased.
            if(depth > 1) {
                throughput /= P_BOUNCE;
            }

            if(max(throughput.r, max(throughput.g, throughput.b)) < 0.001f) {
                break;
            }

            continue;
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

    // Issue #12: sub-pixel jitter — offset by a random amount within the pixel
    // each frame so averaging over accumulated frames converges to anti-aliasing.
    // After aspect-scaling pos.x, one screen pixel spans 1/res.y in both axes.
    float pixelSize = 2.0f / u_Resolution.y;
    vec2 jitter = (vec2(getRand(), getRand()) - 0.5f) * pixelSize;

    vec3 rayOrigin = u_Eye;
    vec3 targetPoint = vec3((pos.xy + jitter + 1.0f) * 0.5f, 0.0f);
    vec3 rayDirection = normalize(targetPoint - rayOrigin);

    vec3 sampleColor = tracePath(rayOrigin, rayDirection);

    // Issue #35: clamp fireflies on the per-sample radiance BEFORE accumulation.
    // Scale-preserving clamp: if luminance exceeds FIREFLY_CLAMP, scale all
    // components down uniformly so hue is preserved and spikes stay bounded
    // while the average remains approximately unbiased.
    float sampleLuminance = dot(sampleColor, vec3(0.2126f, 0.7152f, 0.0722f));
    if(sampleLuminance > FIREFLY_CLAMP) {
        sampleColor *= FIREFLY_CLAMP / sampleLuminance;
    }

    vec2 uv = (v_WindowPixels + 1.0) * 0.5;
    vec3 prevSum = texture(u_AccumTexture, uv).rgb;

    // Issue #11: accumulate a SUM of radiance samples instead of a running
    // average, so precision doesn't degrade as frameCount grows. The display
    // pass divides by the frame count.
    vec3 accumulatedSum = prevSum + sampleColor;

    outColor = vec4(accumulatedSum, 1.0);
}
