import { FPSViewModel } from './weapons/FPSViewModel.js';

const survivalMode = Boolean(globalThis.__PROJECT_STRIKE_IOS_SURVIVAL__);
const proto = FPSViewModel.prototype;

if (survivalMode) {
  const loadArms = proto.loadArms;
  proto.loadArms = async function (...args) {
    const repositoryReady = await loadArms.apply(this, args);
    const fallbackReady = Boolean(this.diagnostics?.arms?.fallback || this.arms);
    this.diagnostics.iosSurvivalArms = {
      repositoryReady,
      fallbackReady,
      mode: 'procedural-first'
    };
    return repositoryReady || fallbackReady;
  };

  const loadWeapon = proto.loadWeapon;
  proto.loadWeapon = async function (...args) {
    const repositoryReady = await loadWeapon.apply(this, args);
    const fallbackReady = Boolean(this.diagnostics?.weapon?.fallback || this.weapon);
    this.diagnostics.iosSurvivalWeapon = {
      repositoryReady,
      fallbackReady,
      mode: 'procedural-first'
    };
    return repositoryReady || fallbackReady;
  };
}

globalThis.__PROJECT_STRIKE_IOS_SURVIVAL_RUNTIME__ = {
  enabled: survivalMode,
  proceduralViewmodelCountsAsReady: survivalMode,
  repositoryModelsRequestedAtStartup: survivalMode ? 0 : null
};
