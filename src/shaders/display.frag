#version 300 es
precision highp float;

in vec2 v_WindowPixels;
out vec4 outColor;

// Issue #24: renamed from u_NoiseTexture — this pass samples the accumulation result.
uniform sampler2D u_AccumTexture;

void main() {
    vec2 uv = (v_WindowPixels + 1.0) * 0.5;
    vec3 col = texture(u_AccumTexture, uv).rgb;
    col = col / (col + vec3(1.0));
    col = pow(col, vec3(1.0 / 2.2));
    outColor = vec4(col, 1.0);
}