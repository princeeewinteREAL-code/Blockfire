/**
 * A Free For All match: every player, every bullet, every explosion.
 * This is pure game logic with no graphics, so the browser runs it today (you vs bots)
 * and the Phase 3 server will run the exact same code for online matches.
 */
import {
  aimDirection, ballisticsOf, damageAt, hitboxes, lineOfSight, makeRng, newWeaponState, pointInMap,
  rayAabb, rayMap, spreadDirection, startReload, tickWeapon, type WeaponState,
} from './combat.js';
import { inLava, type MapDef } from './map.js';
import { MOVEMENT } from './movement-config.js';
import { createPlayer, emptyInput, eyeHeight, playerHeight, stepPlayer, type MoveEvent, type MoveInput, type PlayerState, type Vec3 } from './movement.js';
import { WEAPON_BY_ID, type Slot, type WeaponDef } from './weapons.js';

export const MAX_HP = 100;
export const RESPAWN_SEC = 3;
export const SPAWN_PROTECT_SEC = 2;
export const REGEN_DELAY = 5;
export const REGEN_PER_SEC = 25;
export const SWAP_SEC = 0.25;

export interface Loadout3 { primary: string; secondary: string; melee: string }

export interface FighterInput extends MoveInput {
  pitch: number;
  fire: boolean;
  ads: boolean;
  reload: boolean;
  slot?: Slot;
}

export function idleInput(): FighterInput {
  return { ...emptyInput(), pitch: 0, fire: false, ads: false, reload: false };
}

export interface Fighter {
  id: number;
  name: string;
  isBot: boolean;
  p: PlayerState;
  yaw: number;
  pitch: number;
  hp: number;
  alive: boolean;
  respawnIn: number;
  protectLeft: number;
  sinceHurt: number;
  kills: number;
  deaths: number;
  streak: number;
  boostLeft: number;
  loadout: Loadout3;
  slot: Slot;
  swapLeft: number;
  weapons: Record<Slot, WeaponState>;
  ads: boolean;
  firePrev: boolean;
  lastKiller: number | null;
  /** Visual-only: last time this fighter fired (for muzzle flashes / animation). */
  firedAt: number;
}

export interface Projectile {
  id: number;
  owner: number;
  weapon: string;
  pos: Vec3;
  vel: Vec3;
  life: number;
  stuckTo: number | null;
  stuck: boolean;
  fuse: number;
}

export type MatchEvent =
  | { type: 'shot'; shooter: number; weapon: string; from: Vec3; to: Vec3; hit: boolean }
  | { type: 'hit'; attacker: number; victim: number; damage: number; head: boolean; at: Vec3 }
  | { type: 'kill'; killer: number; victim: number; weapon: string; head: boolean; streak: number }
  | { type: 'explode'; pos: Vec3; radius: number; weapon: string }
  | { type: 'impact'; pos: Vec3; weapon: string }
  | { type: 'swing'; id: number; weapon: string; hit: boolean }
  | { type: 'reload'; id: number; weapon: string }
  | { type: 'empty'; id: number }
  | { type: 'respawn'; id: number }
  | { type: 'move'; id: number; event: MoveEvent }
  | { type: 'over'; winner: number };

export interface MatchSettings {
  scoreLimit: number;
  timeLimit: number;
}

export class Match {
  readonly fighters: Fighter[] = [];
  readonly projectiles: Projectile[] = [];
  events: MatchEvent[] = [];
  time = 0;
  over = false;
  winner: number | null = null;
  private nextId = 1;
  private nextProj = 1;
  private rand: () => number;

  constructor(readonly map: MapDef, readonly settings: MatchSettings = { scoreLimit: 30, timeLimit: 360 }, seed = 12345) {
    this.rand = makeRng(seed);
  }

  addFighter(name: string, loadout: Loadout3, isBot: boolean): Fighter {
    const id = this.nextId++;
    const f: Fighter = {
      id, name, isBot,
      p: createPlayer({ x: 0, y: 0, z: 0 }),
      yaw: 0, pitch: 0, hp: MAX_HP, alive: false, respawnIn: 0, protectLeft: 0, sinceHurt: 99,
      kills: 0, deaths: 0, streak: 0, boostLeft: 0,
      loadout, slot: 'primary', swapLeft: 0,
      weapons: {
        primary: newWeaponState(WEAPON_BY_ID[loadout.primary]!),
        secondary: newWeaponState(WEAPON_BY_ID[loadout.secondary]!),
        melee: newWeaponState(WEAPON_BY_ID[loadout.melee]!),
      },
      ads: false, firePrev: false, lastKiller: null, firedAt: -99,
    };
    this.fighters.push(f);
    this.spawn(f);
    return f;
  }

  byId(id: number): Fighter | undefined {
    return this.fighters.find((f) => f.id === id);
  }

  weaponOf(f: Fighter): WeaponDef {
    return WEAPON_BY_ID[f.loadout[f.slot]]!;
  }

  eye(f: Fighter): Vec3 {
    return { x: f.p.pos.x, y: f.p.pos.y + eyeHeight(f.p), z: f.p.pos.z };
  }

  /** Spawn at the spawn point farthest from living enemies. */
  private spawn(f: Fighter): void {
    const spawns = this.map.spawns?.length ? this.map.spawns : [this.map.spawn];
    let best = spawns[0]!;
    let bestScore = -Infinity;
    for (const s of spawns) {
      let nearest = 999;
      for (const o of this.fighters) {
        if (o === f || !o.alive) continue;
        nearest = Math.min(nearest, Math.hypot(o.p.pos.x - s.pos[0], o.p.pos.z - s.pos[2]));
      }
      const score = nearest + this.rand() * 4;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    f.p = createPlayer({ x: best.pos[0], y: best.pos[1], z: best.pos[2] });
    f.yaw = best.yaw;
    f.pitch = 0;
    f.hp = MAX_HP;
    f.alive = true;
    f.protectLeft = SPAWN_PROTECT_SEC;
    f.sinceHurt = 99;
    f.slot = 'primary';
    f.swapLeft = 0;
    for (const slot of ['primary', 'secondary', 'melee'] as Slot[]) f.weapons[slot] = newWeaponState(WEAPON_BY_ID[f.loadout[slot]]!);
    this.events.push({ type: 'respawn', id: f.id });
  }

  /** Advance the whole match by one fixed tick. */
  tick(dt: number, inputs: Map<number, FighterInput>): void {
    if (this.over) return;
    this.time += dt;
    for (const f of this.fighters) this.tickFighter(f, inputs.get(f.id) ?? idleInput(), dt);
    this.tickProjectiles(dt);

    const leader = [...this.fighters].sort((a, b) => b.kills - a.kills)[0];
    if (leader && (leader.kills >= this.settings.scoreLimit || this.time >= this.settings.timeLimit)) {
      this.over = true;
      this.winner = leader.id;
      this.events.push({ type: 'over', winner: leader.id });
    }
  }

  private tickFighter(f: Fighter, input: FighterInput, dt: number): void {
    if (!f.alive) {
      f.respawnIn -= dt;
      if (f.respawnIn <= 0) this.spawn(f);
      return;
    }
    f.yaw = input.yaw;
    f.pitch = Math.max(-1.55, Math.min(1.55, input.pitch));

    // Weapon swap.
    if (input.slot && input.slot !== f.slot) {
      f.slot = input.slot;
      f.swapLeft = SWAP_SEC;
      f.weapons[f.slot].burstLeft = 0;
    }
    f.swapLeft = Math.max(0, f.swapLeft - dt);

    const w = this.weaponOf(f);
    const ws = f.weapons[f.slot];
    for (const slot of ['primary', 'secondary', 'melee'] as Slot[]) {
      const def = WEAPON_BY_ID[f.loadout[slot]]!;
      // Only the weapon in your hand reloads.
      const s = f.weapons[slot];
      if (slot !== f.slot) { s.cooldown = Math.max(0, s.cooldown - dt); continue; }
      if (tickWeapon(def, s, dt)) { /* reload finished */ }
    }
    if (input.reload && startReload(w, ws)) this.events.push({ type: 'reload', id: f.id, weapon: w.id });

    f.ads = input.ads && w.zoom > 0 && ws.reloadLeft <= 0 && f.swapLeft <= 0;

    // Movement (weapon speed, aiming slows you, killstreak boost).
    f.boostLeft = Math.max(0, f.boostLeft - dt);
    const move: MoveInput = {
      ...input,
      wallJump: !!w.wallJump,
      speedMul: w.moveSpeed * (f.ads ? 0.75 : 1) * (f.boostLeft > 0 ? 1.1 : 1),
    };
    const { events } = stepPlayer(f.p, move, this.map, dt);
    for (const e of events) this.events.push({ type: 'move', id: f.id, event: e });

    // Firing.
    const wantsFire = input.fire;
    const fresh = wantsFire && !f.firePrev;
    f.firePrev = wantsFire;
    if (f.swapLeft <= 0 && ws.reloadLeft <= 0) {
      if (ws.burstLeft > 0 && ws.burstTimer <= 0) {
        this.fireOnce(f, w, ws);
      } else if (wantsFire && ws.cooldown <= 0) {
        const auto = w.rpm >= 400 || w.slot === 'melee' || w.id === 'super_pistols';
        if (auto || fresh) {
          if (w.slot !== 'melee' && ws.ammo <= 0) {
            if (startReload(w, ws)) this.events.push({ type: 'reload', id: f.id, weapon: w.id });
            else if (fresh) this.events.push({ type: 'empty', id: f.id });
          } else {
            ws.cooldown = 60 / w.rpm;
            if (w.burst) ws.burstLeft = w.burst;
            this.fireOnce(f, w, ws);
          }
        }
      }
    }

    // Health regeneration and spawn protection.
    f.protectLeft = Math.max(0, f.protectLeft - dt);
    f.sinceHurt += dt;
    if (f.sinceHurt >= REGEN_DELAY && f.hp < MAX_HP) f.hp = Math.min(MAX_HP, f.hp + REGEN_PER_SEC * dt);

    if (f.p.pos.y < MOVEMENT.killHeight || inLava(this.map, f.p.pos.x, f.p.pos.y, f.p.pos.z)) {
      this.kill(f, f.lastKiller ?? f.id, f.loadout[f.slot], false);
    }
  }

  private fireOnce(f: Fighter, w: WeaponDef, ws: WeaponState): void {
    f.protectLeft = 0; // shooting ends spawn protection
    f.firedAt = this.time;
    const b = ballisticsOf(w);
    if (ws.burstLeft > 0) {
      ws.burstLeft -= 1;
      ws.burstTimer = b.burstGap ?? 0.06;
    }
    if (w.slot === 'melee') { this.swing(f, w); return; }
    if (ws.ammo <= 0) { ws.burstLeft = 0; return; }
    ws.ammo -= 1;

    const eye = this.eye(f);
    const aim = aimDirection(f.yaw, f.pitch);
    const moving = Math.hypot(f.p.vel.x, f.p.vel.z) > 1 || !f.p.onGround;
    const spread = (f.ads ? b.spreadAds : b.spreadHip) * (moving && !f.ads ? 1.25 : 1);

    if (b.selfPush) {
      f.p.vel.x -= aim.x * b.selfPush;
      f.p.vel.z -= aim.z * b.selfPush;
      f.p.vel.y = Math.max(f.p.vel.y, -aim.y * b.selfPush * 0.6);
      if (f.p.vel.y > 0.5) f.p.onGround = false;
    }

    if (b.speed) {
      const d = spreadDirection(aim, spread, this.rand);
      this.projectiles.push({
        id: this.nextProj++, owner: f.id, weapon: w.id,
        pos: { x: eye.x + d.x * 0.6, y: eye.y - 0.15 + d.y * 0.6, z: eye.z + d.z * 0.6 },
        vel: { x: d.x * b.speed, y: d.y * b.speed, z: d.z * b.speed },
        life: 6, stuckTo: null, stuck: false, fuse: b.fuse ?? 0,
      });
      return;
    }

    const pellets = w.pellets ?? 1;
    for (let i = 0; i < pellets; i++) {
      const d = spreadDirection(aim, spread, this.rand);
      const maxDist = 200;
      const wallT = rayMap(this.map, eye, d, maxDist);
      let hitT = wallT;
      let victim: Fighter | null = null;
      let head = false;
      for (const o of this.fighters) {
        if (o === f || !o.alive) continue;
        const hb = hitboxes(o.p);
        const th = rayAabb(eye, d, hb.head.min, hb.head.max, hitT);
        if (th < hitT) { hitT = th; victim = o; head = true; }
        const tb = rayAabb(eye, d, hb.body.min, hb.body.max, hitT);
        if (tb < hitT) { hitT = tb; victim = o; head = false; }
      }
      const to = { x: eye.x + d.x * hitT, y: eye.y + d.y * hitT, z: eye.z + d.z * hitT };
      this.events.push({ type: 'shot', shooter: f.id, weapon: w.id, from: eye, to, hit: !!victim });
      if (victim) this.damage(victim, f, w.id, damageAt(w, b, hitT, head), head, to);
    }
  }

  private swing(f: Fighter, w: WeaponDef): void {
    const eye = this.eye(f);
    const aim = aimDirection(f.yaw, f.pitch);
    let best: Fighter | null = null;
    let bestD = Infinity;
    for (const o of this.fighters) {
      if (o === f || !o.alive) continue;
      const c = { x: o.p.pos.x, y: o.p.pos.y + playerHeight(o.p) * 0.6, z: o.p.pos.z };
      const to = { x: c.x - eye.x, y: c.y - eye.y, z: c.z - eye.z };
      const d = Math.hypot(to.x, to.y, to.z);
      if (d > (w.reach ?? 2) + 0.4 || d < 1e-3) continue;
      const dot = (to.x * aim.x + to.y * aim.y + to.z * aim.z) / d;
      if (dot < 0.72 || d >= bestD || !lineOfSight(this.map, eye, c)) continue;
      best = o;
      bestD = d;
    }
    this.events.push({ type: 'swing', id: f.id, weapon: w.id, hit: !!best });
    if (!best) return;
    let dmg = w.damage.body;
    // Combat Knife backstab: hit from behind for 100.
    const vf = aimDirection(best.yaw, 0);
    const toV = { x: best.p.pos.x - f.p.pos.x, z: best.p.pos.z - f.p.pos.z };
    const tl = Math.hypot(toV.x, toV.z) || 1;
    const behind = (vf.x * toV.x + vf.z * toV.z) / tl > 0.5;
    if (w.id === 'combat_knife' && behind) dmg = 100;
    // Long Kitchen Knife: +20 mid-slide.
    if (w.id === 'kitchen_knife' && f.p.sliding) dmg += 20;
    const at = { x: best.p.pos.x, y: best.p.pos.y + 1.2, z: best.p.pos.z };
    this.damage(best, f, w.id, dmg, false, at);
  }

  private tickProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i]!;
      const w = WEAPON_BY_ID[pr.weapon]!;
      const b = ballisticsOf(w);
      pr.life -= dt;
      if (pr.stuck) {
        if (pr.stuckTo !== null) {
          const host = this.byId(pr.stuckTo);
          if (host?.alive) pr.pos = { x: host.p.pos.x, y: host.p.pos.y + 1.1, z: host.p.pos.z };
        }
        pr.fuse -= dt;
        if (pr.fuse <= 0) { this.explode(pr, w, null); this.projectiles.splice(i, 1); }
        continue;
      }
      pr.vel.y -= (b.gravity ?? 0) * dt;
      const steps = Math.max(1, Math.ceil((Math.hypot(pr.vel.x, pr.vel.y, pr.vel.z) * dt) / 0.4));
      let done = false;
      for (let s = 0; s < steps && !done; s++) {
        const sd = dt / steps;
        pr.pos = { x: pr.pos.x + pr.vel.x * sd, y: pr.pos.y + pr.vel.y * sd, z: pr.pos.z + pr.vel.z * sd };
        // Players.
        for (const o of this.fighters) {
          if (!o.alive || (o.id === pr.owner && pr.life > 5.85)) continue;
          if (o.id === pr.owner && !b.explosive) continue;
          const hb = hitboxes(o.p);
          const inBox = (bx: { min: number[]; max: number[] }) =>
            pr.pos.x > bx.min[0]! - 0.1 && pr.pos.x < bx.max[0]! + 0.1 && pr.pos.y > bx.min[1]! - 0.1 && pr.pos.y < bx.max[1]! + 0.1 &&
            pr.pos.z > bx.min[2]! - 0.1 && pr.pos.z < bx.max[2]! + 0.1;
          const head = inBox(hb.head);
          if (!head && !inBox(hb.body)) continue;
          if (b.fuse) { pr.stuck = true; pr.stuckTo = o.id; done = true; break; }
          if (b.explosive) { this.explode(pr, w, o); } else {
            const owner = this.byId(pr.owner);
            if (owner) this.damage(o, owner, w.id, head ? w.damage.head : w.damage.body, head, { ...pr.pos });
            this.events.push({ type: 'impact', pos: { ...pr.pos }, weapon: w.id });
          }
          this.projectiles.splice(i, 1);
          done = true;
          break;
        }
        if (done) break;
        // Walls / floor.
        if (pointInMap(this.map, pr.pos) || pr.pos.y < -40) {
          if (b.fuse) { pr.stuck = true; done = true; break; }
          if (b.explosive) this.explode(pr, w, null);
          else this.events.push({ type: 'impact', pos: { ...pr.pos }, weapon: w.id });
          this.projectiles.splice(i, 1);
          done = true;
        }
      }
      if (!done && pr.life <= 0) {
        if (b.explosive) this.explode(pr, w, null);
        this.projectiles.splice(i, 1);
      }
    }
  }

  private explode(pr: Projectile, w: WeaponDef, direct: Fighter | null): void {
    const b = ballisticsOf(w);
    const radius = w.splash?.radius ?? 2;
    const owner = this.byId(pr.owner);
    this.events.push({ type: 'explode', pos: { ...pr.pos }, radius, weapon: w.id });
    for (const o of this.fighters) {
      if (!o.alive) continue;
      const c = { x: o.p.pos.x, y: o.p.pos.y + 0.9, z: o.p.pos.z };
      const dx = c.x - pr.pos.x, dy = c.y - pr.pos.y, dz = c.z - pr.pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > radius + 0.4 && o !== direct) continue;
      const k = Math.max(0, 1 - d / (radius + 0.4));
      // Knockback (this is what makes rocket-jumps work).
      const push = (b.knockback ?? 8) * k;
      const n = d > 1e-3 ? { x: dx / d, y: dy / d, z: dz / d } : { x: 0, y: 1, z: 0 };
      o.p.vel.x += n.x * push;
      o.p.vel.z += n.z * push;
      o.p.vel.y = Math.max(o.p.vel.y, 0) + Math.max(0.35, n.y) * push;
      if (push > 1) o.p.onGround = false;
      if (!owner) continue;
      let dmg = o === direct ? w.damage.body : (w.splash?.damage ?? 0) * k;
      if (o === owner) dmg = Math.min(dmg, b.selfDamage ?? 0);
      if (dmg > 0.5) this.damage(o, owner, w.id, dmg, false, { ...c });
    }
  }

  private damage(victim: Fighter, attacker: Fighter, weapon: string, amount: number, head: boolean, at: Vec3): void {
    if (!victim.alive || victim.protectLeft > 0) return;
    const self = victim === attacker;
    if (self) {
      // Your own explosions never kill you.
      victim.hp = Math.max(1, victim.hp - amount);
      victim.sinceHurt = 0;
      return;
    }
    victim.hp -= amount;
    victim.sinceHurt = 0;
    victim.lastKiller = attacker.id;
    this.events.push({ type: 'hit', attacker: attacker.id, victim: victim.id, damage: Math.round(amount), head, at });
    if (victim.hp <= 0) this.kill(victim, attacker.id, weapon, head);
  }

  private kill(victim: Fighter, killerId: number, weapon: string, head: boolean): void {
    victim.alive = false;
    victim.hp = 0;
    victim.deaths += 1;
    victim.streak = 0;
    victim.respawnIn = RESPAWN_SEC;
    const killer = this.byId(killerId);
    if (killer && killer !== victim) {
      killer.kills += 1;
      killer.streak += 1;
      if (killer.streak === 3) killer.boostLeft = 10;
    }
    this.events.push({ type: 'kill', killer: killerId, victim: victim.id, weapon, head, streak: killer?.streak ?? 0 });
    victim.lastKiller = null;
  }

  /** Scoreboard, best first. */
  standings(): Fighter[] {
    return [...this.fighters].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  }
}
