import * as THREE from 'three';

function makeHazeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(48, 48, 4, 48, 48, 47);
  gradient.addColorStop(0, 'rgba(255,255,255,.32)');
  gradient.addColorStop(.42, 'rgba(255,255,255,.10)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 96, 96);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Cheap cinematic lighting layer for the web runtime.
 *
 * This intentionally approximates the visual language of bounced neon and
 * volumetric haze without pretending to be hardware path tracing or Lumen.
 * It is designed to stay viable on mobile WebGL2.
 */
export function installCyberLighting(scene, { mobile = false } = {}) {
  const root = new THREE.Group();
  root.name = 'CyberLightingRig';
  scene.add(root);

  const warmBounce = new THREE.PointLight(0xff7a36, mobile ? 2.2 : 4.8, 19, 2);
  warmBounce.position.set(-7, 2.6, 8);
  const magentaBounce = new THREE.PointLight(0xff2d91, mobile ? 1.8 : 4.1, 17, 2);
  magentaBounce.position.set(8, 3.1, -7);
  const cyanBounce = new THREE.PointLight(0x28d9ff, mobile ? 1.9 : 4.4, 18, 2);
  cyanBounce.position.set(5, 2.4, 13);
  root.add(warmBounce, magentaBounce, cyanBounce);

  const texture = makeHazeTexture();
  const haze = [];
  const count = mobile ? 12 : 28;
  for (let i = 0; i < count; i++) {
    const color = i % 3 === 0 ? 0xff8746 : i % 3 === 1 ? 0x44cfff : 0xd94cff;
    const material = new THREE.SpriteMaterial({
      map: texture,
      color,
      transparent: true,
      opacity: mobile ? .035 : .05,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set((Math.random() - .5) * 52, .9 + Math.random() * 6, (Math.random() - .5) * 62);
    const scale = 4 + Math.random() * 7;
    sprite.scale.set(scale, scale * (.55 + Math.random() * .35), 1);
    sprite.userData.baseY = sprite.position.y;
    sprite.userData.phase = Math.random() * Math.PI * 2;
    root.add(sprite);
    haze.push(sprite);
  }

  return {
    root,
    update(time = 0) {
      warmBounce.intensity = (mobile ? 2.2 : 4.8) * (.94 + Math.sin(time * .44) * .06);
      magentaBounce.intensity = (mobile ? 1.8 : 4.1) * (.93 + Math.sin(time * .52 + 1.7) * .07);
      cyanBounce.intensity = (mobile ? 1.9 : 4.4) * (.94 + Math.sin(time * .48 + 3.2) * .06);
      for (const sprite of haze) {
        sprite.position.y = sprite.userData.baseY + Math.sin(time * .16 + sprite.userData.phase) * .22;
      }
    },
    dispose() {
      texture.dispose();
      for (const sprite of haze) sprite.material.dispose();
      scene.remove(root);
    }
  };
}
