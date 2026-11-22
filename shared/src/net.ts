/**
 * The online protocol: the messages the browser and the game server send each other.
 * Plain JSON over a WebSocket, kept compact (short keys, rounded numbers).
 *
 * Flow:
 *   browser → server  join  (name, loadout, which room)
 *   server → browser  welcome (your id, room code, map)
 *   browser → server  in    (one input per 1/60 s tick, numbered)
 *   server → browser  roster (who's in the room) whenever it changes
 *   server → browser  snap  (everyone's state + what happened) 20 times a second
 */
import type { FighterInput, Loadout3, MatchEvent } from './match.js';
import type { PlayerState } from './movement.js';
import type { RarityId, Slot } from './weapons.js';

export const TICK_RATE = 60;
export const SNAPSHOT_EVERY = 3; // ticks → 20 snapshots per second
export const ROOM_SIZE = 8;
export const PROTOCOL = 1;

export type JoinMode = 'quick' | 'create' | 'join';

export interface JoinMsg {
  t: 'join';
  v: number;
  name: string;
  loadout: Loadout3;
  rarity: Record<string, RarityId>;
  mode: JoinMode;
  code?: string;
  map?: string;
}

/** One tick of input. f = [forward, strafe, flags, yaw, pitch, slot?] */
export interface InputMsg { t: 'in'; s: number; f: [number, number, number, number, number, number] }

export interface RosterEntry { id: number; name: string; bot: boolean; loadout: Loadout3; rarity: Record<string, RarityId> }

export interface WelcomeMsg { t: 'welcome'; id: number; code: string; map: string; scoreLimit: number; timeLimit: number }
export interface RosterMsg { t: 'roster'; list: RosterEntry[] }
export interface ErrorMsg { t: 'error'; message: string }

/** One player in a snapshot. */
export interface SnapFighter {
  id: number;
  /** position, velocity */
  p: [number, number, number, number, number, number];
  /** yaw, pitch */
  a: [number, number];
  hp: number;
  al: 0 | 1;
  sl: 0 | 1 | 2;
  /** flags: 1 onGround, 2 crouched, 4 sliding, 8 ads */
  fl: number;
  pr: number;
  k: number;
  d: number;
  rs: number;
  fa: number;
}

export interface SnapMsg {
  t: 'snap';
  tick: number;
  time: number;
  /** Last input number the server used for you. */
  ack: number;
  f: SnapFighter[];
  /** Your full movement state, for prediction. */
  me?: PlayerState;
  /** Your weapons: [ammo, reloadLeft] per slot. */
  w?: [[number, number], [number, number], [number, number]];
  pj: Array<[number, string, number, number, number, number, number, number, 0 | 1]>;
  ev: MatchEvent[];
  over: boolean;
  winner: number | null;
}

export type ServerMsg = WelcomeMsg | RosterMsg | SnapMsg | ErrorMsg;
export type ClientMsg = JoinMsg | InputMsg;

export const SLOTS: Slot[] = ['primary', 'secondary', 'melee'];

const F_JUMP = 1, F_CROUCH = 2, F_WALK = 4, F_FIRE = 8, F_ADS = 16, F_RELOAD = 32;

export function encodeInput(seq: number, i: FighterInput): InputMsg {
  const flags = (i.jump ? F_JUMP : 0) | (i.crouch ? F_CROUCH : 0) | (i.walk ? F_WALK : 0) |
    (i.fire ? F_FIRE : 0) | (i.ads ? F_ADS : 0) | (i.reload ? F_RELOAD : 0);
  const slot = i.slot ? SLOTS.indexOf(i.slot) + 1 : 0;
  return { t: 'in', s: seq, f: [i.forward, i.strafe, flags, r4(i.yaw), r4(i.pitch), slot] };
}

export function decodeInput(m: InputMsg): FighterInput {
  const [forward, strafe, flags, yaw, pitch, slot] = m.f;
  const clamp1 = (n: number) => Math.max(-1, Math.min(1, Math.round(Number(n) || 0)));
  return {
    forward: clamp1(forward),
    strafe: clamp1(strafe),
    jump: !!(flags & F_JUMP),
    crouch: !!(flags & F_CROUCH),
    walk: !!(flags & F_WALK),
    fire: !!(flags & F_FIRE),
    ads: !!(flags & F_ADS),
    reload: !!(flags & F_RELOAD),
    yaw: Number.isFinite(yaw) ? yaw : 0,
    pitch: Number.isFinite(pitch) ? Math.max(-1.56, Math.min(1.56, pitch)) : 0,
    wallJump: false,
    speedMul: 1,
    slot: slot >= 1 && slot <= 3 ? SLOTS[slot - 1] : undefined,
  };
}

export function r3(n: number): number { return Math.round(n * 1000) / 1000; }
export function r4(n: number): number { return Math.round(n * 10000) / 10000; }

/** A friendly 6-letter room code (no confusing letters like O/0 or I/1). */
export function makeRoomCode(rand: () => number): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += A[Math.floor(rand() * A.length)];
  return s;
}

/** Keep player names short and printable. */
export function cleanName(raw: unknown): string {
  const s = String(raw ?? '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 18);
  return s || 'Player';
}
