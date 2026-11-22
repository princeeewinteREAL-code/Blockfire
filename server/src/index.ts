/**
 * Blockfire game server.
 *
 *   npm run server          (after `npm run build:server`)
 *
 * Environment variables:
 *   PORT   port to listen on (default 8787)
 *
 * Players connect with a WebSocket. Quick Play puts you in the fullest public room that has space;
 * Create makes a private room with a 6-letter code your friends can join.
 */
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  PROTOCOL, TICK_RATE, WEAPON_BY_ID, cleanName, decodeInput, makeRng, makeRoomCode,
  type ClientMsg, type Loadout3, type RarityId, type ServerMsg,
} from '@blockfire/shared';
import { Room, type Connection } from './room.js';

const PORT = Number(process.env['PORT'] ?? 8787);
const rand = makeRng(Date.now() & 0xffffffff);
const rooms = new Map<string, Room>();
const MAX_ROOMS = 50;
const MAX_MSG_PER_SEC = 120;

function validLoadout(l: Partial<Loadout3> | undefined): Loadout3 {
  const pick = (id: string | undefined, slot: string, fallback: string) =>
    id && WEAPON_BY_ID[id]?.slot === slot ? id : fallback;
  return {
    primary: pick(l?.primary, 'primary', 'assault_rifle'),
    secondary: pick(l?.secondary, 'secondary', 'pistol'),
    melee: pick(l?.melee, 'melee', 'combat_knife'),
  };
}

function validRarity(r: unknown): Record<string, RarityId> {
  const ok = new Set(['basic', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'uncontrollable', 'hot', 'lifelong']);
  const out: Record<string, RarityId> = {};
  if (r && typeof r === 'object') {
    for (const [k, v] of Object.entries(r as Record<string, unknown>)) if (WEAPON_BY_ID[k] && ok.has(String(v))) out[k] = v as RarityId;
  }
  return out;
}

function newCode(): string {
  let code = makeRoomCode(rand);
  while (rooms.has(code)) code = makeRoomCode(rand);
  return code;
}

function quickRoom(map: string): Room {
  const open = [...rooms.values()].filter((r) => r.isPublic && !r.full && r.mapId === map).sort((a, b) => b.humanCount - a.humanCount);
  if (open[0]) return open[0];
  const room = new Room(newCode(), true, map, Math.floor(rand() * 1e9));
  rooms.set(room.code, room);
  return room;
}

const http = createServer((req, res) => {
  if (req.url === '/health') {
    const players = [...rooms.values()].reduce((s, r) => s + r.humanCount, 0);
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, players, protocol: PROTOCOL }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: http, maxPayload: 4096 });

wss.on('connection', (ws: WebSocket) => {
  let room: Room | null = null;
  let fighterId = -1;
  let budget = MAX_MSG_PER_SEC;
  const refill = setInterval(() => { budget = MAX_MSG_PER_SEC; }, 1000);

  const conn: Connection = {
    send(msg: ServerMsg) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); },
    close() { ws.close(); },
  };

  ws.on('message', (data) => {
    if (--budget < 0) return; // too many messages: ignore the extras
    let msg: ClientMsg;
    try { msg = JSON.parse(String(data)) as ClientMsg; } catch { return; }
    if (msg.t === 'join' && !room) {
      if (msg.v !== PROTOCOL) { conn.send({ t: 'error', message: 'Your game is out of date. Refresh the page.' }); return; }
      const map = msg.map === 'neon-yard' ? 'neon-yard' : 'blocktown';
      if (msg.mode === 'join') {
        const r = rooms.get(String(msg.code ?? '').toUpperCase());
        if (!r) { conn.send({ t: 'error', message: 'No room with that code.' }); return; }
        if (r.full) { conn.send({ t: 'error', message: 'That room is full.' }); return; }
        room = r;
      } else if (msg.mode === 'create') {
        if (rooms.size >= MAX_ROOMS) { conn.send({ t: 'error', message: 'The server is full right now. Try Quick Play.' }); return; }
        room = new Room(newCode(), false, map, Math.floor(rand() * 1e9));
        rooms.set(room.code, room);
      } else {
        room = quickRoom(map);
      }
      fighterId = room.join(conn, cleanName(msg.name), validLoadout(msg.loadout), validRarity(msg.rarity));
      return;
    }
    if (msg.t === 'in' && room && Array.isArray(msg.f) && msg.f.length === 6 && Number.isInteger(msg.s)) {
      room.input(fighterId, msg.s, decodeInput(msg));
    }
  });

  ws.on('close', () => {
    clearInterval(refill);
    room?.leave(fighterId);
  });
});

// The game loop: every room advances 60 times a second.
let last = performance.now();
let acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  while (acc >= 1 / TICK_RATE) {
    for (const room of rooms.values()) room.tick();
    acc -= 1 / TICK_RATE;
  }
  for (const [code, room] of rooms) if (room.abandoned) rooms.delete(code);
}, 1000 / TICK_RATE / 2);

http.listen(PORT, () => {
  console.log(`Blockfire server listening on :${PORT} (health: http://localhost:${PORT}/health)`);
});

export { rooms };
