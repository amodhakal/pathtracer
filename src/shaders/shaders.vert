#version 300 es

// Received from program
in vec2 a_Position; 

// Send to fragment shaders
out vec2 v_WindowPixels;

void main() {
    v_WindowPixels = a_Position;
    gl_Position = vec4(a_Position, 0.0f, 1.0f);
}
