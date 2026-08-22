// Shared GLSL chunk: constants and structs used by both pathtrace.frag
// and local.frag. Included via `#include <common>` and resolved at
// load time by resolveIncludes() in src/utils.ts.

#define MAX_TERM_COUNT 2
#define ELLIPSOID_COUNT 7
#define ELLIPSOID_VECTORS 4
#define TRIANGLE_COUNT 14
// Issue #57: 3 vertices + normal + color + 2 packed UV slots + texture id.
#define TRIANGLE_VECTORS 8
#define CLIP_VAL 0.00001

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
    // Issue #57: per-vertex texture coordinates.
    vec2 uv1;
    vec2 uv2;
    vec2 uv3;
    // Issue #57: packed texture ids (x = albedo, y = normal; -1 = none).
    vec2 textures;
};

struct Intersect {
    bool isExisting;
    float distance;
    vec3 intersect;
    vec3 color;
    vec3 normal;
    vec3 material;
    // Issue #57: interpolated texture coordinates and packed texture ids at
    // the hit point (x = albedo id, y = normal id; -1 = no texture).
    vec2 uv;
    vec2 textures;
};
