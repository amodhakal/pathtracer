#version 300 es
precision highp float;

in vec2 v_WindowPixels;
out vec4 outColor;

// Issue #24: renamed from u_NoiseTexture — this pass samples the accumulation result.
uniform sampler2D u_AccumTexture;
// Issue #11: accumulation buffers store a sum of radiance samples; divide by
// the frame count here to recover the average before tone mapping.
uniform float u_FrameCount;
// Issue #33: linear exposure control applied to the averaged radiance BEFORE
// tone mapping, so exposure scales scene brightness rather than fighting the
// tone mapping curve / gamma encode.
uniform float u_Exposure;

// Issue #34: ACES filmic approximation (Narkowicz 2015) — replaces Reinhard.
// Better highlights rolloff and saturation than plain Reinhard; input/output
// are in linear space.
vec3 acesFilmic(vec3 x) {
    const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
    vec2 uv = (v_WindowPixels + 1.0) * 0.5;
    vec3 col = texture(u_AccumTexture, uv).rgb / max(u_FrameCount, 1.0);
    // Issue #33: exposure control first — multiply linear radiance by the
    // exposure factor, then tone map (ACES filmic) and gamma encode.
    col *= u_Exposure;
    col = acesFilmic(col);
    col = pow(col, vec3(1.0 / 2.2));
    outColor = vec4(col, 1.0);
}