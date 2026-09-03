export const WEAPON_SOCKETS = Object.freeze(['grip_right','grip_left','muzzle','optic_mount','eject','magazine','charging_handle','shell_eject']);

export function validateWeaponContract(weapon) {
  const missing = WEAPON_SOCKETS.filter(name => !weapon?.sockets?.[name]);
  if (!weapon?.root) missing.unshift('weaponRoot');
  if (missing.length) throw new Error(`Weapon asset contract failed. Missing: ${missing.join(', ')}`);
  return true;
}
