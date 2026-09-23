// Shared, allocation-free helpers used by the presentation, weapon and AI layers.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const saturate = v => clamp(v, 0, 1);
export const smoothstep = (a, b, v) => { const t = saturate((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export const DEG = Math.PI / 180;

/** Frame-rate independent exponential approach. `rate` is 1/seconds. */
export const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

/** Ease used for ADS / sprint transitions (fast in, soft settle). */
export const easeOutCubic = t => 1 - Math.pow(1 - saturate(t), 3);
export const easeInOutSine = t => -(Math.cos(Math.PI * saturate(t)) - 1) / 2;

/** Critically-damped-ish spring integrated with semi-implicit Euler. */
export class Spring {
  constructor(stiffness = 120, damping = 14, value = 0) {
    this.k = stiffness; this.c = damping; this.value = value; this.velocity = 0; this.target = value;
  }
  impulse(v) { this.velocity += v; }
  update(dt) {
    // Sub-step so large frame spikes (mobile thermal throttling) cannot explode the spring.
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const force = (this.target - this.value) * this.k - this.velocity * this.c;
      this.velocity += force * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
  reset(v = 0) { this.value = v; this.velocity = 0; this.target = v; }
}

/** Deterministic PRNG (mulberry32) so recoil/spread patterns and procedural textures are reproducible. */
export function createRng(seed = 1337) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randRange = (rng, a, b) => a + (b - a) * rng();
