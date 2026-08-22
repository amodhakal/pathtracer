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

// Issue #55: emissive material strength (radiance multiplier for MATERIAL_EMISSIVE)
#define EMISSIVE_STRENGTH 4.0

// Material encoding packed as vec3(x = material type, y = IOR, z = opacity)
// Issue #55: extended encoding — y/z take material-specific meanings:
//   GGX       : y = roughness, z = metalness
//   CLEARCOAT : y = base roughness, z = coat strength
//   THINFILM  : y = film thickness [nm], z = film IOR
#define MATERIAL_DIFFUSE 0
#define MATERIAL_MIRROR 1
#define MATERIAL_GLASS 2
#define MATERIAL_GGX 3
#define MATERIAL_EMISSIVE 4
#define MATERIAL_CLEARCOAT 5
#define MATERIAL_THINFILM 6

in vec2 v_WindowPixels;
out vec4 outColor;

uniform vec3 u_Eye;
uniform Light u_Light;
uniform vec3 u_Ellipsoids[ELLIPSOID_COUNT * ELLIPSOID_VECTORS];
uniform vec3 u_Triangles[TRIANGLE_COUNT * TRIANGLE_VECTORS];
uniform vec2 u_Resolution;
uniform float u_FrameCount;
uniform vec3 u_EnvTop;
uniform vec3 u_EnvBottom;
uniform float u_EnvIntensity;
uniform sampler2D u_NoiseTexture;
uniform sampler2D u_AccumTexture;

// Issue #57: albedo and normal map texture arrays. Each scene triangle can
// reference one albedo map (id in hit.textures.x) and one normal map
// (hit.textures.y); -1 means "no texture". MAX_TEXTURES is the array bound.
#define MAX_TEXTURES 4
uniform sampler2D u_AlbedoTextures[MAX_TEXTURES];
uniform sampler2D u_NormalTextures[MAX_TEXTURES];

// Samples the albedo map for a hit; falls back to the base color when the
// triangle has no albedo texture assigned.
vec3 sampleAlbedo(vec3 baseColor, Intersect hit) {
    int id = int(hit.textures.x + 0.5f);
    if(id < 0 || id >= MAX_TEXTURES) {
        return baseColor;
    }
    return baseColor * texture(u_AlbedoTextures[id], hit.uv).rgb;
}

// Perturbs the shading normal with a tangent-space normal map. The tangent
// frame is derived from the geometric normal on the fly (same construction
// as sampleBounceDirection), which is sufficient for axis-aligned walls.
vec3 sampleNormal(vec3 normal, Intersect hit) {
    int id = int(hit.textures.y + 0.5f);
    if(id < 0 || id >= MAX_TEXTURES) {
        return normal;
    }
    vec3 tangentNormal = texture(u_NormalTextures[id], hit.uv).rgb * 2.0f - 1.0f;

    vec3 basis = abs(normal.x) > 0.9f ? vec3(0.0f, 1.0f, 0.0f) : vec3(1.0f, 0.0f, 0.0f);
    vec3 tangent = normalize(cross(basis, normal));
    vec3 bitangent = cross(normal, tangent);

    vec3 perturbed = tangentNormal.x * tangent
        + tangentNormal.y * bitangent
        + max(tangentNormal.z, 0.0f) * normal;
    if(dot(perturbed, perturbed) < CLIP_VAL) {
        return normal;
    }
    return normalize(perturbed);
}

#include <intersection>

vec3 tracePath(vec3 startPoint, vec3 startDirection);
vec3 evaluateEnvironment(vec3 direction);
vec3 sampleEnvironmentIllumination(vec3 point, vec3 normal, vec3 albedo);
vec3 calculateDirectIllumination(vec3 point, vec3 normal, vec3 color);
vec3 sampleBounceDirection(vec3 normal);
bool isEmitter(vec3 material);
float fresnelSchlick(float cosTheta, float ior);
vec3 calculateReflection(vec3 incident, vec3 faceNormal);
vec3 calculateRefraction(vec3 incident, vec3 faceNormal, float ior, out bool isTIR);

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

// Issue #9: emitters are identified by material type, never by inspecting
// the albedo/color — bright diffuse materials must not be misclassified as lights.
bool isEmitter(vec3 material) {
    return int(material.x + 0.5f) == MATERIAL_EMISSIVE;
}

float fresnelSchlick(float cosTheta, float ior) {
    float f0 = (ior - 1.0f) / (ior + 1.0f);
    f0 *= f0;
    return f0 + (1.0f - f0) * pow(1.0f - cosTheta, 5.0f);
}

vec3 calculateReflection(vec3 incident, vec3 faceNormal) {
    return incident - 2.0f * dot(faceNormal, incident) * faceNormal;
}

vec3 calculateRefraction(vec3 incident, vec3 faceNormal, float ior, out bool isTIR) {
    isTIR = false;
    float entering = dot(incident, faceNormal) < 0.0f ? 1.0f : 0.0f;
    vec3 n = entering > 0.5f ? faceNormal : -faceNormal;
    float eta = entering > 0.5f ? 1.0f / ior : ior;

    float cosI = -dot(n, incident);
    float sinT2 = eta * eta * (1.0f - cosI * cosI);
    if(sinT2 >= 1.0f) {
        isTIR = true;
        return vec3(0.0f);
    }

    float cosT = sqrt(1.0f - sinT2);
    return eta * incident + (eta * cosI - cosT) * n;
}

// ---- Issue #55: BSDF helpers for the new material types -------------------

vec3 buildOrthonormalBasis(vec3 normal, out vec3 tangent, out vec3 bitangent) {
    vec3 basis = abs(normal.x) > 0.9f ? vec3(0.0f, 1.0f, 0.0f) : vec3(1.0f, 0.0f, 0.0f);
    tangent = normalize(cross(basis, normal));
    bitangent = cross(normal, tangent);
    return basis;
}

// GGX normal distribution (isotropic)
float ggxDistribution(float ndoth, float alpha) {
    float alpha2 = alpha * alpha;
    float d = ndoth * ndoth * (alpha2 - 1.0f) + 1.0f;
    return alpha2 / max(3.14159265f * d * d, CLIP_VAL);
}

// Smith height-correlated visibility approximation (Hammon 2017)
float smithVisibilityApprox(float ndotv, float ndotl, float alpha) {
    return 0.5f / max(mix(2.0f * ndotl * ndotv, ndotl + ndotv, alpha), CLIP_VAL);
}

// Fresnel for a metallic F0 tinted by base color; dielectric uses Schlick
vec3 fresnelSchlickVec(float cosTheta, vec3 f0) {
    return f0 + (vec3(1.0f) - f0) * pow(1.0f - cosTheta, 5.0f);
}

// Sample a half-vector from the GGX NDF around the given normal (VNDF-free
// simple D-based sampling — adequate for a path tracer of this scale).
vec3 sampleGGXHalfVector(vec3 normal, float roughness) {
    vec3 tangent, bitangent;
    buildOrthonormalBasis(normal, tangent, bitangent);

    const int MAX_ITERS = 32;
    for(int i = 0; i < MAX_ITERS; i++) {
        float u1 = getRand();
        float u2 = getRand();
        float phi = 2.0f * 3.14159265f * u1;
        float cosTheta = sqrt((1.0f - u2) / (1.0f + (roughness * roughness - 1.0f) * u2));
        float sinTheta = sqrt(max(1.0f - cosTheta * cosTheta, 0.0f));

        vec3 local = vec3(sinTheta * cos(phi), sinTheta * sin(phi), cosTheta);
        if(local.z > 0.0f) {
            return normalize(local.x * tangent + local.y * bitangent + local.z * normal);
        }
    }
    return normal;
}

// Thin-film interference reflectance: two-interface Airy-like approximation.
// Returns per-channel spectral multiplier in [0,1] for light reflecting off
// the top surface vs. the phase-shifted reflection off the film/substrate
// interface. thickness is in nanometers, ior is the film's index.
vec3 thinFilmReflectance(float cosTheta, float thicknessNm, float ior) {
    // Optical path difference in nm between the two reflected beams.
    float sinThetaT2 = (1.0f - cosTheta * cosTheta) / max(ior * ior, 1.0001f);
    float cosThetaT = sqrt(max(1.0f - sinThetaT2, 0.0f));
    float opd = 2.0f * ior * thicknessNm * cosThetaT;

    // Evaluate interference at representative RGB wavelengths (nm).
    vec3 wavelengthNm = vec3(680.0f, 550.0f, 440.0f);
    vec3 phase = 4.0f * 3.14159265f * opd / wavelengthNm;

    // Two-beam interference: intensity ~ 0.5 + 0.5*cos(phase), normalized to [0,1].
    return clamp(vec3(0.5f) + 0.5f * cos(phase), vec3(0.0f), vec3(1.0f));
}

// Emissive check decoupled from brightness threshold: MATERIAL_EMISSIVE hits
// emit hit.color * strength regardless of whether color exceeds 1.
bool isEmissiveMaterial(vec3 material) {
    return int(material.x + 0.5f) == MATERIAL_EMISSIVE;
// Issue #56: procedural gradient environment map. Rays that escape the
// scene pick up infinite-geometry radiance from this IBL instead of black.
vec3 evaluateEnvironment(vec3 direction) {
    float t = clamp(direction.y * 0.5f + 0.5f, 0.0f, 1.0f);
    return mix(u_EnvBottom, u_EnvTop, t) * u_EnvIntensity;
}

bool traceShadowRay(vec3 origin, vec3 direction) {
    for(int i = 0; i < ELLIPSOID_COUNT; i++) {
        Ellipsoid ellipsoid;
        ellipsoid.center = u_Ellipsoids[i * ELLIPSOID_VECTORS];
        ellipsoid.radius = u_Ellipsoids[i * ELLIPSOID_VECTORS + 1];
        ellipsoid.color = u_Ellipsoids[i * ELLIPSOID_VECTORS + 2];
        ellipsoid.material = u_Ellipsoids[i * ELLIPSOID_VECTORS + 3];
        Intersect shadowHit = calculateRayEllipsoidIntersect(origin, direction, ellipsoid);
        if(shadowHit.isExisting && shadowHit.distance > CLIP_VAL) {
            return true;
        }
    }

    for(int i = 0; i < TRIANGLE_COUNT; i++) {
        Triangle triangle;
        triangle.vertex1 = u_Triangles[i * TRIANGLE_VECTORS];
        triangle.vertex2 = u_Triangles[i * TRIANGLE_VECTORS + 1];
        triangle.vertex3 = u_Triangles[i * TRIANGLE_VECTORS + 2];
        triangle.normal = u_Triangles[i * TRIANGLE_VECTORS + 3];
        triangle.color = u_Triangles[i * TRIANGLE_VECTORS + 4];
        Intersect shadowHit = calculateRayTriangleIntersect(origin, direction, triangle);
        if(shadowHit.isExisting && shadowHit.distance > CLIP_VAL) {
            return true;
        }
    }
    return false;
}

// Issue #56: next-event estimation toward the environment with
// cosine-weighted importance sampling of the hemisphere.
//
// Sampling: pdf(w) = cos(theta_i) / PI over the hemisphere around the normal.
// With a Lambertian brdf f = albedo / PI, the estimator reduces to:
//   Lo = Le_env(w) * albedo   (cos theta cancels against the pdf)
// Full MIS between this NEE strategy and BSDF-sampled env hits is deferred;
// double counting is avoided by suppressing env hits along rays whose last
// bounce was a diffuse NEE-covered surface.
vec3 sampleEnvironmentIllumination(vec3 point, vec3 normal, vec3 albedo) {
    vec3 basis = abs(normal.x) > 0.9f ? vec3(0.0f, 1.0f, 0.0f) : vec3(1.0f, 0.0f, 0.0f);
    vec3 tangent = normalize(cross(basis, normal));
    vec3 bitangent = cross(normal, tangent);

    // Cosine-weighted hemisphere sample: r = sqrt(u1), phi = 2*PI*u2.
    float u1 = getRand();
    float u2 = getRand();
    float r = sqrt(u1);
    float phi = 6.283185307179586f * u2;
    vec3 local = vec3(r * cos(phi), r * sin(phi), sqrt(max(1.0f - u1, 0.0f)));
    vec3 sampleDir = normalize(local.x * tangent + local.y * bitangent + local.z * normal);

    float ndotl = dot(normal, sampleDir);
    if(ndotl <= 0.0f) {
        return vec3(0.0f);
    }

    vec3 shadowOrigin = point + normal * SHADOW_CLIP;
    if(traceShadowRay(shadowOrigin, sampleDir)) {
        return vec3(0.0f);
    }

    return evaluateEnvironment(sampleDir) * albedo;
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

        // Issue #49: reject back-facing samples before tracing any shadow
        // rays — if the shading point faces away from the light sample, the
        // geometry term is zero and occlusion is irrelevant.
        float ndotl = max(dot(normal, lightDirection), 0.0);
        float cosLight = max(dot(lightNormal, -lightDirection), 0.0);
        if(ndotl <= 0.0 || cosLight <= 0.0) {
            continue;
        }

        // Issue #49: occlusion-only any-hit queries instead of full closest-
        // hit intersects. Each test skips normal/point/color construction and
        // the loop exits on the first blocker found. Works with or without a
        // BVH (issue #47) — a BVH traversal can replace the linear loops
        // without changing these call sites.
        bool occluded = false;

        for(int i = 0; i < ELLIPSOID_COUNT && !occluded; i++) {
            Ellipsoid ellipsoid;
            ellipsoid.center = u_Ellipsoids[i * ELLIPSOID_VECTORS];
            ellipsoid.radius = u_Ellipsoids[i * ELLIPSOID_VECTORS + 1];
            ellipsoid.color = u_Ellipsoids[i * ELLIPSOID_VECTORS + 2];
            ellipsoid.material = u_Ellipsoids[i * ELLIPSOID_VECTORS + 3];

            occluded = rayEllipsoidOccluded(shadowRayOrigin, lightDirection, lightDistance - SHADOW_CLIP, ellipsoid);
        }

        for(int i = 0; i < TRIANGLE_COUNT && !occluded; i++) {
            Triangle triangle;
            triangle.vertex1 = u_Triangles[i * TRIANGLE_VECTORS];
            triangle.vertex2 = u_Triangles[i * TRIANGLE_VECTORS + 1];
            triangle.vertex3 = u_Triangles[i * TRIANGLE_VECTORS + 2];
            triangle.normal = u_Triangles[i * TRIANGLE_VECTORS + 3];
            triangle.color = u_Triangles[i * TRIANGLE_VECTORS + 4];
            // Issue #57: UV/texture slots are irrelevant for occlusion tests
            // but must be populated to satisfy the struct layout.
            triangle.uv1 = u_Triangles[i * TRIANGLE_VECTORS + 5].xy;
            triangle.uv2 = u_Triangles[i * TRIANGLE_VECTORS + 5].zw;
            triangle.uv3 = u_Triangles[i * TRIANGLE_VECTORS + 6].xy;
            triangle.textures = u_Triangles[i * TRIANGLE_VECTORS + 6].zw;

            occluded = rayTriangleOccluded(shadowRayOrigin, lightDirection, lightDistance - SHADOW_CLIP, triangle);
        }

        if(occluded) {
            continue;
        }

        // Area-to-area geometry term for uniform area sampling:
        // Lo = Le * brdf * cos(theta_i) * cos(theta_l) * V / (r^2 * pdf)
        // pdf = 1 / lightArea for uniform sampling over the quad.

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
    // Issue #56: after a diffuse bounce the environment has already been
    // accounted for by cosine-weighted NEE, so an escaping ray must not add
    // the env radiance again. Specular chains (mirror/glass/camera) keep it.
    bool suppressEnvHit = false;

    for(int depth = 0; depth < MAX_BOUNCES; depth++) {
        Intersect hit = findClosestIntersect(point, direction);

        if(!hit.isExisting) {
            if(!suppressEnvHit) {
                accumulated += throughput * evaluateEnvironment(direction);
            }
            break;
        }

        // Issue #57: apply albedo/normal maps at each hit before shading.
        hit.color = sampleAlbedo(hit.color, hit);
        hit.normal = sampleNormal(hit.normal, hit);

        if(isEmitter(hit.material)) {
            accumulated += throughput * hit.color;
            break;
        }

        int materialType = int(hit.material.x + 0.5f);

        // Issue #55: decoupled emissive — emit regardless of color brightness.
        if(isEmissiveMaterial(hit.material)) {
            accumulated += throughput * hit.color * EMISSIVE_STRENGTH;
            break;
        }

        if(materialType == MATERIAL_MIRROR) {
            direction = calculateReflection(direction, hit.normal);
            point = hit.intersect + hit.normal * CLIP_VAL;
            throughput *= hit.color;
            suppressEnvHit = false;

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

            bool isTIR;
            vec3 refracted = calculateRefraction(direction, hit.normal, hit.material.y, isTIR);
            vec3 reflected = calculateReflection(direction, hit.normal);

            float cosTheta = abs(dot(hit.normal, direction));
            float fresnel = fresnelSchlick(cosTheta, hit.material.y);

            bool isReflecting = isTIR || getRand() < fresnel;
            direction = isReflecting ? reflected : refracted;
            suppressEnvHit = false;
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

        // Issue #55: thin-film mirror — interference-tinted reflection.
        if(materialType == MATERIAL_THINFILM) {
            float cosTheta = abs(dot(hit.normal, direction));
            vec3 tint = thinFilmReflectance(cosTheta, hit.material.y, hit.material.z);

            direction = calculateReflection(direction, hit.normal);
            point = hit.intersect + hit.normal * CLIP_VAL;
            throughput *= tint;

            if(depth > 1 && getRand() < P_BOUNCE) {
                break;
            }
            continue;
        }

        // Issue #55: GGX metalness/roughness BRDF — sample the NDF for the
        // microfacet half-vector, evaluate D*G*F, keep energy via the pdf.
        if(materialType == MATERIAL_GGX) {
            float roughness = clamp(hit.material.y, 0.02f, 1.0f);
            float metalness = clamp(hit.material.z, 0.0f, 1.0f);
            float alpha = roughness * roughness;

            vec3 viewDir = -direction;
            vec3 halfVector = sampleGGXHalfVector(hit.normal, roughness);
            vec3 lightDir = reflect(direction, halfVector);

            float ndotl = dot(hit.normal, lightDir);
            float ndotv = dot(hit.normal, viewDir);
            float ndoth = max(dot(hit.normal, halfVector), 0.0f);
            float vdoth = max(dot(viewDir, halfVector), 0.0f);

            if(ndotl <= 0.0f || ndotv <= 0.0f) {
                break;
            }

            vec3 f0 = mix(vec3(0.04f), hit.color, metalness);
            vec3 fresnel = fresnelSchlickVec(vdoth, f0);
            float dTerm = ggxDistribution(ndoth, alpha);
            float gTerm = smithVisibilityApprox(ndotv, ndotl, alpha);

            // Specular weight over the sampling pdf pdf(h) = D * ndoth.
            vec3 specular = dTerm * gTerm * fresnel
                / max(4.0f * ndotv * ndotl, CLIP_VAL)
                * ndotl / max(dTerm * ndoth, CLIP_VAL);

            // Diffuse (Lambert) part only for non-metals; metals absorb.
            vec3 kd = (vec3(1.0f) - fresnel) * (1.0f - metalness) / 3.14159265f;
            vec3 brdfWeight = specular + kd * hit.color;

            accumulated += throughput * calculateDirectIllumination(
                hit.intersect, hit.normal,
                clamp(brdfWeight, vec3(0.0f), vec3(4.0f)));

            direction = normalize(lightDir);
            point = hit.intersect + hit.normal * CLIP_VAL;
            throughput *= clamp(brdfWeight, vec3(0.0f), vec3(4.0f));

            if(depth > 1 && getRand() < P_BOUNCE) {
                break;
            }
            if(max(throughput.r, max(throughput.g, throughput.b)) < 0.001f) {
                break;
            }
            continue;
        }

        // Issue #55: clearcoat — glossy coat lobe over a diffuse base.
        if(materialType == MATERIAL_CLEARCOAT) {
            float coatStrength = clamp(hit.material.z, 0.0f, 1.0f);
            bool isCoat = getRand() < coatStrength;

            if(isCoat) {
                // Coat: perfect specular reflection scaled by Fresnel at ~1.5 IOR.
                float fresnel = fresnelSchlick(abs(dot(hit.normal, direction)), 1.5f);
                direction = calculateReflection(direction, hit.normal);
                point = hit.intersect + hit.normal * CLIP_VAL;
                throughput *= vec3(fresnel);
            } else {
                // Base: Lambert bounce with direct lighting.
                accumulated += throughput * calculateDirectIllumination(hit.intersect, hit.normal, hit.color);
                vec3 bounceDirection = sampleBounceDirection(hit.normal);
                float weight = max(dot(hit.normal, bounceDirection), 0.0f) / max(P_BOUNCE, CLIP_VAL);
                throughput *= hit.color * weight;
                direction = bounceDirection;
                point = hit.intersect + hit.normal * CLIP_VAL;
            }

            if(depth > 1 && getRand() < P_BOUNCE) {
                break;
            }
            if(max(throughput.r, max(throughput.g, throughput.b)) < 0.001f) {
                break;
            }
            continue;
        }

        accumulated += throughput * calculateDirectIllumination(hit.intersect, hit.normal, hit.color);

        // Issue #56: environment (IBL) contribution via importance sampling.
        accumulated += throughput * sampleEnvironmentIllumination(hit.intersect, hit.normal, hit.color);
        suppressEnvHit = true;

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
