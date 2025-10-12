precision mediump float;

#define MAX_SAMPLE_COUNT 10 // Needs to be known compile time

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

vec3 tracePath(vec3 rayDirection, int depth);
QuadResult solveQuad(vec3 quads);

void main() {
    vec3 pixelPosition = vec3(u_Eye.x, u_Eye.y, u_Eye.z + 0.5);
    vec3 rayDirection = normalize(pixelPosition - u_Eye);
    vec3 finalColor = vec3(0.0, 0.0, 0.0);
    for(int currentSample = 0; currentSample < MAX_SAMPLE_COUNT; currentSample++) {
        vec3 currentColor = tracePath(rayDirection, 0);
        finalColor += currentColor;
    }

    finalColor /= float(MAX_SAMPLE_COUNT);
    gl_FragColor = vec4(finalColor, 1.0);
}

vec3 tracePath(vec3 rayDirection, int depth) {
    // TODO

    return vec3(0.0, 0.0, 0.0);
}

QuadResult solveQuad(vec3 quads) {
    float discriminant = pow(quads.y, 2.0) - 4.0 * quads.x * quads.z;

    if(discriminant < 0.0) {
        return QuadResult(0, 0.0, 0.0);
    } else if(discriminant == 0.0) {
        float term = -quads.y;
        term /= 2.0 * quads.x;
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
