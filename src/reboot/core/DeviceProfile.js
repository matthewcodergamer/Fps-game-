export function detectDeviceProfile() {
  const ua = navigator.userAgent || '';
  const isiOS = /iPhone|iPad|iPod/i.test(ua);
  const iphone11Class = /iPhone12,[1358]/i.test(ua) || (isiOS && Math.min(screen.width, screen.height) <= 414);
  const memory = Number(navigator.deviceMemory || 0);
  const cores = navigator.hardwareConcurrency || 4;
  let tier = 'HIGH';
  if (iphone11Class || (memory && memory <= 4) || cores <= 4) tier = 'MOBILE';
  else if (isiOS || (memory && memory <= 6) || cores <= 6) tier = 'MEDIUM';

  const presets = {
    MOBILE: { hardwareScale: 1.45, shadows: 1024, shadowDistance: 42, particles: 0.45, maxDpr: 1.5 },
    MEDIUM: { hardwareScale: 1.2, shadows: 1536, shadowDistance: 58, particles: 0.7, maxDpr: 1.75 },
    HIGH: { hardwareScale: 1, shadows: 2048, shadowDistance: 80, particles: 1, maxDpr: 2 },
  };
  return { tier, isiOS, iphone11Class, memory, cores, ...presets[tier] };
}
