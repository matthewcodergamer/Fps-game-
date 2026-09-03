import { GrenadeController } from './CombatSystems.js';

/**
 * No primitive grenade fallback. V10 loads the repository frag and flash GLBs
 * sequentially and refuses to enable Deploy if either model is unavailable.
 */
export class StrictGrenadeController extends GrenadeController {
  async init(assetMap) {
    const loaded = {};
    for (const [type, url] of Object.entries(assetMap)) {
      const ready = await this.load(type, url);
      if (!ready || !this.templates[type]) {
        throw new Error(`Required ${type} grenade model failed: ${url}`);
      }
      loaded[type] = true;
    }
    globalThis.__PROJECT_STRIKE_GRENADE_MODELS__ = {
      realRepositoryModels: true,
      fallbacks: false,
      ...loaded
    };
    return true;
  }

  clone(type) {
    const template = this.templates[type];
    if (!template) throw new Error(`Required real ${type} grenade template is not loaded.`);
    return template.clone(true);
  }
}
