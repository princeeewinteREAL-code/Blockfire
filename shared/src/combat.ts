/**
 * Shooting rules shared by the game and the (future) server: how bullets fly, how accurate
 * each gun is, raycasts against the map and player hitboxes, and weapon ammo/reload state.
 */
import type { MapDef } from './map.js';
import { MOVEMENT } from './movement-config.js';
import { playerHeight, type PlayerState, type Vec3 } from './movement.js';
import type { WeaponDef } from './weapons.js';

export interface Ballistics {
  /** Hip-fire spread cone in degrees. */
  spreadHip: number;
  /** Spread while aiming down sights, in degrees. */
  spreadAds: number;
  /** Damage falloff: full damage up to `start` m, scaling to `min` × damage at `end` m. */
  falloff?: { start: number; end: number; min: number };
  /** Projectile weapons: muzzle speed (m/s) and gravity (m/s²). */
  speed?: number;
  gravity?: number;
  /** Direct-hit projectiles disappear on walls; explosive ones blow up. */
  explosive?: boolean;
  /** Sticky bombs stick and explode after this fuse (s). */
  fuse?: number;
  /** Explosion push in m/s at the centre. */
  knockback?: number;
  /** Max self-damage from your own explosions. */
  selfDamage?: number;
  /** Camera kick per shot in degrees (client feel only). */
  recoil: number;
  /** Delay between bullets in a burst (s). */
  burstGap?: number;
  /** Push the shooter backwards (m/s) — Sawed-Off escape blast. */
  selfPush?: number;
}

const B = (b: Ballistics) => b;

export const BALLISTICS: Record<string, Ballistics> = {
  assault_rifle: B({ spreadHip: 1.8, spreadAds: 0.5, falloff: { start: 30, end: 70, min: 0.7 }, recoil: 0.55 }),
  smg: B({ spreadHip: 2.4, spreadAds: 1.4, falloff: { start: 15, end: 35, min: 0.55 }, recoil: 0.4 }),
  machine_gun: B({ spreadHip: 2.8, spreadAds: 1.1, falloff: { start: 35, end: 80, min: 0.7 }, recoil: 0.5 }),
  sniper: B({ spreadHip: 7, spreadAds: 0, recoil: 4 }),
  speedy_sniper: B({ spreadHip: 6, spreadAds: 0.1, recoil: 3 }),
  revolver: B({ spreadHip: 1.2, spreadAds: 0.3, falloff: { start: 30, end: 60, min: 0.7 }, recoil: 2.5 }),
  bomber: B({ spreadHip: 1.2, spreadAds: 1.2, speed: 45, gravity: 8, explosive: true, knockback: 12, selfDamage: 15, recoil: 2 }),
  k2_bomber: B({ spreadHip: 0.8, spreadAds: 0.8, speed: 26, gravity: 6, explosive: true, knockback: 18, selfDamage: 30, recoil: 6 }),
  electronic_gun: B({ spreadHip: 2, spreadAds: 0.6, speed: 120, gravity: 0, recoil: 0.5 }),
  super_pistols: B({ spreadHip: 3, spreadAds: 3, falloff: { start: 15, end: 35, min: 0.6 }, recoil: 0.25 }),
  dual_heavy_mgs: B({ spreadHip: 2.6, spreadAds: 2.6, falloff: { start: 30, end: 60, min: 0.75 }, recoil: 0.45 }),
  pistol: B({ spreadHip: 1.3, spreadAds: 0.5, recoil: 1.2 }),
  auto_pistol: B({ spreadHip: 2.2, spreadAds: 1.2, recoil: 0.5 }),
  snake_pistol: B({ spreadHip: 1.3, spreadAds: 0.5, recoil: 1.2 }),
  snake_auto_pistol: B({ spreadHip: 2.2, spreadAds: 1.2, recoil: 0.5 }),
  firecrackers: B({ spreadHip: 2.5, spreadAds: 1.2, speed: 80, gravity: 2, recoil: 1 }),
  rocketeer: B({ spreadHip: 2, spreadAds: 1, speed: 40, gravity: 6, explosive: true, knockback: 8, selfDamage: 5, recoil: 1.2 }),
  auto_revolver: B({ spreadHip: 2.2, spreadAds: 0.5, recoil: 1.5, burstGap: 0.06 }),
  grapple_pistol: B({ spreadHip: 2.5, spreadAds: 2.5, recoil: 1 }),
  hand_cannon: B({ spreadHip: 3, spreadAds: 0.4, recoil: 5 }),
  flare_pistol: B({ spreadHip: 1.5, spreadAds: 1.5, speed: 50, gravity: 10, recoil: 1.5 }),
  sticky_bomb: B({ spreadHip: 1.5, spreadAds: 1.5, speed: 30, gravity: 14, explosive: true, fuse: 1.5, knockback: 10, selfDamage: 20, recoil: 1.5 }),
  sawed_off: B({ spreadHip: 7, spreadAds: 6, falloff: { start: 5, end: 15, min: 0.3 }, recoil: 4, selfPush: 6 }),
};

export function ballisticsOf(w: WeaponDef): Ballistics {
  return BALLISTICS[w.id] ?? { spreadHip: 0, spreadAds: 0, recoil: 0 };
}

// ---------------- Weapon state (ammo, reload, fire rate) ----------------

export interface WeaponState {
  id: string;
  ammo: number;
  reloadLeft: number;
  cooldown: number;
  burstLeft: number;
  burstTimer: number;
}

export function newWeaponState(w: WeaponDef): WeaponState {
  return { id: w.id, ammo: w.mag, reloadLeft: 0, cooldown: 0, burstLeft: 0, burstTimer: 0 };
}

/** Start reloading if it makes sense. Returns true if a reload began. */
export function startReload(w: WeaponDef, s: WeaponState): boolean {
  if (w.slot === 'melee' || s.reloadLeft > 0 || s.ammo >= w.mag) return false;
  s.reloadLeft = w.reloadSec;
  s.burstLeft = 0;
  return true;
}

/** Advance timers. Returns true on the tick a reload finishes. */
export function tickWeapon(w: WeaponDef, s: WeaponState, dt: number): boolean {
  s.cooldown = Math.max(0, s.cooldown - dt);
  s.burstTimer = Math.max(0, s.burstTimer - dt);
  if (s.reloadLeft > 0) {
    s.reloadLeft -= dt;
    if (s.reloadLeft <= 0) {
      s.reloadLeft = 0;
      s.ammo = w.mag;
      return true;
    }
  }
  return false;
}

// ---------------- Geometry helpers ----------------

export function aimDirection(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

/** Rotate a direction by a random angle inside a cone of `deg` degrees. */
export function spreadDirection(dir: Vec3, deg: number, rand: () => number): Vec3 {
  if (deg <= 0) return dir;
  const angle = (deg * Math.PI) / 180 * Math.sqrt(rand());
  const spin = rand() * Math.PI * 2;
  // Build two axes perpendicular to dir.
  const up = Math.abs(dir.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let ax = { x: dir.y * up.z - dir.z * up.y, y: dir.z * up.x - dir.x * up.z, z: dir.x * up.y - dir.y * up.x };
  const al = Math.hypot(ax.x, ax.y, ax.z);
  ax = { x: ax.x / al, y: ax.y / al, z: ax.z / al };
  const ay = { x: dir.y * ax.z - dir.z * ax.y, y: dir.z * ax.x - dir.x * ax.z, z: dir.x * ax.y - dir.y * ax.x };
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  const cx = Math.cos(spin) * s;
  const cy = Math.sin(spin) * s;
  return {
    x: dir.x * c + ax.x * cx + ay.x * cy,
    y: dir.y * c + ax.y * cx + ay.y * cy,
    z: dir.z * c + ax.z * cx + ay.z * cy,
  };
}

/** Ray vs axis-aligned box (slab method). Returns distance or Infinity. */
export function rayAabb(o: Vec3, d: Vec3, min: [number, number, number], max: [number, number, number], maxDist: number): number {
  let t0 = 0;
  let t1 = maxDist;
  const oa = [o.x, o.y, o.z];
  const da = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++) {
    const inv = 1 / (da[i] || 1e-12);
    let tn = (min[i]! - oa[i]!) * inv;
    let tf = (max[i]! - oa[i]!) * inv;
    if (tn > tf) { const tmp = tn; tn = tf; tf = tmp; }
    t0 = Math.max(t0, tn);
    t1 = Math.min(t1, tf);
    if (t0 > t1) return Infinity;
  }
  return t0;
}

/** Distance along a ray to the first solid block, or maxDist. */
export function rayMap(map: MapDef, o: Vec3, d: Vec3, maxDist: number): number {
  let best = maxDist;
  for (const b of map.boxes) {
    const t = rayAabb(o, d, b.min, b.max, best);
    if (t < best) best = t;
  }
  return best;
}

/** Clear line of sight between two points? */
export function lineOfSight(map: MapDef, a: Vec3, b: Vec3): boolean {
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const len = Math.hypot(d.x, d.y, d.z);
  if (len < 1e-6) return true;
  const n = { x: d.x / len, y: d.y / len, z: d.z / len };
  return rayMap(map, a, n, len) >= len - 0.05;
}

export function pointInMap(map: MapDef, p: Vec3): boolean {
  for (const b of map.boxes) {
    if (p.x > b.min[0] && p.x < b.max[0] && p.y > b.min[1] && p.y < b.max[1] && p.z > b.min[2] && p.z < b.max[2]) return true;
  }
  return false;
}

export const HEAD_SIZE = 0.45;

/** Head and body hitboxes for a player (head is a slightly narrower box on top). */
export function hitboxes(p: PlayerState): { head: { min: [number, number, number]; max: [number, number, number] }; body: { min: [number, number, number]; max: [number, number, number] } } {
  const h = playerHeight(p);
  const r = MOVEMENT.radius;
  const hr = 0.24;
  return {
    body: { min: [p.pos.x - r, p.pos.y, p.pos.z - r], max: [p.pos.x + r, p.pos.y + h - HEAD_SIZE, p.pos.z + r] },
    head: { min: [p.pos.x - hr, p.pos.y + h - HEAD_SIZE, p.pos.z - hr], max: [p.pos.x + hr, p.pos.y + h, p.pos.z + hr] },
  };
}

/** Damage after distance falloff. */
export function damageAt(w: WeaponDef, b: Ballistics, dist: number, head: boolean): number {
  const base = head ? w.damage.head : w.damage.body;
  const f = b.falloff;
  if (!f || dist <= f.start) return base;
  const t = Math.min(1, (dist - f.start) / (f.end - f.start));
  return base * (1 - t * (1 - f.min));
}

/** Small deterministic random generator (so a match can be replayed exactly). */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
