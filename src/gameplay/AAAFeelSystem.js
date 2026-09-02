import * as THREE from 'three';

class SpringAxis {
  constructor(value = 0) {
    this.value = value;
    this.velocity = 0;
  }

  impulse(amount) {
    this.velocity += amount;
  }

  update(target, frequency, damping, dt) {
    const omega = Math.max(1, frequency) * Math.PI * 2;
    const accel = (target - this.value) * omega * omega - 2 * damping * omega * this.velocity;
    this.velocity += accel * dt;
    this.value += this.velocity * dt;
    return this.value;
  }
}

export class AAAFeelSystem {
  constructor(view, { mobile = false } = {}) {
    this.view = view;
    this.mobile = mobile;
    this.cameraPitch = new SpringAxis();
    this.cameraYaw = new SpringAxis();
    this.cameraRoll = new SpringAxis();
    this.weaponDepth = new SpringAxis();
    this.weaponRoll = new SpringAxis();
    this.fovPulse = new SpringAxis();
    this.lastShotAt = 0;
    this.scopeDot = null;
    this.scopeGlass = null;
  }

  shot(amount = 1, definition = {}) {
    const strength = THREE.MathUtils.clamp(amount || 1, .45, 3.2);
    const classScale = definition.class === 'sniper' ? 1.2 : definition.class === 'shotgun' ? 1.15 : 1;
    this.weaponDepth.impulse(.82 * strength * classScale);
    this.weaponRoll.impulse((Math.random() - .5) * .55 * strength);
    this.cameraPitch.impulse(-.31 * strength * classScale);
    this.cameraYaw.impulse((Math.random() - .5) * .16 * strength);
    this.cameraRoll.impulse((Math.random() - .5) * .12 * strength);
    this.fovPulse.impulse(.55 * strength);
    this.lastShotAt = performance.now();
  }

  update(dt, state = {}) {
    const view = this.view;
    const time = state.time || performance.now() * .001;
    const ads = Boolean(view.ads);
    const sprint = Boolean(state.sprint);
    const speedBlend = THREE.MathUtils.clamp((state.speed || 0) / 7.2, 0, 1);

    const depth = this.weaponDepth.update(0, 7.8, .76, dt);
    const weaponRoll = this.weaponRoll.update(0, 8.5, .74, dt);
    const camPitch = this.cameraPitch.update(0, 9.2, .82, dt);
    const camYaw = this.cameraYaw.update(0, 8.7, .84, dt);
    const camRoll = this.cameraRoll.update(0, 10.1, .86, dt);
    const fov = this.fovPulse.update(0, 8.4, .88, dt);

    // The base viewmodel already owns animation, locomotion and IK. This
    // secondary spring acts on their shared root, so both arms and gun inherit
    // the same mass without breaking the hand-lock solution.
    const breath = sprint || state.slide > 0 ? 0 : (ads ? .0022 : .0045);
    const breathX = Math.sin(time * 1.7) * breath;
    const breathY = Math.sin(time * 2.15 + 1.2) * breath * .65;
    const freeX = view._v4FreeAimX || 0;
    const freeY = view._v4FreeAimY || 0;
    const jerk = THREE.MathUtils.clamp((view._v4Jerk || 0) / 95, 0, 1);

    view.root.position.x += breathX - freeX * (ads ? .15 : .28);
    view.root.position.y += breathY - freeY * (ads ? .12 : .22);
    view.root.position.z += depth * .0028;
    view.root.rotation.z += weaponRoll * .006 + Math.sin(time * 37) * jerk * .0015;

    // Camera impulse is deliberately separate from physical gun kick. The
    // gameplay loop rewrites the base camera pose every frame, so these offsets
    // are non-accumulating presentation corrections.
    view.worldCamera.rotation.x += camPitch * .0038;
    view.worldCamera.rotation.y += camYaw * .0032;
    view.worldCamera.rotation.z += camRoll * .0042;
    if (Math.abs(fov) > .0001) {
      view.worldCamera.fov += fov * (this.mobile ? .018 : .024);
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
      speedBlend
    };
  }
}
