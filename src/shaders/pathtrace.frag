#version 300 es

precision highp float;

/* Compile time values */
#define MAX_TERM_COUNT 2
#define MAX_BOUNCES 100
#define MAX_SAMPLE_COUNT 20 // Increased for a cleaner final image
#define ELLIPSOID_COUNT 2
#define ELLIPSOID_VECTORS 3
#define TRIANGLE_COUNT 10
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
in vec2 v_WindowPixels;
out vec4 outColor;

/* Received from the code */
uniform vec3 u_Eye;
uniform Light u_Light;
uniform vec3 u_Ellipsoids[ELLIPSOID_COUNT * ELLIPSOID_VECTORS];
uniform vec3 u_Triangles[TRIANGLE_COUNT * TRIANGLE_VECTORS];
uniform float u_Time;
uniform vec2 u_Resolution;

vec3 tracePath(vec3 startPoint, vec3 startDirection, float sampleId);
vec3 calculateDirectIllumination(vec3 point, vec3 normal, vec3 color);
vec3 getBounceDirection(vec3 normal, float seed);
Intersect calculateRayEllipsoidIntersect(vec3 point, vec3 direction, Ellipsoid ellipsoid);
Intersect calculateRayTriangleIntersect(vec3 point, vec3 direction, Triangle triangle);
Intersect findClosestIntersect(vec3 point, vec3 direction);
QuadResult solveQuad(vec3 quads);
float rand(float seed);

// --- CORRECTED FUNCTION #1 ---
vec3 calculateDirectIllumination(vec3 point, vec3 normal, vec3 color) {
    vec3 pointToLight = u_Light.position - point;
    vec3 lightDirection = normalize(pointToLight);
    float lightDistance = length(pointToLight);

    // Nudge the shadow ray's origin to prevent self-shadowing
    vec3 shadowRayOrigin = point + normal * CLIP_VAL;
    Intersect intersect = findClosestIntersect(shadowRayOrigin, lightDirection);

    if(intersect.isExisting && intersect.distance < lightDistance) {
        // Shadow
        return vec3(0.0f, 0.0f, 0.0f);
    }

    float numerator = max(dot(normal, lightDirection), 0.0f);
    float denominator = 1.0f + lightDistance * lightDistance;
    float weight = numerator / denominator;

    vec3 finalColor = u_Light.color * color * weight;

    return finalColor;
}

vec3 getBounceDirection(vec3 normal, float seed) {
    vec3 direction;
    bool isValidValue = false;

    for(int idx = 0; idx < MAX_BOUNCES; idx++) {
        float s = seed + float(idx) * 0.01f;
        float firstRand = rand(s);
        float secondRand = rand(firstRand);
        float thirdRand = rand(secondRand);
        direction = vec3(2.0f * firstRand - 1.0f, 2.0f * secondRand - 1.0f, 2.0f * thirdRand - 1.0f);

        if(dot(direction, direction) <= 1.0f) {
            isValidValue = true;
            break;
        }
    }

    if(!isValidValue) {
        return normal; // Fallback
    }

    direction = normalize(direction);
    if(dot(direction, normal) < 0.0f) {
        direction = -direction;
    }
    return direction;
}

// --- REFACTORED FUNCTION (from previous step) ---
Intersect calculateRayEllipsoidIntersect(vec3 point, vec3 direction, Ellipsoid ellipsoid) {
    vec3 firstResult = direction / ellipsoid.radius;
    vec3 secondResult = point - ellipsoid.center;
    vec3 thirdResult = secondResult / ellipsoid.radius;

    float quadA = dot(firstResult, firstResult);
    float quadB = 2.0f * dot(firstResult, thirdResult);
    float quadC = dot(thirdResult, thirdResult) - 1.0f;

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
        vec3 normal = intersect - ellipsoid.center;
        normal /= ellipsoid.radius * ellipsoid.radius;
        normal = normalize(normal);

        return Intersect(true, term, intersect, ellipsoid.color, normal);
    }

    return Intersect(false, 0.0f, vec3(0.0f, 0.0f, 0.0f), vec3(0.0f, 0.0f, 0.0f), vec3(0.0f, 0.0f, 0.0f));
}

// --- CORRECTED FUNCTION #2 ---
Intersect calculateRayTriangleIntersect(vec3 point, vec3 direction, Triangle triangle) {
    Intersect noIntersection = Intersect(false, 0.0f, vec3(0.0f, 0.0f, 0.0f), vec3(0.0f, 0.0f, 0.0f), vec3(0.0f, 0.0f, 0.0f));

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

    // THE CORRECTED BARYCENTRIC CHECK
    if(vValue < 0.0f || uValue + vValue > 1.0f) {
        return noIntersection;
    }

    float term = dot(triangleEdge2, crossVector) * inverseDeterminant;
    if(term < CLIP_VAL) {
        return noIntersection;
    }

    vec3 intersect = point + direction * term;
    return Intersect(true, term, intersect, triangle.color, triangle.normal);
}

// --- REFACTORED FUNCTION (from previous step) ---
Intersect findClosestIntersect(vec3 point, vec3 direction) {
    Intersect closestIntersect = Intersect(false, 0.0f, vec3(0.0f, 0.0f, 0.0f), vec3(0.0f, 0.0f, 0.0f), vec3(0.0f, 0.0f, 0.0f));
    float closestDistance = 1e20f;

    for(int idx = 0; idx < TRIANGLE_COUNT; idx++) {
        int baseIdx = idx * TRIANGLE_VECTORS;
        Triangle triangle = Triangle(u_Triangles[baseIdx], u_Triangles[baseIdx + 1], u_Triangles[baseIdx + 2], u_Triangles[baseIdx + 3], u_Triangles[baseIdx + 4]);
        Intersect intersect = calculateRayTriangleIntersect(point, direction, triangle);
        if(intersect.isExisting && intersect.distance < closestDistance) {
            closestDistance = intersect.distance;
            closestIntersect = intersect;
        }
    }

    for(int idx = 0; idx < ELLIPSOID_COUNT; idx++) {
        int baseIdx = idx * ELLIPSOID_VECTORS;
        Ellipsoid ellipsoid = Ellipsoid(u_Ellipsoids[baseIdx], u_Ellipsoids[baseIdx + 1], u_Ellipsoids[baseIdx + 2]);
        Intersect intersect = calculateRayEllipsoidIntersect(point, direction, ellipsoid);
        if(intersect.isExisting && intersect.distance < closestDistance) {
            closestDistance = intersect.distance;
            closestIntersect = intersect;
        }
    }

    return closestIntersect;
}

QuadResult solveQuad(vec3 quads) {
    float discriminant = pow(quads.y, 2.0f) - 4.0f * quads.x * quads.z;

    if(discriminant < 0.0f) {
        return QuadResult(0, vec2(0.0f, 0.0f));
    } else if(discriminant == 0.0f) {
        float term = -quads.y / (2.0f * quads.x);
        return QuadResult(1, vec2(term, 0.0f));
    }

    float denominator = 0.5f / quads.x;
    float term1 = -quads.y;
    float term2 = sqrt(discriminant);
    float positiveTerm = denominator * (term1 + term2);
    float negativeTerm = denominator * (term1 - term2);

    if(positiveTerm < negativeTerm) {
        return QuadResult(2, vec2(positiveTerm, negativeTerm));
    } else {
        return QuadResult(2, vec2(negativeTerm, positiveTerm));
    }
}

float rand(float seed) {
    vec2 p = v_WindowPixels.xy + seed + u_Time;
    return fract(sin(dot(p, vec2(12.9898f, 78.233f))) * 43758.5453f);
    
}

void main() {
    vec2 pos = v_WindowPixels.xy;
    pos.x *= u_Resolution.x / u_Resolution.y;

    vec3 rayOrigin = u_Eye;
    vec2 world_xy = (pos.xy + 1.0f) * 0.5f;
    vec3 targetPoint = vec3(world_xy, 0.0f);
    vec3 rayDirection = normalize(targetPoint - rayOrigin);

    vec3 finalColor = vec3(0.0f);

    for(int i = 0; i < MAX_SAMPLE_COUNT; i++) {
        float sampleId = float(i) * 0.1337f; // Use a more unique seed
        finalColor += tracePath(rayOrigin, rayDirection, sampleId);
    }

    finalColor /= float(MAX_SAMPLE_COUNT);
    finalColor = pow(finalColor, vec3(1.0f / 2.2f));

    outColor = vec4(finalColor, 1.0f);
}

vec3 tracePath(vec3 startPoint, vec3 startDirection, float sampleId) {
  // The starting point of the current ray segment.
    vec3 point = startPoint;
    // The direction of the current ray segment.
    vec3 direction = startDirection;

    // finalColor accumulates the light seen along the path.
    vec3 finalColor = vec3(0.0f);
    // throughput tracks the color attenuation of the path. It starts at white (no attenuation).
    // As the ray bounces off colored surfaces, this value is multiplied by their color.
    vec3 throughput = vec3(1.0f);

    for(int bounce = 0; bounce < MAX_BOUNCES; bounce++) {
        // Find the closest object the ray intersects with.
        Intersect intersect = findClosestIntersect(point, direction);

        // If the ray hits nothing, it has escaped the scene. Stop tracing this path.
        if(!intersect.isExisting) {
            // In a more advanced tracer, you might add a background/sky color here,
            // multiplied by the current throughput.
            break;
        }

        // --- Step 1: Accumulate Direct Illumination ---
        // Calculate the light that comes directly from the light source and hits this
        // intersection point. This contribution is scaled by the `throughput` because
        // the ray had to travel through a path of colored surfaces to get here.
        vec3 directLight = calculateDirectIllumination(intersect.intersect, intersect.normal, intersect.color);
        finalColor += directLight * throughput;

        // --- Step 2: Russian Roulette Path Termination ---
        // To avoid infinite bouncing and to improve performance, we probabilistically
        // terminate the path. After the first bounce, there's a chance the path ends.
        float r = min(rand(float(bounce) + sampleId), 0.0);
        // if(bounce > 0 && r > BOUNCE_SUCCESS_PROBABILITY) {
        //     break;
        // }

        // --- Step 3: Prepare for the Next Bounce (Indirect Illumination) ---
        // Determine the direction for the next bounced ray.
        vec3 bounceDirection = getBounceDirection(intersect.normal, r);

        // The probability of continuing the path. If we survived Russian Roulette,
        // we must divide by the success probability to keep the result unbiased.
        float probability = (bounce > 0) ? BOUNCE_SUCCESS_PROBABILITY : 1.0f;

        // Calculate the Monte Carlo weight for this bounce, which includes the cosine term.
        // This accounts for the energy falloff at grazing angles (Lambert's cosine law).
        float weight = dot(intersect.normal, bounceDirection) / probability;

        // Update the throughput for the *next* segment of the path. Any light gathered
        // from future bounces will now be filtered by the color of the surface we just hit.
        throughput *= intersect.color * weight;

        // If throughput becomes black, no more light can be gathered. Stop.
        if(throughput.x < 0.001f && throughput.y < 0.001f && throughput.z < 0.001f) {
            break;
        }

        // --- Step 4: Move the Ray to its New Position ---
        // The new ray starts at the intersection point, nudged slightly along the
        // normal to prevent immediate self-intersection on the next bounce.
        point = intersect.intersect + intersect.normal * CLIP_VAL;
        direction = bounceDirection;
    }

    return finalColor;
}
