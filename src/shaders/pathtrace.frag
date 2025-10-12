precision mediump float;

/* Received from the vertex */ 
varying vec2 v_WindowPixels;

/* Received from the code */
uniform vec3 u_Eye;

void main() {
    gl_FragColor = vec4(0.2, 0.2, 0.8, 1.0);
}
