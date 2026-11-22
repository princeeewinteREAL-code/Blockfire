import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { PROTOCOL, encodeInput, idleInput, type ServerMsg, type SnapMsg } from '@blockfire/shared';

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

function connect(mode: 'quick' | 'create' | 'join', code?: string): Promise<Client> {
  return new Promise((ok) => {
    const q = new URLSearchParams({ mode, map: 'blocktown', ...(code ? { code } : {}) });
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

async function enter(mode: 'quick' | 'create' | 'join', code?: string, name = 'Tester'): Promise<Client> {
  const c = await connect(mode, code);
  c.ws.send(JSON.stringify({ t: 'join', v: PROTOCOL, name, loadout: { primary: 'assault_rifle', secondary: 'pistol', melee: 'combat_knife' }, rarity: {}, mode, code, map: 'blocktown' }));
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
