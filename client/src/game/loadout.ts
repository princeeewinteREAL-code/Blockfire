import type { RarityId, Slot } from '@blockfire/shared';

/**
 * Your equipped weapons and the skin rarity you picked for each weapon.
 * Saved in this browser for now; Phase 4 moves it to your account on the server.
 */
export interface Loadout {
  primary: string;
  secondary: string;
  melee: string;
  rarity: Record<string, RarityId>;
}

const KEY = 'blockfire.loadout.v1';

export const DEFAULT_LOADOUT: Loadout = {
  primary: 'assault_rifle',
  secondary: 'snake_pistol',
  melee: 'combat_knife',
  rarity: { assault_rifle: 'legendary', snake_pistol: 'epic', combat_knife: 'rare' },
};

export function loadLoadout(): Loadout {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_LOADOUT);
    const p = JSON.parse(raw) as Partial<Loadout>;
    return { ...DEFAULT_LOADOUT, ...p, rarity: { ...DEFAULT_LOADOUT.rarity, ...(p.rarity ?? {}) } };
  } catch {
    return structuredClone(DEFAULT_LOADOUT);
  }
}

export function saveLoadout(l: Loadout): void {
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* storage blocked */ }
}

export function rarityOf(l: Loadout, id: string): RarityId {
  return l.rarity[id] ?? 'basic';
}

export function equippedIn(l: Loadout, slot: Slot): string {
  return l[slot];
}
