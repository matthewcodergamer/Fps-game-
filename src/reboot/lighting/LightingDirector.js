// Lighting presets for Project Strike: Night City neon, Cyberpunk golden hour, UE5-style hard daylight, bodycam overcast.
//
// Owns: sun/moon DirectionalLight + shadows (CascadedShadowGenerator on MEDIUM+, one player-fitted, texel-snapped
// ShadowGenerator on MOBILE), a HemisphericLight fill (sky / warm ground bounce = fake GI), every neon + lamp light
// (one ClusteredLightContainer, or the 3 strongest plain lights when clustering is unavailable), scene EXP2 fog, the
// ProceduralSky, the environment (a render-once HDR ReflectionProbe with box projection + an analytic SH irradiance
// built from the preset so PBR diffuse IBL never needs a GPU readback), and the colour grade handed to PostFXStack.
//
// Light order in scene.lights is sun, hemi, clustered container (MaterialLibrary maxSimultaneousLights = 6 leaves room
// for the weapon / enemy muzzle lights created later).

// (ShadowGenerator registers its own scene component in its constructor in 9.x — no side-effect import needed.)
import '@babylonjs/core/Lights/Clustered/clusteredLightingSceneComponent.js';
import '@babylonjs/core/Materials/Textures/baseTexture.polynomial.js';
import { ClusteredLightContainer } from '@babylonjs/core/Lights/Clustered/clusteredLightContainer.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { PointLight } from '@babylonjs/core/Lights/pointLight.js';
import { SpotLight } from '@babylonjs/core/Lights/spotLight.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator.js';
import { ReflectionProbe } from '@babylonjs/core/Probes/reflectionProbe.js';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture.js';
import { Observable } from '@babylonjs/core/Misc/observable.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { SphericalHarmonics, SphericalPolynomial } from '@babylonjs/core/Maths/sphericalPolynomial.js';
import { ProceduralSky } from './ProceduralSky.js';

const DEG = Math.PI / 180;
const FOGMODE_EXP2 = 2; // Scene.FOGMODE_EXP2
export const LIGHTING_PRESET_NAMES = ['NIGHT_CITY', 'GOLDEN_HOUR', 'DAYLIGHT', 'OVERCAST'];

// ------------------------------------------------------------------------------------------------ art direction
// Colours are sRGB hex (converted to linear once per apply; fog stays sRGB because PBR converts it itself).
// Sun: elevation / azimuth in degrees (azimuth 0 = +Z, 90 = +X; the street runs along Z, the player spawns at +Z
// looking toward -Z; +X appears on the LEFT of that view). Intensities are Babylon PBR units: directional diffuse =
// albedo * I * NdotL / pi (sun 9.5 ≈ hard midday), hemispheric = albedo * I * colour (no 1/pi).
// Grade: exposure/contrast = ImageProcessing values; saturation/*Saturation/*Density = ColorCurves units (-100..100);
// *Hue in degrees; bloomThreshold is linear HDR luminance; chromaticAberration = aberrationAmount (px);
// grainIntensity = GrainPostProcess.intensity; vignetteWeight = ImageProcessing.vignetteWeight.
export const PRESETS = {
  // Cyberpunk 2077 night: rain-soaked asphalt, magenta/cyan/amber neon, teal-violet smog, weak violet moonlight.
  NIGHT_CITY: {
    sun: { elevation: 40, azimuth: 150, color: '#8fa4ff', intensity: 0.9, darkness: 0.35 },
    hemi: { sky: '#384686', ground: '#44283e', intensity: 1.0 },
    fog: { color: '#1a1c30', density: 0.018 },
    sky: {
      zenith: '#03040b', horizon: '#241a40', ground: '#0c0a12', horizonExponent: 3.2, skyIntensity: 1,
      cloudCover: 0.55, cloudColor: '#2a2030', cloudScale: 3, cloudSpeed: 0.015, stars: 0.9,
      cityGlow: '#c23c78', cityGlowStrength: 0.14, cityGlowFalloff: 6, haze: 0.8,
      mie: 0.6, mieG: 0.8, sunSize: 1.3, discIntensity: 14,
    },
    neon: 1, neonLights: 1, lamps: 1, wetness: 0.9, windowGlow: 1,
    env: { intensity: 1, facade: '#33284a', ground: '#221a2c', canyon: 0.7, shScale: 1.5 },
    godRays: false,
    grade: {
      exposure: 1.4, contrast: 1.22, toneMapping: 'ACES', saturation: 14,
      bloomThreshold: 0.72, bloomWeight: 0.5, bloomScaleMul: 1, vignetteWeight: 2.4, vignette: '#0a0418',
      chromaticAberration: 12, grainIntensity: 10,
      shadowsHue: 235, shadowsSaturation: 20, shadowsDensity: 32,
      midtonesHue: 185, midtonesSaturation: 6, midtonesDensity: 8,
      highlightsHue: 325, highlightsSaturation: 12, highlightsDensity: 14,
      ssaoStrength: 1.1, ssrStrength: 1, exposureBreathing: 0.06,
    },
  },
  // Cyberpunk sunset street: sun low down the street axis, long shadows, orange sky → teal zenith, neon already on.
  GOLDEN_HOUR: {
    sun: { elevation: 7, azimuth: 189, color: '#ffa860', intensity: 7.5, darkness: 0.12 },
    hemi: { sky: '#4f86c8', ground: '#8a5a3c', intensity: 0.55 },
    fog: { color: '#c89a80', density: 0.009 },
    sky: {
      zenith: '#2d4f7c', horizon: '#ffb07c', ground: '#4a3024', horizonExponent: 5, skyIntensity: 1.25,
      cloudCover: 0.42, cloudColor: '#e2a37f', cloudScale: 3.2, cloudSpeed: 0.02, stars: 0,
      cityGlow: '#000000', cityGlowStrength: 0, cityGlowFalloff: 8, haze: 0.62,
      mie: 1.0, mieG: 0.8, sunSize: 0.9, discIntensity: 30,
    },
    neon: 0.85, neonLights: 0.55, lamps: 0.3, wetness: 0.3, windowGlow: 0.5,
    env: { intensity: 0.9, facade: '#6a4a3c', ground: '#7a5038', canyon: 0.6, shScale: 1.0 },
    godRays: true,
    grade: {
      exposure: 1.1, contrast: 1.2, toneMapping: 'ACES', saturation: 16,
      bloomThreshold: 0.95, bloomWeight: 0.38, bloomScaleMul: 1, vignetteWeight: 1.8, vignette: '#1e0c04',
      chromaticAberration: 9, grainIntensity: 7,
      shadowsHue: 195, shadowsSaturation: 18, shadowsDensity: 42,
      midtonesHue: 30, midtonesSaturation: 6, midtonesDensity: 10,
      highlightsHue: 35, highlightsSaturation: 20, highlightsDensity: 26,
      ssaoStrength: 1.0, ssrStrength: 0.8, exposureBreathing: 0, godRaysWeight: 0.55, godRaysDecay: 0.965,
    },
  },
  // UE5-style physically plausible midday (Pacifica): hard sun, pale-blue sky fill, warm ground bounce, crisp shadows.
  DAYLIGHT: {
    sun: { elevation: 62, azimuth: 140, color: '#fff2df', intensity: 11, darkness: 0.05 },
    hemi: { sky: '#9dbde6', ground: '#b09470', intensity: 0.22 },
    fog: { color: '#b8cbe0', density: 0.0055 },
    sky: {
      zenith: '#3a70c0', horizon: '#c6dbef', ground: '#6e675c', horizonExponent: 4.5, skyIntensity: 1.35,
      cloudCover: 0.3, cloudColor: '#f4f6fa', cloudScale: 3.8, cloudSpeed: 0.025, stars: 0,
      cityGlow: '#000000', cityGlowStrength: 0, cityGlowFalloff: 8, haze: 0.55,
      mie: 0.22, mieG: 0.86, sunSize: 0.7, discIntensity: 30,
    },
    neon: 0.45, neonLights: 0.08, lamps: 0, wetness: 0, windowGlow: 0.05,
    env: { intensity: 1, facade: '#77726a', ground: '#9a8468', canyon: 0.6, shScale: 1.0 },
    godRays: true,
    grade: {
      exposure: 1.05, contrast: 1.16, toneMapping: 'ACES', saturation: 8,
      bloomThreshold: 1.6, bloomWeight: 0.16, bloomScaleMul: 1, vignetteWeight: 1.1, vignette: '#000000',
      chromaticAberration: 5, grainIntensity: 4,
      shadowsHue: 210, shadowsSaturation: 8, shadowsDensity: 16,
      midtonesHue: 40, midtonesSaturation: 2, midtonesDensity: 3,
      highlightsHue: 45, highlightsSaturation: 6, highlightsDensity: 8,
      ssaoStrength: 1.3, ssrStrength: 0.6, exposureBreathing: 0, godRaysWeight: 0.25, godRaysDecay: 0.95,
    },
  },
  // Bodycam realism: flat grey sky, soft faint shadows, strong ambient, desaturated, damp ground.
  OVERCAST: {
    sun: { elevation: 64, azimuth: 70, color: '#e8eef4', intensity: 2.0, darkness: 0.55 },
    hemi: { sky: '#c4ccd4', ground: '#77726a', intensity: 0.7 },
    fog: { color: '#a3a8ad', density: 0.0095 },
    sky: {
      zenith: '#8b939b', horizon: '#b9bec2', ground: '#5d5b57', horizonExponent: 2.5, skyIntensity: 1.1,
      cloudCover: 1, cloudColor: '#a7adb3', cloudScale: 2.5, cloudSpeed: 0.02, stars: 0,
      cityGlow: '#000000', cityGlowStrength: 0, cityGlowFalloff: 8, haze: 0.85,
      mie: 0.8, mieG: 0.35, sunSize: 3, discIntensity: 0,
    },
    neon: 0.55, neonLights: 0.3, lamps: 0.12, wetness: 0.45, windowGlow: 0.2,
    env: { intensity: 0.85, facade: '#6e6e6c', ground: '#5c5a56', canyon: 0.55, shScale: 1.2 },
    godRays: false,
    grade: {
      exposure: 1.3, contrast: 1.06, toneMapping: 'NEUTRAL', saturation: -32,
      bloomThreshold: 1.25, bloomWeight: 0.2, bloomScaleMul: 1, vignetteWeight: 2.6, vignette: '#000000',
      chromaticAberration: 10, grainIntensity: 16,
      shadowsHue: 205, shadowsSaturation: -10, shadowsDensity: 14,
      midtonesHue: 60, midtonesSaturation: -6, midtonesDensity: 2,
      highlightsHue: 50, highlightsSaturation: -8, highlightsDensity: 5,
      ssaoStrength: 1.35, ssrStrength: 0.5, exposureBreathing: 0,
    },
  },
};

const QUALITY = { 'pcf-low': 2, 'pcf-medium': 1, 'pcf-high': 0 }; // ShadowGenerator.QUALITY_LOW / _MEDIUM / _HIGH
// Anchor intensities are normalised so their median lands on these Babylon-PBR values (candela-like; PBR diffuse is
// albedo * I / (pi * d^2), windowed to 0 at `range`). World authors only control relative brightness; pass
// world.lightUnits = 'pbr' to use anchor intensities verbatim.
const NEON_REF = 110;
const LAMP_REF = 700;
const AXIS_Z = new Vector3(0, 0, 1);
const UP = new Vector3(0, 1, 0);

const hexLinear = hex => Color3.FromHexString(hex).toLinearSpace();
const hexGamma = hex => Color3.FromHexString(hex);
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const hash1 = x => { const s = Math.sin(x * 12.9898) * 43758.5453; return s - Math.floor(s); };

function createGrade() {
  return {
    preset: 'NIGHT_CITY', exposure: 1, contrast: 1, toneMapping: 'ACES', toneMappingType: 1, saturation: 0,
    bloomThreshold: 0.9, bloomWeight: 0.2, bloomScaleMul: 1,
    vignetteWeight: 1.5, vignetteColor: new Color4(0, 0, 0, 0), chromaticAberration: 0, grainIntensity: 0,
    shadowsHue: 0, shadowsSaturation: 0, shadowsDensity: 0,
    highlightsHue: 0, highlightsSaturation: 0, highlightsDensity: 0,
    midtonesHue: 0, midtonesSaturation: 0, midtonesDensity: 0,
    godRays: false, sunScreenMesh: null, godRaysWeight: 0, godRaysDecay: 0.96,
    ssaoStrength: 1, ssrStrength: 1, exposureBreathing: 0, fogColor: new Color3(0, 0, 0),
  };
}

export class LightingDirector {
  /**
   * @param {import('@babylonjs/core/scene.js').Scene} scene
   * @param {import('@babylonjs/core/Cameras/camera.js').Camera} camera player camera (shadow fitting / CSM)
   * @param {object} profile DeviceProfile
   * @param {object} world createVerticalSlice() result (shadowCasters, shadowReceivers, neonAnchors, lampAnchors, spawn, bounds)
   * @param {object} materials MaterialLibrary (setNeonScale / setWetness / setWindowGlow); may be null
   */
  constructor(scene, camera, profile, world, materials) {
    this.scene = scene;
    this.camera = camera;
    this.profile = profile || {};
    this.world = world || {};
    this.materials = materials || null;
    this.tier = this.profile.tier || 'HIGH';
    this.onPresetChanged = new Observable();
    this.preset = null;
    this.grade = createGrade();

    this._time = 0;
    this._shed = 0;
    this._fogBase = 0;
    this._neonLightScale = 1;
    this._lampScale = 1;
    this._envRefresh = Math.max(0, this.profile.lighting?.envRefreshSeconds || 0);
    this._envTimer = 0;
    this._probeSettle = 0;
    this._probeRenders = 0;
    // Allocation-free temporaries for the per-frame shadow fitting.
    this._toSun = new Vector3(0, 1, 0);
    this._lightDir = new Vector3(0, -1, 0);
    this._lsRight = new Vector3(1, 0, 0);
    this._lsUp = new Vector3(0, 1, 0);
    this._tmpFwd = new Vector3(0, 0, 1);
    this._tmpFocus = new Vector3();

    this.sky = new ProceduralSky(scene, this.profile);
    this._enforceWindowedFalloff();

    // Order matters (see header): sun, hemi, then the clustered container.
    this.sun = new DirectionalLight('strike-sun', new Vector3(0, -1, 0), scene);
    this.sun.position = new Vector3(0, 80, 0);
    this.hemi = new HemisphericLight('strike-sky-fill', new Vector3(0, 1, 0), scene);
    this.hemi.specular = new Color3(0, 0, 0); // fill only: no fake top-down highlight on wet surfaces

    this._createShadows();
    this._createLocalLights();
    this._createEnvironment();
    this.apply(this.profile.lighting?.defaultPreset || 'NIGHT_CITY');
  }

  // -------------------------------------------------------------------------------------------- setup
  _createShadows() {
    const S = this.profile.shadows || {};
    const size = S.size || 1024;
    const cascades = Math.max(1, Math.min(4, S.cascades | 0 || 1));
    const distance = S.distance || 35;
    const quality = QUALITY[S.filter] ?? 2;
    const cam = this.camera;
    let sg;
    if (cascades > 1) {
      sg = new CascadedShadowGenerator(size, this.sun, undefined, cam);
      sg.numCascades = cascades;
      sg.lambda = 0.8;
      sg.stabilizeCascades = true;
      sg.autoCalcDepthBounds = false; // no depth-reduce readbacks
      sg.shadowMaxZ = Math.min(distance, (cam?.maxZ || 220) - 1);
      sg.depthClamp = true;
      sg.cascadeBlendPercentage = 0.08;
      sg.bias = 0.0016;
      sg.normalBias = 0.018;
      this._fitted = false;
    } else {
      sg = new ShadowGenerator(size, this.sun);
      // One map fitted around the player: fixed ortho frustum, light re-positioned (texel-snapped) right before the
      // shadow map renders, so it stays consistent even when the map refreshes every other frame.
      this._fitted = true;
      this._frustumSize = Math.max(24, distance * 1.35);
      this._focusAhead = distance * 0.28;
      this._texel = this._frustumSize / size;
      this.sun.autoUpdateExtends = false;
      this.sun.autoCalcShadowZBounds = false;
      this.sun.shadowFrustumSize = this._frustumSize;
      this._shadowBack = 120;
      this.sun.shadowMinZ = 0;
      this.sun.shadowMaxZ = 300;
      sg.bias = 0.0004;
      sg.normalBias = this._texel * 0.9;
      sg.frustumEdgeFalloff = 0.3;
      sg.getShadowMap().onBeforeRenderObservable.add(() => this._placeSunForShadow(), undefined, true);
    }
    if (S.contactHardening) {
      sg.useContactHardeningShadow = true;
      sg.contactHardeningLightSizeUVRatio = 0.03;
    } else {
      sg.usePercentageCloserFiltering = true;
    }
    sg.filteringQuality = quality;
    sg.transparencyShadow = false;
    this.shadowGenerator = sg;

    const casters = this.world.shadowCasters || [];
    for (const m of casters) {
      if (!m) continue;
      sg.addShadowCaster(m, true);
      m.receiveShadows = true;
    }
    for (const m of this.world.shadowReceivers || []) if (m) m.receiveShadows = true;
    if (cascades > 1 && casters.length) sg.freezeShadowCastersBoundingInfo = true;
    this._shadowDesc = cascades > 1 ? `CSM${cascades}x${size}` : `SM${size}`;
  }

  /**
   * Neon + lamp lights. Anchors beyond the light budget are served by a fixed POOL of lights that re-targets the nearest
   * (and brightest) anchors around the camera every ~0.4 s, so the whole street keeps its neon spill while the GPU only
   * ever shades `maxNeonLights` lights: no lights are created at runtime, no shader recompiles, no allocations.
   * Clustered (ClusteredLightContainer, lamps = downward SpotLights, neon = PointLights) when supported, else 3 plain
   * PointLights on the same pool logic.
   */
  _createLocalLights() {
    const scene = this.scene;
    const L = this.profile.lighting || {};
    const raw = [];
    for (const a of this.world.neonAnchors || []) if (a?.position) raw.push({ a, lamp: false });
    for (const a of this.world.lampAnchors || []) if (a?.position) raw.push({ a, lamp: true });
    const neonGain = this._gainFor(raw, false, NEON_REF);
    const lampGain = this._gainFor(raw, true, LAMP_REF);
    this._anchors = raw.map((e, i) => {
      const lamp = e.lamp, a = e.a;
      const base = Math.max(0, a.intensity ?? 1) * (lamp ? lampGain : neonGain);
      return {
        position: a.position.clone(), color: a.color ? a.color.clone() : new Color3(1, 1, 1),
        range: a.range ?? (lamp ? 14 : 9), lamp, base, weight: Math.max(0.2, base / (lamp ? LAMP_REF : NEON_REF)),
        flicker: clamp01(a.flicker ?? 0), phase: hash1(i + 1.37) * 10, seed: hash1(i * 7.1 + 3.3) * 100, rec: null, key: 0,
      };
    });
    this.localLights = [];
    this._pools = [];
    this._assignTimer = 0;
    this.clusteredContainer = null;
    if (!this._anchors.length) return;

    let container = null;
    if (L.clustered !== false) {
      try {
        container = new ClusteredLightContainer('strike-light-cluster', [], scene);
        if (!container.isSupported) { container.dispose(); container = null; }
      } catch (err) {
        console.warn('[LightingDirector] clustered lighting unavailable', err);
        container = null;
      }
    }
    const lamps = this._anchors.filter(a => a.lamp), neons = this._anchors.filter(a => !a.lamp);
    if (container) {
      container.maxRange = L.maxRange || (this.tier === 'MOBILE' ? 16 : 24);
      if (this.tier === 'MOBILE') { container.horizontalTiles = 32; container.verticalTiles = 16; }
      const cap = Math.max(1, L.maxNeonLights ?? 24);
      const total = this._anchors.length;
      let lampSlots = Math.min(lamps.length, Math.max(lamps.length ? 1 : 0, Math.round(cap * lamps.length / total)));
      const neonSlots = Math.min(neons.length, cap - lampSlots);
      lampSlots = Math.min(lamps.length, cap - neonSlots);
      this._makePool(neons, neonSlots, false, container);
      this._makePool(lamps, lampSlots, true, container);
      this.clusteredContainer = container;
    } else {
      // No clustering: every plain light is a shader loop iteration on every pixel — 3 point lights, nearest first.
      this._makePool(this._anchors, Math.min(3, this._anchors.length), false, null);
    }
    const sp = this.world.spawn?.position;
    this._assignLights(sp ? sp.x : 0, sp ? sp.z : 0, true);
  }

  _makePool(anchors, slots, spot, container) {
    if (!slots) return;
    const recs = [];
    for (let i = 0; i < slots; i++) {
      const id = this.localLights.length;
      const light = spot
        // Downward cone: pools of light on the pavement, no light wasted on the sky.
        ? new SpotLight(`strike-lamp-${id}`, new Vector3(0, -1000, 0), new Vector3(0, -1, 0), 115 * DEG, 1.4, this.scene)
        : new PointLight(`strike-neon-${id}`, new Vector3(0, -1000, 0), this.scene);
      light.radius = spot ? 0.15 : 0.3; // tube-ish neon: broader, softer highlights streaking on wet asphalt
      light.intensity = 0;
      light.shadowEnabled = false;
      if (container) {
        if (!ClusteredLightContainer.IsLightSupported(light)) { light.dispose(); continue; }
        container.addLight(light);
      }
      const rec = { light, anchor: null, fade: 0 };
      recs.push(rec);
      this.localLights.push(rec);
    }
    const order = anchors.map((_, i) => i);
    const keys = new Float32Array(anchors.length);
    this._pools.push({ anchors, recs, order, keys, cmp: (a, b) => keys[a] - keys[b], static: anchors.length <= recs.length });
  }

  /** Point every pool light at the nearest / brightest anchors around (x, z). `instant` skips the fade-in. */
  _assignLights(x, z, instant) {
    for (let p = 0; p < this._pools.length; p++) {
      const pool = this._pools[p];
      const { anchors, recs, order, keys } = pool;
      if (pool.static && !instant) continue;
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        const dx = a.position.x - x, dz = a.position.z - z;
        // Hysteresis (currently lit anchors win ties) avoids lights ping-ponging between two equidistant anchors.
        keys[i] = (dx * dx + dz * dz) / a.weight * (a.rec ? 0.7 : 1);
      }
      order.sort(pool.cmp);
      const n = Math.min(recs.length, anchors.length);
      for (let i = 0; i < anchors.length; i++) anchors[i].key = 0;
      for (let i = 0; i < n; i++) anchors[order[i]].key = 1;
      // Release lights whose anchor fell out of the selection.
      for (let r = 0; r < recs.length; r++) {
        const rec = recs[r];
        if (rec.anchor && !rec.anchor.key) { rec.anchor.rec = null; rec.anchor = null; }
      }
      // Give free lights to newly selected anchors.
      let r = 0;
      for (let i = 0; i < n; i++) {
        const a = anchors[order[i]];
        if (a.rec) continue;
        while (r < recs.length && recs[r].anchor) r++;
        if (r >= recs.length) break;
        const rec = recs[r];
        rec.anchor = a;
        a.rec = rec;
        rec.fade = instant ? 1 : 0;
        const l = rec.light;
        l.position.copyFrom(a.position);
        l.diffuse.copyFrom(a.color);
        l.specular.copyFrom(a.color);
        l.range = a.range;
      }
      for (let k = 0; k < recs.length; k++) if (!recs[k].anchor) recs[k].light.intensity = 0;
    }
  }

  /** Per-frame light intensities: preset scale × fade-in × cheap flicker (buzz + rare dropouts). */
  _updateLocalLights(dt, t) {
    const lights = this.localLights;
    for (let i = 0; i < lights.length; i++) {
      const rec = lights[i];
      const a = rec.anchor;
      if (!a) continue;
      const k = a.lamp ? this._lampScale : this._neonLightScale;
      if (rec.fade < 1) rec.fade = Math.min(1, rec.fade + dt * 3);
      let v = rec.fade;
      if (a.flicker > 0 && k > 0) {
        const buzz = 0.5 + 0.5 * Math.sin(t * (29 + a.phase * 3) + a.phase * 10);
        v *= 1 - a.flicker * 0.16 * buzz;
        const slot = Math.floor(t * 8 + a.phase * 13);
        if (hash1(slot + a.seed) < 0.06 * a.flicker) v *= 0.12 + 0.3 * hash1(slot * 1.7 + a.seed);
      }
      rec.light.intensity = a.base * k * v;
    }
  }

  _gainFor(entries, lamp, ref) {
    if (this.world.lightUnits === 'pbr') return 1;
    const v = [];
    for (const e of entries) if (e.lamp === lamp) v.push(Math.max(1e-3, e.a.intensity ?? 1));
    if (!v.length) return 1;
    v.sort((a, b) => a - b);
    const median = v[v.length >> 1];
    return Math.min(40, Math.max(0.05, ref / median));
  }

  /**
   * Clustered point/spot lights are culled per tile at their `range`; with Babylon's default un-windowed inverse-square
   * falloff that cut is visible as blocky tile seams. The glTF / UE4-style windowed inverse square fades to exactly 0
   * at `range`, so every PBR material (existing ones now, later ones on creation) uses it.
   */
  _enforceWindowedFalloff() {
    const set = m => { if (m && 'useGLTFLightFalloff' in m && !m.useGLTFLightFalloff) m.useGLTFLightFalloff = true; };
    for (const m of this.scene.materials) set(m);
    // Fires inside the Material base constructor (before PBR defaults are assigned) → apply after it returns.
    this._matObserver = this.scene.onNewMaterialAddedObservable.add(m => { queueMicrotask(() => set(m)); });
  }

  _createEnvironment() {
    const scene = this.scene;
    const L = this.profile.lighting || {};
    const size = L.envProbeSize || 64;
    const b = this.world.bounds || { minX: -12, maxX: 12, minZ: -80, maxZ: 12 };
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    // HDR (half float), linear, mipmapped cube — PBR samples its mips by roughness.
    const probe = new ReflectionProbe('strike-env-probe', size, scene, true, true, true);
    probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    probe.position.set(cx, 2, cz);
    const tex = probe.cubeTexture;
    // RTT cubes default to lodGenerationScale 0 → PBR would always sample mip 0 (mirror reflections at any roughness).
    // Map roughness onto the box-filtered mip chain like Babylon's prefiltered .env assets do.
    tex.lodGenerationScale = 0.85;
    tex.lodGenerationOffset = 0;
    // Box-projected (parallax corrected) reflections for the street canyon: wet-road reflections line up with facades.
    const boxSize = new Vector3(Math.max(8, b.maxX - b.minX + 12), 70, Math.max(20, b.maxZ - b.minZ + 20));
    tex.boundingBoxSize = boxSize;
    tex.boundingBoxPosition = new Vector3(cx, 2, cz);
    this.probe = probe;

    // Stand-in environment while the probe renders: sampling the probe's own cube while rendering into one of its
    // faces is a WebGPU usage conflict. Same texture class/flags → identical PBR defines → no shader recompiles.
    const dummy = new RenderTargetTexture('strike-env-dummy', 4, scene, {
      generateMipMaps: true, type: tex.textureType, isCube: true, generateDepthBuffer: false, doNotChangeAspectRatio: true,
    });
    dummy.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    dummy.gammaSpace = tex.gammaSpace;
    dummy.coordinatesMode = tex.coordinatesMode;
    dummy.invertZ = tex.invertZ;
    dummy.lodGenerationScale = tex.lodGenerationScale;
    dummy.lodGenerationOffset = tex.lodGenerationOffset;
    dummy.boundingBoxSize = boxSize.clone();
    dummy.boundingBoxPosition = new Vector3(cx, 2, cz);
    this._envDummy = dummy;

    tex.onBeforeBindObservable.add(() => {
      scene._environmentTexture = dummy;
      this.sky.setProbePass(true);
      scene.resetCachedMaterial();
    });
    tex.onAfterUnbindObservable.add(() => {
      scene._environmentTexture = tex;
      this.sky.setProbePass(false);
      scene.resetCachedMaterial();
      this._probeRenders++;
    });
    scene.environmentTexture = tex;
    this._refreshProbeList();
  }

  /** Probe render list = sky + static world geometry (casters, receivers, and any frozen group-0 visual mesh). */
  _refreshProbeList() {
    const list = [this.sky.mesh];
    const seen = new Set(list);
    const add = m => {
      if (!m || seen.has(m) || m.isDisposed?.() || m.metadata?.noProbe) return;
      seen.add(m);
      list.push(m);
    };
    for (const m of this.world.shadowCasters || []) add(m);
    for (const m of this.world.shadowReceivers || []) add(m);
    for (const m of this.scene.meshes) {
      if (seen.has(m) || !m.isVisible || !m.material || m.renderingGroupId !== 0 || !m.isWorldMatrixFrozen) continue;
      if (m.metadata?.enemy || m.metadata?.sunDisc || m.metadata?.noProbe || !m.isEnabled()) continue;
      add(m);
    }
    this.probe.renderList = list;
  }

  // -------------------------------------------------------------------------------------------- presets
  /** Instant preset switch. Returns this.grade (same object, mutated). */
  apply(presetName) {
    const name = PRESETS[presetName] ? presetName : 'NIGHT_CITY';
    const P = PRESETS[name];
    const scene = this.scene;
    this.preset = name;

    // Sun / moon.
    const el = P.sun.elevation * DEG, az = P.sun.azimuth * DEG;
    this._toSun.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
    this._lightDir.copyFrom(this._toSun).scaleInPlace(-1);
    this.sun.direction = this._lightDir.clone();
    const sunLin = hexLinear(P.sun.color);
    this.sun.diffuse = sunLin.clone();
    this.sun.specular = sunLin.clone();
    this.sun.intensity = P.sun.intensity;
    this._updateLightSpaceBasis();

    // Sky fill (hemi): sky colour from above, warm ground bounce from below = cheap GI.
    this.hemi.diffuse = hexLinear(P.hemi.sky);
    this.hemi.groundColor = hexLinear(P.hemi.ground);
    this.hemi.intensity = P.hemi.intensity;

    // Fog (sRGB colour; PBR linearises it) and matching clear colour.
    scene.fogMode = FOGMODE_EXP2;
    scene.fogEnabled = true;
    scene.fogColor = hexGamma(P.fog.color);
    scene.fogDensity = P.fog.density;
    this._fogBase = P.fog.density;
    const fogLin = hexLinear(P.fog.color);
    scene.clearColor.set(fogLin.r, fogLin.g, fogLin.b, 1);

    // Sky.
    const s = P.sky;
    const glow = hexLinear(s.cityGlow).scale(s.cityGlowStrength);
    this.sky.setParams({
      sunDirection: this._toSun, sunColor: sunLin, sunIntensity: P.sun.intensity,
      zenith: hexLinear(s.zenith), horizon: hexLinear(s.horizon), ground: hexLinear(s.ground),
      horizonExponent: s.horizonExponent, skyIntensity: s.skyIntensity,
      cloudCover: s.cloudCover, cloudColor: hexLinear(s.cloudColor), cloudScale: s.cloudScale, cloudSpeed: s.cloudSpeed,
      stars: s.stars, cityGlow: glow, cityGlowFalloff: s.cityGlowFalloff, haze: s.haze, fogColor: fogLin,
      mie: s.mie, mieG: s.mieG, sunSize: s.sunSize, discIntensity: s.discIntensity,
    });
    const sunMeshOn = !!(P.godRays && this.sky.sunMesh && this._toSun.y > -0.02);
    this.sky.setSunMeshEnabled(sunMeshOn);

    // Shadows.
    this.shadowGenerator.setDarkness(P.sun.darkness);

    // Materials (MaterialLibrary handles its own unfreeze / refreeze).
    const mats = this.materials;
    mats?.setNeonScale?.(P.neon);
    mats?.setWetness?.(P.wetness);
    mats?.setWindowGlow?.(P.windowGlow);

    // Neon + lamp lights.
    this._neonLightScale = P.neonLights;
    this._lampScale = P.lamps;
    this._updateLocalLights(0, this._time);

    // Environment: intensity, analytic SH irradiance (sky + canyon + bounce), re-render the probe.
    scene.environmentIntensity = P.env.intensity;
    const poly = this._buildIrradiance(P, fogLin, glow);
    this.probe.cubeTexture.sphericalPolynomial = poly;
    this._envDummy.sphericalPolynomial = poly;
    this._refreshProbeList();
    this.probe.cubeTexture.resetRefreshCounter();
    this._probeSettle = 0.8; // re-capture once late-compiling effects are ready
    this._envTimer = 0;

    // Grade for PostFXStack.
    this._fillGrade(name, P, sunMeshOn, fogLin);

    // Frozen materials skip their UBO update (environment intensity, SH, reflection info): force one rebind.
    const skyMat = this.sky.material;
    for (const m of scene.materials) if (m !== skyMat && m.isFrozen) m.markDirty(true);

    this.onPresetChanged.notifyObservers(name);
    return this.grade;
  }

  _fillGrade(name, P, sunMeshOn, fogLin) {
    const G = this.grade, S = P.grade;
    G.preset = name;
    G.exposure = S.exposure;
    G.contrast = S.contrast;
    G.toneMapping = S.toneMapping;
    G.toneMappingType = S.toneMapping === 'NEUTRAL' ? 2 : 1; // ImageProcessingConfiguration.TONEMAPPING_*
    G.saturation = S.saturation;
    G.bloomThreshold = S.bloomThreshold;
    G.bloomWeight = S.bloomWeight;
    G.bloomScaleMul = S.bloomScaleMul;
    G.vignetteWeight = S.vignetteWeight;
    const vc = Color3.FromHexString(S.vignette);
    G.vignetteColor.set(vc.r, vc.g, vc.b, 0);
    G.chromaticAberration = S.chromaticAberration;
    G.grainIntensity = S.grainIntensity;
    G.shadowsHue = S.shadowsHue; G.shadowsSaturation = S.shadowsSaturation; G.shadowsDensity = S.shadowsDensity;
    G.midtonesHue = S.midtonesHue; G.midtonesSaturation = S.midtonesSaturation; G.midtonesDensity = S.midtonesDensity;
    G.highlightsHue = S.highlightsHue; G.highlightsSaturation = S.highlightsSaturation; G.highlightsDensity = S.highlightsDensity;
    G.godRays = !!(P.godRays && sunMeshOn && this.profile.post?.godRays);
    G.sunScreenMesh = this.getSunScreenMesh();
    G.godRaysWeight = S.godRaysWeight || 0;
    G.godRaysDecay = S.godRaysDecay || 0.96;
    G.ssaoStrength = S.ssaoStrength;
    G.ssrStrength = S.ssrStrength;
    G.exposureBreathing = S.exposureBreathing || 0;
    G.fogColor.copyFrom(fogLin);
  }

  /**
   * Analytic diffuse irradiance (SH) for the preset: sky dome + street-canyon facades + warm ground bounce + city glow.
   * Built on the CPU from 192 Fibonacci directions (~0.1 ms) instead of reading the probe back from the GPU.
   * Directions are world-space (verified in the harness: red sky / green ground → red top, green bottom).
   */
  _buildIrradiance(P, fogLin, glow) {
    const s = P.sky, e = P.env;
    const zen = hexLinear(s.zenith).scale(s.skyIntensity), hor = hexLinear(s.horizon).scale(s.skyIntensity);
    const gnd = hexLinear(e.ground), facade = hexLinear(e.facade), cloud = hexLinear(s.cloudColor).scale(s.skyIntensity);
    const sunLin = hexLinear(P.sun.color);
    const sunDir = this._toSun;
    const sunI = P.sun.intensity;
    const sh = new SphericalHarmonics();
    const N = 192;
    const dSolid = (4 * Math.PI) / N;
    const dir = new Vector3();
    const c = new Color3();
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (2 * (i + 0.5)) / N;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = i * golden;
      dir.set(Math.cos(phi) * r, y, Math.sin(phi) * r);
      const hp = Math.max(0, y);
      if (y >= 0) {
        const t = Math.pow(1 - hp, s.horizonExponent);
        c.r = zen.r + (hor.r - zen.r) * t; c.g = zen.g + (hor.g - zen.g) * t; c.b = zen.b + (hor.b - zen.b) * t;
        const cg = Math.exp(-hp * s.cityGlowFalloff);
        c.r += glow.r * cg; c.g += glow.g * cg; c.b += glow.b * cg;
        const cov = s.cloudCover * 0.75;
        c.r += (cloud.r - c.r) * cov; c.g += (cloud.g - c.g) * cov; c.b += (cloud.b - c.b) * cov;
        const hz = clamp01(s.haze * Math.exp(-hp * 6.5));
        c.r += (fogLin.r - c.r) * hz; c.g += (fogLin.g - c.g) * hz; c.b += (fogLin.b - c.b) * hz;
        // Broad forward scatter around the sun (the disc itself is the analytic directional light).
        const mu = Math.max(0, dir.x * sunDir.x + dir.y * sunDir.y + dir.z * sunDir.z);
        const sc = s.mie * 0.25 * (sunI / Math.PI) * Math.pow(mu, 4) * (1 - 0.6 * s.cloudCover);
        c.r += sunLin.r * sc; c.g += sunLin.g * sc; c.b += sunLin.b * sc;
        // Street canyon: low directions see facades (lit by bounce + neon), not open sky.
        const occ = e.canyon * (1 - smooth(0.05, 0.6, y));
        c.r += (facade.r - c.r) * occ; c.g += (facade.g - c.g) * occ; c.b += (facade.b - c.b) * occ;
      } else {
        // Ground bounce: albedo-tinted sunlight + skylight reflected from the street (warm fake GI).
        const lit = Math.max(0, sunDir.y) * sunI * (1 - P.sun.darkness * 0.5) * 0.18 + 0.2;
        c.r = gnd.r * lit; c.g = gnd.g * lit; c.b = gnd.b * lit;
        const t = 1 - smooth(-0.3, 0, y);
        c.r = facade.r + (c.r - facade.r) * t; c.g = facade.g + (c.g - facade.g) * t; c.b = facade.b + (c.b - facade.b) * t;
      }
      c.scaleInPlace(e.shScale);
      sh.addLight(dir, c, dSolid);
    }
    sh.convertIncidentRadianceToIrradiance();
    sh.convertIrradianceToLambertianRadiance();
    return SphericalPolynomial.FromHarmonics(sh);
  }

  // -------------------------------------------------------------------------------------------- shadows (MOBILE fit)
  _updateLightSpaceBasis() {
    // Same basis as Matrix.LookAtLH(eye, eye + dir, up) used by ShadowGenerator → snapping aligns with texels.
    const f = this._lightDir;
    Vector3.CrossToRef(UP, f, this._lsRight);
    if (this._lsRight.lengthSquared() < 1e-8) this._lsRight.set(1, 0, 0);
    this._lsRight.normalize();
    Vector3.CrossToRef(f, this._lsRight, this._lsUp);
    this._lsUp.normalize();
    if (this._fitted) {
      // Casters up to ~45 m tall must sit inside the depth range even with a low sun; receivers far down-light too.
      const sinEl = Math.max(0.12, this._toSun.y);
      this._shadowBack = Math.min(160, 12 + 45 / sinEl);
      const maxZ = this._shadowBack + Math.min(200, this._frustumSize * 0.5 / sinEl + 20);
      if (this.sun.shadowMaxZ !== maxZ) this.sun.shadowMaxZ = maxZ;
      // Constant ~5 cm world bias whatever the depth range.
      this.shadowGenerator.bias = 0.05 / maxZ;
    }
  }

  _placeSunForShadow() {
    const cam = this.camera;
    if (!cam) return;
    const p = cam.globalPosition;
    const fwd = this._tmpFwd;
    cam.getDirectionToRef(AXIS_Z, fwd);
    fwd.y = 0;
    const len = Math.sqrt(fwd.x * fwd.x + fwd.z * fwd.z);
    if (len > 1e-4) fwd.scaleInPlace(this._focusAhead / len); else fwd.set(0, 0, 0);
    const F = this._tmpFocus;
    F.set(p.x + fwd.x, p.y - 1.4, p.z + fwd.z);
    const r = this._lsRight, u = this._lsUp, f = this._lightDir, texel = this._texel;
    const x = Math.round((F.x * r.x + F.y * r.y + F.z * r.z) / texel) * texel;
    const y = Math.round((F.x * u.x + F.y * u.y + F.z * u.z) / texel) * texel;
    // Depth along the light does not move the projected shadows: snap it coarsely so the view matrix is only rebuilt
    // when the player crosses a texel (or a 1 m depth step), not every frame.
    const z = Math.round(F.x * f.x + F.y * f.y + F.z * f.z) - this._shadowBack;
    this.sun.position.set(r.x * x + u.x * y + f.x * z, r.y * x + u.y * y + f.y * z, r.z * x + u.z * y + f.z * z);
  }

  /** Adds a (dynamic) caster to the sun shadow map. */
  addShadowCaster(mesh, includeDescendants = true) {
    if (!mesh) return;
    this.shadowGenerator.addShadowCaster(mesh, includeDescendants);
    const sg = this.shadowGenerator;
    if (sg instanceof CascadedShadowGenerator && sg.freezeShadowCastersBoundingInfo) sg.freezeShadowCastersBoundingInfo = true;
  }

  // -------------------------------------------------------------------------------------------- per frame
  update(dt) {
    const t = (this._time += dt);
    this.sky.update(dt);

    // Light pool: re-target the nearest anchors a few times per second, then intensities (fade-in + flicker).
    if (this._pools.length) {
      this._assignTimer -= dt;
      if (this._assignTimer <= 0 && this.camera) {
        this._assignTimer = 0.4;
        const p = this.camera.globalPosition;
        this._assignLights(p.x, p.z, false);
      }
      this._updateLocalLights(dt, t);
    }

    // Slow haze breathing (steam / smog drifting through the street).
    if (this._fogBase > 0) {
      this.scene.fogDensity = this._fogBase * (1 + 0.05 * Math.sin(t * 0.21) + 0.03 * Math.sin(t * 0.57 + 1.3));
    }

    // Environment probe: one settle re-capture after a preset change, optional periodic refresh.
    if (this._probeSettle > 0) {
      this._probeSettle -= dt;
      if (this._probeSettle <= 0) this.probe.cubeTexture.resetRefreshCounter();
    }
    if (this._envRefresh > 0) {
      this._envTimer += dt;
      if (this._envTimer >= this._envRefresh) {
        this._envTimer = 0;
        this.probe.cubeTexture.resetRefreshCounter();
      }
    }
  }

  /** ≥2 on MOBILE / MEDIUM: shadow map refreshes every other frame. */
  setShedLevel(level) {
    this._shed = level | 0;
    const low = this.tier === 'MOBILE' || this.tier === 'MEDIUM';
    const map = this.shadowGenerator.getShadowMap();
    if (map) map.refreshRate = this._shed >= 2 && low ? 2 : 1;
  }

  /** God-ray source disc for GOLDEN_HOUR / DAYLIGHT (null for NIGHT_CITY / OVERCAST or when the profile has no god rays). */
  getSunScreenMesh() {
    const m = this.sky.sunMesh;
    const P = PRESETS[this.preset];
    return m && P?.godRays && m.isEnabled() ? m : null;
  }

  /** Diagnostics. */
  describe() {
    return {
      preset: this.preset,
      shadows: this._shadowDesc,
      localLights: this.localLights.length,
      anchors: this._anchors.length,
      clustered: !!this.clusteredContainer,
      probe: this.probe.cubeTexture.getSize().width,
      probeRenders: this._probeRenders,
    };
  }

  dispose() {
    this.onPresetChanged.clear();
    this.scene.onNewMaterialAddedObservable.remove(this._matObserver);
    if (this.scene.environmentTexture === this.probe.cubeTexture) this.scene.environmentTexture = null;
    this.probe.dispose();
    this._envDummy.dispose();
    this.shadowGenerator.dispose();
    if (this.clusteredContainer) this.clusteredContainer.dispose();
    else for (const rec of this.localLights) rec.light.dispose();
    this.sun.dispose();
    this.hemi.dispose();
    this.sky.dispose();
  }
}

function smooth(a, b, v) {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}
