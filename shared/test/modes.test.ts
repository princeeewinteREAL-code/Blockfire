import { describe, expect, it } from 'vitest';
import {
  BLOCKTOWN, GUN_LADDER, MODES, Match, NEON_YARD, botLoadout, botThink, createBrain, idleInput, makeRng,
  type FighterInput, type ModeId,
} from '../src/index.js';

const DT = 1 / 60;
const PICK = { primary: 'assault_rifle', secondary: 'pistol', melee: 'katana' };
/** Aim from 10 m away at the body of someone standing on the same floor. */
const AIM: FighterInput = { ...idleInput(), yaw: 0, pitch: Math.atan2(1.0 - 1.64, 10), fire: true, ads: true };

function setup(mode: ModeId, extra: Partial<{ lagComp: boolean }> = {}) {
  return new Match(NEON_YARD, { scoreLimit: 99, timeLimit: 999, mode, ...extra }, 7);
}

/** Line two fighters up 10 m apart, A looking at B. */
function lineUp(m: Match, a: ReturnType<Match['addFighter']>, b: ReturnType<Match['addFighter']>) {
  a.p.pos = { x: 0, y: 0, z: 22 }; b.p.pos = { x: 0, y: 0, z: 12 };
  a.yaw = 0; a.protectLeft = 0; b.protectLeft = 0;
  for (let i = 0; i < 30; i++) m.tick(DT, new Map());
}

function runBots(mode: ModeId, seconds: number, seed = 3) {
  const def = MODES.find((x) => x.id === mode)!;
  const m = new Match(BLOCKTOWN, { scoreLimit: def.scoreLimit, timeLimit: 9999, mode }, seed);
  const rand = makeRng(seed);
  const brains = new Map<number, ReturnType<typeof createBrain>>();
  for (let i = 0; i < 8; i++) {
    const f = m.addFighter(`bot${i}`, botLoadout(rand), true);
    brains.set(f.id, createBrain('hard', seed * 100 + i));
  }
  for (let t = 0; t < seconds / DT && !m.over; t++) {
    const inputs = new Map<number, FighterInput>();
    for (const f of m.fighters) inputs.set(f.id, botThink(m, f, brains.get(f.id)!, DT));
    m.tick(DT, inputs);
    m.events = [];
  }
  return m;
}

describe('Team Deathmatch', () => {
  it('splits players evenly into Red and Blue', () => {
    const m = setup('tdm');
    for (let i = 0; i < 8; i++) m.addFighter(`p${i}`, PICK, true);
    expect(m.fighters.filter((f) => f.team === 1)).toHaveLength(4);
    expect(m.fighters.filter((f) => f.team === 2)).toHaveLength(4);
  });

  it('shots pass through teammates without hurting them and hit the enemy behind', () => {
    const m = setup('tdm');
    const a = m.addFighter('A', { ...PICK, primary: 'sniper' }, false, undefined, 1);
    const mate = m.addFighter('Mate', PICK, false, undefined, 1);
    const b = m.addFighter('B', PICK, false, undefined, 2);
    lineUp(m, a, b);
    mate.p.pos = { x: 0, y: 0, z: 17 }; mate.protectLeft = 0;
    for (let i = 0; i < 6; i++) m.tick(DT, new Map([[a.id, AIM]]));
    expect(mate.hp).toBe(100);
    expect(b.alive).toBe(false);
    expect(m.teamScore[1]).toBe(1);
  });

  it('ends when a team reaches the score limit', () => {
    const m = new Match(NEON_YARD, { scoreLimit: 1, timeLimit: 999, mode: 'tdm' }, 7);
    const a = m.addFighter('A', { ...PICK, primary: 'sniper' }, false, undefined, 2);
    const b = m.addFighter('B', PICK, false, undefined, 1);
    lineUp(m, a, b);
    for (let i = 0; i < 6; i++) m.tick(DT, new Map([[a.id, AIM]]));
    expect(m.over).toBe(true);
    expect(m.winnerTeam).toBe(2);
  });

  it('a whole bot match runs and the bots fight the other team only', () => {
    const m = runBots('tdm', 60);
    expect(m.teamScore[1]! + m.teamScore[2]!).toBeGreaterThan(5);
    const kills = m.fighters.reduce((s, f) => s + f.kills, 0);
    expect(kills).toBe(m.teamScore[1]! + m.teamScore[2]!);
  });
});

describe('Gun Game', () => {
  it('a kill gives you the next gun on the ladder', () => {
    const m = setup('gungame');
    const a = m.addFighter('A', PICK, false);
    const b = m.addFighter('B', PICK, false);
    expect(m.weaponOf(a).id).toBe(GUN_LADDER[0]);
    lineUp(m, a, b);
    for (let i = 0; i < 90 && b.alive; i++) m.tick(DT, new Map([[a.id, AIM]]));
    expect(b.alive).toBe(false);
    expect(a.level).toBe(1);
    expect(m.weaponOf(a).id).toBe(GUN_LADDER[1]);
    expect(m.events.some((e) => e.type === 'level' && e.id === a.id && e.up)).toBe(true);
  });

  it('getting knifed sends you back one gun; a knife kill on the last level wins', () => {
    const m = new Match(NEON_YARD, { scoreLimit: GUN_LADDER.length, timeLimit: 999, mode: 'gungame' }, 7);
    const a = m.addFighter('A', PICK, false);
    const b = m.addFighter('B', PICK, false);
    // Jump A to the knife level by hand, and give B a few levels.
    for (let l = 0; l < GUN_LADDER.length - 1; l++) (m as unknown as { setLevel: (f: unknown, n: number) => void }).setLevel(a, l + 1);
    (m as unknown as { setLevel: (f: unknown, n: number) => void }).setLevel(b, 4);
    expect(m.weaponOf(a).id).toBe('combat_knife');
    a.p.pos = { x: 0, y: 0, z: 13.2 }; b.p.pos = { x: 0, y: 0, z: 12 };
    a.yaw = 0; a.protectLeft = 0; b.protectLeft = 0;
    for (let i = 0; i < 30; i++) m.tick(DT, new Map());
    const stab: FighterInput = { ...idleInput(), yaw: 0, pitch: -0.3, fire: true };
    for (let i = 0; i < 120 && !m.over; i++) m.tick(DT, new Map([[a.id, stab]]));
    expect(b.level).toBe(3);
    expect(m.over).toBe(true);
    expect(m.winner).toBe(a.id);
  });

  it('you can only switch between your ladder gun and the knife', () => {
    const m = setup('gungame');
    const a = m.addFighter('A', PICK, false);
    for (let i = 0; i < 20; i++) m.tick(DT, new Map([[a.id, { ...idleInput(), slot: 'secondary' }]]));
    expect(a.slot).toBe('primary');
    for (let i = 0; i < 20; i++) m.tick(DT, new Map([[a.id, { ...idleInput(), slot: 'melee' }]]));
    expect(a.slot).toBe('melee');
  });

  it('bots climb the ladder', () => {
    const m = runBots('gungame', 90);
    expect(Math.max(...m.fighters.map((f) => f.level))).toBeGreaterThanOrEqual(3);
  });
});

describe('Sniper Only and Melee Mayhem', () => {
  it('Sniper Only gives everyone a sniper and blocks the secondary', () => {
    const m = setup('sniper');
    const a = m.addFighter('A', PICK, false);
    expect(m.weaponOf(a).id).toBe('sniper');
    for (let i = 0; i < 20; i++) m.tick(DT, new Map([[a.id, { ...idleInput(), slot: 'secondary' }]]));
    expect(m.weaponOf(a).id).toBe('sniper');
  });

  it('Melee Mayhem keeps your melee weapon only, and you run faster', () => {
    const m = setup('melee');
    const f = setup('ffa');
    const a = m.addFighter('A', PICK, false);
    const b = f.addFighter('B', { ...PICK }, false);
    expect(m.weaponOf(a).id).toBe('katana');
    for (let i = 0; i < 20; i++) m.tick(DT, new Map([[a.id, { ...idleInput(), slot: 'primary' }]]));
    expect(m.weaponOf(a).id).toBe('katana');
    // Same weapon in both matches, so the only difference is the mode bonus.
    f.tick(DT, new Map([[b.id, { ...idleInput(), slot: 'melee' }]]));
    for (let i = 0; i < 30; i++) f.tick(DT, new Map());
    a.p.pos = { x: 0, y: 0, z: 24 }; b.p.pos = { x: 0, y: 0, z: 24 };
    for (let i = 0; i < 60; i++) {
      m.tick(DT, new Map([[a.id, { ...idleInput(), forward: 1 }]]));
      f.tick(DT, new Map([[b.id, { ...idleInput(), forward: 1 }]]));
    }
    expect(24 - a.p.pos.z).toBeGreaterThan((24 - b.p.pos.z) * 1.1);
  });
});

describe('lag compensation', () => {
  function rewindDuel(lagComp: boolean, viewDelay: number, sinceMove = 4) {
    const m = setup('ffa', { lagComp });
    const a = m.addFighter('A', { ...PICK, primary: 'sniper' }, false);
    const b = m.addFighter('B', PICK, false);
    lineUp(m, a, b);
    // B steps 3 m to the side. A, who sees the world late, still sees B where B was.
    b.p.pos = { ...b.p.pos, x: 3 };
    for (let i = 0; i < sinceMove; i++) m.tick(DT, new Map());
    a.viewDelay = viewDelay;
    for (let i = 0; i < 4; i++) m.tick(DT, new Map([[a.id, AIM]]));
    return b.alive;
  }

  it('a shot at where you saw someone counts, if they were there that long ago', () => {
    expect(rewindDuel(true, 12)).toBe(false);
  });

  it('without lag compensation the same shot misses', () => {
    expect(rewindDuel(false, 12)).toBe(true);
    expect(rewindDuel(true, 0)).toBe(true);
  });

  it('never rewinds further than 0.3 s', () => {
    // B moved 0.4 s ago; even a player who claims a 1 s delay only gets 0.3 s.
    expect(rewindDuel(true, 60, 24)).toBe(true);
    expect(rewindDuel(true, 12, 24)).toBe(true);
  });
});
