import * as THREE from 'three';
import {
  BLOCKTOWN, INPUTS_PER_MSG, NEON_YARD, PROTOCOL, SLOTS, WEAPON_BY_ID, encodeInput, stepPlayer,
  type FighterInput, type MapDef, type MatchEvent, type MoveInput, type PlayerState, type RarityId, type RosterEntry,
  type InputMsg, type ServerMsg, type SnapMsg, type JoinMode, type Slot,
} from '@blockfire/shared';
import { FfaGame, TICK } from './ffa.js';
import type { Input } from './input.js';
import type { Sfx } from './audio.js';
import type { Graphics } from './graphics.js';
import { rarityOf, type Loadout } from './loadout.js';
import type { Settings } from './settings.js';

/**
 * Where the game server lives. On the real site (Cloudflare) the server is the same Worker that
 * serves the page, so nothing needs setting. Overrides: ?server=wss://… in the address bar, or
 * VITE_SERVER_URL when building (for a separate server such as the Docker one).
 */
export function serverUrl(): string {
  const fromQuery = new URLSearchParams(location.search).get('server');
  if (fromQuery) return fromQuery;
  const fromBuild = (import.meta.env['VITE_SERVER_URL'] as string | undefined) ?? '';
  if (fromBuild) return fromBuild;
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  // `npm run dev` / `npm run preview` serve only the page: the server runs separately on 8787.
  if (local && (location.port === '5173' || location.port === '4173')) return 'ws://localhost:8787';
  if (location.protocol === 'https:') return `wss://${location.host}`;
  if (location.protocol === 'http:') return `ws://${location.host}`;
  return '';
}

/** The full WebSocket address for joining: the Cloudflare server routes on these query values. */
export function joinUrl(base: string, mode: JoinMode, code: string, map: string): string {
  const root = base.replace(/\/+$/, '').replace(/\/ws$/, '');
  const q = new URLSearchParams({ mode, map });
  if (mode === 'join') q.set('code', code);
  return `${root}/ws?${q}`;
}

export type NetStatus = 'connecting' | 'playing' | 'error' | 'closed';

interface Sample { t: number; x: number; y: number; z: number; yaw: number; pitch: number }

/** How far behind real time other players are drawn, so their movement is smooth. */
const INTERP_DELAY = 0.11;

/**
 * Free For All against real people. Your own movement is predicted instantly on your computer
 * (no waiting for the server), then corrected by the server's answer. Everyone else is drawn
 * a tenth of a second in the past so they glide smoothly between the server's 20 updates a second.
 */
export class OnlineGame extends FfaGame {
  status: NetStatus = 'connecting';
  error = '';
  code = '';
  ping = 0;
  private ws: WebSocket;
  private myId = -1;
  private seq = 0;
  private pending: Array<{ seq: number; input: FighterInput }> = [];
  private sentAt = new Map<number, number>();
  /** Inputs waiting to go out; they're sent INPUTS_PER_MSG at a time. */
  private outbox: InputMsg[] = [];
  private samples = new Map<number, Sample[]>();
  private roster = new Map<number, RosterEntry>();
  private correction = new THREE.Vector3();
  private localCooldown = 0;
  private localFirePrev = false;
  private lastSlotChange = -1;
  private clock = 0;

  constructor(
    map: MapDef, input: Input, sfx: Sfx, settings: () => Settings, graphics: Graphics, loadout: () => Loadout,
    url: string, mode: JoinMode, code: string, name: string,
  ) {
    super(map, input, sfx, settings, graphics, loadout, 'easy', 0);
    this.ownShotsPredicted = true;
    // Until the server says who's who, nobody is in the match.
    this.match.fighters.length = 0;
    this.ws = new WebSocket(joinUrl(url, mode, code, map.id));
    this.ws.onopen = () => {
      const l = loadout();
      const rarity: Record<string, RarityId> = {};
      for (const id of [l.primary, l.secondary, l.melee]) rarity[id] = rarityOf(l, id);
      this.ws.send(JSON.stringify({
        t: 'join', v: PROTOCOL, name, mode, code, map: map.id,
        loadout: { primary: l.primary, secondary: l.secondary, melee: l.melee }, rarity,
      }));
    };
    this.ws.onmessage = (e) => this.onServer(JSON.parse(String(e.data)) as ServerMsg);
    this.ws.onerror = () => { if (this.status === 'connecting') { this.status = 'error'; this.error = 'Could not reach the game server.'; } };
    this.ws.onclose = () => {
      if (this.status === 'playing') { this.status = 'closed'; this.error = 'Disconnected from the server.'; }
      else if (this.status === 'connecting') { this.status = 'error'; this.error ||= 'Could not reach the game server.'; }
    };
  }

  leave(): void {
    try { this.ws.close(); } catch { /* already closed */ }
  }

  protected rarityFor = (f: { id: number }, weaponId: string): RarityId => {
    if (f.id === this.myId) return rarityOf(this.loadout(), weaponId);
    return this.roster.get(f.id)?.rarity[weaponId] ?? 'basic';
  };

  // ---------------- Messages from the server ----------------

  private onServer(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome':
        this.myId = m.id;
        this.code = m.code;
        this.status = 'playing';
        this.match.settings.scoreLimit = m.scoreLimit;
        this.match.settings.timeLimit = m.timeLimit;
        break;
      case 'error':
        this.status = 'error';
        this.error = m.message;
        this.leave();
        break;
      case 'roster':
        this.applyRoster(m.list);
        break;
      case 'snap':
        this.applySnapshot(m);
        break;
    }
  }

  private applyRoster(list: RosterEntry[]): void {
    this.roster = new Map(list.map((r) => [r.id, r]));
    const keep = new Set(list.map((r) => r.id));
    for (const f of [...this.match.fighters]) if (!keep.has(f.id)) this.match.removeFighter(f.id);
    for (const r of list) {
      if (!this.match.byId(r.id)) this.match.addFighter(r.name, r.loadout, r.bot, r.id);
    }
    this.match.events = [];
    const me = this.match.byId(this.myId);
    if (me) {
      this.me = me;
      me.name = 'You';
      this.refreshWeapon();
    }
  }

  private applySnapshot(s: SnapMsg): void {
    const now = this.clock;
    this.match.time = s.time;
    this.match.over = s.over;
    this.match.winner = s.winner;
    for (const sf of s.f) {
      const f = this.match.byId(sf.id);
      if (!f) continue;
      const wasAlive = f.alive;
      f.hp = sf.hp;
      f.alive = sf.al === 1;
      f.kills = sf.k;
      f.deaths = sf.d;
      f.respawnIn = sf.rs;
      f.protectLeft = sf.pr;
      f.firedAt = sf.fa;
      f.ads = (sf.fl & 8) !== 0;
      if (sf.id === this.myId) {
        // Weapon slot: trust the server unless we just switched (our switch is still on its way).
        if (this.clock - this.lastSlotChange > 0.4 && f.slot !== SLOTS[sf.sl]) { f.slot = SLOTS[sf.sl]!; this.refreshWeapon(); }
        if (!wasAlive && f.alive) {
          this.pending = [];
          f.yaw = sf.a[0];
        }
        continue;
      }
      f.slot = SLOTS[sf.sl]!;
      f.yaw = sf.a[0];
      f.pitch = sf.a[1];
      f.p.vel = { x: sf.p[3], y: sf.p[4], z: sf.p[5] };
      f.p.onGround = (sf.fl & 1) !== 0;
      f.p.crouched = (sf.fl & 2) !== 0;
      f.p.sliding = (sf.fl & 4) !== 0;
      let buf = this.samples.get(f.id);
      if (!buf) { buf = []; this.samples.set(f.id, buf); }
      // A respawn is a teleport: don't glide across the map.
      if (!wasAlive && f.alive) buf.length = 0;
      buf.push({ t: now, x: sf.p[0], y: sf.p[1], z: sf.p[2], yaw: sf.a[0], pitch: sf.a[1] });
      while (buf.length > 30) buf.shift();
    }

    // Your movement: take the server's answer, then replay the inputs it hasn't seen yet.
    const me = this.match.byId(this.myId);
    if (me && s.me) {
      const before = new THREE.Vector3(me.p.pos.x, me.p.pos.y, me.p.pos.z);
      Object.assign(me.p, structuredClone(s.me));
      const sent = this.sentAt.get(s.ack);
      if (sent !== undefined) this.ping = this.ping * 0.8 + (this.clock - sent) * 1000 * 0.2;
      for (const k of this.sentAt.keys()) if (k <= s.ack) this.sentAt.delete(k);
      this.pending = this.pending.filter((p) => p.seq > s.ack);
      if (me.alive) for (const p of this.pending) stepPlayer(me.p, this.moveInput(p.input), this.match.map, TICK);
      const after = new THREE.Vector3(me.p.pos.x, me.p.pos.y, me.p.pos.z);
      const err = before.sub(after);
      // Small mismatches are smoothed out over a few frames; big ones (respawn, knockback) snap.
      if (err.length() < 2) this.correction.add(err); else this.correction.set(0, 0, 0);
      this.prevPos = { ...me.p.pos };
      if (s.w) SLOTS.forEach((slot, i) => { me.weapons[slot].ammo = s.w![i]![0]; me.weapons[slot].reloadLeft = s.w![i]![1]; });
    }

    // Projectiles: draw exactly what the server has.
    this.match.projectiles.length = 0;
    for (const q of s.pj) {
      this.match.projectiles.push({
        id: q[0], owner: -1, weapon: q[1], pos: { x: q[2], y: q[3], z: q[4] }, vel: { x: q[5], y: q[6], z: q[7] },
        life: 1, stuckTo: null, stuck: q[8] === 1, fuse: 0,
      });
    }

    for (const e of s.ev) this.onServerEvent(e);
  }

  private onServerEvent(e: MatchEvent): void {
    const mine = (id: number) => id === this.myId;
    if (e.type === 'move' && mine(e.id)) return; // we already played these when we predicted the move
    if (e.type === 'swing' && mine(e.id)) { if (e.hit) this.sfx.stab(); return; }
    if (e.type === 'over') { this.sfx.finish(); this.input.unlock(); return; }
    this.onEvent(e);
  }

  // ---------------- Every tick ----------------

  private moveInput(i: FighterInput): MoveInput {
    const me = this.me;
    const w = WEAPON_BY_ID[me.loadout[i.slot ?? me.slot]] ?? this.match.weaponOf(me);
    return { ...i, wallJump: !!w.wallJump, speedMul: w.moveSpeed * (i.ads && w.zoom > 0 ? 0.75 : 1) };
  }

  protected tick(): void {
    this.clock += TICK;
    this.time += TICK;
    if (this.status !== 'playing' || this.myId < 0 || !this.match.byId(this.myId)) return;
    const me = this.me;

    const slot = this.wantSlot;
    this.wantSlot = undefined;
    const mine: FighterInput = {
      forward: (this.input.held('forward') ? 1 : 0) - (this.input.held('back') ? 1 : 0),
      strafe: (this.input.held('right') ? 1 : 0) - (this.input.held('left') ? 1 : 0),
      jump: this.input.held('jump'),
      crouch: this.input.held('crouch'),
      walk: this.input.held('walk'),
      yaw: this.input.yaw,
      pitch: this.input.pitch,
      wallJump: false,
      speedMul: 1,
      fire: this.input.held('fire'),
      ads: this.input.held('aim'),
      reload: this.input.held('reload'),
      slot: slot as Slot | undefined,
    };
    const seq = ++this.seq;
    this.outbox.push(encodeInput(seq, mine));
    if (this.outbox.length >= INPUTS_PER_MSG) {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'ib', i: this.outbox }));
      this.outbox = [];
    }
    this.sentAt.set(seq, this.clock);

    if (slot && slot !== me.slot) {
      me.slot = slot;
      this.lastSlotChange = this.clock;
      this.sfx.click();
      this.refreshWeapon();
    }

    if (me.alive) {
      this.prevPos = { ...me.p.pos };
      me.yaw = mine.yaw;
      me.pitch = mine.pitch;
      me.ads = mine.ads && this.match.weaponOf(me).zoom > 0;
      const { events } = stepPlayer(me.p, this.moveInput(mine), this.match.map, TICK);
      for (const ev of events) this.onEvent({ type: 'move', id: this.myId, event: ev });
      this.pending.push({ seq, input: mine });
      this.predictShot(mine);
    }

    // Other players: glide between the server's updates.
    const renderAt = this.clock - INTERP_DELAY;
    for (const f of this.match.fighters) {
      if (f.id === this.myId) continue;
      const buf = this.samples.get(f.id);
      if (!buf || buf.length === 0) continue;
      let a = buf[0]!, b = buf[buf.length - 1]!;
      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i]!.t <= renderAt && buf[i + 1]!.t >= renderAt) { a = buf[i]!; b = buf[i + 1]!; break; }
      }
      const k = b.t > a.t ? Math.max(0, Math.min(1, (renderAt - a.t) / (b.t - a.t))) : 1;
      f.p.pos = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
      let dy = b.yaw - a.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      f.yaw = a.yaw + dy * k;
      f.pitch = a.pitch + (b.pitch - a.pitch) * k;
    }

    for (const f of this.feed) f.age += TICK;
    this.feed = this.feed.filter((f) => f.age < 6).slice(-6);
  }

  /** Show your shot instantly (sound, recoil, flash); the server decides whether it hit. */
  private predictShot(i: FighterInput): void {
    const me = this.me;
    const w = this.match.weaponOf(me);
    const ws = me.weapons[me.slot];
    this.localCooldown = Math.max(0, this.localCooldown - TICK);
    const fresh = i.fire && !this.localFirePrev;
    this.localFirePrev = i.fire;
    if (!i.fire || this.localCooldown > 0 || ws.reloadLeft > 0) return;
    const auto = w.rpm >= 400 || w.slot === 'melee' || w.id === 'super_pistols';
    if (!auto && !fresh) return;
    this.localCooldown = 60 / w.rpm;
    if (w.slot === 'melee') { this.sfx.swing(); this.viewmodel.fire(0); return; }
    if (ws.ammo <= 0) return;
    ws.ammo -= 1;
    this.sfx.shot(w.id, { vol: 0.9 });
    this.kick(w);
    this.effects.muzzle(this.viewmodel.muzzleWorld(new THREE.Vector3()));
  }

  protected render(alpha: number, dt: number): void {
    // Fade out any correction from the server so you never see a jump.
    this.correction.multiplyScalar(Math.pow(0.0005, dt));
    const me = this.me;
    if (me && me.alive && this.correction.lengthSq() > 1e-6) {
      me.p.pos.x += this.correction.x; me.p.pos.y += this.correction.y; me.p.pos.z += this.correction.z;
      this.prevPos.x += this.correction.x; this.prevPos.y += this.correction.y; this.prevPos.z += this.correction.z;
      super.render(alpha, dt);
      me.p.pos.x -= this.correction.x; me.p.pos.y -= this.correction.y; me.p.pos.z -= this.correction.z;
      this.prevPos.x -= this.correction.x; this.prevPos.y -= this.correction.y; this.prevPos.z -= this.correction.z;
      return;
    }
    super.render(alpha, dt);
  }
}

export function mapById(id: string): MapDef {
  return id === 'neon-yard' ? NEON_YARD : BLOCKTOWN;
}

export type { PlayerState };
