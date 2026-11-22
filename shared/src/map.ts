/**
 * Map format. Maps are plain data (boxes, ramps and zones), so they can be saved as JSON,
 * made in a map editor later, and loaded by both the client and the server.
 */
export type Vec3Tuple = [number, number, number];

/** A solid axis-aligned block. */
export interface Box {
  min: Vec3Tuple;
  max: Vec3Tuple;
  /** Colour as a hex string, e.g. "#4a90d9". */
  color: string;
  /** Optional material hint for textures and footstep sounds. */
  material?: 'stone' | 'metal' | 'wood' | 'grass' | 'ice' | 'neon';
}

/** Which way a ramp goes UP. */
export type RampRise = '+x' | '-x' | '+z' | '-z';

/** A sloped surface over a rectangle. You walk on its top surface. */
export interface Ramp {
  /** Rectangle corners on the ground plane (x0 < x1, z0 < z1). */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Surface height at the low end and the high end. */
  low: number;
  high: number;
  rise: RampRise;
  color: string;
}

export type ZoneKind = 'start' | 'finish' | 'checkpoint';

/** An invisible trigger box (parkour start, finish, checkpoints). */
export interface Zone {
  id: string;
  kind: ZoneKind;
  min: Vec3Tuple;
  max: Vec3Tuple;
  /** Where you respawn after passing this checkpoint. */
  respawn?: { pos: Vec3Tuple; yaw: number };
}

export interface MapDef {
  id: string;
  name: string;
  spawn: { pos: Vec3Tuple; yaw: number };
  boxes: Box[];
  ramps: Ramp[];
  zones: Zone[];
  /** Sky and fog colours. */
  sky: { top: string; bottom: string; fog: string };
  /** Spawn points for combat modes (players spawn at the one farthest from enemies). */
  spawns?: Array<{ pos: Vec3Tuple; yaw: number }>;
  /** Lighting mood. */
  lighting?: 'day' | 'night';
  /** A pool of lava: touching it sends you back to your checkpoint. */
  lava?: { y: number; x0: number; x1: number; z0: number; z1: number };
}

/** Is this feet position touching the map's lava? */
export function inLava(map: MapDef, x: number, y: number, z: number): boolean {
  const l = map.lava;
  return !!l && y <= l.y + 0.1 && x >= l.x0 && x <= l.x1 && z >= l.z0 && z <= l.z1;
}

/** Height of a ramp's surface at (x, z), or null if (x, z) is outside it. */
export function rampHeightAt(r: Ramp, x: number, z: number): number | null {
  if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) return null;
  let t: number;
  switch (r.rise) {
    case '+x': t = (x - r.x0) / (r.x1 - r.x0); break;
    case '-x': t = (r.x1 - x) / (r.x1 - r.x0); break;
    case '+z': t = (z - r.z0) / (r.z1 - r.z0); break;
    case '-z': t = (r.z1 - z) / (r.z1 - r.z0); break;
  }
  return r.low + (r.high - r.low) * t;
}

/** Unit vector (x, z) pointing DOWN the ramp, and the slope's sine. */
export function rampDownhill(r: Ramp): { x: number; z: number; sin: number } {
  const length = r.rise === '+x' || r.rise === '-x' ? r.x1 - r.x0 : r.z1 - r.z0;
  const rise = r.high - r.low;
  const sin = rise / Math.hypot(rise, length);
  switch (r.rise) {
    case '+x': return { x: -1, z: 0, sin };
    case '-x': return { x: 1, z: 0, sin };
    case '+z': return { x: 0, z: -1, sin };
    case '-z': return { x: 0, z: 1, sin };
  }
}

export function pointInZone(z: Zone, x: number, y: number, zz: number): boolean {
  return x >= z.min[0] && x <= z.max[0] && y >= z.min[1] && y <= z.max[1] && zz >= z.min[2] && zz <= z.max[2];
}
