// Project Strike post-processing stack (WebGPU / WGSL only).
//
// Camera chain, in this exact order (every stage before the DefaultRenderingPipeline stays HDR half-float):
//   [SSAO2 (G-buffer)]  MEDIUM+          ambient occlusion on the linear HDR scene colour
//   [SSR   (G-buffer)]  ULTRA            wet-asphalt / glass screen-space reflections
//   [MotionBlur]        HIGH+            camera-based, near-depth masked so the viewmodel never smears
//   [God rays (VLS)]    HIGH+            only while a sun disc source is set (GOLDEN_HOUR / DAYLIGHT)
//   DefaultRenderingPipeline 'strike-post': bloom -> image processing (ACES / KHR neutral, exposure, contrast,
//                                          ColorCurves, vignette, dithering) -> [sharpen] -> [FXAA]
//   ONE finishing WGSL pass, always last:  'strike-lens'  (radial CA + animated film grain + breathing + damage + ADS)
//                                   or     'strike-bodycam' (BodycamPostProcess: fisheye + fringe + sensor look)
// CA and grain live in the finishing pass instead of the pipeline's two extra full-screen passes, which keeps the
// iPhone 11 (MOBILE) chain at bloom(~3) + image processing + FXAA + finishing pass = 6 full-screen passes.
//
// Per-frame work is uniform updates only: nothing here touches ImageProcessingConfiguration per frame (every change
// there walks all materials x meshes to mark them dirty), so exposure breathing / damage pulses run in the finishing pass.

import '@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent.js';
import '@babylonjs/core/Rendering/geometryBufferRendererSceneComponent.js';
// The G-buffer is a MultiRenderTarget: WebGPUEngine only gets createMultipleRenderTarget from this extension.
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.multiRender.js';
// Registered eagerly (the G-buffer renderer would lazy-load it) so the WGSL fix below can be applied before first use.
import '@babylonjs/core/ShadersWGSL/geometry.fragment.js';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline.js';
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline.js';
import { SSRRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssrRenderingPipeline.js';
import { MotionBlurPostProcess } from '@babylonjs/core/PostProcesses/motionBlurPostProcess.js';
import { VolumetricLightScatteringPostProcess } from '@babylonjs/core/PostProcesses/volumetricLightScatteringPostProcess.js';
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess.js';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration.js';
import { ColorCurves } from '@babylonjs/core/Materials/colorCurves.js';
import { EffectWrapper } from '@babylonjs/core/Materials/effectRenderer.js';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore.js';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage.js';
import { BodycamPostProcess, BODYCAM_DEFAULTS } from './BodycamPostProcess.js';

const DRP_NAME = 'strike-post';
const SSAO_NAME = 'strike-ssao';
const SSR_NAME = 'strike-ssr';
const MB_NAME = 'strike-motion-blur';
const LENS_SHADER = 'strikeLens';

const TEX_UBYTE = 0; // Constants.TEXTURETYPE_UNSIGNED_BYTE
const TEX_HALF = 2; // Constants.TEXTURETYPE_HALF_FLOAT
const TEX_BILINEAR = 2; // Constants.TEXTURE_BILINEAR_SAMPLINGMODE
const PAUSED_REFRESH = 0x3fffffff; // RenderTargetTexture.refreshRate "practically never"

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
const isNullEntry = p => !p;

// ------------------------------------------------------------------------------------------------ finishing pass
// lensA: x CA shift (px at the frame corners), y grain amplitude, z time (s), w brightness multiplier
// lensB: x damage 0..1, y ADS 0..1, z aspect (w/h), w focus vignette
// texel: xy 1/size, zw size
const LENS_FRAGMENT = /* wgsl */ `
varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;
uniform lensA: vec4f;
uniform lensB: vec4f;
uniform texel: vec4f;

fn lnPcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

fn lnHash(x: u32, y: u32, z: u32) -> f32 {
  return f32(lnPcg(x + lnPcg(y + lnPcg(z)))) * (1.0 / 4294967295.0);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let uv = input.vUV;
  let aspect = uniforms.lensB.z;
  let d = uv - vec2f(0.5);
  let dn = vec2f(d.x * aspect, d.y);
  let rr = dot(dn, dn) / (0.25 * (aspect * aspect + 1.0));

  // Radial lateral chromatic aberration: zero at the crosshair, growing with r^2 toward the frame edges.
  let dpx = d * uniforms.texel.zw;
  let dir = dpx / max(length(dpx), 0.0001);
  let off = dir * (uniforms.lensA.x * rr) * uniforms.texel.xy;
  let cR = textureSample(textureSampler, textureSamplerSampler, uv + off);
  let cG = textureSample(textureSampler, textureSamplerSampler, uv);
  let cB = textureSample(textureSampler, textureSamplerSampler, uv - off);
  var col = vec3f(cR.r, cG.g, cB.b) * uniforms.lensA.w;

  // Animated film grain: triangular-distributed luma noise, strongest in the mid-tones, still present in shadows.
  let px = vec2u(fragmentInputs.position.xy);
  let frame = u32(max(uniforms.lensA.z, 0.0) * 60.0);
  let g = lnHash(px.x, px.y, frame) + lnHash(px.x + 7919u, px.y + 104729u, frame) - 1.0;
  let lum = dot(col, vec3f(0.2126, 0.7152, 0.0722));
  let bell = 0.4 + 0.6 * (1.0 - abs(clamp(lum, 0.0, 1.0) * 2.0 - 1.0));
  col = col + vec3f(g * uniforms.lensA.y * bell);

  // ADS focus: gentle tunnel vignette while aiming.
  col = col * (1.0 - uniforms.lensB.w * rr * (0.6 + 0.4 * rr));

  // Hit feedback: brief desaturation + red bleed from the frame edges.
  let dmg = uniforms.lensB.x;
  let dl = dot(col, vec3f(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3f(dl), dmg * 0.6);
  col = mix(col, vec3f(0.58, 0.02, 0.02) * (0.35 + dl), clamp(dmg * (0.12 + 1.05 * rr * rr), 0.0, 0.8));

  fragmentOutputs.color = vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;

let lensRegistered = false;
function registerLensShader() {
  if (lensRegistered) return;
  lensRegistered = true;
  ShaderStore.ShadersStoreWGSL[`${LENS_SHADER}FragmentShader`] = LENS_FRAGMENT;
}

/** Standard-camera finishing pass (CA + grain + breathing + damage + ADS). Same attach/detach contract as the bodycam. */
class StrikeLensPass {
  constructor(camera, engine) {
    registerLensShader();
    this.camera = camera;
    this.engine = engine;
    this.enabled = false;
    this.state = { ca: 0, grain: 0, time: 0, brightness: 1, damage: 0, ads: 0, focusVignette: 0 };
    this.postProcess = new PostProcess('strike-lens', LENS_SHADER, {
      uniforms: ['lensA', 'lensB', 'texel'],
      samplers: [],
      size: 1.0,
      camera: null,
      samplingMode: TEX_BILINEAR,
      engine,
      reusable: false,
      textureType: TEX_UBYTE,
      shaderLanguage: ShaderLanguage.WGSL,
    });
    this.postProcess.onApply = effect => this._bind(effect);
  }

  _bind(effect) {
    const S = this.state;
    const pp = this.postProcess;
    const w = pp.width > 0 ? pp.width : this.engine.getRenderWidth();
    const h = pp.height > 0 ? pp.height : this.engine.getRenderHeight();
    // CA is authored in CSS pixels: scale by the live pixel ratio so it looks the same at every resolution.
    const pixelRatio = 1 / Math.max(0.05, this.engine.getHardwareScalingLevel());
    effect.setFloat4('lensA', Math.max(0, S.ca) * 0.38 * pixelRatio, Math.max(0, S.grain), S.time % 3600, Math.max(0, S.brightness));
    effect.setFloat4('lensB', clamp01(S.damage), clamp01(S.ads), w / Math.max(1, h), clamp01(S.focusVignette));
    effect.setFloat4('texel', 1 / Math.max(1, w), 1 / Math.max(1, h), w, h);
  }

  isReady() { return this.postProcess.isReady(); }

  attach() {
    const list = this.camera._postProcesses || [];
    if (list.indexOf(this.postProcess) === -1) this.camera.attachPostProcess(this.postProcess);
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

// ------------------------------------------------------------------------------------------------ G-buffer WGSL fix
// Babylon 9.23's WGSL geometry shader calls toLinearSpaceVec4() on a vec3 in the reflectivity path (SSR + PBR albedo
// texture in gamma space), which fails WGSL validation and drops every G-buffer draw. Patch the stored source once;
// the store only registers a shader when its key is empty, so the lazy import inside the renderer keeps this version.
let gbufferShaderPatched = false;
function patchGeometryShaderWGSL() {
  if (gbufferShaderPatched) return;
  gbufferShaderPatched = true;
  const key = 'geometryPixelShader';
  const src = ShaderStore.ShadersStoreWGSL[key];
  const bad = 'color=toLinearSpaceVec4(color);';
  if (typeof src === 'string' && src.indexOf(bad) !== -1) {
    ShaderStore.ShadersStoreWGSL[key] = src.split(bad).join('color=toLinearSpaceVec3(color);');
  }
}

// ------------------------------------------------------------------------------------------------ motion blur mask
// Babylon's camera-based motion blur reprojects every pixel with the previous view-projection, which smears the
// camera-attached viewmodel whenever the view turns. Scale the velocity by a near-depth mask (the G-buffer depth is
// linear view z): nothing closer than ~0.45 m blurs, full blur from ~1.1 m. Shader text is matched literally; if a
// future Babylon changes it the patch simply does not apply (plain Babylon motion blur).
let mbMaskRegistered = false;
function registerMotionBlurNearMask() {
  if (mbMaskRegistered) return;
  mbMaskRegistered = true;
  EffectWrapper.RegisterShaderCodeProcessing(MB_NAME, {
    processCodeAfterIncludes: (_name, shaderType, code) => {
      if (shaderType !== 'fragment' || typeof code !== 'string') return code;
      const anchor = 'depth=uniforms.projection[2].z';
      const velocity = '(ppos.xy-input.vUV)*uniforms.motionScale*uniforms.motionStrength';
      if (code.indexOf(anchor) === -1 || code.indexOf(velocity) === -1) return code;
      return code
        .replace(anchor, `let strikeNear: f32=smoothstep(0.45,1.1,depth);${anchor}`)
        .replace(velocity, `${velocity}*strikeNear`);
    },
  });
}

// ------------------------------------------------------------------------------------------------ PostFXStack
export class PostFXStack {
  /**
   * @param {import('@babylonjs/core/scene.js').Scene} scene
   * @param {import('@babylonjs/core/Cameras/camera.js').Camera} camera the player camera (the only camera in the chain)
   * @param {object} profile DeviceProfile (profile.post / profile.render.msaa / profile.tier)
   */
  constructor(scene, camera, profile) {
    this.scene = scene;
    this.camera = camera;
    this.profile = profile || {};
    this.engine = scene.getEngine();
    this.tier = this.profile.tier || 'HIGH';
    const post = this.profile.post || {};
    this._post = post;
    this._msaa = Math.max(1, (this.profile.render?.msaa | 0) || 1);

    this._shed = 0;
    this._bodycam = false;
    this._grade = null;
    this._time = 0;
    this._damage = 0;
    this._ads = 0;
    this._speed = 0;
    this._shake = 0;
    this._godRaysMesh = null;
    this._vlsRTT = null;
    this._vlsLive = false;
    this._gbufferPaused = false;
    this._active = { ssao: false, ssr: false, motionBlur: false, godRays: false };
    this._bodycamNoise = 0.06;
    this._bodycamGain = 1;
    // Slightly stronger barrel than the class default: reads like the UE5 bodycam reference at the rig's ~100° FOV.
    this._bodycamParams = { ...BODYCAM_DEFAULTS, distortion: 0.5 };

    // Grade-derived bases (overwritten by applyGrade).
    this._caBase = post.chromaticAberration ? 8 : 0;
    this._grainBase = post.grain ? 6 : 0;
    this._breathing = 0;
    this._vignetteBase = 1.6;
    this._bloomKernelBase = num(post.bloomKernel, 64);
    this._bloomScaleBase = clamp(num(post.bloomScale, 0.5), 0.25, 1);
    this._mbStrength = post.motionBlur ? num(post.motionBlur.strength, 0.6) : 0;

    this._setupImageProcessing();

    // ---- G-buffer consumers (desktop / tablet tiers). Created in chain order; _relink() enforces it anyway.
    const wantGBuffer = !!(post.ssao || post.ssr || post.motionBlur);
    this.gbuffer = null;
    this._ownsGBuffer = false;
    if (wantGBuffer) {
      patchGeometryShaderWGSL();
      const had = !!scene.geometryBufferRenderer;
      // SSR needs full-resolution depth/normals; SSAO (ratio ~.5) and motion blur are fine at half resolution.
      this.gbuffer = scene.enableGeometryBufferRenderer(post.ssr ? 1 : 0.5) || null;
      this._ownsGBuffer = !had && !!this.gbuffer;
    }

    this.ssao = null;
    if (post.ssao && this.gbuffer && SSAO2RenderingPipeline.IsSupported) this._createSSAO(post.ssao);

    this.ssr = null;
    if (post.ssr && this.gbuffer) this._createSSR(post.ssr);

    this.motionBlur = null;
    if (post.motionBlur && this.gbuffer) this._createMotionBlur(post.motionBlur);

    this.godRays = null; // created lazily by setGodRaysSource(mesh)

    // G-buffer mesh filter (after every consumer: SSR / motion blur toggle G-buffer channels, which recreates its target).
    this._gbFilter = null;
    this._gbFilteredTarget = null;
    if (this.gbuffer) this._createGBufferFilter(!!this.ssr);

    // ---- DefaultRenderingPipeline (HDR). Built once, explicitly, after configuration.
    const pipe = new DefaultRenderingPipeline(DRP_NAME, post.hdr !== false, scene, [camera], false);
    this.pipeline = pipe;
    this._installBloomKernelQuantizer(pipe);
    pipe.depthOfFieldEnabled = false;
    pipe.chromaticAberrationEnabled = false; // done in the finishing pass
    pipe.grainEnabled = false; // done in the finishing pass
    pipe.bloomEnabled = true;
    pipe.bloomScale = this._bloomScaleBase;
    pipe.bloomKernel = this._bloomKernelBase;
    pipe.bloomThreshold = 0.9;
    pipe.bloomWeight = 0.3;
    pipe.fxaaEnabled = !!post.fxaa;
    pipe.sharpenEnabled = !!post.sharpen;
    if (pipe.sharpen) {
      pipe.sharpen.edgeAmount = this.tier === 'ULTRA' ? 0.28 : 0.22;
      pipe.sharpen.colorAmount = 1;
    }
    pipe.samples = 1;
    this._buildObserver = pipe.onBuildObservable.add(() => this._onPipelineBuilt());
    pipe.automaticBuild = true;
    pipe.prepare();

    // ---- Finishing passes (both compiled now so toggling the bodycam never shows an uncompiled frame).
    this.lens = new StrikeLensPass(camera, this.engine);
    this.bodycam = new BodycamPostProcess(camera, this.engine);

    this._relink();
    this._syncFinishing();
  }

  // ------------------------------------------------------------------------------------------ construction helpers
  _setupImageProcessing() {
    const ipc = this.scene.imageProcessingConfiguration;
    this.ipc = ipc;
    this.curves = new ColorCurves();
    ipc.colorCurves = this.curves;
    ipc.applyByPostProcess = true; // materials skip in-shader tone mapping (set before they compile)
    ipc.colorCurvesEnabled = true;
    ipc.toneMappingEnabled = true;
    ipc.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ipc.exposure = 1.1;
    ipc.contrast = 1.1;
    ipc.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
    ipc.vignetteStretch = 0;
    ipc.vignetteCameraFov = 0.5; // grade vignette weights were authored against Babylon's default vignette geometry
    ipc.vignetteWeight = this._vignetteBase;
    ipc.vignetteColor.set(0, 0, 0, 0);
    ipc.vignetteEnabled = true;
    ipc.ditheringEnabled = true; // kills 8-bit banding in night fog / sky gradients
  }

  _createSSAO(cfg) {
    const ratio = clamp(num(cfg.ratio, 0.5), 0.25, 1);
    const ssao = new SSAO2RenderingPipeline(SSAO_NAME, this.scene, { ssaoRatio: ratio, blurRatio: ratio }, [this.camera], true, TEX_HALF);
    ssao.samples = clamp(num(cfg.samples, 16) | 0, 4, 64);
    ssao.radius = 1.2;
    ssao.totalStrength = 1.1;
    ssao.base = 0.06;
    ssao.maxZ = 70;
    ssao.minZAspect = 0.35;
    ssao.expensiveBlur = this.tier === 'ULTRA';
    if (ssao.expensiveBlur) {
      ssao.bilateralSamples = 12;
      ssao.bilateralSoften = 0.05;
      ssao.bilateralTolerance = 0.15;
    }
    this.ssao = ssao;
  }

  _createSSR(cfg) {
    const ssr = new SSRRenderingPipeline(SSR_NAME, this.scene, [this.camera], true, TEX_HALF);
    if (!ssr.isSupported) { ssr.dispose(); return; }
    // The chain is linear HDR at this point (the pipeline tone-maps later).
    ssr.inputTextureColorIsInGammaSpace = false;
    ssr.generateOutputInGammaSpace = false;
    // ssrDownsample only sizes the horizontal blur; blurDownsample sizes the vertical blur AND the combiner, which
    // outputs the whole frame - it must stay 0 or the entire image continues at half resolution.
    ssr.ssrDownsample = num(cfg.ratio, 0.5) <= 0.5 ? 1 : 0;
    ssr.blurDispersionStrength = 0.025;
    ssr.blurDownsample = 0;
    ssr.enableSmoothReflections = true;
    // Dielectric wet asphalt stores F0 = 0.04 (half float): keep it in, but skip empty / non-PBR pixels (0).
    ssr.reflectivityThreshold = 0.02;
    ssr.step = Math.max(1, num(cfg.step, 1));
    ssr.maxSteps = clamp(num(cfg.maxSteps, 120) | 0, 16, 400);
    ssr.maxDistance = 60;
    ssr.thickness = 0.45;
    ssr.strength = 0.9;
    ssr.reflectionSpecularFalloffExponent = 2.2;
    ssr.roughnessFactor = 0.15;
    ssr.selfCollisionNumSkip = 2;
    ssr.useFresnel = true;
    ssr.attenuateScreenBorders = true;
    ssr.attenuateFacingCamera = true;
    ssr.attenuateIntersectionDistance = true;
    ssr.clipToFrustum = true;
    this.ssr = ssr;
  }

  /**
   * Keeps two kinds of meshes out of the G-buffer (they stay in the normal render):
   *  - coplanar decal overlays (negative zOffset) with a normal map: road paint sits 1 cm above the asphalt it decorates and
   *    its thin-instance bump normals come out corrupted in Babylon's G-buffer shader (SSR sparkle, SSAO noise); the surface
   *    underneath provides depth / normal / roughness instead;
   *  - with SSR, PBR materials left in specular-glossiness defaults (no metallic / roughness: the emissive neon, sign and
   *    palette materials): the G-buffer writes their default white reflectivity, which would turn every sign into a mirror.
   * Filters the camera's already-culled active mesh list into a reused array: no per-frame allocation.
   */
  _createGBufferFilter(withSSR) {
    const out = [];
    const verdicts = new WeakMap();
    const excluded = mat => {
      if (!mat || mat.getClassName() !== 'PBRMaterial') return false;
      if (mat.zOffset < 0 && mat.bumpTexture) return true;
      return withSSR && mat.metallic == null && mat.roughness == null && !mat.metallicTexture && !mat.reflectivityTexture;
    };
    this._gbFilter = (_layer, list, length) => {
      if (!list) return null;
      out.length = 0;
      for (let i = 0; i < length; i++) {
        const mesh = list[i];
        const mat = mesh.material;
        if (mat) {
          let skip = verdicts.get(mat);
          if (skip === undefined) { skip = excluded(mat); verdicts.set(mat, skip); }
          if (skip) continue;
        }
        out.push(mesh);
      }
      return out;
    };
    this._syncGBufferFilter();
  }

  /** (Re)attaches the filter when the renderer has (re)created its multi render target. One reference compare per frame. */
  _syncGBufferFilter() {
    const mrt = this._gbFilter ? this.gbuffer?.getGBuffer?.() : null;
    if (!mrt || mrt === this._gbFilteredTarget) return;
    mrt.getCustomRenderList = this._gbFilter;
    this._gbFilteredTarget = mrt;
  }

  _createMotionBlur(cfg) {
    registerMotionBlurNearMask();
    const mb = new MotionBlurPostProcess(MB_NAME, this.scene, 1.0, this.camera, TEX_BILINEAR, this.engine, false, TEX_HALF, false, true);
    mb.isObjectBased = false; // camera-based (depth reprojection); cheaper, no per-mesh velocity buffer
    mb.motionBlurSamples = clamp(num(cfg.samples, 16) | 0, 4, 64);
    mb.motionStrength = this._mbStrength;
    this.motionBlur = mb;
  }

  _createGodRays(mesh) {
    const cfg = this._post.godRays || {};
    const cam = this.camera;
    const before = cam.customRenderTargets.length;
    // postProcessRatio 1: the pass consumes the full-resolution HDR scene; only the occlusion map is downscaled.
    const vls = new VolumetricLightScatteringPostProcess('strike-godrays',
      { postProcessRatio: 1.0, passRatio: clamp(num(cfg.ratio, 0.5), 0.25, 1) },
      cam, mesh, clamp(num(cfg.samples, 60) | 0, 16, 120), TEX_BILINEAR, this.engine, false, this.scene);
    // VLS has no texture-type argument; its input must stay half-float or it would clamp the HDR chain before bloom.
    vls._textureType = TEX_HALF;
    this._vlsRTT = cam.customRenderTargets.length > before ? cam.customRenderTargets[before] : (vls._volumetricLightScatteringRTT || null);
    this._vlsLive = !!this._vlsRTT;
    // The sun disc is an infiniteDistance mesh: its local position is camera-relative, so project its world position.
    vls.useCustomMeshPosition = true;
    vls.onActivateObservable.add(() => {
      const src = vls.mesh;
      if (src) vls.customMeshPosition.copyFrom(src.getAbsolutePosition());
    });
    vls.exposure = 0.22;
    vls.decay = 0.965;
    vls.weight = 0.45;
    vls.density = 0.94;
    this.godRays = vls;
    this._refreshGodRaysExclusions();
  }

  _refreshGodRaysExclusions() {
    const vls = this.godRays;
    if (!vls) return;
    const src = vls.mesh;
    const list = vls.excludedMeshes;
    list.length = 0;
    // Sky domes are drawn black in the occlusion pass anyway; skipping them saves fill.
    for (const m of this.scene.meshes) if (m !== src && (m.infiniteDistance || m.metadata?.sky)) list.push(m);
  }

  /**
   * Instance-level override of pipeline.bloomKernel: the kernel is quantised to "best" Babylon kernels (16n + 1 render
   * pixels) so PerformanceGovernor resolution steps do not compile a new blur shader each time (a hitch on iPhone).
   */
  _installBloomKernelQuantizer(pipe) {
    const engine = this.engine;
    const quantize = css => Math.max(1, Math.round(css / Math.max(0.05, engine.getHardwareScalingLevel()) / 16)) * 16 + 1;
    let css = num(pipe.bloomKernel, 64);
    this._quantizeKernel = quantize;
    try {
      Object.defineProperty(pipe, 'bloomKernel', {
        configurable: true,
        enumerable: true,
        // DRP divides this by its hardware scale level when it rebuilds bloom: hand back the quantised render kernel.
        get() { return quantize(css) * engine.getHardwareScalingLevel(); },
        set(value) {
          css = num(value, css);
          pipe._bloomKernel = css; // keeps DRP's own resize handler re-applying the CSS value
          if (pipe.bloom) pipe.bloom.kernel = quantize(css);
        },
      });
    } catch (error) {
      console.warn('[PostFXStack] bloom kernel quantizer unavailable', error);
    }
  }

  _onPipelineBuilt() {
    // Bloom may have been recreated: re-assert the quantised kernel (no-op when unchanged).
    const pipe = this.pipeline;
    if (pipe?.bloom) pipe.bloom.kernel = this._quantizeKernel(this._currentBloomKernel());
    // The pipeline re-appends its passes at the end of the camera chain: keep the finishing pass LAST.
    const fin = this._finishing();
    if (fin && fin.enabled) { fin.detach(); fin.attach(); }
  }

  _finishing() {
    if (!this.lens || !this.bodycam) return null;
    return this._bodycam ? this.bodycam : this.lens;
  }

  _currentBloomKernel() {
    return this._bloomKernelBase * (this._shed >= 3 ? 0.5 : 1);
  }

  // ------------------------------------------------------------------------------------------ chain management
  _want() {
    const s = this._shed;
    const src = this._godRaysMesh;
    return {
      ssao: !!this.ssao && s < 2,
      ssr: !!this.ssr && s < 1,
      motionBlur: !!this.motionBlur && s < 1,
      godRays: !!this.godRays && !!src && !src.isDisposed?.() && src.isEnabled() && s < 2,
    };
  }

  _sameActive(w) {
    const a = this._active;
    return a.ssao === w.ssao && a.ssr === w.ssr && a.motionBlur === w.motionBlur && a.godRays === w.godRays;
  }

  /** Detaches every stage this stack owns and re-attaches the active ones in the canonical order. Rare (shed / source changes). */
  _relink() {
    const cam = this.camera;
    const mgr = this.scene.postProcessRenderPipelineManager;
    const w = this._want();

    // MSAA belongs to whichever stage receives the scene render (the first post-process of the camera).
    const m = this._msaa;
    const first = w.ssao ? 'ssao' : w.ssr ? 'ssr' : w.motionBlur ? 'mb' : w.godRays ? 'vls' : 'drp';
    if (this.ssao) this.ssao.textureSamples = first === 'ssao' ? m : 1;
    if (this.ssr) this.ssr.samples = first === 'ssr' ? m : 1;
    if (this.motionBlur) this.motionBlur.samples = first === 'mb' ? m : 1;
    if (this.godRays) this.godRays.samples = first === 'vls' ? m : 1;
    const drpSamples = first === 'drp' ? m : 1;
    if (this.pipeline.samples !== drpSamples) this.pipeline.samples = drpSamples; // rebuilds (handled by _onPipelineBuilt)

    // Detach everything we own (Babylon leaves null holes; compact them when the chain is otherwise empty).
    this._detachPipeline(mgr, this.ssao, SSAO_NAME);
    this._detachPipeline(mgr, this.ssr, SSR_NAME);
    if (this.motionBlur) cam.detachPostProcess(this.motionBlur);
    if (this.godRays) cam.detachPostProcess(this.godRays);
    this._detachPipeline(mgr, this.pipeline, DRP_NAME);
    if (this.lens) this.lens.detach();
    if (this.bodycam) this.bodycam.detach();
    const list = cam._postProcesses;
    if (list && list.length && list.every(isNullEntry)) list.length = 0;

    // Re-attach in canonical order.
    if (w.ssao) mgr.attachCamerasToRenderPipeline(SSAO_NAME, cam);
    if (w.ssr) mgr.attachCamerasToRenderPipeline(SSR_NAME, cam);
    if (w.motionBlur) cam.attachPostProcess(this.motionBlur);
    if (this.godRays) {
      if (w.godRays) cam.attachPostProcess(this.godRays);
      this._setGodRaysMap(w.godRays);
    }
    mgr.attachCamerasToRenderPipeline(DRP_NAME, cam);
    const fin = this._finishing();
    if (fin) fin.attach();

    // Pause the G-buffer when nothing reads it (shed level 2+).
    this._setGBufferPaused(!(w.ssao || w.ssr || w.motionBlur));

    const a = this._active;
    a.ssao = w.ssao; a.ssr = w.ssr; a.motionBlur = w.motionBlur; a.godRays = w.godRays;
  }

  _detachPipeline(mgr, pipeline, name) {
    if (!pipeline) return;
    const cams = pipeline.cameras || pipeline._cameras || [];
    if (cams.indexOf(this.camera) !== -1) mgr.detachCamerasFromRenderPipeline(name, this.camera);
  }

  _setGodRaysMap(live) {
    const rtt = this._vlsRTT;
    if (!rtt) return;
    const targets = this.camera.customRenderTargets;
    const idx = targets.indexOf(rtt);
    if (live && idx === -1) targets.push(rtt);
    else if (!live && idx !== -1) targets.splice(idx, 1);
    this._vlsLive = live;
  }

  _setGBufferPaused(paused) {
    const gb = this.gbuffer;
    if (!gb || paused === this._gbufferPaused) return;
    const rt = gb.getGBuffer?.();
    if (!rt) return;
    rt.refreshRate = paused ? PAUSED_REFRESH : 1; // the setter also resets the refresh counter
    this._gbufferPaused = paused;
  }

  _syncFinishing() {
    const shedFx = this._shed >= 3;
    const L = this.lens.state;
    L.ca = shedFx ? 0 : this._caBase;
    L.grain = shedFx ? 0 : this._grainBase;
  }

  // ------------------------------------------------------------------------------------------ public API
  /**
   * Applies a LightingDirector grade: tone mapping, exposure, contrast, ColorCurves, vignette, bloom
   * threshold / weight / kernel / scale, CA + grain (finishing pass), SSAO strength, SSR strength, god-ray shape.
   */
  applyGrade(grade) {
    if (!grade) return;
    this._grade = grade;
    const ipc = this.ipc;
    const post = this._post;

    const tm = Number.isFinite(grade.toneMappingType) ? grade.toneMappingType
      : grade.toneMapping === 'NEUTRAL' ? ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL
        : ImageProcessingConfiguration.TONEMAPPING_ACES;
    if (!ipc.toneMappingEnabled) ipc.toneMappingEnabled = true;
    if (ipc.toneMappingType !== tm) ipc.toneMappingType = tm;
    const exposure = clamp(num(grade.exposure, 1), 0.05, 8);
    if (ipc.exposure !== exposure) ipc.exposure = exposure;
    const contrast = clamp(num(grade.contrast, 1), 0.5, 2.5);
    if (ipc.contrast !== contrast) ipc.contrast = contrast;

    // ColorCurves (plain setters, read at bind time: no material dirtying).
    const c = this.curves;
    c.globalSaturation = num(grade.saturation, 0);
    c.shadowsHue = num(grade.shadowsHue, 0);
    c.shadowsDensity = num(grade.shadowsDensity, 0);
    c.shadowsSaturation = num(grade.shadowsSaturation, 0);
    c.midtonesHue = num(grade.midtonesHue, 0);
    c.midtonesDensity = num(grade.midtonesDensity, 0);
    c.midtonesSaturation = num(grade.midtonesSaturation, 0);
    c.highlightsHue = num(grade.highlightsHue, 0);
    c.highlightsDensity = num(grade.highlightsDensity, 0);
    c.highlightsSaturation = num(grade.highlightsSaturation, 0);

    // Vignette (plain fields): the bodycam lens brings its own optical vignette, so the pipeline one is eased off.
    this._vignetteBase = clamp(num(grade.vignetteWeight, 1.5), 0, 6);
    ipc.vignetteWeight = this._vignetteBase * (this._bodycam ? 0.35 : 1);
    const vc = grade.vignetteColor;
    if (vc) ipc.vignetteColor.set(num(vc.r, 0), num(vc.g, 0), num(vc.b, 0), 0);

    // Bloom (threshold / weight are uniforms; scale rebuilds the bloom chain, so only when it really changes).
    const pipe = this.pipeline;
    pipe.bloomThreshold = clamp(num(grade.bloomThreshold, 0.9), 0, 20);
    pipe.bloomWeight = clamp(num(grade.bloomWeight, 0.3), 0, 4);
    const scale = clamp(this._bloomScaleBase * num(grade.bloomScaleMul, 1), 0.25, 1);
    if (Math.abs(pipe.bloomScale - scale) > 0.01) pipe.bloomScale = scale;
    pipe.bloomKernel = this._currentBloomKernel();

    // Finishing pass.
    this._caBase = post.chromaticAberration ? Math.max(0, num(grade.chromaticAberration, 0)) : 0;
    this._grainBase = post.grain ? Math.max(0, num(grade.grainIntensity, 0)) * (1.25 / 255) : 0;
    this._breathing = Math.max(0, num(grade.exposureBreathing, 0));
    // Small sensors get noisier as the scene gets darker (grain intensity is the grade's proxy for that); at night the
    // camera also runs high gain, which brightens the picture and amplifies the noise.
    const night = grade.preset === 'NIGHT_CITY' || num(grade.exposure, 1) >= 1.38;
    this._bodycamGain = night ? 1.05 : 1;
    this._bodycamNoise = clamp((0.035 + num(grade.grainIntensity, 6) * 0.0035) * (night ? 1.2 : 1), 0.03, 0.12);
    this._syncFinishing();

    // Ambient occlusion / reflections.
    if (this.ssao) this.ssao.totalStrength = clamp(num(grade.ssaoStrength, 1), 0, 3);
    if (this.ssr) this.ssr.strength = clamp(num(grade.ssrStrength, 1), 0, 2);

    // God rays: shape from the grade; the source comes from the grade too when it carries one.
    this._godRaysWeight = clamp(num(grade.godRaysWeight, 0.45), 0, 1.5);
    this._godRaysDecay = clamp(num(grade.godRaysDecay, 0.965), 0.8, 0.999);
    if (this.godRays) {
      this.godRays.weight = this._godRaysWeight;
      this.godRays.decay = this._godRaysDecay;
    }
    if ('sunScreenMesh' in grade || 'godRays' in grade) this.setGodRaysSource(grade.godRays ? grade.sunScreenMesh || null : null);
  }

  /** VolumetricLightScatteringPostProcess only when profile.post.godRays && mesh; null removes it from the chain. */
  setGodRaysSource(mesh) {
    const src = this._post.godRays ? mesh || null : null;
    if (src && !this.godRays) {
      this._godRaysMesh = src;
      this._createGodRays(src);
      if (Number.isFinite(this._godRaysWeight)) this.godRays.weight = this._godRaysWeight;
      if (Number.isFinite(this._godRaysDecay)) this.godRays.decay = this._godRaysDecay;
    } else if (src && this.godRays && this.godRays.mesh !== src) {
      this._godRaysMesh = src;
      this.godRays.mesh = src;
      this._refreshGodRaysExclusions();
    } else {
      this._godRaysMesh = src;
    }
    if (!this._sameActive(this._want()) || (this.godRays && this._vlsLive !== this._active.godRays)) this._relink();
  }

  /** Swaps the finishing pass (lens <-> bodycam). The bodycam stays LAST even across pipeline rebuilds. */
  setBodycam(enabled) {
    const on = !!enabled;
    if (on === this._bodycam) return;
    this._bodycam = on;
    if (on) { this.lens.detach(); this.bodycam.attach(); } else { this.bodycam.detach(); this.lens.attach(); }
    this.ipc.vignetteWeight = this._vignetteBase * (on ? 0.35 : 1);
  }

  get bodycamEnabled() { return this._bodycam; }

  /**
   * 0 full; 1 drop SSR + motion blur; 2 also drop SSAO + god rays (G-buffer paused);
   * 3 also halve the bloom kernel and drop chromatic aberration + grain.
   */
  setShedLevel(level) {
    const l = clamp(Math.round(num(level, 0)), 0, 3);
    if (l === this._shed) return;
    this._shed = l;
    this.pipeline.bloomKernel = this._currentBloomKernel();
    this._syncFinishing();
    if (!this._sameActive(this._want())) this._relink();
  }

  get shedLevel() { return this._shed; }

  /**
   * Per frame, before scene.render(). Uniform updates only.
   * @param {number} dt seconds
   * @param {{speed?:number, ads?:number, damage?:number, shake?:number, time?:number}} [state]
   */
  update(dt, state) {
    if (this._gbFilter) this._syncGBufferFilter();
    const d = dt > 0 ? (dt < 0.1 ? dt : 0.1) : 0;
    const s = state || EMPTY_STATE;
    this._time = Number.isFinite(s.time) ? s.time : this._time + d;
    const t = this._time;
    const ads = clamp01(num(s.ads, 0));
    const shake = clamp01(num(s.shake, 0));
    const speed = Math.max(0, num(s.speed, 0));
    // Damage envelope: instant attack, ~0.45 s release, so a one-frame pulse still reads.
    const hit = clamp01(num(s.damage, 0));
    this._damage = Math.max(hit, this._damage - d * 2.2);
    const k = 1 - Math.exp(-12 * d);
    this._ads += (ads - this._ads) * k;
    this._shake += (shake - this._shake) * (1 - Math.exp(-18 * d));
    this._speed = speed;

    // Night "eye adaptation" breathing (slow, irregular) in the finishing pass.
    const b = this._breathing;
    const breath = b > 0 ? 1 + b * (0.6 * Math.sin(t * 0.83) + 0.4 * Math.sin(t * 0.31 + 1.7)) : 1;
    const sprint = clamp01((speed - 4.6) / 1.8);

    if (this._bodycam) {
      const P = this._bodycamParams;
      P.time = t;
      P.rollingShutter = this._shake;
      // Small-sensor auto exposure: slow hunting + a pump when the rig jolts (recoil / footfalls).
      P.exposurePump = 0.03 * Math.sin(t * 0.7) + 0.1 * this._shake;
      P.noise = this._shed >= 3 ? this._bodycamNoise * 0.6 : this._bodycamNoise;
      P.edgeCA = this._shed >= 3 ? 0.6 : 0.9;
      P.damage = this._damage;
      P.brightness = this._bodycamGain * breath * (1 - 0.15 * this._damage);
      this.bodycam.set(P);
    } else {
      const L = this.lens.state;
      L.time = t;
      L.brightness = breath * (1 - 0.15 * this._damage);
      L.damage = this._damage;
      L.ads = this._ads;
      L.focusVignette = 0.16 * this._ads;
      L.ca = this._shed >= 3 ? 0 : this._caBase * (1 + 0.35 * sprint);
    }

    // Motion blur a touch stronger at sprint speed (uniform only). Babylon multiplies the per-frame velocity by the
    // animation ratio (frame time / 16.7 ms), which blows the blur up quadratically when the frame rate drops;
    // dividing it back out gives a constant-shutter look at any frame rate.
    if (this.motionBlur && this._active.motionBlur) {
      const ratio = clamp(num(this.scene.getAnimationRatio(), 1), 0.25, 4);
      this.motionBlur.motionStrength = this._mbStrength * (0.75 + 0.25 * sprint) / ratio;
    }

    // The sun disc is toggled by the lighting director: follow it without a per-frame relink.
    if (this.godRays && this._godRaysMesh) {
      const live = this._shed < 2 && this._godRaysMesh.isEnabled();
      if (live !== this._active.godRays) this._relink();
    }
  }

  /** Active pass names in chain order (diagnostics / tests). */
  describe() {
    const out = [];
    const a = this._active;
    if (a.ssao) out.push('ssao2');
    if (a.ssr) out.push('ssr');
    if (a.motionBlur) out.push('motion-blur');
    if (a.godRays) out.push('god-rays');
    const pipe = this.pipeline;
    if (pipe.bloomEnabled) out.push('bloom');
    if (pipe.imageProcessingEnabled) out.push('image-processing');
    if (pipe.sharpenEnabled) out.push('sharpen');
    if (pipe.fxaaEnabled) out.push('fxaa');
    out.push(this._bodycam ? 'bodycam' : 'lens');
    return out;
  }

  /** Rough full-screen pass count (bloom counted as 3: extract, blur pair at scale, merge) + MSAA info. */
  stats() {
    const passes = this.describe();
    let full = 0;
    for (const p of passes) full += p === 'bloom' ? 3 : p === 'ssao2' ? 3 : p === 'ssr' ? 3 : 1;
    return { passes, fullScreenPasses: full, msaa: this._msaa, shed: this._shed, bodycam: this._bodycam };
  }

  dispose() {
    const cam = this.camera;
    if (this._buildObserver) this.pipeline.onBuildObservable.remove(this._buildObserver);
    this._buildObserver = null;
    this.lens?.dispose();
    this.bodycam?.dispose();
    if (this.godRays) {
      this._setGodRaysMap(false);
      this.godRays.dispose(cam);
    }
    this.motionBlur?.dispose(cam);
    this.ssr?.dispose(false);
    this.ssao?.dispose(false);
    this.pipeline?.dispose();
    if (this._ownsGBuffer) this.scene.disableGeometryBufferRenderer();
    if (mbMaskRegistered) {
      EffectWrapper.RegisterShaderCodeProcessing(MB_NAME);
      mbMaskRegistered = false;
    }
    this.godRays = this.motionBlur = this.ssr = this.ssao = this.pipeline = null;
    this.lens = this.bodycam = null;
  }
}

const EMPTY_STATE = Object.freeze({});
