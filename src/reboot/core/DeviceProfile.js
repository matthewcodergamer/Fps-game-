// Device / GPU detection → one immutable-ish render profile per boot.
//
// Platform (controls + FOV) and tier (feature budget) are separate decisions:
//   platform: 'mobile' when the device is touch-first (phones, iPads, Android tablets), else 'desktop'.
//   tier:     phones start at MOBILE (the iPhone 11 floor, the PerformanceGovernor raises resolution when there is
//             headroom), tablets / weak desktops MEDIUM, desktops HIGH, ULTRA when opted in (or ≥12 cores + real GPU).
// Software adapters (SwiftShader/llvmpipe/lavapipe, CI) keep the tier feature set but clamp the pixel ratio.

const TIERS = ['MOBILE', 'MEDIUM', 'HIGH', 'ULTRA'];
const ADAPTER_CACHE_KEY = '__PROJECT_STRIKE_GPU_ADAPTER__';
const SOFTWARE_RE = /swiftshader|llvmpipe|lavapipe|software|basic render|warp/i;

const num = (v, fallback = 0) => (Number.isFinite(+v) && +v > 0 ? +v : fallback);
const media = query => {
  try { return typeof matchMedia === 'function' && matchMedia(query).matches; } catch { return false; }
};

/**
 * Synchronous user-agent / screen / input traits. Shared with Settings.js (FOV default before the async profile exists).
 * Safe in non-browser environments (returns desktop-ish neutral traits).
 */
export function readDeviceTraits() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const scr = typeof screen !== 'undefined' ? screen : {};
  const ua = String(nav.userAgent || '');
  const uaData = nav.userAgentData || null;
  const uaPlatform = String(uaData?.platform || nav.platform || '');
  const touchPoints = num(nav.maxTouchPoints, 0);
  const dpr = num(typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1, 1);
  const sw = num(scr.width, 0), sh = num(scr.height, 0);
  const shortSide = Math.min(sw, sh), longSide = Math.max(sw, sh);

  const coarse = media('(pointer:coarse)');
  const anyFine = media('(any-pointer:fine)');
  const hoverNone = media('(hover:none)');
  const hasTouch = touchPoints > 0 || (typeof window !== 'undefined' && 'ontouchstart' in window);
  const touchFirst = coarse || (hasTouch && hoverNone && !anyFine);

  // iPadOS 13+ Safari reports a Macintosh UA; the only tell is multi-touch. iPhones in "Request Desktop Website" mode
  // look the same, so separate them by the (portrait-logical) screen size.
  const macTouch = /Macintosh/.test(ua) && touchPoints > 1;
  const isIPhone = /iPhone|iPod/.test(ua) || (macTouch && shortSide > 0 && shortSide < 600);
  const isIPad = !isIPhone && (/iPad/.test(ua) || macTouch);
  const isiOS = isIPhone || isIPad;
  const isAndroid = /Android/i.test(ua);
  const isMac = !isiOS && /Macintosh|Mac OS X|macOS/i.test(ua + ' ' + uaPlatform);
  const isWindows = /Windows/i.test(ua + ' ' + uaPlatform);
  const isCrOS = /CrOS|Chrome OS|ChromeOS/i.test(ua + ' ' + uaPlatform);
  const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Android/.test(ua);

  const phone = isIPhone
    || (isAndroid && /Mobile/.test(ua))
    || uaData?.mobile === true
    || (touchFirst && shortSide > 0 && shortSide < 600 && !isIPad);
  const tablet = !phone && (isIPad || isAndroid || (touchFirst && !anyFine));
  const touchDevice = phone || tablet || touchFirst;

  const device = isIPhone ? 'iphone' : isIPad ? 'ipad' : isAndroid ? (phone ? 'android-phone' : 'android-tablet')
    : phone ? 'phone' : tablet ? 'tablet' : isMac ? 'mac' : isWindows ? 'windows' : isCrOS ? 'chromeos'
    : /Linux/i.test(ua + ' ' + uaPlatform) ? 'linux' : 'desktop';

  return {
    ua, device, dpr, shortSide, longSide, touchPoints, hasTouch, touchFirst, coarse, anyFine,
    isiOS, isIPhone, isIPad, isAndroid, isMac, isWindows, isCrOS, isSafari, phone, tablet, touchDevice,
    // Safari never exposes deviceMemory; WebKit also caps/rounds hardwareConcurrency. 0 = unknown.
    memory: num(nav.deviceMemory, 0),
    cores: num(nav.hardwareConcurrency, 0),
    autoPlatform: touchDevice ? 'mobile' : 'desktop',
  };
}

/** 'auto' | 'mobile' | 'desktop' (+ traits) → concrete platform. */
export function resolvePlatform(requested, traits = readDeviceTraits()) {
  return requested === 'mobile' || requested === 'desktop' ? requested : traits.autoPlatform;
}

function withTimeout(promise, ms) {
  let timer = 0;
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(withTimeout.TIMEOUT), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
withTimeout.TIMEOUT = Symbol('timeout');

let adapterTimedOut = false;

/**
 * Requests the WebGPU adapter once per page and caches the promise on window so other code (diagnostics, a future
 * engine path) can reuse it. Resolves to GPUAdapter | null, never rejects.
 */
export function requestStrikeAdapter() {
  const host = typeof window !== 'undefined' ? window : globalThis;
  if (host[ADAPTER_CACHE_KEY]) return host[ADAPTER_CACHE_KEY];
  const gpu = typeof navigator !== 'undefined' ? navigator.gpu : undefined;
  const promise = (async () => {
    if (!gpu || typeof gpu.requestAdapter !== 'function') return null;
    try {
      let adapter = await withTimeout(gpu.requestAdapter({ powerPreference: 'high-performance' }), 6000);
      if (adapter === withTimeout.TIMEOUT) { adapterTimedOut = true; return null; }
      if (!adapter) {
        adapter = await withTimeout(gpu.requestAdapter(), 4000);
        if (adapter === withTimeout.TIMEOUT) { adapterTimedOut = true; return null; }
      }
      return adapter || null;
    } catch (error) {
      console.warn('[DeviceProfile] requestAdapter failed', error);
      return null;
    }
  })();
  host[ADAPTER_CACHE_KEY] = promise;
  return promise;
}

async function readAdapterInfo(adapter) {
  const out = { vendor: '', architecture: '', description: '', device: '', isFallbackAdapter: false };
  if (!adapter) return out;
  let info = adapter.info || null;
  if (!info && typeof adapter.requestAdapterInfo === 'function') {
    try { info = await withTimeout(adapter.requestAdapterInfo(), 1500); } catch { info = null; }
    if (info === withTimeout.TIMEOUT) info = null;
  }
  out.vendor = String(info?.vendor || '');
  out.architecture = String(info?.architecture || '');
  out.description = String(info?.description || '');
  out.device = String(info?.device || '');
  out.isFallbackAdapter = Boolean(info?.isFallbackAdapter ?? adapter.isFallbackAdapter ?? false);
  return out;
}

/** Coarse GPU class from adapter.info strings (Chrome fills vendor/architecture; Safari often leaves them empty). */
function classifyGpu(info) {
  const s = `${info.vendor} ${info.architecture} ${info.description} ${info.device}`.toLowerCase();
  const software = info.isFallbackAdapter || SOFTWARE_RE.test(s);
  const intel = /intel/.test(s);
  const intelDiscrete = intel && /\barc\b|xe-hpg|xe2-hpg|gen-12hp|dg2|alchemist|battlemage/.test(s);
  const vendor = info.vendor.toLowerCase();
  const mobileGpu = vendor === 'arm' || vendor === 'qualcomm' || vendor === 'img-tec' || /adreno|mali|powervr|imagination/.test(s);
  const discrete = intelDiscrete || /nvidia|geforce|quadro|rtx|gtx|radeon|\bamd\b|\bati\b/.test(s);
  const apple = /apple/.test(s);
  return { software, integratedLow: intel && !intelDiscrete, mobileGpu, discrete, apple, known: s.trim().length > 0 };
}

function autoTier(t, platform, gpu) {
  if (t.phone) return 'MOBILE';                              // every phone starts on the iPhone 11 floor
  if (t.tablet) return (t.memory && t.memory <= 3) || (t.isAndroid && t.cores && t.cores <= 4) ? 'MOBILE' : 'MEDIUM';
  if (platform === 'mobile') return 'MOBILE';                // "iPhone mode" forced on a desktop emulates the floor
  // Desktop. Safari hides deviceMemory and caps hardwareConcurrency: neither may push a Mac below MEDIUM.
  if (!t.isMac && ((t.memory && t.memory <= 2) || (t.cores && t.cores <= 2))) return 'MOBILE';
  const weakMem = t.memory && t.memory <= 4;
  const lowCores = !t.isMac && t.cores && t.cores <= 4;
  if (gpu.integratedLow || gpu.mobileGpu || weakMem || lowCores || t.isCrOS) return 'MEDIUM';
  if (!gpu.software && t.cores >= 12 && (!t.memory || t.memory >= 8) && (gpu.discrete || gpu.apple)) return 'ULTRA';
  return 'HIGH';
}

// Reference budgets (SPEC "core/DeviceProfile.js"). pixelRatio is relative to CSS pixels (engine created with
// adaptToDeviceRatio:false, hardware scaling = 1/pixelRatio). maxPixels caps the governor's upscaling.
const TIER_TABLE = {
  MOBILE: {
    render: { pixelRatio: 1.0, minPixelRatio: 0.7, maxPixelRatio: 1.3, msaa: 1, targetFps: 60, maxPixels: 0.8e6 },
    shadows: { size: 1024, cascades: 1, distance: 35, filter: 'pcf-low', contactHardening: false },
    post: { hdr: true, bloomScale: 0.5, bloomKernel: 48, fxaa: true, sharpen: false, chromaticAberration: true, grain: true,
      ssao: false, ssr: false, motionBlur: false, godRays: false, glow: false },
    lighting: { clustered: true, maxNeonLights: 24, envProbeSize: 64, envRefreshSeconds: 0 },
    textures: { size: 512, anisotropy: 4 },
    vfx: { particles: 0.5, maxDecals: 24, maxTracers: 8, maxShells: 8 },
    ai: { enemies: 3 },
    world: { skylineDensity: 0.5, propDensity: 0.7 },
  },
  MEDIUM: {
    render: { pixelRatio: 1.25, minPixelRatio: 0.75, maxPixelRatio: 1.5, msaa: 1, targetFps: 60, maxPixels: 2.4e6 },
    shadows: { size: 2048, cascades: 2, distance: 55, filter: 'pcf-medium', contactHardening: false },
    post: { hdr: true, bloomScale: 0.5, bloomKernel: 64, fxaa: true, sharpen: false, chromaticAberration: true, grain: true,
      ssao: { samples: 8, ratio: 0.5 }, ssr: false, motionBlur: false, godRays: false, glow: false },
    lighting: { clustered: true, maxNeonLights: 40, envProbeSize: 128, envRefreshSeconds: 0 },
    textures: { size: 512, anisotropy: 8 },
    vfx: { particles: 0.75, maxDecals: 40, maxTracers: 12, maxShells: 12 },
    ai: { enemies: 4 },
    world: { skylineDensity: 0.75, propDensity: 0.85 },
  },
  HIGH: {
    render: { pixelRatio: 1.5, minPixelRatio: 0.8, maxPixelRatio: 2, msaa: 4, targetFps: 60, maxPixels: 4.2e6 },
    shadows: { size: 2048, cascades: 3, distance: 80, filter: 'pcf-high', contactHardening: false },
    post: { hdr: true, bloomScale: 0.6, bloomKernel: 96, fxaa: false, sharpen: true, chromaticAberration: true, grain: true,
      ssao: { samples: 16, ratio: 0.5 }, ssr: false, motionBlur: { samples: 16, strength: 0.6 },
      godRays: { ratio: 0.5, samples: 60 }, glow: false },
    lighting: { clustered: true, maxNeonLights: 64, envProbeSize: 256, envRefreshSeconds: 0 },
    textures: { size: 1024, anisotropy: 8 },
    vfx: { particles: 1, maxDecals: 64, maxTracers: 16, maxShells: 16 },
    ai: { enemies: 4 },
    world: { skylineDensity: 0.85, propDensity: 1 },
  },
  ULTRA: {
    render: { pixelRatio: 2, minPixelRatio: 1, maxPixelRatio: 2, msaa: 4, targetFps: 60, maxPixels: 8.8e6 },
    shadows: { size: 4096, cascades: 4, distance: 110, filter: 'pcf-high', contactHardening: true },
    post: { hdr: true, bloomScale: 0.75, bloomKernel: 128, fxaa: false, sharpen: true, chromaticAberration: true, grain: true,
      ssao: { samples: 32, ratio: 0.75 }, ssr: { ratio: 0.5, step: 1, maxSteps: 120 }, motionBlur: { samples: 32, strength: 0.8 },
      godRays: { ratio: 0.6, samples: 100 }, glow: false },
    lighting: { clustered: true, maxNeonLights: 96, envProbeSize: 256, envRefreshSeconds: 0 },
    textures: { size: 1024, anisotropy: 16 },
    vfx: { particles: 1, maxDecals: 96, maxTracers: 24, maxShells: 24 },
    ai: { enemies: 5 },
    world: { skylineDensity: 1, propDensity: 1 },
  },
};

const round2 = v => Math.round(v * 100) / 100;
const cloneSection = section => {
  const out = {};
  for (const key in section) { const v = section[key]; out[key] = v && typeof v === 'object' ? { ...v } : v; }
  return out;
};

function buildRender(tier, t, platform, softwareGpu) {
  const base = TIER_TABLE[tier].render;
  const dpr = t.dpr || 1;
  // Screen area is a proxy for a fullscreen canvas; the budget stops 4K/5K panels from asking for 16M-pixel frames.
  const cssPixels = t.shortSide > 0 ? t.shortSide * t.longSide : 1920 * 1080 / (dpr * dpr);
  const budgetRatio = Math.sqrt(base.maxPixels / Math.max(1, cssPixels));
  // Supersampling past the panel density is wasted heat on phones; desktops may go 1.5x beyond native (cheap SSAA).
  const densityCap = platform === 'mobile' || tier === 'MOBILE' ? Math.max(1, dpr) : Math.max(1, dpr) * 1.5;
  let max = Math.min(base.maxPixelRatio, densityCap, Math.max(budgetRatio, base.minPixelRatio));
  let pixelRatio = tier === 'MOBILE' ? Math.min(base.pixelRatio, Math.max(1, dpr)) : Math.min(dpr, base.pixelRatio);
  pixelRatio = Math.max(Math.min(pixelRatio, max), Math.min(base.minPixelRatio, max));
  let min = Math.min(base.minPixelRatio, pixelRatio);
  if (softwareGpu) {
    // CI / SwiftShader: bootable, not pretty.
    pixelRatio = Math.min(pixelRatio, 0.75);
    max = Math.min(max, 0.75);
    min = Math.min(min, 0.5, pixelRatio);
  }
  return {
    pixelRatio: round2(pixelRatio), minPixelRatio: round2(min), maxPixelRatio: round2(Math.max(max, pixelRatio)),
    msaa: base.msaa, targetFps: base.targetFps, dpr: round2(dpr), maxPixels: base.maxPixels,
  };
}

/**
 * Detects platform + tier and returns the full render profile (shape: SPEC "core/DeviceProfile.js").
 * Never throws; `webgpu:false` when navigator.gpu is missing or no adapter exists.
 * @param {object} [settings] result of loadSettings() — honours settings.platform ('auto'|'mobile'|'desktop') and
 *                            settings.quality ('AUTO'|tier).
 */
export async function detectDeviceProfile(settings = {}) {
  const t = readDeviceTraits();
  const hasGpuApi = typeof navigator !== 'undefined' && !!navigator.gpu;
  const adapter = hasGpuApi ? await requestStrikeAdapter() : null;
  const adapterInfo = await readAdapterInfo(adapter);
  const gpu = classifyGpu(adapterInfo);
  // A timed-out request is "unknown", not "absent": let the engine try (it throws the proper error if it must).
  const webgpu = hasGpuApi && (!!adapter || adapterTimedOut);

  const platform = resolvePlatform(settings?.platform, t);
  const requested = String(settings?.quality || 'AUTO').toUpperCase();
  const tier = TIERS.includes(requested) ? requested : autoTier(t, platform, gpu);
  const table = TIER_TABLE[tier];

  const profile = {
    platform,
    tier,
    tierSource: TIERS.includes(requested) ? 'settings' : 'auto',
    webgpu,
    isiOS: t.isiOS,
    isAndroid: t.isAndroid,
    iphone11Class: t.isIPhone || (t.phone && t.shortSide > 0 && t.shortSide <= 430),
    device: t.device,
    touch: platform === 'mobile' || t.touchFirst,
    memory: t.memory,
    cores: t.cores,
    softwareGpu: gpu.software,
    adapterInfo,
    render: buildRender(tier, t, platform, gpu.software),
    shadows: cloneSection(table.shadows),
    post: cloneSection(table.post),
    lighting: cloneSection(table.lighting),
    textures: cloneSection(table.textures),
    vfx: cloneSection(table.vfx),
    ai: cloneSection(table.ai),
    world: cloneSection(table.world),
  };
  return profile;
}

/** Short one-line summary for the diagnostics overlay / console. */
export function describeProfile(profile) {
  if (!profile) return 'profile: n/a';
  const r = profile.render || {};
  const s = profile.shadows || {};
  const info = profile.adapterInfo || {};
  const gpuName = [info.vendor, info.architecture].filter(Boolean).join('/') || (profile.webgpu ? 'gpu?' : 'no-webgpu');
  const hw = `${profile.cores || '?'}c/${profile.memory ? profile.memory + 'GB' : '?GB'}`;
  const shadow = s.cascades > 1 ? `CSM${s.cascades}×${s.size}` : `SM${s.size || 0}`;
  const ratio = Number.isFinite(r.pixelRatio) ? r.pixelRatio.toFixed(2) : '?';
  const range = Number.isFinite(r.minPixelRatio) ? ` [${r.minPixelRatio.toFixed(2)}–${r.maxPixelRatio.toFixed(2)}]` : '';
  return `${profile.platform}/${profile.tier} · ${profile.device || '?'} · ${ratio}x${range} · MSAA${r.msaa || 1} · ${shadow} · ${gpuName}${profile.softwareGpu ? ' (SW)' : ''} · ${hw}`;
}
