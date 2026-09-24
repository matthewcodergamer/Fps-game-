// Chest-mounted police bodycam lens (Axon-style) as ONE cheap WGSL post-process.
//
// Output pixel -> radial barrel (fisheye) remap with zoom compensation so the corners stay filled -> 3 taps (R/G/B
// sampled at slightly different radial scales = lateral chromatic fringe that grows toward the edges) -> small-sensor
// look (exposure pump, soft highlight blow-out + clip, lifted blacks, desaturation, cool shadows) -> animated sensor
// noise (30 Hz, stronger in the shadows, faint chroma) -> optical + mechanical vignette -> damage flash.
// Rolling shutter: when the camera shakes the rows skew/wobble horizontally (CMOS jello) with faint sync jitter.
//
// Exactly 3 texture fetches, all in uniform control flow. No text: the HUD draws the REC / timestamp overlay.
// Uniform updates only per frame (no allocations); the effect compiles at construction so toggling is instant.

import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess.js';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore.js';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage.js';

const SHADER_NAME = 'strikeBodycam';
const TEX_BILINEAR = 2; // Constants.TEXTURE_BILINEAR_SAMPLINGMODE
const TEX_UBYTE = 0; // Constants.TEXTURETYPE_UNSIGNED_BYTE (input is post-tonemap LDR)
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

// lensA: x barrel k1, y edge CA, z vignette, w sensor noise
// lensB: x time (s), y exposure multiplier, z rolling shutter 0..1, w aspect (w/h)
// look:  x damage 0..1, y saturation, z black lift, w highlight knee
// texel: xy 1/size, zw size (px)
const FRAGMENT = /* wgsl */ `
varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;
uniform lensA: vec4f;
uniform lensB: vec4f;
uniform look: vec4f;
uniform texel: vec4f;

fn bcPcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

fn bcHash(x: u32, y: u32, z: u32) -> f32 {
  return f32(bcPcg(x + bcPcg(y + bcPcg(z)))) * (1.0 / 4294967295.0);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let t = uniforms.lensB.x;
  let aspect = uniforms.lensB.w;
  let shake = uniforms.lensB.z;
  let frame = u32(max(t, 0.0) * 30.0);

  // Rolling shutter: rows are read out over time, so a shaking camera skews / wobbles horizontally (+ sync jitter).
  let row = u32(input.vUV.y * 140.0);
  let jitter = bcHash(row, frame, 7u) - 0.5;
  var p = input.vUV * 2.0 - 1.0;
  p.x = p.x + shake * (0.018 * sin(input.vUV.y * 7.0 + t * 23.0) + 0.012 * (input.vUV.y - 0.5) * sin(t * 17.0) + 0.006 * jitter);

  // Barrel / fisheye: r normalised so the frame corners are r2 = 1; zoom-compensated so corners map to corners.
  let q = vec2f(p.x * aspect, p.y);
  let r2 = dot(q, q) / (aspect * aspect + 1.0);
  let k1 = uniforms.lensA.x;
  let k2 = k1 * 0.42;
  let f = (1.0 + k1 * r2 + k2 * r2 * r2) / (1.0 + k1 + k2);
  let pu = p * f;

  // Lateral chromatic aberration: red magnified, blue shrunk, growing with r^2 (clean centre, fringed edges).
  let ca = uniforms.lensA.y * 0.011 * r2;
  let uvR = clamp(pu * (1.0 + ca) * 0.5 + 0.5, vec2f(0.0), vec2f(1.0));
  let uvG = clamp(pu * 0.5 + 0.5, vec2f(0.0), vec2f(1.0));
  let uvB = clamp(pu * (1.0 - ca) * 0.5 + 0.5, vec2f(0.0), vec2f(1.0));
  let cR = textureSample(textureSampler, textureSamplerSampler, uvR);
  let cG = textureSample(textureSampler, textureSamplerSampler, uvG);
  let cB = textureSample(textureSampler, textureSamplerSampler, uvB);
  var col = vec3f(cR.r, cG.g, cB.b);

  // Small-sensor exposure: gain / pump, then only the top of the range blows out toward white (lights, sky, glare)
  // before the hard 8-bit clip; mid-tones stay put.
  col = col * uniforms.lensB.y;
  let lum0 = dot(col, vec3f(0.2126, 0.7152, 0.0722));
  let knee = uniforms.look.w;
  let over = clamp(max(lum0 - knee, 0.0) / max(1.0 - knee, 0.05), 0.0, 2.0);
  col = col + vec3f(over * over * 0.28);
  col = mix(col, vec3f(max(max(col.r, col.g), col.b)), clamp(over * 0.45, 0.0, 0.5));

  // Consumer-sensor grade: desaturate, lift blacks, cool/green-ish shadows, mild S-curve.
  let lum1 = dot(col, vec3f(0.2126, 0.7152, 0.0722));
  col = mix(vec3f(lum1), col, uniforms.look.y);
  col = col + (1.0 - clamp(lum1 * 2.2, 0.0, 1.0)) * vec3f(-0.004, 0.006, 0.012);
  let sc = clamp(col, vec3f(0.0), vec3f(1.0));
  col = mix(sc, sc * sc * (3.0 - 2.0 * sc), 0.35);
  col = uniforms.look.z + col * (1.0 - uniforms.look.z);

  // Sensor noise: 30 Hz, luma-dominant, strongest in the shadows; faint chroma speckle.
  let px = vec2u(fragmentInputs.position.xy);
  let n0 = bcHash(px.x, px.y, frame) - 0.5;
  let n1 = bcHash(px.x + 7919u, px.y, frame) - 0.5;
  let n2 = bcHash(px.x, px.y + 104729u, frame) - 0.5;
  let lum2 = dot(col, vec3f(0.2126, 0.7152, 0.0722));
  let amp = uniforms.lensA.w * (1.35 - lum2);
  col = col + vec3f(n0) * amp + vec3f(n1, 0.0, n2) * amp * 0.35;

  // Optical (cos^4-like) + mechanical (lens barrel) vignette.
  let optical = 1.0 - uniforms.lensA.z * r2 * (0.55 + 0.45 * r2);
  let barrel = 1.0 - smoothstep(0.78, 1.32, r2);
  col = col * clamp(optical, 0.0, 1.0) * mix(1.0, barrel, clamp(uniforms.lensA.z * 1.4, 0.0, 1.0));

  // Hit feedback: red flash from the frame edges + brief desaturation.
  let dmg = uniforms.look.x;
  let dl = dot(col, vec3f(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3f(dl), dmg * 0.55);
  col = mix(col, vec3f(0.62, 0.03, 0.02) * (0.4 + dl), clamp(dmg * (0.18 + 0.9 * r2 * r2), 0.0, 0.85));

  fragmentOutputs.color = vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;

let registered = false;
function registerShader() {
  if (registered) return;
  registered = true;
  // PostProcess(fragmentUrl = SHADER_NAME) resolves ShadersStoreWGSL[SHADER_NAME + 'FragmentShader'] (or 'PixelShader').
  ShaderStore.ShadersStoreWGSL[`${SHADER_NAME}FragmentShader`] = FRAGMENT;
}

export const BODYCAM_DEFAULTS = Object.freeze({
  distortion: 0.32, edgeCA: 0.9, vignette: 0.55, noise: 0.06, exposurePump: 0, rollingShutter: 0, time: 0,
  damage: 0, brightness: 1, saturation: 0.78, blackLift: 0.035, highlightKnee: 0.8,
});

export class BodycamPostProcess {
  /**
   * @param {import('@babylonjs/core/Cameras/camera.js').Camera} camera camera the pass is attached to (by attach())
   * @param {import('@babylonjs/core/Engines/abstractEngine.js').AbstractEngine} [engine]
   */
  constructor(camera, engine) {
    registerShader();
    this.camera = camera;
    this.engine = engine || camera.getScene().getEngine();
    this.enabled = false;
    // Plain numeric state (set() copies into it; onApply reads it) – no per-frame allocations.
    this.params = { ...BODYCAM_DEFAULTS };

    this.postProcess = new PostProcess('strike-bodycam', SHADER_NAME, {
      uniforms: ['lensA', 'lensB', 'look', 'texel'],
      samplers: [],
      size: 1.0,
      camera: null, // attached explicitly so the owner controls chain order
      samplingMode: TEX_BILINEAR,
      engine: this.engine,
      reusable: false,
      textureType: TEX_UBYTE,
      shaderLanguage: ShaderLanguage.WGSL,
    });
    this.postProcess.onApply = effect => this._bind(effect);
  }

  /**
   * Update any subset of { distortion, edgeCA, vignette, noise, exposurePump, rollingShutter, time,
   * damage, brightness, saturation, blackLift, highlightKnee }. Unknown keys are ignored. Allocation-free.
   */
  set(params) {
    if (!params) return this;
    const P = this.params;
    if (params.distortion !== undefined) P.distortion = +params.distortion;
    if (params.edgeCA !== undefined) P.edgeCA = +params.edgeCA;
    if (params.vignette !== undefined) P.vignette = +params.vignette;
    if (params.noise !== undefined) P.noise = +params.noise;
    if (params.exposurePump !== undefined) P.exposurePump = +params.exposurePump;
    if (params.rollingShutter !== undefined) P.rollingShutter = +params.rollingShutter;
    if (params.time !== undefined) P.time = +params.time;
    if (params.damage !== undefined) P.damage = +params.damage;
    if (params.brightness !== undefined) P.brightness = +params.brightness;
    if (params.saturation !== undefined) P.saturation = +params.saturation;
    if (params.blackLift !== undefined) P.blackLift = +params.blackLift;
    if (params.highlightKnee !== undefined) P.highlightKnee = +params.highlightKnee;
    return this;
  }

  _bind(effect) {
    const P = this.params;
    const pp = this.postProcess;
    const w = pp.width > 0 ? pp.width : this.engine.getRenderWidth();
    const h = pp.height > 0 ? pp.height : this.engine.getRenderHeight();
    effect.setFloat4('lensA', Math.max(0, P.distortion), Math.max(0, P.edgeCA), clamp01(P.vignette), Math.max(0, P.noise));
    // Keep time small so f32 precision in the shader stays good over long sessions.
    const time = P.time % 3600;
    effect.setFloat4('lensB', time, Math.max(0, P.brightness * (1 + P.exposurePump)), clamp01(P.rollingShutter), w / Math.max(1, h));
    effect.setFloat4('look', clamp01(P.damage), P.saturation, P.blackLift, Math.min(0.98, Math.max(0.3, P.highlightKnee)));
    effect.setFloat4('texel', 1 / Math.max(1, w), 1 / Math.max(1, h), w, h);
  }

  /** True once the WGSL effect is compiled. */
  isReady() {
    return this.postProcess.isReady();
  }

  /** Appends the pass at the END of the camera's post-process chain (no-op if already attached). */
  attach() {
    const cam = this.camera;
    const list = cam._postProcesses || [];
    if (list.indexOf(this.postProcess) === -1) cam.attachPostProcess(this.postProcess);
    this.enabled = true;
    return this;
  }

  detach() {
    this.camera.detachPostProcess(this.postProcess);
    this.enabled = false;
    return this;
  }

  dispose() {
    this.detach();
    this.postProcess.dispose(this.camera);
  }
}
