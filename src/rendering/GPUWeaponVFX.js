import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  deltaTime,
  float,
  hash,
  instanceIndex,
  instancedArray,
  shapeCircle,
  uniform,
  vec3
} from 'three/tsl';

function createSmokeSystem(renderer, scene, count) {
  const positions = instancedArray(count, 'vec3');
  const velocities = instancedArray(count, 'vec3');
  const ages = instancedArray(count, 'float');
  const lives = instancedArray(count, 'float');
  const emitter = uniform(new THREE.Vector3());
  const direction = uniform(new THREE.Vector3(0, 0, -1));

  const initCompute = Fn(() => {
    positions.element(instanceIndex).assign(vec3(0, -1000, 0));
    velocities.element(instanceIndex).assign(vec3(0));
    ages.element(instanceIndex).assign(float(999));
    lives.element(instanceIndex).assign(float(1));
  })().compute(count).setName('Project Strike Smoke Init');

  const spawnCompute = Fn(() => {
    const position = positions.element(instanceIndex);
    const velocity = velocities.element(instanceIndex);
    const age = ages.element(instanceIndex);
    const life = lives.element(instanceIndex);
    const r1 = hash(instanceIndex);
    const r2 = hash(instanceIndex.add(17));
    const r3 = hash(instanceIndex.add(53));

    position.assign(
      emitter.add(vec3(
        r1.sub(0.5).mul(0.035),
        r2.sub(0.5).mul(0.028),
        r3.sub(0.5).mul(0.035)
      ))
    );
    velocity.assign(
      direction.mul(r3.mul(0.2).add(0.08)).add(
        vec3(
          r2.sub(0.5).mul(0.11),
          r1.mul(0.13).add(0.055),
          r3.sub(0.5).mul(0.11)
        )
      )
    );
    age.assign(float(0));
    life.assign(r1.mul(0.52).add(0.38));
  })().compute(count).setName('Project Strike Smoke Spawn');

  const updateCompute = Fn(() => {
    const position = positions.element(instanceIndex);
    const velocity = velocities.element(instanceIndex);
    const age = ages.element(instanceIndex);
    const life = lives.element(instanceIndex);
    const r1 = hash(instanceIndex.add(31));
    const r2 = hash(instanceIndex.add(79));

    If(age.lessThan(life), () => {
      const turbulence = vec3(
        r1.sub(0.5).mul(0.026),
        float(0.07),
        r2.sub(0.5).mul(0.026)
      );
      velocity.addAssign(turbulence.mul(deltaTime));
      velocity.mulAssign(float(0.995));
      position.addAssign(velocity.mul(deltaTime));
      age.addAssign(deltaTime);
    });
  })().compute(count).setName('Project Strike Smoke Update');

  const ageNode = ages.element(instanceIndex);
  const lifeNode = lives.element(instanceIndex).max(0.001);
  const normalizedAge = ageNode.div(lifeNode).clamp(0, 1);
  const fade = float(1).sub(normalizedAge);
  const smokeMaterial = new THREE.SpriteNodeMaterial();
  smokeMaterial.positionNode = positions.toAttribute();
  smokeMaterial.scaleNode = float(0.022).add(normalizedAge.mul(0.17));
  smokeMaterial.opacityNode = shapeCircle().mul(fade.mul(fade)).mul(0.34);
  smokeMaterial.colorNode = vec3(0.66, 0.69, 0.72).mul(float(1).sub(normalizedAge.mul(0.38)));
  smokeMaterial.transparent = true;
  smokeMaterial.depthWrite = false;
  smokeMaterial.alphaToCoverage = true;

  const smoke = new THREE.Sprite(smokeMaterial);
  smoke.count = count;
  smoke.frustumCulled = false;
  smoke.renderOrder = 6;
  scene.add(smoke);

  return { emitter, direction, initCompute, spawnCompute, updateCompute, object: smoke };
}

function createSparkSystem(renderer, scene, count) {
  const positions = instancedArray(count, 'vec3');
  const velocities = instancedArray(count, 'vec3');
  const ages = instancedArray(count, 'float');
  const lives = instancedArray(count, 'float');
  const emitter = uniform(new THREE.Vector3());
  const direction = uniform(new THREE.Vector3(0, 0, -1));

  const initCompute = Fn(() => {
    positions.element(instanceIndex).assign(vec3(0, -1000, 0));
    velocities.element(instanceIndex).assign(vec3(0));
    ages.element(instanceIndex).assign(float(999));
    lives.element(instanceIndex).assign(float(1));
  })().compute(count).setName('Project Strike Spark Init');

  const spawnCompute = Fn(() => {
    const position = positions.element(instanceIndex);
    const velocity = velocities.element(instanceIndex);
    const age = ages.element(instanceIndex);
    const life = lives.element(instanceIndex);
    const r1 = hash(instanceIndex.add(5));
    const r2 = hash(instanceIndex.add(41));
    const r3 = hash(instanceIndex.add(97));

    position.assign(emitter);
    velocity.assign(
      direction.mul(r1.mul(4.2).add(1.3)).add(
        vec3(
          r2.sub(0.5).mul(3.4),
          r3.sub(0.25).mul(2.3),
          r1.sub(0.5).mul(3.4)
        )
      )
    );
    age.assign(float(0));
    life.assign(r2.mul(0.08).add(0.055));
  })().compute(count).setName('Project Strike Spark Spawn');

  const updateCompute = Fn(() => {
    const position = positions.element(instanceIndex);
    const velocity = velocities.element(instanceIndex);
    const age = ages.element(instanceIndex);
    const life = lives.element(instanceIndex);
    If(age.lessThan(life), () => {
      velocity.y.subAssign(deltaTime.mul(7.5));
      position.addAssign(velocity.mul(deltaTime));
      velocity.mulAssign(float(0.978));
      age.addAssign(deltaTime);
    });
  })().compute(count).setName('Project Strike Spark Update');

  const ageNode = ages.element(instanceIndex);
  const lifeNode = lives.element(instanceIndex).max(0.001);
  const t = ageNode.div(lifeNode).clamp(0, 1);
  const sparkMaterial = new THREE.SpriteNodeMaterial();
  sparkMaterial.positionNode = positions.toAttribute();
  sparkMaterial.scaleNode = float(0.0045).mul(float(1).sub(t).add(0.2));
  sparkMaterial.opacityNode = shapeCircle().mul(float(1).sub(t));
  sparkMaterial.colorNode = vec3(1.0, 0.58, 0.18).mul(float(2.5));
  sparkMaterial.transparent = true;
  sparkMaterial.depthWrite = false;
  sparkMaterial.blending = THREE.AdditiveBlending;

  const sparks = new THREE.Sprite(sparkMaterial);
  sparks.count = count;
  sparks.frustumCulled = false;
  sparks.renderOrder = 7;
  scene.add(sparks);

  return { emitter, direction, initCompute, spawnCompute, updateCompute, object: sparks };
}

/**
 * WebGPU-only firearm VFX. Simulation lives in GPU storage buffers and never
 * loops particle positions on the JavaScript CPU. Counts are intentionally
 * conservative on iPhone 11 so the real GLBs remain the visual priority.
 */
export class GPUWeaponVFX {
  constructor(renderer, scene, { mobile = false } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.mobile = mobile;
    this.smoke = createSmokeSystem(renderer, scene, mobile ? 160 : 560);
    this.sparks = createSparkSystem(renderer, scene, mobile ? 72 : 240);
    this.flashLight = new THREE.PointLight(0xffa653, 0, mobile ? 3.8 : 5.4, 2);
    this.flashLight.castShadow = false;
    scene.add(this.flashLight);
    this.flashEnergy = 0;
    this.initialized = false;
  }

  async init() {
    await Promise.resolve(this.renderer.compute(this.smoke.initCompute));
    await Promise.resolve(this.renderer.compute(this.sparks.initCompute));
    this.initialized = true;
    globalThis.__PROJECT_STRIKE_GPU_VFX__ = {
      backend: 'WebGPU compute',
      smokeParticles: this.mobile ? 160 : 560,
      sparkParticles: this.mobile ? 72 : 240,
      cpuParticleLoops: false,
      volumetricFluidClaimed: false,
      ready: true
    };
  }

  fire(origin, direction, strength = 1) {
    if (!this.initialized) return;
    this.smoke.emitter.value.copy(origin);
    this.smoke.direction.value.copy(direction).normalize();
    this.sparks.emitter.value.copy(origin);
    this.sparks.direction.value.copy(direction).normalize();
    this.flashLight.position.copy(origin);
    this.flashEnergy = THREE.MathUtils.clamp(18 * strength, 9, this.mobile ? 26 : 42);
    this.renderer.compute(this.smoke.spawnCompute);
    this.renderer.compute(this.sparks.spawnCompute);
  }

  update(dt) {
    if (!this.initialized) return;
    this.renderer.compute(this.smoke.updateCompute);
    this.renderer.compute(this.sparks.updateCompute);
    this.flashEnergy = THREE.MathUtils.damp(this.flashEnergy, 0, 48, Math.min(dt, 1 / 30));
    this.flashLight.intensity = this.flashEnergy;
  }
}
