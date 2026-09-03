import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { PhysicsCharacterController, CharacterSupportedState } from '@babylonjs/core/Physics/v2/characterController.js';

const DOWN = new Vector3(0, -1, 0);

export class StrikeCharacterController {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.controller = new PhysicsCharacterController(new Vector3(0, 2.1, 9), { capsuleHeight: 1.78, capsuleRadius: .36 }, scene);
    this.controller.maxSlopeCosine = Math.cos(50 * Math.PI / 180);
    this.controller.characterMass = 82;
    this.controller.characterStrength = 3500;
    this.controller.acceleration = 18;
    this.velocity = Vector3.Zero();
    this.yaw = Math.PI;
    this.pitch = 0;
    this.state = 'IDLE';
    this.slideTimer = 0;
    this.camera.position.copyFrom(this.controller.getPosition()).addInPlace(new Vector3(0, .62, 0));
  }

  update(dt, input) {
    this.yaw -= input.lookX;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - input.lookY));
    const support = this.controller.checkSupport(dt, DOWN);
    const grounded = support.supportedState === CharacterSupportedState.SUPPORTED;
    const forward = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new Vector3(forward.z, 0, -forward.x);
    const desired = forward.scale(input.moveY).add(right.scale(input.moveX));
    if (desired.lengthSquared() > 1) desired.normalize();

    let speed = input.sprint ? 6.7 : 4.25;
    if (input.ads) speed *= .72;
    if (input.slide && grounded && desired.lengthSquared() > .05) this.slideTimer = .62;
    if (this.slideTimer > 0) { this.slideTimer -= dt; speed = 8.3; this.state = 'SLIDE'; }
    else if (!grounded) this.state = 'FALL';
    else if (desired.lengthSquared() < .02) this.state = 'IDLE';
    else this.state = input.sprint ? 'SPRINT' : 'WALK';

    const horizontal = desired.scale(speed);
    const current = this.controller.getVelocity();
    let vertical = current.y;
    if (grounded && vertical < 0) vertical = -0.5;
    if (input.jump && grounded) { vertical = 5.8; this.state = 'JUMP'; }
    const target = new Vector3(horizontal.x, vertical, horizontal.z);
    const lerp = 1 - Math.exp(-dt * (grounded ? 18 : 6));
    this.velocity = Vector3.Lerp(current, target, lerp);
    this.controller.setVelocity(this.velocity);
    this.controller.integrate(dt, support, new Vector3(0, -9.81, 0));

    const p = this.controller.getPosition();
    this.camera.position.set(p.x, p.y + .62, p.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    return { grounded, position: p, velocity: this.controller.getVelocity(), state: this.state, forward };
  }
}
