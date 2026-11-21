/**
 * "Training Grounds" — the Phase 1 movement sandbox.
 *
 * Layout (looking down, north = -Z):
 *  - East yard: a slide tower with a long ramp, a staircase, a wall-jump chimney,
 *    a ledge-climb ladder and some cover crates.
 *  - West pit: a timed parkour course over a deadly drop, with 2 checkpoints.
 */
import type { Box, MapDef, Ramp, Zone, Vec3Tuple } from '../map.js';

const C = {
  grass: '#62b04f',
  rim: '#4f9a40',
  stone: '#8b919b',
  wall: '#a7adb6',
  wood: '#b37b46',
  crate: '#c98b4a',
  neon: '#ff4fa3',
  metal: '#6f7f90',
  course: '#f2c14e',
  check: '#43c9db',
  finish: '#7c5cff',
  ramp: '#e8773a',
};

function box(min: Vec3Tuple, max: Vec3Tuple, color: string, material: Box['material'] = 'stone'): Box {
  return { min, max, color, material };
}

/** A platform whose TOP is at `top`, 2 m thick. */
function platform(x0: number, x1: number, z0: number, z1: number, top: number, color: string, material: Box['material'] = 'wood'): Box {
  return box([x0, top - 2, z0], [x1, top, z1], color, material);
}

const boxes: Box[] = [];
const ramps: Ramp[] = [];
const zones: Zone[] = [];

// ---------- Ground (with a pit in the west for the parkour course) ----------
boxes.push(box([-60, -1, 20], [60, 0, 60], C.grass, 'grass'));     // south strip
boxes.push(box([-15, -1, -60], [60, 0, 20], C.grass, 'grass'));    // east yard
boxes.push(box([-60, -1, -60], [-55, 0, 20], C.rim, 'grass'));     // west rim
boxes.push(box([-55, -1, -60], [-15, 0, -55], C.rim, 'grass'));    // north rim

// ---------- Outer walls ----------
boxes.push(box([-61, 0, -61], [61, 6, -60], C.wall));
boxes.push(box([-61, 0, 60], [61, 6, 61], C.wall));
boxes.push(box([-61, 0, -60], [-60, 6, 60], C.wall));
boxes.push(box([60, 0, -60], [61, 6, 60], C.wall));

// ---------- East yard: slide tower + ramp + stairs ----------
boxes.push(box([10, 0, -40], [16, 6, -34], C.stone));
ramps.push({ x0: 10, x1: 16, z0: -34, z1: -10, low: 0, high: 6, rise: '-z', color: C.ramp });
for (let i = 0; i < 14; i++) {
  const top = 6 - 0.4 * (i + 1);
  boxes.push(box([16 + 0.6 * i, 0, -40], [16 + 0.6 * (i + 1), top, -34], C.stone));
}

// Wall-jump chimney (two tall walls 3 m apart) with a reward ledge on top.
boxes.push(box([30, 0, -45], [31, 10, -25], C.neon, 'neon'));
boxes.push(box([34, 0, -45], [35, 10, -25], C.neon, 'neon'));
boxes.push(box([31, 9, -45], [34, 10, -41], C.neon, 'neon'));

// Ledge-climb ladder: 0.4, 0.8, 1.2, 1.6, 1.8 m blocks.
[0.4, 0.8, 1.2, 1.6, 1.8].forEach((h, i) => {
  boxes.push(box([42, 0, -8 + i * 3], [46, h, -5 + i * 3], C.wood, 'wood'));
});

// Second ramp pair: a jump ramp ("kicker") that launches you over a wall.
ramps.push({ x0: 40, x1: 46, z0: 16, z1: 26, low: 0, high: 2.2, rise: '-z', color: C.ramp });
boxes.push(box([40, 0, 10], [46, 2.2, 16], C.stone));
boxes.push(box([38, 0, 0], [48, 3, 1], C.wall));

// Cover crates.
const crates: Array<[number, number]> = [[0, 0], [4, -6], [-6, -12], [6, 12], [-4, 6], [20, 4], [24, 10], [-8, -30]];
for (const [x, z] of crates) boxes.push(box([x, 0, z], [x + 1.5, 1.5, z + 1.5], C.crate, 'wood'));
boxes.push(box([0, 1.5, 0], [1.5, 3, 1.5], C.crate, 'wood'));

// Low wall to practise slide-under? (1.3 m gap under a beam: slide or crouch through)
boxes.push(box([-10, 1.3, 30], [10, 3.5, 31], C.metal, 'metal'));
boxes.push(box([-11, 0, 30], [-10, 3.5, 31], C.metal, 'metal'));
boxes.push(box([10, 0, 30], [11, 3.5, 31], C.metal, 'metal'));

// ---------- West pit: parkour course ----------
// Start pad sits on the south strip; the course runs north over the pit.
zones.push({ id: 'start', kind: 'start', min: [-40, 0, 20], max: [-30, 3, 24] });

boxes.push(platform(-38, -32, 12, 17, 0, C.course));                 // 1: easy 3 m gap
boxes.push(platform(-37, -33, 4, 9, 0.8, C.course));                  // 2: up a little, 3 m gap
boxes.push(platform(-36, -34, -2, 1.5, 1.5, C.course));               // 3: narrow beam
// 4: ledge climb (1.5 m up) onto a long run-up platform
boxes.push(platform(-38, -32, -18, -5, 3.0, C.check));
zones.push({ id: 'cp1', kind: 'checkpoint', min: [-38, 3, -10], max: [-32, 6, -6], respawn: { pos: [-35, 3, -8], yaw: 0 } });
// 5: long 4.5 m gap — needs a slide-hop (slide, then jump straight away)
boxes.push(platform(-37, -33, -28, -22.5, 3.0, C.course));
zones.push({ id: 'cp2', kind: 'checkpoint', min: [-37, 3, -28], max: [-33, 6, -22.5], respawn: { pos: [-35, 3, -25.5], yaw: 0 } });
// 6: 1 m wide balance beam
boxes.push(platform(-35.5, -34.5, -38, -28, 3.0, C.course, 'metal'));
// 7: finish platform
boxes.push(platform(-40, -30, -54, -41, 3.0, C.finish, 'neon'));
zones.push({ id: 'finish', kind: 'finish', min: [-40, 3, -54], max: [-30, 6, -44] });

export const TEST_MAP: MapDef = {
  id: 'training-grounds',
  name: 'Training Grounds',
  spawn: { pos: [-35, 0, 30], yaw: 0 },
  boxes,
  ramps,
  zones,
  sky: { top: '#5aa0ff', bottom: '#cfe6ff', fog: '#cfe6ff' },
};
