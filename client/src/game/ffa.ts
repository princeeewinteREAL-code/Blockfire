import * as THREE from 'three';
import {
  MOVEMENT, Match, RARITIES, WEAPON_BY_ID, ballisticsOf, botLoadout, botName, botThink, createBrain, eyeHeight,
  horizontalSpeed, makeRng, type BotBrain, type BotDifficulty, type Fighter, type FighterInput, type MapDef,
  type MatchEvent, type RarityId, type Slot, type Vec3, type WeaponDef,
} from '@blockfire/shared';
import { buildWorld, type BuiltWorld } from './world.js';
import type { Input } from './input.js';
import type { Sfx, Where } from './audio.js';
import type { Graphics } from './graphics.js';
import { Viewmodel } from './viewmodel.js';
import { Effects, tracerColor } from './effects.js';
import { Avatars } from './avatars.js';
import { rarityOf, type Loadout } from './loadout.js';
import type { Settings } from './settings.js';
import { horizontalToVerticalFov } from './game.js';

export const TICK = 1 / 60;

export interface FeedItem { killer: string; victim: string; weapon: string; head: boolean; mine: 'killer' | 'victim' | null; age: number }

export interface FfaHud {
  hp: number;
  alive: boolean;
  respawnIn: number;
  killedBy: string | null;
  killedWith: string | null;
  weapon: WeaponDef;
  rarity: RarityId;
  slot: Slot;
  ammo: number;
  reload: number;
  timeLeft: number;
  myKills: number;
  leader: { name: string; kills: number } | null;
  scoreLimit: number;
  feed: FeedItem[];
  hitmarker: number;
  hitHead: boolean;
  hurt: number;
  ads: number;
  scoped: boolean;
  speed: number;
  wallJumpsLeft: number;
  slideReady: number;
  sliding: boolean;
  callout: string | null;
  protect: number;
  over: boolean;
  standings: Array<{ id: number; name: string; kills: number; deaths: number; me: boolean; bot: boolean }>;
  winner: string | null;
}

/** Pick a skin rarity for a bot weapon, using the crate odds. */
function rollRarity(rand: () => number): RarityId {
  const r = rand() * 100;
  if (r < 30) return 'basic';
  if (r < 62) return 'common';
  if (r < 80) return 'uncommon';
  if (r < 91) return 'rare';
  if (r < 96.5) return 'epic';
  if (r < 99) return 'legendary';
  return RARITIES[6 + Math.floor(rand() * 3)]!.id;
}

/** Free For All: you against bots on a combat map. */
export class FfaGame {
  readonly camera: THREE.PerspectiveCamera;
  readonly world: BuiltWorld;
  readonly match: Match;
  me: Fighter;
  protected brains = new Map<number, BotBrain>();
  protected botRarity = new Map<string, RarityId>();
  protected viewmodel: Viewmodel;
  protected effects: Effects;
  protected avatars: Avatars;
  protected acc = 0;
  protected time = 0;
  protected prevPos: Vec3;
  protected eye = MOVEMENT.standHeight - MOVEMENT.eyeOffset;
  protected ads = 0;
  protected recoilPending = 0;
  protected wantSlot: Slot | undefined;
  protected feed: FeedItem[] = [];
  protected hitmarker = 0;
  protected hitHead = false;
  protected hurt = 0;
  protected killedBy: string | null = null;
  protected killedWith: string | null = null;
  protected deathPos = new THREE.Vector3();
  protected callout: string | null = null;
  protected calloutT = 0;
  protected stepClock = 0;
  protected shotCount = 0;
  protected rand = makeRng(Date.now() & 0xffff);
  /** Online: your shots are shown the instant you click, so the server's copy only draws the tracer. */
  protected ownShotsPredicted = false;

  constructor(
    map: MapDef, protected input: Input, protected sfx: Sfx, protected settings: () => Settings,
    graphics: Graphics, protected loadout: () => Loadout, difficulty: BotDifficulty, bots = 7,
  ) {
    this.world = buildWorld(map, graphics.renderer, graphics.shadowSize);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.03, 420);
    this.camera.rotation.order = 'YXZ';
    this.world.scene.add(this.camera);
    this.viewmodel = new Viewmodel(this.camera);
    this.effects = new Effects(this.world.scene);
    this.avatars = new Avatars(this.world.scene);

    this.match = new Match(map, { scoreLimit: 30, timeLimit: 360 }, Date.now() & 0xffffff);
    const l = loadout();
    this.me = this.match.addFighter('You', { primary: l.primary, secondary: l.secondary, melee: l.melee }, false);
    const nameOffset = Math.floor(this.rand() * 14);
    for (let i = 0; i < bots; i++) {
      const f = this.match.addFighter(botName(i + nameOffset), botLoadout(this.rand), true);
      this.brains.set(f.id, createBrain(difficulty, 1000 + i * 31 + Math.floor(this.rand() * 999)));
      for (const slot of ['primary', 'secondary', 'melee'] as Slot[]) this.botRarity.set(`${f.id}|${f.loadout[slot]}`, rollRarity(this.rand));
    }
    this.input.yaw = this.me.yaw;
    this.input.pitch = 0;
    this.prevPos = { ...this.me.p.pos };
    this.match.events = [];
    this.refreshWeapon();
  }

  protected rarityFor = (f: Fighter, weaponId: string): RarityId =>
    f.id === this.me.id ? rarityOf(this.loadout(), weaponId) : this.botRarity.get(`${f.id}|${weaponId}`) ?? 'basic';

  refreshWeapon(): void {
    const w = this.match.weaponOf(this.me);
    this.viewmodel.set(w, this.rarityFor(this.me, w.id));
  }

  get over(): boolean { return this.match.over; }

  update(frameDt: number): void {
    const dt = Math.min(frameDt, 0.1);
    if (this.input.pressed('slot1')) this.wantSlot = 'primary';
    if (this.input.pressed('slot2')) this.wantSlot = 'secondary';
    if (this.input.pressed('slot3')) this.wantSlot = 'melee';
    this.acc += dt;
    while (this.acc >= TICK) {
      this.tick();
      this.acc -= TICK;
    }
    this.render(this.acc / TICK, dt);
  }

  protected tick(): void {
    if (this.match.over) return;
    const me = this.me;
    this.prevPos = { ...me.p.pos };
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
      slot: this.wantSlot,
    };
    this.wantSlot = undefined;
    const inputs = new Map<number, FighterInput>([[me.id, mine]]);
    for (const f of this.match.fighters) {
      const brain = this.brains.get(f.id);
      if (brain) inputs.set(f.id, botThink(this.match, f, brain, TICK));
    }
    const slotBefore = me.slot;
    this.match.tick(TICK, inputs);
    this.time += TICK;
    if (me.slot !== slotBefore) { this.sfx.click(); this.refreshWeapon(); }

    for (const e of this.match.events) this.onEvent(e);
    this.match.events = [];

    const speed = horizontalSpeed(me.p);
    if (me.alive && me.p.onGround && !me.p.sliding && !mine.walk && !mine.crouch && speed > 1) {
      this.stepClock += TICK * speed;
      if (this.stepClock > 2.2) { this.stepClock = 0; this.sfx.step(); }
    }
    for (const f of this.feed) f.age += TICK;
    this.feed = this.feed.filter((f) => f.age < 6).slice(-6);
  }

  protected where(p: Vec3): Where {
    const c = this.camera.position;
    const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
    const d = Math.hypot(dx, dy, dz);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const pan = d > 0.5 ? (dx * right.x + dz * right.z) / d : 0;
    return { vol: Math.pow(Math.max(0, 1 - d / 70), 1.6), pan: pan * 0.8 };
  }

  protected v(p: Vec3): THREE.Vector3 { return new THREE.Vector3(p.x, p.y, p.z); }

  protected onEvent(e: MatchEvent): void {
    const meId = this.me.id;
    switch (e.type) {
      case 'shot': {
        const shooter = this.match.byId(e.shooter);
        if (!shooter) break;
        const w = WEAPON_BY_ID[e.weapon]!;
        const color = tracerColor(this.rarityFor(shooter, e.weapon));
        let from: THREE.Vector3;
        if (e.shooter === meId) {
          from = this.viewmodel.muzzleWorld(new THREE.Vector3());
          if (!this.ownShotsPredicted) {
            this.kick(w);
            this.sfx.shot(e.weapon, { vol: 0.9 });
          }
        } else {
          const aim = new THREE.Vector3(-Math.sin(shooter.yaw), Math.sin(shooter.pitch), -Math.cos(shooter.yaw)).normalize();
          from = this.v(e.from).add(aim.multiplyScalar(0.7)).add(new THREE.Vector3(0, -0.3, 0));
          this.sfx.shot(e.weapon, this.where(e.from));
        }
        // Fast-firing guns only show every third tracer, so the screen doesn't fill with lines.
        const auto = w.rpm >= 400;
        this.shotCount = (this.shotCount + 1) % 3;
        if (!auto || this.shotCount === 0) this.effects.tracer(from, this.v(e.to), color, w.id === 'sniper' || w.id === 'hand_cannon' ? 0.022 : 0.012);
        if (e.shooter === meId) this.effects.muzzle(from);
        if (!e.hit && (!auto || this.shotCount === 0)) this.effects.sparks(this.v(e.to), new THREE.Color('#d8c8a0'), 2, 2, 0.03);
        break;
      }
      case 'hit': {
        if (e.attacker === meId) {
          this.hitmarker = 1;
          this.hitHead = e.head;
          this.sfx.hitmarker(e.head);
        }
        if (e.victim === meId) { this.hurt = Math.min(1, this.hurt + e.damage / 60); this.sfx.hurt(); }
        if (e.head) this.effects.sparks(this.v(e.at), new THREE.Color('#ff6b6b'), 4, 3, 0.04);
        break;
      }
      case 'kill': {
        const killer = this.match.byId(e.killer);
        const victim = this.match.byId(e.victim)!;
        const mine = e.killer === meId && e.victim !== meId ? 'killer' : e.victim === meId ? 'victim' : null;
        this.feed.push({ killer: killer?.name ?? '?', victim: victim.name, weapon: WEAPON_BY_ID[e.weapon]?.name ?? e.weapon, head: e.head, mine, age: 0 });
        if (e.victim !== meId) {
          this.effects.shatter(this.v(victim.p.pos), this.avatars.skinColors(victim.id));
        }
        if (mine === 'killer') {
          this.sfx.killConfirm();
          const s = e.streak;
          const text = s === 3 ? 'Killstreak 3 · speed boost!' : s === 5 ? 'Killstreak 5 · everyone can see your name' : s === 10 ? 'KILLSTREAK 10 · UNSTOPPABLE' : e.head ? 'Headshot kill' : null;
          if (text) { this.callout = text; this.calloutT = 2.5; }
        }
        if (mine === 'victim') {
          this.sfx.death();
          this.killedBy = e.killer === meId ? null : killer?.name ?? null;
          this.killedWith = WEAPON_BY_ID[e.weapon]?.name ?? null;
          this.deathPos.copy(this.camera.position);
        }
        break;
      }
      case 'explode': {
        this.effects.explosion(this.v(e.pos), e.radius, e.weapon);
        const w = this.where(e.pos);
        this.sfx.explosion(e.weapon === 'k2_bomber', w);
        const d = this.camera.position.distanceTo(this.v(e.pos));
        this.effects.shake = Math.max(this.effects.shake, Math.max(0, 1 - d / (e.radius * 4)) * (e.weapon === 'k2_bomber' ? 0.6 : 0.25));
        break;
      }
      case 'impact':
        this.effects.sparks(this.v(e.pos), new THREE.Color('#ffd9a0'), 3, 3, 0.04);
        this.sfx.impact(this.where(e.pos));
        break;
      case 'swing': {
        const f = this.match.byId(e.id);
        if (!f) break;
        const where = e.id === meId ? {} : this.where(f.p.pos);
        if (e.id === meId && !this.ownShotsPredicted) this.viewmodel.fire(0);
        if (e.hit) this.sfx.stab(where); else this.sfx.swing(where);
        break;
      }
      case 'reload':
        if (e.id === meId) this.sfx.reload();
        break;
      case 'empty':
        if (e.id === meId) this.sfx.empty();
        break;
      case 'respawn':
        if (e.id === meId) {
          this.input.yaw = this.me.yaw;
          this.input.pitch = 0;
          this.prevPos = { ...this.me.p.pos };
          this.refreshWeapon();
          this.sfx.respawn();
          this.hurt = 0;
        }
        break;
      case 'move':
        if (e.id === meId) {
          if (e.event === 'jump') this.sfx.jump();
          if (e.event === 'land') { this.sfx.land(); this.viewmodel.land(); }
          if (e.event === 'slide' || e.event === 'slideChain') this.sfx.slide();
          if (e.event === 'slideHop') this.sfx.slideHop();
          if (e.event === 'wallJump') this.sfx.wallJump();
          if (e.event === 'climb') this.sfx.climb();
        }
        break;
      case 'over':
        this.sfx.finish();
        this.input.unlock();
        break;
    }
  }

  /** Camera recoil for the local player's shots. */
  protected kick(w: WeaponDef): void {
    const b = ballisticsOf(w);
    const amount = (b.recoil * Math.PI) / 180 * (this.me.ads ? 0.55 : 1);
    this.input.pitch = Math.min(1.5, this.input.pitch + amount);
    this.recoilPending += amount * 0.75;
    this.viewmodel.fire(b.recoil);
  }

  protected render(alpha: number, dt: number): void {
    const me = this.me;
    const w = this.match.weaponOf(me);
    // Recoil recovery.
    if (this.recoilPending > 0) {
      const back = Math.min(this.recoilPending, dt * 0.25);
      this.recoilPending -= back;
      this.input.pitch -= back;
    }
    this.ads += ((me.ads ? 1 : 0) - this.ads) * Math.min(1, dt * 12);
    const zoom = 1 + (Math.max(1, w.zoom) - 1) * this.ads;
    this.input.sensMul = 1 / Math.sqrt(zoom);

    if (me.alive) {
      const x = this.prevPos.x + (me.p.pos.x - this.prevPos.x) * alpha;
      const y = this.prevPos.y + (me.p.pos.y - this.prevPos.y) * alpha;
      const z = this.prevPos.z + (me.p.pos.z - this.prevPos.z) * alpha;
      this.eye += (eyeHeight(me.p) - this.eye) * Math.min(1, dt * 14);
      this.camera.position.set(x, y + this.eye, z);
      this.camera.rotation.set(this.input.pitch, this.input.yaw, 0);
      this.hand(true);
    } else {
      // Death cam: float up and look at whoever got you.
      this.hand(false);
      const killer = this.match.fighters.find((f) => f.name === this.killedBy);
      this.camera.position.lerp(this.deathPos.clone().add(new THREE.Vector3(0, 2.5, 0)), Math.min(1, dt * 2));
      if (killer?.alive) {
        const target = new THREE.Vector3(killer.p.pos.x, killer.p.pos.y + 1.2, killer.p.pos.z);
        const m = new THREE.Matrix4().lookAt(this.camera.position, target, new THREE.Vector3(0, 1, 0));
        this.camera.quaternion.slerp(new THREE.Quaternion().setFromRotationMatrix(m), Math.min(1, dt * 4));
      }
    }

    // Screen shake from explosions.
    if (this.effects.shake > 0) {
      const s = this.effects.shake * 0.08;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }

    const speed = horizontalSpeed(me.p);
    const baseFov = this.settings().fov + Math.max(0, Math.min(10, (speed - MOVEMENT.runSpeed) * 1.1)) * (1 - this.ads);
    const hfov = (2 * Math.atan(Math.tan((baseFov * Math.PI) / 360) / zoom) * 180) / Math.PI;
    this.camera.fov = horizontalToVerticalFov(hfov, this.camera.aspect);
    this.camera.updateProjectionMatrix();

    const ws = me.weapons[me.slot];
    this.viewmodel.update(dt, this.input.yaw, this.input.pitch, {
      speed, onGround: me.p.onGround, sliding: me.p.sliding,
      reload: ws.reloadLeft > 0 ? 1 - ws.reloadLeft / w.reloadSec : -1,
      ads: this.ads,
    });
    this.avatars.update(this.match.fighters, me.id, dt, this.rarityFor);
    this.effects.syncProjectiles(this.match.projectiles, this.time);
    this.effects.update(dt);
    this.world.update(this.time);

    this.hitmarker = Math.max(0, this.hitmarker - dt * 4);
    this.hurt = Math.max(0, this.hurt - dt * 0.8);
    this.calloutT -= dt;
    if (this.calloutT <= 0) this.callout = null;
  }

  protected hand(visible: boolean): void {
    this.viewmodel.hand.visible = visible;
  }

  hud(): FfaHud {
    const me = this.me;
    const w = this.match.weaponOf(me);
    const ws = me.weapons[me.slot];
    const standings = this.match.standings();
    const leader = standings[0];
    return {
      hp: Math.max(0, me.hp),
      alive: me.alive,
      respawnIn: me.respawnIn,
      killedBy: this.killedBy,
      killedWith: this.killedWith,
      weapon: w,
      rarity: this.rarityFor(me, w.id),
      slot: me.slot,
      ammo: ws.ammo,
      reload: ws.reloadLeft > 0 ? 1 - ws.reloadLeft / w.reloadSec : -1,
      timeLeft: Math.max(0, this.match.settings.timeLimit - this.match.time),
      myKills: me.kills,
      leader: leader ? { name: leader.name, kills: leader.kills } : null,
      scoreLimit: this.match.settings.scoreLimit,
      feed: this.feed,
      hitmarker: this.hitmarker,
      hitHead: this.hitHead,
      hurt: this.hurt,
      ads: this.ads,
      scoped: w.zoom >= 2 && this.ads > 0.9,
      speed: horizontalSpeed(me.p),
      wallJumpsLeft: me.p.wallJumpsLeft,
      slideReady: me.p.sliding ? 0 : 1 - Math.min(1, me.p.slideCooldown / MOVEMENT.slideCooldown),
      sliding: me.p.sliding,
      callout: this.callout,
      protect: me.protectLeft,
      over: this.match.over,
      standings: standings.map((f) => ({ id: f.id, name: f.name, kills: f.kills, deaths: f.deaths, me: f.id === me.id, bot: f.isBot })),
      winner: this.match.over ? this.match.byId(this.match.winner ?? -1)?.name ?? null : null,
    };
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
