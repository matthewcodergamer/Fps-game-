// Analytic HDR sky (WGSL ShaderMaterial) + the small sun disc mesh used as the god-ray source.
//
// Everything is procedural: zenith→horizon gradient with a Rayleigh-ish falloff, broad + tight Mie lobes around the sun,
// an HDR limb-darkened sun/moon disc (≫1 so HDR bloom catches it), 3-octave fbm clouds drifting with time, twinkling
// stars and a city light-pollution band at the horizon. The horizon melts into the scene fog colour so EXP2-fogged
// geometry blends seamlessly into the sky (aerial perspective).
//
// Conventions: all colours given to setParams() are LINEAR Color3 (LightingDirector converts from sRGB hex once per
// preset); `sunDirection` points FROM the sky TOWARD the sun (i.e. -light.direction).
//
// Cost: 12-triangle inverted box, one draw call, ~12 hashes per pixel (fbm) + 1 (stars). The vertex shader pins depth
// to the far plane, so the box size never clips (main camera or reflection-probe faces) and early-z rejects every
// pixel covered by geometry (the sky material is created after the world materials, so it sorts last in its group).

import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore.js';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const SHADER = 'strikeSky';

const SKY_VERTEX = /* wgsl */ `
#include<sceneUboDeclaration>
attribute position: vec3f;
uniform world: mat4x4f;
varying vDir: vec3f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let wp = uniforms.world * vec4f(vertexInputs.position, 1.0);
  var p = scene.viewProjection * wp;
#ifdef REVERSE_DEPTH
  p.z = p.w * 0.000001;
#else
  p.z = p.w * 0.999999;
#endif
  vertexOutputs.position = p;
  // View direction from the current eye: the camera in the main pass, the probe centre in reflection-probe faces
  // (scene.vEyePosition follows ReflectionProbe's forced view position), so env captures are not distorted.
  vertexOutputs.vDir = wp.xyz - scene.vEyePosition.xyz;
}
`;

const SKY_FRAGMENT = /* wgsl */ `
varying vDir: vec3f;
uniform sunDir: vec4f;
uniform sunColor: vec4f;
uniform zenithColor: vec4f;
uniform horizonColor: vec4f;
uniform groundColor: vec4f;
uniform cloudColor: vec4f;
uniform cityGlow: vec4f;
uniform hazeColor: vec4f;
uniform skyParams: vec4f;
uniform skyParams2: vec4f;

fn skyHash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn skyHash13(q: vec3f) -> f32 {
  var p3 = fract(q * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

fn skyNoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = skyHash12(i);
  let b = skyHash12(i + vec2f(1.0, 0.0));
  let c = skyHash12(i + vec2f(0.0, 1.0));
  let d = skyHash12(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn skyFbm(p0: vec2f) -> f32 {
  var p = p0;
  var s = 0.0;
  var a = 0.5;
  for (var i = 0; i < 3; i++) {
    s += a * skyNoise(p);
    p = mat2x2f(1.6, 1.2, -1.2, 1.6) * p + vec2f(3.1, 1.7);
    a *= 0.5;
  }
  return s * 1.1428571;
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let d = normalize(input.vDir);
  let h = d.y;
  let hp = max(h, 0.0);
  let sd = uniforms.sunDir.xyz;
  let mu = dot(d, sd);
  let skyI = uniforms.skyParams2.y;
  let mieK = uniforms.horizonColor.w;
  let time = uniforms.skyParams.y;

  // 1. Rayleigh-ish gradient; the horizon band warms / brightens on the sun side (broad forward-scatter lobe).
  let tH = pow(1.0 - hp, uniforms.zenithColor.w);
  var col = mix(uniforms.zenithColor.rgb, uniforms.horizonColor.rgb, tH) * skyI;
  let broad = pow(0.5 + 0.5 * mu, 3.0);
  col += uniforms.sunColor.rgb * (mieK * 0.06 * tH * broad);

  // 2. City light pollution (sodium / neon smog) hugging the horizon.
  col += uniforms.cityGlow.rgb * exp(-hp * uniforms.cityGlow.w);

  // 3. fbm clouds on a virtual plane, drifting; darker cores, silver lining toward the sun, city-lit bellies.
  var dens = 0.0;
  let cover = uniforms.cloudColor.w;
  if (cover > 0.001) {
    let drift = time * uniforms.skyParams.w;
    let cuv = d.xz / (hp + 0.09) * uniforms.skyParams.z + vec2f(drift, drift * 0.37);
    let n = skyFbm(cuv);
    let lo = mix(0.72, 0.16, cover);
    dens = smoothstep(lo, lo + 0.17, n) * smoothstep(0.0, 0.2, h);
    let core = 1.0 - 0.42 * smoothstep(0.45, 1.0, n);
    var cc = uniforms.cloudColor.rgb * (core * skyI);
    cc += uniforms.sunColor.rgb * (pow(max(mu, 0.0), 10.0) * 0.08 * mieK);
    cc += uniforms.cityGlow.rgb * (1.4 * (1.0 - hp));
    col = mix(col, cc, dens);
  }

  // 4. Stars (night only), hidden by clouds and washed out by light pollution near the horizon.
  let stars = uniforms.skyParams.x;
  if (stars > 0.001) {
    let sp = d * 170.0;
    let cell = floor(sp);
    let rnd = skyHash13(cell);
    let r = length(fract(sp) - vec3f(0.5));
    let on = step(0.9925, rnd);
    let mag = fract(rnd * 173.13);
    let tw = 0.65 + 0.35 * sin(time * (2.0 + rnd * 7.0) + rnd * 91.0);
    let s = (1.0 - smoothstep(0.0, 0.34, r)) * on * tw * (0.5 + 3.0 * mag * mag);
    col += vec3f(0.78 + 0.22 * mag, 0.86, 1.0) * (s * stars * (1.0 - dens) * smoothstep(0.08, 0.4, h));
  }

  // 5. Aerial perspective: blend toward the scene fog colour at the horizon so fogged geometry melts into the sky.
  let hz = clamp(uniforms.hazeColor.w * exp(-hp * 6.5), 0.0, 1.0);
  col = mix(col, uniforms.hazeColor.rgb, hz);

  // 6. Below the horizon (probe faces / gaps between buildings): ground bounce fading into haze.
  let below = 1.0 - smoothstep(-0.12, 0.0, h);
  col = mix(col, mix(uniforms.groundColor.rgb * skyI, uniforms.hazeColor.rgb, uniforms.hazeColor.w * 0.6), below);

  // 7. Tight Mie glow (Schlick-approximated Henyey-Greenstein) + HDR sun / moon disc burning through the haze.
  let g = uniforms.groundColor.w;
  let k = 1.55 * g - 0.55 * g * g * g;
  let den = 1.0 - k * mu;
  let phase = (1.0 - k * k) / (12.5663706 * den * den);
  let vis = smoothstep(-0.3, 0.0, h);
  col += uniforms.sunColor.rgb * (phase * mieK * (0.4 + 0.6 * tH) * vis * (1.0 - 0.55 * dens));
  let cosR = uniforms.sunColor.w;
  let edge = max(1.0 - cosR, 0.000001);
  let disc = smoothstep(cosR - edge * 0.25, cosR + edge * 0.35, mu);
  let rr = clamp((1.0 - mu) / edge, 0.0, 1.0);
  let limb = 1.0 - 0.45 * rr * rr;
  col += uniforms.sunColor.rgb * (disc * limb * uniforms.sunDir.w * (1.0 - dens * 0.9) * smoothstep(-0.012, 0.01, h));

  // Clamp (lower inside the reflection probe so the sun cannot turn into mip-chain fireflies) + dither vs banding.
  col = min(col, vec3f(uniforms.skyParams2.x));
  let dn = skyHash12(fragmentInputs.position.xy + vec2f(fract(time * 7.13) * 61.0, 0.0)) - 0.5;
  col += vec3f(dn * uniforms.skyParams2.z);
  fragmentOutputs.color = vec4f(max(col, vec3f(0.0)), 1.0);
}
`;

function registerShaders() {
  const store = ShaderStore.ShadersStoreWGSL;
  if (!store[`${SHADER}VertexShader`]) store[`${SHADER}VertexShader`] = SKY_VERTEX;
  if (!store[`${SHADER}PixelShader`]) store[`${SHADER}PixelShader`] = SKY_FRAGMENT;
}

const UNIFORMS = ['world', 'sunDir', 'sunColor', 'zenithColor', 'horizonColor', 'groundColor', 'cloudColor', 'cityGlow',
  'hazeColor', 'skyParams', 'skyParams2'];

const DEG = Math.PI / 180;

/** Defaults = neutral clear day; LightingDirector overrides everything per preset. */
const DEFAULTS = {
  sunDirection: new Vector3(0.3, 0.6, -0.74),
  sunColor: new Color3(1, 0.95, 0.88),
  sunIntensity: 4,
  sunSize: 0.75,          // disc angular radius (degrees); the real sun is 0.27° — larger reads better at 900 px
  discIntensity: 18,      // disc radiance = sunColor * sunIntensity * discIntensity
  mie: 1,                 // Mie glow strength
  mieG: 0.78,             // Mie anisotropy
  zenith: new Color3(0.08, 0.22, 0.6),
  horizon: new Color3(0.45, 0.6, 0.8),
  ground: new Color3(0.1, 0.09, 0.08),
  horizonExponent: 4,
  skyIntensity: 1,
  cloudCover: 0.3,
  cloudColor: new Color3(0.9, 0.9, 0.92),
  cloudScale: 3.5,
  cloudSpeed: 0.02,
  stars: 0,
  cityGlow: new Color3(0, 0, 0),
  cityGlowFalloff: 8,
  haze: 0.6,
  fogColor: null,         // linear; defaults to horizon colour
  maxRadiance: 4000,
  probeMaxRadiance: 24,
  dither: 0.0015,
};

export class ProceduralSky {
  /**
   * @param {import('@babylonjs/core/scene.js').Scene} scene
   * @param {object} profile DeviceProfile (only `post.godRays` is read, to decide whether the sun disc mesh exists)
   */
  constructor(scene, profile) {
    registerShaders();
    this.scene = scene;
    this.profile = profile;
    const engine = scene.getEngine();
    const maxZ = scene.activeCamera?.maxZ || 220;
    this.radius = maxZ * 0.9;
    this.time = 0;

    this.mesh = CreateBox('strike-sky', { size: this.radius * 2, sideOrientation: Mesh.BACKSIDE }, scene);
    this.mesh.infiniteDistance = true;
    this.mesh.isPickable = false;
    this.mesh.applyFog = false;
    this.mesh.receiveShadows = false;
    this.mesh.renderingGroupId = 0;
    this.mesh.alwaysSelectAsActiveMesh = true; // camera is always inside; skip bounding tests
    this.mesh.doNotSyncBoundingInfo = true;
    this.mesh.metadata = { sky: true, noProbe: false };

    const defines = engine.useReverseDepthBuffer ? ['REVERSE_DEPTH'] : [];
    const mat = new ShaderMaterial('strike-sky-mat', scene, { vertex: SHADER, fragment: SHADER }, {
      attributes: ['position'],
      uniforms: UNIFORMS.slice(),
      uniformBuffers: ['Scene'],
      samplers: [],
      defines,
      shaderLanguage: ShaderLanguage.WGSL,
    });
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    this.material = mat;
    this.mesh.material = mat;

    // Uniform storage (ShaderMaterial keeps the references, so in-place mutation is picked up at the next bind).
    this._u = {
      sunDir: new Color4(0, 1, 0, 18),
      sunColor: new Color4(1, 1, 1, Math.cos(0.75 * DEG)),
      zenithColor: new Color4(0, 0, 0, 4),
      horizonColor: new Color4(0, 0, 0, 1),
      groundColor: new Color4(0, 0, 0, 0.78),
      cloudColor: new Color4(1, 1, 1, 0),
      cityGlow: new Color4(0, 0, 0, 8),
      hazeColor: new Color4(0, 0, 0, 0.5),
      skyParams: new Color4(0, 0, 1, 0.005),
      skyParams2: new Color4(4000, 1, 0.0015, 0),
    };
    for (const key in this._u) mat.setColor4(key, this._u[key]);

    this.params = {};
    this.sunDirection = new Vector3(0, 1, 0);
    this.sunMesh = null;
    this._sunMat = null;
    this._sunRadiance = new Color3(1, 1, 1);
    this._maxRadiance = DEFAULTS.maxRadiance;
    this._probeMaxRadiance = DEFAULTS.probeMaxRadiance;
    if (profile?.post?.godRays) this._createSunMesh();
    this.setParams(DEFAULTS);
  }

  /** Small emissive billboard disc far along the sun direction (god-ray source). Excluded from shadows / probe. */
  _createSunMesh() {
    const scene = this.scene;
    const m = CreateDisc('strike-sun-disc', { radius: 1, tessellation: 24 }, scene);
    m.billboardMode = Mesh.BILLBOARDMODE_ALL;
    m.infiniteDistance = true;
    m.isPickable = false;
    m.applyFog = false;
    m.receiveShadows = false;
    m.renderingGroupId = 0;
    m.doNotSyncBoundingInfo = false;
    m.metadata = { sunDisc: true, noProbe: true };
    const mat = new StandardMaterial('strike-sun-disc-mat', scene);
    mat.disableLighting = true;
    mat.diffuseColor.set(0, 0, 0);
    mat.specularColor.set(0, 0, 0);
    mat.emissiveColor.set(1, 1, 1);
    mat.fogEnabled = false;
    mat.backFaceCulling = false;
    m.material = mat;
    this.sunMesh = m;
    this._sunMat = mat;
  }

  /**
   * @param {object} p partial params: { sunDirection:Vector3 (toward sun), sunColor:Color3, sunIntensity, zenith:Color3,
   *   horizon:Color3, ground:Color3, cloudCover 0..1, cloudColor:Color3, stars 0..1, cityGlow:Color3, haze 0..1,
   *   fogColor:Color3 (linear), sunSize (deg), discIntensity, mie, mieG, horizonExponent, skyIntensity, cloudScale,
   *   cloudSpeed, cityGlowFalloff, maxRadiance, probeMaxRadiance }
   */
  setParams(p = {}) {
    const P = this.params;
    for (const key in p) {
      const v = p[key];
      if (v === undefined || v === null) continue;
      P[key] = v && typeof v.clone === 'function' ? v.clone() : v;
    }
    const u = this._u;
    const sd = this.sunDirection.copyFrom(P.sunDirection || DEFAULTS.sunDirection);
    if (sd.lengthSquared() < 1e-8) sd.set(0, 1, 0);
    sd.normalize();
    const sunI = P.sunIntensity ?? DEFAULTS.sunIntensity;
    const sc = P.sunColor || DEFAULTS.sunColor;
    u.sunDir.set(sd.x, sd.y, sd.z, P.discIntensity ?? DEFAULTS.discIntensity);
    // Sun radiance in the same units as Babylon's PBR lights (diffuse = albedo * I / pi): scattering and the disc scale with
    // the light intensity so the sky, the probe and the lit world stay in balance.
    const rad = sunI / Math.PI;
    u.sunColor.set(sc.r * rad, sc.g * rad, sc.b * rad, Math.cos((P.sunSize ?? DEFAULTS.sunSize) * DEG));
    setRGB(u.zenithColor, P.zenith || DEFAULTS.zenith, P.horizonExponent ?? DEFAULTS.horizonExponent);
    setRGB(u.horizonColor, P.horizon || DEFAULTS.horizon, P.mie ?? DEFAULTS.mie);
    setRGB(u.groundColor, P.ground || DEFAULTS.ground, Math.min(0.95, Math.max(0, P.mieG ?? DEFAULTS.mieG)));
    setRGB(u.cloudColor, P.cloudColor || DEFAULTS.cloudColor, clamp01(P.cloudCover ?? DEFAULTS.cloudCover));
    setRGB(u.cityGlow, P.cityGlow || DEFAULTS.cityGlow, P.cityGlowFalloff ?? DEFAULTS.cityGlowFalloff);
    setRGB(u.hazeColor, P.fogColor || P.horizon || DEFAULTS.horizon, clamp01(P.haze ?? DEFAULTS.haze));
    u.skyParams.r = clamp01(P.stars ?? DEFAULTS.stars);
    u.skyParams.b = P.cloudScale ?? DEFAULTS.cloudScale;
    u.skyParams.a = P.cloudSpeed ?? DEFAULTS.cloudSpeed;
    this._maxRadiance = P.maxRadiance ?? DEFAULTS.maxRadiance;
    this._probeMaxRadiance = P.probeMaxRadiance ?? DEFAULTS.probeMaxRadiance;
    u.skyParams2.set(this._maxRadiance, P.skyIntensity ?? DEFAULTS.skyIntensity, P.dither ?? DEFAULTS.dither, 0);

    if (this.sunMesh) {
      // Place the disc well inside camera.maxZ (infiniteDistance keeps it camera-relative) and size it to the sky disc
      // (a touch larger so the god-ray occlusion pass has enough pixels to work with).
      const dist = this.radius * 0.85;
      const ang = Math.max(0.6, (P.sunSize ?? DEFAULTS.sunSize) * 1.6) * DEG;
      this.sunMesh.position.set(sd.x * dist, sd.y * dist, sd.z * dist);
      const s = Math.tan(ang) * dist;
      this.sunMesh.scaling.set(s, s, s);
      // HDR emissive (bloom + VLS source); keep it modest so it does not out-shine the analytic disc.
      const k = Math.min(40, rad * 8);
      this._sunRadiance.set(sc.r * k, sc.g * k, sc.b * k);
      this._sunMat.emissiveColor.copyFrom(this._sunRadiance);
    }
    return this;
  }

  /** Radiance clamp used while the reflection probe renders (LightingDirector toggles it around the probe pass). */
  setProbePass(active) {
    this._u.skyParams2.r = active ? this._probeMaxRadiance : this._maxRadiance;
  }

  /** Enable / disable the sun disc (god-ray source) mesh. */
  setSunMeshEnabled(enabled) {
    if (this.sunMesh) this.sunMesh.setEnabled(!!enabled);
  }

  update(dt) {
    this.time += dt;
    // Wrap to keep hash inputs precise over long sessions (clouds drift slowly, a jump every ~2.7 h is invisible).
    if (this.time > 10000) this.time -= 10000;
    this._u.skyParams.g = this.time;
  }

  dispose() {
    this.mesh.dispose(false, true);
    this.sunMesh?.dispose(false, true);
  }
}

function setRGB(c4, c3, w) {
  c4.r = c3.r; c4.g = c3.g; c4.b = c3.b; c4.a = w;
}
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
