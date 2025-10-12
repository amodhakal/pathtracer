precision mediump float;

/* Compile time values */
#define MAX_TERM_COUNT 2
#define MAX_TERM_COUNT 2
#define MAX_BOUNCES 100
#define MAX_SAMPLE_COUNT 10 
#define ELLIPSOID_COUNT 10
#define ELLIPSOID_VECTORS 3
#define TRIANGLE_COUNT 12
#define TRIANGLE_VECTORS 5
#define BOUNCE_SUCCESS_PROBABILITY 0.5
#define CLIP_VAL 0.001

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

/* Received from the vertex */ 
varying vec2 v_WindowPixels;

/* Received from the code */
uniform vec3 u_Eye;
uniform Light u_Light;
uniform vec3 u_Ellipsoids[ELLIPSOID_COUNT * ELLIPSOID_VECTORS];
uniform vec3 u_Triangles[TRIANGLE_COUNT * TRIANGLE_VECTORS];
uniform float u_Time;

vec3 tracePath(vec3 point, vec3 direction, int depth);
vec3 calculateDirectIllumination(vec3 point, vec3 normal, vec3 color);
vec3 calculateIndirectIllumination(vec3 point, vec3 normal, vec3 color, int depth);
vec3 getBounceDirection(vec3 normal, float seed);
Intersect calculateRayEllipsoidIntersect(vec3 point, vec3 direction, Ellipsoid ellipsoid);
Intersect calculateRayTriangleIntersect(vec3 point, vec3 direction, Triangle triangle);
Intersect findClosestIntersect(vec3 point, vec3 direction);
QuadResult solveQuad(vec3 quads);
float rand(float seed);

void main() {
    vec3 pixelPosition = vec3(u_Eye.x, u_Eye.y, u_Eye.z + 0.5);
    vec3 rayDirection = normalize(pixelPosition - u_Eye);
    vec3 finalColor = vec3(0.0, 0.0, 0.0);
    for(int currentSample = 0; currentSample < MAX_SAMPLE_COUNT; currentSample++) {
        vec3 currentColor = tracePath(u_Eye, rayDirection, 0);
        finalColor += currentColor;
    }

    finalColor /= float(MAX_SAMPLE_COUNT);
    gl_FragColor = vec4(finalColor, 1.0);
}

vec3 tracePath(vec3 point, vec3 direction, int depth) {
    Intersect intersect = findClosestIntersect(point, direction);
    if(!intersect.isExisting) {
        return vec3(0.0, 0.0, 0.0); // Return black
    }

    vec3 directLight = calculateDirectIllumination(intersect.intersect, intersect.normal, intersect.color);
    vec3 indirectLight = calculateIndirectIllumination(intersect.intersect, intersect.normal, intersect.color, depth + 1);

    float red = min(255.0, directLight[0] + indirectLight[0]);
    float blue = min(255.0, directLight[1] + indirectLight[1]);
    float green = min(255.0, directLight[2] + indirectLight[2]);
    
    vec3 finalColor = vec3(red, blue, green);
    return finalColor;
}

vec3 calculateDirectIllumination(vec3 point, vec3 normal, vec3 color) {
    vec3 pointToLight = u_Light.position - point;
    vec3 lightDirection = normalize(pointToLight);
    float lightDistance = length(pointToLight);

    Intersect intersect = findClosestIntersect(point, lightDirection);
    if(intersect.isExisting && intersect.distance < lightDistance) {
        // Shadow
        return vec3(0.0, 0.0, 0.0);
    }

    float numerator = max(dot(normal, lightDirection), 0.0);
    float denominator = 1.0 + lightDistance * lightDistance;
    float weight = numerator / denominator;

    float red = min(255.0, 255.0 * u_Light.color[0] * color[0] * weight);
    float blue = min(255.0, 255.0 * u_Light.color[1] * color[1] * weight);
    float green = min(255.0, 255.0 * u_Light.color[2] * color[2] * weight);
    vec3 finalColor = vec3(red, blue, green);

    return finalColor;
}

vec3 calculateIndirectIllumination(vec3 point, vec3 normal, vec3 color, int depth) {
    float rand = rand(float(depth));
    if(depth > 0 && rand > BOUNCE_SUCCESS_PROBABILITY) {
        return vec3(0.0, 0.0, 0.0);
    }

    vec3 bounceDirection = getBounceDirection(normal, rand);
    vec3 indirectColor = tracePath(point, bounceDirection, depth + 1);

    float weight = max(dot(normal, bounceDirection) / BOUNCE_SUCCESS_PROBABILITY, 0.0);
    vec3 finalColor = indirectColor * color * weight;
    return finalColor;
}

vec3 getBounceDirection(vec3 normal, float seed) {
    vec3 direction;
    bool isValidValue = false;
    bool isSquareLengthLessThanUnit;
    bool isValidVectorDirection;

    for(int idx = 0; idx < MAX_BOUNCES; idx++) {
        float firstRand = rand(seed);
        float secondRand = rand(firstRand);
        float thirdRand = rand(secondRand);
        direction = vec3(firstRand, secondRand, thirdRand);

        isSquareLengthLessThanUnit = pow(length(direction), 2.0) <= 1.0;
        isValidVectorDirection = dot(vec3(0.0, 0.0, 0.1), direction) >= 0.0;

        if(isSquareLengthLessThanUnit && isValidVectorDirection) {
            isValidValue = true;
        }
    }

    if(!isValidValue) {
        return vec3(0.0, 0.0, 0.0);
    }

    direction = normalize(direction);
    vec3 up = abs(normal[0]) > 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 tangent = (cross(up, normal));
    vec3 binormial = cross(normal, tangent);

    vec3 result = tangent * direction[0];
    result += binormial * direction[1];
    result += normal * direction[2];

    return result;
}

Intersect calculateRayEllipsoidIntersect(vec3 point, vec3 direction, Ellipsoid ellipsoid) {
    vec3 firstResult = direction / ellipsoid.radius;
    vec3 secondResult = direction - ellipsoid.center;
    vec3 thirdResult = secondResult / ellipsoid.radius;

    float quadA = dot(firstResult, firstResult);
    float quadB = 2.0 * dot(firstResult, thirdResult);
    float quadC = dot(thirdResult, thirdResult) - 1.0;

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
        return Intersect(true, term, ellipsoid.color, intersect, vec3(0.0, 0.0, 0.0));
    }

    return Intersect(false, 0.0, vec3(0.0, 0.0, 0.0), vec3(0.0, 0.0, 0.0), vec3(0.0, 0.0, 0.0));
}

Intersect calculateRayTriangleIntersect(vec3 point, vec3 direction, Triangle triangle) {
    Intersect noIntersection = Intersect(false, 0.0, vec3(0.0, 0.0, 0.0), vec3(0.0, 0.0, 0.0), vec3(0.0, 0.0, 0.0));

    vec3 triangleEdge1 = triangle.vertex2 - triangle.vertex1;
    vec3 triangleEdge2 = triangle.vertex3 - triangle.vertex1;

    vec3 orthogonal = cross(direction, triangleEdge1);
    float determinant = dot(triangleEdge1, orthogonal);
    if(abs(determinant) < CLIP_VAL) {
        return noIntersection;
    }

    float inverseDeterminant = 1.0 / determinant;
    vec3 pointToVertex = point - triangle.vertex1;
    float uValue = dot(pointToVertex, orthogonal) * inverseDeterminant;
    if(uValue < 0.0 || uValue > 1.0) {
        return noIntersection;
    }

    vec3 crossVector = cross(pointToVertex, triangleEdge1);
    float vValue = dot(direction, crossVector) * inverseDeterminant;
    if(vValue < 0.0 || vValue > 1.0) {
        return noIntersection;
    }

    float term = dot(triangleEdge2, crossVector) * inverseDeterminant;
    if(term < CLIP_VAL) {
        return noIntersection;
    }

    vec3 intersect = point + direction * term;
    return Intersect(true, term, triangle.color, intersect, vec3(0.0, 0.0, 0.0));
}

Intersect findClosestIntersect(vec3 point, vec3 direction) {
    Intersect closestIntersect = Intersect(false, 0.0, vec3(0.0, 0.0, 0.0), vec3(0.0, 0.0, 0.0), vec3(0.0, 0.0, 0.0));
    float closestDistance = 1e20;

    for(int idx = 0; idx < TRIANGLE_COUNT; idx++) {
        int baseIdx = idx * TRIANGLE_VECTORS;
        vec3 vertex1 = u_Triangles[baseIdx];
        vec3 vertex2 = u_Triangles[baseIdx + 1];
        vec3 vertex3 = u_Triangles[baseIdx + 2];
        vec3 normal = u_Triangles[baseIdx + 3];
        vec3 color = u_Triangles[baseIdx + 4];

        Triangle triangle = Triangle(vertex1, vertex2, vertex3, normal, color);
        Intersect intersect = calculateRayTriangleIntersect(point, direction, triangle);
        if(!intersect.isExisting || intersect.distance > closestDistance) {
            continue;
        }

        closestDistance = intersect.distance;
        closestIntersect = intersect;
        closestIntersect.normal = normal;
    }

    for(int idx = 0; idx < ELLIPSOID_COUNT; idx++) {
        int baseIdx = idx * ELLIPSOID_VECTORS;
        vec3 center = u_Ellipsoids[baseIdx];
        vec3 radius = u_Ellipsoids[baseIdx + 1];
        vec3 color = u_Ellipsoids[baseIdx + 2];

        Ellipsoid ellipsoid = Ellipsoid(center, radius, color);
        Intersect intersect = calculateRayEllipsoidIntersect(point, direction, ellipsoid);
        if(!intersect.isExisting || intersect.distance > closestDistance) {
            continue;
        }

        vec3 normal = point - center;
        normal /= radius * radius;
        normal = normalize(normal);

        closestDistance = intersect.distance;
        closestIntersect = intersect;
        closestIntersect.normal = normal;
    }

    return closestIntersect;
}

QuadResult solveQuad(vec3 quads) {
    float discriminant = pow(quads.y, 2.0) - 4.0 * quads.x * quads.z;

    if(discriminant < 0.0) {
        return QuadResult(0, vec2(0.0, 0.0));
    } else if(discriminant == 0.0) {
        float term = -quads.y / (2.0 * quads.x);
        return QuadResult(1, vec2(term, 0.0));
    }

    float denominator = 0.5 / quads.x;
    float term1 = -quads.y;
    float term2 = sqrt(discriminant);
    float positiveTerm = denominator * (term1 + term2);
    float negativeTerm = denominator * (term1 - term2);

    if(positiveTerm > negativeTerm) {
        return QuadResult(2, vec2(negativeTerm, positiveTerm));
    } else {
        return QuadResult(2, vec2(positiveTerm, negativeTerm));
    }
}

float rand(float seed) {
    vec3 inputs = vec3(v_WindowPixels, u_Time * seed);
    return fract(sin(dot(inputs, vec3(12.9898, 78.233, 45.164))) * 43758.5453123);
}
