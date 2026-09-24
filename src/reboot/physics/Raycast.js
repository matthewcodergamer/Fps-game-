import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { PhysicsRaycastResult } from '@babylonjs/core/Physics/physicsRaycastResult.js';

/**
 * Havok-backed world raycaster. World hits (walls, floors, props) are resolved against the physics
 * colliders instead of render meshes, so merged/instanced visual geometry never has to be pickable.
 * Results are copied into a caller-owned object so no per-shot allocation is required.
 */
export class WorldRaycaster {
  constructor(scene) {
    this.scene = scene;
    this._result = new PhysicsRaycastResult();
    this._to = new Vector3();
  }

  /**
   * @param {Vector3} from
   * @param {Vector3} dir normalized direction
   * @param {number} maxDistance
   * @param {{hit:boolean,point:Vector3,normal:Vector3,distance:number,body:any,node:any}} out
   * @param {import('@babylonjs/core/Physics/physicsRaycastResult.js').IRaycastQuery} [query]
   */
  cast(from, dir, maxDistance, out, query) {
    const engine = this.scene.getPhysicsEngine();
    out.hit = false; out.distance = maxDistance; out.body = null; out.node = null;
    if (!engine) return out;
    this._to.copyFrom(dir).scaleInPlace(maxDistance).addInPlace(from);
    this._result.reset(from, this._to);
    engine.raycastToRef(from, this._to, this._result, query);
    if (!this._result.hasHit) return out;
    out.hit = true;
    out.point.copyFrom(this._result.hitPointWorld);
    out.normal.copyFrom(this._result.hitNormalWorld);
    out.distance = Vector3.Distance(from, out.point);
    out.body = this._result.body ?? null;
    out.node = this._result.body?.transformNode ?? null;
    return out;
  }

  /** True when nothing solid blocks the segment a→b (used for AI line of sight). */
  clear(a, b, query) {
    const engine = this.scene.getPhysicsEngine();
    if (!engine) return true;
    this._result.reset(a, b);
    engine.raycastToRef(a, b, this._result, query);
    return !this._result.hasHit;
  }
}

export const createHitRecord = () => ({ hit: false, point: new Vector3(), normal: new Vector3(0, 1, 0), distance: 0, body: null, node: null });
