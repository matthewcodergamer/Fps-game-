import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  color,
  float,
  hash,
  instanceIndex,
  instancedArray,
  shapeCircle,
  uniform,
  vec3
} from 'three/tsl';

function makeFlashTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const glow = ctx.createRadialGradient(150, 64, 2, 150, 64, 145);
  glow.addColorStop(0, 'rgba(255,255,244,1)');
  glow.addColorStop(.12, 'rgba(255,224,145,.98)');
  glow.addColorStop(.38, 'rgba(255,130,45,.64)');
  glow.addColorStop(1, 'rgba(255,75,10,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 330, 128);

  const streak = ctx.createLinearGradient(120, 0, 510, 0);
  streak.addColorStop(0, 'rgba(255,245,205,.95)');
  streak.addColorStop(.3, 'rgba(255,172,70,.68)');
  streak.addColorStop(1, 'rgba(255,80,15,0)');
  ctx.fillStyle = streak;
  ctx.beginPath();
  ctx.moveTo(105, 57);
  ctx.lineTo(508, 62);
  ctx.lineTo(508, 68);
  ctx.lineTo(105, 71);
  ctx.closePath();
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createParticlePool(renderer, {
  count,
  batch,
  kind,
  mobile
}) {
  const positions = instancedArray(count, 'vec3');
  const velocities = instancedArray(count, 'vec3');
  const ages = instancedArray(count, 'float');
  const lives = instancedArray(count, 'float');
  const scales = instancedArray(count, 'float');

  const dt = uniform(1 / 60);
  const spawnPosition = uniform(new THREE.Vector3());
  const spawnDirection = uniform(new THREE.Vector3(0, 0, -1));
  const spawnStart = uniform(0);
  const intensity = uniform(1);

  const init = Fn(() => {
    const position = positions.element(instanceIndex);
    const velocity = velocities.element(instanceIndex);
    const age = ages.element(instanceIndex);
    const life = lives.element(instanceIndex);
    const scale = scales.element(instanceIndex);
    position.assign(vec3(0, -999, 0));
    velocity.assign(vec3(0, 0, 0));
    age.assign(10);
    life.assign(0);
    scale.assign(.001);
  })().compute(count).setName(`${kind} init`);

  const spawn = Fn(() => {
    const index = float(instanceIndex);
    const position = positions.element(instanceIndex);
    const velocity = velocities.element(instanceIndex);
    const age = ages.element(instanceIndex);
    const life = lives.element(instanceIndex);
    const scale = scales.element(instanceIndex);

    If(index.greaterThanEqual(spawnStart), () => {
      If(index.lessThan(spawnStart.add(batch)), () => {
        const r0 = hash(instanceIndex.add(11));
        const r1 = hash(instanceIndex.add(29));
        const r2 = hash(instanceIndex.add(47));
        const jitter = vec3(r0.sub(.5), r1.sub(.5), r2.sub(.5));
        position.assign(spawnPosition.add(jitter.mul(kind === 'smoke' ? .045 : .018)));

        if (kind === 'smoke') {
          velocity.assign(
            spawnDirection.mul(r0.mul(.34).add(.08))
              .add(vec3(jitter.x.mul(.15), r1.mul(.16).add(.10), jitter.z.mul(.15)))
          );
          age.assign(0);
          life.assign(r2.mul(.62).add(.72).mul(intensity.max(.45)));
          scale.assign(r1.mul(.045).add(.035));
        } else {
          velocity.assign(
            spawnDirection.mul(r0.mul(5.4).add(2.1))
              .add(vec3(jitter.x.mul(3.8), r1.mul(3.1).add(.4), jitter.z.mul(3.8)))
          );
          age.assign(0);
          life.assign(r2.mul(.16).add(.08));
          scale.assign(r1.mul(.018).add(.008));
        }
      });
    });
  })().compute(count).setName(`${kind} spawn`);

  const update = Fn(() => {
    const position = positions.element(instanceIndex);
    const velocity = velocities.element(instanceIndex);
    const age = ages.element(instanceIndex);
    const life = lives.element(instanceIndex);

    If(age.lessThan(life), () => {
      const seed = hash(instanceIndex.add(73));
      if (kind === 'smoke') {
        // Cheap curl-like drift: every particle gets a different phase and the
        // horizontal force changes as its age advances. The entire integration
        // remains in a WebGPU compute pass; JavaScript never loops particles.
        const phase = age.mul(8).add(seed.mul(6.28318));
        velocity.x.addAssign(phase.sin().mul(.085).mul(dt));
        velocity.z.addAssign(phase.cos().mul(.065).mul(dt));
        velocity.y.addAssign(float(.075).mul(dt));
        velocity.mulAssign(float(.996));
      } else {
        velocity.y.subAssign(float(7.4).mul(dt));
        velocity.mulAssign(float(.985));
      }
      position.addAssign(velocity.mul(dt));
      age.addAssign(dt);
    });
  })().compute(count).setName(`${kind} update`);

  const remaining = float(1).sub(ages.element(instanceIndex).div(lives.element(instanceIndex).max(.001))).clamp(0, 1);
  const material = new THREE.SpriteNodeMaterial();
  material.positionNode = positions.toAttribute();
  material.scaleNode = kind === 'smoke'
    ? scales.element(instanceIndex).mul(float(1.15).add(ages.element(instanceIndex).mul(2.25)))
    : scales.element(instanceIndex).mul(remaining.mul(.75).add(.35));
  material.opacityNode = shapeCircle().mul(kind === 'smoke' ? remaining.mul(.44) : remaining);
  material.colorNode = kind === 'smoke' ? color(0x89929c) : color(0xffc46b);
  material.transparent = true;
  material.depthWrite = false;
  material.alphaToCoverage = true;
  material.blending = kind === 'smoke' ? THREE.NormalBlending : THREE.AdditiveBlending;

  const sprites = new THREE.Sprite(material);
  sprites.count = count;
  sprites.frustumCulled = false;
  sprites.renderOrder = kind === 'smoke' ? 40 : 41;

  renderer.compute(init);

  let slot = 0;
  const slots = Math.max(1, Math.floor(count / batch));
  return {
    sprites,
    dt,
    spawnPosition,
    spawnDirection,
    spawnStart,
    intensity,
    update,
    spawnBurst(position, direction, strength = 1) {
      spawnPosition.value.copy(position);
      spawnDirection.value.copy(direction).normalize();
      intensity.value = strength;
      spawnStart.value = (slot++ % slots) * batch;
      renderer.compute(spawn);
    }
  };
}

/**
 * WebGPU-native weapon VFX. Smoke/spark simulation is fixed-pool compute data,
 * not CPU-created sphere meshes. The only CPU-side transient is a reusable
 * muzzle flash group and point light.
 */
export class WebGPUWeaponEffects {
  constructor(scene, renderer, { mobile = false } = {}) {
    if (!renderer?.isWebGPURenderer || renderer.coordinateSystem !== THREE.WebGPUCoordinateSystem) {
      throw new Error('WebGPUWeaponEffects requires a real WebGPU backend.');
    }
    this.scene = scene;
    this.renderer = renderer;
    this.mobile = mobile;
    this.smoke = createParticlePool(renderer, {
      count: mobile ? 384 : 1152,
      batch: mobile ? 24 : 48,
      kind: 'smoke',
      mobile
    });
    this.sparks = createParticlePool(renderer, {
      count: mobile ? 256 : 768,
      batch: mobile ? 20 : 40,
      kind: 'sparks',
      mobile
    });
    scene.add(this.smoke.sprites, this.sparks.sprites);

    this.flashTexture = makeFlashTexture();
    this.flashMaterial = new THREE.MeshBasicMaterial({
      map: this.flashTexture,
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide
    });
    this.flash = new THREE.Group();
    this.flash.name = 'V10CrossQuadMuzzleFlash';
    const geo = new THREE.PlaneGeometry(.42, .14);
    const a = new THREE.Mesh(geo, this.flashMaterial);
    const b = new THREE.Mesh(geo, this.flashMaterial);
    const c = new THREE.Mesh(geo, this.flashMaterial);
    b.rotation.x = Math.PI / 2;
    c.rotation.y = Math.PI / 2;
    this.flash.add(a, b, c);
    this.flash.visible = false;
    scene.add(this.flash);

    this.flashLight = new THREE.PointLight(0xffa65d, 0, mobile ? 3.8 : 5.2, 2);
    scene.add(this.flashLight);
    this.flashLife = 0;
    this._forward = new THREE.Vector3(0, 0, -1);
    this._quat = new THREE.Quaternion();

    this.decals = [];
    this.decalGeometry = new THREE.CircleGeometry(1, 20);

    globalThis.__PROJECT_STRIKE_GPU_EFFECTS__ = {
      backend: 'WebGPU compute',
      cpuParticleMeshes: false,
      smokePool: mobile ? 384 : 1152,
      sparkPool: mobile ? 256 : 768,
      crossQuadMuzzleFlash: true,
      dynamicMuzzleLight: true
    };
  }

  muzzle(position, direction) {
    this.smoke.spawnBurst(position, direction, 1);
    this.sparks.spawnBurst(position, direction, .9);
    this.flash.position.copy(position).addScaledVector(direction, .035);
    this._quat.setFromUnitVectors(this._forward, direction.clone().normalize());
    this.flash.quaternion.copy(this._quat);
    this.flash.scale.setScalar(.82 + Math.random() * .22);
    this.flash.visible = true;
    this.flashMaterial.opacity = 1;
    this.flashLight.position.copy(position);
    this.flashLight.intensity = this.mobile ? 13 : 24;
    this.flashLife = .052;
  }

  impact(point, normal, { kind = 'concrete', decal = true } = {}) {
    const dir = normal.clone().normalize();
    this.sparks.spawnBurst(point.clone().addScaledVector(dir, .012), dir, kind === 'metal' ? 1.25 : .72);
    if (!decal || kind === 'body') return;
    if (this.decals.length >= (this.mobile ? 32 : 96)) {
      const old = this.decals.shift();
      old.removeFromParent();
      old.material.dispose();
    }
    const material = new THREE.MeshBasicMaterial({
      color: 0x121212,
      transparent: true,
      opacity: .72,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2
    });
    const mark = new THREE.Mesh(this.decalGeometry, material);
    mark.scale.setScalar(.026 + Math.random() * .018);
    mark.position.copy(point).addScaledVector(dir, .008);
    mark.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    mark.rotateZ(Math.random() * Math.PI * 2);
    this.scene.add(mark);
    this.decals.push(mark);
  }

  explosion(position, { flash = false } = {}) {
    const direction = new THREE.Vector3(0, 1, 0);
    this.smoke.spawnBurst(position, direction, flash ? .65 : 1.8);
    this.sparks.spawnBurst(position, direction, flash ? .8 : 1.7);
    this.flashLight.position.copy(position);
    this.flashLight.color.set(flash ? 0xffffff : 0xff8b3a);
    this.flashLight.intensity = this.mobile ? 26 : 54;
    this.flashLife = flash ? .11 : .075;
  }

  update(dt) {
    const safeDt = Math.min(.033, Math.max(1 / 240, dt || 1 / 60));
    this.smoke.dt.value = safeDt;
    this.sparks.dt.value = safeDt;
    this.renderer.compute(this.smoke.update);
    this.renderer.compute(this.sparks.update);

    if (this.flashLife > 0) {
      this.flashLife -= safeDt;
      const t = Math.max(0, this.flashLife / .052);
      this.flashMaterial.opacity = Math.min(1, t * 1.15);
      this.flashLight.intensity *= Math.exp(-safeDt * 44);
      if (this.flashLife <= 0) {
        this.flash.visible = false;
        this.flashMaterial.opacity = 0;
        this.flashLight.intensity = 0;
        this.flashLight.color.set(0xffa65d);
      }
    }
  }
}
