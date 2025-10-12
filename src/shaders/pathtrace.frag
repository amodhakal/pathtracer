precision mediump float;

/* Compile time values */
#define MAX_SAMPLE_COUNT 10 
#define MAX_ELLIPSOID_COUNT 10
#define MAX_TRIANGLE_COUNT 12
#define BOUNCE_SUCCESS_PROBABILITY 0.5

struct Light {
    vec3 position;
    vec3 color;
};

struct QuadResult {
    int termCount;
    float term1;
    float term2;
};

/* Received from the vertex */ 
varying vec2 v_WindowPixels;

/* Received from the code */
uniform vec3 u_Eye;
uniform Light u_Light;
uniform vec3 u_Ellipsoids[MAX_ELLIPSOID_COUNT * 3];
uniform float u_Time;

vec3 tracePath(vec3 point, vec3 rayDirection, int depth);
QuadResult solveQuad(vec3 quads);
vec3 calculateIndirectIllumination(vec3 point, vec3 normal, vec3 color, int depth);
vec3 getBounceDirection(vec3 normal, float seed);
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

vec3 tracePath(vec3 point, vec3 rayDirection, int depth) {
    // TODO: Implement path tracing logic
    return vec3(0.0, 0.0, 0.0);
}

QuadResult solveQuad(vec3 quads) {
    float discriminant = pow(quads.y, 2.0) - 4.0 * quads.x * quads.z;

    if(discriminant < 0.0) {
        return QuadResult(0, 0.0, 0.0);
    } else if(discriminant == 0.0) {
        float term = -quads.y / (2.0 * quads.x);
        return QuadResult(1, term, 0.0);
    }

    float denominator = 0.5 / quads.x;
    float term1 = -quads.y;
    float term2 = sqrt(discriminant);
    float positiveTerm = denominator * (term1 + term2);
    float negativeTerm = denominator * (term1 - term2);

    if(positiveTerm > negativeTerm) {
        return QuadResult(2, negativeTerm, positiveTerm);
    } else {
        return QuadResult(2, positiveTerm, negativeTerm);
    }
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

float rand(float seed) {
    vec3 inputs = vec3(v_WindowPixels, u_Time * seed);
    return fract(sin(dot(inputs, vec3(12.9898, 78.233, 45.164))) * 43758.5453123);
}
