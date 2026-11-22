import { describe, expect, it } from 'vitest';
import { RARITIES, WEAPONS, WEAPON_BY_ID, bodyTtk, weaponsInSlot } from '../src/index.js';

describe('weapon roster', () => {
  it('has 11 primaries, 12 secondaries and 11 melee weapons', () => {
    expect(weaponsInSlot('primary')).toHaveLength(11);
    expect(weaponsInSlot('secondary')).toHaveLength(12);
    expect(weaponsInSlot('melee')).toHaveLength(11);
    expect(new Set(WEAPONS.map((w) => w.id)).size).toBe(WEAPONS.length);
  });

  it('every primary unlocks a real secondary, and each secondary only once', () => {
    const unlocks = weaponsInSlot('primary').map((w) => w.masteryUnlock!);
    for (const id of unlocks) expect(WEAPON_BY_ID[id]?.slot).toBe('secondary');
    expect(new Set(unlocks).size).toBe(11);
  });

  it('matches the body-shot time-to-kill table in the Weapons Design doc', () => {
    const expected: Record<string, number> = {
      assault_rifle: 0.4, smg: 0.4, machine_gun: 0.28, sniper: 0, speedy_sniper: 0.86, revolver: 0.67,
      bomber: 0.8, k2_bomber: 0, electronic_gun: 0.25, super_pistols: 0.72, dual_heavy_mgs: 0.13,
    };
    for (const [id, ttk] of Object.entries(expected)) expect(bodyTtk(WEAPON_BY_ID[id]!)).toBeCloseTo(ttk, 1);
  });

  it('follows the speed budget: any primary over 100% speed has TTK of at least 0.4 s', () => {
    for (const w of weaponsInSlot('primary')) if (w.moveSpeed > 1) expect(bodyTtk(w)).toBeGreaterThanOrEqual(0.399);
  });

  it('only Snake weapons allow wall-jumps', () => {
    expect(WEAPONS.filter((w) => w.wallJump).map((w) => w.id).sort()).toEqual(['snake_auto_pistol', 'snake_pistol']);
  });

  it('has 9 rarities', () => {
    expect(RARITIES).toHaveLength(9);
  });
});
