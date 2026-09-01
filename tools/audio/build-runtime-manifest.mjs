import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('public/game-assets/audio');
const output = path.join(root, 'audio-manifest.json');
const layers = new Set(['weapons_player', 'dlc_weapons', 'resident']);

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function wavInfo(file) {
  const handle = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(handle);
    const buffer = Buffer.alloc(Math.min(stat.size, 128 * 1024));
    fs.readSync(handle, buffer, 0, buffer.length, 0);
    if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
      throw new Error('invalid RIFF/WAVE header');
    }
    let offset = 12;
    let channels = 1;
    let sampleRate = 0;
    let bitsPerSample = 16;
    let dataBytes = 0;
    while (offset + 8 <= buffer.length) {
      const id = buffer.toString('ascii', offset, offset + 4);
      const size = buffer.readUInt32LE(offset + 4);
      const start = offset + 8;
      if (id === 'fmt ' && start + 16 <= buffer.length) {
        channels = buffer.readUInt16LE(start + 2);
        sampleRate = buffer.readUInt32LE(start + 4);
        bitsPerSample = buffer.readUInt16LE(start + 14);
      } else if (id === 'data') {
        dataBytes = size;
        break;
      }
      offset = start + size + (size % 2);
    }
    const bytesPerSample = Math.max(1, channels * bitsPerSample / 8);
    const samples = sampleRate ? Math.floor(dataBytes / bytesPerSample) : 0;
    return {
      channels,
      sampleRate,
      bitsPerSample,
      samples,
      duration: sampleRate ? samples / sampleRate : 0
    };
  } finally {
    fs.closeSync(handle);
  }
}

const files = [];
const bankMap = new Map();
for (const absolute of walk(root).filter(file => file.toLowerCase().endsWith('.wav')).sort()) {
  const relative = path.relative(root, absolute).replaceAll('\\', '/');
  const [layer, bank] = relative.split('/');
  if (!layers.has(layer) || !bank) {
    console.warn('Skipping WAV outside a runtime layer:', relative);
    continue;
  }
  const info = wavInfo(absolute);
  const name = path.basename(relative, '.wav');
  const id = name.match(/(0x[0-9a-f]+)$/i)?.[1] || name;
  const index = Number(name.match(/__(\d+)__/i)?.[1] || bankMap.get(`${layer}/${bank}`)?.length || 0);
  const stream = {
    layer,
    bank,
    source: `${layer}/${bank}`,
    path: `public/game-assets/audio/${relative}`,
    streamIndex: index,
    streamId: id,
    codec: 'pcm',
    sampleRate: info.sampleRate,
    channels: info.channels,
    samples: info.samples,
    duration: Number(info.duration.toFixed(6)),
    kind: info.duration < .12 ? 'short component' : 'audio clip'
  };
  files.push(stream);
  const key = `${layer}/${bank}`;
  if (!bankMap.has(key)) bankMap.set(key, []);
  bankMap.get(key).push(stream);
}

const banks = [...bankMap.entries()].map(([key, streams]) => {
  const [layer, id] = key.split('/');
  return {
    id,
    layer,
    source: key,
    streamCount: streams.length,
    totalDuration: Number(streams.reduce((sum, stream) => sum + stream.duration, 0).toFixed(3))
  };
}).sort((a, b) => `${a.layer}/${a.id}`.localeCompare(`${b.layer}/${b.id}`));

const manifest = {
  format: 'project-strike-runtime-audio-v4',
  generatedAt: new Date().toISOString(),
  totalFiles: files.length,
  totalBanks: banks.length,
  banks,
  files
};

fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Indexed ${files.length} WAV files across ${banks.length} banks.`);
for (const layer of layers) {
  console.log(layer, files.filter(file => file.layer === layer).length, 'files');
}
