import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore.js';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';

/*
 * Code-built first-person weapons (no assets). Everything is generated into a few merged meshes per material:
 * part tints ride on vertex colours (black anodised receiver, phosphate barrel, FDE furniture, steel pins …) so a whole
 * rifle is 5 draw calls: static metal, static polymer, magazine, charging handle, holographic lens.
 *
 * Conventions (shared by createPistolPrototype / createFpsArms):
 *  - root is parented to the camera with root.rotation.y = PI → local -Z is the muzzle direction (camera forward),
 *    local -X is the weapon's right (ejection) side, which is the shooter's right.
 *  - The sight line (holo reticle centre / pistol iron-sight line) sits at local (0, SIGHT_HEIGHT, ·), so an ADS root
 *    position of (0, -SIGHT_HEIGHT, z) puts the sight exactly on screen centre for any z.
 *  - Real 1:1 scale. The rifle origin sits on the handguard so that the spec ADS pose (0,-0.155,0.45) frames the optic
 *    ~0.21 m in front of the eye (CoD-like optic size) and hip rotations pivot between the hands.
 */

export const SIGHT_HEIGHT = 0.155;
// texture tiles per metre for the box-projected UVs of the library's tiling textures (fine grain at viewmodel range)
export const UV_METAL = 15, UV_POLY = 26, UV_FABRIC = 14;

// ================================================================================================ geometry kit
const _v = new Vector3(), _n = new Vector3();

/** Accumulates transformed primitives (positions/normals/colours) for one merged mesh. Build-time only. */
export class GeoBatch {
  constructor() { this.p = []; this.n = []; this.c = []; this.i = []; }
  get triangles() { return this.i.length / 3; }

  /** Append geometry g = {p,n,i} (local space) transformed by Matrix m, tinted with linear colour col=[r,g,b]. */
  add(g, m, col) {
    const base = this.p.length / 3;
    const nm = m.clone().invert().transpose();
    for (let k = 0; k < g.p.length; k += 3) {
      Vector3.TransformCoordinatesFromFloatsToRef(g.p[k], g.p[k + 1], g.p[k + 2], m, _v);
      Vector3.TransformNormalFromFloatsToRef(g.n[k], g.n[k + 1], g.n[k + 2], nm, _n);
      _n.normalize();
      this.p.push(_v.x, _v.y, _v.z);
      this.n.push(_n.x, _n.y, _n.z);
      this.c.push(col[0], col[1], col[2], 1);
    }
    for (let k = 0; k < g.i.length; k += 3) this._tri(base + g.i[k], base + g.i[k + 1], base + g.i[k + 2]);
    return this;
  }

  // Babylon front faces have cross(b-a, c-a) opposite to the outward normal → orient every triangle against its
  // averaged vertex normal, so primitives (and mirrored transforms) never need hand-tuned winding.
  _tri(a, b, c) {
    const P = this.p, N = this.n;
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const e1x = P[b * 3] - ax, e1y = P[b * 3 + 1] - ay, e1z = P[b * 3 + 2] - az;
    const e2x = P[c * 3] - ax, e2y = P[c * 3 + 1] - ay, e2z = P[c * 3 + 2] - az;
    const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
    if (cx * cx + cy * cy + cz * cz < 1e-18) return; // degenerate
    const nx = N[a * 3] + N[b * 3] + N[c * 3], ny = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1], nz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
    if (cx * nx + cy * ny + cz * nz > 0) this.i.push(a, c, b); else this.i.push(a, b, c);
  }

  /**
   * Build the mesh. uvScale = texture tiles per metre for the box-projected UVs (procedural library textures tile);
   * origin (Vector3) re-bases the vertices so mesh.position = origin (animated parts pivot there).
   */
  toMesh(name, scene, parent, material, { uvScale = 8, origin = null } = {}) {
    const n = this.p.length / 3;
    const pos = new Float32Array(this.p), nrm = new Float32Array(this.n), uv = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) {
      const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2];
      const ax = Math.abs(nrm[k * 3]), ay = Math.abs(nrm[k * 3 + 1]), az = Math.abs(nrm[k * 3 + 2]);
      let u, v;
      if (ax >= ay && ax >= az) { u = z; v = y; } else if (ay >= az) { u = x; v = z; } else { u = x; v = y; }
      uv[k * 2] = u * uvScale; uv[k * 2 + 1] = v * uvScale;
      if (origin) { pos[k * 3] = x - origin.x; pos[k * 3 + 1] = y - origin.y; pos[k * 3 + 2] = z - origin.z; }
    }
    const vd = new VertexData();
    vd.positions = pos; vd.normals = nrm; vd.uvs = uv; vd.colors = new Float32Array(this.c);
    vd.indices = n > 65535 ? new Uint32Array(this.i) : new Uint16Array(this.i);
    const mesh = new Mesh(name, scene);
    vd.applyToMesh(mesh, false);
    mesh.parent = parent;
    if (origin) mesh.position.copyFrom(origin);
    mesh.material = material;
    setupViewmodelMesh(mesh);
    return mesh;
  }
}

/** Viewmodel mesh flags: own render group (depth cleared by main), no picking/shadows/fog, skip frustum tests. */
export function setupViewmodelMesh(mesh) {
  mesh.renderingGroupId = 1;
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  mesh.applyFog = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true;
  mesh.checkCollisions = false;
  return mesh;
}

/** Matrix from translation / Euler rotation / scale. */
export function xf(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return Matrix.Compose(new Vector3(sx, sy, sz), Quaternion.FromEulerAngles(rx, ry, rz), new Vector3(x, y, z));
}

/** Matrix whose local Y axis runs from a to b (for capsules / tubes between two points). */
export function alignY(a, b) {
  const y = b.subtract(a); y.normalize();
  const ref = Math.abs(y.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const x = Vector3.Cross(ref, y); x.normalize();
  const z = Vector3.Cross(x, y); z.normalize();
  const m = new Matrix();
  Matrix.FromXYZAxesToRef(x, y, z, m);
  m.setTranslation(a);
  return m;
}

/** Matrix from basis vectors (may be left- or right-handed: mirrored hands come out naturally). */
export function basis(xAxis, yAxis, zAxis, origin) {
  const m = new Matrix();
  Matrix.FromXYZAxesToRef(xAxis, yAxis, zAxis, m);
  m.setTranslation(origin);
  return m;
}

// ---- 2D profiles (x, y) ----
export function circle(r, seg = 12, phase = 0) {
  const out = [];
  for (let k = 0; k < seg; k++) { const a = phase + (k / seg) * Math.PI * 2; out.push([Math.cos(a) * r, Math.sin(a) * r]); }
  return out;
}
/** Rounded rectangle centred on 0 (w × h, corner radius r, seg segments per corner). */
export function rrect(w, h, r, seg = 3) {
  const out = [], hw = w / 2, hh = h / 2; r = Math.min(r, hw, hh);
  const corners = [[hw - r, hh - r, 0], [-hw + r, hh - r, 90], [-hw + r, -hh + r, 180], [hw - r, -hh + r, 270]];
  for (const [cx, cy, a0] of corners) {
    for (let s = 0; s <= seg; s++) {
      const a = (a0 + (s / seg) * 90) * Math.PI / 180;
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return out;
}
/** Chamfered rectangle (octagon): ct top-edge chamfer, cb bottom-edge chamfer. */
export function chamf(w, h, ct, cb = ct) {
  const hw = w / 2, hh = h / 2;
  return [[hw, hh - ct], [hw - ct, hh], [-hw + ct, hh], [-hw, hh - ct], [-hw, -hh + cb], [-hw + cb, -hh], [hw - cb, -hh], [hw, -hh + cb]];
}

// ---- 3D primitives (local space) → {p, n, i} ----
/** Axis-aligned box centred on the origin. */
export function boxGeo(w, h, d) {
  const p = [], n = [], i = [];
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const faces = [
    [[1, 0, 0], [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]]],
    [[-1, 0, 0], [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]]],
    [[0, 1, 0], [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]]],
    [[0, -1, 0], [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]]],
    [[0, 0, 1], [[hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [-hx, -hy, hz]]],
    [[0, 0, -1], [[-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz]]],
  ];
  for (const [nn, vs] of faces) {
    const b = p.length / 3;
    for (const v of vs) { p.push(...v); n.push(...nn); }
    i.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { p, n, i };
}

/** Flat quad in the XY plane, normal -Z (use a matrix to place decals / slots). */
export function quadGeo(w, h) {
  const hx = w / 2, hy = h / 2;
  return { p: [-hx, -hy, 0, hx, -hy, 0, hx, hy, 0, -hx, hy, 0], n: [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1], i: [0, 1, 2, 0, 2, 3] };
}

/** Disc in the XY plane, normal -Z. */
export function discGeo(r, seg = 10) {
  const p = [0, 0, 0], n = [0, 0, -1], i = [];
  for (let k = 0; k < seg; k++) { const a = (k / seg) * Math.PI * 2; p.push(Math.cos(a) * r, Math.sin(a) * r, 0); n.push(0, 0, -1); }
  for (let k = 0; k < seg; k++) i.push(0, 1 + k, 1 + ((k + 1) % seg));
  return { p, n, i };
}

/**
 * Sweep a closed 2D profile along a path.
 * stations: [{ p:[x,y,z], s?: number | [sx,sy], t?: [x,y,z] }]; side: vector the profile X maps to (orthogonalised
 * against the tangent), profile Y maps to cross(tangent, side). Normals: per-edge, smoothed across profile corners whose
 * edge normals differ by less than `smooth` degrees (rounded shapes stay soft, chamfers stay crisp).
 */
export function sweepGeo(prof, stations, { side = [1, 0, 0], smooth = 32, cap0 = true, cap1 = true } = {}) {
  const p = [], n = [], i = [];
  const m = prof.length, S = stations.length;
  let cx = 0, cy = 0;
  for (const q of prof) { cx += q[0]; cy += q[1]; }
  cx /= m; cy /= m;
  const en = [];
  for (let k = 0; k < m; k++) {
    const a = prof[k], b = prof[(k + 1) % m];
    let nx = b[1] - a[1], ny = -(b[0] - a[0]);
    const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    if (nx * ((a[0] + b[0]) / 2 - cx) + ny * ((a[1] + b[1]) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
    en.push([nx, ny]);
  }
  const cosT = Math.cos(smooth * Math.PI / 180);
  const vn = (e, o) => { if (e[0] * o[0] + e[1] * o[1] > cosT) { const x = e[0] + o[0], y = e[1] + o[1], l = Math.hypot(x, y); return [x / l, y / l]; } return e; };
  // frames
  const frames = stations.map((st, k) => {
    const P = new Vector3(...st.p);
    let T;
    if (st.t) T = new Vector3(...st.t);
    else {
      const a = new Vector3(...stations[Math.max(0, k - 1)].p), b = new Vector3(...stations[Math.min(S - 1, k + 1)].p);
      T = b.subtract(a);
    }
    T.normalize();
    const X = new Vector3(...side);
    X.subtractInPlace(T.scale(Vector3.Dot(X, T))); X.normalize();
    const Y = Vector3.Cross(T, X); Y.normalize();
    const s = st.s ?? 1, sx = Array.isArray(s) ? s[0] : s, sy = Array.isArray(s) ? s[1] : s;
    return { P, T, X, Y, sx, sy };
  });
  const put = (f, q, nn) => {
    const x = q[0] * f.sx, y = q[1] * f.sy;
    p.push(f.P.x + f.X.x * x + f.Y.x * y, f.P.y + f.X.y * x + f.Y.y * y, f.P.z + f.X.z * x + f.Y.z * y);
    const nx = nn[0] / f.sx, ny = nn[1] / f.sy, l = Math.hypot(nx, ny) || 1;
    n.push((f.X.x * nx + f.Y.x * ny) / l, (f.X.y * nx + f.Y.y * ny) / l, (f.X.z * nx + f.Y.z * ny) / l);
  };
  // side wall: per profile edge two vertices per station
  for (let k = 0; k < m; k++) {
    const a = prof[k], b = prof[(k + 1) % m], e = en[k];
    const na = vn(e, en[(k - 1 + m) % m]), nb = vn(e, en[(k + 1) % m]);
    const base = p.length / 3;
    for (const f of frames) { put(f, a, na); put(f, b, nb); }
    for (let s = 0; s < S - 1; s++) {
      const r0 = base + s * 2, r1 = base + (s + 1) * 2;
      i.push(r0, r0 + 1, r1 + 1, r0, r1 + 1, r1);
    }
  }
  const cap = (f, sign) => {
    const base = p.length / 3;
    const nn = f.T.scale(sign);
    p.push(f.P.x + (f.X.x * cx * f.sx + f.Y.x * cy * f.sy), f.P.y + (f.X.y * cx * f.sx + f.Y.y * cy * f.sy), f.P.z + (f.X.z * cx * f.sx + f.Y.z * cy * f.sy));
    n.push(nn.x, nn.y, nn.z);
    for (const q of prof) {
      const x = q[0] * f.sx, y = q[1] * f.sy;
      p.push(f.P.x + f.X.x * x + f.Y.x * y, f.P.y + f.X.y * x + f.Y.y * y, f.P.z + f.X.z * x + f.Y.z * y);
      n.push(nn.x, nn.y, nn.z);
    }
    for (let k = 0; k < m; k++) i.push(base, base + 1 + k, base + 1 + ((k + 1) % m));
  };
  if (cap0) cap(frames[0], -1);
  if (cap1) cap(frames[S - 1], 1);
  return { p, n, i };
}

/** Straight prism along local Z from z0 to z1 (profile in XY). s1 tapers the far end. */
export function prismGeo(prof, z0, z1, opts = {}) {
  const { s1 = 1, ...rest } = opts;
  return sweepGeo(prof, [{ p: [0, 0, z0] }, { p: [0, 0, z1], s: s1 }], { side: [1, 0, 0], ...rest });
}

/** Tapered capsule along local +Y: sphere r0 at 0, sphere r1 at len. */
export function capsuleGeo(len, r0, r1 = r0, seg = 6, rings = 2) {
  const p = [], n = [], i = [];
  const lat = [];
  for (let k = 0; k <= rings; k++) lat.push([-Math.PI / 2 + (k / rings) * (Math.PI / 2), 0]);
  for (let k = 0; k <= rings; k++) lat.push([(k / rings) * (Math.PI / 2), 1]);
  const rowStart = [];
  for (const [phi, end] of lat) {
    rowStart.push(p.length / 3);
    const r = end ? r1 : r0, cy = end ? len : 0;
    const cph = Math.cos(phi), sph = Math.sin(phi);
    const count = Math.abs(cph) < 1e-6 ? 1 : seg;
    for (let s = 0; s < count; s++) {
      const a = (s / seg) * Math.PI * 2;
      const nx = cph * Math.cos(a), nz = cph * Math.sin(a);
      p.push(nx * r, cy + sph * r, nz * r); n.push(nx, sph, nz);
    }
  }
  for (let rI = 0; rI < lat.length - 1; rI++) {
    const a0 = rowStart[rI], a1 = rowStart[rI + 1];
    const c0 = (rowStart[rI + 1] - a0), c1 = (rI + 2 < lat.length ? rowStart[rI + 2] : p.length / 3) - a1;
    for (let s = 0; s < seg; s++) {
      const s1 = (s + 1) % seg;
      if (c0 === 1) i.push(a0, a1 + s, a1 + s1);
      else if (c1 === 1) i.push(a0 + s, a1, a0 + s1);
      else i.push(a0 + s, a1 + s, a1 + s1, a0 + s, a1 + s1, a0 + s1);
    }
  }
  return { p, n, i };
}

/** UV sphere (scale it with the matrix for ellipsoids). */
export function sphereGeo(r, seg = 8, rings = 5) {
  const p = [], n = [], i = [];
  for (let a = 0; a <= rings; a++) {
    const phi = -Math.PI / 2 + (a / rings) * Math.PI, cph = Math.cos(phi), sph = Math.sin(phi);
    for (let s = 0; s <= seg; s++) {
      const t = (s / seg) * Math.PI * 2, nx = cph * Math.cos(t), nz = cph * Math.sin(t);
      p.push(nx * r, sph * r, nz * r); n.push(nx, sph, nz);
    }
  }
  for (let a = 0; a < rings; a++) for (let s = 0; s < seg; s++) {
    const r0 = a * (seg + 1) + s, r1 = r0 + seg + 1;
    i.push(r0, r1, r1 + 1, r0, r1 + 1, r0 + 1);
  }
  return { p, n, i };
}

// ================================================================================================ materials
// Library textures (procedural, tiled) are reused through clones whose base albedo is neutral so the per-part vertex
// colours carry the real tint; without a library, plain PBR with the textures' average albedo stands in.
const MATERIAL_CACHE = new WeakMap(); // scene → Map
const VM_MATERIALS = {
  // name: [library recipe, fallback albedo (≈ texture average, linear), metallic, roughness]
  gunmetal: ['gunmetal', 0.137, 0.62, 1.3, 0.46],
  polymer: ['polymer', 0.3, 0, 1.0, 0.62],
  gloveFabric: ['gloveFabric', 0.4, 0, 1.0, 0.86],
  sleeveFabric: ['sleeveFabric', 0.4, 0, 1.05, 0.92],
};

/** Shared viewmodel material (one instance per scene/name, shared by rifle, pistol and arms). */
export function viewmodelMaterial(scene, materials, name) {
  let cache = MATERIAL_CACHE.get(scene);
  if (!cache) { cache = new Map(); MATERIAL_CACHE.set(scene, cache); }
  let m = cache.get(name);
  if (m) return m;
  const [libName, fallbackAlbedo, metal, roughMul, roughAbs] = VM_MATERIALS[name];
  let base = null;
  try { base = materials?.get?.(libName) ?? null; } catch { base = null; }
  m = new PBRMaterial(`vm-${name}`, scene);
  if (base && base.albedoTexture) {
    // share the library's procedural textures by reference (PBRMaterial.clone would duplicate the RawTextures)
    m.albedoTexture = base.albedoTexture;
    m.bumpTexture = base.bumpTexture || null;
    m.metallicTexture = base.metallicTexture || null;
    m.useRoughnessFromMetallicTextureGreen = !!base.useRoughnessFromMetallicTextureGreen;
    m.useMetallnessFromMetallicTextureBlue = !!base.useMetallnessFromMetallicTextureBlue;
    m.useAmbientOcclusionFromMetallicTextureRed = !!base.useAmbientOcclusionFromMetallicTextureRed;
    m.albedoColor = new Color3(1, 1, 1);
    if (m.metallicTexture) { m.metallic = metal ? metal * 1.1 : 0; m.roughness = roughMul; }
    else { m.metallic = metal; m.roughness = roughAbs; }
  } else {
    m.albedoColor = new Color3(fallbackAlbedo, fallbackAlbedo, fallbackAlbedo);
    m.metallic = metal;
    m.roughness = roughAbs;
  }
  m.maxSimultaneousLights = 6;
  m.enableSpecularAntiAliasing = true; // thin bright edges on small parts shimmer otherwise
  m.metadata = { ...(m.metadata || {}), viewmodel: true };
  cache.set(name, m);
  scene.onAfterRenderObservable.addOnce(() => scene.onAfterRenderObservable.addOnce(() => { if (m.isReady?.()) m.freeze(); }));
  return m;
}

// ---- holographic / red-dot lens (WGSL, collimated reticle projected at infinity) ----
const LENS_SHADER = 'strikeHoloLens';
const LENS_VERTEX = /* wgsl */ `
#include<sceneUboDeclaration>
attribute position: vec3f;
uniform world: mat4x4f;
varying vDir: vec3f;
varying vLocal: vec2f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let wp = uniforms.world * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.position = scene.viewProjection * wp;
  // eye → fragment direction expressed in the lens' own frame (axes = world matrix columns). Linear in position, so the
  // interpolated varying is exact; the fragment normalises it.
  let d = wp.xyz - scene.vEyePosition.xyz;
  let ax = normalize(uniforms.world[0].xyz);
  let ay = normalize(uniforms.world[1].xyz);
  let az = normalize(uniforms.world[2].xyz);
  vertexOutputs.vDir = vec3f(dot(d, ax), dot(d, ay), dot(d, az));
  vertexOutputs.vLocal = vertexInputs.position.xy;
}
`;
const LENS_FRAGMENT = /* wgsl */ `
varying vDir: vec3f;
varying vLocal: vec2f;
uniform reticleColor: vec4f;   // rgb linear, a = HDR intensity
uniform reticleShape: vec4f;   // dot radius, ring radius, ring half-width, tick length   (tangent units ≈ radians)
uniform glassTint: vec4f;      // rgb, a = base opacity
uniform lensSize: vec4f;       // half width, half height, edge softness, style (0 holo ring+dot, 1 dot only)

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let d = normalize(input.vDir);
  // Optic axis = lens local -Z (the muzzle direction). The reticle lives at infinity: its image depends only on the
  // viewing DIRECTION, never on eye position → parallax-free, hidden from the front and off-axis.
  let fwd = max(-d.z, 1e-4);
  let t = d.xy / fwd;
  let px = max(fwidth(t.x), fwidth(t.y));
  let r = length(t);

  let dotR = max(uniforms.reticleShape.x, px * 1.35);
  var cov = 1.0 - smoothstep(dotR - px, dotR + px, r);
  var core = cov;
  if (uniforms.lensSize.w < 0.5) {
    let ringR = uniforms.reticleShape.y;
    let hwR = max(uniforms.reticleShape.z, px * 0.75);
    let ring = 1.0 - smoothstep(hwR - px, hwR + px, abs(r - ringR));
    // four short ticks just outside the ring at 12/3/6/9 o'clock
    let tl = uniforms.reticleShape.w;
    let a = abs(t);
    let tickV = (1.0 - smoothstep(hwR - px, hwR + px, a.x)) * step(ringR, a.y) * (1.0 - smoothstep(ringR + tl - px, ringR + tl + px, a.y));
    let tickH = (1.0 - smoothstep(hwR - px, hwR + px, a.y)) * step(ringR, a.x) * (1.0 - smoothstep(ringR + tl - px, ringR + tl + px, a.x));
    cov = max(cov, max(ring, max(tickV, tickH)) * 0.85);
  }
  let facing = step(0.0, -d.z);           // only from behind the glass
  cov *= facing;

  // lens edge fade (rounded window corners) + faint coated-glass sheen that grows at grazing angles
  let q = abs(input.vLocal) - uniforms.lensSize.xy + vec2f(uniforms.lensSize.z);
  let edge = length(max(q, vec2f(0.0))) - uniforms.lensSize.z;
  let inside = 1.0 - smoothstep(-px * 0.0, 0.0005, edge);
  let graze = 1.0 - fwd;
  let sheen = uniforms.glassTint.a + graze * 0.9;
  let glassA = clamp(sheen, 0.0, 0.45) * inside;

  let hot = uniforms.reticleColor.rgb * uniforms.reticleColor.a;
  let coreBoost = mix(0.55, 1.0, core);   // dot centre hotter than the ring → bloom favours the dot
  let rgb = mix(uniforms.glassTint.rgb, hot * coreBoost, cov);
  let alpha = max(glassA, cov * inside);
  fragmentOutputs.color = vec4f(rgb, alpha);
}
`;

function registerLensShader() {
  if (!ShaderStore.ShadersStoreWGSL[`${LENS_SHADER}VertexShader`]) {
    ShaderStore.ShadersStoreWGSL[`${LENS_SHADER}VertexShader`] = LENS_VERTEX;
    ShaderStore.ShadersStoreWGSL[`${LENS_SHADER}FragmentShader`] = LENS_FRAGMENT;
  }
}

/**
 * Lens material. style 'holo' = 68-MOA-style ring + dot + ticks, 'dot' = red dot only. Sizes are exaggerated vs the real
 * optic so the reticle reads on a 414 px tall phone screen; the dot is clamped to ≥ ~1.4 px.
 */
export function createLensMaterial(scene, { name = 'vm-holo-lens', color = '#ff2a1c', intensity = 7, style = 'holo', halfW = 0.02, halfH = 0.016 } = {}) {
  registerLensShader();
  const mat = new ShaderMaterial(name, scene, { vertex: LENS_SHADER, fragment: LENS_SHADER }, {
    attributes: ['position'],
    uniforms: ['world', 'reticleColor', 'reticleShape', 'glassTint', 'lensSize'],
    uniformBuffers: ['Scene'],
    samplers: [],
    needAlphaBlending: true,
    shaderLanguage: ShaderLanguage.WGSL,
  });
  const c = Color3.FromHexString(color).toLinearSpace();
  mat.setColor4('reticleColor', new Color4(c.r, c.g, c.b, intensity));
  mat.setColor4('reticleShape', style === 'dot' ? new Color4(0.0022, 0, 0, 0) : new Color4(0.0024, 0.03, 0.0014, 0.009));
  mat.setColor4('glassTint', new Color4(0.16, 0.3, 0.34, 0.07));
  mat.setColor4('lensSize', new Color4(halfW, halfH, 0.004, style === 'dot' ? 1 : 0));
  mat.backFaceCulling = false;
  mat.disableDepthWrite = true;
  mat.metadata = { viewmodel: true, lens: true };
  return mat;
}

// ================================================================================================ shared colours
// Linear vertex-colour multipliers against the neutral materials above (metal textures average ≈0.14 linear,
// polymer ≈0.3, fabric ≈0.4), i.e. final albedo ≈ multiplier × texture average.
export const TINT = {
  anod: [0.27, 0.27, 0.29],       // black anodised aluminium
  anodLite: [0.36, 0.36, 0.38],   // machined edges / rail teeth tops
  anodEdge: [0.31, 0.31, 0.33],
  park: [0.19, 0.19, 0.19],       // manganese phosphate barrel / muzzle device
  steel: [1.5, 1.5, 1.55],        // nickel-boron bolt carrier, pins
  dark: [0.03, 0.03, 0.035],      // holes, slots, bore, ports
  brass: [3.2, 2.2, 0.9],
  copper: [2.6, 1.3, 0.8],
  fde: [0.68, 0.47, 0.27],        // flat dark earth polymer
  fdeDark: [0.52, 0.36, 0.21],
  blackPoly: [0.1, 0.1, 0.105],
  rubber: [0.06, 0.06, 0.06],
};

// ================================================================================================ M4
const BORE_Y = 0.083;                 // bore axis height (gun space)
const RAIL_Y = 0.113;                 // top of the picatinny rail
const U0 = 0.365;                     // root origin along the barrel (metres forward of the receiver's rear face)
const SIGHT_U = 0.128;                // holo glass plane
// gun space: u = metres forward of the upper receiver's rear face, y up, x toward the gun's LEFT (local +X).
const Z = u => U0 - u;
const at = (u, y, x = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => xf(x, y, Z(u), rx, ry, rz, sx, sy, sz);
const pt = (u, y, x = 0) => [x, y, Z(u)];

/** Prism along the barrel from u0 to u1 (profile in x/y around (0, y)). */
function barrelPrism(b, prof, u0, u1, y, col, opts = {}, x = 0) {
  b.add(prismGeo(prof, Z(u0), Z(u1), opts), xf(x, y, 0), col);
}
/** Side-profile prism: polygon in (u, y), extruded across x from x0 to x1. */
function sidePrism(b, poly, x0, x1, col, opts = {}) {
  const prof = poly.map(([u, y]) => [Z(u), y]); // (z, y) in the YZ plane, extrude along X
  const g = prismGeo(prof.map(([z, y]) => [z, y]), x0, x1, opts);
  // prism is built along local Z with profile (X,Y) → rotate so profile X→Z, extrusion Z→X
  b.add(g, basis(new Vector3(0, 0, 1), new Vector3(0, 1, 0), new Vector3(1, 0, 0), Vector3.Zero()), col);
}

function buildM4Geometry() {
  const metal = new GeoBatch(), poly = new GeoBatch(), mag = new GeoBatch(), ch = new GeoBatch();
  const T = TINT;

  // ---------------------------------------------------------------- upper receiver
  barrelPrism(metal, chamf(0.030, 0.044, 0.006, 0.002), 0.0, 0.182, 0.082, T.anod);
  // front barrel-nut collar under the handguard joint
  barrelPrism(metal, circle(0.0175, 14), 0.176, 0.188, BORE_Y, T.anod);
  // forward assist housing + knob (right side, rear)
  barrelPrism(metal, circle(0.0064, 10), 0.018, 0.058, 0.089, T.anod, {}, -0.0165);
  barrelPrism(metal, circle(0.0082, 12), 0.010, 0.020, 0.089, T.anodLite, {}, -0.0170);
  // brass deflector
  sidePrism(metal, [[0.062, 0.082], [0.078, 0.082], [0.078, 0.101], [0.067, 0.101]], -0.0205, -0.014, T.anod);
  // ejection port: dark frame, bolt carrier, open dust cover hanging below
  metal.add(boxGeo(0.0012, 0.025, 0.056), at(0.104, 0.080, -0.0151), T.dark);
  metal.add(boxGeo(0.0012, 0.017, 0.046), at(0.104, 0.080, -0.0157), T.steel);
  metal.add(boxGeo(0.0012, 0.0035, 0.046), at(0.104, 0.080, -0.0162), T.dark); // bolt carrier cam-slot shadow line
  metal.add(boxGeo(0.0014, 0.018, 0.054), at(0.104, 0.060, -0.0182, 0, 0, -0.42), T.anod);
  // rear of upper around the charging-handle slot
  metal.add(boxGeo(0.012, 0.008, 0.004), at(0.001, 0.1015, 0), T.dark);

  // ---------------------------------------------------------------- picatinny rail (receiver + monolithic handguard)
  const r0 = 0.004, r1 = 0.462;
  barrelPrism(metal, [[0.0083, 0], [-0.0083, 0], [-0.0083, -0.0035], [0.0083, -0.0035]], r0, r1, 0.1075, T.anod);
  // dovetail with 45° undercut (wide top part, continuous below the cross slots)
  barrelPrism(metal, [[0.0106, 0.0010], [-0.0106, 0.0010], [-0.0106, 0], [-0.0083, -0.0023], [0.0083, -0.0023], [0.0106, 0]], r0, r1, 0.1098, T.anod);
  for (let u = r0 + 0.003; u + 0.0052 < r1; u += 0.01) metal.add(boxGeo(0.0212, 0.0034, 0.0052), at(u + 0.0026, RAIL_Y - 0.0017), T.anodLite);

  // ---------------------------------------------------------------- lower receiver
  barrelPrism(metal, chamf(0.026, 0.031, 0.002, 0.003), 0.012, 0.170, 0.0455, T.anod);
  barrelPrism(metal, rrect(0.026, 0.068, 0.010, 2), -0.004, 0.014, 0.066, T.anod); // buffer tower
  metal.add(boxGeo(0.018, 0.014, 0.010), at(0.165, 0.066), T.anod);                  // front pivot lug
  // magwell (slightly flared) + lip
  sidePrism(metal, [[0.098, 0.031], [0.168, 0.031], [0.171, 0.008], [0.096, 0.008]], -0.0145, 0.0145, T.anod, { smooth: 10 });
  barrelPrism(metal, chamf(0.0318, 0.007, 0.0015, 0.0025), 0.094, 0.173, 0.006, T.anodLite);
  metal.add(boxGeo(0.0008, 0.015, 0.050), at(0.133, 0.0195, 0.0147), T.anodEdge);  // machined marking flats
  metal.add(boxGeo(0.0008, 0.015, 0.050), at(0.133, 0.0195, -0.0147), T.anodEdge);
  // trigger well + trigger
  metal.add(boxGeo(0.010, 0.0012, 0.040), at(0.075, 0.0297), T.dark);
  metal.add(sweepGeo(rrect(0.0055, 0.0030, 0.001, 1), [{ p: pt(0.082, 0.030) }, { p: pt(0.082, 0.022) }, { p: pt(0.079, 0.015) }, { p: pt(0.074, 0.0105) }]), Matrix.Identity(), T.steel);
  // trigger guard (winter guard): flat bar swept under the trigger
  metal.add(sweepGeo(rrect(0.011, 0.004, 0.0015, 1), [
    { p: pt(0.099, 0.014) }, { p: pt(0.097, 0.005) }, { p: pt(0.090, 0.0005) }, { p: pt(0.066, -0.0005) }, { p: pt(0.054, 0.004) }, { p: pt(0.048, 0.016) }, { p: pt(0.047, 0.028) },
  ]), Matrix.Identity(), T.anod);
  // selector (FIRE), bolt catch, pins, mag release
  metal.add(prismGeo(circle(0.0062, 10), 0, 0.0022), at(0.030, 0.047, 0.0130, 0, Math.PI / 2, 0), T.anod);
  metal.add(boxGeo(0.0026, 0.017, 0.0048), at(0.030, 0.0545, 0.0152), T.anodLite);
  metal.add(boxGeo(0.0028, 0.017, 0.011), at(0.090, 0.051, 0.0142, 0.12, 0, 0), T.anod);
  for (const [u, y] of [[0.016, 0.054], [0.166, 0.068], [0.068, 0.040], [0.084, 0.040]]) {
    metal.add(prismGeo(circle(0.0031, 8), 0, 0.0014), at(u, y, 0.0131, 0, Math.PI / 2, 0), T.steel);
    metal.add(prismGeo(circle(0.0031, 8), 0, 0.0014), at(u, y, -0.0145, 0, Math.PI / 2, 0), T.steel);
  }
  metal.add(prismGeo(circle(0.0044, 10), 0, 0.003), at(0.093, 0.041, -0.0160, 0, Math.PI / 2, 0), T.anodLite);

  // ---------------------------------------------------------------- buffer tube, castle nut, end plate
  barrelPrism(metal, circle(0.0148, 14), -0.190, -0.004, BORE_Y, T.anod);
  barrelPrism(metal, circle(0.0180, 14), -0.014, -0.004, BORE_Y, T.anodLite);
  metal.add(boxGeo(0.028, 0.034, 0.003), at(-0.0025, BORE_Y - 0.004), T.anod);
  metal.add(prismGeo(circle(0.0052, 10), 0, 0.006), at(-0.0045, BORE_Y - 0.010, 0.012, 0, Math.PI / 2, 0), T.steel); // QD cup

  // ---------------------------------------------------------------- handguard (free-float M-LOK, octagonal)
  const HG0 = 0.186, HG1 = 0.465, hgW = 0.044, hgH = 0.042, hgC = 0.010;
  barrelPrism(metal, chamf(hgW, hgH, hgC), HG0, HG1, BORE_Y, T.anod, { smooth: 20 });
  barrelPrism(metal, chamf(hgW + 0.002, hgH + 0.002, hgC + 0.001), 0.182, 0.192, BORE_Y, T.anodLite, { smooth: 20 });
  barrelPrism(metal, chamf(hgW + 0.001, hgH + 0.001, hgC + 0.0005), HG1 - 0.006, HG1, BORE_Y, T.anodLite, { smooth: 20 });
  metal.add(prismGeo(chamf(0.035, 0.033, 0.0075), 0, 0.0008), at(HG1 + 0.0006, BORE_Y), T.dark); // hollow front
  // M-LOK slots on 7 faces (dark quads just proud of the surface)
  const hw = hgW / 2, hh = hgH / 2, S2 = Math.SQRT1_2;
  const faces = [
    [hw + 0.0003, 0, 1, 0], [-(hw + 0.0003), 0, -1, 0], [0, -(hh + 0.0003), 0, -1],
    [hw - hgC / 2 + 0.0002, -(hh - hgC / 2) - 0.0002, S2, -S2], [-(hw - hgC / 2) - 0.0002, -(hh - hgC / 2) - 0.0002, -S2, -S2],
    [hw - hgC / 2 + 0.0002, hh - hgC / 2 + 0.0002, S2, S2], [-(hw - hgC / 2) - 0.0002, hh - hgC / 2 + 0.0002, -S2, S2],
  ];
  for (const [fx, fy, nx, ny] of faces) {
    // quad normal is -Z; rotate so it faces (nx, ny, 0) with its long side along the barrel
    const nrm = new Vector3(nx, ny, 0), along = new Vector3(0, 0, 1), across = Vector3.Cross(nrm, along).normalize();
    for (let k = 0; k < 6; k++) {
      const u = 0.222 + k * 0.040;
      metal.add(quadGeo(0.0068, 0.032), basis(across, along, nrm.scale(-1), new Vector3(fx, BORE_Y + fy, Z(u))), T.dark);
    }
  }
  metal.add(prismGeo(circle(0.0056, 10), 0, 0.003), at(0.205, BORE_Y, hw, 0, Math.PI / 2, 0), T.steel); // QD sling socket
  // hand stop (polymer) at the bottom front
  sidePrism(poly, [[0.420, BORE_Y - hh + 0.0005], [0.447, BORE_Y - hh + 0.0005], [0.445, BORE_Y - hh - 0.011], [0.438, BORE_Y - hh - 0.013]], -0.0085, 0.0085, T.blackPoly, { smooth: 10 });

  // ---------------------------------------------------------------- barrel + A2 birdcage
  barrelPrism(metal, circle(0.0093, 14), 0.440, 0.500, BORE_Y, T.park);
  barrelPrism(metal, circle(0.0101, 14), 0.500, 0.503, BORE_Y, T.anodLite);
  barrelPrism(metal, circle(0.0111, 16), 0.503, 0.553, BORE_Y, T.park);
  barrelPrism(metal, circle(0.0111, 16), 0.553, 0.5565, BORE_Y, T.park, { s1: 0.9, cap1: false });
  metal.add(discGeo(0.0056, 12), at(0.5566, BORE_Y), T.dark);
  for (const deg of [0, 60, -60, 120, -120]) {
    const a = deg * Math.PI / 180, r = 0.0111;
    metal.add(boxGeo(0.0037, 0.0009, 0.029), at(0.530, BORE_Y + Math.cos(a) * r, Math.sin(a) * r, 0, 0, -a), T.dark);
  }

  // ---------------------------------------------------------------- BUIS (folded flip-ups)
  sidePrism(metal, [[0.006, RAIL_Y], [0.036, RAIL_Y], [0.036, RAIL_Y + 0.006], [0.012, RAIL_Y + 0.011], [0.006, RAIL_Y + 0.010]], -0.0112, 0.0112, T.anod, { smooth: 10 });
  sidePrism(metal, [[0.432, RAIL_Y], [0.461, RAIL_Y], [0.461, RAIL_Y + 0.009], [0.452, RAIL_Y + 0.012], [0.432, RAIL_Y + 0.006]], -0.0112, 0.0112, T.anod, { smooth: 10 });

  // ---------------------------------------------------------------- holographic sight (EXPS-style)
  const oy = SIGHT_HEIGHT; // window centre
  barrelPrism(metal, chamf(0.030, 0.010, 0.002, 0.001), 0.040, 0.140, RAIL_Y + 0.005, T.anod);            // rail clamp
  barrelPrism(metal, chamf(0.034, 0.017, 0.005, 0.002), 0.034, 0.141, RAIL_Y + 0.0175, T.anod);          // body / battery
  barrelPrism(metal, chamf(0.0052, 0.034, 0.0016, 0.0005), 0.078, 0.141, oy, T.anod, {}, 0.0226);      // hood walls
  barrelPrism(metal, chamf(0.0052, 0.034, 0.0016, 0.0005), 0.078, 0.141, oy, T.anod, {}, -0.0226);
  barrelPrism(metal, chamf(0.050, 0.0056, 0.0022, 0.0006), 0.076, 0.143, oy + 0.0192, T.anod);          // hood top
  barrelPrism(metal, chamf(0.041, 0.0025, 0.0005), 0.080, 0.139, oy - 0.0168, T.dark);                    // window sill
  metal.add(boxGeo(0.040, 0.0016, 0.0022), at(0.1405, oy - 0.0160), T.anodLite);                          // laser port lip
  // controls on the left (visible) side, QD lever + cross bolt
  for (const u of [0.050, 0.064]) metal.add(boxGeo(0.0026, 0.0068, 0.0092), at(u, RAIL_Y + 0.0175, 0.0178), T.rubber);
  metal.add(boxGeo(0.0036, 0.0065, 0.040), at(0.100, RAIL_Y + 0.0045, 0.0165), T.anodLite);
  metal.add(boxGeo(0.0046, 0.0085, 0.008), at(0.079, RAIL_Y + 0.0045, 0.0172), T.anod);
  metal.add(prismGeo(circle(0.0042, 8), 0, 0.003), at(0.100, RAIL_Y + 0.0045, -0.0180, 0, Math.PI / 2, 0), T.steel);
  metal.add(boxGeo(0.0015, 0.004, 0.018), at(0.110, RAIL_Y + 0.0175, 0.0171), T.dark);                    // battery door seam

  // ---------------------------------------------------------------- pistol grip (FDE polymer) + beavertail
  poly.add(sweepGeo(rrect(0.0285, 0.047, 0.012, 3), [
    { p: pt(0.050, 0.030), s: 0.98 }, { p: pt(0.043, 0.008) }, { p: pt(0.033, -0.022), s: [1.02, 1.02] },
    { p: pt(0.022, -0.052), s: [1.03, 1.04] }, { p: pt(0.015, -0.068), s: [1.04, 1.05] }, { p: pt(0.0135, -0.0715), s: [0.98, 0.99] },
  ], { smooth: 40 }), Matrix.Identity(), T.fde);
  sidePrism(poly, [[-0.004, 0.030], [0.034, 0.030], [0.034, 0.024], [0.008, 0.017], [-0.002, 0.021]], -0.0125, 0.0125, T.fde, { smooth: 25 });
  poly.add(sweepGeo(rrect(0.024, 0.040, 0.010, 2), [{ p: pt(0.0142, -0.0708) }, { p: pt(0.0138, -0.0745) }], { smooth: 40 }), Matrix.Identity(), T.fdeDark);

  // ---------------------------------------------------------------- stock (FDE polymer, SOPMOD-ish)
  barrelPrism(poly, rrect(0.038, 0.041, 0.013, 3), -0.100, -0.250, 0.087, T.fde, { smooth: 40 });
  sidePrism(poly, [[-0.132, 0.070], [-0.250, 0.070], [-0.250, -0.040], [-0.240, -0.044], [-0.229, -0.038]], -0.0120, 0.0120, T.fde, { smooth: 10 });
  sidePrism(poly, [[-0.160, 0.064], [-0.236, 0.064], [-0.236, -0.020], [-0.231, -0.024]], -0.0128, 0.0128, T.fdeDark, { smooth: 10 }); // recessed web
  barrelPrism(poly, chamf(0.040, 0.156, 0.008), -0.264, -0.250, 0.032, T.rubber, { smooth: 10 });      // butt pad
  poly.add(boxGeo(0.012, 0.007, 0.030), at(-0.118, 0.064), T.fdeDark);                                   // adjustment lever
  metal.add(prismGeo(circle(0.0052, 10), 0, 0.004), at(-0.150, 0.087, 0.019, 0, Math.PI / 2, 0), T.steel); // stock QD cup

  // ---------------------------------------------------------------- magazine (separate: reload animation)
  const magTop = [0.133, 0.058], L = 0.152, steps = 12, curve = 19 * Math.PI / 180;
  const stations = [{ p: pt(magTop[0], magTop[1]), s: [0.94, 0.96] }, { p: pt(magTop[0], 0.004) }];
  let mu = magTop[0], my = 0.004;
  const ribs = [0.086, 0.097, 0.108];
  for (let k = 1; k <= steps; k++) {
    const s0 = ((k - 1) / steps) * L, s1 = (k / steps) * L, a = ((s0 + s1) / 2 / L) * curve;
    const ds = s1 - s0;
    mu += Math.sin(a) * ds; my -= Math.cos(a) * ds;
    let sc = 1;
    for (const rb of ribs) if (s1 > rb - 0.003 && s1 < rb + 0.005) sc = 1.035;
    if (s1 > L - 0.016) sc = 1.10;
    stations.push({ p: pt(mu, my), s: [sc, sc * 0.99] });
  }
  mag.add(sweepGeo(rrect(0.0252, 0.062, 0.006, 2), stations, { smooth: 40 }), Matrix.Identity(), T.fde);
  // floor-plate toe + top round (brass case, copper tip) visible when the mag comes out
  mag.add(boxGeo(0.025, 0.010, 0.012), xf(0, my + 0.006, Z(mu + 0.034)), T.fdeDark);
  mag.add(prismGeo(circle(0.0048, 10), 0, 0.044), at(0.114, magTop[1] + 0.0035, 0, 0, Math.PI, 0), T.brass);
  mag.add(prismGeo(circle(0.0029, 8), 0, 0.016, { s1: 0.2 }), at(0.158, magTop[1] + 0.0035, 0, 0, Math.PI, 0), T.copper);

  // ---------------------------------------------------------------- charging handle (separate)
  ch.add(prismGeo(chamf(0.034, 0.0075, 0.002), Z(-0.006), Z(-0.019)), xf(0, 0.1015, 0), T.anod);
  ch.add(boxGeo(0.012, 0.0065, 0.012), at(-0.001, 0.1015), T.anod);
  ch.add(prismGeo(chamf(0.011, 0.0095, 0.002), Z(-0.004), Z(-0.021)), xf(0.0215, 0.1015, 0), T.anodLite); // extended latch (left)
  for (const u of [-0.008, -0.012, -0.016]) ch.add(boxGeo(0.0112, 0.0008, 0.0012), at(u, 0.1066, 0.0215), T.dark);

  return { metal, poly, mag, ch, magTopLocal: pt(magTop[0], 0.004) };
}

// ================================================================================================ public API
const v3 = a => new Vector3(a[0], a[1], a[2]);

function makeSockets(scene, root, defs, prefix = '') {
  const sockets = {};
  for (const [name, p] of Object.entries(defs)) {
    const n = new TransformNode(`${prefix}${name}`, scene);
    n.parent = root;
    n.position.copyFrom(v3(p));
    sockets[name] = n;
  }
  return sockets;
}

/**
 * createM4Prototype(scene, camera, materials?) → { root, sockets, meshes, parts, stats, viewmodel, grips, sightHeight }
 * `materials` is the optional MaterialLibrary (gunmetal / polymer used as texture sources).
 */
export function createM4Prototype(scene, camera, materials = null) {
  const root = new TransformNode('weaponRoot', scene);
  root.parent = camera;
  root.position.set(0.2, -0.22, 0.55);
  root.rotation.set(0, Math.PI, 0);

  const g = buildM4Geometry();
  const metalMat = viewmodelMaterial(scene, materials, 'gunmetal');
  const polyMat = viewmodelMaterial(scene, materials, 'polymer');

  const metal = g.metal.toMesh('m4-metal', scene, root, metalMat, { uvScale: UV_METAL });
  const poly = g.poly.toMesh('m4-polymer', scene, root, polyMat, { uvScale: UV_POLY });
  const magazine = g.mag.toMesh('m4-magazine', scene, root, polyMat, { uvScale: UV_POLY, origin: v3(g.magTopLocal) });
  const chargingHandle = g.ch.toMesh('m4-charging-handle', scene, root, metalMat, { uvScale: UV_METAL, origin: v3(pt(-0.012, 0.1015)) });

  const sockets = makeSockets(scene, root, {
    grip_right: pt(0.031, -0.018),
    grip_left: pt(0.372, BORE_Y - 0.021),
    muzzle: pt(0.5566, BORE_Y),
    optic_mount: pt(0.090, RAIL_Y),
    eject: pt(0.104, 0.080, -0.0156),
    magazine: g.magTopLocal,
    charging_handle: pt(-0.012, 0.1015),
    shell_eject: pt(0.100, 0.084, -0.032),
    sight: pt(SIGHT_U, SIGHT_HEIGHT),
  }, 'm4_');
  // eject direction hint for VFX (root-local): out of the right side, up and slightly back
  sockets.eject.metadata = sockets.shell_eject.metadata = { direction: new Vector3(-0.82, 0.42, 0.38).normalize() };

  // optic node + lens (reticle quad) — the glass sits near the front of the hood
  const optic = new TransformNode('m4_optic', scene);
  optic.parent = root;
  optic.position.copyFrom(v3(pt(SIGHT_U, SIGHT_HEIGHT)));
  const lensMat = createLensMaterial(scene, { name: 'vm-holo-lens', style: 'holo', halfW: 0.0198, halfH: 0.0158 });
  const reticle = new GeoBatch().add(quadGeo(0.0396, 0.0316), Matrix.Identity(), [1, 1, 1]).toMesh('m4-holo-lens', scene, optic, lensMat);
  reticle.alphaIndex = 10;

  const meshes = [metal, poly, magazine, chargingHandle, reticle];
  const tris = [g.metal, g.poly, g.mag, g.ch].reduce((s, b) => s + b.triangles, 2);

  // grip frames for createFpsArms (root-local): origin, up (along the grip / hand width), forward, cross-section
  // grip leans back: its top is further forward (-Z); forward ⟂ up, toward the muzzle
  const gripUp = new Vector3(0, 0.102, -0.038).normalize();
  const grips = {
    right: { origin: v3(pt(0.031, -0.018)), up: gripUp, forward: new Vector3(0, -0.038, -0.102).normalize(), halfWidth: 0.0145, halfDepth: 0.024, radius: 0.012 },
    left: { origin: v3(pt(0.372, BORE_Y)), axis: new Vector3(0, 0, -1), halfWidth: 0.022, halfHeight: 0.021, radius: 0.009 },
  };
  root.metadata = { weaponId: 'rifle', sockets, grips, sightHeight: SIGHT_HEIGHT };

  return {
    id: 'rifle', root, sockets, meshes,
    parts: { magazine, chargingHandle, slide: null, optic, reticle, body: metal, furniture: poly },
    grips, sightHeight: SIGHT_HEIGHT,
    // recommended viewmodel offsets (camera space) for this model's origin
    viewmodel: { hip: [0.2, -0.22, 0.55], ads: [0, -SIGHT_HEIGHT, 0.45] },
    stats: { triangles: tris, drawCalls: meshes.length },
  };
}
