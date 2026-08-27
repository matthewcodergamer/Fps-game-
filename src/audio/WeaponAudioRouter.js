export class WeaponAudioRouter {
  constructor(audioManager, manifest = null) {
    this.audio = audioManager;
    this.manifest = manifest;
    this.weaponMap = new Map();
  }

  async loadManifest(url = '/game-assets/manifests/weapons.json') {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Weapon manifest failed: ${res.status}`);
    this.manifest = await res.json();
    this.weaponMap.clear();
    for (const weapon of this.manifest.weapons || []) this.weaponMap.set(weapon.id, weapon);
    return this.manifest;
  }

  definition(id) { return this.weaponMap.get(id) || null; }

  async emit(weaponId, eventName, context = {}) {
    const def = this.definition(weaponId);
    const event = def?.audio?.[eventName];
    if (!event) return false;

    const candidates = Array.isArray(event) ? event : event.variations || [event];
    if (!candidates.length) return false;
    const choice = candidates[Math.floor(Math.random() * candidates.length)];

    if (typeof this.audio?.playManifestEvent === 'function') {
      await this.audio.playManifestEvent(choice, context);
      return true;
    }
    if (typeof this.audio?.play === 'function' && choice.path) {
      this.audio.play(choice.path, context);
      return true;
    }
    return false;
  }
}
