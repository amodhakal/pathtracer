precision mediump float;

/* Received from the vertex */ 
varying vec2 v_WindowPixels; // The coords on the window

struct Light {
    vec3 position;
    vec3 color;
};

struct Triangle {
    float shininess;
    vec3 color;
    vec3 normal;
    vec3 vertex1;
    vec3 vertex2;
    vec3 vertex3;

};

struct IntersectResult {
    bool isValid;
    vec3 location;
};

#define WINDOW_PIXEL_Z 0.0

vec3 raycast(vec3 eye, vec3 rayDirection, Light light, Triangle triangle);
IntersectResult calculateRayTriangleIntersect(Triangle triangle, vec3 eye, vec3 rayDirection);
bool isInsideTriangle(Triangle triangle, vec3 intersectLocation);
vec3 calculateLighting(Light light, Triangle triangle, vec3 intersectLocation, vec3 eye);

void main() {
    /* Constants */
    vec3 eye = vec3(0.0, 0.0, -0.5);
    Light light = Light(vec3(0.0, 0.999999, 0.0), vec3(1.0, 1.0, 1.0));
    Triangle triangle = Triangle(6.0, vec3(0.1, 0.4, 0.9), vec3(0.0, 0.0, -1.0), vec3(2.0, -4.0, 1.0), vec3(-3.0, -1.0, 0.7), vec3(0.0, 4.0, 0.6));

    vec3 windowPixels = vec3(v_WindowPixels, WINDOW_PIXEL_Z); // The full position on the window
    vec3 rayDirection = normalize(windowPixels - eye); // The vector from the eye to the window
    vec3 receivedColor = raycast(eye, rayDirection, light, triangle); // Get color from raycasting

    gl_FragColor = vec4(receivedColor, 1.0);
}

vec3 raycast(vec3 eye, vec3 rayDirection, Light light, Triangle triangle) {
    IntersectResult intersectResult = calculateRayTriangleIntersect(triangle, eye, rayDirection); // Get the intersect location

    if(!intersectResult.isValid) {
        return vec3(0.0, 0.0, 0.0); // Return black for no intersect
    }

    vec3 color = calculateLighting(light, triangle, intersectResult.location, eye); // Get lighting
    return color;
}

IntersectResult calculateRayTriangleIntersect(Triangle triangle, vec3 eye, vec3 rayDirection) {
    IntersectResult noIntersect = IntersectResult(false, vec3(-1.0, -1.0, -1.0));

    float planeOffset = dot(triangle.normal, triangle.vertex1);
    float rayPlaneAngle = dot(triangle.normal, rayDirection);
    if(rayPlaneAngle == 0.0) {
        return noIntersect;
    }

    float eyeNormalAngle = dot(triangle.normal, eye);
    float eyePlaneDistance = planeOffset - eyeNormalAngle;
    float rayIntersectDistance = eyePlaneDistance / rayPlaneAngle;
    if(rayIntersectDistance < (WINDOW_PIXEL_Z - eye.z)) {
        return noIntersect;
    }

    vec3 rayDirectionVector = rayDirection * rayIntersectDistance;
    vec3 intersectLocation = eye + rayDirectionVector;

    bool isValidIntersect = isInsideTriangle(triangle, intersectLocation); // Check the intersect is inside the triangle
    if(!isValidIntersect) {
        return noIntersect;
    }

    return IntersectResult(true, intersectLocation);
}

vec3 calculateLighting(Light light, Triangle triangle, vec3 intersectLocation, vec3 eye) {

    vec3 normalVector = normalize(triangle.normal);
    vec3 intersectToEyeVector = normalize(eye - intersectLocation);
    vec3 intersectToLightVector = normalize(light.position - intersectLocation);

    float lightNormalDot = dot(normalVector, intersectToLightVector);
    if(lightNormalDot < 0.0) {
        lightNormalDot = 0.0;
    }

    vec3 halfwayVector = normalize(intersectToLightVector + intersectToEyeVector);
    float halfwayNormalDot = dot(normalVector, halfwayVector);
    if(halfwayNormalDot < 0.0) {
        halfwayNormalDot = 0.0;
    }

    vec3 ambient = triangle.color * light.color;
    vec3 diffuse = ambient * lightNormalDot;
    vec3 specular = ambient * pow(halfwayNormalDot, triangle.shininess);
    vec3 finalColor = ambient + diffuse + specular;
    return finalColor;
}

float calcualteSignedArea(vec3 normal, vec3 intersectLocation, vec3 vertex1, vec3 vertex2);

bool isInsideTriangle(Triangle triangle, vec3 intersectLocation) {
    float area1 = calcualteSignedArea(triangle.normal, intersectLocation, triangle.vertex1, triangle.vertex2);
    float area2 = calcualteSignedArea(triangle.normal, intersectLocation, triangle.vertex2, triangle.vertex3);
    float area3 = calcualteSignedArea(triangle.normal, intersectLocation, triangle.vertex3, triangle.vertex1);

    // Check they have the same sign
    return (area1 <= 0.0 && area2 <= 0.0 && area3 <= 0.0) || (area1 >= 0.0 && area2 >= 0.0 && area3 >= 0.0);
}

float calcualteSignedArea(vec3 normal, vec3 intersectLocation, vec3 vertex1, vec3 vertex2) {
    vec3 edge1 = intersectLocation - vertex1;
    vec3 edge2 = vertex2 - vertex1;
    vec3 crossEdges = cross(edge1, edge2);
    float area = dot(normal, crossEdges);
    return area;
}
