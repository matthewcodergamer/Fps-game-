export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.weaponBus = null;
    this.compressor = null;
    this.layers = {
      resident: new Map(),
      weapons_player: new Map(),
      dlc_weapons: new Map()
    };
    this.manifests = [];
    this.permanentLoaded = false;
    this.loading = new Map();
    this.indexedFiles = 0;
  }

  async unlock() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Web Audio is unavailable in this browser.');
      this.ctx = new AudioContextClass({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = .82;
      this.weaponBus = this.ctx.createGain();
      this.weaponBus.gain.value = .92;
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -12;
      this.compressor.knee.value = 10;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = .003;
      this.compressor.release.value = .16;
      this.weaponBus.connect(this.compressor);
      this.compressor.connect(this.master);
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  clear() {
    for (const layer of Object.values(this.layers)) layer.clear();
    this.manifests.length = 0;
    this.permanentLoaded = false;
    this.loading.clear();
    this.indexedFiles = 0;
  }

  detectLayer(value = '') {
    const path = String(value).toLowerCase();
    if (path.includes('dlc_weapons')) return 'dlc_weapons';
    if (path.includes('resident')) return 'resident';
    return 'weapons_player';
  }

  normalizeBank(source = '', fallback = '') {
    const clean = String(source || fallback).replace(/\\/g, '/');
    const pieces = clean.split('/').filter(Boolean);
    const directoryBank = pieces.at(-2);
    const file = pieces.at(-1) || clean;
    const candidate = /\.(?:wav|mp3|ogg|m4a)$/i.test(file) && directoryBank ? directoryBank : file;
    return candidate
      .replace(/\.awc$/i, '')
      .replace(/^weapons_player_/i, '')
      .replace(/^dlc_weapons_/i, '')
      .replace(/^resident_/i, '');
  }

  ensureBank(layer, bank) {
    const map = this.layers[layer];
    if (!map || !bank) return null;
    if (!map.has(bank)) map.set(bank, []);
    return map.get(bank);
  }

  async decodeArrayBuffer(arrayBuffer) {
    await this.unlock();
    return this.ctx.decodeAudioData(arrayBuffer.slice(0));
  }

  async fetchDecode(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return this.decodeArrayBuffer(await response.arrayBuffer());
  }

  registerStream(stream, defaults = {}) {
    const path = stream.path || stream.file || '';
    const layer = stream.layer || defaults.layer || this.detectLayer(path || stream.source || defaults.source);
    const bank = stream.bank || defaults.bank || this.normalizeBank(stream.source || defaults.source, path);
    const destination = this.ensureBank(layer, bank);
    if (!destination) return false;
    const id = stream.streamId || stream.id || String(stream.streamIndex ?? stream.index ?? destination.length);
    if (destination.some(item => item.id === id && item.source === path)) return false;
    const relative = String(path).replace(/^public\/game-assets\//, './game-assets/');
    destination.push({
      buffer: null,
      url: relative ? new URL(relative, document.baseURI).href : null,
      id,
      index: stream.streamIndex ?? stream.index ?? destination.length,
      source: path,
      duration: Number(stream.duration || 0),
      kind: stream.kind || (Number(stream.duration || 0) < .12 ? 'short component' : 'audio clip')
    });
    this.indexedFiles++;
    return true;
  }

  registerManifest(manifest) {
    for (const stream of manifest.files || []) this.registerStream(stream);
    for (const bankMeta of manifest.banks || []) {
      const layer = bankMeta.layer || this.detectLayer(bankMeta.source || bankMeta.id);
      const bank = this.normalizeBank(bankMeta.source, bankMeta.id);
      for (const stream of bankMeta.streams || []) {
        this.registerStream(stream, { layer, bank, source: bankMeta.source });
      }
    }
    for (const [layer, layerData] of Object.entries(manifest.layers || {})) {
      for (const bankMeta of layerData.banks || []) {
        const bank = this.normalizeBank(bankMeta.source, bankMeta.id);
        for (const stream of bankMeta.streams || []) {
          this.registerStream(stream, { layer, bank, source: bankMeta.source });
        }
      }
    }
  }

  async loadPermanent() {
    if (this.permanentLoaded) return this.indexedFiles;
    try {
      const response = await fetch('./game-assets/audio/audio-manifest.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error(`${response.status} audio manifest`);
      const manifest = await response.json();
      this.manifests.push(manifest);
      this.registerManifest(manifest);
      if (!this.indexedFiles) throw new Error('Audio manifest contains no playable WAV entries.');
      console.info(`Project Strike indexed ${this.indexedFiles} repository audio files.`);
    } catch (error) {
      console.warn('Permanent Project Strike audio unavailable.', error);
    }
    this.permanentLoaded = true;
    return this.indexedFiles;
  }

  getBank(layer, bank) {
    return this.layers[layer]?.get(bank) || null;
  }

  findBank(bank) {
    for (const layer of ['weapons_player', 'dlc_weapons', 'resident']) {
      const exact = this.layers[layer].get(bank);
      if (exact?.length) return { layer, bank, streams: exact };
      for (const [name, streams] of this.layers[layer]) {
        if (name.includes(bank) || bank.includes(name)) return { layer, bank: name, streams };
      }
    }
    return null;
  }

  async preloadBank(layer, bank, { limit = 8 } = {}) {
    await this.loadPermanent();
    const streams = this.getBank(layer, bank);
    if (!streams?.length) return 0;
    const score = stream => {
      const duration = Number(stream.duration || 0);
      return (/audio clip/i.test(stream.kind) ? 5 : 0) + (duration >= .12 ? 3 : 0) + Math.min(2, duration);
    };
    const selected = [...streams].sort((a, b) => score(b) - score(a)).slice(0, limit);
    const results = await Promise.allSettled(selected.map(async stream => {
      if (stream.buffer) return true;
      if (!stream.url) return false;
      if (!this.loading.has(stream.url)) this.loading.set(stream.url, this.fetchDecode(stream.url));
      try {
        stream.buffer = await this.loading.get(stream.url);
        stream.duration ||= stream.buffer.duration;
        return true;
      } finally {
        this.loading.delete(stream.url);
      }
    }));
    return results.filter(result => result.status === 'fulfilled' && result.value).length;
  }

  async preloadWeapon(bank, options = {}) {
    await this.loadPermanent();
    for (const layer of ['weapons_player', 'dlc_weapons']) {
      if (this.layers[layer].has(bank)) return this.preloadBank(layer, bank, options);
    }
    return 0;
  }

  chooseStream(streams, { mechanical = false } = {}) {
    const ready = streams?.filter(stream => stream.buffer) || [];
    if (!ready.length) return null;
    let preferred = mechanical
      ? ready.filter(stream => /short|component/i.test(stream.kind) || (stream.duration && stream.duration < .12))
      : ready.filter(stream => /audio clip/i.test(stream.kind) || stream.duration >= .12);
    if (!preferred.length) preferred = ready;
    return preferred[Math.floor(Math.random() * preferred.length)];
  }

  playBuffer(buffer, {
    gain = 1,
    rate = 1,
    position = null,
    lowpass = null,
    bus = 'weapon'
  } = {}) {
    if (!buffer || !this.ctx) return null;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gainNode = this.ctx.createGain();
    gainNode.gain.value = gain;
    let tail = gainNode;
    if (lowpass) {
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = lowpass;
      gainNode.connect(filter);
      tail = filter;
    }
    const output = bus === 'master' ? this.master : this.weaponBus;
    source.connect(gainNode);
    if (position && this.ctx.createPanner) {
      const panner = this.ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 2;
      panner.maxDistance = 180;
      panner.rolloffFactor = 1.1;
      if (panner.positionX) {
        panner.positionX.value = position.x;
        panner.positionY.value = position.y;
        panner.positionZ.value = position.z;
      } else {
        panner.setPosition(position.x, position.y, position.z);
      }
      tail.connect(panner);
      panner.connect(output);
    } else {
      tail.connect(output);
    }
    source.start();
    return source;
  }

  playBank(layer, bank, options = {}) {
    const stream = this.chooseStream(this.getBank(layer, bank), options);
    if (stream) return this.playBuffer(stream.buffer, options);
    this.preloadBank(layer, bank).catch(() => {});
    return null;
  }

  play(layer, contains, options = {}) {
    const map = this.layers[layer];
    if (!map) return null;
    for (const [name] of map) {
      if (name.includes(contains) || contains.includes(name)) return this.playBank(layer, name, options);
    }
    return null;
  }

  playWeaponShot(bank = 'lmg_combat', options = {}) {
    const match = this.findBank(bank);
    if (!match) {
      this.preloadWeapon(bank).catch(() => {});
      return null;
    }
    const stream = this.chooseStream(match.streams);
    if (!stream) {
      this.preloadBank(match.layer, match.bank).catch(() => {});
      return null;
    }
    return this.playBuffer(stream.buffer, {
      gain: .82,
      rate: .988 + Math.random() * .024,
      ...options
    });
  }

  playWeaponMechanical(bank, options = {}) {
    const match = this.findBank(bank);
    if (!match) {
      this.preloadWeapon(bank).catch(() => {});
      return null;
    }
    const stream = this.chooseStream(match.streams, { mechanical: true });
    if (!stream) {
      this.preloadBank(match.layer, match.bank).catch(() => {});
      return null;
    }
    return this.playBuffer(stream.buffer, {
      gain: .2,
      rate: .99 + Math.random() * .02,
      ...options
    });
  }

  playResident(bank, options = {}) {
    return this.playBank('resident', bank, { bus: 'master', ...options });
  }
}
