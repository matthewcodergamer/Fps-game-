import * as THREE from 'three';

class SpringAxis {
  constructor(value = 0, { maxValue = 3, maxVelocity = 36 } = {}) {
    this.value = value;
    this.velocity = 0;
    this.maxValue = maxValue;
    this.maxVelocity = maxVelocity;
  }

  impulse(amount) {
    this.velocity = THREE.MathUtils.clamp(
      this.velocity + amount,
      -this.maxVelocity,
      this.maxVelocity
    );
  }

  update(target, frequency, damping, dt) {
    // Explicit high-frequency springs can explode after one dropped mobile
    // frame. Substep to <= 1/120s and clamp both state terms so recoil can
    // never accumulate into a violent camera oscillation.
    const frame = THREE.MathUtils.clamp(Number(dt) || 0, 0, 1 / 30);
    const steps = Math.max(1, Math.ceil(frame / (1 / 120)));
    const h = frame / steps;
    const omega = Math.max(1, frequency) * Math.PI * 2;
    for (let i = 0; i < steps; i++) {
      const accel = (target - this.value) * omega * omega - 2 * damping * omega * this.velocity;
      this.velocity = THREE.MathUtils.clamp(
        this.velocity + accel * h,
        -this.maxVelocity,
        this.maxVelocity
      );
      this.value = THREE.MathUtils.clamp(
        this.value + this.velocity * h,
        -this.maxValue,
        this.maxValue
      );
    }
    if (Math.abs(this.value - target) < 1e-5 && Math.abs(this.velocity) < 1e-4) {
      this.value = target;
      this.velocity = 0;
    }
    return this.value;
  }

  reset(value = 0) {
    this.value = value;
    this.velocity = 0;
  }
}

export class AAAFeelSystem {
  constructor(view, { mobile = false } = {}) {
    this.view = view;
    this.mobile = mobile;
    this.cameraPitch = new SpringAxis(0, { maxValue: 1.15, maxVelocity: 16 });
    this.cameraYaw = new SpringAxis(0, { maxValue: .7, maxVelocity: 10 });
    this.cameraRoll = new SpringAxis(0, { maxValue: .6, maxVelocity: 9 });
    this.weaponDepth = new SpringAxis(0, { maxValue: 3.2, maxVelocity: 34 });
    this.weaponRoll = new SpringAxis(0, { maxValue: 2.4, maxVelocity: 28 });
    this.fovPulse = new SpringAxis(0, { maxValue: 2.2, maxVelocity: 22 });
    this.lastShotAt = 0;
    this.scopeDot = null;
    this.scopeGlass = null;
  }

  shot(amount = 1, definition = {}) {
    const strength = THREE.MathUtils.clamp(amount || 1, .45, 2.8);
    const classScale = definition.class === 'sniper' ? 1.15 : definition.class === 'shotgun' ? 1.1 : 1;
    const mobileCameraScale = this.mobile ? .42 : 1;
    const mobileWeaponScale = this.mobile ? .74 : 1;

    this.weaponDepth.impulse(.72 * strength * classScale * mobileWeaponScale);
    this.weaponRoll.impulse((Math.random() - .5) * .42 * strength * mobileWeaponScale);
    this.cameraPitch.impulse(-.24 * strength * classScale * mobileCameraScale);
    this.cameraYaw.impulse((Math.random() - .5) * .09 * strength * mobileCameraScale);
    this.cameraRoll.impulse((Math.random() - .5) * .065 * strength * mobileCameraScale);
    this.fovPulse.impulse(.32 * strength * (this.mobile ? .35 : 1));
    this.lastShotAt = performance.now();
  }

  update(dt, state = {}) {
    const view = this.view;
    const safeDt = THREE.MathUtils.clamp(Number(dt) || 0, 0, 1 / 30);
    const time = state.time || performance.now() * .001;
    const ads = Boolean(view.ads);
    const sprint = Boolean(state.sprint);
    const speedBlend = THREE.MathUtils.clamp((state.speed || 0) / 7.2, 0, 1);

    const depth = this.weaponDepth.update(0, 7.2, .9, safeDt);
    const weaponRoll = this.weaponRoll.update(0, 7.8, .9, safeDt);
    const camPitch = this.cameraPitch.update(0, 8.2, 1.0, safeDt);
    const camYaw = this.cameraYaw.update(0, 7.9, 1.0, safeDt);
    const camRoll = this.cameraRoll.update(0, 8.4, 1.02, safeDt);
    const fov = this.fovPulse.update(0, 7.4, 1.02, safeDt);

    const breath = sprint || state.slide > 0 ? 0 : (ads ? .0018 : .0034);
    const breathX = Math.sin(time * 1.7) * breath;
    const breathY = Math.sin(time * 2.15 + 1.2) * breath * .65;
    const freeX = THREE.MathUtils.clamp(view._v4FreeAimX || 0, -.05, .05);
    const freeY = THREE.MathUtils.clamp(view._v4FreeAimY || 0, -.035, .035);
    const jerk = THREE.MathUtils.clamp((view._v4Jerk || 0) / 95, 0, 1);

    view.root.position.x += breathX - freeX * (ads ? .12 : .22);
    view.root.position.y += breathY - freeY * (ads ? .1 : .18);
    view.root.position.z += THREE.MathUtils.clamp(depth * .0024, -.012, .012);
    view.root.rotation.z += THREE.MathUtils.clamp(
      weaponRoll * .0046 + Math.sin(time * 37) * jerk * .001,
      -.018,
      .018
    );

    // Presentation-only camera correction. The persistent aim angle remains in
    // the player controller and gets rewritten every frame, so this offset is
    // small, bounded, and cannot build up shot after shot.
    const cameraScale = this.mobile ? .52 : 1;
    view.worldCamera.rotation.x += THREE.MathUtils.clamp(camPitch * .0028 * cameraScale, -.0055, .0055);
    view.worldCamera.rotation.y += THREE.MathUtils.clamp(camYaw * .0024 * cameraScale, -.0035, .0035);
    view.worldCamera.rotation.z += THREE.MathUtils.clamp(camRoll * .003 * cameraScale, -.0035, .0035);
    if (Math.abs(fov) > .0001) {
      view.worldCamera.fov += THREE.MathUtils.clamp(fov * (this.mobile ? .004 : .016), -.18, .18);
      view.worldCamera.updateProjectionMatrix();
    }

    this.scopeDot ||= document.querySelector('#scopeOverlay .scopeDot');
    this.scopeGlass ||= document.querySelector('#scopeOverlay .scopeGlass');
    if (this.scopeDot) {
      const px = THREE.MathUtils.clamp(freeX * -420, -13, 13);
      const py = THREE.MathUtils.clamp(freeY * 420, -10, 10);
      this.scopeDot.style.transform = `translate3d(${px.toFixed(2)}px,${py.toFixed(2)}px,0)`;
    }
    if (this.scopeGlass) {
      const px = THREE.MathUtils.clamp(freeX * -58, -2.1, 2.1);
      const py = THREE.MathUtils.clamp(freeY * 58, -1.7, 1.7);
      this.scopeGlass.style.setProperty('--lens-shift-x', `${px.toFixed(2)}px`);
      this.scopeGlass.style.setProperty('--lens-shift-y', `${py.toFixed(2)}px`);
    }

    globalThis.__PROJECT_STRIKE_AAA_STATE__ = {
      freeAimX: freeX,
      freeAimY: freeY,
      jerk,
      recoilAgeMs: performance.now() - this.lastShotAt,
      speedBlend,
      boundedSpring: true,
      cameraSpring: {
        pitch: camPitch,
        yaw: camYaw,
        roll: camRoll
      }
    };
  }
}
