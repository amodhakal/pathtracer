// Received from program
attribute vec2 a_Position; // The position of the vertex

// Send to fragment shaders
varying vec2 v_WindowPixels;

void main() {
    v_WindowPixels = a_Position;
    gl_Position = vec4(a_Position, 0.0, 1.0);
}
