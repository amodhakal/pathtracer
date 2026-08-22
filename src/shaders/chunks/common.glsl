// Shared GLSL chunk: constants and structs used by both pathtrace.frag
// and local.frag. Included via `#include <common>` and resolved at
// load time by resolveIncludes() in src/utils.ts.

#define MAX_TERM_COUNT 2
#define ELLIPSOID_COUNT 3
#define ELLIPSOID_VECTORS 4
#define TRIANGLE_COUNT 14
#define TRIANGLE_VECTORS 5
#define CLIP_VAL 0.00001

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
