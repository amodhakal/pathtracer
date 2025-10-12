precision mediump float;

/* Compile time values */
#define MAX_SAMPLE_COUNT 10 
#define MAX_ELLIPSOID_COUNT 10
#define MAX_TRIANGLE_COUNT 12
#define BOUNCE_SUCCESS_PROBABILITY 0.5
#define CLIP_VAL 0.001
#define MAX_TERM_COUNT 2

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
    vec3 color;
    vec3 intersect;
    float distance;
};

/* Received from the vertex */ 
varying vec2 v_WindowPixels;

/* Received from the code */
uniform vec3 u_Eye;
uniform Light u_Light;
uniform vec3 u_Ellipsoids[MAX_ELLIPSOID_COUNT * 3];
uniform float u_Time;

vec3 tracePath(vec3 point, vec3 direction, int depth);
vec3 calculateDirectIllumination(vec3 point, vec3 normal, vec3 color);
vec3 calculateIndirectIllumination(vec3 point, vec3 normal, vec3 color, int depth);
vec3 getBounceDirection(vec3 normal, float seed);
Intersect calculateRayEllipsoidIntersect(vec3 point, vec3 direction, Ellipsoid ellipsoid);
Intersect calculateRayTriangleIntersect(vec3 point, vec3 direction, Triangle triangle);
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
    // TODO: Implement path tracing logic
    return vec3(0.0, 0.0, 0.0);
}

vec3 calculateDirectIllumination(vec3 point, vec3 normal, vec3 color) {
    // TODO Implement
    return vec3(0.0, 0.0, 0.0);
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
    bool isSquareLengthLessThanUnit;
    bool isValidVectorDirection;

    do {
        float firstRand = rand(seed);
        float secondRand = rand(firstRand);
        float thirdRand = rand(secondRand);
        direction = vec3(firstRand, secondRand, thirdRand);

        isSquareLengthLessThanUnit = pow(length(direction), 2.0) <= 1.0;
        isValidVectorDirection = dot(vec3(0.0, 0.0, 0.1), direction) >= 0.0;
    } while(!isSquareLengthLessThanUnit || !isValidVectorDirection);

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

    for(int idx = 0; idx < result.termCount; idx++) {
        float term = result.terms[idx];
        if(term < CLIP_VAL) {
            continue;
        }

        vec3 intersect = point + direction * term;
        return Intersect(true, ellipsoid.color, intersect, term);
    }

    return Intersect(false, vec3(0.0, 0.0, 0.0), vec3(0.0, 0.0, 0.0), 0.0);
}

Intersect calculateRayTriangleIntersect(vec3 point, vec3 direction, Triangle triangle) {
    Intersect noIntersection = Intersect(false, vec3(0.0, 0.0, 0.0), vec3(0.0, 0.0, 0.0), 0.0);

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
    return Intersect(true, triangle.color, intersect, term);
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
