/**
 * One player's connection, independent of how they're connected: the Node server (ws) and the
 * Cloudflare server (Durable Objects) both feed text messages in here.
 */
import {
  PROTOCOL, WEAPON_BY_ID, cleanName, decodeInput,
  type ClientMsg, type InputMsg, type JoinMsg, type Loadout3, type RarityId,
} from '@blockfire/shared';
import type { Connection, Room } from './room.js';

/** Messages a player may send per second before extras are ignored (normal play is about 30). */
const MAX_MSG_PER_SEC = 120;
/** Longest message a player may send (a join message is a few hundred bytes). */
export const MAX_MSG_BYTES = 4096;

export function validLoadout(l: Partial<Loadout3> | undefined): Loadout3 {
  const pick = (id: string | undefined, slot: string, fallback: string) =>
    id && WEAPON_BY_ID[id]?.slot === slot ? id : fallback;
  return {
    primary: pick(l?.primary, 'primary', 'assault_rifle'),
    secondary: pick(l?.secondary, 'secondary', 'pistol'),
    melee: pick(l?.melee, 'melee', 'combat_knife'),
  };
}

const RARITIES = new Set(['basic', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'uncontrollable', 'hot', 'lifelong']);

export function validRarity(r: unknown): Record<string, RarityId> {
  const out: Record<string, RarityId> = {};
  if (r && typeof r === 'object') {
    for (const [k, v] of Object.entries(r as Record<string, unknown>)) if (WEAPON_BY_ID[k] && RARITIES.has(String(v))) out[k] = v as RarityId;
  }
  return out;
}

export function cleanMap(map: unknown): string {
  return map === 'neon-yard' ? 'neon-yard' : 'blocktown';
}

export function cleanCode(code: unknown): string {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

/** Picks (or creates) the room for a join message, or returns an error to show the player. */
export type RoomPicker = (msg: JoinMsg) => Room | string;

export class Session {
  room: Room | null = null;
  fighterId = -1;
  private tokens = MAX_MSG_PER_SEC;
  private lastRefill = Date.now();

  constructor(private conn: Connection, private pickRoom: RoomPicker, private onJoined?: (room: Room) => void) {}

  onMessage(text: string): void {
    if (text.length > MAX_MSG_BYTES) return;
    const now = Date.now();
    this.tokens = Math.min(MAX_MSG_PER_SEC, this.tokens + ((now - this.lastRefill) / 1000) * MAX_MSG_PER_SEC);
    this.lastRefill = now;
    if (this.tokens < 1) return; // too many messages: ignore the extras
    this.tokens -= 1;

    let msg: ClientMsg;
    try { msg = JSON.parse(text) as ClientMsg; } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'join') {
      if (this.room) return;
      if (msg.v !== PROTOCOL) { this.fail('Your game is out of date. Refresh the page.'); return; }
      const picked = this.pickRoom(msg);
      if (typeof picked === 'string') { this.fail(picked); return; }
      this.room = picked;
      this.fighterId = picked.join(this.conn, cleanName(msg.name), validLoadout(msg.loadout), validRarity(msg.rarity));
      this.onJoined?.(picked);
      return;
    }
    if (!this.room) return;
    if (msg.t === 'in') this.input(msg);
    else if (msg.t === 'ib' && Array.isArray(msg.i)) for (const one of msg.i.slice(0, 8)) this.input(one);
  }

  onClose(): void {
    this.room?.leave(this.fighterId);
  }

  private input(m: InputMsg): void {
    if (m && Array.isArray(m.f) && m.f.length === 6 && Number.isInteger(m.s)) {
      this.room!.input(this.fighterId, m.s, decodeInput(m));
    }
  }

  private fail(message: string): void {
    this.conn.send({ t: 'error', message });
    this.conn.close();
  }
}
