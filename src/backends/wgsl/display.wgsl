// WebGPU backend display pass (issue #63) — fullscreen triangle that
// tonemaps the current accumulation texture: divides the stored SUM by the
// frame count, applies linear exposure, ACES filmic tone mapping, and gamma
// encode (mirrors src/shaders/display.frag). Rendered directly to the canvas
// via a render pass (the fragment returns the tonemapped color).

struct DisplayUniforms {
  frameCountExposure: vec4<f32>, // x=frameCount, y=exposure, z/w unused
};

@group(0) @binding(0) var<uniform> D: DisplayUniforms;
@group(0) @binding(1) var accumTex: texture_2d<f32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  1.0)
  );
  var out: VertexOutput;
  let p = pos[vi];
  out.position = vec4<f32>(p, 0.0, 1.0);
  return out;
}

// Narkowicz 2015 ACES filmic approximation.
fn acesFilmic(x: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fs(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
  let coord = vec2<i32>(i32(fragCoord.x), i32(fragCoord.y));
  let raw = textureLoad(accumTex, coord, 0).rgb;
  let frameCount = max(D.frameCountExposure.x, 1.0);
  var col = raw / frameCount;
  col = col * D.frameCountExposure.y;
  col = acesFilmic(col);
  col = pow(col, vec3<f32>(1.0 / 2.2));
  return vec4<f32>(col, 1.0);
}
