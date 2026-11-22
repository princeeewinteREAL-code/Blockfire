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
import { PROTOCOL, TICK_RATE, makeRng, makeRoomCode, type JoinMsg, type ServerMsg } from '@blockfire/shared';
import { Room, type Connection } from './room.js';
import { MAX_MSG_BYTES, Session, cleanCode, cleanMap } from './session.js';

const PORT = Number(process.env['PORT'] ?? 8787);
const rand = makeRng(Date.now() & 0xffffffff);
const rooms = new Map<string, Room>();
const MAX_ROOMS = 50;

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

function pickRoom(msg: JoinMsg): Room | string {
  const map = cleanMap(msg.map);
  if (msg.mode === 'join') {
    const r = rooms.get(cleanCode(msg.code));
    if (!r) return 'No room with that code.';
    if (r.full) return 'That room is full.';
    return r;
  }
  if (msg.mode === 'create') {
    if (rooms.size >= MAX_ROOMS) return 'The server is full right now. Try Quick Play.';
    const room = new Room(newCode(), false, map, Math.floor(rand() * 1e9));
    rooms.set(room.code, room);
    return room;
  }
  return quickRoom(map);
}

const http = createServer((req, res) => {
  if (req.url?.split('?')[0] === '/health') {
    const players = [...rooms.values()].reduce((s, r) => s + r.humanCount, 0);
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, players, protocol: PROTOCOL }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: http, maxPayload: MAX_MSG_BYTES });

wss.on('connection', (ws: WebSocket) => {
  const conn: Connection = {
    send(msg: ServerMsg) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); },
    close() { ws.close(); },
  };
  const session = new Session(conn, pickRoom);
  ws.on('message', (data) => session.onMessage(String(data)));
  ws.on('close', () => session.onClose());
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
