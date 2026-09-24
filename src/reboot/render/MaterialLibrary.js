import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
// DynamicTexture only self-registers the WebGL path; the WebGPU create/update implementation is a side-effect module.
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.dynamicTexture.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { createRng } from '../core/MathUtil.js';

/*
 * MaterialLibrary — every surface in Project Strike is code-generated here.
 *  - Procedural PBR sets (albedo sRGB / tangent normal from a Sobel of the height field / ORM packed as
 *    R = AO, G = roughness, B = metalness in `metallicTexture`) generated once from seeded tileable value noise.
 *  - Neon: unlit emissive HDR PBR materials (emissive * intensity > 1 so the HDR bloom catches them),
 *    a 32-entry neon palette (one draw call for every neon tube in the level) and a DynamicTexture sign atlas.
 *  - Runtime look controls (wetness / neon scale / window glow) are cheap uniform changes; frozen materials are
 *    unfrozen for two frames and re-frozen automatically.
 */

// ------------------------------------------------------------------------------------------------ colour helpers
const toLin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
/** '#rrggbb' → linear Color3 (PBR colour inputs are linear). */
export function linearColor(hex) {
  const c = Color3.FromHexString(hex);
  return new Color3(toLin(c.r), toLin(c.g), toLin(c.b));
}
const hexBytes = hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const sat = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a, b, v) => { const t = sat((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const b8 = v => (v <= 0 ? 0 : v >= 255 ? 255 : v | 0);

/** Neon palette (sRGB). Index → UV column in the palette texture; exported so the world can address colours by name. */
export const NEON_PALETTE = [
  ['cyan', '#00eaff'], ['magenta', '#ff1fd2'], ['pink', '#ff3d8b'], ['yellow', '#ffd21a'],
  ['amber', '#ff9a1f'], ['red', '#ff1a2a'], ['green', '#2dff86'], ['blue', '#3b62ff'],
  ['violet', '#a246ff'], ['white', '#e4f3ff'], ['warm', '#ffd49a'], ['teal', '#00ffc6'],
  ['tail', '#ff0a16'], ['head', '#fff5dc'], ['orange', '#ff5a00'], ['lime', '#b8ff1a'],
];
const PALETTE_SLOTS = 32; // 0..15 full, 16..31 the same hues at 30 % (panels / dim fronts)
export function paletteUV(name, dim = false) {
  let i = NEON_PALETTE.findIndex(p => p[0] === name);
  if (i < 0) i = 0;
  if (dim) i += 16;
  return [(i + 0.5) / PALETTE_SLOTS, 0.5];
}
export function paletteColor(name) {
  const e = NEON_PALETTE.find(p => p[0] === name) || NEON_PALETTE[0];
  return Color3.FromHexString(e[1]);
}

// ------------------------------------------------------------------------------------------------ texture kernel
/**
 * Self-contained procedural texture kernel. It references nothing outside its own body so it can be serialised with
 * Function#toString into a Blob Web Worker (also after minification) and run off the main thread; the same factory is
 * used synchronously as a fallback. Returns { generate(name, size, seed) → { albedo, normal, orm, emissive } }.
 */
function textureKernel() {
  const createRng = seed => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const sat = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const sstep = (a, b, v) => { const t = sat((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const mix = (a, b, t) => a + (b - a) * t;
  const b8 = v => (v <= 0 ? 0 : v >= 255 ? 255 : v | 0);

  // ------------------------------------------------------------------------------------------------ noise kit
  /**
   * Tileable value-noise / fbm generator working on size×size Float32 fields (no per-pixel allocation).
   * Low-frequency fbm is evaluated on a reduced grid (≥ 6 samples per finest lattice cell) and bilinearly upsampled,
   * which keeps a 512² asphalt set well under the mobile generation budget.
   */
  class NoiseKit {
    constructor(size) { this.size = size; this.n = size * size; this._lut = new Map(); }
    _axis(g, res, smooth = true) {
      const key = `${g}:${res}:${smooth ? 1 : 0}`;
      let l = this._lut.get(key);
      if (l) return l;
      const i0 = new Int32Array(res), i1 = new Int32Array(res), f = new Float32Array(res);
      for (let x = 0; x < res; x++) {
        const u = (x * g) / res, i = Math.floor(u), t = u - i;
        i0[x] = i % g; i1[x] = (i + 1) % g; f[x] = smooth ? t * t * (3 - 2 * t) : t;
      }
      l = { i0, i1, f }; this._lut.set(key, l); return l;
    }
    /** out(rx×ry) += amp * smooth value noise with a gx×gy lattice (wraps → tileable). */
    _addNoise(out, rx, ry, gx, gy, seed, amp) {
      const rng = createRng(seed), grid = new Float32Array(gx * gy), col = new Float32Array(gx);
      for (let i = 0; i < grid.length; i++) grid[i] = rng() * amp;
      const X = this._axis(gx, rx), Y = this._axis(gy, ry);
      const xi0 = X.i0, xi1 = X.i1, xf = X.f;
      for (let y = 0; y < ry; y++) {
        const r0 = Y.i0[y] * gx, r1 = Y.i1[y] * gx, sy = Y.f[y], row = y * rx;
        for (let j = 0; j < gx; j++) { const p = grid[r0 + j]; col[j] = p + (grid[r1 + j] - p) * sy; }
        for (let x = 0; x < rx; x++) { const a = col[xi0[x]]; out[row + x] += a + (col[xi1[x]] - a) * xf[x]; }
      }
    }
    /** Normalised 0..1 fbm. `g` base lattice (per tile), `oct` octaves, anisotropy → gy = g*aniso. */
    fbm(g, oct, seed, gain = 0.5, aniso = 1) {
      const s = this.size;
      const lx = [], ly = [];
      for (let o = 0; o < oct; o++) {
        lx.push(Math.min(s, Math.max(1, Math.round(g * (1 << o)))));
        ly.push(Math.min(s, Math.max(1, Math.round(g * aniso * (1 << o)))));
      }
      const pow2 = v => { let r = 8; while (r < v) r <<= 1; return r; };
      const rx = Math.min(s, pow2(lx[oct - 1] * 6)), ry = Math.min(s, pow2(ly[oct - 1] * 6));
      const low = new Float32Array(rx * ry);
      let amp = 1, sum = 0;
      for (let o = 0; o < oct; o++) {
        this._addNoise(low, rx, ry, lx[o], ly[o], seed * 7919 + o * 104729, amp);
        sum += amp; amp *= gain;
      }
      const inv = 1 / sum;
      if (rx === s && ry === s) { for (let i = 0; i < this.n; i++) low[i] *= inv; return low; }
      // bilinear wrap upsample to full size
      const out = new Float32Array(this.n), X = this._axis(rx, s, false), Y = this._axis(ry, s, false), col = new Float32Array(rx);
      const xi0 = X.i0, xi1 = X.i1, xf = X.f;
      for (let y = 0; y < s; y++) {
        const r0 = Y.i0[y] * rx, r1 = Y.i1[y] * rx, sy = Y.f[y], row = y * s;
        for (let j = 0; j < rx; j++) { const p = low[r0 + j]; col[j] = (p + (low[r1 + j] - p) * sy) * inv; }
        for (let x = 0; x < s; x++) { const a = col[xi0[x]]; out[row + x] = a + (col[xi1[x]] - a) * xf[x]; }
      }
      return out;
    }
    white(seed) {
      const out = new Float32Array(this.n), rng = createRng(seed);
      for (let i = 0; i < this.n; i++) out[i] = rng();
      return out;
    }
  }

  /** Sobel of a wrapped height field → RGBA8 tangent-space normal map. */
  function heightToNormal(h, size, strength) {
    const out = new Uint8Array(size * size * 4);
    const k = strength * (size / 512);
    const XM = new Int32Array(size), XP = new Int32Array(size);
    for (let x = 0; x < size; x++) { XM[x] = (x - 1 + size) % size; XP[x] = (x + 1) % size; }
    for (let y = 0; y < size; y++) {
      const ym = XM[y] * size, yc = y * size, yp = XP[y] * size;
      for (let x = 0; x < size; x++) {
        const xm = XM[x], xp = XP[x];
        const a = h[ym + xm], c = h[ym + xp], g = h[yp + xm], i = h[yp + xp];
        const dx = (c + 2 * h[yc + xp] + i) - (a + 2 * h[yc + xm] + g);
        const dy = (g + 2 * h[yp + x] + i) - (a + 2 * h[ym + x] + c);
        const nx = -dx * k, ny = -dy * k;
        const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        const o = (yc + x) * 4;
        out[o] = (nx * inv * 0.5 + 0.5) * 255; out[o + 1] = (ny * inv * 0.5 + 0.5) * 255; out[o + 2] = (inv * 0.5 + 0.5) * 255; out[o + 3] = 255;
      }
    }
    return out;
  }

  /** Stamps a filled disc into an RGBA8 buffer with wrap-around (used for graffiti / scratches / rivets). */
  function stamp(buf, size, cx, cy, r, rgb, alpha = 1) {
    const r2 = r * r, x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r), y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy, wy = ((y % size) + size) % size;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const a = alpha * sat((r2 - d2) / (r2 * 0.35 + 0.001));
        const o = (wy * size + (((x % size) + size) % size)) * 4;
        buf[o] = mix(buf[o], rgb[0], a); buf[o + 1] = mix(buf[o + 1], rgb[1], a); buf[o + 2] = mix(buf[o + 2], rgb[2], a);
      }
    }
  }

  function newSet(size) {
    const n = size * size;
    return { size, albedo: new Uint8Array(n * 4), orm: new Uint8Array(n * 4), height: new Float32Array(n), emissive: null };
  }
  function put(buf, i, r, g, b) { const o = i * 4; buf[o] = b8(r); buf[o + 1] = b8(g); buf[o + 2] = b8(b); buf[o + 3] = 255; }
  function putOrm(buf, i, ao, rough, metal) { const o = i * 4; buf[o] = b8(ao * 255); buf[o + 1] = b8(rough * 255); buf[o + 2] = b8(metal * 255); buf[o + 3] = 255; }

  // ------------------------------------------------------------------------------------------------ generators
  // Every generator returns { albedo, orm, height, emissive?, normalStrength }. World texel density is decided by the
  // world's UV scale (metres per tile), noted per generator.

  /** Asphalt, ~5.5 m tile: aggregate speckle, oil blotches, crack network, glossy tar-sealed cracks, damp patches. */
  function genAsphalt(k, seed) {
    const s = k.size, n = k.n, set = newSet(s);
    const base = k.fbm(3, 4, seed + 1), mid = k.fbm(14, 3, seed + 2), grain = k.fbm(s >> 2, 1, seed + 3);
    const white = k.white(seed + 4), crackN = k.fbm(4, 4, seed + 5);
    for (let i = 0; i < n; i++) {
      const w = white[i], cn = crackN[i], b = base[i];
      const crack = (1 - sstep(0.004, 0.014, Math.abs(cn - 0.5))) * sstep(0.46, 0.6, mid[i]);
      const tar = (1 - sstep(0.004, 0.011, Math.abs(cn - 0.3))) * (1 - crack);
      const dampM = sstep(0.4, 0.28, b);
      const oil = sstep(0.62, 0.8, b);
      const stone = w > 0.93 ? (w - 0.93) * 9 : 0, pit = w < 0.04 ? 1 : 0;
      let v = 62 + (mid[i] - 0.5) * 26 + (grain[i] - 0.5) * 34 + stone * 55 - pit * 18 - oil * 16;
      v *= 1 - dampM * 0.28;
      v = mix(v, 24, crack * 0.85);
      v = mix(v, 19, tar);
      put(set.albedo, i, v, v + 1, v + 4);
      set.height[i] = grain[i] * 0.55 + mid[i] * 0.2 + stone * 0.35 - pit * 0.25 - crack * 0.9;
      let rough = 0.84 + (grain[i] - 0.5) * 0.12 - stone * 0.1;
      rough = mix(rough, 0.42, dampM); rough = mix(rough, 0.3, tar); rough = mix(rough, 0.95, crack);
      putOrm(set.orm, i, 1 - crack * 0.55 - (1 - grain[i]) * 0.14, rough, 0);
    }
    set.normalStrength = 2.2;
    return set;
  }

  /** Weathered cast concrete, ~3 m tile: blotches, water-stain streaks, pores, expansion joint on the tile edge. */
  function genConcrete(k, seed) {
    const s = k.size, n = k.n, set = newSet(s);
    const blot = k.fbm(3, 5, seed + 1), fine = k.fbm(s >> 3, 2, seed + 2), white = k.white(seed + 3);
    const streak = k.fbm(28, 2, seed + 4, 0.5, 0.08), streakMask = k.fbm(3, 2, seed + 5), algae = k.fbm(5, 3, seed + 6);
    const jw = Math.max(1, s / 256);
    for (let y = 0; y < s; y++) {
      const jy = y < jw || y >= s - jw ? 1 : 0;
      for (let x = 0; x < s; x++) {
        const i = y * s + x, joint = jy || x < jw || x >= s - jw ? 1 : 0;
        const st = sstep(0.52, 0.78, streak[i]) * sstep(0.35, 0.6, streakMask[i]);
        const pore = white[i] > 0.985 ? 1 : 0;
        const g = algae[i] > 0.68 ? (algae[i] - 0.68) * 2.2 : 0;
        let v = 170 + (blot[i] - 0.5) * 46 + (fine[i] - 0.5) * 16;
        v *= 1 - st * 0.34;
        let r = v, gg = v - 2, b = v - 7;
        r -= g * 40; gg -= g * 18; b -= g * 44;
        if (pore) { r *= 0.55; gg *= 0.55; b *= 0.55; }
        if (joint) { r *= 0.42; gg *= 0.42; b *= 0.42; }
        put(set.albedo, i, r, gg, b);
        set.height[i] = fine[i] * 0.45 + blot[i] * 0.25 - pore * 0.5 - joint * 1.0;
        putOrm(set.orm, i, 1 - joint * 0.6 - pore * 0.4, 0.86 + (fine[i] - 0.5) * 0.12 - st * 0.08, 0);
      }
    }
    set.normalStrength = 1.6;
    return set;
  }

  /** Sidewalk pavers: 4×4 tiles per texture (0.5 m pavers on a 2 m tile), grout, chipped edges, gum + grime. */
  function genTile(k, seed) {
    const s = k.size, n = k.n, set = newSet(s), rng = createRng(seed);
    const noise = k.fbm(24, 3, seed + 1), grime = k.fbm(4, 3, seed + 2), chip = k.fbm(32, 2, seed + 3), white = k.white(seed + 4);
    const T = 4, cell = s / T, tileTone = new Float32Array(T * T), tileHue = new Float32Array(T * T);
    for (let i = 0; i < T * T; i++) { tileTone[i] = rng(); tileHue[i] = rng(); }
    const grout = cell * 0.045;
    for (let y = 0; y < s; y++) {
      const ty = Math.floor(y / cell), fy = y - ty * cell, ey = Math.min(fy, cell - fy);
      for (let x = 0; x < s; x++) {
        const i = y * s + x, tx = Math.floor(x / cell), fx = x - tx * cell, ex = Math.min(fx, cell - fx);
        const edge = Math.min(ex, ey) + (chip[i] - 0.5) * grout * 1.6;
        const g = 1 - sstep(grout * 0.6, grout * 1.25, edge);
        const bevel = sstep(grout * 0.6, grout * 2.6, edge);
        const ti = ty * T + tx, tone = tileTone[ti];
        const gum = white[i] > 0.9975 ? 1 : 0;
        const dirt = sstep(0.45, 0.8, grime[i]) * 0.3 + (1 - bevel) * 0.2;
        let v = 128 + (tone - 0.5) * 34 + (noise[i] - 0.5) * 22;
        v *= 1 - dirt;
        let r = v + (tileHue[ti] - 0.5) * 10, gg = v, b = v - 3 + (0.5 - tileHue[ti]) * 6;
        if (gum) { r *= 0.35; gg *= 0.35; b *= 0.38; }
        r = mix(r, 58, g); gg = mix(gg, 57, g); b = mix(b, 56, g);
        put(set.albedo, i, r, gg, b);
        set.height[i] = bevel * 0.9 + noise[i] * 0.12 + gum * 0.2;
        putOrm(set.orm, i, mix(1, 0.45, g), mix(0.66 + (noise[i] - 0.5) * 0.15 + dirt * 0.2, 0.95, g), 0);
      }
    }
    set.normalStrength = 2.6;
    return set;
  }

  /** Neutral painted steel (tinted by albedoColor / vertex colour), ~2.5 m tile: chips to primer & rust, grime runs, one seam. */
  function genPaint(k, seed) {
    const s = k.size, n = k.n, set = newSet(s);
    const chipN = k.fbm(10, 4, seed + 1), chipF = k.fbm(s >> 3, 1, seed + 2), grime = k.fbm(20, 2, seed + 3, 0.5, 0.1);
    const grimeMask = k.fbm(3, 2, seed + 4), tone = k.fbm(6, 3, seed + 5), rustN = k.fbm(8, 3, seed + 6);
    const seamY = Math.round(s * 0.5), sw = Math.max(1, s / 256);
    for (let y = 0; y < s; y++) {
      const seam = Math.abs(y - seamY) <= sw ? 1 : 0;
      for (let x = 0; x < s; x++) {
        const i = y * s + x;
        const chip = sstep(0.71, 0.735, chipN[i] + (chipF[i] - 0.5) * 0.1);
        const rust = chip * sstep(0.5, 0.72, rustN[i]);
        const g = sstep(0.55, 0.8, grime[i]) * sstep(0.4, 0.65, grimeMask[i]);
        let v = 214 + (tone[i] - 0.5) * 22;
        v *= 1 - g * 0.26;
        let r = v, gg = v, b = v - 4;
        r = mix(r, 150, chip); gg = mix(gg, 146, chip); b = mix(b, 138, chip);
        r = mix(r, 150, rust); gg = mix(gg, 92, rust); b = mix(b, 60, rust);
        if (seam) { r *= 0.35; gg *= 0.35; b *= 0.35; }
        put(set.albedo, i, r, gg, b);
        set.height[i] = (1 - chip) * 0.5 + tone[i] * 0.08 - seam * 0.8 - rust * 0.1;
        putOrm(set.orm, i, 1 - seam * 0.5, mix(mix(0.46 + g * 0.3, 0.5, chip), 0.9, rust), chip * (1 - rust) * 0.85);
      }
    }
    set.normalStrength = 1.8;
    return set;
  }

  /** Dark steel, ~1.5 m tile: horizontal brushing, scratches, grime. */
  function genMetal(k, seed) {
    const s = k.size, n = k.n, set = newSet(s), rng = createRng(seed);
    const brush = k.fbm(4, 3, seed + 1, 0.6, Math.max(8, s / 8)), blot = k.fbm(4, 4, seed + 2), fine = k.fbm(s >> 2, 1, seed + 3);
    for (let i = 0; i < n; i++) {
      const g = sstep(0.55, 0.78, blot[i]);
      const v = 104 + (brush[i] - 0.5) * 34 + (fine[i] - 0.5) * 10 - g * 34;
      put(set.albedo, i, v, v + 1, v + 4);
      set.height[i] = brush[i] * 0.3 + fine[i] * 0.1;
      putOrm(set.orm, i, 1, 0.34 + (brush[i] - 0.5) * 0.14 + g * 0.3, 0.9 - g * 0.3);
    }
    // scratches: short bright strokes
    const count = Math.round(s * 0.35);
    for (let c = 0; c < count; c++) {
      let x = rng() * s, y = rng() * s; const a = rng() * Math.PI, len = 6 + rng() * s * 0.08, dx = Math.cos(a), dy = Math.sin(a);
      for (let t = 0; t < len; t += 0.7) { stamp(set.albedo, s, x, y, 0.7, [168, 170, 176], 0.55); x += dx * 0.7; y += dy * 0.7; }
    }
    set.normalStrength = 0.9;
    return set;
  }

  /** Rust / corroded steel, ~2 m tile. */
  function genRust(k, seed) {
    const s = k.size, n = k.n, set = newSet(s);
    const a = k.fbm(4, 5, seed + 1), b = k.fbm(16, 3, seed + 2), white = k.white(seed + 3), paint = k.fbm(3, 3, seed + 4);
    for (let i = 0; i < n; i++) {
      const t = sat(a[i] * 1.2 - 0.1), pit = white[i] > 0.97 ? 1 : 0, p = sstep(0.62, 0.66, paint[i]);
      let r = mix(64, 158, t) + (b[i] - 0.5) * 30, g = mix(38, 78, t) + (b[i] - 0.5) * 16, bb = mix(28, 36, t);
      if (pit) { r *= 0.5; g *= 0.5; bb *= 0.5; }
      r = mix(r, 58, p); g = mix(g, 92, p); bb = mix(bb, 90, p);
      put(set.albedo, i, r, g, bb);
      set.height[i] = b[i] * 0.6 + a[i] * 0.3 - pit * 0.4 + p * 0.3;
      putOrm(set.orm, i, 1 - pit * 0.4, mix(0.9 - t * 0.05, 0.55, p), mix(0.25 * (1 - t), 0.1, p));
    }
    set.normalStrength = 2.6;
    return set;
  }

  /** Brick running bond: 6 bricks × 16 courses on a 1.3 m × 1.2 m tile, per-brick colour, recessed mortar, soot. */
  function genBrick(k, seed) {
    const s = k.size, n = k.n, set = newSet(s), rng = createRng(seed);
    const COLS = 6, ROWS = 16, rowH = s / ROWS, brW = s / COLS, mort = Math.max(1.2, s / 170);
    const tones = [[142, 64, 46], [122, 54, 41], [158, 82, 58], [104, 46, 38], [134, 72, 52], [78, 40, 33]];
    const brickCol = new Uint8Array(COLS * ROWS * 3), brickVar = new Float32Array(COLS * ROWS);
    for (let i = 0; i < COLS * ROWS; i++) {
      const t = tones[Math.floor(rng() * tones.length)];
      brickCol[i * 3] = t[0]; brickCol[i * 3 + 1] = t[1]; brickCol[i * 3 + 2] = t[2]; brickVar[i] = rng();
    }
    const surf = k.fbm(s >> 3, 2, seed + 1), edgeN = k.fbm(40, 2, seed + 2), soot = k.fbm(3, 4, seed + 3), efflo = k.fbm(30, 2, seed + 4, 0.5, 0.12);
    for (let y = 0; y < s; y++) {
      const row = Math.floor(y / rowH), fy = y - row * rowH, ey = Math.min(fy, rowH - fy);
      const off = row % 2 ? brW * 0.5 : 0;
      for (let x = 0; x < s; x++) {
        const i = y * s + x, xx = (x + off) % s, col = Math.floor(xx / brW), fx = xx - col * brW, ex = Math.min(fx, brW - fx);
        const e = Math.min(ex, ey) + (edgeN[i] - 0.5) * mort * 1.2;
        const m = 1 - sstep(mort * 0.5, mort, e);
        const bi = (row * COLS + (col % COLS)) * 3, vr = brickVar[bi / 3];
        const sootM = sstep(0.5, 0.85, soot[i]) * 0.55;
        const ef = sstep(0.7, 0.9, efflo[i]) * 0.25;
        const f = (0.86 + vr * 0.22 + (surf[i] - 0.5) * 0.25) * (1 - sootM);
        let r = brickCol[bi] * f, g = brickCol[bi + 1] * f, b = brickCol[bi + 2] * f;
        r = mix(r, 200, ef); g = mix(g, 196, ef); b = mix(b, 188, ef);
        const mv = 138 * (1 - sootM * 0.8);
        r = mix(r, mv, m); g = mix(g, mv - 3, m); b = mix(b, mv - 8, m);
        put(set.albedo, i, r, g, b);
        set.height[i] = (1 - m) * (0.8 + surf[i] * 0.2) + surf[i] * 0.05;
        putOrm(set.orm, i, mix(1, 0.5, m), mix(0.82 + (surf[i] - 0.5) * 0.1, 0.96, m), 0);
      }
    }
    set.normalStrength = 3.2;
    return set;
  }

  /** White stucco / plaster, ~3 m tile: bumpy trowel, dirt streaks from above, hairline cracks, patched repairs. */
  function genPlaster(k, seed) {
    const s = k.size, n = k.n, set = newSet(s);
    const bump = k.fbm(s >> 3, 2, seed + 1, 0.6), large = k.fbm(4, 4, seed + 2), streak = k.fbm(26, 2, seed + 3, 0.5, 0.08);
    const streakMask = k.fbm(3, 2, seed + 4), crackN = k.fbm(5, 4, seed + 5), patch = k.fbm(3, 2, seed + 6);
    for (let i = 0; i < n; i++) {
      const st = sstep(0.5, 0.8, streak[i]) * sstep(0.3, 0.62, streakMask[i]);
      const crack = 1 - sstep(0.003, 0.009, Math.abs(crackN[i] - 0.5));
      const p = sstep(0.66, 0.68, patch[i]);
      let v = 222 + (large[i] - 0.5) * 24 + (bump[i] - 0.5) * 12 - p * 10;
      v *= 1 - st * 0.3;
      let r = v, g = v - 3, b = v - 10;
      r = mix(r, 90, crack * 0.7); g = mix(g, 88, crack * 0.7); b = mix(b, 84, crack * 0.7);
      put(set.albedo, i, r, g, b);
      set.height[i] = bump[i] * 0.6 + large[i] * 0.2 - crack * 0.5 + p * 0.15;
      putOrm(set.orm, i, 1 - crack * 0.4, 0.9 - p * 0.08, 0);
    }
    set.normalStrength = 1.6;
    return set;
  }

  /** White-painted clapboard siding, 8 boards per 1.6 m tile (bodycam house reference), peeling to grey wood. */
  function genSiding(k, seed) {
    const s = k.size, n = k.n, set = newSet(s);
    const B = 8, bh = s / B, grain = k.fbm(4, 3, seed + 1, 0.55, 12), peel = k.fbm(8, 4, seed + 2), dirt = k.fbm(3, 3, seed + 3);
    for (let y = 0; y < s; y++) {
      const fb = (y % bh) / bh; // 0 at board bottom edge (v up) → 1 at top
      const lip = fb < 0.08 ? 1 - fb / 0.08 : 0;
      for (let x = 0; x < s; x++) {
        const i = y * s + x;
        const pe = sstep(0.66, 0.7, peel[i]);
        const d = sstep(0.5, 0.85, dirt[i]) * 0.25 + lip * 0.35;
        let v = 226 * (1 - d);
        let r = v, g = v, b = v - 4;
        const wv = 118 + (grain[i] - 0.5) * 40;
        r = mix(r, wv, pe); g = mix(g, wv - 8, pe); b = mix(b, wv - 20, pe);
        put(set.albedo, i, r, g, b);
        set.height[i] = (1 - fb) * 0.9 + grain[i] * 0.05 - pe * 0.05;
        putOrm(set.orm, i, 1 - lip * 0.5, mix(0.62, 0.9, pe), 0);
      }
    }
    set.normalStrength = 3.5;
    return set;
  }

  /** 45° yellow/black hazard stripes (4 pairs per tile), worn, scratched. */
  function genHazard(k, seed) {
    const s = k.size, n = k.n, set = newSet(s);
    const wear = k.fbm(8, 4, seed + 1), fine = k.fbm(s >> 3, 1, seed + 2), period = s / 4;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const i = y * s + x;
        const ph = ((x + y) % period) / period;
        const yel = sstep(0.0, 0.02, ph) * (1 - sstep(0.5, 0.52, ph));
        const w = sstep(0.68, 0.72, wear[i] + (fine[i] - 0.5) * 0.15);
        let r = mix(24, 238, yel), g = mix(24, 178, yel), b = mix(22, 16, yel);
        r = mix(r, 96, w); g = mix(g, 94, w); b = mix(b, 90, w);
        put(set.albedo, i, r, g, b);
        set.height[i] = (1 - w) * 0.4 + fine[i] * 0.1;
        putOrm(set.orm, i, 1, mix(0.5, 0.8, w), w * 0.5);
      }
    }
    set.normalStrength = 1.2;
    return set;
  }

  /** Worn white road paint (tinted yellow by vertex colour for centre lines). */
  function genRoadPaint(k, seed) {
    const s = k.size, n = k.n, set = newSet(s);
    const wear = k.fbm(6, 4, seed + 1), fine = k.fbm(s >> 2, 1, seed + 2);
    for (let i = 0; i < n; i++) {
      const w = sstep(0.63, 0.74, wear[i] * 0.75 + fine[i] * 0.25);
      const v = mix(232, 105, w);
      put(set.albedo, i, v, v, v - 2);
      set.height[i] = (1 - w) * 0.4 + fine[i] * 0.2;
      putOrm(set.orm, i, 1, mix(0.52, 0.85, w), 0);
    }
    set.normalStrength = 1.2;
    return set;
  }

  /** Corrugated roller shutter with procedural graffiti tags. */
  function genShutter(k, seed) {
    const s = k.size, n = k.n, set = newSet(s), rng = createRng(seed);
    const grime = k.fbm(5, 3, seed + 1), fine = k.fbm(s >> 3, 1, seed + 2), ribs = 28;
    for (let y = 0; y < s; y++) {
      const ph = (y / s) * ribs * Math.PI * 2, rib = Math.sin(ph);
      for (let x = 0; x < s; x++) {
        const i = y * s + x, g = sstep(0.45, 0.85, grime[i]);
        const v = (176 + rib * 16 + (fine[i] - 0.5) * 12) * (1 - g * 0.45);
        put(set.albedo, i, v, v + 1, v + 3);
        set.height[i] = rib * 0.5 + 0.5;
        putOrm(set.orm, i, 0.8 + rib * 0.2, 0.5 + g * 0.3, 0.35);
      }
    }
    // graffiti: bubble-letter throw-ups (outline → fill → highlight) plus a few thin scribbled tags with drips.
    const cols = [[255, 60, 170], [40, 220, 255], [255, 214, 30], [70, 255, 120], [240, 40, 40], [160, 80, 255], [245, 245, 245]];
    const pick = () => cols[Math.floor(rng() * cols.length)];
    const throwUps = 2 + Math.floor(rng() * 2);
    for (let t = 0; t < throwUps; t++) {
      const fill = pick(), lh = s * (0.1 + rng() * 0.06), n = 3 + Math.floor(rng() * 3);
      let bx = rng() * s; const by = s * (0.15 + rng() * 0.45), pts = [];
      for (let L = 0; L < n; L++) {
        const lw = lh * (0.55 + rng() * 0.25), strokes = 2 + Math.floor(rng() * 2);
        for (let k = 0; k < strokes; k++) {
          const x0 = bx + rng() * lw, y0 = by + rng() * lh, x1 = bx + rng() * lw, y1 = by + rng() * lh;
          for (let q = 0; q <= 8; q++) pts.push(mix(x0, x1, q / 8), mix(y0, y1, q / 8) + Math.sin(q * 0.8) * lh * 0.05);
        }
        bx += lw * 0.95;
      }
      const r = lh * 0.2;
      for (let p = 0; p < pts.length; p += 2) stamp(set.albedo, s, pts[p], pts[p + 1], r * 1.45, [16, 14, 20], 1);
      for (let p = 0; p < pts.length; p += 2) stamp(set.albedo, s, pts[p], pts[p + 1], r, fill, 1);
      for (let p = 0; p < pts.length; p += 6) stamp(set.albedo, s, pts[p] - r * 0.3, pts[p + 1] + r * 0.35, r * 0.28, [255, 255, 255], 0.55);
    }
    const tags = 2 + Math.floor(rng() * 2), r0 = s / 260;
    for (let t = 0; t < tags; t++) {
      const col = pick();
      let x = rng() * s, y = s * (0.15 + rng() * 0.6), a = rng() * 6.28;
      const len = 50 + Math.floor(rng() * 50), sp = s / 220;
      for (let p = 0; p < len; p++) {
        a += (rng() - 0.5) * 1.6 + Math.sin(p * 0.6) * 0.5;
        x += Math.cos(a) * sp * 2.2 + sp; y += Math.sin(a) * sp * 2.2;
        stamp(set.albedo, s, x, y, r0 * 2.2, col, 1);
        if (rng() < 0.03) for (let q = 0; q < s * 0.05; q++) stamp(set.albedo, s, x, y - q, r0 * 0.8, col, 0.8);
      }
    }
    set.normalStrength = 2.4;
    return set;
  }

  /**
   * Facade window grid: 8×8 cells per tile (tile = 24 m × 28 m → 3 m bays, 3.5 m floors). Emissive map holds random lit
   * apartments (warm tungsten, cool fluorescent, TV blue, rare neon pink/teal) with blinds, curtains and silhouettes.
   */
  function genWindows(k, seed) {
    const s = k.size, n = k.n, set = newSet(s), rng = createRng(seed), C = 8, cell = s / C;
    set.emissive = new Uint8Array(n * 4);
    const fine = k.fbm(s >> 3, 1, seed + 1), dirt = k.fbm(4, 3, seed + 2);
    const lit = [], tint = [], blinds = [], shape = [];
    const temps = [[255, 188, 112], [255, 205, 140], [196, 228, 255], [214, 236, 255], [110, 140, 255], [255, 96, 200], [90, 255, 222]];
    for (let c = 0; c < C * C; c++) {
      const r = rng();
      lit.push(r < 0.46 ? 0.45 + rng() * 0.55 : r < 0.52 ? 0.12 : 0);
      const tr = rng();
      tint.push(temps[tr < 0.38 ? 0 : tr < 0.55 ? 1 : tr < 0.72 ? 2 : tr < 0.82 ? 3 : tr < 0.91 ? 4 : tr < 0.96 ? 5 : 6]);
      blinds.push(rng() < 0.35 ? 1 : 0);
      shape.push(rng());
    }
    for (let y = 0; y < s; y++) {
      const cy = Math.floor(y / cell), fy = (y - cy * cell) / cell;
      for (let x = 0; x < s; x++) {
        const i = y * s + x, cx = Math.floor(x / cell), fx = (x - cx * cell) / cell, ci = cy * C + cx;
        const inGlass = fx > 0.1 && fx < 0.9 && fy > 0.26 && fy < 0.93;
        const frame = inGlass && (Math.abs(fx - 0.5) < 0.012 || fy < 0.285 || fy > 0.915 || fx < 0.12 || fx > 0.88);
        const d = sstep(0.5, 0.85, dirt[i]);
        if (!inGlass) {
          const slab = fy < 0.2 ? 1 : 0; // floor slab band
          const v = (slab ? 128 : 110) + (fine[i] - 0.5) * 14 - d * 22;
          put(set.albedo, i, v, v + 2, v + 6);
          set.height[i] = slab ? 1 : 0.85;
          putOrm(set.orm, i, 1, 0.82, 0.05);
          put(set.emissive, i, 0, 0, 0);
          continue;
        }
        if (frame) {
          put(set.albedo, i, 62, 64, 68); set.height[i] = 0.55; putOrm(set.orm, i, 0.9, 0.42, 0.7); put(set.emissive, i, 0, 0, 0);
          continue;
        }
        const gy = (fy - 0.26) / 0.67, gx = (fx - 0.1) / 0.8;
        const refl = 18 + gy * 14;
        put(set.albedo, i, refl, refl + 3, refl + 8);
        set.height[i] = 0.2;
        putOrm(set.orm, i, 1, 0.06 + d * 0.1, 0.25);
        let e = lit[ci];
        if (e > 0) {
          const t = tint[ci], sh = shape[ci];
          e *= 0.55 + gy * 0.45;                                                    // ceiling light falloff
          e *= 1 - 0.55 * sstep(0.3, 0.0, Math.min(gx, 1 - gx)) * (sh > 0.5 ? 1 : 0.3); // curtains at the sides
          if (blinds[ci]) e *= 0.55 + 0.45 * (Math.sin(gy * 70) > -0.2 ? 1 : 0.25);
          if (sh < 0.18) { const dx = (gx - 0.3 - sh) * 3.2, dy = (gy - 0.35) * 1.6; if (dx * dx + dy * dy < 0.18 || (Math.abs(dx) < 0.28 && gy < 0.35)) e *= 0.12; } // silhouette
          put(set.emissive, i, t[0] * e, t[1] * e, t[2] * e);
        } else put(set.emissive, i, 0, 0, 0);
      }
    }
    set.normalStrength = 2.4;
    return set;
  }

  /** Storefront interiors (2×2 variants: warm diner, cool pharmacy, pink boutique, green grocery) behind glass. */
  function genShop(k, seed) {
    const s = k.size, n = k.n, set = newSet(s), rng = createRng(seed), h = s / 2;
    const em = set.emissive = new Uint8Array(n * 4);
    const fine = k.fbm(s >> 3, 1, seed + 1);
    const walls = [[255, 170, 90], [170, 225, 255], [255, 110, 200], [150, 255, 170]];
    const prodCols = [[255, 60, 60], [255, 220, 60], [60, 200, 255], [255, 255, 255], [255, 120, 30], [120, 255, 120], [230, 80, 255]];
    for (let y = 0; y < s; y++) {
      const qy = y < h ? 0 : 1, fy = (y - qy * h) / h; // fy 0 bottom → 1 top (v up)
      let shelf = 1;
      for (let sh = 0; sh < 4; sh++) { const sy = 0.2 + sh * 0.17; if (fy > sy - 0.008 && fy < sy) shelf = 0.2; }
      const e = (0.35 + fy * 0.35) * shelf * (fy < 0.14 ? 0.25 + fy * 2 : 1), tube = fy > 0.9 && fy < 0.95;
      for (let x = 0; x < s; x++) {
        const i = y * s + x, qx = x < h ? 0 : 1, fx = (x - qx * h) / h, wc = walls[qy * 2 + qx];
        const f = (sstep(0, 0.25, Math.min(fx, 1 - fx)) * 0.6 + 0.4) * (0.92 + (fine[i] - 0.5) * 0.12);
        if (tube) put(em, i, 255 * f, 255 * f, 255 * f);
        else put(em, i, wc[0] * e * f, wc[1] * e * f, wc[2] * e * f);
        put(set.albedo, i, 10, 12, 14);
        putOrm(set.orm, i, 1, 0.05, 0.1);
      }
    }
    // products on the shelves (rasterised rectangles)
    for (let q = 0; q < 4; q++) {
      const ox = (q & 1) * h, oy = (q >> 1) * h;
      for (let sh = 0; sh < 4; sh++) {
        const sy = 0.2 + sh * 0.17;
        let x = 0.04 + rng() * 0.03;
        while (x < 0.95) {
          const w = 0.02 + rng() * 0.05, ht = 0.035 + rng() * 0.05, c = prodCols[Math.floor(rng() * prodCols.length)];
          const x0 = Math.floor(ox + x * h), x1 = Math.floor(ox + Math.min(0.96, x + w) * h);
          const y0 = Math.floor(oy + sy * h), y1 = Math.floor(oy + (sy + ht) * h);
          const vig = sstep(0, 0.25, Math.min(x, 1 - x)) * 0.6 + 0.4;
          for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) put(em, yy * s + xx, c[0] * 0.8 * vig, c[1] * 0.8 * vig, c[2] * 0.8 * vig);
          x += w + 0.004 + rng() * 0.01;
        }
      }
    }
    set.normalStrength = 0;
    return set;
  }

  /** Woven fabric (gloves / sleeves / operator kit), ~0.25 m tile. */
  function genFabric(k, seed) {
    const s = k.size, n = k.n, set = newSet(s), threads = s / 4;
    const fine = k.fbm(s >> 2, 1, seed + 1), blot = k.fbm(4, 3, seed + 2);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const i = y * s + x, u = (x / s) * threads, v = (y / s) * threads;
        const over = (Math.floor(u) + Math.floor(v)) & 1;
        const hw = over ? Math.sin((u % 1) * Math.PI) : Math.sin((v % 1) * Math.PI);
        const val = 170 + hw * 40 + (fine[i] - 0.5) * 30 - sstep(0.55, 0.85, blot[i]) * 40;
        put(set.albedo, i, val, val, val);
        set.height[i] = hw;
        putOrm(set.orm, i, 0.75 + hw * 0.25, 0.9, 0);
      }
    }
    set.normalStrength = 1.4;
    return set;
  }

  /** Stippled polymer (weapon furniture), ~0.3 m tile. */
  function genPolymer(k, seed) {
    const s = k.size, n = k.n, set = newSet(s);
    const st = k.fbm(s >> 2, 2, seed + 1, 0.6), wear = k.fbm(6, 3, seed + 2);
    for (let i = 0; i < n; i++) {
      const w = sstep(0.62, 0.8, wear[i]);
      const v = 150 + (st[i] - 0.5) * 50 + w * 40;
      put(set.albedo, i, v, v, v);
      set.height[i] = st[i] * (1 - w * 0.7);
      putOrm(set.orm, i, 1, mix(0.68, 0.42, w), 0);
    }
    set.normalStrength = 1.6;
    return set;
  }

  const GENERATORS = {
    asphalt: [genAsphalt, 'big'], concrete: [genConcrete, 'mid'], tile: [genTile, 'mid'], paint: [genPaint, 'small'],
    metal: [genMetal, 'small'], rust: [genRust, 'small'], brick: [genBrick, 'mid'], plaster: [genPlaster, 'small'],
    siding: [genSiding, 'small'], hazard: [genHazard, 'small'], roadPaint: [genRoadPaint, 'tiny'], shutter: [genShutter, 'small'],
    windows: [genWindows, 'big'], shop: [genShop, 'mid'], fabric: [genFabric, 'tiny'], polymer: [genPolymer, 'tiny'],
  };


  function generate(name, size, seed) {
    const gen = GENERATORS[name][0];
    const data = gen(new NoiseKit(size), seed);
    return {
      albedo: data.albedo, orm: data.orm, emissive: data.emissive || null,
      normal: data.normalStrength > 0 ? heightToNormal(data.height, size, data.normalStrength) : null,
    };
  }
  const classes = {};
  for (const key of Object.keys(GENERATORS)) classes[key] = GENERATORS[key][1];
  return { generate, classes };
}

// ------------------------------------------------------------------------------------------------ worker pool
/**
 * Runs the texture kernel in 1–2 Blob Web Workers so the ~250 ms of procedural generation overlaps Havok start-up
 * and world building instead of blocking the main thread. Any failure (no Worker, CSP, error, 6 s timeout) falls back to
 * synchronous generation, so textures always arrive.
 */
class TextureWorkerPool {
  constructor(count) {
    this.workers = [];
    this.jobs = new Map();
    this.nextId = 1;
    this.rr = 0;
    this.failed = false;
    this.workerMs = 0;
    try {
      if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') throw new Error('no worker');
      const src = `const K=(${textureKernel.toString()})();\n` +
        'self.onmessage=e=>{const d=e.data;const t0=performance.now();try{const r=K.generate(d.name,d.size,d.seed);' +
        'const list=[r.albedo.buffer,r.orm.buffer];if(r.normal)list.push(r.normal.buffer);if(r.emissive)list.push(r.emissive.buffer);' +
        'self.postMessage({id:d.id,ok:true,ms:performance.now()-t0,r},list);}catch(err){self.postMessage({id:d.id,ok:false,error:String(err)});}};';
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      for (let i = 0; i < count; i++) {
        const w = new Worker(url);
        w.onmessage = e => this._done(e.data);
        w.onerror = () => this._fail();
        this.workers.push(w);
      }
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      this.failed = true;
    }
  }
  run(name, size, seed, onResult) {
    if (this.failed || !this.workers.length) return false;
    const id = this.nextId++;
    const job = { id, name, size, seed, onResult, timer: 0 };
    job.timer = setTimeout(() => this._settleSync(job), 6000);
    this.jobs.set(id, job);
    this.workers[this.rr++ % this.workers.length].postMessage({ id, name, size, seed });
    return true;
  }
  _done(msg) {
    const job = this.jobs.get(msg.id);
    if (!job) return;
    if (!msg.ok) { this._settleSync(job); return; }
    this.jobs.delete(msg.id);
    clearTimeout(job.timer);
    this.workerMs += msg.ms;
    job.onResult(msg.r, msg.ms, false);
  }
  _settleSync(job) {
    if (!this.jobs.has(job.id)) return;
    this.jobs.delete(job.id);
    clearTimeout(job.timer);
    const t0 = performance.now();
    const r = syncKernel().generate(job.name, job.size, job.seed);
    job.onResult(r, performance.now() - t0, true);
  }
  _fail() {
    this.failed = true;
    for (const job of [...this.jobs.values()]) this._settleSync(job);
    this.dispose();
  }
  dispose() {
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
  }
}
let _syncKernel = null;
const syncKernel = () => (_syncKernel ||= textureKernel());

// ------------------------------------------------------------------------------------------------ material recipes
// tex: texture set; albedo: linear tint hex (default white); rough / metal: multipliers of the ORM channels (or plain
// values when untextured); wet: participates in setWetness; glow: emissive window intensity base.
const RECIPES = {
  asphaltWet: { tex: 'asphalt', albedo: '#ffffff', specAA: true, wet: true },
  concrete: { tex: 'concrete', albedo: '#ffffff', wet: true },
  concreteDark: { tex: 'concrete', albedo: '#8f949c', wet: true },
  sidewalkTile: { tex: 'tile', albedo: '#ffffff', specAA: true, wet: true },
  metalPainted: { tex: 'paint', albedo: '#2a9c98' },           // Pacifica teal
  paintTint: { tex: 'paint', albedo: '#ffffff' },              // vertex-colour tinted paint (dumpsters, crates, awnings)
  metalDark: { tex: 'metal', albedo: '#8a8e96' },
  metalRust: { tex: 'rust', albedo: '#ffffff' },
  brick: { tex: 'brick', albedo: '#ffffff' },
  plasterWhite: { tex: 'plaster', albedo: '#ffffff' },
  woodSiding: { tex: 'siding', albedo: '#ffffff' },
  glassDark: { albedo: '#0b0d10', rough: 0.05, metal: 0.35 },
  rubber: { albedo: '#101012', rough: 0.9, metal: 0 },
  plasticYellow: { tex: 'paint', albedo: '#ffbf0d', rough: 0.9 }, // powder-coated safety yellow
  hazardStripe: { tex: 'hazard', albedo: '#ffffff' },
  windowGrid: { tex: 'windows', albedo: '#ffffff', glow: 1.35 },
  skylineWindows: { tex: 'windows', albedo: '#c4c8d0', glow: 1.9 },
  shopWindow: { tex: 'shop', albedo: '#ffffff', glow: 1.15, shop: true },
  shutter: { tex: 'shutter', albedo: '#ffffff' },
  roadPaint: { tex: 'roadPaint', albedo: '#ffffff', zOffset: -2, wet: true },
  puddle: { albedo: '#202328', rough: 0.035, metal: 0, zOffset: -3, puddle: true },
  carPaint: { albedo: '#ffffff', rough: 0.22, metal: 0.55 },
  gunmetal: { tex: 'metal', albedo: '#3a3d42', rough: 1.1 },
  polymer: { tex: 'polymer', albedo: '#2a2b2d' },
  gloveFabric: { tex: 'fabric', albedo: '#3a3630' },
  sleeveFabric: { tex: 'fabric', albedo: '#4d5443' },
  skin: { albedo: '#b27a5c', rough: 0.55, metal: 0 },
  operatorFabric: { tex: 'fabric', albedo: '#3b4136' },
  operatorArmor: { tex: 'fabric', albedo: '#26282a', rough: 0.95 },
  operatorVisor: { albedo: '#050607', rough: 0.07, metal: 0.7 },
};

const SIGN_FONT = "'Avenir Next Condensed','Arial Narrow','Roboto Condensed','Helvetica Neue','DejaVu Sans Condensed',Arial,sans-serif";

export class MaterialLibrary {
  constructor(scene, profile) {
    this.scene = scene;
    this.profile = profile || {};
    const tier = this.profile.tier || 'MOBILE';
    const size = this.profile.textures?.size || 512;
    this.mobile = tier === 'MOBILE';
    // Detail-heavy sets use 256² on MOBILE; the big-area sets (asphalt, facade windows) keep 512² there.
    this.sizes = {
      big: Math.min(size, this.mobile ? 512 : 1024),
      mid: this.mobile ? 256 : Math.min(size, 512),
      small: this.mobile ? 256 : Math.min(size, 512),
      tiny: this.mobile ? 128 : 256,
    };
    this.anisotropy = this.profile.textures?.anisotropy || 4;
    this._classes = syncKernel().classes;
    this._pool = null;
    this._pending = 0;
    this._workerMs = 0;
    this.neonMaterials = [];
    this.genMs = 0;
    this._mats = new Map();
    this._sets = new Map();
    this._signs = new Map();
    this._neonScale = 1;
    this._wetness = 0;
    this._windowGlow = 1;
    this._frozen = false;
    this._pendingRefreeze = null;
  }

  // ------------------------------------------------------------------------------------------ public API
  get(name) {
    let m = this._mats.get(name);
    if (m) return m;
    if (name === 'neonPalette') m = this._createPalette();
    else {
      const r = RECIPES[name];
      if (!r) throw new Error(`MaterialLibrary: unknown material '${name}'`);
      m = this._createPBR(name, r);
    }
    this._mats.set(name, m);
    if (this._frozen) m.freeze();
    return m;
  }

  /** Emissive HDR neon (unlit). Cached by name; registered in neonMaterials so setNeonScale reaches it. */
  neon(name, hexColor, intensity = 4) {
    const key = `neon:${name}`;
    let m = this._mats.get(key);
    if (m) return m;
    m = new PBRMaterial(key, this.scene);
    m.unlit = true;
    m.albedoColor = new Color3(0.02, 0.02, 0.02);
    m.emissiveColor = linearColor(hexColor);
    this._registerNeon(m, intensity);
    this._mats.set(key, m);
    if (this._frozen) m.freeze();
    return m;
  }

  /** Stand-alone neon sign (DynamicTexture on a CPU canvas, system fonts, layered-stroke glow) → unlit emissive PBRMaterial. */
  signTexture(text, hexColor, { w = 512, h = 128, font } = {}) {
    const key = `sign:${text}|${hexColor}|${w}x${h}`;
    let m = this._signs.get(key);
    if (m) return m;
    const dt = new DynamicTexture(key, cpuCanvas(w, h) || { width: w, height: h }, this.scene, true);
    const ctx = dt.getContext();
    ctx.fillStyle = '#050507';
    ctx.fillRect(0, 0, w, h);
    drawNeonText(ctx, text, hexColor, 0, 0, w, h, font);
    dt.update();
    dt.hasAlpha = false;
    m = new PBRMaterial(`${key}:mat`, this.scene);
    m.unlit = true;
    m.albedoColor = new Color3(0.01, 0.01, 0.01);
    m.emissiveTexture = dt;
    m.emissiveColor = new Color3(1, 1, 1);
    this._registerNeon(m, 2.6);
    this._signs.set(key, m);
    if (this._frozen) m.freeze();
    return m;
  }

  /**
   * Sign atlas (one draw call for every sign face in the level). `entries`: [{ key, rect:[x,y,w,h] (0..1, canvas
   * space, y down), draw(ctx, px, py, pw, ph) }]. Returns { material, uv(key) → [u0,v0,u1,v1] }.
   */
  signAtlas(name, entries, size = 1024, intensity = 2.6) {
    const cached = this._signs.get(`atlas:${name}`);
    if (cached) return cached;
    const t0 = performance.now();
    const dt = new DynamicTexture(`atlas:${name}`, cpuCanvas(size, size) || { width: size, height: size }, this.scene, true);
    dt.anisotropicFilteringLevel = this.anisotropy;
    const ctx = dt.getContext();
    ctx.fillStyle = '#040406';
    ctx.fillRect(0, 0, size, size);
    const rects = new Map();
    const tDraw = performance.now();
    for (const e of entries) {
      const [x, y, w, h] = e.rect, px = x * size, py = y * size, pw = w * size, ph = h * size;
      ctx.save();
      ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.clip();
      e.draw(ctx, px, py, pw, ph, this);
      ctx.restore();
      // inset half a texel so mip filtering never samples the neighbour cell's edge
      const iu = 1.5 / size;
      rects.set(e.key, [x + iu, 1 - (y + h) + iu, x + w - iu, 1 - y - iu]);
    }
    const tUp = performance.now();
    dt.update();
    dt.hasAlpha = false;
    this.atlasTimings = { setup: tDraw - t0, draw: tUp - tDraw, upload: performance.now() - tUp };
    const m = new PBRMaterial(`atlas:${name}:mat`, this.scene);
    m.unlit = true;
    m.albedoColor = new Color3(0.012, 0.012, 0.014);
    m.emissiveTexture = dt;
    m.emissiveColor = new Color3(1, 1, 1);
    this._registerNeon(m, intensity);
    this._mats.set(`atlas:${name}`, m);
    const out = { material: m, texture: dt, uv: key => rects.get(key) || [0, 0, 1, 1] };
    this._signs.set(`atlas:${name}`, out);
    this.genMs += performance.now() - t0;
    if (this._frozen) m.freeze();
    return out;
  }

  setNeonScale(scale) {
    this._neonScale = scale;
    this._mutate(this.neonMaterials, m => { m.emissiveIntensity = m.metadata.neonBase * scale; });
  }

  setWetness(w) {
    w = sat(w);
    this._wetness = w;
    const list = [];
    for (const [name, m] of this._mats) {
      const r = RECIPES[name];
      if (r && (r.wet || r.puddle)) list.push(m);
    }
    this._mutate(list, m => {
      const r = RECIPES[m.name], base = m.metadata.baseAlbedo;
      if (r.puddle) {
        // dry → faint dark stain, wet → black mirror
        m.roughness = mix(0.55, 0.025, w);
        m.albedoColor.set(mix(0.05, base.r, w), mix(0.05, base.g, w), mix(0.052, base.b, w));
        return;
      }
      const dark = 1 - 0.38 * w;
      m.albedoColor.set(base.r * dark, base.g * dark, base.b * dark);
      m.roughness = m.metadata.baseRough * (1 - 0.55 * w);
      m.environmentIntensity = 1 + 0.35 * w;
    });
  }

  setWindowGlow(scale) {
    this._windowGlow = scale;
    const list = [];
    for (const m of this._mats.values()) if (m.metadata?.glowBase !== undefined) list.push(m);
    this._mutate(list, m => {
      const s = m.metadata.shop ? Math.max(0.45, scale) : scale;
      m.emissiveIntensity = m.metadata.glowBase * s;
    });
  }

  freezeAll() {
    this._frozen = true;
    for (const m of this._mats.values()) m.freeze();
  }

  /** Texture-generation cost so far (ms) — for diagnostics. */
  get generationMs() { return this.genMs; }

  // ------------------------------------------------------------------------------------------ internals
  _registerNeon(m, intensity) {
    m.metadata = { ...(m.metadata || {}), neonBase: intensity };
    m.emissiveIntensity = intensity * this._neonScale;
    m.disableLighting = true;
    m.environmentIntensity = 0;
    this.neonMaterials.push(m);
  }

  _mutate(list, fn) {
    for (const m of list) {
      if (this._frozen) m.unfreeze();
      fn(m);
    }
    if (!this._frozen || !list.length) return;
    // refreeze after two rendered frames so the new uniforms reach the UBOs (and any probe re-render).
    if (!this._pendingRefreeze) this._pendingRefreeze = new Set();
    for (const m of list) this._pendingRefreeze.add(m);
    if (this._refreezeObserver) { this._refreezeFrames = 2; return; }
    this._refreezeFrames = 2;
    this._refreezeObserver = this.scene.onAfterRenderObservable.add(() => {
      if (--this._refreezeFrames > 0) return;
      for (const m of this._pendingRefreeze) if (this._frozen) m.freeze();
      this._pendingRefreeze.clear();
      this.scene.onAfterRenderObservable.remove(this._refreezeObserver);
      this._refreezeObserver = null;
    });
  }

  _textureSet(texName) {
    let set = this._sets.get(texName);
    if (set) return set;
    const cls = this._classes[texName];
    if (!cls) throw new Error(`MaterialLibrary: unknown texture set '${texName}'`);
    const size = this.sizes[cls];
    const names = Object.keys(this._classes);
    const seed = 1000 + names.indexOf(texName) * 37;
    const hasNormal = texName !== 'shop', hasEmissive = texName === 'windows' || texName === 'shop';
    set = {
      albedo: this._raw(`${texName}-albedo`, size, true),
      normal: hasNormal ? this._raw(`${texName}-normal`, size, false) : null,
      orm: this._raw(`${texName}-orm`, size, false),
      emissive: hasEmissive ? this._raw(`${texName}-emissive`, size, true) : null,
    };
    this._sets.set(texName, set);
    const apply = (r, ms = 0, sync = true) => {
      if (sync) this.genMs += ms; else this._workerMs += ms;
      // textures disposed meanwhile (scene torn down) → drop the data
      const up = (t, d) => { if (t && d && t.getInternalTexture()) t.update(d); };
      up(set.albedo, r.albedo); up(set.orm, r.orm); up(set.normal, r.normal); up(set.emissive, r.emissive);
      if (--this._pending <= 0 && this._pool) {
        // all requested sets delivered → release the worker threads (a later request spins a new pool up)
        const pool = this._pool;
        setTimeout(() => { if (this._pending <= 0 && this._pool === pool) { pool.dispose(); this._pool = null; } }, 0);
      }
    };
    this._pending++;
    if (!this._pool && !this._noWorkers) {
      const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
      this._pool = new TextureWorkerPool(cores >= 4 ? 2 : 1);
      if (this._pool.failed) { this._pool = null; this._noWorkers = true; }
    }
    if (!this._pool || !this._pool.run(texName, size, seed, apply)) {
      const t0 = performance.now();
      const r = syncKernel().generate(texName, size, seed);
      apply(r, performance.now() - t0, true);
    }
    return set;
  }

  /** Resolves once every requested procedural texture has its data (scene.whenReadyAsync also waits on them). */
  whenTexturesReady() {
    return new Promise(resolve => {
      const check = () => (this._pending <= 0 ? resolve() : setTimeout(check, 16));
      check();
    });
  }

  /** Main-thread ms spent generating (sync fallback + sign atlases) and worker ms (off-thread). */
  get stats() { return { mainMs: this.genMs, workerMs: this._workerMs, workers: !this._noWorkers, pending: this._pending, sets: this._sets.size, materials: this._mats.size }; }

  dispose() { this._pool?.dispose(); }

  _raw(name, size, srgb) {
    // waitDataToBeReady → the material (and scene.whenReadyAsync) stays not-ready until the worker data lands.
    const t = new RawTexture(null, size, size, Constants.TEXTUREFORMAT_RGBA, this.scene, true, false, Texture.TRILINEAR_SAMPLINGMODE,
      Constants.TEXTURETYPE_UNSIGNED_BYTE, 0, false, true);
    t.name = name;
    t.wrapU = Texture.WRAP_ADDRESSMODE;
    t.wrapV = Texture.WRAP_ADDRESSMODE;
    t.anisotropicFilteringLevel = this.anisotropy;
    t.gammaSpace = srgb;
    return t;
  }

  _createPBR(name, r) {
    const m = new PBRMaterial(name, this.scene);
    m.maxSimultaneousLights = 6;
    m.albedoColor = linearColor(r.albedo || '#ffffff');
    if (r.tex) {
      const t = this._textureSet(r.tex);
      m.albedoTexture = t.albedo;
      if (t.normal) m.bumpTexture = t.normal;
      m.metallicTexture = t.orm;
      m.useRoughnessFromMetallicTextureGreen = true;
      m.useMetallnessFromMetallicTextureBlue = true;
      m.useAmbientOcclusionFromMetallicTextureRed = true;
      m.metallic = r.metal ?? 1;       // multipliers of the ORM channels
      m.roughness = r.rough ?? 1;
      if (t.emissive) {
        m.emissiveTexture = t.emissive;
        m.emissiveColor = new Color3(1, 1, 1);
      }
    } else {
      m.metallic = r.metal ?? 0;
      m.roughness = r.rough ?? 0.8;
    }
    if (r.specAA) m.enableSpecularAntiAliasing = true;
    if (r.zOffset) m.zOffset = r.zOffset;
    m.metadata = { baseAlbedo: m.albedoColor.clone(), baseRough: m.roughness };
    if (r.glow !== undefined) {
      m.metadata.glowBase = r.glow;
      m.metadata.shop = !!r.shop;
      m.emissiveIntensity = r.glow * (r.shop ? Math.max(0.45, this._windowGlow) : this._windowGlow);
    }
    if (r.wet || r.puddle) {
      // apply the current wetness to newly created materials
      const w = this._wetness;
      if (r.puddle) { m.roughness = mix(0.55, 0.025, w); m.albedoColor.set(mix(0.05, m.metadata.baseAlbedo.r, w), mix(0.05, m.metadata.baseAlbedo.g, w), mix(0.052, m.metadata.baseAlbedo.b, w)); }
      else if (w > 0) { const d = 1 - 0.38 * w; m.albedoColor.scaleInPlace(d); m.roughness = m.metadata.baseRough * (1 - 0.55 * w); m.environmentIntensity = 1 + 0.35 * w; }
    }
    return m;
  }

  _createPalette() {
    const data = new Uint8Array(PALETTE_SLOTS * 4);
    for (let i = 0; i < PALETTE_SLOTS; i++) {
      const [r, g, b] = hexBytes(NEON_PALETTE[i % 16][1]);
      const f = i < 16 ? 1 : 0.3;
      // dim entries are scaled in linear space so the hue survives the sRGB decode.
      const enc = c => b8(255 * Math.pow(Math.pow(c / 255, 2.2) * f, 1 / 2.2));
      data[i * 4] = enc(r); data[i * 4 + 1] = enc(g); data[i * 4 + 2] = enc(b); data[i * 4 + 3] = 255;
    }
    const t = RawTexture.CreateRGBATexture(data, PALETTE_SLOTS, 1, this.scene, false, false, Texture.NEAREST_SAMPLINGMODE);
    t.name = 'neon-palette';
    t.wrapU = t.wrapV = Texture.CLAMP_ADDRESSMODE;
    t.gammaSpace = true;
    const m = new PBRMaterial('neonPalette', this.scene);
    m.unlit = true;
    m.albedoColor = new Color3(0.02, 0.02, 0.02);
    m.emissiveTexture = t;
    m.emissiveColor = new Color3(1, 1, 1);
    this._registerNeon(m, 5);
    return m;
  }
}

// ------------------------------------------------------------------------------------------------ canvas helpers
/**
 * CPU-backed 2D canvas (willReadFrequently) for DynamicTextures: the upload is then a plain memory copy instead of a
 * synchronous GPU readback of an accelerated canvas (measured 0.5 s for a 512² atlas on a software adapter).
 */
function cpuCanvas(w, h) {
  try {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    // DynamicTexture.getContext() calls canvas.getContext('2d') again → returns this same CPU context.
    return c;
  } catch { return null; }
}

/**
 * Neon-tube text: layered translucent strokes fake the glow (canvas shadowBlur is extremely slow on software/mobile
 * canvases), then a coloured tube and a hot near-white core. Fits the text into the given box.
 */
export function drawNeonText(ctx, text, hex, x, y, w, h, font, opts = {}) {
  const pad = opts.pad ?? 0.16;
  let px = Math.floor(h * (opts.scale ?? 0.62));
  const family = font || SIGN_FONT, weight = opts.weight || '700';
  ctx.font = `${weight} ${px}px ${family}`;
  const maxW = w * (1 - pad * 2);
  const mw = ctx.measureText(text).width;
  if (mw > maxW) { px = Math.floor(px * maxW / mw); ctx.font = `${weight} ${px}px ${family}`; }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = x + w / 2, cy = y + h / 2 + px * 0.04;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = hex;
  glowStroke(ctx, px, (lw) => { ctx.lineWidth = lw; ctx.strokeText(text, cx, cy); });
  ctx.globalAlpha = 1;
  ctx.lineWidth = Math.max(1.5, px * 0.075);
  ctx.strokeText(text, cx, cy);
  ctx.fillStyle = mixHex(hex, '#ffffff', 0.72);
  ctx.fillText(text, cx, cy);
}

/** Soft halo from 4 widening low-alpha strokes (cheap replacement for shadowBlur). */
function glowStroke(ctx, px, strokeFn) {
  const layers = [[0.62, 0.05], [0.42, 0.08], [0.27, 0.13], [0.16, 0.3]];
  for (const [k, a] of layers) { ctx.globalAlpha = a; strokeFn(Math.max(2, px * k)); }
  ctx.globalAlpha = 1;
}

/** Light-box sign: coloured panel with dark text (the other half of Night City signage). */
export function drawLightbox(ctx, text, bgHex, fgHex, x, y, w, h, font) {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, mixHex(bgHex, '#ffffff', 0.25));
  g.addColorStop(1, mixHex(bgHex, '#000000', 0.35));
  ctx.fillStyle = g;
  ctx.fillRect(x + w * 0.03, y + h * 0.1, w * 0.94, h * 0.8);
  let px = Math.floor(h * 0.52);
  ctx.font = `800 ${px}px ${font || SIGN_FONT}`;
  const mw = ctx.measureText(text).width, maxW = w * 0.84;
  if (mw > maxW) { px = Math.floor(px * maxW / mw); ctx.font = `800 ${px}px ${font || SIGN_FONT}`; }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = fgHex;
  ctx.fillText(text, x + w / 2, y + h / 2 + px * 0.04);
}

/** Procedural kanji-like glyph column (no real characters): strokes composed from a small radical vocabulary. */
export function drawGlyphColumn(ctx, hex, x, y, w, h, seed, count = 4, lightbox = false) {
  const rng = createRng(seed);
  const cell = Math.min(w * 0.8, h / (count + 0.6));
  const x0 = x + (w - cell) / 2;
  if (lightbox) {
    ctx.fillStyle = mixHex(hex, '#000000', 0.2);
    ctx.fillRect(x + w * 0.06, y + h * 0.02, w * 0.88, h * 0.96);
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const strokeCol = lightbox ? '#141018' : mixHex(hex, '#ffffff', 0.55);
  for (let g = 0; g < count; g++) {
    const gy = y + (h - cell * count) / 2 + g * cell, m = cell * 0.16, s = cell - m * 2, ox = x0 + m, oy = gy + m;
    const lines = [];
    const split = rng() < 0.5 ? 0.38 + rng() * 0.12 : 0;
    const L = (a, b, c, d) => lines.push([ox + a * s, oy + b * s, ox + c * s, oy + d * s]);
    if (split) {
      // left radical
      L(split * 0.5, 0.05, split * 0.5, 0.95);
      if (rng() < 0.6) L(0.02, 0.35, split * 0.95, 0.3);
      if (rng() < 0.5) L(0.05, 0.7, split * 0.9, 0.55);
    }
    const sx = split ? split + 0.08 : 0.05;
    const nH = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < nH; i++) { const yy = 0.1 + (i + rng() * 0.3) * (0.8 / nH); L(sx, yy, 0.95, yy); }
    if (rng() < 0.7) { const xx = sx + (0.95 - sx) * (0.3 + rng() * 0.4); L(xx, 0.05, xx, 0.95); }
    if (rng() < 0.45) { L(sx, 0.55, sx, 0.95); L(sx, 0.95, 0.95, 0.95); L(0.95, 0.55, 0.95, 0.95); L(sx, 0.55, 0.95, 0.55); }
    if (rng() < 0.4) L(sx + 0.1, 0.35, 0.95, 0.9);
    if (rng() < 0.35) L(0.95, 0.3, sx + 0.05, 0.85);
    const lw = cell * 0.075;
    ctx.beginPath(); for (const l of lines) { ctx.moveTo(l[0], l[1]); ctx.lineTo(l[2], l[3]); }
    if (!lightbox) {
      ctx.strokeStyle = hex;
      glowStroke(ctx, cell, k => { ctx.lineWidth = k * 0.55; ctx.stroke(); });
      ctx.lineWidth = lw * 1.6; ctx.stroke();
    }
    ctx.strokeStyle = strokeCol; ctx.lineWidth = lw;
    ctx.stroke();
  }
}

export function mixHex(a, b, t) {
  const A = hexBytes(a), B = hexBytes(b);
  const h = v => b8(v).toString(16).padStart(2, '0');
  return `#${h(mix(A[0], B[0], t))}${h(mix(A[1], B[1], t))}${h(mix(A[2], B[2], t))}`;
}
