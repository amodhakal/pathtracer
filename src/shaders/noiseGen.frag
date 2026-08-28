#version 300 es
precision highp float;

in vec2 v_WindowPixels;
out vec4 outColor;

uniform float u_Seed;
uniform vec2 u_Resolution;

uint hash(uint x) {
    x = ((x >> 16u) ^ x) * uint(0x45d9f3b);
    x = ((x >> 16u) ^ x) * uint(0x45d9f3b);
    x = (x >> 16u) ^ x;
    return x;
}

void main() {
    uvec2 pixel = uvec2(gl_FragCoord.xy);
    uint seedInt = uint(u_Seed);
    
    uint h = hash(pixel.x + hash(pixel.y + seedInt));
    float n = float(h) / 4294967295.0;
    
    outColor = vec4(vec3(n), 1.0);
}
