/**
 * One online match. The server is in charge: it runs the shared Match simulation at 60 ticks
 * per second using the inputs players send, and tells everyone what happened 20 times a second.
 * Bots fill empty places so a room always has 8 fighters.
 */
import {
  BLOCKTOWN, MODE_BY_ID, Match, NEON_YARD, ROOM_SIZE, SLOTS, SNAPSHOT_EVERY, TICK_RATE, botLoadout, botName, botThink,
  createBrain, filterChat, idleInput, makeRng, r3, type BotBrain, type BotDifficulty, type Fighter, type FighterInput,
  type GameRules, type MapDef, type MatchEvent, type ModeId, type RarityId, type RosterEntry, type ServerMsg,
  type SnapFighter, type SnapMsg, type Loadout3,
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

export type ChatResult = 'ok' | 'muted' | 'empty';

const MAPS: Record<string, MapDef> = { blocktown: BLOCKTOWN, 'neon-yard': NEON_YARD };
const DT = 1 / TICK_RATE;
/** At most this many inputs wait in a player's queue (drops old ones if a player lags). */
const MAX_QUEUE = 6;
const RESTART_AFTER = 10;
/** Lag compensation never looks back further than this many ticks (0.3 s). */
const MAX_VIEW_DELAY = 18;
/** Reports from this many different players mute someone's chat for the rest of the room. */
const MUTE_AFTER_REPORTS = 2;

/** A room's rules with every value filled in and checked. */
export interface RoomRules { mode: ModeId; scoreLimit: number; timeLimit: number; bots: boolean; botLevel: BotDifficulty }

export function cleanRules(raw: Partial<GameRules> | undefined, custom: boolean): RoomRules {
  const mode = raw?.mode && raw.mode in MODE_BY_ID ? raw.mode : 'ffa';
  const def = MODE_BY_ID[mode];
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.max(lo, Math.min(hi, v))) : d);
  const levels = ['easy', 'normal', 'hard', 'insane'];
  if (!custom) return { mode, scoreLimit: def.scoreLimit, timeLimit: def.timeLimit, bots: true, botLevel: 'normal' };
  return {
    mode,
    // Gun Game always means "finish the ladder".
    scoreLimit: mode === 'gungame' ? def.scoreLimit : num(raw?.scoreLimit, 1, 200, def.scoreLimit),
    timeLimit: num(raw?.timeLimit, 60, 1800, def.timeLimit),
    bots: raw?.bots !== false,
    botLevel: levels.includes(String(raw?.botLevel)) ? (raw!.botLevel as BotDifficulty) : 'normal',
  };
}

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
  /** Who reported whom: target name → reporter names (names survive a new match; ids don't matter here). */
  private reports = new Map<string, Set<string>>();
  readonly rules: RoomRules;

  constructor(readonly code: string, readonly isPublic: boolean, readonly mapId: string, seed: number, rules?: RoomRules) {
    this.rand = makeRng(seed);
    this.rules = rules ?? cleanRules(undefined, false);
    this.newMatch();
  }

  get mode(): ModeId { return this.rules.mode; }

  get map(): MapDef { return MAPS[this.mapId] ?? BLOCKTOWN; }
  get humanCount(): number { return this.humans.size; }
  get full(): boolean { return this.humans.size >= ROOM_SIZE; }
  /** True once a room has had nobody in it for a while (the server then deletes it). */
  get abandoned(): boolean { return this.humans.size === 0 && this.emptyFor > 30; }

  private newMatch(): void {
    const old = this.match;
    this.match = new Match(this.map, {
      scoreLimit: this.rules.scoreLimit, timeLimit: this.rules.timeLimit, mode: this.rules.mode, lagComp: true,
    }, Math.floor(this.rand() * 1e9));
    this.brains.clear();
    this.botRarity.clear();
    this.overFor = 0;
    if (old) {
      // Keep everyone who is still connected, with the same id, in the new match.
      for (const h of this.humans.values()) {
        const f = old.byId(h.fighterId);
        if (f) this.match.addFighter(f.name, f.picked, false, f.id);
      }
    }
    this.fillBots();
    this.match.events = [];
    this.broadcastRoster();
  }

  private fillBots(): void {
    if (!this.rules.bots) return;
    while (this.match.fighters.length < ROOM_SIZE) {
      const f = this.match.addFighter(botName(this.botCounter++), botLoadout(this.rand), true);
      this.brains.set(f.id, createBrain(this.rules.botLevel, Math.floor(this.rand() * 1e6)));
      this.botRarity.set(f.id, {});
    }
  }

  /** A player joins: they take a bot's place. */
  join(conn: Connection, name: string, loadout: Loadout3, rarity: Record<string, RarityId>): number {
    // Take a bot's place: in Team Deathmatch, one from the bigger team, so teams stay even.
    const big = this.match.teams ? (this.match.smallerTeam() === 1 ? 2 : 1) : 0;
    const bot = this.match.fighters.find((f) => f.isBot && (!big || f.team === big)) ?? this.match.fighters.find((f) => f.isBot);
    if (bot) {
      this.match.removeFighter(bot.id);
      this.brains.delete(bot.id);
      this.botRarity.delete(bot.id);
    }
    const f = this.match.addFighter(this.uniqueName(name), loadout, false);
    this.humans.set(f.id, { conn, fighterId: f.id, name: f.name, rarity, queue: [], last: idleInput(), ack: 0, starved: 0 });
    conn.send({
      t: 'welcome', id: f.id, code: this.code, map: this.mapId, scoreLimit: this.match.settings.scoreLimit,
      timeLimit: this.match.settings.timeLimit, mode: this.rules.mode, isPublic: this.isPublic,
    });
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

  /** How late this player sees everyone else (ticks), for lag compensation. */
  setViewDelay(fighterId: number, ticks: number): void {
    const f = this.match.byId(fighterId);
    if (f && Number.isFinite(ticks)) f.viewDelay = Math.max(0, Math.min(MAX_VIEW_DELAY, Math.round(ticks)));
  }

  /** A chat line from a player. Team chat only reaches teammates (in Team Deathmatch). */
  chat(fighterId: number, raw: unknown, teamOnly: boolean): ChatResult {
    const h = this.humans.get(fighterId);
    const f = this.match.byId(fighterId);
    if (!h || !f) return 'empty';
    const text = filterChat(raw);
    if (!text) return 'empty';
    const team = teamOnly && this.match.teams;
    const msg: ServerMsg = { t: 'chat', id: f.id, name: f.name, text, team };
    if ((this.reports.get(f.name)?.size ?? 0) >= MUTE_AFTER_REPORTS) {
      h.conn.send(msg); // a muted player still sees their own message, so they don't just spam it again
      return 'muted';
    }
    for (const o of this.humans.values()) {
      if (team && this.match.byId(o.fighterId)?.team !== f.team) continue;
      o.conn.send(msg);
    }
    return 'ok';
  }

  /** A player reports another. Logged for the admins; enough reports mute the player's chat here. */
  report(fighterId: number, targetId: number, reason: unknown): void {
    const from = this.match.byId(fighterId);
    const target = this.match.byId(targetId);
    if (!from || !target || target.isBot || from === target) return;
    const set = this.reports.get(target.name) ?? new Set<string>();
    set.add(from.name);
    this.reports.set(target.name, set);
    console.log(JSON.stringify({ kind: 'report', room: this.code, from: from.name, target: target.name, reason: String(reason ?? '').slice(0, 60), count: set.size }));
    this.humans.get(fighterId)?.conn.send({ t: 'chat', id: -1, name: 'Server', text: `Thanks, your report on ${target.name} was sent.`, team: false });
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
      id: f.id, name: f.name, bot: f.isBot, loadout: f.picked, team: f.team,
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
      ...(this.match.mode === 'gungame' ? { lv: f.level } : {}),
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
        ...(m.teams ? { ts: [m.teamScore[1]!, m.teamScore[2]!] as [number, number], wt: m.winnerTeam } : {}),
      };
      if (me) {
        msg.me = { ...me.p, pos: { ...me.p.pos }, vel: { ...me.p.vel } };
        msg.w = SLOTS.map((s) => [me.weapons[s].ammo, r3(me.weapons[s].reloadLeft)]) as SnapMsg['w'];
      }
      h.conn.send(msg);
    }
  }
}
