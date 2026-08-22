#version 300 es
precision highp float;

in vec2 v_WindowPixels;
out vec4 outColor;

// Issue #24: renamed from u_NoiseTexture — this pass samples the accumulation result.
uniform sampler2D u_AccumTexture;

void main() {
    vec2 uv = (v_WindowPixels + 1.0) * 0.5;
    vec3 col = texture(u_AccumTexture, uv).rgb;

    // Issue #34: ACES filmic tone mapping (Narkowicz 2015 fit), applied in
    // linear space before gamma encoding. Handles HDR radiance (>1) with a
    // smooth shoulder, unlike the old Reinhard curve.
    col = col * (2.51 * col + 0.03);
    col = col / (col * (2.43 * col + 0.59) + 0.14);
    // Clamp to [0,1] to guard against tiny numeric overshoot.
    col = clamp(col, 0.0, 1.0);

    // Gamma encode (sRGB approximation).
    col = pow(col, vec3(1.0 / 2.2));

    outColor = vec4(col, 1.0);
}