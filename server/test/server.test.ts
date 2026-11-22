import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { PROTOCOL, encodeInput, idleInput, type GameRules, type ServerMsg, type SnapMsg } from '@blockfire/shared';

const PORT = 18787;
/** Set BF_URL (e.g. http://localhost:8787 under `wrangler dev`) to test another server instead of the Node one. */
const BASE = process.env['BF_URL'] ?? `http://localhost:${PORT}`;
let proc: ChildProcess | undefined;

beforeAll(async () => {
  if (process.env['BF_URL']) return;
  proc = spawn('node', [resolve(__dirname, '../dist/server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' });
  await new Promise<void>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('server did not start (run npm run build:server first)')), 8000);
    proc!.stdout!.on('data', (d) => { if (String(d).includes('listening')) { clearTimeout(timer); ok(); } });
  });
});

afterAll(() => { proc?.kill(); });

interface Client { ws: WebSocket; msgs: ServerMsg[]; next: (t: ServerMsg['t'], ms?: number) => Promise<ServerMsg> }

function connect(mode: 'quick' | 'create' | 'join', code?: string, game?: GameRules): Promise<Client> {
  return new Promise((ok) => {
    const q = new URLSearchParams({ mode, map: 'blocktown', gm: game?.mode ?? 'ffa', ...(code ? { code } : {}) });
    const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws?${q}`);
    const msgs: ServerMsg[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(String(d)) as ServerMsg));
    const next = async (t: ServerMsg['t'], ms = 3000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const i = msgs.findIndex((m) => m.t === t);
        if (i >= 0) return msgs.splice(i, 1)[0]!;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`no ${t} message`);
    };
    ws.on('open', () => ok({ ws, msgs, next }));
  });
}

async function enter(mode: 'quick' | 'create' | 'join', code?: string, name = 'Tester', game?: GameRules): Promise<Client> {
  const c = await connect(mode, code, game);
  c.ws.send(JSON.stringify({ t: 'join', v: PROTOCOL, name, loadout: { primary: 'assault_rifle', secondary: 'pistol', melee: 'combat_knife' }, rarity: {}, mode, code, map: 'blocktown', game }));
  return c;
}

describe('game server', () => {
  it('answers the health check', async () => {
    const r = await fetch(`${BASE}/health`);
    const body = await r.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('a player joins a room, gets 7 bots and 20 snapshots a second', async () => {
    const a = await enter('quick');
    const welcome = await a.next('welcome') as Extract<ServerMsg, { t: 'welcome' }>;
    expect(welcome.code).toMatch(/^[A-Z0-9]{6}$/);
    const roster = await a.next('roster') as Extract<ServerMsg, { t: 'roster' }>;
    expect(roster.list).toHaveLength(8);
    expect(roster.list.filter((r) => r.bot)).toHaveLength(7);
    a.msgs.length = 0;
    await new Promise((r) => setTimeout(r, 1000));
    const snaps = a.msgs.filter((m) => m.t === 'snap');
    expect(snaps.length).toBeGreaterThanOrEqual(15);
    expect(snaps.length).toBeLessThanOrEqual(25);
    a.ws.close();
  });

  it('the server moves you with your inputs and acknowledges them', async () => {
    const a = await enter('create');
    const w = await a.next('welcome') as Extract<ServerMsg, { t: 'welcome' }>;
    await a.next('snap');
    const start = (await a.next('snap') as SnapMsg).me!.pos;
    // Like the real game: two ticks of input per message, 30 messages a second.
    let seq = 0;
    const one = () => encodeInput(++seq, { ...idleInput(), forward: 1, yaw: 0 });
    const timer = setInterval(() => { a.ws.send(JSON.stringify({ t: 'ib', i: [one(), one()] })); }, 1000 / 30);
    await new Promise((r) => setTimeout(r, 1200));
    clearInterval(timer);
    await new Promise((r) => setTimeout(r, 200));
    const snaps = a.msgs.filter((m): m is SnapMsg => m.t === 'snap');
    const last = snaps[snaps.length - 1]!;
    expect(last.ack).toBeGreaterThan(40);
    const moved = Math.hypot(last.me!.pos.x - start.x, last.me!.pos.z - start.z);
    expect(moved).toBeGreaterThan(2);
    expect(w.id).toBeGreaterThan(0);
    a.ws.close();
  });

  it('a friend can join your private room with its code, replacing a bot', async () => {
    const a = await enter('create', undefined, 'Host');
    const w = await a.next('welcome') as Extract<ServerMsg, { t: 'welcome' }>;
    await a.next('roster');
    const b = await enter('join', w.code, 'Friend');
    const wb = await b.next('welcome') as Extract<ServerMsg, { t: 'welcome' }>;
    expect(wb.code).toBe(w.code);
    const roster = await a.next('roster') as Extract<ServerMsg, { t: 'roster' }>;
    expect(roster.list).toHaveLength(8);
    expect(roster.list.filter((r) => !r.bot).map((r) => r.name).sort()).toEqual(['Friend', 'Host']);
    // Friend leaves: a bot takes the place again.
    b.ws.close();
    const after = await a.next('roster') as Extract<ServerMsg, { t: 'roster' }>;
    expect(after.list.filter((r) => !r.bot)).toHaveLength(1);
    expect(after.list).toHaveLength(8);
    a.ws.close();
  });

  it('rejects a wrong room code', async () => {
    const a = await enter('join', 'ZZZZZZ');
    const e = await a.next('error') as Extract<ServerMsg, { t: 'error' }>;
    expect(e.message).toMatch(/No room/);
    a.ws.close();
  });
});

describe('game server: lag safety', () => {
  it('a player whose inputs stop (frozen tab) stops moving within a fraction of a second', async () => {
    const a = await enter('create');
    await a.next('welcome');
    await a.next('snap');
    let seq = 0;
    const timer = setInterval(() => { a.ws.send(JSON.stringify(encodeInput(++seq, { ...idleInput(), forward: 1, yaw: 0 }))); }, 1000 / 60);
    await new Promise((r) => setTimeout(r, 600));
    clearInterval(timer);
    await new Promise((r) => setTimeout(r, 300));
    a.msgs.length = 0;
    await new Promise((r) => setTimeout(r, 600));
    const snaps = a.msgs.filter((m): m is SnapMsg => m.t === 'snap');
    const first = snaps[0]!.me!.pos, last = snaps[snaps.length - 1]!.me!.pos;
    expect(Math.hypot(last.x - first.x, last.z - first.z)).toBeLessThan(0.5);
    a.ws.close();
  });
});

type Welcome = Extract<ServerMsg, { t: 'welcome' }>;
type Roster = Extract<ServerMsg, { t: 'roster' }>;
type Chat = Extract<ServerMsg, { t: 'chat' }>;

describe('game server: modes, chat and reports', () => {
  it('Quick Play keeps modes apart, and a Team Deathmatch room has 4 v 4 with team scores', async () => {
    const a = await enter('quick', undefined, 'Red?', { mode: 'tdm' });
    const b = await enter('quick', undefined, 'Solo', { mode: 'ffa' });
    const wa = await a.next('welcome') as Welcome;
    const wb = await b.next('welcome') as Welcome;
    expect(wa.mode).toBe('tdm');
    expect(wb.mode).toBe('ffa');
    expect(wa.code).not.toBe(wb.code);
    const roster = await a.next('roster') as Roster;
    expect(roster.list.filter((r) => r.team === 1)).toHaveLength(4);
    expect(roster.list.filter((r) => r.team === 2)).toHaveLength(4);
    const snap = await a.next('snap') as SnapMsg;
    expect(snap.ts).toEqual([expect.any(Number), expect.any(Number)]);
    a.ws.close(); b.ws.close();
  });

  it('custom rooms keep their rules: Gun Game with no bots', async () => {
    const a = await enter('create', undefined, 'Host', { mode: 'gungame', bots: false, timeLimit: 120 });
    const w = await a.next('welcome') as Welcome;
    expect(w.mode).toBe('gungame');
    expect(w.timeLimit).toBe(120);
    expect(w.isPublic).toBe(false);
    const roster = await a.next('roster') as Roster;
    expect(roster.list).toHaveLength(1);
    const snap = await a.next('snap') as SnapMsg;
    expect(snap.f[0]!.lv).toBe(0);
    a.ws.close();
  });

  it('chat reaches the room, filtered; team chat stays in the team; spam is slowed down', async () => {
    const a = await enter('create', undefined, 'Ann', { mode: 'tdm', bots: false });
    const w = await a.next('welcome') as Welcome;
    const b = await enter('join', w.code, 'Ben');
    await b.next('welcome');
    const c = await enter('join', w.code, 'Cat');
    await c.next('welcome');
    const roster = await c.next('roster') as Roster;
    const team = (name: string) => roster.list.find((r) => r.name === name)!.team;
    expect(team('Ann')).not.toBe(team('Ben'));
    a.ws.send(JSON.stringify({ t: 'chat', text: 'gg you bitch' }));
    const got = await b.next('chat') as Chat;
    expect(got.text).toBe('gg you *****');
    expect(got.name).toBe('Ann');
    await a.next('chat'); await c.next('chat'); // everyone got it, Ann included
    // Team chat from Cat reaches Cat's teammate only.
    const mate = team('Cat') === team('Ann') ? a : b;
    const other = mate === a ? b : a;
    c.ws.send(JSON.stringify({ t: 'chat', text: 'push mid', team: true }));
    const t = await mate.next('chat') as Chat;
    expect(t.team).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(other.msgs.some((m) => m.t === 'chat' && m.text === 'push mid')).toBe(false);
    // Spam: the 4th quick line is refused.
    for (let i = 0; i < 4; i++) a.ws.send(JSON.stringify({ t: 'chat', text: `spam ${i}` }));
    await new Promise((r) => setTimeout(r, 300));
    expect(a.msgs.some((m) => m.t === 'chat' && m.id === -1 && /Slow down/.test(m.text))).toBe(true);
    a.ws.close(); b.ws.close(); c.ws.close();
  });

  it('two reports mute a player for the room', async () => {
    const a = await enter('create', undefined, 'Rude', { mode: 'ffa', bots: false });
    const w = await a.next('welcome') as Welcome;
    const b = await enter('join', w.code, 'B');
    await b.next('welcome');
    const c = await enter('join', w.code, 'C');
    const wc = await c.next('welcome') as Welcome;
    expect(wc.id).toBeGreaterThan(0);
    b.ws.send(JSON.stringify({ t: 'report', id: w.id, reason: 'chat' }));
    expect(((await b.next('chat')) as Chat).text).toMatch(/report/);
    c.ws.send(JSON.stringify({ t: 'report', id: w.id, reason: 'chat' }));
    await c.next('chat');
    a.ws.send(JSON.stringify({ t: 'chat', text: 'can you hear me' }));
    await a.next('chat'); // Rude still sees their own line
    await new Promise((r) => setTimeout(r, 300));
    expect(b.msgs.some((m) => m.t === 'chat' && m.text === 'can you hear me')).toBe(false);
    a.ws.close(); b.ws.close(); c.ws.close();
  });
});
