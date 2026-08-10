#version 300 es
precision highp float;

in vec2 v_WindowPixels;
out vec4 outColor;

uniform sampler2D u_NoiseTexture;

void main() {
    vec2 uv = (v_WindowPixels + 1.0) * 0.5;
    outColor = texture(u_NoiseTexture, uv);
}
