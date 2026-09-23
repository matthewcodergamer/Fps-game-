import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import { CreateBoxVertexData } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreatePlaneVertexData } from '@babylonjs/core/Meshes/Builders/planeBuilder.js';
import { CreateCylinderVertexData } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { CreateSphereVertexData } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { CreateDiscVertexData } from '@babylonjs/core/Meshes/Builders/discBuilder.js';
import { Matrix, Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate.js';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin.js';
import { createRng } from '../core/MathUtil.js';
import { MaterialLibrary, paletteUV, paletteColor, drawNeonText, drawLightbox, drawGlyphColumn } from '../render/MaterialLibrary.js';

/*
 * Night City vertical slice — one dense street block in real-world metres.
 *   x: across the street (road |x| ≤ 7, sidewalks 7…12, storefront planes at |x| = 12, plaza |x| ≤ 16)
 *   z: along the street (player spawns at z≈+9.5 looking toward −z; plaza pocket z −64…−80)
 *   y: up (road 0, sidewalks/plaza 0.15, elevated walkway & bridge 5.5)
 * Every visual piece is written straight into per-material vertex batches (world-space box-projected UVs so textures stay
 * at a constant texel density across merged pieces) → one draw call per material. Repeated props use thin instances.
 * Colliders are separate invisible boxes with PhysicsAggregate(BOX, mass 0) + metadata.surface. No lights are created.
 */

const SW = 0.15;          // sidewalk / plaza height
const WALK = 5.5;         // walkway / bridge deck height
const FACADE = 12;        // storefront plane |x|
const WHITE = [1, 1, 1];
const PI = Math.PI;

const toLin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lin = hex => { const c = Color3.FromHexString(hex); return [toLin(c.r), toLin(c.g), toLin(c.b)]; };

// ------------------------------------------------------------------------------------------------ geometry kit
class GeoKit {
  constructor(scene) {
    this.scene = scene;
    this.batches = new Map();
    this.T = {
      box: CreateBoxVertexData({ size: 1 }),
      plane: CreatePlaneVertexData({ size: 1 }),
      cyl6: CreateCylinderVertexData({ height: 1, diameter: 1, tessellation: 6 }),
      cyl8: CreateCylinderVertexData({ height: 1, diameter: 1, tessellation: 8 }),
      cyl12: CreateCylinderVertexData({ height: 1, diameter: 1, tessellation: 12 }),
      tube5: CreateCylinderVertexData({ height: 1, diameter: 1, tessellation: 5, cap: 0 }),
      cone8: CreateCylinderVertexData({ height: 1, diameterTop: 0.14, diameterBottom: 1, tessellation: 8 }),
      sphere: CreateSphereVertexData({ segments: 4, diameter: 1 }),
      disc: CreateDiscVertexData({ radius: 0.5, tessellation: 14 }),
    };
    this._a = new Matrix();
    this._b = new Matrix();
  }

  batch(key, material, o = {}) {
    let b = this.batches.get(key);
    if (!b) {
      b = { key, material, p: [], n: [], uv: [], c: o.colors ? [] : null, i: [], su: o.su ?? 0.25, sv: o.sv ?? o.su ?? 0.25,
        uo: o.uo ?? 0, vo: o.vo ?? 0, cast: o.cast ?? true, receive: o.receive ?? true };
      this.batches.set(key, b);
    }
    return b;
  }

  /** Local transform matrix (scratch). */
  M(x, y, z, ry = 0, rx = 0, rz = 0) {
    Matrix.RotationYawPitchRollToRef(ry, rx, rz, this._a);
    this._a.setTranslationFromFloats(x, y, z);
    return this._a;
  }
  /** Local transform composed with a facade frame (scratch). */
  FM(F, x, y, z, ry = 0, rx = 0, rz = 0) {
    this.M(x, y, z, ry, rx, rz).multiplyToRef(F, this._b);
    return this._b;
  }

  /**
   * Append template geometry. s = template-space scale, m = rotation+translation.
   * uv modes: 'world' (box projection of world position, metres × batch scale), 'local' (same in object space),
   * 'rect' (template UVs remapped into [u0,v0,u1,v1]), 'const' (single UV — neon palette), 'tmpl'.
   */
  add(b, T, m, sx, sy, sz, o) {
    const P = T.positions, N = T.normals, U = T.uvs, I = T.indices, mm = m.m;
    const base = b.p.length / 3, mode = o?.uv || 'world', col = o?.color || WHITE;
    const su = o?.su ?? b.su, sv = o?.sv ?? b.sv, uo = o?.uo ?? b.uo, vo = o?.vo ?? b.vo, rect = o?.rect, uvc = o?.uvc;
    for (let k = 0, t = 0; k < P.length; k += 3, t += 2) {
      const lx = P[k] * sx, ly = P[k + 1] * sy, lz = P[k + 2] * sz;
      const wx = lx * mm[0] + ly * mm[4] + lz * mm[8] + mm[12];
      const wy = lx * mm[1] + ly * mm[5] + lz * mm[9] + mm[13];
      const wz = lx * mm[2] + ly * mm[6] + lz * mm[10] + mm[14];
      const nx0 = N[k] / sx, ny0 = N[k + 1] / sy, nz0 = N[k + 2] / sz;
      let nx = nx0 * mm[0] + ny0 * mm[4] + nz0 * mm[8], ny = nx0 * mm[1] + ny0 * mm[5] + nz0 * mm[9], nz = nx0 * mm[2] + ny0 * mm[6] + nz0 * mm[10];
      const inv = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
      nx *= inv; ny *= inv; nz *= inv;
      b.p.push(wx, wy, wz);
      b.n.push(nx, ny, nz);
      let u, v;
      if (mode === 'world' || mode === 'local') {
        const w = mode === 'world';
        const px = w ? wx : lx, py = w ? wy : ly, pz = w ? wz : lz;
        const ax = Math.abs(w ? nx : N[k]), ay = Math.abs(w ? ny : N[k + 1]), az = Math.abs(w ? nz : N[k + 2]);
        if (ay >= ax && ay >= az) { u = px; v = pz; } else if (ax >= az) { u = pz; v = py; } else { u = px; v = py; }
        u = u * su + uo; v = v * sv + vo;
      } else if (mode === 'rect') {
        u = rect[0] + U[t] * (rect[2] - rect[0]); v = rect[1] + U[t + 1] * (rect[3] - rect[1]);
      } else if (mode === 'const') { u = uvc[0]; v = uvc[1]; }
      else { u = U[t] * su; v = U[t + 1] * sv; }
      b.uv.push(u, v);
      if (b.c) b.c.push(col[0], col[1], col[2], 1);
    }
    for (let k = 0; k < I.length; k++) b.i.push(base + I[k]);
  }

  box(b, x, y, z, w, h, d, o) { this.add(b, this.T.box, this.M(x, y, z, o?.ry, o?.rx, o?.rz), w, h, d, o); }
  fbox(b, F, x, y, z, w, h, d, o) { this.add(b, this.T.box, this.FM(F, x, y, z, o?.ry, o?.rx, o?.rz), w, h, d, o); }
  cyl(b, x, y, z, r, h, o) { this.add(b, this.T[o?.seg ? `cyl${o.seg}` : 'cyl8'], this.M(x, y, z, o?.ry, o?.rx, o?.rz), r * 2, h, r * 2, o); }
  /** Cylinder / tube between two points. */
  seg(b, ax, ay, az, bx, by, bz, r, o) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-4;
    const yaw = Math.atan2(dx, dz), pitch = Math.acos(Math.max(-1, Math.min(1, dy / len)));
    this.add(b, this.T[o?.tmpl || 'cyl6'], this.M((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, yaw, pitch, 0), r * 2, len, r * 2, o);
  }
  /** Quad facing local +z of frame F (plane template faces −z, so rotate by π). */
  fquad(b, F, x, y, z, w, h, o, ry = PI) { this.add(b, this.T.plane, this.FM(F, x, y, z, ry, 0, 0), w, h, 1, o); }

  finalize(scene) {
    const out = [];
    for (const b of this.batches.values()) {
      if (!b.p.length) continue;
      const mesh = new Mesh(`world-${b.key}`, scene);
      const vd = new VertexData();
      vd.positions = new Float32Array(b.p);
      vd.normals = new Float32Array(b.n);
      vd.uvs = new Float32Array(b.uv);
      if (b.c) vd.colors = new Float32Array(b.c);
      vd.indices = b.p.length / 3 > 65535 ? new Uint32Array(b.i) : new Uint16Array(b.i);
      vd.applyToMesh(mesh, false);
      finishStatic(mesh, b.material, b.receive);
      mesh.metadata = { worldBatch: b.key, cast: b.cast };
      out.push(mesh);
    }
    return out;
  }
}

function finishStatic(mesh, material, receive) {
  mesh.material = material;
  mesh.isPickable = false;
  mesh.receiveShadows = !!receive;
  // thin-instance meshes keep the instance-wide bounds computed by thinInstanceRefreshBoundingInfo()
  if (mesh.hasThinInstances) mesh.thinInstanceRefreshBoundingInfo(false);
  else mesh.refreshBoundingInfo();
  mesh.freezeWorldMatrix();
  mesh.doNotSyncBoundingInfo = true;
}

/** Facade frame: local x along the facade, y up, z out of the facade toward the street. */
function frame(ox, oz, ry) {
  const m = Matrix.RotationYawPitchRoll(ry, 0, 0);
  m.setTranslationFromFloats(ox, 0, oz);
  return m;
}

// ------------------------------------------------------------------------------------------------ sign atlas
const ATLAS = [
  { key: 'NOODLES', rect: [0, 0.0, 0.5, 0.1], color: 'magenta', draw: (c, x, y, w, h) => drawNeonText(c, 'NOODLES', '#ff1fd2', x, y, w, h) },
  { key: 'HOTEL', rect: [0, 0.1, 0.5, 0.1], color: 'amber', draw: (c, x, y, w, h) => drawNeonText(c, 'HOTEL', '#ff9a1f', x, y, w, h, null, { weight: '800' }) },
  { key: '24/7', rect: [0, 0.2, 0.5, 0.1], color: 'white', draw: (c, x, y, w, h) => drawLightbox(c, '24/7  OPEN', '#dff4ff', '#c8102a', x, y, w, h) },
  { key: 'CLINIC', rect: [0, 0.3, 0.5, 0.1], color: 'green', draw: (c, x, y, w, h) => { drawNeonText(c, '+ CLINIC', '#2dff86', x, y, w, h); } },
  { key: 'ARCADE', rect: [0, 0.4, 0.5, 0.1], color: 'violet', draw: (c, x, y, w, h) => drawNeonText(c, 'ARCADE', '#b35cff', x, y, w, h, null, { weight: '900' }) },
  { key: 'RAMEN', rect: [0, 0.5, 0.5, 0.1], color: 'red', draw: (c, x, y, w, h) => drawLightbox(c, 'RAMEN', '#ff2a2a', '#fff2dc', x, y, w, h) },
  { key: 'BAR', rect: [0, 0.6, 0.5, 0.1], color: 'pink', draw: (c, x, y, w, h) => drawNeonText(c, 'BAR', '#ff3d8b', x, y, w, h, null, { scale: 0.7 }) },
  { key: 'NO RETREAT', rect: [0, 0.7, 0.5, 0.1], color: 'cyan', draw: (c, x, y, w, h) => drawNeonText(c, 'NO RETREAT', '#00eaff', x, y, w, h) },
  { key: 'WIDE', rect: [0, 0.8, 0.5, 0.2], color: 'magenta', draw: drawWideAd },
  { key: 'V0', rect: [0.5, 0, 0.1, 0.5], color: 'magenta', draw: (c, x, y, w, h) => drawGlyphColumn(c, '#ff1fd2', x, y, w, h, 11, 5) },
  { key: 'V1', rect: [0.6, 0, 0.1, 0.5], color: 'cyan', draw: (c, x, y, w, h) => drawGlyphColumn(c, '#00eaff', x, y, w, h, 23, 4) },
  { key: 'V2', rect: [0.7, 0, 0.1, 0.5], color: 'yellow', draw: (c, x, y, w, h) => drawGlyphColumn(c, '#ffd21a', x, y, w, h, 37, 4, true) },
  { key: 'V3', rect: [0.8, 0, 0.1, 0.5], color: 'red', draw: (c, x, y, w, h) => drawGlyphColumn(c, '#ff1a2a', x, y, w, h, 51, 5) },
  { key: 'V4', rect: [0.9, 0, 0.1, 0.5], color: 'teal', draw: (c, x, y, w, h) => drawGlyphColumn(c, '#00ffc6', x, y, w, h, 67, 4, true) },
  { key: 'SYNTH', rect: [0.5, 0.5, 0.25, 0.5], color: 'pink', draw: drawSynthAd },
  { key: 'ZERO', rect: [0.75, 0.5, 0.25, 0.5], color: 'cyan', draw: drawZeroAd },
];
const SIGN_COLOR = Object.fromEntries(ATLAS.map(e => [e.key, e.color]));

function drawSynthAd(c, x, y, w, h) {
  const g = c.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, '#10002a'); g.addColorStop(0.55, '#4c0a70'); g.addColorStop(1, '#ff2a8a');
  c.fillStyle = g; c.fillRect(x, y, w, h);
  const cx = x + w / 2, cy = y + h * 0.4, r = w * 0.34;
  const sg = c.createLinearGradient(0, cy - r, 0, cy + r);
  sg.addColorStop(0, '#ffe45a'); sg.addColorStop(1, '#ff2a7a');
  c.fillStyle = sg; c.beginPath(); c.arc(cx, cy, r, 0, PI * 2); c.fill();
  c.fillStyle = '#2a0540';
  for (let i = 0; i < 6; i++) c.fillRect(cx - r, cy + r * (0.08 + i * 0.16), r * 2, r * 0.025 * (i + 1));
  const hz = y + h * 0.62;
  c.fillStyle = '#12002a'; c.fillRect(x, hz, w, h * 0.38);
  c.strokeStyle = '#00eaff'; c.lineWidth = Math.max(1, w * 0.008);
  c.beginPath();
  for (let i = -6; i <= 6; i++) { c.moveTo(cx + i * w * 0.04, hz); c.lineTo(cx + i * w * 0.35, y + h); }
  for (let i = 0; i < 7; i++) { const t = Math.pow(i / 7, 1.8); c.moveTo(x, hz + t * h * 0.38); c.lineTo(x + w, hz + t * h * 0.38); }
  c.stroke();
  drawNeonText(c, 'SYNTH//9', '#00eaff', x, y + h * 0.03, w, h * 0.13);
  drawNeonText(c, 'DREAM IN NEON', '#ffffff', x, y + h * 0.85, w, h * 0.09, null, { weight: '600' });
}

function drawZeroAd(c, x, y, w, h) {
  const g = c.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#001a2e'); g.addColorStop(1, '#003d4d');
  c.fillStyle = g; c.fillRect(x, y, w, h);
  const cx = x + w / 2, cy = y + h * 0.42;
  c.strokeStyle = '#00eaff';
  c.beginPath(); c.arc(cx, cy, w * 0.3, 0, PI * 2);
  for (const [lw, a] of [[0.12, 0.08], [0.07, 0.16], [0.03, 1]]) { c.globalAlpha = a; c.lineWidth = w * lw; c.stroke(); }
  c.globalAlpha = 1;
  c.fillStyle = '#ff1fd2';
  c.beginPath(); c.moveTo(cx, cy - w * 0.2); c.lineTo(cx + w * 0.18, cy + w * 0.13); c.lineTo(cx - w * 0.18, cy + w * 0.13); c.closePath(); c.fill();
  drawGlyphColumn(c, '#ffd21a', x + w * 0.02, y + h * 0.02, w * 0.18, h * 0.5, 91, 4);
  drawNeonText(c, 'ZERO G', '#00eaff', x, y + h * 0.66, w, h * 0.13, null, { weight: '900' });
  c.fillStyle = '#dff4ff';
  for (let i = 0; i < 26; i++) { const bw = (i * 7919 % 5 + 1) * w * 0.006; c.fillRect(x + w * 0.12 + i * w * 0.029, y + h * 0.84, bw, h * 0.07); }
}

function drawWideAd(c, x, y, w, h) {
  const g = c.createLinearGradient(x, y, x + w, y);
  g.addColorStop(0, '#2a0033'); g.addColorStop(0.5, '#6a0040'); g.addColorStop(1, '#001c3a');
  c.fillStyle = g; c.fillRect(x, y, w, h);
  // stylised face silhouette + scanlines
  c.fillStyle = '#ff5ab4';
  c.beginPath(); c.ellipse(x + w * 0.2, y + h * 0.52, h * 0.26, h * 0.34, 0, 0, PI * 2); c.fill();
  c.fillStyle = '#2a0033';
  c.fillRect(x + w * 0.2 - h * 0.2, y + h * 0.45, h * 0.4, h * 0.06);
  c.fillStyle = 'rgba(0,0,0,0.35)';
  for (let yy = 0; yy < h; yy += Math.max(2, h * 0.03)) c.fillRect(x, y + yy, w, Math.max(1, h * 0.012));
  drawNeonText(c, 'KAMI BIOWARE', '#00eaff', x + w * 0.34, y + h * 0.1, w * 0.64, h * 0.42, null, { weight: '900' });
  drawNeonText(c, 'UPGRADE YOUR SOUL', '#ffd21a', x + w * 0.34, y + h * 0.52, w * 0.64, h * 0.3, null, { weight: '600' });
}

// ------------------------------------------------------------------------------------------------ level data
// Buildings: side R (x>0, facade faces −x), L (x<0, faces +x), F (far end, faces +z), B (behind spawn, faces −z).
const BUILDINGS = [
  { id: 'R0', side: 'R', a: 14.5, b: 44, h: 30, style: 'walkup', mat: 'brick', bays: [{ w: 7, type: 'shutter' }, { w: 8, type: 'shop', shop: 0, sign: 'RAMEN', awning: '#a81c28' }, { w: 7, type: 'shutter' }] },
  { id: 'R1', side: 'R', a: -4, b: 14.5, h: 38, style: 'tower', bays: [{ w: 6, type: 'shop', shop: 1, sign: 'HOTEL' }, { w: 5, type: 'door' }, { w: 6.5, type: 'shop', shop: 2, sign: 'NOODLES', awning: '#1a7f86' }], blade: [{ at: 3.2, y: 6.2, h: 7, key: 'V0' }], strip: 'magenta' },
  { id: 'R2', side: 'R', a: -19.5, b: -4, h: 24, style: 'pacifica', bays: [{ w: 6, type: 'shutter' }, { w: 5, type: 'vending' }, { w: 4.5, type: 'shop', shop: 3, sign: '24/7' }], blade: [{ at: 13.5, y: 5.2, h: 6, key: 'V2' }] },
  { id: 'R3', side: 'R', a: -47, b: -19.5, h: 46, style: 'tower', bays: [{ w: 6.5, type: 'shop', shop: 1, sign: 'CLINIC' }, { w: 6, type: 'shutter' }], holo: { at: 15, y: 15, w: 7, h: 14, key: 'ZERO' }, cornerNeon: 'cyan' },
  { id: 'R4', side: 'R', a: -64, b: -47, h: 22, style: 'walkup', mat: 'plaster', bays: [{ w: 8, type: 'shop', shop: 2, sign: 'ARCADE', awning: '#5a1c9c' }, { w: 7, type: 'shutter' }], blade: [{ at: 15.5, y: 5.4, h: 6.5, key: 'V3' }] },
  { id: 'L0', side: 'L', a: 14.5, b: 44, h: 26, style: 'pacifica', bays: [{ w: 8, type: 'shutter' }, { w: 8, type: 'shop', shop: 3, sign: 'BAR' }] },
  { id: 'L1', side: 'L', a: -9, b: 14.5, h: 32, style: 'walkup', mat: 'brick', bays: [{ w: 7, type: 'shop', shop: 0, sign: 'NOODLES', awning: '#b3202a' }, { w: 6, type: 'shop', shop: 2, sign: 'RAMEN' }, { w: 6, type: 'shutter' }], blade: [{ at: 4.5, y: 5.6, h: 7.5, key: 'V1' }, { at: 17.5, y: 6.0, h: 6, key: 'V4' }], holo: { at: 11, y: 14.5, w: 6, h: 12, key: 'SYNTH' } },
  { id: 'L2', side: 'L', a: -27, b: -9, h: 20, style: 'walkup', mat: 'plaster', bays: [{ w: 5.5, type: 'shutter' }, { w: 7, type: 'shop', shop: 3, sign: 'BAR', awning: '#1f4fb3' }, { w: 4.5, type: 'door' }], strip: 'pink' },
  { id: 'L3', side: 'L', a: -48, b: -27, h: 42, style: 'tower', bays: [{ w: 5, type: 'shutter' }, { w: 6.5, type: 'shop', shop: 1, sign: '24/7' }, { w: 7, type: 'shop', shop: 0, sign: 'HOTEL' }], blade: [{ at: 2.8, y: 8.5, h: 7, key: 'V2' }], cornerNeon: 'magenta' },
  { id: 'L4', side: 'L', a: -64, b: -48, h: 28, style: 'pacifica', bays: [{ w: 7, type: 'shop', shop: 2, sign: 'ARCADE' }, { w: 7, type: 'shutter' }], blade: [{ at: 13, y: 5.5, h: 6.5, key: 'V0' }], strip: 'cyan' },
  { id: 'PL', side: 'L', x: -16, a: -80, b: -64, h: 16, style: 'walkup', mat: 'brick', bays: [{ w: 6, type: 'shutter' }, { w: 7, type: 'shop', shop: 0, sign: 'RAMEN' }] },
  { id: 'PR', side: 'R', x: 16, a: -80, b: -64, h: 18, style: 'pacifica', bays: [{ w: 7, type: 'shop', shop: 1, sign: 'CLINIC' }, { w: 6, type: 'vending' }] },
  { id: 'FAR', side: 'F', z: -80, a: -34, b: 34, h: 58, style: 'tower', start: 18.5, bays: [{ w: 7, type: 'shutter' }, { w: 9, type: 'shop', shop: 2, sign: 'ARCADE' }, { w: 8, type: 'shop', shop: 1, sign: 'HOTEL' }, { w: 7, type: 'shutter' }], holo: { at: 34, y: 12.5, w: 16, h: 6.4, key: 'WIDE' }, cornerNeon: 'magenta' },
  { id: 'BACK', side: 'B', z: 48, a: -34, b: 34, h: 40, style: 'pacifica', start: 25, bays: [{ w: 10, type: 'shutter' }, { w: 8, type: 'shop', shop: 3, sign: 'NOODLES' }], holo: { at: 34, y: 11, w: 12, h: 4.8, key: 'WIDE' } },
];
const DEPTH = 14;

export function createVerticalSlice(scene, profile = {}, materials = null) {
  materials ||= new MaterialLibrary(scene, profile);    // integrator should pass the shared library
  const tier = profile.tier || 'MOBILE';
  const propDensity = profile.world?.propDensity ?? 0.7;
  const skylineDensity = profile.world?.skylineDensity ?? 0.5;
  const rng = createRng(20770);
  const G = new GeoKit(scene);
  const M = n => materials.get(n);

  // ---------------------------------------------------------------- batches (one draw call each)
  const B = {
    road: G.batch('asphalt', M('asphaltWet'), { su: 1 / 5.5, cast: false }),
    side: G.batch('sidewalk', M('sidewalkTile'), { su: 1 / 2, cast: false }),
    con: G.batch('concrete', M('concrete'), { su: 1 / 3 }),
    conD: G.batch('concreteDark', M('concreteDark'), { su: 1 / 3 }),
    brick: G.batch('brick', M('brick'), { su: 1 / 1.3, sv: 1 / 1.2 }),
    plaster: G.batch('plaster', M('plasterWhite'), { su: 1 / 3 }),
    siding: G.batch('siding', M('woodSiding'), { su: 1 / 1.6 }),
    teal: G.batch('metalPainted', M('metalPainted'), { su: 1 / 2.5 }),
    tint: G.batch('paintTint', M('paintTint'), { su: 1 / 2.5, colors: true }),
    dark: G.batch('metalDark', M('metalDark'), { su: 1 / 1.5 }),
    rust: G.batch('metalRust', M('metalRust'), { su: 1 / 2 }),
    glass: G.batch('glassDark', M('glassDark'), {}),
    rubber: G.batch('rubber', M('rubber'), {}),
    yellow: G.batch('plasticYellow', M('plasticYellow'), { su: 1 / 2.5 }),
    hazard: G.batch('hazard', M('hazardStripe'), { su: 1 / 1.2 }),
    win: G.batch('windowGrid', M('windowGrid'), { su: 1 / 24, sv: 1 / 28, vo: -4.5 / 28 }),
    shop: G.batch('shopWindow', M('shopWindow'), { cast: false }),
    shutter: G.batch('shutter', M('shutter'), { su: 1 / 2.2 }),
    paint: G.batch('roadPaint', M('roadPaint'), { su: 1 / 3, colors: true, cast: false }),
    puddle: G.batch('puddle', M('puddle'), { cast: false }),
    car: G.batch('carPaint', M('carPaint'), { colors: true }),
    neon: G.batch('neon', M('neonPalette'), { cast: false, receive: false }),
    signs: null,
  };
  const atlasSize = (profile.textures?.size || 512) >= 1024 ? 1024 : 512;
  const atlas = materials.signAtlas('street', ATLAS, atlasSize, 2.6);
  B.signs = G.batch('signs', atlas.material, { cast: false, receive: false });

  const neonAnchors = [], lampAnchors = [], coverPoints = [], steamVents = [], colliders = [];
  const NEON = (x, y, z, color, intensity = 10, range = 8, flicker = 0) => neonAnchors.push({
    position: new Vector3(x, y, z), color: typeof color === 'string' ? paletteColor(color) : color, intensity, range, flicker,
  });
  const neonC = (name, dim) => ({ uv: 'const', uvc: paletteUV(name, dim) });

  // ---------------------------------------------------------------- colliders
  // Colliders are geometry-free TransformNodes carrying a Havok box (explicit extents): never rendered, never part of
  // scene.meshes / isReady / default-material checks, but raycasts return them as body.transformNode with metadata.surface.
  const collider = (name, x, y, z, w, h, d, surface, o = {}) => {
    const n = new TransformNode(`col-${name}`, scene);
    n.position.set(x, y, z);
    n.rotationQuaternion = Quaternion.RotationYawPitchRoll(o.ry || 0, o.rx || 0, o.rz || 0);
    n.metadata = { surface, collider: true, size: [w, h, d], ...(o.meta || {}) };
    new PhysicsAggregate(n, PhysicsShapeType.BOX, { mass: 0, friction: o.friction ?? 0.8, restitution: 0.05, extents: new Vector3(w, h, d), center: Vector3.Zero() }, scene);
    n.freezeWorldMatrix();
    colliders.push(n);
    return n;
  };
  const colliderAABB = (name, x0, y0, z0, x1, y1, z1, surface, o) =>
    collider(name, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), surface, o);

  // ============================================================================================ GROUND
  // Road (visual), sidewalks, curbs, plaza.
  G.box(B.road, 0, -0.05, -8, 14.2, 0.1, 112);                                  // z 48 … −64
  colliderAABB('ground', -40, -1, -110, 40, 0, 80, 'asphalt');
  for (const s of [-1, 1]) {
    G.box(B.side, s * 9.65, SW / 2, -8, 4.7, SW, 112);                          // pavers |x| 7.3 … 12
    G.box(B.con, s * 7.15, SW / 2, -8, 0.3, SW, 112);                          // curb stone
    colliderAABB(`sidewalk${s}`, s * 7, -0.5, -64, s * FACADE, SW, 48, 'concrete');
    // curb ramp collider (the character controller cannot step 15 cm): 0.6 m wedge rising onto the sidewalk
    const ang = Math.atan2(SW, 0.6);
    collider(`curbRamp${s}`, s * (6.7 + Math.sin(ang) * 0.05), SW / 2 - Math.cos(ang) * 0.05, -8, 0.62, 0.1, 112, 'concrete', { rz: s * ang });
    // gutter grates
    for (let z = 40; z > -62; z -= 13) G.box(B.dark, s * 6.72, 0.004, z, 0.35, 0.02, 0.9);
  }
  // plaza slab (z −64 … −80, |x| ≤ 16) with its own curb toward the road end
  G.box(B.con, 0, SW / 2, -72.15, 32, SW, 16.3);
  colliderAABB('plaza', -16.5, -0.5, -80.5, 16.5, SW, -64, 'concrete');
  { const ang = Math.atan2(SW, 0.6); collider('plazaRamp', 0, SW / 2 - Math.cos(ang) * 0.05, -63.7 - Math.sin(ang) * 0.05, 14.2, 0.1, 0.62, 'concrete', { rx: ang }); }
  // yellow-painted curb near the plaza (Pacifica)
  G.box(B.yellow, 0, SW + 0.004, -64.05, 14, 0.01, 0.3);

  // Road markings: centre double yellow, edge lines, stop lines (merged); lane dashes + zebra stripes (thin instances)
  const yellowLine = lin('#ffc21a');
  for (const x of [-0.14, 0.14]) G.box(B.paint, x, 0.006, -8, 0.12, 0.012, 111, { color: yellowLine, uv: 'local', su: 1 / 3 });
  for (const s of [-1, 1]) G.box(B.paint, s * 6.55, 0.006, -8, 0.14, 0.012, 111, { uv: 'local', su: 1 / 3 });
  for (const z of [3.2, -58.8]) G.box(B.paint, 0, 0.006, z, 13, 0.012, 0.4, { uv: 'local' });
  const paintMats = [];
  const pushM = (list, x, y, z, sx, sy, sz, ry = 0) => {
    const m = Matrix.Compose(new Vector3(sx, sy, sz), Quaternion.RotationYawPitchRoll(ry, 0, 0), new Vector3(x, y, z));
    list.push(m);
  };
  for (const x of [-3.5, 3.5]) for (let z = 46; z > -60; z -= 9) pushM(paintMats, x, 0.006, z, 0.14, 0.012, 3);
  for (const zc of [5.4, -61.2]) for (let x = -6; x <= 6.01; x += 1.0) pushM(paintMats, x, 0.006, zc, 0.5, 0.012, 3.4);

  // Puddles (black mirrors; reflections come from the environment probe / SSR) + manholes (steam vents)
  const puddles = [[5.8, -6, 2.6, 1.3], [-6.1, -14, 3.4, 1.1], [1.6, -18.5, 1.8, 1.2], [-2.4, -27, 2.8, 1.8], [6.0, -31, 3.0, 1.0],
    [-5.6, -39, 2.2, 1.4], [2.4, -45, 3.6, 2.0], [-1.2, -52, 2.0, 1.3], [5.5, -55, 2.6, 1.2], [-6.2, -58, 3.2, 1.0],
    [0.5, 2.0, 2.2, 1.1], [-3.6, 9.5, 2.0, 1.0], [3, -71, 2.4, 1.6], [-8, -76, 1.8, 1.2], [-9.8, -30.5, 1.5, 0.8], [9.4, -15, 1.6, 0.9]];
  for (const [x, z, w, d] of puddles) {
    const y = Math.abs(x) > 7.2 || z < -64 ? SW + 0.003 : 0.004;
    addPuddle(G, B.puddle, x, y, z, w, d, rng);
  }
  for (const [x, z] of [[-2.2, -16], [3.6, -40], [0.8, -60.5], [-4.4, 1.5]]) {
    G.cyl(B.dark, x, 0.006, z, 0.36, 0.012, { seg: 12 });
    steamVents.push(new Vector3(x, 0.02, z));
  }
  steamVents.push(new Vector3(12.4, SW + 1.3, -73.4));                           // noodle kiosk kettle
  steamVents.push(new Vector3(-11.4, SW + 0.3, -24.0));                           // dumpster alley vent

  // ============================================================================================ BUILDINGS
  const MINI = ['V1', 'V3', 'V0', 'V4', 'V2'];
  let miniIdx = 0;
  const br2 = createRng(99);
  for (const def of BUILDINGS) buildBuilding(def);

  function buildingFrame(def) {
    const L = def.b - def.a;
    if (def.side === 'R') { const x = def.x ?? FACADE; return { F: frame(x, def.a, -PI / 2), L, aabb: [x, def.a, x + DEPTH, def.b] }; }
    if (def.side === 'L') { const x = def.x ?? -FACADE; return { F: frame(x, def.b, PI / 2), L, aabb: [x - DEPTH, def.a, x, def.b] }; }
    if (def.side === 'F') return { F: frame(def.a, def.z, 0), L, aabb: [def.a, def.z - DEPTH, def.b, def.z] };
    return { F: frame(def.b, def.z, PI), L, aabb: [def.a, def.z, def.b, def.z + DEPTH] };
  }

  function buildBuilding(def) {
    const { F, L, aabb } = buildingFrame(def);
    const h = def.h, D = DEPTH;
    const massB = def.style === 'tower' ? B.win : def.mat === 'brick' ? B.brick : def.mat === 'plaster' ? B.plaster : B.con;
    const br = createRng(def.id.charCodeAt(0) * 131 + def.id.charCodeAt(1) * 17);
    colliderAABB(`bld-${def.id}`, aabb[0], 0, aabb[1], aabb[2], h, aabb[3], 'concrete');

    if (def.style === 'tower') {
      G.fbox(B.win, F, L / 2, (4.5 + h) / 2, -D / 2, L, h - 4.5, D);
      G.fbox(B.conD, F, L / 2, 2.25, -D / 2 + 0.06, L, 4.5, D + 0.12);         // podium
      for (let y = 4.5; y < h - 2; y += 7) G.fbox(B.con, F, L / 2, y, 0.16, L + 0.2, 0.26, 0.5);
      G.fbox(B.conD, F, 0.35, h / 2, 0.12, 0.7, h, 0.5);
      G.fbox(B.conD, F, L - 0.35, h / 2, 0.12, 0.7, h, 0.5);
      G.fbox(B.conD, F, L / 2, h + 0.5, -D / 2, L + 0.2, 1.0, D + 0.2);         // crown / parapet
      const crown = def.cornerNeon || def.strip || 'violet';
      G.fbox(B.neon, F, L / 2, h + 1.03, 0.13, L + 0.2, 0.07, 0.07, neonC(crown));
      G.fbox(B.neon, F, L / 2, h - 0.02, 0.13, L + 0.2, 0.05, 0.05, neonC(crown, true));
    } else if (def.style === 'walkup') {
      G.fbox(massB, F, L / 2, h / 2, -D / 2, L, h, D);
      G.fbox(B.con, F, L / 2, 4.6, 0.12, L, 0.3, 0.26);                          // storefront cornice
      G.fbox(B.con, F, L / 2, h - 0.2, 0.2, L + 0.3, 0.5, 0.5);                  // roof cornice
      const n = Math.max(2, Math.floor((L - 1) / 3.1)), step = L / n;
      for (let y = 5.3; y < h - 2.6; y += 3.4) {
        for (let i = 0; i < n; i++) {
          const x = step * (i + 0.5);
          const cell = Math.floor(br() * 64), cx = cell % 8, cy = Math.floor(cell / 8);
          const rect = [(cx + 0.1) / 8, (cy + 0.26) / 8, (cx + 0.9) / 8, (cy + 0.93) / 8];
          G.fquad(B.win, F, x, y + 1.0, 0.03, 1.35, 1.9, { uv: 'rect', rect });
          G.fbox(B.con, F, x, y - 0.02, 0.1, 1.6, 0.1, 0.22);
          G.fbox(B.con, F, x, y + 2.05, 0.05, 1.55, 0.18, 0.1);
          const r = br();
          if (r < 0.22) G.fbox(B.dark, F, x + 0.2, y - 0.4, 0.28, 0.85, 0.55, 0.5);          // AC unit
          else if (r < 0.3 && y < 14) {                                                            // yellow-rail balcony
            G.fbox(B.dark, F, x, y - 0.05, 0.55, 2.3, 0.08, 1.0);
            G.fbox(B.yellow, F, x, y + 0.95, 1.02, 2.3, 0.05, 0.05);
            G.fbox(B.yellow, F, x - 1.13, y + 0.45, 0.55, 0.05, 1.0, 1.0);
            G.fbox(B.yellow, F, x + 1.13, y + 0.45, 0.55, 0.05, 1.0, 1.0);
            for (let k = -1; k <= 1; k += 0.5) G.fbox(B.yellow, F, x + k * 1.1, y + 0.45, 1.02, 0.035, 1.0, 0.035);
          }
        }
      }
      // drain pipe
      G.add(B.rust, G.T.cyl6, G.FM(F, L - 0.5, h / 2, 0.12), 0.14, h, 0.14);
    } else { // pacifica: concrete + teal cladding bands + ribbon windows
      G.fbox(B.con, F, L / 2, h / 2, -D / 2, L, h, D);
      G.fbox(B.teal, F, L / 2, 4.55, 0.1, L, 0.5, 0.2);
      let k = 0;
      for (let y = 4.5; y < h - 2; y += 3.5, k++) {
        G.fbox(B.win, F, L / 2, y + 2.1, 0.04, L - 1.2, 2.4, 0.08);
        G.fbox(B.teal, F, L / 2, y + 0.35, 0.09, L - 0.4, 1.1, 0.18, { color: WHITE });
        if (k % 3 === 1) G.fbox(B.neon, F, L / 2, y + 0.93, 0.2, L - 0.6, 0.06, 0.06, neonC('cyan'));
      }
      G.fbox(B.teal, F, L / 2, h - 0.3, 0.12, L + 0.1, 0.6, 0.3);
      // exposed service stair / yellow rails on the corner
      G.fbox(B.yellow, F, 0.6, h * 0.5, 0.35, 0.06, h - 6, 0.06);
      G.fbox(B.yellow, F, 1.3, h * 0.5, 0.35, 0.06, h - 6, 0.06);
    }

    // rooftop clutter
    for (let i = 0; i < 3; i++) {
      const x = L * (0.2 + 0.3 * i) + br() * 2, z = -2.5 - br() * (D - 5);
      if (br() < 0.5) G.fbox(B.dark, F, x, h + 0.9, z, 2.2, 1.4, 1.6);
      else G.add(B.rust, G.T.cyl8, G.FM(F, x, h + 2.1, z), 2.4, 3.2, 2.4);
    }
    G.add(B.dark, G.T.cyl6, G.FM(F, L * 0.7, h + 4, -3), 0.12, 8, 0.12);          // antenna mast
    G.fbox(B.neon, F, L * 0.7, h + 8.05, -3, 0.18, 0.18, 0.18, neonC('red'));        // aviation light

    // floor-line neon strip above the storefronts
    if (def.strip) {
      G.fbox(B.neon, F, L / 2, 4.85, 0.3, L - 0.6, 0.07, 0.07, neonC(def.strip));
      for (let x = 4; x < L; x += 9) { const p = worldOf(F, x, 4.9, 0.9); NEON(p.x, p.y, p.z, def.strip, 5, 7, 0); }
    }
    if (def.cornerNeon) {
      for (const x of [0.75, L - 0.75]) {
        G.fbox(B.neon, F, x, (4.8 + h - 1) / 2, 0.42, 0.08, h - 6, 0.08, neonC(def.cornerNeon));
      }
      const p = worldOf(F, 0.8, 9, 1.2); NEON(p.x, p.y, p.z, def.cornerNeon, 8, 10, 0);
    }

    // storefront bays
    let x = def.start ?? 0.8;
    for (const bay of def.bays || []) { storefront(F, x, bay, def); x += bay.w; }
    for (const bl of def.blade || []) bladeSign(F, bl.at, bl.y, bl.h, bl.key);
    if (def.holo) holo(F, def.holo.at, def.holo.y, def.holo.w, def.holo.h, def.holo.key);
  }

  function worldOf(F, x, y, z) { return Vector3.TransformCoordinates(new Vector3(x, y, z), F); }

  function storefront(F, x0, bay, def) {
    const w = bay.w, xc = x0 + w / 2, frameB = def.style === 'walkup' && def.mat === 'brick' ? B.conD : B.dark;
    // piers
    G.fbox(frameB, F, x0 + 0.15, 2.25, 0.08, 0.3, 4.5, 0.2);
    G.fbox(frameB, F, x0 + w - 0.15, 2.25, 0.08, 0.3, 4.5, 0.2);
    const gw = w - 0.3;
    if (bay.type === 'shop') {
      const q = bay.shop ?? 0, qx = q & 1, qy = q >> 1;
      G.fquad(B.shop, F, xc, 1.8, 0.015, gw, 2.9, { uv: 'rect', rect: [qx * 0.5 + 0.02, qy * 0.5 + 0.02, qx * 0.5 + 0.48, qy * 0.5 + 0.48] });
      G.fbox(B.dark, F, xc, 0.18, 0.05, gw, 0.36, 0.1);                               // kick plate
      G.fbox(B.dark, F, xc, 3.28, 0.05, gw, 0.08, 0.1);                               // transom
      for (let k = 1; k < 3; k++) G.fbox(B.dark, F, x0 + 0.15 + gw * k / 3, 1.8, 0.05, 0.06, 2.9, 0.08);
      G.fquad(B.glass, F, x0 + 0.95, 1.46, 0.07, 1.1, 2.2, null);                      // door
      G.fbox(B.dark, F, x0 + 1.35, 1.15, 0.1, 0.04, 0.5, 0.04);
      colliderAABBf(F, `glass-${def.id}-${x0 | 0}`, x0 + 0.15, 0.36, -0.04, x0 + w - 0.15, 3.3, 0.06, 'glass');
      if (bay.sign) { signBand(F, xc, w, bay.sign); }
      if (bay.awning) awning(F, xc, w, bay.awning);
      else if (br2() < 0.7) miniBlade(F, x0 + w - 0.45, MINI[miniIdx++ % MINI.length]);
      if (rng() < 0.45) { const p = worldOf(F, xc, 2.2, 1.3); NEON(p.x, p.y, p.z, new Color3(1, 0.72, 0.45), 4, 6, 0); }
    } else if (bay.type === 'shutter') {
      G.fquad(B.shutter, F, xc, 1.7, 0.02, gw, 3.4, null);
      G.fbox(B.dark, F, xc, 3.6, 0.2, gw + 0.1, 0.45, 0.42);                          // shutter housing
      colliderAABBf(F, `shut-${def.id}-${x0 | 0}`, x0 + 0.15, 0, -0.04, x0 + w - 0.15, 3.4, 0.06, 'metal');
      if (bay.sign) signBand(F, xc, w, bay.sign);
    } else if (bay.type === 'door') {
      G.fbox(B.conD, F, xc, 2.25, 0.02, gw, 4.5, 0.04);
      G.fquad(B.glass, F, xc, 1.15, 0.06, 1.6, 2.3, null);
      G.fbox(B.dark, F, xc, 2.45, 0.35, 2.2, 0.08, 0.7);                              // canopy
      G.fbox(B.neon, F, xc, 2.4, 0.7, 2.1, 0.03, 0.03, neonC('white'));
      const p = worldOf(F, xc, 2.3, 1.0); NEON(p.x, p.y, p.z, 'white', 4, 6, 0.15);
    } else if (bay.type === 'vending') {
      G.fbox(B.conD, F, xc, 2.25, 0.02, gw, 4.5, 0.04);
      const n = Math.max(1, Math.floor(gw / 1.05));
      for (let i = 0; i < n; i++) {
        const vx = x0 + 0.25 + 0.525 + i * 1.05;
        const col = i % 2 ? lin('#b3202a') : lin('#1f5fd0');
        G.fbox(B.tint, F, vx, 0.98, 0.45, 0.95, 1.95, 0.8, { color: col });
        G.fquad(B.shop, F, vx - 0.08, 1.2, 0.86, 0.62, 1.2, { uv: 'rect', rect: [0.52, 0.02, 0.98, 0.3] });
        G.fbox(B.neon, F, vx, 1.86, 0.86, 0.85, 0.12, 0.02, neonC(i % 2 ? 'red' : 'cyan'));
        G.fbox(B.dark, F, vx + 0.34, 1.0, 0.86, 0.14, 0.5, 0.03);
      }
      colliderAABBf(F, `vend-${def.id}-${x0 | 0}`, x0 + 0.25, 0, 0, x0 + 0.25 + n * 1.05, 1.95, 0.86, 'metal');
      const p = worldOf(F, xc, 1.5, 1.4); NEON(p.x, p.y, p.z, 'cyan', 5, 6, 0);
    }
  }

  function colliderAABBf(F, name, lx0, ly0, lz0, lx1, ly1, lz1, surface) {
    const a = worldOf(F, lx0, ly0, lz0), b = worldOf(F, lx1, ly1, lz1);
    colliderAABB(name, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z), surface);
  }

  /** Small perpendicular hanging glyph lightbox (reads down the street axis at eye level; head clearance 2.4 m). */
  function miniBlade(F, x, key) {
    const yc = 3.55, h = 2.3, zc = 0.62, depth = 0.62, col = SIGN_COLOR[key];
    G.fbox(B.dark, F, x, yc, zc, 0.1, h + 0.1, depth + 0.08);
    const rect = atlas.uv(key);
    G.fquad(B.signs, F, x + 0.055, yc, zc, depth - 0.06, h - 0.1, { uv: 'rect', rect }, -PI / 2);
    G.fquad(B.signs, F, x - 0.055, yc, zc, depth - 0.06, h - 0.1, { uv: 'rect', rect }, PI / 2);
    G.fbox(B.neon, F, x, yc, zc + depth / 2 + 0.03, 0.12, h + 0.1, 0.03, neonC(col));
    G.fbox(B.dark, F, x, yc + h / 2 - 0.1, 0.16, 0.06, 0.06, 0.3);
  }

  function signBand(F, xc, w, key) {
    const sw = Math.min(w - 0.7, 5.4), sh = sw / 5;
    G.fbox(B.dark, F, xc, 3.95, 0.16, sw + 0.3, sh + 0.25, 0.28);
    G.fquad(B.signs, F, xc, 3.95, 0.31, sw, sh, { uv: 'rect', rect: atlas.uv(key) });
    const col = SIGN_COLOR[key];
    G.fbox(B.neon, F, xc, 3.95 + sh / 2 + 0.16, 0.31, sw + 0.34, 0.04, 0.04, neonC(col));
    G.fbox(B.neon, F, xc, 3.95 - sh / 2 - 0.16, 0.31, sw + 0.34, 0.04, 0.04, neonC(col));
    const p = worldOf(F, xc, 3.8, 1.1);
    NEON(p.x, p.y, p.z, col, 12, 9, rng() < 0.2 ? 0.35 : 0);
  }

  function awning(F, xc, w, hex) {
    const col = lin(hex);
    G.fbox(B.tint, F, xc, 3.05, 0.72, w - 0.5, 0.06, 1.45, { rx: 0.32, color: col });
    G.fbox(B.tint, F, xc, 2.72, 1.38, w - 0.5, 0.3, 0.04, { color: col });
    G.fbox(B.dark, F, xc, 3.25, 0.05, w - 0.4, 0.12, 0.12);
  }

  function bladeSign(F, x, y0, h, key) {
    const yc = y0 + h / 2, zc = 1.05, depth = 1.35, col = SIGN_COLOR[key];
    G.fbox(B.dark, F, x, yc, zc, 0.24, h, depth);
    const rect = atlas.uv(key);
    G.fquad(B.signs, F, x + 0.125, yc, zc, depth - 0.2, h - 0.25, { uv: 'rect', rect }, -PI / 2);   // faces +local x
    G.fquad(B.signs, F, x - 0.125, yc, zc, depth - 0.2, h - 0.25, { uv: 'rect', rect }, PI / 2);    // faces −local x
    G.fbox(B.neon, F, x, y0 - 0.03, zc, 0.3, 0.05, depth + 0.05, neonC(col));
    G.fbox(B.neon, F, x, y0 + h + 0.03, zc, 0.3, 0.05, depth + 0.05, neonC(col));
    G.fbox(B.neon, F, x, yc, zc + depth / 2 + 0.03, 0.3, h + 0.1, 0.05, neonC(col));
    for (const yy of [y0 + 0.6, y0 + h - 0.6]) G.fbox(B.dark, F, x, yy, 0.2, 0.12, 0.12, 0.4);
    const p = worldOf(F, x, yc, zc + 0.4);
    NEON(p.x, p.y, p.z, col, 16, 11, rng() < 0.3 ? 0.5 : 0.05);
  }

  function holo(F, x, y0, w, h, key) {
    const yc = y0 + h / 2, col = SIGN_COLOR[key];
    G.fbox(B.dark, F, x, yc, 0.55, w + 0.4, h + 0.4, 0.3);
    G.fquad(B.signs, F, x, yc, 0.72, w, h, { uv: 'rect', rect: atlas.uv(key) });
    G.fbox(B.neon, F, x, y0 - 0.12, 0.72, w + 0.3, 0.06, 0.06, neonC(col));
    G.fbox(B.neon, F, x, y0 + h + 0.12, 0.72, w + 0.3, 0.06, 0.06, neonC(col));
    for (const yy of [y0 + 1, yc, y0 + h - 1]) G.fbox(B.dark, F, x, yy, 0.25, w * 0.6, 0.16, 0.5);
    const p = worldOf(F, x, yc, 2.5);
    NEON(p.x, p.y, p.z, col, 30, 16, 0.08);
  }

  // ============================================================================================ STAIRS, WALKWAY, BRIDGE
  const posts = [];
  const post = (x, y, z, h = 1.05) => pushM(posts, x, y + h / 2, z, 1, h, 1);
  const rail = (ax, ay, az, bx, by, bz) => G.seg(B.yellow, ax, ay, az, bx, by, bz, 0.028, { tmpl: 'cyl6', uv: 'local' });
  {
    const x0 = 9.3, x1 = 11.9, zb = -20, zt = -34, n = 30, run = (zb - zt) / n, rise = (WALK - SW) / n;
    for (let i = 1; i <= n; i++) {
      const zf = zb - (i - 1) * run, top = SW + i * rise;
      G.box(B.con, (x0 + x1) / 2, top / 2, zf - run / 2, x1 - x0, top, run);
      G.box(B.yellow, (x0 + x1) / 2, top + 0.006, zf - 0.035, x1 - x0, 0.014, 0.07);            // safety nosing
    }
    // railings on the open side
    for (let i = 0; i <= 10; i++) {
      const t = i / 10, z = zb - t * (zb - zt), y = SW + t * (WALK - SW);
      post(x0 + 0.08, y, z);
    }
    rail(x0 + 0.08, SW + 1.05, zb, x0 + 0.08, WALK + 1.05, zt);
    rail(x0 + 0.08, SW + 0.55, zb, x0 + 0.08, WALK + 0.55, zt);
    // wall handrail
    G.seg(B.dark, x1 - 0.05, SW + 0.95, zb, x1 - 0.05, WALK + 0.95, zt, 0.025, { tmpl: 'cyl6', uv: 'local' });
    // ramp collider through the step nosings (slope ≈ 20.8°)
    const zA = -19.45, yA = SW, zB = -33.55, yB = WALK, len = Math.hypot(zA - zB, yB - yA), ang = Math.atan2(yB - yA, zA - zB), th = 0.3;
    const cy = (yA + yB) / 2 - Math.cos(ang) * th / 2, cz = (zA + zB) / 2 - Math.sin(ang) * th / 2;
    collider('stairRamp', (x0 + x1) / 2, cy, cz, x1 - x0, th, len, 'concrete', { rx: ang });
    colliderAABB('stairMassA', x0, 0, -29, x1, 1.7, -24, 'concrete');
    colliderAABB('stairMassB', x0, 0, -34, x1, 3.6, -29, 'concrete');
    // side railing collider along the slope
    collider('stairRail', x0 + 0.05, cy + 0.7, cz, 0.08, 1.1, len, 'metal', { rx: ang, meta: { railing: true } });
  }
  // walkway along R3 (x 9.3 … 12, z −33.5 … −47)
  const deck = (x0, x1, z0, z1, name) => {
    G.box(B.con, (x0 + x1) / 2, WALK - 0.15, (z0 + z1) / 2, x1 - x0, 0.3, Math.abs(z1 - z0));
    colliderAABB(name, x0, WALK - 0.3, Math.min(z0, z1), x1, WALK, Math.max(z0, z1), 'concrete');
  };
  deck(9.3, 12, -33.45, -47, 'walkway');
  G.box(B.teal, 9.24, WALK - 0.3, -40.25, 0.12, 0.6, 13.6);
  G.box(B.neon, 9.16, WALK - 0.62, -40.25, 0.05, 0.05, 13.6, neonC('cyan'));
  NEON(8.8, 4.6, -36.5, 'cyan', 8, 8, 0); NEON(8.8, 4.6, -45, 'cyan', 8, 8, 0.2);
  for (const [za, zb2] of [[-34, -40.5], [-43.5, -47]]) {
    for (let z = za; z >= zb2 - 0.01; z -= 1.3) post(9.38, WALK, z);
    rail(9.38, WALK + 1.05, za, 9.38, WALK + 1.05, zb2);
    rail(9.38, WALK + 0.55, za, 9.38, WALK + 0.55, zb2);
    colliderAABB(`walkRail${za}`, 9.32, WALK, zb2, 9.44, WALK + 1.1, za, 'metal', { meta: { railing: true } });
  }
  for (let x = 9.4; x <= 11.9; x += 0.8) post(x, WALK, -46.95);
  rail(9.38, WALK + 1.05, -46.95, 11.95, WALK + 1.05, -46.95);
  colliderAABB('walkEnd', 9.3, WALK, -47.05, 12, WALK + 1.1, -46.9, 'metal', { meta: { railing: true } });
  for (const z of [-35.2, -46.6]) { G.box(B.teal, 9.55, (WALK - 0.3) / 2, z, 0.3, WALK - 0.3, 0.3); colliderAABB(`col${z}`, 9.4, 0, z - 0.15, 9.7, WALK - 0.3, z + 0.15, 'metal'); }

  // bridge across the street (z −40.5 … −43.5) + left balcony (x −12 … −9.5, z −36 … −48)
  deck(-9.5, 9.3, -40.5, -43.5, 'bridge');
  G.box(B.dark, -0.1, WALK - 0.55, -40.65, 18.8, 0.5, 0.25);
  G.box(B.dark, -0.1, WALK - 0.55, -43.35, 18.8, 0.5, 0.25);
  G.box(B.teal, -0.1, WALK - 0.3, -40.45, 18.8, 0.6, 0.1);
  G.box(B.teal, -0.1, WALK - 0.3, -43.55, 18.8, 0.6, 0.1);
  G.box(B.neon, -0.1, WALK - 0.64, -40.38, 18.6, 0.05, 0.05, neonC('magenta'));
  G.box(B.neon, -0.1, WALK - 0.64, -43.62, 18.6, 0.05, 0.05, neonC('cyan'));
  for (const zr of [-40.58, -43.42]) {
    for (let x = -9.4; x <= 9.3; x += 1.35) post(x, WALK, zr);
    rail(-9.5, WALK + 1.05, zr, 9.3, WALK + 1.05, zr);
    rail(-9.5, WALK + 0.55, zr, 9.3, WALK + 0.55, zr);
    colliderAABB(`bridgeRail${zr}`, -9.5, WALK, zr - 0.06, 9.3, WALK + 1.1, zr + 0.06, 'metal', { meta: { railing: true } });
  }
  // big sign hanging from the bridge, facing the spawn
  G.box(B.dark, 0, WALK - 1.35, -40.42, 7.0, 1.55, 0.2);
  G.fquad(B.signs, frame(0, -40.3, 0), 0, WALK - 1.35, 0, 6.5, 1.3, { uv: 'rect', rect: atlas.uv('NO RETREAT') });
  G.fquad(B.signs, frame(0, -43.7, PI), 0, WALK - 1.35, 0, 4.5, 0.9, { uv: 'rect', rect: atlas.uv('BAR') });
  G.box(B.dark, 0, WALK - 1.35, -43.58, 4.9, 1.1, 0.2);
  NEON(0, 3.6, -39.2, 'cyan', 22, 13, 0); NEON(-6, 4.6, -40, 'magenta', 8, 8, 0); NEON(6, 4.6, -40, 'magenta', 8, 8, 0);
  NEON(0, 3.8, -44.8, 'pink', 10, 9, 0.3);
  deck(-12, -9.5, -36, -48, 'balcony');
  G.box(B.teal, -9.44, WALK - 0.3, -42, 0.12, 0.6, 12);
  G.box(B.neon, -9.36, WALK - 0.62, -42, 0.05, 0.05, 12, neonC('magenta'));
  for (const [za, zb2] of [[-36, -40.5], [-43.5, -48]]) {
    for (let z = za; z >= zb2 - 0.01; z -= 1.3) post(-9.58, WALK, z);
    rail(-9.58, WALK + 1.05, za, -9.58, WALK + 1.05, zb2);
    rail(-9.58, WALK + 0.55, za, -9.58, WALK + 0.55, zb2);
    colliderAABB(`balcRail${za}`, -9.64, WALK, zb2, -9.52, WALK + 1.1, za, 'metal', { meta: { railing: true } });
  }
  for (const z of [-36.05, -47.95]) {
    for (let x = -11.9; x <= -9.6; x += 0.75) post(x, WALK, z);
    rail(-12, WALK + 1.05, z, -9.55, WALK + 1.05, z);
    colliderAABB(`balcEnd${z}`, -12, WALK, z - 0.06, -9.5, WALK + 1.1, z + 0.06, 'metal', { meta: { railing: true } });
  }
  for (const z of [-36.6, -47.4]) { G.box(B.teal, -9.75, (WALK - 0.3) / 2, z, 0.3, WALK - 0.3, 0.3); colliderAABB(`bcol${z}`, -9.9, 0, z - 0.15, -9.6, WALK - 0.3, z + 0.15, 'metal'); }
  G.box(B.shutter, -11.97, WALK + 1.5, -44, 0.05, 3.0, 2.6);                                     // balcony door
  G.box(B.neon, -11.9, WALK + 3.1, -44, 0.05, 0.05, 2.6, neonC('red'));
  NEON(-10.6, WALK + 2.6, -44, 'red', 5, 6, 0.6);

  // ============================================================================================ STREET FURNITURE & COVER
  const cover = (x, z, y = 0) => coverPoints.push(new Vector3(x, y, z));

  // street lamps (LED heads; anchors for LightingDirector lamps)
  const lamps = [[1, 6], [1, -11], [1, -27], [1, -56], [-1, -3], [-1, -19], [-1, -54], [-1, 29], [1, 30]];
  for (const [s, z] of lamps) {
    const x = s * 7.6, headX = x - s * 2.3;
    G.cyl(B.dark, x, SW + 3.75, z, 0.09, 7.5, { seg: 8 });
    G.cyl(B.dark, x, SW + 0.25, z, 0.2, 0.5, { seg: 8 });
    G.box(B.dark, x - s * 1.2, SW + 7.35, z, 2.5, 0.12, 0.14);
    G.box(B.dark, headX, SW + 7.3, z, 0.85, 0.16, 0.36);
    const warm = z > -20 && z < 20;
    G.box(B.neon, headX, SW + 7.215, z, 0.75, 0.02, 0.28, neonC(warm ? 'warm' : 'white'));
    lampAnchors.push({ position: new Vector3(headX, SW + 7.0, z), color: warm ? new Color3(1, 0.66, 0.36) : new Color3(0.78, 0.9, 1), intensity: 60, range: 18 });
    collider(`lamp${s}${z}`, x, SW + 2, z, 0.26, 4, 0.26, 'metal');
  }

  // traffic signals at the crosswalk in front of the spawn (arm over the road, lit heads on both faces)
  for (const s of [-1, 1]) {
    const x = s * 7.55, z = s > 0 ? 7.9 : 2.7, hx = x - s * 4.4;
    G.cyl(B.dark, x, SW + 3.1, z, 0.1, 6.2, { seg: 8 });
    G.box(B.dark, x - s * 2.3, SW + 6.05, z, 4.7, 0.14, 0.14);
    G.box(B.dark, hx, SW + 5.4, z, 0.38, 1.1, 0.3);
    for (const f of [-1, 1]) {
      G.box(B.neon, hx, SW + 5.72, z + f * 0.16, 0.2, 0.2, 0.02, neonC('red'));
      G.box(B.neon, hx, SW + 5.4, z + f * 0.16, 0.2, 0.2, 0.02, neonC('amber', true));
      G.box(B.neon, hx, SW + 5.08, z + f * 0.16, 0.2, 0.2, 0.02, neonC('green', true));
    }
    G.box(B.dark, x - s * 0.22, SW + 2.6, z, 0.3, 0.42, 0.26);                             // pedestrian head
    G.box(B.neon, x - s * 0.22, SW + 2.6, z - s * 0.135, 0.2, 0.26, 0.02, neonC('orange'));
    collider(`signal${s}`, x, SW + 2, z, 0.26, 4, 0.26, 'metal');
    NEON(hx, SW + 5.2, z, 'red', 3, 5, 0);
  }

  // jersey barriers laid ACROSS the street (long axis ≈ x) so they give cover from shots down the street
  const jersey = (x, z, ry, hazard, withCover = true) => {
    addJersey(G, B.con, x, z, ry);
    if (hazard) {
      for (const side of [-1, 1]) {
        G.add(B.hazard, G.T.box, G.M(x + Math.cos(ry) * side * 0.145, 0.55, z - Math.sin(ry) * side * 0.145, ry, 0, side * 0.165), 0.02, 0.22, 1.9, { uv: 'local', su: 1 / 1.2 });
      }
    }
    collider(`jersey${x}${z}`, x, 0.42, z, 0.62, 0.84, 2.0, 'concrete', { ry });
    if (withCover) { cover(x, z + 0.95); cover(x, z - 0.95); }
  };
  const ACROSS = PI / 2;
  jersey(-2.2, -4, ACROSS + 0.15, true); jersey(3.0, -22, ACROSS - 0.1, false); jersey(-3.2, -31, ACROSS + 0.2, true);
  jersey(1.6, -37.5, ACROSS + 0.02, false); jersey(3.7, -37.8, ACROSS - 0.05, true); jersey(2.8, -56, ACROSS - 0.15, false); jersey(-3.2, -61.5, ACROSS + 0.05, true);
  // barricade line behind the spawn (edge of the playable street)
  for (let x = -6; x <= 6.01; x += 2.02) jersey(x, 13.9, ACROSS, Math.abs(x) < 3, false);
  for (const s of [-1, 1]) {
    G.box(B.hazard, s * 9.6, SW + 0.75, 13.9, 4.4, 0.25, 0.06, { uv: 'local' });
    G.box(B.hazard, s * 9.6, SW + 0.35, 13.9, 4.4, 0.25, 0.06, { uv: 'local' });
    for (const x of [s * 7.6, s * 11.6]) G.box(B.dark, x, SW + 0.5, 13.9, 0.08, 1.0, 0.08);
  }

  // parked cars
  addCar(G, B, 5.25, -12.5, PI + 0.04, lin('#5a0d14'), false, NEON);
  collider('carA', 5.25, 0.72, -12.5, 1.95, 1.45, 4.65, 'metal', { ry: PI + 0.04 });
  cover(3.7, -10.5); cover(3.7, -14.5); cover(5.2, -9.6);
  addCar(G, B, -3.3, -49, 0.58, lin('#10213f'), true, NEON);
  collider('carB', -3.3, 0.72, -49, 1.95, 1.45, 4.65, 'metal', { ry: 0.58 });
  cover(-0.6, -47.8); cover(-5.4, -50.8); cover(-3.6, -52.3);

  // crate stacks (military-olive painted steel) + dumpsters
  const crate = (x, y, z, ry = 0, s = 1.1) => {
    G.add(B.tint, G.T.box, G.M(x, y + s / 2, z, ry), s, s, s, { uv: 'local', su: 1 / 2.5, color: lin('#56613e') });
    G.add(B.dark, G.T.box, G.M(x, y + s / 2, z, ry), s + 0.04, 0.1, s + 0.04, { uv: 'local' });
    G.add(B.hazard, G.T.box, G.M(x, y + s * 0.8, z, ry), s + 0.02, 0.14, s * 0.3, { uv: 'local' });
  };
  const stacks = [
    [-9.4, SW, -13, 0.1, [[0, 0, 0], [1.15, 0, 0.1], [0.5, 1.1, 0.05]]],
    [10.3, SW, -44.2, 0, [[0, 0, 0], [0, 0, -1.15]]],
    [-2.5, 0, -43.5, 0.35, [[0, 0, 0], [0.1, 1.1, 0]]],
    [12.3, SW, -68.2, -0.2, [[0, 0, 0], [1.15, 0, 0], [0.55, 1.1, 0.1]]],
    [-9.8, SW, -77, 0.4, [[0, 0, 0], [1.15, 0, 0]]],
    [-3.5, 0, -24.5, -0.15, [[0, 0, 0]]],
  ];
  for (const [x, y, z, ry, list] of stacks) {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, maxY = 0;
    const c = Math.cos(ry), s = Math.sin(ry);
    for (const [dx, dy, dz] of list) {
      const wx = x + dx * c + dz * s, wz = z - dx * s + dz * c;
      crate(wx, y + dy, wz, ry);
      minX = Math.min(minX, wx - 0.62); maxX = Math.max(maxX, wx + 0.62); minZ = Math.min(minZ, wz - 0.62); maxZ = Math.max(maxZ, wz + 0.62); maxY = Math.max(maxY, dy + 1.1);
    }
    colliderAABB(`crates${x}${z}`, minX, y, minZ, maxX, y + maxY, maxZ, 'metal');
    cover((minX + maxX) / 2, maxZ + 0.7, y); cover((minX + maxX) / 2, minZ - 0.7, y);
  }
  const dumpster = (x, z, ry, hex) => {
    const col = lin(hex);
    G.add(B.tint, G.T.box, G.M(x, SW + 0.62, z, ry), 1.1, 1.05, 1.9, { uv: 'local', su: 1 / 2.5, color: col });
    G.add(B.dark, G.T.box, G.M(x, SW + 1.2, z, ry, 0, 0.12), 1.22, 0.08, 1.95, { uv: 'local' });
    for (const k of [-0.7, 0.7]) G.add(B.rubber, G.T.cyl8, G.M(x + Math.sin(ry) * k, SW + 0.08, z + Math.cos(ry) * k, ry, 0, PI / 2), 0.16, 0.9, 0.16, {});
    collider(`dump${x}${z}`, x, SW + 0.65, z, 1.2, 1.3, 1.95, 'metal', { ry });
    for (let i = 0; i < 4; i++) {
      const bx = x + (rng() - 0.5) * 1.4 + Math.cos(ry) * 0.95, bz = z + (rng() - 0.5) * 1.6;
      G.add(B.rubber, G.T.sphere, G.M(bx, SW + 0.24, bz, rng() * PI), 0.55 + rng() * 0.2, 0.48, 0.6 + rng() * 0.2, {});
    }
  };
  dumpster(-10.9, -26.3, 0, '#2d5a3a'); dumpster(10.9, 12.2, 0, '#1f4f7a'); dumpster(-14.5, -77.2, PI / 2, '#6a4a1a');
  cover(-9.8, -24.2, SW); cover(-9.8, -28.4, SW); cover(9.6, 10.1, SW);

  // plaza: bollards, planters with neon edge, benches, noodle kiosk, white clapboard shack (bodycam reference)
  for (let x = -6.4; x <= 6.41; x += 1.6) {
    G.cyl(B.dark, x, SW + 0.5, -64.6, 0.13, 1.0, { seg: 8 });
    G.cyl(B.yellow, x, SW + 0.82, -64.6, 0.135, 0.12, { seg: 8 });
    collider(`bollard${x}`, x, SW + 0.5, -64.6, 0.28, 1.0, 0.28, 'metal');
  }
  for (const [x, z] of [[-4.5, -69.5], [4, -75.5]]) {
    G.box(B.conD, x, SW + 0.35, z, 3.2, 0.7, 1.6);
    G.box(B.rubber, x, SW + 0.72, z, 3.0, 0.06, 1.4);
    G.box(B.neon, x, SW + 0.08, z + 0.82, 3.2, 0.04, 0.04, neonC('cyan'));
    G.box(B.neon, x, SW + 0.08, z - 0.82, 3.2, 0.04, 0.04, neonC('cyan'));
    collider(`planter${x}`, x, SW + 0.4, z, 3.2, 0.8, 1.6, 'concrete');
    cover(x, z + 1.4, SW); cover(x, z - 1.4, SW);
    NEON(x, SW + 0.4, z + 1.3, 'cyan', 3, 4, 0);
  }
  for (const [x, z] of [[-1.5, -76.8], [13.4, -65.6]]) {
    G.box(B.con, x, SW + 0.23, z, 2.4, 0.46, 0.6);
    collider(`bench${x}`, x, SW + 0.23, z, 2.4, 0.46, 0.6, 'concrete');
  }
  // noodle kiosk
  {
    const x = 12.9, z = -74.2;
    G.box(B.tint, x, SW + 0.55, z, 2.2, 1.1, 3.2, { color: lin('#8a1c1c') });
    G.box(B.con, x - 1.15, SW + 1.12, z, 0.5, 0.06, 3.3);
    G.box(B.dark, x, SW + 2.55, z, 2.5, 0.12, 3.6);
    for (const k of [-1, 1]) G.cyl(B.dark, x - 1.1, SW + 1.8, z + k * 1.6, 0.05, 1.4, { seg: 6 });
    G.fquad(B.signs, frame(x - 1.26, z, -PI / 2), 0, SW + 2.3, 0, 2.6, 0.52, { uv: 'rect', rect: atlas.uv('RAMEN') });
    for (let i = 0; i < 4; i++) G.add(B.neon, G.T.sphere, G.M(x - 1.2, SW + 2.2, z - 1.2 + i * 0.8), 0.32, 0.42, 0.32, neonC('amber'));
    collider('kiosk', x, SW + 0.6, z, 2.3, 1.2, 3.3, 'metal');
    NEON(x - 1.9, SW + 2.0, z, 'amber', 10, 8, 0.15);
    cover(x - 1.8, z + 1.8, SW);
  }
  // white clapboard shack
  {
    const x = -12.6, z = -67.8, w = 3.4, d = 3.0, h = 2.8;
    G.box(B.siding, x, SW + h / 2, z, w, h, d);
    G.box(B.rust, x, SW + h + 0.12, z, w + 0.4, 0.12, d + 0.4, { rz: 0.06 });
    G.fquad(B.glass, frame(x + w / 2, z, PI / 2), -0.6, SW + 1.1, 0.01, 0.95, 2.05, null);
    G.fquad(B.win, frame(x + w / 2, z, PI / 2), 0.8, SW + 1.55, 0.01, 0.9, 0.8, { uv: 'rect', rect: [0.1 / 8, 0.26 / 8, 0.9 / 8, 0.93 / 8] });
    G.box(B.neon, x + w / 2 + 0.03, SW + 2.35, z - 0.6, 0.03, 0.03, 1.1, neonC('warm'));
    colliderAABB('shack', x - w / 2, 0, z - d / 2, x + w / 2, SW + h, z + d / 2, 'wood');
    cover(x + w / 2 + 0.8, z + 1.8, SW); cover(x + w / 2 + 0.8, z - 1.9, SW);
    NEON(x + w / 2 + 0.8, SW + 2.2, z - 0.6, 'warm', 4, 6, 0);
  }
  // hydrants, cones, trash bins — cheap detail scaled by prop density
  const smallProps = Math.round(10 * propDensity);
  for (let i = 0; i < smallProps; i++) {
    const s = i % 2 ? 1 : -1, z = 8 - i * (70 / smallProps) - rng() * 3;
    const x = s * (7.55 + rng() * 0.3);
    if (i % 3 === 0) {                                                              // hydrant
      G.cyl(B.tint, x, SW + 0.35, z, 0.13, 0.7, { seg: 8, color: lin('#b01818') });
      G.cyl(B.tint, x, SW + 0.72, z, 0.1, 0.1, { seg: 8, color: lin('#b01818') });
      collider(`hydrant${i}`, x, SW + 0.4, z, 0.3, 0.8, 0.3, 'metal');
    } else if (i % 3 === 1) {                                                       // traffic cone on the road edge (no collider)
      G.add(B.tint, G.T.cone8, G.M(x - s * 1.2, 0.3, z), 0.36, 0.56, 0.36, { color: lin('#ff5a00'), uv: 'local' });
      G.box(B.tint, x - s * 1.2, 0.02, z, 0.42, 0.04, 0.42, { color: lin('#ff5a00') });
    } else {                                                                        // trash bin
      G.cyl(B.dark, x + s * 0.2, SW + 0.5, z, 0.28, 1.0, { seg: 12 });
      collider(`bin${i}`, x + s * 0.2, SW + 0.5, z, 0.56, 1.0, 0.56, 'metal');
    }
  }

  // ============================================================================================ OVERHEAD
  // sagging cables between the facades + paper lanterns on two spans
  const spans = [[-1.5, 9.5, 3], [-11.5, 8.2, 4], [-16, 10.5, 2], [-25, 8.8, 3], [-31, 11.5, 2], [-52.5, 9, 3], [-59.5, 8.4, 3], [6.5, 11, 2], [20, 9.5, 3]];
  const bracket = [];
  for (const [z, hBase, count] of spans) {
    for (let c = 0; c < count; c++) {
      const y0 = hBase + c * 0.45 + rng() * 0.3, y1 = hBase + c * 0.35 + rng() * 0.6, sag = 0.7 + rng() * 0.9, dz = (rng() - 0.5) * 1.6;
      cable(G, B.rubber, -FACADE + 0.1, y0, z + c * 0.25, FACADE - 0.1, y1, z + c * 0.25 + dz, sag, 0.018 + rng() * 0.014);
      bracket.push([-FACADE + 0.15, y0, z + c * 0.25], [FACADE - 0.15, y1, z + c * 0.25 + dz]);
    }
  }
  for (const [x, y, z] of bracket) G.box(B.dark, x, y, z, 0.3, 0.12, 0.12);
  for (const [z, hBase] of [[-11.5, 8.2], [-59.5, 8.4]]) {
    for (let i = -4; i <= 4; i++) {
      const t = (i + 4) / 8, x = -FACADE + 0.1 + t * (2 * FACADE - 0.2);
      const y = hBase + (1 - 4 * (t - 0.5) * (t - 0.5)) * -1.1 - 0.35;
      G.add(B.neon, G.T.sphere, G.M(x, y, z), 0.36, 0.5, 0.36, neonC(i % 2 ? 'red' : 'amber'));
      G.seg(B.rubber, x, y + 0.25, z, x, y + 0.5, z, 0.008, { tmpl: 'tube5' });
      if (i === -2 || i === 2) NEON(x, y - 0.3, z, i < 0 ? 'red' : 'amber', 6, 7, 0.25);
    }
  }

  // ============================================================================================ SKYLINE (thin instances)
  const skyline = buildSkyline(scene, G, B, materials, skylineDensity, atlas, neonC);

  // ============================================================================================ FINALIZE
  // perimeter (invisible, 3 m so a jump cannot clear it)
  colliderAABB('perimN', -16.5, 0, 13.6, 16.5, 3, 14.2, 'concrete', { meta: { perimeter: true } });
  colliderAABB('perimS', -16.5, 0, -81, 16.5, 3, -80.4, 'concrete', { meta: { perimeter: true } });
  colliderAABB('perimE', 16.2, 0, -81, 16.8, 3, 14.2, 'concrete', { meta: { perimeter: true } });
  colliderAABB('perimW', -16.8, 0, -81, -16.2, 3, 14.2, 'concrete', { meta: { perimeter: true } });

  const meshes = G.finalize(scene);
  const postMesh = thinInstanced(scene, 'railPosts', G.T.cyl6, 0.055, 1, 0.055, materials.get('plasticYellow'), posts, true, true);
  const dashMesh = thinInstanced(scene, 'laneDashes', G.T.box, 1, 1, 1, materials.get('roadPaint'), paintMats, false, true, 1 / 3);
  const renderMeshes = [...meshes, postMesh, dashMesh, ...skyline.meshes].filter(Boolean);
  const shadowCasters = renderMeshes.filter(m => m.metadata?.cast);
  const shadowReceivers = renderMeshes.filter(m => m.receiveShadows);

  const spawn = { position: new Vector3(1.75, 0, 9.5), yaw: PI };
  const enemySpawns = [
    new Vector3(-6, 0, -40), new Vector3(6, 0, -52), new Vector3(0.5, SW, -72.5), new Vector3(-10.7, WALK, -45),
    new Vector3(10.6, WALK, -44), new Vector3(8.9, SW, -58), new Vector3(-8, SW, -70),
  ];
  // Routes are closed loops (last → first is walkable too); clear of every collider by ≥ 0.5 m.
  const patrolRoutes = [
    [new Vector3(-6, 0, -27), new Vector3(-6, 0, -53.5), new Vector3(-0.2, 0, -53.5), new Vector3(-0.2, 0, -27)],
    [new Vector3(10.6, WALK, -42), new Vector3(10.6, WALK, -36), new Vector3(10.6, WALK, -45.5), new Vector3(10.6, WALK, -42), new Vector3(-10.7, WALK, -42)],
    [new Vector3(-7.5, SW, -67), new Vector3(1, SW, -66.5), new Vector3(8.5, SW, -67), new Vector3(8.5, SW, -72.5), new Vector3(-8, SW, -72.5)],
    [new Vector3(8.9, SW, -34), new Vector3(8.9, SW, -60), new Vector3(5.8, 0, -60), new Vector3(5.8, 0, -40)],
    [new Vector3(6, 0, -20), new Vector3(6, 0, -59), new Vector3(0.5, 0, -59), new Vector3(0.5, 0, -45.5), new Vector3(6, 0, -45.5)],
  ];

  const bounds = { minX: -16, maxX: 16, minZ: -80, maxZ: 14 };
  const drawMeshes = renderMeshes.length;
  return {
    spawn, enemySpawns, patrolRoutes, coverPoints, neonAnchors, lampAnchors, shadowCasters, shadowReceivers, steamVents, bounds,
    stats: { drawMeshes, colliders: colliders.length, tier, neonAnchors: neonAnchors.length, triangles: renderMeshes.reduce((a, m) => a + (m.getTotalIndices() / 3) * Math.max(1, m.thinInstanceCount || 0), 0) },
    renderMeshes, colliders, materials,
  };
}

// ------------------------------------------------------------------------------------------------ builders
function addPuddle(G, b, x, y, z, w, d, rng) {
  const T = G.T.disc, P = T.positions.slice(), n = P.length / 3;
  const phase = rng() * 6.28, k1 = 0.18 + rng() * 0.12, k2 = 0.1 + rng() * 0.08;
  for (let i = 1; i < n; i++) { // vertex 0 is the centre
    const a = Math.atan2(P[i * 3 + 1], P[i * 3]);
    const r = 1 + Math.sin(a * 2 + phase) * k1 + Math.sin(a * 3 - phase * 1.7) * k2;
    P[i * 3] *= r; P[i * 3 + 1] *= r;
  }
  G.add(b, { positions: P, normals: T.normals, uvs: T.uvs, indices: T.indices }, G.M(x, y, z, rng() * PI, PI / 2, 0), w, d, 1, { uv: 'world', su: 1, sv: 1 });
}

/** Jersey barrier (2 m) as a prism: profile half-widths at heights, built from quads with flat normals. */
function addJersey(G, b, x, z, ry) {
  const prof = [[0, 0.31], [0.08, 0.31], [0.33, 0.17], [0.81, 0.09]];
  const L = 1.0;
  const pos = [], nrm = [], uvs = [], idx = [];
  const quad = (a, bb, c, d, nx, ny, nz) => {
    const base = pos.length / 3;
    for (const v of [a, bb, c, d]) { pos.push(v[0], v[1], v[2]); nrm.push(nx, ny, nz); uvs.push(0, 0); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const s of [-1, 1]) {
    for (let i = 0; i < prof.length - 1; i++) {
      const [y0, w0] = prof[i], [y1, w1] = prof[i + 1];
      const nx = s * (y1 - y0), ny = (w0 - w1), inv = 1 / Math.hypot(nx, ny);
      quad([s * w0, y0, -L], [s * w1, y1, -L], [s * w1, y1, L], [s * w0, y0, L], nx * inv, ny * inv, 0);
    }
  }
  quad([-0.09, 0.81, -L], [-0.09, 0.81, L], [0.09, 0.81, L], [0.09, 0.81, -L], 0, 1, 0);
  for (const e of [-1, 1]) {
    for (let i = 0; i < prof.length - 1; i++) {
      const [y0, w0] = prof[i], [y1, w1] = prof[i + 1];
      quad([-w0, y0, e * L], [w0, y0, e * L], [w1, y1, e * L], [-w1, y1, e * L], 0, 0, e);
    }
  }
  G.add(b, fixWinding({ positions: pos, normals: nrm, uvs, indices: idx }), G.M(x, 0, z, ry), 1, 1, 1, { uv: 'world' });
}

/** Makes custom triangles follow Babylon's front-face convention (cross(b−a, c−a)·n < 0). */
function fixWinding(T) {
  const P = T.positions, N = T.normals, I = T.indices;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * N[a * 3] + cy * N[a * 3 + 1] + cz * N[a * 3 + 2] > 0) { I[t + 1] = c; I[t + 2] = b; }
  }
  return T;
}

/** Catenary-ish cable as a chain of thin open tubes. */
function cable(G, b, ax, ay, az, bx, by, bz, sag, r) {
  const N = 12;
  let px = ax, py = ay, pz = az;
  for (let i = 1; i <= N; i++) {
    const t = i / N, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    const y = ay + (by - ay) * t - sag * 4 * t * (1 - t);
    G.seg(b, px, py, pz, x, y, z, r, { tmpl: 'tube5', uv: 'local' });
    px = x; py = y; pz = z;
  }
}

/** Sedan built from boxes: paint body, glass cabin, rubber wheels, emissive tail/head lights (+ optional underglow). */
function addCar(G, B, x, z, ry, color, underglow, NEON) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const P = (lx, ly, lz) => [x + lx * c + lz * s, ly, z - lx * s + lz * c];
  const box = (b, lx, ly, lz, w, h, d, o) => { const p = P(lx, ly, lz); G.add(b, G.T.box, G.M(p[0], p[1], p[2], ry, o?.rx || 0, 0), w, h, d, { uv: 'local', ...o }); };
  box(B.car, 0, 0.62, 0, 1.84, 0.56, 4.55, { color });
  box(B.car, 0, 0.93, 1.55, 1.8, 0.1, 1.25, { color, rx: 0.08 });              // hood
  box(B.car, 0, 0.97, -1.75, 1.8, 0.14, 0.9, { color });                      // trunk
  box(B.glass, 0, 1.18, -0.25, 1.62, 0.5, 2.3, {});
  box(B.car, 0, 1.46, -0.35, 1.56, 0.07, 1.75, { color });                    // roof
  box(B.dark, 0, 0.42, 2.3, 1.86, 0.24, 0.12, {});
  box(B.dark, 0, 0.42, -2.3, 1.86, 0.24, 0.12, {});
  for (const lx of [-0.86, 0.86]) for (const lz of [-1.45, 1.45]) {
    const p = P(lx, 0.34, lz);
    G.add(B.rubber, G.T.cyl12, G.M(p[0], p[1], p[2], ry, 0, PI / 2), 0.66, 0.24, 0.66, {});
    const q = P(lx * 1.02, 0.34, lz);
    G.add(B.dark, G.T.cyl8, G.M(q[0], q[1], q[2], ry, 0, PI / 2), 0.4, 0.25, 0.4, {});
  }
  // light bar tail (Night City style) + headlights
  const tail = P(0, 0.8, -2.29), head = P(0, 0.74, 2.29);
  G.add(B.neon, G.T.box, G.M(tail[0], tail[1], tail[2], ry), 1.6, 0.06, 0.03, { uv: 'const', uvc: paletteUV('tail') });
  for (const lx of [-0.68, 0.68]) { const h = P(lx, 0.74, 2.29); G.add(B.neon, G.T.box, G.M(h[0], h[1], h[2], ry), 0.34, 0.1, 0.03, { uv: 'const', uvc: paletteUV('head', true) }); }
  NEON(tail[0] - s * 0.6, 0.8, tail[2] - c * 0.6, 'tail', 3, 4, 0);
  void head;
  if (underglow) {
    const u = P(0, 0.12, 0);
    G.add(B.neon, G.T.box, G.M(u[0], u[1], u[2], ry), 1.5, 0.03, 4.0, { uv: 'const', uvc: paletteUV('cyan') });
    NEON(u[0], 0.25, u[2], 'cyan', 6, 5, 0);
  }
}

/** Thin-instanced mesh from a template (static buffer). */
function thinInstanced(scene, name, T, sx, sy, sz, material, matrices, cast, receive, uvScale = 1) {
  if (!matrices.length) return null;
  const mesh = new Mesh(`world-${name}`, scene);
  const vd = new VertexData();
  const P = new Float32Array(T.positions.length);
  for (let i = 0; i < P.length; i += 3) { P[i] = T.positions[i] * sx; P[i + 1] = T.positions[i + 1] * sy; P[i + 2] = T.positions[i + 2] * sz; }
  vd.positions = P;
  vd.normals = new Float32Array(T.normals);
  vd.uvs = new Float32Array(T.uvs).map(v => v * uvScale);
  vd.indices = new Uint16Array(T.indices);
  vd.applyToMesh(mesh, false);
  const buf = new Float32Array(matrices.length * 16);
  matrices.forEach((m, i) => m.copyToArray(buf, i * 16));
  mesh.thinInstanceSetBuffer('matrix', buf, 16, true);
  mesh.thinInstanceRefreshBoundingInfo(false);
  finishStatic(mesh, material, receive);
  mesh.metadata = { worldBatch: name, cast };
  return mesh;
}

/** Background megabuildings: three prototype towers, thin-instanced, lit-window material, no colliders. */
function buildSkyline(scene, G, B, materials, density, atlas, neonC) {
  const rng = createRng(4077);
  const protos = [{ w: 22, h: 90, d: 22 }, { w: 36, h: 64, d: 28 }, { w: 28, h: 150, d: 28 }];
  const lists = [[], [], []];
  const count = Math.round(26 + 54 * density);
  const placed = [];
  for (let tries = 0; placed.length < count && tries < count * 40; tries++) {
    const x = (rng() * 2 - 1) * 240, z = -340 + rng() * 480;
    if (Math.abs(x) < 36 && z > -112 && z < 74) continue;          // the playable block and its facades
    const dist = Math.hypot(x, z + 30);
    if (dist > 270 || dist < 55) continue;
    if (placed.some(p => Math.abs(p[0] - x) < 30 && Math.abs(p[1] - z) < 30)) continue;
    const pi = rng() < 0.45 ? 0 : rng() < 0.55 ? 1 : 2, P = protos[pi];
    const sxz = 0.85 + rng() * 0.35, sy = (0.7 + rng() * 0.45) * (0.75 + dist / 330);
    const rot = Math.floor(rng() * 4) * PI / 2;
    const hgt = P.h * sy;
    lists[pi].push(Matrix.Compose(new Vector3(sxz, sy, sxz), Quaternion.RotationYawPitchRoll(rot, 0, 0), new Vector3(x, hgt / 2 - 3, z)));
    placed.push([x, z, hgt, P.w * sxz, pi]);
  }
  // tower tops: aviation lights + occasional vertical neon ribbons + giant ads facing the street axis (merged)
  let ads = 0;
  for (const [x, z, h, w] of placed) {
    G.box(B.neon, x, h - 2.5, z, 0.8, 0.8, 0.8, neonC('red'));
    const r = rng();
    const face = Math.abs(x) > Math.abs(z + 20) ? -Math.sign(x) : -Math.sign(z + 20); // face toward the street
    if (r < 0.28) {
      const col = ['magenta', 'cyan', 'violet', 'pink'][Math.floor(rng() * 4)];
      if (Math.abs(x) > Math.abs(z + 20)) G.box(B.neon, x + face * (w / 2 + 0.3), h * 0.55, z + (rng() - 0.5) * w * 0.6, 0.4, h * 0.7, 0.9, neonC(col));
      else G.box(B.neon, x + (rng() - 0.5) * w * 0.6, h * 0.55, z + face * (w / 2 + 0.3), 0.9, h * 0.7, 0.4, neonC(col));
    } else if (r < 0.4 && ads < 4 && h > 70) {
      ads++;
      const key = ads % 2 ? 'SYNTH' : 'ZERO', aw = Math.min(w * 0.7, 20), ah = aw * 2;
      if (Math.abs(x) > Math.abs(z + 20)) G.fquad(B.signs, frame(x + face * (w / 2 + 0.6), z, face > 0 ? PI / 2 : -PI / 2), 0, h * 0.62, 0, aw, ah, { uv: 'rect', rect: atlas.uv(key) });
      else G.fquad(B.signs, frame(x, z + face * (w / 2 + 0.6), face > 0 ? 0 : PI), 0, h * 0.62, 0, aw, ah, { uv: 'rect', rect: atlas.uv(key) });
    }
  }
  const mat = materials.get('skylineWindows');
  const meshes = [];
  protos.forEach((P, i) => {
    if (!lists[i].length) return;
    // prototype with local box-projected UVs at the facade texel density (24 m × 28 m per window tile)
    const kit = new GeoKit(scene);
    const b = kit.batch('p', mat, { su: 1 / 24, sv: 1 / 28 });
    kit.add(b, kit.T.box, kit.M(0, 0, 0), P.w, P.h, P.d, { uv: 'local' });
    const mesh = new Mesh(`world-skyline${i}`, scene);
    const vd = new VertexData();
    vd.positions = new Float32Array(b.p); vd.normals = new Float32Array(b.n); vd.uvs = new Float32Array(b.uv); vd.indices = new Uint16Array(b.i);
    vd.applyToMesh(mesh, false);
    const buf = new Float32Array(lists[i].length * 16);
    lists[i].forEach((m, k) => m.copyToArray(buf, k * 16));
    mesh.thinInstanceSetBuffer('matrix', buf, 16, true);
    mesh.thinInstanceRefreshBoundingInfo(false);
    finishStatic(mesh, mat, false);
    mesh.metadata = { worldBatch: `skyline${i}`, cast: false };
    meshes.push(mesh);
  });
  return { meshes, count: placed.length };
}
