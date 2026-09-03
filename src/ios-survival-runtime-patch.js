import { AssetManager } from './assets/AssetManager.js';
import { GrenadeController, RecoilController } from './gameplay/CombatSystems.js';
import { FPSViewModel } from './weapons/FPSViewModel.js';

const mobileStreaming = Boolean(globalThis.__PROJECT_STRIKE_MOBILE_STREAMING__);
const proto = FPSViewModel.prototype;

// Expose the already-patched AssetManager instance to systems created later in
// gameplay (notably the real true-body rig). Because this wrapper sits outside
// the V9 mobile loader, those late loads still go through the same one-at-a-time
// critical/background queue rather than creating a second GLTF decoder path.
const streamedLoadModel = AssetManager.prototype.loadModel;
AssetManager.prototype.loadModel = function (...args) {
  globalThis.__PROJECT_STRIKE_ASSET_MANAGER__ = this;
  return streamedLoadModel.apply(this, args);
};

// V9 makes the repository models authoritative again. V4 still has emergency
// geometry recovery if a file genuinely fails, but a fallback no longer counts
// as a successful iPhone load and diagnostics expose it immediately.
if (mobileStreaming) {
  const loadArms = proto.loadArms;
  proto.loadArms = async function (...args) {
    const repositoryReady = await loadArms.apply(this, args);
    const fallback = Boolean(this.diagnostics?.arms?.fallback);
    this.diagnostics.iosRealArms = {
      repositoryReady,
      fallback,
      mode: 'repository-real-first'
    };
    return repositoryReady;
  };

  const loadWeapon = proto.loadWeapon;
  proto.loadWeapon = async function (...args) {
    const repositoryReady = await loadWeapon.apply(this, args);
    const fallback = Boolean(this.diagnostics?.weapon?.fallback);
    this.diagnostics.iosRealWeapon = {
      repositoryReady,
      fallback,
      model: this.diagnostics?.weapon?.url || this.currentDefinition?.model,
      mode: 'repository-real-first'
    };
    return repositoryReady;
  };

  // V4 deliberately made grenade warm-up non-blocking. On V9 mobile, the user
  // specifically wants the repository grenade meshes, so wait for both real
  // grenade templates before enabling Deploy. AssetManager still serializes the
  // two decodes, so this does not recreate the old concurrent-memory spike.
  GrenadeController.prototype.init = async function (assets = {}) {
    this.templates = this.templates || {};
    const entries = Object.entries(assets);
    const result = {};
    for (const [type, url] of entries) {
      result[type] = await this.load(type, url);
    }
    this._v9RealGrenades = result;
    globalThis.__PROJECT_STRIKE_GRENADE_MODELS__ = {
      realRepositoryModels: true,
      ...result
    };
    return this;
  };

  // The gameplay controller already applies persistent recoil to the player's
  // aim. Keep that correction modest on touch so the camera rises naturally
  // instead of stacking with the presentation spring.
  const recoilShot = RecoilController.prototype.shot;
  RecoilController.prototype.shot = function (definition) {
    const kick = recoilShot.call(this, definition);
    return {
      pitch: kick.pitch * .52,
      yaw: kick.yaw * .48
    };
  };
}

globalThis.__PROJECT_STRIKE_IOS_SURVIVAL_RUNTIME__ = {
  enabled: false,
  mobileStreaming,
  proceduralViewmodelCountsAsReady: false,
  repositoryModelsRequestedAtStartup: mobileStreaming ? 'real-critical-models' : null,
  realWeaponRequired: mobileStreaming,
  realArmsRequired: mobileStreaming,
  realGrenadesRequired: mobileStreaming,
  realTrueBodyRequestedAfterDeploy: mobileStreaming,
  boundedTouchRecoil: mobileStreaming
};
