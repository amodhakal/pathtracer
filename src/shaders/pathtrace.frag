#version 300 es
precision highp float;

#include <common>

#define MAX_BOUNCES 200
#define LIGHT_SAMPLES 4
#define P_BOUNCE 0.5
// Issue #14: use the shared RAY_EPSILON from common.glsl for all scale-dependent
// geometric bias (ray-origin offsets and shadow-ray distance clipping).
#define SHADOW_CLIP RAY_EPSILON

// Issue #35: firefly clamping — bound each sample's radiance before it is
// accumulated, so rare high-energy spikes (fireflies) can't dominate the
// running average. Applied per-sample in main(), not per-bounce.
#define FIREFLY_CLAMP 10.0
// Issue #62: spectral dispersion strength for glass. The per-channel IOR is
// offset from the material's base IOR by +- this fraction of (ior - 1.0),
// so blue bends more than red and paths split into rainbow fringes.
#define GLASS_DISPERSION 0.06

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
// Issue #64: participating media (see chunks/common.glsl for the encoding).
//   VOLUME : y = density (sigma_t), z = scattering albedo (sigma_s / sigma_t)
#define MATERIAL_VOLUME 7

// Issue #64: emission radiance per unit density inside an emissive medium
// (u_VolumeEmission supplies the color; this scales its contribution).
#define VOLUME_EMISSION_STRENGTH 1.0
// Cap on scatter events inside media so an optically thick volume cannot
// spin forever in the tracking loop (bounded, and RR keeps it unbiased).
#define MAX_VOLUME_SCATTERS 64

in vec2 v_WindowPixels;
out vec4 outColor;

uniform vec3 u_Eye;
// Issue #52: orbit/pan/zoom camera basis (see src/camera.ts).
uniform vec3 u_CamForward;
uniform vec3 u_CamRight;
uniform vec3 u_CamUp;
uniform Light u_Light;
uniform vec3 u_Ellipsoids[ELLIPSOID_COUNT * ELLIPSOID_VECTORS];
uniform vec3 u_Triangles[TRIANGLE_COUNT * TRIANGLE_VECTORS];
// Issue #47: BVH acceleration structure.
uniform vec3 u_BvhNodes[BVH_NODE_COUNT * BVH_NODE_SLOTS];
uniform vec3 u_BvhPrimIndices[PRIMITIVE_COUNT];
uniform vec2 u_Resolution;
uniform float u_FrameCount;
// Issue #65: wall-clock seconds, driven from the renderer each frame. Drives
// time-dependent scene animation; because the accumulation buffer averages
// samples across frames, moving geometry naturally integrates into motion blur.
uniform float u_Time;
uniform vec3 u_EnvTop;
uniform vec3 u_EnvBottom;
uniform float u_EnvIntensity;
uniform sampler2D u_AccumTexture;

// Issue #58: thin-lens camera. u_ApertureRadius is the lens radius (0 disables
// DOF); u_FocalDistance places the sharp focal plane along the view direction.
uniform float u_ApertureRadius;
uniform float u_FocalDistance;

// ---- Issue #64: participating media (global fog) uniforms -----------------
//
// u_FogDensity is the extinction coefficient sigma_t of a homogeneous global
// medium filling the scene. Setting it to 0 disables volumetrics entirely and
// the transport reduces bit-for-bit to the previous surface-only integrator,
// which is how non-volume scenes stay correct.
uniform float u_FogDensity;
// Single-scattering albedo sigma_s / sigma_t in [0,1]: 0 = purely absorbing
// (smoke silhouette), 1 = purely scattering (conservative fog).
uniform float u_FogScatterAlbedo;
// Tint applied to scattered radiance (the medium's scattering color).
uniform vec3 u_FogColor;
// Emitted radiance per unit optical depth (glowing media, e.g. fire/plasma).
uniform vec3 u_FogEmission;
// Henyey-Greenstein anisotropy g in (-1,1): 0 = isotropic, >0 forward, <0 back.
uniform float u_FogAnisotropy;

// Issue #61: surface next-event estimation toggle. Non-zero enables explicit
// area sampling of the emissive scene primitives combined with the existing
// BSDF/path sampling via the MIS power heuristic; 0 restores pure path
// tracing exactly as before this feature.
uniform float u_NeeEnabled;
// Issue #61: number of explicit light samples drawn per emitter per bounce
// when NEE is enabled (kept a compile-time constant for unrolled loops).
#define NEE_LIGHT_SAMPLES 1

// Issue #57: albedo and normal map texture arrays. Each scene triangle can
// reference one albedo map (id in hit.textures.x) and one normal map
// (hit.textures.y); -1 means "no texture". MAX_TEXTURES is injected at
// compile time from the texture source lists in textures.ts (issue #40).
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
#include <bvh>
#include <prng>

// ---- Issue #65: temporal animation ----------------------------------------
//
// The accumulation buffer stores a SUM of per-frame radiance samples and the
// display pass divides by the frame count, so any scene quantity that varies
// with u_Time is averaged over the frames it took to converge. That average IS
// the motion blur: a sphere translating through the frame contributes radiance
// from every position it occupied, weighted by how long it lingered there.
// u_FrameCount keeps decorrelating the RNG; u_Time supplies the trajectory.

// Animation period in seconds — one full orbit of the moving ellipsoid.
#define ANIMATION_PERIOD 8.0

// Issue #65: time-varying positions for animated scene elements. Kept in one
// place so intersection code (which reads u_Ellipsoids/u_Triangles directly)
// can apply identical transforms without duplicating math.

// Orbital offset applied to the first ellipsoid (the yellow diffuse ball).
vec3 animatedEllipsoidOffset(int index) {
    if(index != 0) {
        return vec3(0.0f);
    }
    float phase = 2.0f * 3.14159265f * u_Time / ANIMATION_PERIOD;
    return vec3(0.25f * sin(phase), 0.1f * sin(2.0f * phase), 0.25f * cos(phase));
}

// Returns the (possibly animated) center of ellipsoid `index`.
vec3 ellipsoidCenter(int index) {
    return u_Ellipsoids[index * ELLIPSOID_VECTORS] + animatedEllipsoidOffset(index);
}


vec3 tracePath(vec3 startPoint, vec3 startDirection);
vec3 evaluateEnvironment(vec3 direction);
vec3 sampleEnvironmentIllumination(vec3 point, vec3 normal, vec3 albedo);
vec3 calculateDirectIllumination(vec3 point, vec3 normal, vec3 color);
vec3 sampleBounceDirection(vec3 normal);
bool isEmitter(vec3 material);
float fresnelSchlick(float cosTheta, float ior);

// Issue #32: exact unpolarized dielectric Fresnel (no Schlick approximation).
// cosThetaI is measured against the geometric normal on the incident side;
// eta = n_incident / n_transmitted. Returns the fraction of energy reflected
// and handles total internal reflection (returns 1.0 above the critical
// angle), unlike Schlick which silently underestimates reflectivity near TIR.
float fresnelDielectric(float cosThetaI, float eta);
vec3 calculateReflection(vec3 incident, vec3 faceNormal);
vec3 calculateRefraction(vec3 incident, vec3 faceNormal, float ior, out bool isTIR);
bool sampleGlassBsdf(vec3 incident, vec3 faceNormal, vec3 albedo,
                     float ior, float opacity,
                     out vec3 outDirection, out vec3 outWeight);

// Issue #61: surface next-event estimation with MIS. Explicitly samples an
// emissive scene primitive from a shading point, weights the contribution by
// the MIS power heuristic against the given BSDF-sampling pdf of the same
// direction (bsdfPdf <= 0 means the BSDF sampler provably cannot produce this
// direction — delta lobes, eye rays — so the light sample keeps full weight).
vec3 sampleLightNEE(vec3 point, vec3 normal, vec3 bsdfColor, float bsdfPdf);

// Issue #29: RNG moved into the shader (chunks/prng.glsl). The seed is
// initialized once per pixel per frame in main() from v_WindowPixels and
// u_FrameCount; getRand() just advances the PRNG state.

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

// Issue #62: spectral dispersion. Pick one RGB channel stochastically and
// offset the base IOR for it — blue bends more, red less. Over accumulated
// samples this splits refraction into rainbow fringes like a prism.
float sampleDispersiveIor(float baseIor) {
    float channel = getRand() * 3.0f;
    // Offsets in units of (baseIor - 1.0) so dispersion scales with the
    // material's own refractivity: R -1/3, G 0, B +1/3 of GLASS_DISPERSION.
    float offset = (floor(channel) - 1.0f) * (2.0f / 3.0f) * GLASS_DISPERSION;
    return max(baseIor + offset * (baseIor - 1.0f), 1.0f);
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

// ---- Issue #32: dielectric BSDF sampling with MIS --------------------------

// Exact unpolarized Fresnel equations for a dielectric interface.
// eta = n_i / n_t. Uses the full sine/cosine formulation rather than Schlick
// so grazing angles and total internal reflection are handled correctly —
// Schlick's F0-based form underestimates reflectance near the critical angle,
// which biased glass throughput in the old lobe hack.
float fresnelDielectric(float cosThetaI, float eta) {
    cosThetaI = clamp(cosThetaI, -1.0f, 1.0f);

    // Determine which side we are entering/exiting and flip eta accordingly.
    bool entering = cosThetaI > 0.0f;
    float ni = entering ? 1.0f : eta;   // incident medium IOR
    float nt = entering ? eta : 1.0f;   // transmitted medium IOR
    float sinThetaI = sqrt(max(1.0f - cosThetaI * cosThetaI, 0.0f));
    float sinThetaT = ni / max(nt, CLIP_VAL) * sinThetaI;

    // Total internal reflection.
    if(sinThetaT >= 1.0f) {
        return 1.0f;
    }

    float cosThetaT = sqrt(max(1.0f - sinThetaT * sinThetaT, 0.0f));
    float cosThetaIabs = abs(cosThetaI);

    float rs = (ni * cosThetaIabs - nt * cosThetaT)
        / max(ni * cosThetaIabs + nt * cosThetaT, CLIP_VAL);
    float rp = (ni * cosThetaT - nt * cosThetaIabs)
        / max(ni * cosThetaT + nt * cosThetaIabs, CLIP_VAL);
    return 0.5f * (rs * rs + rp * rp);
}

// Issue #32: proper BSDF sampling for glass with explicit MIS accounting.
//
// The glass interface is a delta BSDF: both lobes (specular reflection and
// specular refraction) have Dirac delta PDFs, so NEE toward area lights is
// impossible along a delta path — the only viable strategy is BSDF sampling.
// "MIS" here therefore reduces to choosing the lobe by its exact energy
// fraction: picking reflection with probability Fr (the true reflectance)
// makes each sampled lobe an importance-sampled estimator of the BSDF with
// weight f(w_i,w_o)*cos/pdf = 1 per channel, so the estimator is unbiased
// with minimum variance for a two-lobe delta BSDF.
//
// Composition contract with light sampling (#31): calculateDirectIllumination
// must divide by its own strategy pdf only (the corrected light PDF); it is
// never applied to delta-BSDF hits like this one, so no MIS power heuristic
// between strategies is needed and neither side double counts. Non-delta
// lobes (diffuse/GGX) keep their existing suppressEnvHit-style separation.
//
// Returns false when the path terminates (energy fully absorbed).
bool sampleGlassBsdf(vec3 incident, vec3 faceNormal, vec3 albedo,
                     float ior, float opacity,
                     out vec3 outDirection, out vec3 outWeight) {
    float cosThetaI = dot(-incident, faceNormal);
    bool entering = cosThetaI > 0.0f;
    // n_i / n_t for this transition (glass -> air on exit).
    float eta = entering ? 1.0f / ior : ior;

    float fresnel = fresnelDielectric(cosThetaI, eta);

    vec3 refracted = calculateRefraction(incident, faceNormal, ior);
    bool tir = refracted == vec3(0.0f);

    // Lobe selection by exact Fresnel fraction == delta-lobe MIS weighting.
    bool isReflecting = tir || getRand() < fresnel;

    if(isReflecting) {
        outDirection = normalize(calculateReflection(incident, faceNormal));
        // Reflection lobe is untinted (mirror-like); tint applies on transmission.
        outWeight = vec3(1.0f);
    } else {
        outDirection = normalize(refracted);
        // Beer-like absorption applied once per traversal, scaled by opacity:
        // tinted fraction = mix(white, albedo, opacity).
        outWeight = mix(vec3(1.0f), albedo, opacity);
    }

    return max(outWeight.r, max(outWeight.g, outWeight.b)) >= 0.001f
        && dot(outDirection, faceNormal) != 0.0f;
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
}

// Issue #56: procedural gradient environment map. Rays that escape the
// scene pick up infinite-geometry radiance from this IBL instead of black.
vec3 evaluateEnvironment(vec3 direction) {
    float t = clamp(direction.y * 0.5f + 0.5f, 0.0f, 1.0f);
    return mix(u_EnvBottom, u_EnvTop, t) * u_EnvIntensity;
}

bool traceShadowRay(vec3 origin, vec3 direction) {
    for(int i = 0; i < ELLIPSOID_COUNT; i++) {
        // Issue #48: indexed occluder with explicit (animated) center — no
        // Ellipsoid/Intersect struct allocated per ellipsoid. The animated
        // center keeps issue #65 motion blur correct under the refactor.
        if(rayEllipsoidOccluded(ellipsoidCenter(i), i, origin, direction, 1e30f)) {
            return true;
        }
    }

    for(int i = 0; i < TRIANGLE_COUNT; i++) {
        // Issue #48: indexed occluder reads u_Triangles directly — no
        // Triangle/Intersect struct allocated per triangle.
        if(rayTriangleOccluded(i, origin, direction, 1e30f)) {
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

        // Issue #49/#47: occlusion-only any-hit query via BVH traversal.
        bool occluded = bvhAnyHit(shadowRayOrigin, lightDirection, lightDistance - SHADOW_CLIP);
        // Issue #65: animated ellipsoid centers are applied TS-side when
        // uploading u_Ellipsoids each frame, so the BVH traversal above sees
        // the animated positions without any shader-side changes.

        // Issue #48: indexed occlusion test reads u_Triangles directly by
        // primitive index, so no Triangle struct is allocated per triangle in
        // this (per-light-sample, per-bounce) loop.
        for(int i = 0; i < TRIANGLE_COUNT && !occluded; i++) {
            occluded = rayTriangleOccluded(i, shadowRayOrigin, lightDirection, lightDistance - SHADOW_CLIP);
        }

        if(occluded) {
            continue;
        }

        // Issue #31: correct Monte Carlo estimator for uniform area sampling.
        // The sampler draws points uniformly on the quad, so the sampling pdf
        // is the area density pdf_A = 1 / lightArea. The geometry term's
        // cos(theta_l) / r^2 factor is exactly the pdf_A -> pdf_w (solid
        // angle) measure conversion, giving:
        //   Lo += Le * f_r * cos(theta_i) * V * G / pdf_A
        // with the Lambertian BRDF f_r = albedo / PI. (The previous version
        // used the raw albedo as the BRDF, over-weighting direct light by PI.)

        float lightArea = 4.0f * u_Light.size.x * u_Light.size.y;
        float pdfArea = 1.0f / max(lightArea, CLIP_VAL);
        vec3 brdf = color * (1.0f / 3.14159265f);
        float solidAngleConversion = cosLight
            / max(lightDistance * lightDistance, CLIP_VAL);
        accumulated += u_Light.color * brdf * ndotl * solidAngleConversion / pdfArea;
    }

    return accumulated / float(LIGHT_SAMPLES);
}

vec3 sampleBounceDirection(vec3 normal) {
    vec3 basis = abs(normal.x) > 0.9f ? vec3(0.0f, 1.0f, 0.0f) : vec3(1.0f, 0.0f, 0.0f);
    vec3 tangent = normalize(cross(basis, normal));
    vec3 bitangent = cross(normal, tangent);

    // Issue #30: cosine-weighted hemisphere sampling — sample the unit disk
    // and project up, giving a direction density proportional to cos(theta)
    // about the normal. No rejection loop needed; the BRDF's cosine factor
    // cancels the pdf for Lambertian surfaces.
    float r = sqrt(getRand());
    float phi = 6.28318530718f * getRand();
    float x = r * cos(phi);
    float y = r * sin(phi);
    float z = sqrt(max(0.0f, 1.0f - x * x - y * y));

    return x * tangent + y * bitangent + z * normal;
}

// Issue #61: surface next-event estimation with multiple importance sampling.
//
// Strategy: draw one scene primitive uniformly at random, sample a point
// uniformly on its axis-aligned bounds (the same cheap stand-in for area
// sampling used by the medium NEE below), connect with a shadow ray, and add
// the contribution only when the connection actually reaches THAT primitive —
// otherwise the estimator would count radiance from the wrong emitter.
// The solid-angle pdf of this strategy is computed by lightPdfW above.
//
// MIS: the sampled direction may also be produced by the BSDF/path sampler,
// so the two strategies are combined with the power heuristic
//   w_light = p_l^2 / (p_l^2 + p_b^2),
// which keeps the combined estimator unbiased while killing the fireflies a
// pure BSDF path tracer produces near small or intense emitters.
//
// bsdfPdf <= 0 is the "delta" sentinel: the BSDF sampler provably cannot
// generate this direction (mirror/glass/thinfilm/coat lobes, eye rays), so
// there is no overlap and the light sample keeps full weight.
//
// The virtual u_Light quad is NOT part of this scheme: it is invisible to
// BSDF-sampled rays (it never enters findClosestIntersect), so the existing
// calculateDirectIllumination estimator has no overlapping strategy and stays
// MIS-weight-1 by construction.
vec3 sampleLightNEE(vec3 point, vec3 normal, vec3 bsdfColor, float bsdfPdf) {
    int totalPrimitives = PRIMITIVE_COUNT;
    if(totalPrimitives <= 0 || u_NeeEnabled == 0.0f) {
        return vec3(0.0f);
    }

    vec3 accumulated = vec3(0.0f);
    for(int s = 0; s < NEE_LIGHT_SAMPLES; s++) {
        // Uniformly pick one primitive, then a uniform point on its bounds.
        int primIndex = int(min(getRand() * float(totalPrimitives),
                                float(totalPrimitives) - 0.001f));

        bool isTriangle = primIndex < TRIANGLE_COUNT;

        // Bounds of the chosen primitive (animated ellipsoid #0 included).
        vec3 bMin, bMax;
        if(isTriangle) {
            Triangle tri = triangleAt(primIndex);
            bMin = min(min(tri.vertex1, tri.vertex2), tri.vertex3);
            bMax = max(max(tri.vertex1, tri.vertex2), tri.vertex3);
        } else {
            int eIdx = primIndex - TRIANGLE_COUNT;
            vec3 center = ellipsoidCenter(eIdx);
            vec3 radius = max(u_Ellipsoids[eIdx * ELLIPSOID_VECTORS + 1], vec3(RAY_EPSILON));
            bMin = center - radius;
            bMax = center + radius;
        }

        float u1 = getRand();
        float u2 = getRand();
        float u3 = getRand();
        vec3 lightPoint = mix(bMin, bMax, vec3(u1, u2, u3));

        vec3 toLight = lightPoint - point;
        float lightDistance = length(toLight);
        if(lightDistance < RAY_EPSILON) {
            continue;
        }
        vec3 shadowDir = toLight / lightDistance;

        // Shading-side backface rejection before tracing anything.
        if(dot(normal, shadowDir) <= 0.0f) {
            continue;
        }

        // Occlusion-only any-hit via BVH; clip slightly short of the target.
        if(bvhAnyHit(point + normal * SHADOW_CLIP, shadowDir, lightDistance - SHADOW_CLIP)) {
            continue;
        }

        // Confirm the connection actually landed on the sampled primitive:
        // the bounds are a sampling proxy, not the emitter surface itself.
        float hitDistance;
        bool reachedTarget;
        if(isTriangle) {
            reachedTarget = triangleHitDistance(primIndex, point + normal * SHADOW_CLIP,
                                                shadowDir, lightDistance, hitDistance);
        } else {
            reachedTarget = ellipsoidHitDistance(primIndex - TRIANGLE_COUNT,
                                                 point + normal * SHADOW_CLIP,
                                                 shadowDir, lightDistance, hitDistance);
        }
        if(!reachedTarget) {
            continue;
        }

        // Emissive payload of the target. Triangles carry no material slot in
        // their packed layout, so only ellipsoids act as emitters here; that
        // matches the active transport, where triangle hits always take the
        // diffuse branch (their material is vec3(0)) and never emit.
        vec3 emission = vec3(0.0f);
        if(!isTriangle) {
            vec3 material = u_Ellipsoids[(primIndex - TRIANGLE_COUNT) * ELLIPSOID_VECTORS + 3];
            if(isEmitter(material)) {
                // Match the active transport: the MATERIAL_EMISSIVE hit branch
                // adds plain hit.color (its later EMISSIVE_STRENGTH variant is
                // unreachable behind the early isEmitter exit).
                emission = u_Ellipsoids[(primIndex - TRIANGLE_COUNT) * ELLIPSOID_VECTORS + 2];
            }
        }
        if(emission.r + emission.g + emission.b <= 0.0f) {
            continue;
        }

        // Geometry term for the connection (light-side cosine is implicit in
        // the hit test against the true curved/planar surface).
        vec3 delta = lightPoint - (point + normal * SHADOW_CLIP);
        float distanceSquared = dot(delta, delta);
        float geometryTerm = 1.0f / max(distanceSquared, CLIP_VAL);

        float pdfW = float(totalPrimitives)
            / max(aabbVolume(bMin, bMax), CLIP_VAL)
            * geometryTerm;

        // Lambertian BRDF value toward the light sample.
        vec3 brdfValue = bsdfColor * (1.0f / 3.14159265f);

        // Power-heuristic MIS weight (beta = 2) against the BSDF sampler.
        float misWeight = pdfW * pdfW
            / max(pdfW * pdfW + bsdfPdf * bsdfPdf, CLIP_VAL);

        accumulated += emission * brdfValue * geometryTerm * misWeight / pdfW;
    }
    return accumulated;
}

// ---- Issue #64: volumetric path tracing ------------------------------------
//
// Radiative transfer in a participating medium adds three interactions to the
// surface-only estimator: out-scattering + absorption (together extinction
// sigma_t), in-scattering (sigma_s = albedo * sigma_t) and emission.
//
// Distance sampling. For a homogeneous medium the free-flight pdf is
//   p(t) = sigma_t * exp(-sigma_t * t),
// which we invert analytically: t = -ln(1 - u) / sigma_t. Because the medium
// is homogeneous, analytic sampling is exact and no null-collision (delta-
// tracking) rejection is required — delta tracking degenerates to this closed
// form when the majorant equals the real density. The heterogeneous path is
// kept structurally intact below (sampleMediumDistance returns the sampled
// free-flight distance and the caller compares it against the surface hit
// distance, exactly as a delta/ratio tracker would), so swapping in a density
// field later only changes sampleMediumDistance/mediumTransmittance.
//
// Weighting. Sampling t from p(t) and scattering with probability equal to the
// scattering albedo makes the estimator weight
//   sigma_s * T(t) / (p(t) * P_scatter) = 1,
// i.e. an unbiased, minimum-variance single-lobe estimator, so no explicit
// transmittance factor has to be multiplied into the throughput on a scatter
// event. On a surface event (t beyond the hit) the ratio T(d)/P(t > d) is
// likewise 1 for a homogeneous medium.

// Analytic free-flight distance for extinction `sigmaT`. Returns a huge value
// when the medium is effectively vacuum so the caller always picks the surface.
float sampleMediumDistance(float sigmaT) {
    if(sigmaT <= 0.0f) {
        return 1.0e30f;
    }
    float u = getRand();
    // Guard log(0) — u is in [0,1); clamp keeps the log finite.
    return -log(max(1.0f - u, CLIP_VAL)) / sigmaT;
}

// Beer-Lambert transmittance through `distance` of homogeneous medium. Used
// for shadow/NEE rays, which must be attenuated rather than binary-occluded
// once a medium is present (this is the "ratio tracking" estimator's closed
// form for a homogeneous majorant).
vec3 mediumTransmittance(float sigmaT, float distance) {
    if(sigmaT <= 0.0f) {
        return vec3(1.0f);
    }
    return vec3(exp(-sigmaT * max(distance, 0.0f)));
}

// Henyey-Greenstein phase function sampling. g = 0 reduces to isotropic
// sampling on the sphere; the returned direction is already distributed
// according to the phase function so the estimator weight stays 1.
vec3 samplePhaseDirection(vec3 direction, float g) {
    float u1 = getRand();
    float u2 = getRand();
    float phi = 6.283185307179586f * u2;

    float cosTheta;
    if(abs(g) < 1.0e-3f) {
        // Isotropic: cosTheta uniform in [-1, 1].
        cosTheta = 1.0f - 2.0f * u1;
    } else {
        float g2 = g * g;
        float sqrTerm = (1.0f - g2) / max(1.0f + g - 2.0f * g * u1, CLIP_VAL);
        cosTheta = -(1.0f + g2 - sqrTerm * sqrTerm) / max(2.0f * g, CLIP_VAL);
        cosTheta = clamp(cosTheta, -1.0f, 1.0f);
    }
    float sinTheta = sqrt(max(1.0f - cosTheta * cosTheta, 0.0f));

    // Build a frame around the incoming direction and rotate into world space.
    vec3 forward = normalize(direction);
    vec3 tangent, bitangent;
    buildOrthonormalBasis(forward, tangent, bitangent);
    return normalize(sinTheta * cos(phi) * tangent
        + sinTheta * sin(phi) * bitangent
        + cosTheta * forward);
}

// Single-scattering NEE from a medium point toward the area light. The phase
// function replaces the BRDF and there is no cosine foreshortening term at a
// volumetric vertex; the light-side geometry term is unchanged.
vec3 sampleMediumDirectLight(vec3 point, vec3 wo, float g) {
    vec3 lightNormal = normalize(u_Light.normal);
    vec3 basis = abs(lightNormal.x) > 0.9f ? vec3(0.0f, 1.0f, 0.0f) : vec3(1.0f, 0.0f, 0.0f);
    vec3 lightTangent = normalize(cross(basis, lightNormal));
    vec3 lightBitangent = cross(lightNormal, lightTangent);

    vec2 areaSample = vec2(getRand(), getRand());
    vec3 lightPoint = u_Light.position
        + lightTangent * ((areaSample.x - 0.5f) * 2.0f * u_Light.size.x)
        + lightBitangent * ((areaSample.y - 0.5f) * 2.0f * u_Light.size.y);

    vec3 toLight = lightPoint - point;
    float lightDistance = length(toLight);
    if(lightDistance < CLIP_VAL) {
        return vec3(0.0f);
    }
    vec3 lightDirection = toLight / lightDistance;

    float cosLight = max(dot(lightNormal, -lightDirection), 0.0f);
    if(cosLight <= 0.0f) {
        return vec3(0.0f);
    }

    if(bvhAnyHit(point, lightDirection, lightDistance - SHADOW_CLIP)) {
        return vec3(0.0f);
    }

    // Henyey-Greenstein phase value for the sampled light direction.
    float cosTheta = dot(normalize(wo), lightDirection);
    float g2 = g * g;
    float denom = max(1.0f + g2 - 2.0f * g * cosTheta, CLIP_VAL);
    float phase = (1.0f - g2) / (12.566370614359172f * denom * sqrt(denom));

    float lightArea = 4.0f * u_Light.size.x * u_Light.size.y;
    float pdfArea = 1.0f / max(lightArea, CLIP_VAL);
    float solidAngleConversion = cosLight / max(lightDistance * lightDistance, CLIP_VAL);

    // Attenuate the light contribution by the medium's transmittance along the
    // shadow ray (ratio-tracking closed form for a homogeneous medium).
    vec3 transmittance = mediumTransmittance(u_FogDensity, lightDistance);

    return u_Light.color * u_FogColor * phase * transmittance
        * solidAngleConversion / pdfArea;
}

// Issue #61: solid-angle density of the NEE light-sampling strategy evaluated
// toward an emissive hit at `hitPoint`, given the shading (ray-origin) point
// and the primitive identity of the hit. This is the pdf of the exact sampler
// used in sampleLightNEE (uniform primitive choice, uniform point on the
// primitive's axis-aligned bounds, converted to the sphere measure), used to
// MIS-weight BSDF-sampled emitter hits against those explicit samples.
// Returns a negative pdf (no overlap with the light strategy) when NEE is
// disabled, which makes the corresponding MIS weight collapse to 1.
float emitterLightPdfW(int primIndex, bool isTriangle,
                       vec3 shadingPoint, vec3 hitPoint) {
    if(u_NeeEnabled == 0.0f || PRIMITIVE_COUNT <= 0) {
        return -1.0f;
    }
    // Bounds of the chosen primitive (animated ellipsoid #0 included) — must
    // mirror the sampler in sampleLightNEE exactly.
    vec3 bMin, bMax;
    if(isTriangle) {
        Triangle tri = triangleAt(primIndex);
        bMin = min(min(tri.vertex1, tri.vertex2), tri.vertex3);
        bMax = max(max(tri.vertex1, tri.vertex2), tri.vertex3);
    } else {
        int eIdx = primIndex - TRIANGLE_COUNT;
        vec3 center = ellipsoidCenter(eIdx);
        vec3 radius = max(u_Ellipsoids[eIdx * ELLIPSOID_VECTORS + 1], vec3(RAY_EPSILON));
        bMin = center - radius;
        bMax = center + radius;
    }
    vec3 delta = hitPoint - shadingPoint;
    float distanceSquared = max(dot(delta, delta), CLIP_VAL);
    // Uniform primitive choice: pdf_A = 1 / PRIMITIVE_COUNT over the chosen
    // primitive's bounds, converted to solid angle by 1 / r^2.
    return float(PRIMITIVE_COUNT)
        / max(aabbVolume(bMin, bMax), CLIP_VAL)
        / distanceSquared;
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
    // Issue #61: solid-angle pdf of the BSDF/path sampler that produced the
    // current ray segment, or a negative sentinel when the segment cannot be
    // attributed to a BSDF-sampling strategy (camera rays, mirror/glass/
    // thin-film/coat delta lobes, phase-function scattering). Emitter hits
    // found along such segments keep full weight (no MIS split); along
    // diffuse/GGX segments they are combined with the explicit light samples
    // through the power heuristic so nothing is counted twice.
    float prevBsdfPdfW = -1.0f;
    // Issue #64: number of medium scatter events so far along this path.
    int volumeScatters = 0;

    for(int depth = 0; depth < MAX_BOUNCES; depth++) {
        Intersect hit = findClosestIntersect(point, direction);

        // ---- Issue #64: medium interaction test ----------------------------
        //
        // Sample a free-flight distance in the participating medium and race it
        // against the surface hit. If the medium wins the ray scatters (or is
        // absorbed) before reaching any geometry; otherwise transport continues
        // to the surface exactly as before. With u_FogDensity == 0 the sampled
        // distance is +inf, so non-volume scenes take the surface branch every
        // time and the integrator is unchanged.
        if(u_FogDensity > 0.0f && volumeScatters < MAX_VOLUME_SCATTERS) {
            float surfaceDistance = hit.isExisting ? hit.distance : 1.0e30f;
            float mediumDistance = sampleMediumDistance(u_FogDensity);

            if(mediumDistance < surfaceDistance) {
                vec3 scatterPoint = point + direction * mediumDistance;

                // Volumetric emission: radiance added per collision, scaled by
                // the medium's emission color (zero for non-emissive media).
                accumulated += throughput * u_FogEmission * VOLUME_EMISSION_STRENGTH;

                // Absorption vs. scattering: the single-scattering albedo is
                // exactly the probability of surviving the collision as a
                // scattering event, which makes the surviving path's weight 1.
                float albedo = clamp(u_FogScatterAlbedo, 0.0f, 1.0f);
                if(getRand() >= albedo) {
                    break; // absorbed
                }

                // Single-scattering NEE from the medium vertex.
                accumulated += throughput
                    * sampleMediumDirectLight(scatterPoint, -direction, u_FogAnisotropy);
                // Issue #61: explicit samples of emissive geometry from the
                // medium vertex. The phase function is not part of the MIS
                // balance (bsdfPdf sentinel < 0), matching the unweighted
                // area-light NEE above.
                accumulated += throughput * sampleLightNEE(scatterPoint, -direction,
                    vec3(1.0f), -1.0f);

                // Continue along a phase-function-sampled direction. Tint by
                // the medium color so colored fog stays colored on multiple
                // scattering events.
                direction = samplePhaseDirection(direction, u_FogAnisotropy);
                point = scatterPoint;
                throughput *= u_FogColor;
                // Issue #61: a phase-sampled segment carries no BSDF-sampling
                // pdf, so an emitter hit along it keeps full weight.
                prevBsdfPdfW = -1.0f;
                // The scattered ray can legitimately reach the environment,
                // and the volumetric NEE above only sampled the area light.
                suppressEnvHit = false;
                volumeScatters++;

                if(depth > 1 && getRand() < P_BOUNCE) {
                    break;
                }
                if(depth > 1) {
                    throughput /= P_BOUNCE;
                }
                if(max(throughput.r, max(throughput.g, throughput.b)) < 0.001f) {
                    break;
                }
                continue;
            }
        }

        if(!hit.isExisting) {
            if(!suppressEnvHit) {
                accumulated += throughput * evaluateEnvironment(direction);
            }
            break;
        }

        // Issue #57: apply albedo/normal maps at each hit before shading.
        hit.color = sampleAlbedo(hit.color, hit);
        hit.normal = sampleNormal(hit.normal, hit);

        // Issue #61: MIS weighting for emitter hits found by BSDF-sampled
        // rays. Along diffuse/GGX segments the explicit light samples in
        // sampleLightNEE already cover this emitter, so the hit contribution
        // is combined through the power heuristic; along camera rays and
        // delta-lobe chains (mirror/glass/thinfilm/coat, prevBsdfPdfW < 0)
        // the BSDF sampler is the only strategy that can see the emitter and
        // the hit keeps full weight. The virtual u_Light quad is not scene
        // geometry, so its dedicated NEE estimator never overlaps this path.
        if(isEmitter(hit.material)) {
            float misWeight = prevBsdfPdfW <= 0.0f
                ? 1.0f
                : (prevBsdfPdfW * prevBsdfPdfW)
                    / max(prevBsdfPdfW * prevBsdfPdfW
                          + emitterLightPdfW(bvhLastPrimIndex, bvhLastIsTriangle,
                                             point, hit.intersect), CLIP_VAL);
            accumulated += throughput * hit.color * misWeight;
            break;
        }

        int materialType = int(hit.material.x + 0.5f);

        // ---- Issue #64: bounded participating medium -----------------------
        //
        // A MATERIAL_VOLUME primitive is not a surface: it delimits a region of
        // homogeneous medium (density in material.y, scattering albedo in
        // material.z). On entry we march to the far side of the volume, sample a
        // free-flight distance against that interior span, and either scatter
        // inside it or pass straight through the boundary unrefracted. This is
        // the same tracking loop as the global fog above, restricted to the
        // object's interior, so the two compose without double counting.
        if(materialType == MATERIAL_VOLUME) {
            float sigmaT = max(hit.material.y, 0.0f);
            float volumeAlbedo = clamp(hit.material.z, 0.0f, 1.0f);

            // Step just inside the boundary and find the exit interface.
            vec3 insidePoint = hit.intersect + direction * RAY_EPSILON;
            Intersect exitHit = findClosestIntersect(insidePoint, direction);
            float span = exitHit.isExisting ? exitHit.distance : 1.0e30f;

            float mediumDistance = sampleMediumDistance(sigmaT);
            if(mediumDistance < span && volumeScatters < MAX_VOLUME_SCATTERS) {
                vec3 scatterPoint = insidePoint + direction * mediumDistance;

                // Emission inside the bounded medium is tinted by the volume's
                // own color, which keeps a glowing volume independent of fog.
                accumulated += throughput * hit.color * u_FogEmission
                    * VOLUME_EMISSION_STRENGTH;

                if(getRand() >= volumeAlbedo) {
                    break; // absorbed inside the volume
                }

                accumulated += throughput
                    * hit.color
                    * sampleMediumDirectLight(scatterPoint, -direction, u_FogAnisotropy);

                direction = samplePhaseDirection(direction, u_FogAnisotropy);
                point = scatterPoint;
                throughput *= hit.color;
                suppressEnvHit = false;
                volumeScatters++;
            } else {
                // No collision inside the span: cross the boundary unchanged
                // (the medium is index-matched, so no refraction happens).
                point = insidePoint + direction * min(span + RAY_EPSILON, 1.0e29f);
            }

            if(depth > 1 && getRand() < P_BOUNCE) {
                break;
            }
            if(depth > 1) {
                throughput /= P_BOUNCE;
            }
            if(max(throughput.r, max(throughput.g, throughput.b)) < 0.001f) {
                break;
            }
            continue;
        }

        // Issue #55: decoupled emissive — emit regardless of color brightness.
        if(isEmissiveMaterial(hit.material)) {
            accumulated += throughput * hit.color * EMISSIVE_STRENGTH;
            break;
        }

        if(materialType == MATERIAL_MIRROR) {
            direction = calculateReflection(direction, hit.normal);
            point = hit.intersect + hit.normal * RAY_EPSILON;
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
            // Issue #32: proper dielectric BSDF sampling with MIS-consistent
            // lobe selection (exact Fresnel fractions, exact Fresnel equations,
            // TIR handled) instead of the Schlick-based lobe hack.
            vec3 newDirection;
            vec3 lobeWeight;
            // Issue #62: sample a per-channel dispersive IOR so refraction (and
            // its Fresnel weight) varies with wavelength. Reflection stays
            // achromatic; only the refracted path disperses.
            float baseIor = hit.material.y;
            float ior = sampleDispersiveIor(baseIor);
            bool survived = sampleGlassBsdf(direction, hit.normal, hit.color,
                ior, hit.material.z, newDirection, lobeWeight);

            direction = newDirection;
            suppressEnvHit = false; // specular chain: env hits stay enabled
            vec3 travelSide = dot(direction, hit.normal) < 0.0f ? -hit.normal : hit.normal;
            point = hit.intersect + travelSide * CLIP_VAL;
            throughput *= lobeWeight;

            // Path termination: absorbed by the BSDF weight check or RR below.
            if(!survived) {
                break;
            }

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

            // Issue #61: explicit light samples combined with the BSDF-sampled
            // bounce through the MIS power heuristic (the BSDF value toward
            // each sampled direction is folded into sampleLightNEE).
            accumulated += throughput * sampleLightNEE(hit.intersect, hit.normal,
                clamp(brdfWeight, vec3(0.0f), vec3(4.0f)),
                max(dTerm * ndoth, CLIP_VAL) / (4.0f * ndotv));

            direction = normalize(lightDir);
            point = hit.intersect + hit.normal * CLIP_VAL;
            throughput *= clamp(brdfWeight, vec3(0.0f), vec3(4.0f));

            // Issue #61: the next segment is attributed to the GGX sampler;
            // its solid-angle pdf is D*ndoth/(4|o·h|).
            prevBsdfPdfW = max(dTerm * ndoth, CLIP_VAL) / (4.0f * ndotv);

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
                // Issue #61: NEE+MIS toward emissive geometry; the virtual
                // u_Light quad keeps its own MIS-weight-1 estimator.
                accumulated += throughput * calculateDirectIllumination(hit.intersect, hit.normal, hit.color);
                vec3 bounceDirection = sampleBounceDirection(hit.normal);
                accumulated += throughput * sampleLightNEE(hit.intersect, hit.normal,
                    hit.color, max(dot(hit.normal, bounceDirection), 0.0f) / 3.14159265f);
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

        // Issue #61: NEE+MIS toward emissive geometry. The explicit samples
        // and the cosine-sampled bounce below are combined with the power
        // heuristic (the sampler's pdf is passed in for the weight).
        vec3 bounceDirection = sampleBounceDirection(hit.normal);
        float bouncePdfW = max(dot(hit.normal, bounceDirection), 0.0f) / 3.14159265f;
        accumulated += throughput * sampleLightNEE(hit.intersect, hit.normal,
            hit.color, bouncePdfW);

        // Issue #56: environment (IBL) contribution via importance sampling.
        accumulated += throughput * sampleEnvironmentIllumination(hit.intersect, hit.normal, hit.color);
        suppressEnvHit = true;

        if(depth > 1 && getRand() < P_BOUNCE) {
            break;
        }

        float weight = max(dot(hit.normal, bounceDirection), 0.0f) / P_BOUNCE;
        throughput *= hit.color * weight;

        if(max(throughput.r, max(throughput.g, throughput.b)) < 0.001f) {
            break;
        }

        point = hit.intersect + hit.normal * RAY_EPSILON;
        direction = bounceDirection;
    }

    return accumulated;
}

void main() {
    // Issue #21: aspect ratio handled by the shared FOV camera model
    // (see common.glsl). Sub-pixel jitter (issue #12) is applied in NDC,
    // where one screen pixel spans 2/res in both axes.
    // Issue #29: seed the per-pixel PRNG before the first getRand() call.
    initRng(v_WindowPixels, u_FrameCount);
    float pixelSize = 2.0f / u_Resolution.y;
    vec2 jitter = (vec2(getRand(), getRand()) - 0.5f) * pixelSize;

    // Issue #58: thin-lens depth of field, composed with the issue #12
    // sub-pixel jitter. The pinhole ray toward the (jittered) pixel target
    // defines where the focal plane is pierced; the actual sample then shoots
    // from a random point on the aperture disk through that same focal point.
    // Averaged over accumulated frames this converges to the thin-lens circle-
    // of-confusion blur, and the per-frame jitter keeps it noise-free over time.
    // Issue #52: the camera basis comes from the interactive orbit/pan/zoom
    // state (u_CamForward/u_CamRight/u_CamUp uniforms, see src/camera.ts).
    vec3 rayOrigin = u_Eye;
    vec3 centerRayDirection = generateCameraRay(vec2(0.0f), u_Resolution, u_Eye,
                                                u_CamForward, u_CamRight, u_CamUp);
    vec3 rayDirection = generateCameraRay(v_WindowPixels.xy + jitter, u_Resolution, u_Eye,
                                          u_CamForward, u_CamRight, u_CamUp);

    // Issue #58: thin-lens depth of field, composed with the issue #12 sub-pixel
    // jitter and the issue #21 FOV camera model. The pinhole ray defines where the
    // focal plane is pierced; the actual sample shoots from a random point on the
    // aperture disk through that same focal point. Averaged over accumulated frames
    // this converges to the thin-lens circle-of-confusion blur.
    if(u_ApertureRadius > 0.0f) {
        float focalT = u_FocalDistance / dot(rayDirection, normalize(centerRayDirection));
        vec3 focalPoint = u_Eye + focalT * rayDirection;

        // Uniform disk sample (rejection-free): r = sqrt(u1), phi = 2*PI*u2.
        float u1 = getRand();
        float u2 = getRand();
        vec2 disk = u_ApertureRadius * sqrt(u1)
            * vec2(cos(6.283185307179586f * u2), sin(6.283185307179586f * u2));

        // Build an orthonormal frame around the view direction for the lens.
        vec3 forward = normalize(rayDirection);
        vec3 basis = abs(forward.x) > 0.9f ? vec3(0.0f, 1.0f, 0.0f) : vec3(1.0f, 0.0f, 0.0f);
        vec3 right = normalize(cross(basis, forward));
        vec3 up = cross(forward, right);

        vec3 lensPoint = u_Eye + disk.x * right + disk.y * up;
        rayOrigin = lensPoint;
        rayDirection = normalize(focalPoint - lensPoint);
    }

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
