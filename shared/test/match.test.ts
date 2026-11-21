import { describe, expect, it } from 'vitest';
import {
  BOT_SKILL, Match, NEON_YARD, aimDirection, botLoadout, botThink, createBrain, fits, idleInput, makeRng,
  type BotDifficulty, type FighterInput,
} from '../src/index.js';

const DT = 1 / 60;

function runBots(seconds: number, difficulty: BotDifficulty, count = 8, seed = 1) {
  const match = new Match(NEON_YARD, { scoreLimit: 999, timeLimit: 9999 }, seed);
  const rand = makeRng(seed);
  const brains = new Map<number, ReturnType<typeof createBrain>>();
  for (let i = 0; i < count; i++) {
    const f = match.addFighter(`bot${i}`, botLoadout(rand), true);
    brains.set(f.id, createBrain(difficulty, seed * 100 + i));
  }
  for (let t = 0; t < seconds / DT; t++) {
    const inputs = new Map<number, FighterInput>();
    for (const f of match.fighters) inputs.set(f.id, botThink(match, f, brains.get(f.id)!, DT));
    match.tick(DT, inputs);
    match.events = [];
  }
  return match;
}

describe('Neon Yard', () => {
  it('every spawn point is inside the arena and has room to stand', () => {
    for (const s of NEON_YARD.spawns!) {
      expect(fits(NEON_YARD, s.pos[0], 0.01, s.pos[2], 1.8)).toBe(true);
      expect(Math.abs(s.pos[0])).toBeLessThan(32);
      expect(Math.abs(s.pos[2])).toBeLessThan(32);
    }
  });
});

describe('combat rules', () => {
  function duel(primary: string) {
    const m = new Match(NEON_YARD, { scoreLimit: 99, timeLimit: 999 }, 7);
    const a = m.addFighter('A', { primary, secondary: 'pistol', melee: 'combat_knife' }, false);
    const b = m.addFighter('B', { primary: 'assault_rifle', secondary: 'pistol', melee: 'combat_knife' }, false);
    // Put them 10 m apart on open floor, A facing B, protection off.
    a.p.pos = { x: 0, y: 0, z: 22 }; b.p.pos = { x: 0, y: 0, z: 12 };
    a.yaw = 0; a.protectLeft = 0; b.protectLeft = 0;
    for (let i = 0; i < 30; i++) m.tick(DT, new Map());
    return { m, a, b };
  }

  it('the Sniper Rifle kills with one body shot', () => {
    const { m, a, b } = duel('sniper');
    const input: FighterInput = { ...idleInput(), yaw: 0, pitch: Math.atan2(1.0 - 1.64, 10), fire: true, ads: true };
    for (let i = 0; i < 6; i++) m.tick(DT, new Map([[a.id, input]]));
    expect(b.alive).toBe(false);
    expect(a.kills).toBe(1);
  });

  it('the Assault Rifle takes 5 body shots (about 0.4 s)', () => {
    const { m, a, b } = duel('assault_rifle');
    const input: FighterInput = { ...idleInput(), yaw: 0, pitch: Math.atan2(1.0 - 1.64, 10), fire: true, ads: true };
    let ticks = 0;
    while (b.alive && ticks < 120) { m.tick(DT, new Map([[a.id, input]])); ticks++; }
    expect(b.alive).toBe(false);
    expect(ticks * DT).toBeLessThan(0.75);
    expect(ticks * DT).toBeGreaterThan(0.3);
  });

  it('spawn protection blocks damage until it runs out', () => {
    const { m, a, b } = duel('sniper');
    b.protectLeft = 2;
    const input: FighterInput = { ...idleInput(), yaw: 0, pitch: Math.atan2(1.0 - 1.64, 10), fire: true, ads: true };
    for (let i = 0; i < 6; i++) m.tick(DT, new Map([[a.id, input]]));
    expect(b.alive).toBe(true);
    expect(b.hp).toBe(100);
  });

  it('reloads automatically when you fire an empty gun, then refills', () => {
    const { m, a } = duel('revolver');
    a.weapons.primary.ammo = 0;
    const fire: FighterInput = { ...idleInput(), yaw: Math.PI, fire: true };
    m.tick(DT, new Map([[a.id, fire]]));
    expect(a.weapons.primary.reloadLeft).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) m.tick(DT, new Map());
    expect(a.weapons.primary.ammo).toBe(6);
  });

  it('a Bomber shot at your feet launches you (rocket jump) but cannot kill you', () => {
    const m = new Match(NEON_YARD, { scoreLimit: 99, timeLimit: 999 }, 3);
    const a = m.addFighter('A', { primary: 'bomber', secondary: 'pistol', melee: 'combat_knife' }, false);
    a.p.pos = { x: 0, y: 0, z: 24 };
    for (let i = 0; i < 30; i++) m.tick(DT, new Map());
    const down: FighterInput = { ...idleInput(), pitch: -1.5, fire: true };
    let peak = 0;
    m.tick(DT, new Map([[a.id, down]]));
    for (let i = 0; i < 90; i++) { m.tick(DT, new Map()); peak = Math.max(peak, a.p.pos.y); }
    expect(peak).toBeGreaterThan(1.3);
    expect(a.alive).toBe(true);
    expect(a.hp).toBeGreaterThanOrEqual(85);
  });

  it('a Combat Knife backstab kills instantly', () => {
    const m = new Match(NEON_YARD, { scoreLimit: 99, timeLimit: 999 }, 4);
    const a = m.addFighter('A', { primary: 'assault_rifle', secondary: 'pistol', melee: 'combat_knife' }, false);
    const b = m.addFighter('B', { primary: 'assault_rifle', secondary: 'pistol', melee: 'combat_knife' }, false);
    a.p.pos = { x: 0, y: 0, z: 23 }; b.p.pos = { x: 0, y: 0, z: 21.6 };
    a.protectLeft = 0; b.protectLeft = 0; b.yaw = 0; // b faces away from a (toward -Z)
    for (let i = 0; i < 20; i++) m.tick(DT, new Map([[a.id, { ...idleInput(), slot: 'melee' }], [b.id, { ...idleInput(), yaw: 0 }]]));
    m.tick(DT, new Map([[a.id, { ...idleInput(), yaw: 0, pitch: -0.2, fire: true, slot: 'melee' }], [b.id, { ...idleInput(), yaw: 0 }]]));
    expect(b.alive).toBe(false);
  });

  it('aimDirection points where the camera looks', () => {
    const d = aimDirection(0, 0);
    expect(d.z).toBeCloseTo(-1);
  });
});

describe('bots', () => {
  it('a 60-second Normal-bot match produces kills and nobody gets stuck dead', () => {
    const m = runBots(60, 'normal');
    const kills = m.fighters.reduce((s, f) => s + f.kills, 0);
    expect(kills).toBeGreaterThan(5);
    for (const f of m.fighters) expect(Number.isFinite(f.p.pos.x)).toBe(true);
  });

  it('harder bots out-score easier bots', () => {
    const m = new Match(NEON_YARD, { scoreLimit: 999, timeLimit: 9999 }, 9);
    const rand = makeRng(9);
    const brains = new Map<number, ReturnType<typeof createBrain>>();
    const levels: BotDifficulty[] = ['easy', 'easy', 'easy', 'insane', 'insane', 'insane'];
    levels.forEach((d, i) => {
      const f = m.addFighter(d, { primary: 'assault_rifle', secondary: 'pistol', melee: 'combat_knife' }, true);
      brains.set(f.id, createBrain(d, 50 + i));
      void rand;
    });
    for (let t = 0; t < 90 / DT; t++) {
      const inputs = new Map<number, FighterInput>();
      for (const f of m.fighters) inputs.set(f.id, botThink(m, f, brains.get(f.id)!, DT));
      m.tick(DT, inputs);
      m.events = [];
    }
    const score = (d: string) => m.fighters.filter((f) => f.name === d).reduce((s, f) => s + f.kills, 0);
    expect(score('insane')).toBeGreaterThan(score('easy'));
    expect(BOT_SKILL.insane.error).toBeLessThan(BOT_SKILL.easy.error);
  });
});
