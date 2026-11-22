/**
 * Bot players. A bot looks at the match like a player would (who can I see, where are they)
 * and produces the same inputs a person would: keys, mouse aim, fire.
 */
import { lineOfSight, makeRng } from './combat.js';
import { idleInput, type Fighter, type FighterInput, type Match } from './match.js';
import { horizontalSpeed, type Vec3 } from './movement.js';
import { WEAPON_BY_ID, weaponsInSlot } from './weapons.js';

export type BotDifficulty = 'easy' | 'normal' | 'hard' | 'insane';

interface Skill {
  /** How fast the bot can turn, in radians per second. */
  turn: number;
  /** Typical aim error in radians. */
  error: number;
  /** Time to react after spotting someone, in seconds. */
  reaction: number;
  strafe: boolean;
  slide: boolean;
  hop: boolean;
  headshots: number;
  /** Bots fire in bursts of this many seconds… */
  burst: number;
  /** …then pause this long (lower levels pause longer). */
  rest: number;
}

export const BOT_SKILL: Record<BotDifficulty, Skill> = {
  easy: { turn: 1.5, error: 0.17, reaction: 1.0, strafe: false, slide: false, hop: false, headshots: 0, burst: 0.5, rest: 0.9 },
  normal: { turn: 2.6, error: 0.1, reaction: 0.65, strafe: true, slide: false, hop: false, headshots: 0.05, burst: 0.8, rest: 0.6 },
  hard: { turn: 5, error: 0.05, reaction: 0.32, strafe: true, slide: true, hop: true, headshots: 0.25, burst: 1.4, rest: 0.3 },
  insane: { turn: 10, error: 0.02, reaction: 0.15, strafe: true, slide: true, hop: true, headshots: 0.5, burst: 9, rest: 0 },
};

export interface BotBrain {
  difficulty: BotDifficulty;
  target: number | null;
  seenFor: number;
  strafeDir: number;
  strafeTimer: number;
  wander: Vec3 | null;
  stuckTimer: number;
  lastPos: Vec3;
  noiseT: number;
  aimHead: boolean;
  /** Burst rhythm: positive = firing time left, negative = resting time left. */
  burstClock: number;
  rand: () => number;
  yaw: number;
  pitch: number;
}

export function createBrain(difficulty: BotDifficulty, seed: number): BotBrain {
  return {
    difficulty, target: null, seenFor: 0, strafeDir: 1, strafeTimer: 0, wander: null, stuckTimer: 0,
    lastPos: { x: 0, y: 0, z: 0 }, noiseT: seed, aimHead: false, burstClock: 0, rand: makeRng(seed * 7919 + 13), yaw: 0, pitch: 0,
  };
}

const BOT_NAMES = [
  'Sir Slides-a-Lot', 'Bunny McHop', 'Noodle', 'Captain Toast', 'Pixel Pete', 'Wobbles', 'Sgt. Pancake',
  'Crate Expectations', 'Lag Monster', 'Ctrl Alt Defeat', 'Blocky Balboa', 'Nugget', 'Snaccident', 'Yeetus',
];

export function botName(i: number): string {
  return `[BOT] ${BOT_NAMES[i % BOT_NAMES.length]}`;
}

/** A random loadout for a bot. Bots skip the K2 (too frustrating to play against). */
export function botLoadout(rand: () => number): { primary: string; secondary: string; melee: string } {
  const prim = weaponsInSlot('primary').filter((w) => w.id !== 'k2_bomber');
  const sec = weaponsInSlot('secondary').filter((w) => w.id !== 'sticky_bomb');
  const mel = weaponsInSlot('melee');
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)]!;
  return { primary: pick(prim).id, secondary: pick(sec).id, melee: pick(mel).id };
}

/** Preferred fighting distance by weapon role. */
function idealRange(weaponId: string): number {
  const w = WEAPON_BY_ID[weaponId]!;
  if (w.slot === 'melee') return 1.2;
  if (w.id === 'sniper' || w.id === 'speedy_sniper') return 28;
  if (w.id === 'smg' || w.id === 'super_pistols' || w.id === 'dual_heavy_mgs' || w.id === 'sawed_off') return 7;
  if (w.id === 'bomber' || w.id === 'k2_bomber') return 14;
  return 15;
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Decide this tick's inputs for a bot. */
export function botThink(match: Match, f: Fighter, brain: BotBrain, dt: number): FighterInput {
  const input = idleInput();
  if (!f.alive) { brain.target = null; brain.seenFor = 0; return input; }
  const skill = BOT_SKILL[brain.difficulty];
  const eye = match.eye(f);
  const r = brain.rand;

  // 1. Find the closest enemy we can actually see.
  let target: Fighter | null = null;
  let bestD = 70;
  for (const o of match.fighters) {
    if (o === f || !o.alive) continue;
    const d = Math.hypot(o.p.pos.x - f.p.pos.x, o.p.pos.y - f.p.pos.y, o.p.pos.z - f.p.pos.z);
    if (d >= bestD) continue;
    const chest = { x: o.p.pos.x, y: o.p.pos.y + 1.2, z: o.p.pos.z };
    if (!lineOfSight(match.map, eye, chest)) continue;
    target = o;
    bestD = d;
  }
  if (target?.id !== brain.target) {
    brain.target = target?.id ?? null;
    brain.seenFor = 0;
    brain.aimHead = r() < skill.headshots;
  }
  brain.seenFor += dt;

  // 2. Aim: turn toward the target (or where we're walking) at limited speed, with wobble.
  brain.noiseT += dt;
  let wantYaw = brain.yaw;
  let wantPitch = 0;
  if (target) {
    const aimY = target.p.pos.y + (brain.aimHead ? 1.6 : 1.1);
    // Lead moving targets a little (better bots lead better).
    const lead = skill.turn > 5 ? 0.08 : 0;
    const tx = target.p.pos.x + target.p.vel.x * lead;
    const tz = target.p.pos.z + target.p.vel.z * lead;
    const dx = tx - eye.x, dy = aimY - eye.y, dz = tz - eye.z;
    wantYaw = Math.atan2(-dx, -dz);
    wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
    const wobble = skill.error * (1 + horizontalSpeed(target.p) / 8);
    wantYaw += Math.sin(brain.noiseT * 2.3) * wobble;
    wantPitch += Math.cos(brain.noiseT * 1.9) * wobble * 0.6;
  } else {
    if (!brain.wander || Math.hypot(brain.wander.x - f.p.pos.x, brain.wander.z - f.p.pos.z) < 3) {
      // Head toward a random living enemy's area, or a random spawn.
      const others = match.fighters.filter((o) => o !== f && o.alive);
      const spawns = match.map.spawns ?? [match.map.spawn];
      if (others.length && r() < 0.6) {
        const o = others[Math.floor(r() * others.length)]!;
        brain.wander = { x: o.p.pos.x + (r() - 0.5) * 8, y: 0, z: o.p.pos.z + (r() - 0.5) * 8 };
      } else {
        const s = spawns[Math.floor(r() * spawns.length)]!;
        brain.wander = { x: s.pos[0], y: s.pos[1], z: s.pos[2] };
      }
    }
    wantYaw = Math.atan2(-(brain.wander.x - f.p.pos.x), -(brain.wander.z - f.p.pos.z));
  }
  const maxTurn = skill.turn * dt;
  brain.yaw += Math.max(-maxTurn, Math.min(maxTurn, angleDiff(wantYaw, brain.yaw)));
  brain.pitch += Math.max(-maxTurn, Math.min(maxTurn, wantPitch - brain.pitch));
  input.yaw = brain.yaw;
  input.pitch = brain.pitch;

  // 3. Move.
  const w = match.weaponOf(f);
  if (target) {
    const range = idealRange(w.id);
    input.forward = bestD > range * 1.3 ? 1 : bestD < range * 0.6 ? -1 : 0;
    if (skill.strafe) {
      brain.strafeTimer -= dt;
      if (brain.strafeTimer <= 0) { brain.strafeDir = r() < 0.5 ? -1 : 1; brain.strafeTimer = 0.5 + r() * 1.1; }
      input.strafe = brain.strafeDir;
    }
    if (skill.hop && r() < 0.02) input.jump = true;
    if (skill.slide && input.forward > 0 && f.p.onGround && r() < 0.02) input.crouch = true;
  } else {
    input.forward = 1;
    if (skill.hop && r() < 0.01) input.jump = true;
    if (skill.slide && f.p.onGround && r() < 0.008) input.crouch = true;
  }

  // Unstick: if we barely moved for a second, jump (ledge climbs too) and pick a new place.
  brain.stuckTimer += dt;
  if (brain.stuckTimer > 1) {
    const moved = Math.hypot(f.p.pos.x - brain.lastPos.x, f.p.pos.z - brain.lastPos.z);
    if (moved < 0.6 && input.forward !== 0) { input.jump = true; if (!target) brain.wander = null; }
    brain.lastPos = { ...f.p.pos };
    brain.stuckTimer = 0;
  }
  if (input.forward > 0 && Math.abs(f.p.vel.x) + Math.abs(f.p.vel.z) < 0.5 && f.p.onGround) input.jump = true;

  // 4. Shoot when on target and we've had time to react.
  if (target && brain.seenFor >= skill.reaction) {
    const offYaw = Math.abs(angleDiff(wantYaw, brain.yaw));
    const tolerance = w.slot === 'melee' ? 0.6 : 0.09 + 0.6 / Math.max(4, bestD);
    const inRange = w.slot !== 'melee' || bestD < (w.reach ?? 2) + 0.5;
    // Fire in bursts with pauses, like a person re-aiming.
    brain.burstClock -= dt;
    if (brain.burstClock < -skill.rest) brain.burstClock = skill.burst * (0.6 + r() * 0.8);
    input.fire = offYaw < tolerance && inRange && brain.burstClock > 0;
    input.ads = w.zoom >= 2 && bestD > 12;
  }
  const ws = f.weapons[f.slot];
  if (ws.ammo === 0 && w.slot !== 'melee') input.reload = true;

  // Close-range panic: knife them if they're right on top of us.
  if (target && bestD < 2 && w.slot !== 'melee' && r() < 0.02) input.slot = 'melee';
  if (target && bestD > 4 && w.slot === 'melee') input.slot = 'primary';
  return input;
}
