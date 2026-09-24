// Player settings: defaults < localStorage < window.__PROJECT_STRIKE_PLATFORM__ (desktop.html) < URL params.
// Every layer is validated per key; anything unknown/invalid is ignored so the next-lower layer (ultimately the
// default) wins. Values forced by desktop.html / the URL are remembered so saveSettings() does not persist them.

import { readDeviceTraits, resolvePlatform } from './DeviceProfile.js';

export { describeProfile } from './DeviceProfile.js';

export const LIGHTING_PRESETS = ['NIGHT_CITY', 'GOLDEN_HOUR', 'DAYLIGHT', 'OVERCAST'];
export const CAMERA_MODES = ['STANDARD', 'BODYCAM'];
export const QUALITY_TIERS = ['AUTO', 'MOBILE', 'MEDIUM', 'HIGH', 'ULTRA'];
export const PLATFORMS = ['auto', 'mobile', 'desktop'];
export const SETTINGS_STORAGE_KEY = 'project-strike-settings-v11';
export const FOV_DEFAULTS = { mobile: 74, desktop: 80, unknown: 78 };

const PERSIST_KEYS = ['platform', 'quality', 'lighting', 'camera', 'sensitivity', 'adsSensitivity', 'fov', 'invertY', 'showDiagnostics'];

const token = v => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
const upperKey = v => token(v).toUpperCase().replace(/[\s-]+/g, '_');
const finiteIn = (v, min, max) => {
  if (typeof v === 'boolean' || v === null || v === '' || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};
const bool = v => {
  if (typeof v === 'boolean') return v;
  const s = token(v).toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
  return undefined;
};

const PLATFORM_ALIASES = {
  auto: 'auto', mobile: 'mobile', iphone: 'mobile', ios: 'mobile', phone: 'mobile', touch: 'mobile', android: 'mobile', ipad: 'mobile', tablet: 'mobile',
  desktop: 'desktop', pc: 'desktop', mac: 'desktop', keyboard: 'desktop', kbm: 'desktop',
};
const QUALITY_ALIASES = { LOW: 'MOBILE', PHONE: 'MOBILE', IPHONE: 'MOBILE', MED: 'MEDIUM', MID: 'MEDIUM', EPIC: 'ULTRA', MAX: 'ULTRA' };
const LIGHTING_ALIASES = {
  NIGHT: 'NIGHT_CITY', NIGHTCITY: 'NIGHT_CITY', CYBERPUNK: 'NIGHT_CITY', NEON: 'NIGHT_CITY',
  GOLDEN: 'GOLDEN_HOUR', GOLDENHOUR: 'GOLDEN_HOUR', SUNSET: 'GOLDEN_HOUR', DUSK: 'GOLDEN_HOUR',
  DAY: 'DAYLIGHT', NOON: 'DAYLIGHT', SUNNY: 'DAYLIGHT', HIGH_NOON: 'DAYLIGHT',
  CLOUDY: 'OVERCAST', GREY: 'OVERCAST', GRAY: 'OVERCAST',
};
const CAMERA_ALIASES = { BODY: 'BODYCAM', BODY_CAM: 'BODYCAM', CHEST: 'BODYCAM', STD: 'STANDARD', NORMAL: 'STANDARD', FPS: 'STANDARD' };

/** Per-key validators: return the canonical value, or undefined when the input is unusable. */
export const SETTING_VALIDATORS = {
  platform: v => PLATFORM_ALIASES[token(v).toLowerCase()],
  quality: v => { const k = upperKey(v); const q = QUALITY_ALIASES[k] || k; return QUALITY_TIERS.includes(q) ? q : undefined; },
  lighting: v => { const k = upperKey(v); const p = LIGHTING_ALIASES[k] || k; return LIGHTING_PRESETS.includes(p) ? p : undefined; },
  camera: v => { const k = upperKey(v); const c = CAMERA_ALIASES[k] || k; return CAMERA_MODES.includes(c) ? c : undefined; },
  sensitivity: v => finiteIn(v, 0.05, 8),
  adsSensitivity: v => finiteIn(v, 0.1, 2),
  fov: v => finiteIn(v, 60, 110),
  invertY: bool,
  showDiagnostics: bool,
};

const forcedBySettings = new WeakMap();
let lastForced = {};

function safeTraits() {
  try { return readDeviceTraits(); } catch { return null; }
}

/** Default FOV (vertical-ish degrees) for a settings.platform value: mobile 74, desktop 80. */
export function defaultFovFor(platform, traits = safeTraits()) {
  if (platform !== 'mobile' && platform !== 'desktop' && !traits) return FOV_DEFAULTS.unknown;
  return FOV_DEFAULTS[resolvePlatform(platform, traits || { autoPlatform: 'desktop' })];
}

/** Fresh default settings (platform auto → FOV from the detected platform). */
export function defaultSettings() {
  return {
    platform: 'auto',
    quality: 'AUTO',
    lighting: 'NIGHT_CITY',
    camera: 'STANDARD',
    sensitivity: 1,
    adsSensitivity: 0.85,
    fov: defaultFovFor('auto'),
    invertY: false,
    showDiagnostics: false,
    ci: null,
  };
}

function readStored() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function applyLayer(target, layer, forced) {
  if (!layer || typeof layer !== 'object') return;
  for (const key of PERSIST_KEYS) {
    if (!(key in layer)) continue;
    const value = SETTING_VALIDATORS[key](layer[key]);
    if (value === undefined) continue;
    target[key] = value;
    if (forced) forced[key] = value;
  }
}

function readUrlLayer() {
  const layer = {};
  let ci = null;
  try {
    if (typeof location === 'undefined') return { layer, ci };
    const params = new URLSearchParams(location.search || '');
    const pick = (...names) => { for (const n of names) if (params.has(n)) return params.get(n); return undefined; };
    const map = {
      platform: pick('platform'),
      quality: pick('quality', 'q'),
      lighting: pick('lighting', 'preset'),
      camera: pick('camera', 'cam'),
      fov: pick('fov'),
      sensitivity: pick('sens', 'sensitivity'),
      invertY: pick('invertY', 'invert'),
      showDiagnostics: pick('diag', 'diagnostics'),
    };
    for (const key in map) if (map[key] !== undefined && map[key] !== null) layer[key] = map[key];
    // `?diag` with no value means on.
    if (params.has('diag') && params.get('diag') === '') layer.showDiagnostics = true;
    if (params.has('ci')) { ci = params.get('ci') || 'ci'; layer.showDiagnostics = true; }
  } catch { /* malformed URL: ignore */ }
  return { layer, ci };
}

function readPlatformGlobal() {
  try {
    const g = typeof window !== 'undefined' ? window.__PROJECT_STRIKE_PLATFORM__ : undefined;
    if (!g) return null;
    if (typeof g === 'string') return { platform: g };
    return typeof g === 'object' ? g : null;
  } catch { return null; }
}

/**
 * @returns {{platform:'auto'|'mobile'|'desktop', quality:string, lighting:string, camera:string, sensitivity:number,
 *            adsSensitivity:number, fov:number, invertY:boolean, showDiagnostics:boolean, ci:string|null}}
 */
export function loadSettings() {
  const settings = defaultSettings();
  const forced = {};
  let fovSet = false;

  const stored = readStored();
  applyLayer(settings, stored, null);
  fovSet = SETTING_VALIDATORS.fov(stored.fov) !== undefined;

  const pageLayer = readPlatformGlobal();
  applyLayer(settings, pageLayer, forced);
  if (pageLayer && SETTING_VALIDATORS.fov(pageLayer.fov) !== undefined) fovSet = true;

  const { layer: urlLayer, ci } = readUrlLayer();
  applyLayer(settings, urlLayer, forced);
  if (SETTING_VALIDATORS.fov(urlLayer.fov) !== undefined) fovSet = true;
  settings.ci = ci;
  if (ci) { settings.showDiagnostics = true; forced.showDiagnostics = true; }

  // FOV default follows the *effective* platform (desktop.html / ?platform= change it).
  if (!fovSet) settings.fov = defaultFovFor(settings.platform);

  forcedBySettings.set(settings, forced);
  lastForced = forced;
  return settings;
}

/**
 * Persists user-facing settings. Values that were forced by desktop.html or the URL and are still unchanged are not
 * written (so `?quality=ULTRA` or desktop.html never sticks to index.html). A default FOV is not stored either, so it
 * keeps following the platform. Returns true on success.
 */
export function saveSettings(settings) {
  if (!settings || typeof settings !== 'object') return false;
  const forced = forcedBySettings.get(settings) || lastForced;
  const out = readStored();
  for (const key of PERSIST_KEYS) {
    if (!(key in settings)) continue;
    const value = SETTING_VALIDATORS[key](settings[key]);
    if (value === undefined) continue;
    if (key in forced) {
      if (forced[key] === value) continue;
      delete forced[key]; // the player changed a forced value in-game: from now on it is theirs
    }
    if (key === 'fov' && value === defaultFovFor(SETTING_VALIDATORS.platform(settings.platform) || 'auto')) { delete out.fov; continue; }
    out[key] = value;
  }
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(out));
    return true;
  } catch { return false; }
}
