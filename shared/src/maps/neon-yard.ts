/**
 * Neon Yard — a small night-time shipping yard for Free For All.
 * Stacked containers to climb and slide between, a raised centre platform with two ramps,
 * and catwalks along both long walls.
 */
import type { Box, MapDef, Ramp, Vec3Tuple } from '../map.js';

const box = (min: Vec3Tuple, max: Vec3Tuple, color: string, material: Box['material'] = 'metal'): Box => ({ min, max, color, material });

const boxes: Box[] = [];
const ramps: Ramp[] = [];

const H = 2.6; // container height
const RED = '#b8402c', BLUE = '#2a5bb8', YELLOW = '#c99a1e', GREEN = '#2a8f55', ORANGE = '#d1622a';
const NEON_PINK = '#ff3fb4', NEON_CYAN = '#2ee6ff', NEON_LIME = '#9dff3f';

// Floor and walls.
boxes.push(box([-34, -1, -34], [34, 0, 34], '#2a2e38', 'stone'));
boxes.push(box([-33, 0, -33], [33, 6, -32], '#3a3f4c', 'stone'));
boxes.push(box([-33, 0, 32], [33, 6, 33], '#3a3f4c', 'stone'));
boxes.push(box([-33, 0, -32], [-32, 6, 32], '#3a3f4c', 'stone'));
boxes.push(box([32, 0, -32], [33, 6, 32], '#3a3f4c', 'stone'));
// Neon trim along the top of the walls.
boxes.push(box([-32, 5.6, -32.2], [32, 5.9, -31.9], NEON_PINK, 'neon'));
boxes.push(box([-32, 5.6, 31.9], [32, 5.9, 32.2], NEON_CYAN, 'neon'));
boxes.push(box([-32.2, 5.6, -32], [-31.9, 5.9, 32], NEON_LIME, 'neon'));
boxes.push(box([31.9, 5.6, -32], [32.2, 5.9, 32], NEON_PINK, 'neon'));

// Centre platform with ramps north and south.
boxes.push(box([-4, 0, -4], [4, 3.5, 4], '#454b5a', 'metal'));
// Neon edge strips around the platform (on the sides, below the walking surface).
boxes.push(box([-4.12, 3.2, -4.12], [4.12, 3.42, -4], NEON_CYAN, 'neon'));
boxes.push(box([-4.12, 3.2, 4], [4.12, 3.42, 4.12], NEON_CYAN, 'neon'));
boxes.push(box([-4.12, 3.2, -4], [-4, 3.42, 4], NEON_CYAN, 'neon'));
boxes.push(box([4, 3.2, -4], [4.12, 3.42, 4], NEON_CYAN, 'neon'));
ramps.push({ x0: -2, x1: 2, z0: 4, z1: 12, low: 0, high: 3.5, rise: '-z', color: '#5a6070' });
ramps.push({ x0: -2, x1: 2, z0: -12, z1: -4, low: 0, high: 3.5, rise: '+z', color: '#5a6070' });
// Low cover walls on the platform.
boxes.push(box([-4, 3.5, -0.4], [-1.5, 4.5, 0.4], '#5a6070', 'metal'));
boxes.push(box([1.5, 3.5, -0.4], [4, 4.5, 0.4], '#5a6070', 'metal'));

// Containers: [x0, z0, x1, z1, colour, stacked?]
const containers: Array<[number, number, number, number, string, boolean]> = [
  [-20, -24, -14, -21.4, RED, true],
  [14, 21.4, 20, 24, BLUE, true],
  [-26, -6, -23.4, 0, YELLOW, false],
  [23.4, 0, 26, 6, GREEN, false],
  [8, -14, 14, -11.4, BLUE, false],
  [-14, 11.4, -8, 14, RED, false],
  [-12, -18, -9.4, -12, GREEN, false],
  [9.4, 12, 12, 18, YELLOW, false],
  [-22, 14, -16, 16.6, ORANGE, true],
  [16, -16.6, 22, -14, ORANGE, true],
];
for (const [x0, z0, x1, z1, c, stacked] of containers) {
  boxes.push(box([x0, 0, z0], [x1, H, z1], c, 'metal'));
  if (stacked) {
    // A second container on top, shifted so you can climb up in two hops.
    const longX = x1 - x0 > z1 - z0;
    const sx = longX ? 2 : 0, sz = longX ? 0 : 2;
    boxes.push(box([x0 + sx, H, z0 + sz], [x1 + sx, H * 2, z1 + sz], c === RED ? BLUE : RED, 'metal'));
  }
}

// Crates for cover.
const crates: Array<[number, number]> = [[-6, 18], [6, -18], [18, 4], [-18, -4], [-2, 22], [2, -22], [24, -24], [-24, 24], [10, 2], [-10, -2]];
for (const [x, z] of crates) boxes.push(box([x - 0.7, 0, z - 0.7], [x + 0.7, 1.4, z + 0.7], '#8a5a33', 'wood'));

// Catwalks along the west and east walls, with ramps up at the ends.
boxes.push(box([-31.8, 4.1, -20], [-28, 4.5, 20], '#4a505e', 'metal'));
boxes.push(box([28, 4.1, -20], [31.8, 4.5, 20], '#4a505e', 'metal'));
for (const z of [-18, -6, 6, 18]) {
  boxes.push(box([-29, 0, z - 0.3], [-28.4, 4.1, z + 0.3], '#2b2f39', 'metal'));
  boxes.push(box([28.4, 0, z - 0.3], [29, 4.1, z + 0.3], '#2b2f39', 'metal'));
}
boxes.push(box([-28.05, 4.5, -20], [-27.95, 5.4, 20], NEON_LIME, 'neon'));
boxes.push(box([27.95, 4.5, -20], [28.05, 5.4, 20], NEON_PINK, 'neon'));
ramps.push({ x0: -31.8, x1: -28, z0: 20, z1: 30, low: 0, high: 4.5, rise: '-z', color: '#5a6070' });
ramps.push({ x0: 28, x1: 31.8, z0: -30, z1: -20, low: 0, high: 4.5, rise: '+z', color: '#5a6070' });

// Light poles with glowing heads.
const poles: Array<[number, number, string]> = [[-14, 0, NEON_CYAN], [14, 0, NEON_PINK], [0, -26, NEON_LIME], [0, 26, NEON_CYAN]];
for (const [x, z, c] of poles) {
  boxes.push(box([x - 0.2, 0, z - 0.2], [x + 0.2, 7, z + 0.2], '#22262f', 'metal'));
  boxes.push(box([x - 0.6, 7, z - 0.6], [x + 0.6, 7.4, z + 0.6], c, 'neon'));
}

// Spawn points around the edge, each facing the middle.
const spawnSpots: Array<[number, number]> = [
  [0, 28], [0, -28], [-20, 28], [20, -28], [26, 20], [-26, -20], [-27, 8], [27, -8], [20, 28], [-20, -28], [12, -6], [-12, 6],
];
const spawns = spawnSpots.map(([x, z]) => ({ pos: [x, 0, z] as Vec3Tuple, yaw: Math.atan2(x, z) }));

export const NEON_YARD: MapDef = {
  id: 'neon-yard',
  name: 'Neon Yard',
  spawn: spawns[0]!,
  spawns,
  boxes,
  ramps,
  zones: [],
  lighting: 'night',
  sky: { top: '#04061a', bottom: '#2a1450', fog: '#1a1032' },
};
