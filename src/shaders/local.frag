#version 300 es
precision highp float;

#include <common>

#define AMBIENT 0.1
#define SHININESS 32.0
#define SPECULAR 0.3

in vec2 v_WindowPixels;
out vec4 outColor;

uniform vec3 u_Eye;
uniform Light u_Light;
uniform vec3 u_Ellipsoids[ELLIPSOID_COUNT * ELLIPSOID_VECTORS];
uniform vec3 u_Triangles[TRIANGLE_COUNT * TRIANGLE_VECTORS];
uniform vec2 u_Resolution;

#include <intersection>

void main() {
    // Issue #21: aspect ratio handled by the shared FOV camera model.
    vec3 rayOrigin = u_Eye;
    vec3 rayDirection = generateCameraRay(v_WindowPixels.xy, u_Resolution, u_Eye);

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
