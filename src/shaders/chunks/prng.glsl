// Issue #29: in-shader PRNG replacing the noise-texture RNG pass.
//
// Previously each frame rendered noiseGen.frag into a full-screen RGBA32F
// texture that pathtrace.frag then sampled for random numbers. That extra
// pass wasted a fullscreen write+read per frame and had correlation bugs
// (every call within a frame reused the same base texel, only offset by a
// golden-ratio coordinate shift).
//
// Instead we seed a per-pixel state from the window pixel coordinates and
// the accumulated frame count, then scramble the state on every call with
// Jarzynski & Olano's PCG3D hash (public domain, "Hash Functions for GPU
// Rendering", JCGT 2020). Each invocation of nextRandom() advances the
// state, so successive calls within one path give independent samples
// without any texture traffic.

uvec3 prngState;

void initRng(vec2 windowPixel, float frame) {
    // Quantize inputs to 32-bit integers before hashing so tiny float
    // differences don't collapse distinct pixels/frames onto the same seed.
    uvec3 p = uvec3(
        uint(max(windowPixel.x, 0.0)),
        uint(max(windowPixel.y, 0.0)),
        uint(max(frame, 0.0))
    );
    prngState = p;
}

float nextRandom() {
    // LCG advance + PCG3D output scramble (Jarzynski & Olano 2020).
    prngState = prngState * 1664525u + 1013904223u;
    uvec3 h = prngState;
    h.x += h.y * h.z;
    h.y += h.z * h.x;
    h.z += h.x * h.y;
    h.x ^= h.x >> 16u;
    h.y ^= h.y >> 16u;
    h.z ^= h.z >> 16u;
    // Map one lane's hashed word to [0, 1).
    return float(h.x) * (1.0 / 4294967296.0);
}
