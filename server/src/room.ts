/**
 * One online match. The server is in charge: it runs the shared Match simulation at 60 ticks
 * per second using the inputs players send, and tells everyone what happened 20 times a second.
 * Bots fill empty places so a room always has 8 fighters.
 */
import {
  BLOCKTOWN, Match, NEON_YARD, ROOM_SIZE, SLOTS, SNAPSHOT_EVERY, TICK_RATE, botLoadout, botName, botThink, createBrain,
  idleInput, makeRng, r3, type BotBrain, type Fighter, type FighterInput, type MapDef, type MatchEvent, type RarityId,
  type RosterEntry, type ServerMsg, type SnapFighter, type SnapMsg, type Loadout3,
} from '@blockfire/shared';

export interface Connection {
  send(msg: ServerMsg): void;
  close(): void;
}

interface Human {
  conn: Connection;
  fighterId: number;
  name: string;
  rarity: Record<string, RarityId>;
  queue: Array<{ seq: number; input: FighterInput }>;
  last: FighterInput;
  ack: number;
  /** Ticks in a row with no new input from this player. */
  starved: number;
}

const MAPS: Record<string, MapDef> = { blocktown: BLOCKTOWN, 'neon-yard': NEON_YARD };
const DT = 1 / TICK_RATE;
/** At most this many inputs wait in a player's queue (drops old ones if a player lags). */
const MAX_QUEUE = 6;
const RESTART_AFTER = 10;

export class Room {
  match!: Match;
  readonly humans = new Map<number, Human>();
  private brains = new Map<number, BotBrain>();
  private botRarity = new Map<number, Record<string, RarityId>>();
  private tickCount = 0;
  private events: MatchEvent[] = [];
  private rand: () => number;
  private overFor = 0;
  private botCounter = 0;
  private emptyFor = 0;

  constructor(readonly code: string, readonly isPublic: boolean, readonly mapId: string, seed: number) {
    this.rand = makeRng(seed);
    this.newMatch();
  }

  get map(): MapDef { return MAPS[this.mapId] ?? BLOCKTOWN; }
  get humanCount(): number { return this.humans.size; }
  get full(): boolean { return this.humans.size >= ROOM_SIZE; }
  /** True once a room has had nobody in it for a while (the server then deletes it). */
  get abandoned(): boolean { return this.humans.size === 0 && this.emptyFor > 30; }

  private newMatch(): void {
    const old = this.match;
    this.match = new Match(this.map, { scoreLimit: 30, timeLimit: 360 }, Math.floor(this.rand() * 1e9));
    this.brains.clear();
    this.botRarity.clear();
    this.overFor = 0;
    if (old) {
      // Keep everyone who is still connected, with the same id, in the new match.
      for (const h of this.humans.values()) {
        const f = old.byId(h.fighterId);
        if (f) this.match.addFighter(f.name, f.loadout, false, f.id);
      }
    }
    this.fillBots();
    this.match.events = [];
    this.broadcastRoster();
  }

  private fillBots(): void {
    while (this.match.fighters.length < ROOM_SIZE) {
      const f = this.match.addFighter(botName(this.botCounter++), botLoadout(this.rand), true);
      this.brains.set(f.id, createBrain('normal', Math.floor(this.rand() * 1e6)));
      this.botRarity.set(f.id, {});
    }
  }

  /** A player joins: they take a bot's place. */
  join(conn: Connection, name: string, loadout: Loadout3, rarity: Record<string, RarityId>): number {
    const bot = this.match.fighters.find((f) => f.isBot);
    if (bot) {
      this.match.removeFighter(bot.id);
      this.brains.delete(bot.id);
      this.botRarity.delete(bot.id);
    }
    const f = this.match.addFighter(this.uniqueName(name), loadout, false);
    this.humans.set(f.id, { conn, fighterId: f.id, name: f.name, rarity, queue: [], last: idleInput(), ack: 0, starved: 0 });
    conn.send({ t: 'welcome', id: f.id, code: this.code, map: this.mapId, scoreLimit: this.match.settings.scoreLimit, timeLimit: this.match.settings.timeLimit });
    this.broadcastRoster();
    return f.id;
  }

  private uniqueName(name: string): string {
    const taken = new Set(this.match.fighters.map((f) => f.name));
    if (!taken.has(name)) return name;
    for (let i = 2; i < 99; i++) if (!taken.has(`${name} ${i}`)) return `${name} ${i}`;
    return `${name} ${Math.floor(this.rand() * 1000)}`;
  }

  leave(fighterId: number): void {
    if (!this.humans.delete(fighterId)) return;
    this.match.removeFighter(fighterId);
    this.fillBots();
    this.broadcastRoster();
  }

  input(fighterId: number, seq: number, input: FighterInput): void {
    const h = this.humans.get(fighterId);
    if (!h || seq <= h.ack || (h.queue.length && seq <= h.queue[h.queue.length - 1]!.seq)) return;
    h.queue.push({ seq, input });
    while (h.queue.length > MAX_QUEUE) h.queue.shift();
  }

  /** Advance the room by one tick. */
  tick(): void {
    if (this.humans.size === 0) this.emptyFor += DT; else this.emptyFor = 0;
    if (this.match.over) {
      this.overFor += DT;
      if (this.overFor >= RESTART_AFTER) this.newMatch();
      else if (this.tickCount++ % SNAPSHOT_EVERY === 0) this.broadcastSnapshot();
      return;
    }
    const inputs = new Map<number, FighterInput>();
    for (const h of this.humans.values()) {
      const next = h.queue.shift();
      if (next) { h.last = next.input; h.ack = next.seq; h.starved = 0; } else h.starved += 1;
      // A late input: briefly keep doing what they were doing (smooths small network hiccups),
      // but after a few ticks stand still, so a frozen tab doesn't keep running and shooting.
      const held = { ...h.last, slot: undefined, reload: false };
      inputs.set(h.fighterId, next ? next.input : h.starved <= 6 ? held : { ...idleInput(), yaw: h.last.yaw, pitch: h.last.pitch });
    }
    for (const f of this.match.fighters) {
      const brain = this.brains.get(f.id);
      if (brain) inputs.set(f.id, botThink(this.match, f, brain, DT));
    }
    this.match.tick(DT, inputs);
    this.events.push(...this.match.events);
    this.match.events = [];
    if (++this.tickCount % SNAPSHOT_EVERY === 0) this.broadcastSnapshot();
  }

  private roster(): RosterEntry[] {
    return this.match.fighters.map((f) => ({
      id: f.id, name: f.name, bot: f.isBot, loadout: f.loadout,
      rarity: f.isBot ? this.botRarity.get(f.id) ?? {} : this.humans.get(f.id)?.rarity ?? {},
    }));
  }

  private broadcastRoster(): void {
    const msg: ServerMsg = { t: 'roster', list: this.roster() };
    for (const h of this.humans.values()) h.conn.send(msg);
  }

  private snapFighter(f: Fighter): SnapFighter {
    const p = f.p;
    return {
      id: f.id,
      p: [r3(p.pos.x), r3(p.pos.y), r3(p.pos.z), r3(p.vel.x), r3(p.vel.y), r3(p.vel.z)],
      a: [r3(f.yaw), r3(f.pitch)],
      hp: Math.round(f.hp),
      al: f.alive ? 1 : 0,
      sl: SLOTS.indexOf(f.slot) as 0 | 1 | 2,
      fl: (p.onGround ? 1 : 0) | (p.crouched ? 2 : 0) | (p.sliding ? 4 : 0) | (f.ads ? 8 : 0),
      pr: r3(f.protectLeft),
      k: f.kills,
      d: f.deaths,
      rs: r3(f.respawnIn),
      fa: r3(f.firedAt),
    };
  }

  private broadcastSnapshot(): void {
    const m = this.match;
    const fighters = m.fighters.map((f) => this.snapFighter(f));
    const pj = m.projectiles.map((q) => [q.id, q.weapon, r3(q.pos.x), r3(q.pos.y), r3(q.pos.z), r3(q.vel.x), r3(q.vel.y), r3(q.vel.z), q.stuck ? 1 : 0] as SnapMsg['pj'][number]);
    const ev = this.events;
    this.events = [];
    for (const h of this.humans.values()) {
      const me = m.byId(h.fighterId);
      const msg: SnapMsg = {
        t: 'snap', tick: this.tickCount, time: r3(m.time), ack: h.ack, f: fighters, pj, ev,
        over: m.over, winner: m.winner,
      };
      if (me) {
        msg.me = { ...me.p, pos: { ...me.p.pos }, vel: { ...me.p.vel } };
        msg.w = SLOTS.map((s) => [me.weapons[s].ammo, r3(me.weapons[s].reloadLeft)]) as SnapMsg['w'];
      }
      h.conn.send(msg);
    }
  }
}
