import HavokPhysics from '@babylonjs/havok';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin.js';

export async function enableHavok(scene) {
  const instance = await HavokPhysics();
  const plugin = new HavokPlugin(true, instance);
  plugin.setTimeStep(1 / 60);
  scene.enablePhysics(new Vector3(0, -9.81, 0), plugin);
  return plugin;
}
