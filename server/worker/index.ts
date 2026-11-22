/**
 * Blockfire on Cloudflare: the game page and the online server in one free Worker.
 *
 *   /            the game (static files from client/dist)
 *   /ws          join a match (WebSocket). Query: mode=quick|create|join, map, code
 *   /health      {"ok":true, rooms, players, protocol}
 *
 * Every room is its own Durable Object (GameRoom), named by its room code, running the same
 * Room code as the Node server at 60 ticks a second. One Lobby object keeps the list of public
 * rooms for Quick Play and hands out new codes.
 *
 * Free-plan budget: incoming WebSocket messages count 20 to 1 against 100,000 requests a day.
 * Each player sends 30 messages a second, so that's about 18 player-hours of play per day.
 * If it's ever used up, joining fails until the daily reset (08:00 Malaysia time) — never a bill.
 */
import { DurableObject } from 'cloudflare:workers';
import { PROTOCOL, ROOM_SIZE, TICK_RATE, makeRng, makeRoomCode, type ServerMsg } from '@blockfire/shared';
import { Room, type Connection } from '../src/room.js';
import { MAX_MSG_BYTES, Session, cleanCode, cleanMap } from '../src/session.js';

export interface Env {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace<GameRoom>;
  LOBBY: DurableObjectNamespace<Lobby>;
}

type Mode = 'quick' | 'create' | 'join';

/** Most rooms at once (each room is one Durable Object). */
const MAX_ROOMS = 100;
/** A room the Lobby hasn't heard from for this long is forgotten. */
const STALE_MS = 120_000;

interface RoomInfo { map: string; isPublic: boolean; humans: number; seen: number }

export class Lobby extends DurableObject<Env> {
  private rooms = new Map<string, RoomInfo>();
  private rand = makeRng(Date.now() & 0xffffffff);

  private prune(): void {
    const now = Date.now();
    for (const [code, r] of this.rooms) if (now - r.seen > STALE_MS) this.rooms.delete(code);
  }

  private newCode(): string {
    let code = makeRoomCode(this.rand);
    while (this.rooms.has(code)) code = makeRoomCode(this.rand);
    return code;
  }

  /** Which room a Quick Play or Create should go to. Counts the player in right away so two quick joins don't overfill a room. */
  assign(mode: 'quick' | 'create', map: string): { code: string } | { error: string } {
    this.prune();
    if (mode === 'quick') {
      const open = [...this.rooms.entries()]
        .filter(([, r]) => r.isPublic && r.map === map && r.humans < ROOM_SIZE)
        .sort((a, b) => b[1].humans - a[1].humans)[0];
      if (open) { open[1].humans += 1; return { code: open[0] }; }
    }
    if (this.rooms.size >= MAX_ROOMS) return { error: 'The server is full right now. Try again in a minute.' };
    const code = this.newCode();
    this.rooms.set(code, { map, isPublic: mode === 'quick', humans: 1, seen: Date.now() });
    return { code };
  }

  /** Rooms report how many people they have; 0 with closed=true removes the room. */
  report(code: string, map: string, isPublic: boolean, humans: number, closed: boolean): void {
    if (closed) { this.rooms.delete(code); return; }
    this.rooms.set(code, { map, isPublic, humans, seen: Date.now() });
  }

  stats(): { ok: true; rooms: number; players: number; protocol: number } {
    this.prune();
    let players = 0;
    for (const r of this.rooms.values()) players += r.humans;
    return { ok: true, rooms: this.rooms.size, players, protocol: PROTOCOL };
  }
}

export class GameRoom extends DurableObject<Env> {
  private room: Room | null = null;
  private loop: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private acc = 0;
  private reportTimer = 0;

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const mode = (url.searchParams.get('mode') ?? 'quick') as Mode;
    const code = cleanCode(url.searchParams.get('code'));
    const map = cleanMap(url.searchParams.get('map'));
    const isPublic = url.searchParams.get('public') === '1';

    const pair = new WebSocketPair();
    const client = pair[0];
    const socket = pair[1];
    socket.accept();

    const conn: Connection = {
      send(msg: ServerMsg) { try { socket.send(JSON.stringify(msg)); } catch { /* closed */ } },
      close() { try { socket.close(1000, 'bye'); } catch { /* closed */ } },
    };

    if (!this.room && mode !== 'join') {
      this.room = new Room(code, isPublic, map, Math.floor(Math.random() * 1e9));
    }

    const session = new Session(conn, () => {
      if (!this.room) return 'No room with that code.';
      if (this.room.full) return 'That room is full.';
      return this.room;
    }, () => { this.start(); this.report(); });

    socket.addEventListener('message', (e) => {
      if (typeof e.data === 'string' && e.data.length <= MAX_MSG_BYTES) session.onMessage(e.data);
    });
    const gone = () => { session.onClose(); this.report(); };
    socket.addEventListener('close', gone);
    socket.addEventListener('error', gone);

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Run the room 60 times a second while anyone is (or was recently) in it. */
  private start(): void {
    if (this.loop) return;
    this.last = Date.now();
    this.acc = 0;
    this.loop = setInterval(() => this.step(), 1000 / TICK_RATE / 2);
  }

  private step(): void {
    const room = this.room;
    if (!room) return this.stop();
    const now = Date.now();
    this.acc += Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    while (this.acc >= 1 / TICK_RATE) {
      room.tick();
      this.acc -= 1 / TICK_RATE;
    }
    if (room.abandoned) {
      this.report(true);
      this.room = null;
      this.stop();
      return;
    }
    if (now - this.reportTimer > 30_000) this.report();
  }

  private stop(): void {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  private report(closed = false): void {
    const room = this.room;
    if (!room) return;
    this.reportTimer = Date.now();
    const lobby = this.env.LOBBY.getByName('lobby');
    this.ctx.waitUntil(lobby.report(room.code, room.mapId, room.isPublic, room.humanCount, closed).catch(() => {}));
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      const stats = await env.LOBBY.getByName('lobby').stats();
      return Response.json(stats, { headers: { 'access-control-allow-origin': '*' } });
    }

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const m = url.searchParams.get('mode');
      const mode: Mode = m === 'create' || m === 'join' ? m : 'quick';
      const map = cleanMap(url.searchParams.get('map'));
      let code = cleanCode(url.searchParams.get('code'));
      if (mode !== 'join') {
        const got = await env.LOBBY.getByName('lobby').assign(mode, map);
        if ('error' in got) return refuse(got.error);
        code = got.code;
      } else if (code.length !== 6) {
        return refuse('No room with that code.');
      }
      const target = new URL(request.url);
      target.search = new URLSearchParams({ mode, map, code, public: mode === 'quick' ? '1' : '0' }).toString();
      return env.ROOMS.getByName(code).fetch(new Request(target, request));
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

/** Accept the WebSocket just long enough to tell the player why they can't join. */
function refuse(message: string): Response {
  const pair = new WebSocketPair();
  pair[1].accept();
  pair[1].send(JSON.stringify({ t: 'error', message } satisfies ServerMsg));
  pair[1].close(1000, 'refused');
  return new Response(null, { status: 101, webSocket: pair[0] });
}
