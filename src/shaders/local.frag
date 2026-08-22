#version 300 es
precision highp float;

#define MAX_TERM_COUNT 2
#define ELLIPSOID_COUNT 5
#define ELLIPSOID_VECTORS 4
#define TRIANGLE_COUNT 14
#define TRIANGLE_VECTORS 5
#define CLIP_VAL 0.00001

#define AMBIENT 0.1
#define SHININESS 32.0
#define SPECULAR 0.3

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
uniform vec2 u_Resolution;

Intersect calculateRayEllipsoidIntersect(vec3 point, vec3 direction, Ellipsoid ellipsoid);
Intersect calculateRayTriangleIntersect(vec3 point, vec3 direction, Triangle triangle);
Intersect findClosestIntersect(vec3 point, vec3 direction);
QuadResult solveQuad(vec3 quads);

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

Intersect findClosestIntersect(vec3 point, vec3 direction) {
    Intersect closestIntersect = Intersect(false, 0.0f, vec3(0.0f), vec3(0.0f), vec3(0.0f), vec3(0.0f));
    float closestDistance = 1e20f;

    for(int i = 0; i < TRIANGLE_COUNT; i++) {
        Triangle triangle;
        triangle.vertex1 = u_Triangles[i * TRIANGLE_VECTORS];
        triangle.vertex2 = u_Triangles[i * TRIANGLE_VECTORS + 1];
        triangle.vertex3 = u_Triangles[i * TRIANGLE_VECTORS + 2];
        triangle.normal = u_Triangles[i * TRIANGLE_VECTORS + 3];
        triangle.color = u_Triangles[i * TRIANGLE_VECTORS + 4];

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

void main() {
    vec3 rayOrigin = u_Eye;
    vec2 ndc = v_WindowPixels.xy;

    // Pinhole camera model with vertical FOV and aspect correction.
    // tanHalfFov = 1.25 reproduces the legacy ray-gen mapping (ndc [-1,1]
    // onto the z=0 plane at x,y in [0,2] from eye z=-0.4): vertical
    // half-extent 0.5 / distance 0.4 = 1.25, i.e. vFOV ~= 102.6 degrees.
    const float FOV_DEGREES = 102.6f;
    float tanHalfFov = tan(radians(FOV_DEGREES) * 0.5f);
    float aspect = u_Resolution.x / u_Resolution.y;

    vec3 forward = vec3(0.0f, 0.0f, -1.0f);
    vec3 right = vec3(1.0f, 0.0f, 0.0f) * tanHalfFov * aspect;
    vec3 up = vec3(0.0f, 1.0f, 0.0f) * tanHalfFov;

    vec3 rayDirection = normalize(
        forward + right * ndc.x + up * ndc.y);

    Intersect hit = findClosestIntersect(rayOrigin, rayDirection);

    vec3 color = vec3(0.0f);

    if(hit.isExisting) {
        vec3 viewDirection = normalize(u_Eye - hit.intersect);
        vec3 lightDirection = normalize(u_Light.position - hit.intersect);
        vec3 halfVector = normalize(lightDirection + viewDirection);

        float lightDistance = length(u_Light.position - hit.intersect);
        float attenuation = 1.0f / (1.0f + lightDistance * lightDistance);

        float diffuse = max(dot(hit.normal, lightDirection), 0.0f);
        float specular = pow(max(dot(hit.normal, halfVector), 0.0f), SHININESS);

        color = hit.color * (AMBIENT + diffuse * attenuation)
            + vec3(SPECULAR) * specular * attenuation;
    }

    outColor = vec4(color, 1.0);
}
