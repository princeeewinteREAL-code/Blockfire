/**
 * Blocktown — a Burg-sized daytime town for Free For All (about 110 × 110 m).
 * Streets around a central plaza with a fountain, two-storey buildings you can walk into
 * (stairs up to the second floor, outside stairs to the roofs), a sniper tower on the west
 * edge, long halls north and south, market stalls and alleys full of cover.
 */
import type { Box, MapDef, Ramp, Vec3Tuple } from '../map.js';

const boxes: Box[] = [];
const ramps: Ramp[] = [];
const box = (min: Vec3Tuple, max: Vec3Tuple, color: string, material: Box['material'] = 'stone') => {
  boxes.push({ min, max, color, material });
};

const T = 0.4; // wall thickness
const FLOOR = 3.4; // storey height

interface Opening { at: number; width: number; bottom: number; top: number }
const door = (at: number): Opening => ({ at, width: 2, bottom: 0, top: 2.6 });
const win = (at: number, y = 0): Opening => ({ at, width: 1.6, bottom: y + 1.2, top: y + 2.4 });

/**
 * A wall along X (fixed z) or along Z (fixed x) from a to b, height h, with door/window
 * openings. Builds solid pieces between and around the openings.
 */
function wall(axis: 'x' | 'z', fixed: number, a: number, b: number, y0: number, h: number, color: string, openings: Opening[] = []): void {
  const piece = (s: number, e: number, bot: number, top: number) => {
    if (e - s < 0.05 || top - bot < 0.05) return;
    if (axis === 'x') box([s, y0 + bot, fixed - T / 2], [e, y0 + top, fixed + T / 2], color);
    else box([fixed - T / 2, y0 + bot, s], [fixed + T / 2, y0 + top, e], color);
  };
  const ops = [...openings].sort((p, q) => p.at - q.at);
  let cursor = a;
  for (const o of ops) {
    const s = o.at - o.width / 2;
    const e = o.at + o.width / 2;
    piece(cursor, s, 0, h);
    piece(s, e, 0, o.bottom);
    piece(s, e, o.top, h);
    cursor = e;
  }
  piece(cursor, b, 0, h);
}

interface BuildingSpec {
  x0: number; z0: number; x1: number; z1: number;
  color: string; roof: string;
  floors: 1 | 2;
  doors: { n?: number[]; s?: number[]; w?: number[]; e?: number[] };
  /** Outside stairs to the roof on this side. */
  roofStairs?: 'n' | 's' | 'w' | 'e';
}

/** A walk-in building: walls with doors and windows, an inside ramp to floor 2, a flat roof with a low wall. */
function building(b: BuildingSpec): void {
  const H = FLOOR * b.floors;
  const midX = (b.x0 + b.x1) / 2;
  const midZ = (b.z0 + b.z1) / 2;
  const wins = (a0: number, a1: number, skip: number[]): Opening[] => {
    const list: Opening[] = [];
    for (let at = a0 + 2.5; at < a1 - 2; at += 4) {
      if (skip.some((d) => Math.abs(d - at) < 2.2)) continue;
      list.push(win(at));
      if (b.floors === 2) list.push(win(at, FLOOR));
    }
    return list;
  };
  const doorsN = b.doors.n ?? [], doorsS = b.doors.s ?? [], doorsW = b.doors.w ?? [], doorsE = b.doors.e ?? [];
  // Upper-floor windows only where a door is below (keeps the lists simple and symmetric).
  const merge = (ds: number[], a0: number, a1: number) => [...ds.map(door), ...wins(a0, a1, ds)];
  wall('x', b.z0, b.x0, b.x1, 0, H, b.color, merge(doorsN, b.x0, b.x1));
  wall('x', b.z1, b.x0, b.x1, 0, H, b.color, merge(doorsS, b.x0, b.x1));
  wall('z', b.x0, b.z0 + T / 2, b.z1 - T / 2, 0, H, b.color, merge(doorsW, b.z0, b.z1));
  wall('z', b.x1, b.z0 + T / 2, b.z1 - T / 2, 0, H, b.color, merge(doorsE, b.z0, b.z1));
  // Wooden floor inside.
  box([b.x0 + T / 2, -0.05, b.z0 + T / 2], [b.x1 - T / 2, 0.02, b.z1 - T / 2], '#9a6a3f', 'wood');

  if (b.floors === 2) {
    // Second floor with a stairwell hole along the west wall; the stairs ramp runs north→south.
    const stairW = 2.2;
    const sx0 = b.x0 + T / 2, sx1 = sx0 + stairW;
    const stairLen = Math.min(9, b.z1 - b.z0 - 3);
    const sz1 = b.z1 - T / 2 - 0.2; // ramp top (south end)
    const sz0 = sz1 - stairLen;
    box([sx1, FLOOR - 0.3, b.z0 + T / 2], [b.x1 - T / 2, FLOOR, b.z1 - T / 2], '#9a6a3f', 'wood');
    box([sx0, FLOOR - 0.3, b.z0 + T / 2], [sx1, FLOOR, sz0], '#9a6a3f', 'wood');
    ramps.push({ x0: sx0, x1: sx1, z0: sz0, z1: sz1, low: 0, high: FLOOR, rise: '+z', color: '#7a5233' });
  }
  // Roof slab + parapet.
  box([b.x0 - 0.2, H, b.z0 - 0.2], [b.x1 + 0.2, H + 0.3, b.z1 + 0.2], b.roof);
  const P = 0.9;
  box([b.x0 - 0.2, H + 0.3, b.z0 - 0.2], [b.x1 + 0.2, H + P, b.z0 + 0.2], b.roof);
  box([b.x0 - 0.2, H + 0.3, b.z1 - 0.2], [b.x1 + 0.2, H + P, b.z1 + 0.2], b.roof);
  box([b.x0 - 0.2, H + 0.3, b.z0 + 0.2], [b.x0 + 0.2, H + P, b.z1 - 0.2], b.roof);
  box([b.x1 - 0.2, H + 0.3, b.z0 + 0.2], [b.x1 + 0.2, H + P, b.z1 - 0.2], b.roof);

  // Outside stairs up to the roof (a ramp against one wall, with a gap cut in the parapet).
  if (b.roofStairs) {
    const top = H + 0.3;
    const len = top * 2.2;
    const w = 2.4;
    switch (b.roofStairs) {
      case 'e': {
        const z1 = b.z1 - 0.5, z0 = z1 - len;
        ramps.push({ x0: b.x1 + 0.2, x1: b.x1 + 0.2 + w, z0, z1, low: 0, high: top, rise: '-z', color: '#8b8f98' });
        box([b.x1 + 0.2, top - 0.3, z0 - 2.2], [b.x1 + 0.2 + w, top, z0], '#8b8f98');
        void midZ;
        break;
      }
      case 'w': {
        const z0 = b.z0 + 0.5, z1 = z0 + len;
        ramps.push({ x0: b.x0 - 0.2 - w, x1: b.x0 - 0.2, z0, z1, low: 0, high: top, rise: '-z', color: '#8b8f98' });
        box([b.x0 - 0.2 - w, top - 0.3, z0 - 2.2], [b.x0 - 0.2, top, z0], '#8b8f98');
        break;
      }
      case 'n': {
        const x0 = b.x0 + 0.5, x1 = x0 + len;
        ramps.push({ x0, x1, z0: b.z0 - 0.2 - w, z1: b.z0 - 0.2, low: 0, high: top, rise: '-x', color: '#8b8f98' });
        box([x0 - 2.2, top - 0.3, b.z0 - 0.2 - w], [x0, top, b.z0 - 0.2], '#8b8f98');
        void midX;
        break;
      }
      case 's': {
        const x1 = b.x1 - 0.5, x0 = x1 - len;
        ramps.push({ x0, x1, z0: b.z1 + 0.2, z1: b.z1 + 0.2 + w, low: 0, high: top, rise: '+x', color: '#8b8f98' });
        box([x1, top - 0.3, b.z1 + 0.2], [x1 + 2.2, top, b.z1 + 0.2 + w], '#8b8f98');
        break;
      }
    }
  }
}

// ---------------- Ground, streets and outer walls ----------------
const S = 56; // half-size of the playable area
box([-S - 4, -1, -S - 4], [S + 4, 0, S + 4], '#6aa84f', 'grass');
// Cobblestone plaza and the two main streets.
box([-16, -0.98, -16], [16, 0.01, 16], '#a59e92');
box([-S, -0.98, -4], [S, 0.005, 4], '#8f8a80');
box([-4, -0.98, -S], [4, 0.005, S], '#8f8a80');
// Town walls.
const WALL = '#b9ad98';
box([-S - 1, 0, -S - 1], [S + 1, 7, -S], WALL);
box([-S - 1, 0, S], [S + 1, 7, S + 1], WALL);
box([-S - 1, 0, -S], [-S, 7, S], WALL);
box([S, 0, -S], [S + 1, 7, S], WALL);
for (let i = -S; i < S; i += 4) {
  box([i, 7, -S - 1], [i + 2, 8, -S], WALL);
  box([i, 7, S], [i + 2, 8, S + 1], WALL);
  box([-S - 1, 7, i], [-S, 8, i + 2], WALL);
  box([S, 7, i], [S + 1, 8, i + 2], WALL);
}

// ---------------- Plaza: fountain + benches ----------------
box([-4, 0, -4], [4, 0.9, -3.4], '#c8c2b5');
box([-4, 0, 3.4], [4, 0.9, 4], '#c8c2b5');
box([-4, 0, -3.4], [-3.4, 0.9, 3.4], '#c8c2b5');
box([3.4, 0, -3.4], [4, 0.9, 3.4], '#c8c2b5');
box([-3.4, 0, -3.4], [3.4, 0.5, 3.4], '#4fa3d9', 'ice');
box([-0.8, 0, -0.8], [0.8, 3.2, 0.8], '#c8c2b5');
box([-1.4, 3.2, -1.4], [1.4, 3.5, 1.4], '#c8c2b5');
for (const [x, z] of [[-10, -10], [10, -10], [-10, 10], [10, 10]] as const) {
  box([x - 1.5, 0, z - 0.4], [x + 1.5, 0.5, z + 0.4], '#8a5a33', 'wood');
}

// ---------------- Buildings ----------------
building({ x0: -44, z0: -44, x1: -24, z1: -28, color: '#d9c7a3', roof: '#8c3b2e', floors: 2, doors: { s: [-34], e: [-36] }, roofStairs: 'w' });
building({ x0: 24, z0: -44, x1: 44, z1: -28, color: '#c7d1d9', roof: '#3b4f8c', floors: 2, doors: { s: [34], w: [-36] }, roofStairs: 'e' });
building({ x0: -44, z0: 28, x1: -24, z1: 44, color: '#e0d2b4', roof: '#4f7a3b', floors: 2, doors: { n: [-34], e: [36] }, roofStairs: 'w' });
building({ x0: 24, z0: 28, x1: 44, z1: 44, color: '#d9b8a3', roof: '#7a3b6a', floors: 2, doors: { n: [34], w: [36] }, roofStairs: 'e' });
// Long halls north and south (one tall floor, doors on both long sides).
building({ x0: -14, z0: -52, x1: 14, z1: -40, color: '#cdbfa6', roof: '#6b4a32', floors: 1, doors: { s: [-8, 8], n: [0] } });
building({ x0: -14, z0: 40, x1: 14, z1: 52, color: '#cdbfa6', roof: '#6b4a32', floors: 1, doors: { n: [-8, 8], s: [0] } });
// Small houses east and west of the plaza.
building({ x0: 22, z0: -14, x1: 32, z1: -6, color: '#e6d9bf', roof: '#8c3b2e', floors: 1, doors: { w: [-10], e: [-10] } });
building({ x0: 22, z0: 6, x1: 32, z1: 14, color: '#e6d9bf', roof: '#3b4f8c', floors: 1, doors: { w: [10], e: [10] }, roofStairs: 's' });

// ---------------- Sniper tower (west) ----------------
box([-52, 0, -4], [-44, 9, 4], '#9a9488');
box([-52.2, 9, -4.2], [-43.8, 9.3, 4.2], '#6b6458');
box([-52.2, 9.3, -4.2], [-43.8, 10.3, -3.8], '#6b6458');
box([-52.2, 9.3, 3.8], [-43.8, 10.3, 4.2], '#6b6458');
box([-52.2, 9.3, -3.8], [-51.8, 10.3, 3.8], '#6b6458');
box([-44.2, 9.3, -3.8], [-43.8, 10.3, -1], '#6b6458');
box([-44.2, 9.3, 1], [-43.8, 10.3, 3.8], '#6b6458');
ramps.push({ x0: -50, x1: -46.5, z0: 4, z1: 22, low: 0, high: 9, rise: '-z', color: '#8b8f98' });
// East: a lower lookout across from the tower.
box([46, 0, -4], [52, 5, 4], '#9a9488');
ramps.push({ x0: 47, x1: 50.5, z0: -18, z1: -4, low: 0, high: 5, rise: '+z', color: '#8b8f98' });

// ---------------- Market stalls, carts and crates ----------------
const stall = (x: number, z: number, color: string) => {
  box([x - 2, 0, z - 1], [x + 2, 1, z + 1], '#8a5a33', 'wood');
  box([x - 2, 1, z - 1], [x - 1.8, 2.6, z - 0.8], '#6b4a32', 'wood');
  box([x + 1.8, 1, z - 1], [x + 2, 2.6, z - 0.8], '#6b4a32', 'wood');
  box([x - 2.2, 2.6, z - 1.3], [x + 2.2, 2.8, z + 1.3], color, 'wood');
};
stall(-12, -20, '#d94f3d'); stall(12, 20, '#3d8bd9'); stall(-20, 12, '#e0b93a'); stall(20, -20, '#4fb36a');
const crates: Array<[number, number, number]> = [
  [-20, -6, 1.2], [18, 6, 1.2], [-6, 22, 1.2], [6, -22, 1.2], [-30, -18, 1.4], [30, 18, 1.4], [-30, 18, 1.4], [30, -18, 1.4],
  [-48, -24, 1.2], [48, 24, 1.2], [-16, -32, 1.2], [16, 32, 1.2], [0, -30, 1.4], [0, 30, 1.4], [-38, 8, 1.2], [38, -8, 1.2],
];
for (const [x, z, s] of crates) box([x - s / 2, 0, z - s / 2], [x + s / 2, s, z + s / 2], '#b37b46', 'wood');
// Stacked crates you can hop up.
box([-20.6, 1.2, -6.6], [-19.4, 2.4, -5.4], '#b37b46', 'wood');
box([17.4, 1.2, 5.4], [18.6, 2.4, 6.6], '#b37b46', 'wood');
// Low walls along the streets (slide behind them).
for (const [x0, z0, x1, z1] of [[-36, -10, -20, -9.4], [20, 9.4, 36, 10], [-36, 9.4, -24, 10], [24, -10, 36, -9.4]] as const) {
  box([x0, 0, z0], [x1, 1.1, z1], '#a59e92');
}
// Trees: trunk + leafy block crown.
for (const [x, z] of [[-48, 46], [48, -46], [-20, 48], [20, -48], [-48, -14], [48, 14]] as const) {
  box([x - 0.4, 0, z - 0.4], [x + 0.4, 3, z + 0.4], '#6b4a32', 'wood');
  box([x - 1.8, 3, z - 1.8], [x + 1.8, 6, z + 1.8], '#3f8f3a', 'grass');
}

// ---------------- Spawns ----------------
const spots: Array<[number, number]> = [
  [0, 36], [0, -36], [36, 0], [-36, 0], [-50, 30], [50, -30], [-50, -40], [50, 40], [-18, 50], [18, -50],
  [-26, 20], [26, -20], [14, 26], [-14, -26], [40, 20], [-40, -20],
];
const spawns = spots.map(([x, z]) => ({ pos: [x, 0, z] as Vec3Tuple, yaw: Math.atan2(x, z) }));

export const BLOCKTOWN: MapDef = {
  id: 'blocktown',
  name: 'Blocktown',
  spawn: spawns[0]!,
  spawns,
  boxes,
  ramps,
  zones: [],
  lighting: 'day',
  sky: { top: '#2f74d8', bottom: '#cde2f6', fog: '#cde2f6' },
};
