/**
 * Game modes. A mode changes who you fight, which weapons you carry and how you win;
 * movement and weapon behaviour stay the same everywhere.
 */
import type { Loadout3 } from './match.js';
import { WEAPON_BY_ID, type Slot } from './weapons.js';

export type ModeId = 'ffa' | 'tdm' | 'gungame' | 'sniper' | 'melee';

export interface ModeDef {
  id: ModeId;
  name: string;
  blurb: string;
  teams: boolean;
  /** Default win score: kills (FFA), team kills (TDM) or gun level (Gun Game). */
  scoreLimit: number;
  /** Default length in seconds. */
  timeLimit: number;
}

/** Gun Game ladder: a kill moves you to the next gun. A kill with the last one (the knife) wins. */
export const GUN_LADDER = [
  'assault_rifle', 'smg', 'dual_heavy_mgs', 'machine_gun', 'super_pistols', 'revolver', 'auto_revolver',
  'auto_pistol', 'hand_cannon', 'speedy_sniper', 'sniper', 'bomber', 'pistol', 'combat_knife',
] as const;

export const MODES: ModeDef[] = [
  { id: 'ffa', name: 'Free For All', blurb: 'Everyone for themselves. First to 30 kills wins.', teams: false, scoreLimit: 30, timeLimit: 360 },
  { id: 'tdm', name: 'Team Deathmatch', blurb: 'Red vs Blue. First team to 50 kills wins. No friendly fire.', teams: true, scoreLimit: 50, timeLimit: 480 },
  { id: 'gungame', name: 'Gun Game', blurb: `Every kill gives you the next gun (${GUN_LADDER.length} in all). Get a kill with the knife to win. Knife someone to send them back one gun.`, teams: false, scoreLimit: GUN_LADDER.length, timeLimit: 600 },
  { id: 'sniper', name: 'Sniper Only', blurb: 'Snipers and knives, nothing else. First to 25.', teams: false, scoreLimit: 25, timeLimit: 360 },
  { id: 'melee', name: 'Melee Mayhem', blurb: 'No guns: just your melee weapon, and everyone moves 15% faster. First to 20.', teams: false, scoreLimit: 20, timeLimit: 300 },
];

export const MODE_BY_ID: Record<ModeId, ModeDef> = Object.fromEntries(MODES.map((m) => [m.id, m])) as Record<ModeId, ModeDef>;

export function cleanMode(raw: unknown): ModeId {
  return typeof raw === 'string' && raw in MODE_BY_ID ? (raw as ModeId) : 'ffa';
}

export const TEAM_NAMES = ['', 'Red', 'Blue'] as const;
export const TEAM_COLORS = ['#ffffff', '#ff4d5e', '#3d9bff'] as const;

/** The weapons a fighter actually carries in this mode, given the loadout they picked. */
export function modeLoadout(mode: ModeId, picked: Loadout3, gunLevel = 0): Loadout3 {
  switch (mode) {
    case 'sniper':
      return { primary: picked.primary === 'speedy_sniper' ? 'speedy_sniper' : 'sniper', secondary: 'pistol', melee: picked.melee };
    case 'melee':
      return { primary: 'assault_rifle', secondary: 'pistol', melee: picked.melee };
    case 'gungame': {
      const id = GUN_LADDER[Math.min(gunLevel, GUN_LADDER.length - 1)]!;
      const slot = WEAPON_BY_ID[id]!.slot;
      return {
        primary: slot === 'primary' ? id : 'assault_rifle',
        secondary: slot === 'secondary' ? id : 'pistol',
        melee: slot === 'melee' ? id : 'combat_knife',
      };
    }
    default:
      return picked;
  }
}

/** Which weapon slots may be used in this mode (the first one is where you spawn). */
export function allowedSlots(mode: ModeId, gunLevel = 0): Slot[] {
  switch (mode) {
    case 'sniper': return ['primary', 'melee'];
    case 'melee': return ['melee'];
    case 'gungame': {
      const slot = WEAPON_BY_ID[GUN_LADDER[Math.min(gunLevel, GUN_LADDER.length - 1)]!]!.slot;
      return slot === 'melee' ? ['melee'] : [slot, 'melee'];
    }
    default: return ['primary', 'secondary', 'melee'];
  }
}

/** Extra movement speed in this mode. */
export function modeSpeed(mode: ModeId): number {
  return mode === 'melee' ? 1.15 : 1;
}
