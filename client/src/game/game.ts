import * as THREE from 'three';
import {
  MOVEMENT, RARITY_BY_ID, WEAPON_BY_ID, createPlayer, emptyInput, eyeHeight, horizontalSpeed, inLava, pointInZone, stepPlayer,
  type MapDef, type MoveEvent, type PlayerState, type RarityId, type Slot, type Vec3, type WeaponDef, type Zone,
} from '@blockfire/shared';
import { buildWorld, type BuiltWorld } from './world.js';
import type { Input } from './input.js';
import type { Sfx } from './audio.js';
import type { Graphics } from './graphics.js';
import { Viewmodel } from './viewmodel.js';
import { rarityOf, type Loadout } from './loadout.js';
import { loadBest, saveBest, type Settings } from './settings.js';

export const TICK = 1 / 60;

export type RunPhase = 'idle' | 'ready' | 'running' | 'finished';

export interface HudState {
  speed: number;
  onGround: boolean;
  sliding: boolean;
  slideReady: number;
  wallJumpsLeft: number;
  weapon: WeaponDef;
  rarity: RarityId;
  slot: Slot;
  run: RunPhase;
  runTime: number;
  best: number | null;
  splitText: string | null;
}

export class Game {
  readonly camera: THREE.PerspectiveCamera;
  readonly world: BuiltWorld;
  private player: PlayerState;
  private prevPos: Vec3;
  private acc = 0;
  private time = 0;
  private slot: Slot = 'primary';
  private eye = MOVEMENT.standHeight - MOVEMENT.eyeOffset;
  private dip = 0;
  private dipVel = 0;
  private stepClock = 0;
  private viewmodel: Viewmodel;

  private run: RunPhase = 'idle';
  private runTime = 0;
  private reached = new Set<string>();
  private respawnPoint: { pos: Vec3; yaw: number };
  private best: number | null;
  private splitText: string | null = null;
  private splitTimer = 0;
  private wasInStart = false;

  constructor(
    private map: MapDef, private input: Input, private sfx: Sfx,
    private settings: () => Settings, graphics: Graphics, private loadout: () => Loadout,
  ) {
    this.world = buildWorld(map, graphics.renderer, graphics.shadowSize);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.03, 420);
    this.camera.rotation.order = 'YXZ';
    this.world.scene.add(this.camera);
    this.viewmodel = new Viewmodel(this.camera);

    const [x, y, z] = map.spawn.pos;
    this.respawnPoint = { pos: { x, y, z }, yaw: map.spawn.yaw };
    this.player = createPlayer({ x, y, z });
    this.prevPos = { x, y, z };
    this.input.yaw = map.spawn.yaw;
    this.input.pitch = 0;
    this.best = loadBest(map.id);
    this.refreshWeapon();
  }

  private get weapon(): WeaponDef {
    return WEAPON_BY_ID[this.loadout()[this.slot]] ?? WEAPON_BY_ID['pistol']!;
  }

  /** Rebuild the held weapon model if the loadout or its skin changed. */
  refreshWeapon(): void {
    const w = this.weapon;
    this.viewmodel.set(w, rarityOf(this.loadout(), w.id));
  }

  update(frameDt: number): void {
    const dt = Math.min(frameDt, 0.1);
    this.handleKeys();
    this.acc += dt;
    while (this.acc >= TICK) {
      this.tick();
      this.acc -= TICK;
    }
    this.render(this.acc / TICK, dt);
  }

  private setSlot(slot: Slot): void {
    if (slot === this.slot) return;
    this.slot = slot;
    this.sfx.click();
    this.refreshWeapon();
  }

  private handleKeys(): void {
    if (this.input.pressed('slot1')) this.setSlot('primary');
    if (this.input.pressed('slot2')) this.setSlot('secondary');
    if (this.input.pressed('slot3')) this.setSlot('melee');
    if (this.input.pressed('respawn')) this.respawn(true);
  }

  private tick(): void {
    const p = this.player;
    this.prevPos = { ...p.pos };
    const w = this.weapon;
    const input = emptyInput();
    input.forward = (this.input.held('forward') ? 1 : 0) - (this.input.held('back') ? 1 : 0);
    input.strafe = (this.input.held('right') ? 1 : 0) - (this.input.held('left') ? 1 : 0);
    input.jump = this.input.held('jump');
    input.crouch = this.input.held('crouch');
    input.walk = this.input.held('walk');
    input.yaw = this.input.yaw;
    input.wallJump = !!w.wallJump;
    input.speedMul = w.moveSpeed;

    const { events } = stepPlayer(p, input, this.map, TICK);
    this.time += TICK;
    for (const e of events) this.onEvent(e);

    const speed = horizontalSpeed(p);
    if (p.onGround && !p.sliding && !input.walk && !input.crouch && speed > 1) {
      this.stepClock += TICK * speed;
      if (this.stepClock > 2.2) { this.stepClock = 0; this.sfx.step(); }
    }

    if (p.pos.y < MOVEMENT.killHeight || inLava(this.map, p.pos.x, p.pos.y, p.pos.z)) this.respawn(false);
    this.updateRun();
    if (this.splitTimer > 0) {
      this.splitTimer -= TICK;
      if (this.splitTimer <= 0) this.splitText = null;
    }
  }

  private onEvent(e: MoveEvent): void {
    switch (e) {
      case 'jump': this.sfx.jump(); break;
      case 'land': this.sfx.land(); this.dipVel -= 1.6; this.viewmodel.land(); break;
      case 'slide': case 'slideChain': this.sfx.slide(); break;
      case 'slideHop': this.sfx.slideHop(); break;
      case 'wallJump': this.sfx.wallJump(); break;
      case 'climb': this.sfx.climb(); break;
      default: break;
    }
  }

  private zones(kind: Zone['kind']): Zone[] {
    return this.map.zones.filter((z) => z.kind === kind);
  }

  private inZone(z: Zone): boolean {
    const p = this.player.pos;
    return pointInZone(z, p.x, p.y + 0.5, p.z);
  }

  private updateRun(): void {
    const start = this.zones('start')[0];
    const inStart = !!start && this.inZone(start);
    if (inStart) {
      if (this.run !== 'ready') {
        this.run = 'ready';
        this.runTime = 0;
        this.reached.clear();
        const [x, y, z] = this.map.spawn.pos;
        this.respawnPoint = { pos: { x, y, z }, yaw: this.map.spawn.yaw };
      }
    } else if (this.wasInStart && this.run === 'ready') {
      this.run = 'running';
      this.runTime = 0;
      this.sfx.start();
    }
    this.wasInStart = inStart;
    if (this.run !== 'running') return;
    this.runTime += TICK;

    for (const cp of this.zones('checkpoint')) {
      if (this.reached.has(cp.id) || !this.inZone(cp)) continue;
      this.reached.add(cp.id);
      if (cp.respawn) {
        const [x, y, z] = cp.respawn.pos;
        this.respawnPoint = { pos: { x, y, z }, yaw: cp.respawn.yaw };
      }
      this.flash(`Checkpoint ${this.reached.size} · ${formatTime(this.runTime)}`);
      this.sfx.checkpoint();
    }

    const finish = this.zones('finish')[0];
    if (finish && this.inZone(finish)) {
      this.run = 'finished';
      const t = this.runTime;
      const isBest = this.best === null || t < this.best;
      if (isBest) { this.best = t; saveBest(this.map.id, t); }
      this.flash(isBest ? `Finished in ${formatTime(t)} · new best!` : `Finished in ${formatTime(t)}`, 5);
      this.sfx.finish();
    }
  }

  private flash(text: string, seconds = 2.5): void {
    this.splitText = text;
    this.splitTimer = seconds;
  }

  respawn(manual: boolean): void {
    const point = this.run === 'running'
      ? this.respawnPoint
      : { pos: { x: this.map.spawn.pos[0], y: this.map.spawn.pos[1], z: this.map.spawn.pos[2] }, yaw: this.map.spawn.yaw };
    Object.assign(this.player, createPlayer(point.pos));
    this.prevPos = { ...point.pos };
    this.input.yaw = point.yaw;
    this.input.pitch = 0;
    if (!manual || this.run !== 'running') this.sfx.respawn();
    if (this.run === 'finished') this.run = 'idle';
  }

  private render(alpha: number, dt: number): void {
    const p = this.player;
    const x = this.prevPos.x + (p.pos.x - this.prevPos.x) * alpha;
    const y = this.prevPos.y + (p.pos.y - this.prevPos.y) * alpha;
    const z = this.prevPos.z + (p.pos.z - this.prevPos.z) * alpha;

    this.eye += (eyeHeight(p) - this.eye) * Math.min(1, dt * 14);
    this.dipVel += (-this.dip * 120 - this.dipVel * 14) * dt;
    this.dip += this.dipVel * dt;

    this.camera.position.set(x, y + this.eye + this.dip * 0.08, z);
    this.camera.rotation.set(this.input.pitch, this.input.yaw, 0);

    const speed = horizontalSpeed(p);
    const fov = this.settings().fov + Math.max(0, Math.min(10, (speed - MOVEMENT.runSpeed) * 1.1));
    const vfov = horizontalToVerticalFov(fov, this.camera.aspect);
    if (Math.abs(this.camera.fov - vfov) > 0.01) {
      this.camera.fov += (vfov - this.camera.fov) * Math.min(1, dt * 8);
      this.camera.updateProjectionMatrix();
    }

    const t = this.time;
    this.viewmodel.update(dt, this.input.yaw, this.input.pitch, { speed, onGround: p.onGround, sliding: p.sliding, reload: -1, ads: 0 });

    this.world.update(t);
  }

  hud(): HudState {
    const p = this.player;
    const w = this.weapon;
    return {
      speed: horizontalSpeed(p),
      onGround: p.onGround,
      sliding: p.sliding,
      slideReady: p.sliding ? 0 : 1 - Math.min(1, p.slideCooldown / MOVEMENT.slideCooldown),
      wallJumpsLeft: p.wallJumpsLeft,
      weapon: w,
      rarity: rarityOf(this.loadout(), w.id),
      slot: this.slot,
      run: this.run,
      runTime: this.runTime,
      best: this.best,
      splitText: this.splitText,
    };
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.fov = horizontalToVerticalFov(this.settings().fov, this.camera.aspect);
    this.camera.updateProjectionMatrix();
  }
}

export function rarityColor(r: RarityId): string {
  return RARITY_BY_ID[r].color;
}

/** Shooters describe FOV horizontally; Three.js wants it vertically. */
export function horizontalToVerticalFov(hfovDeg: number, aspect: number): number {
  const h = (hfovDeg * Math.PI) / 180;
  return (2 * Math.atan(Math.tan(h / 2) / aspect) * 180) / Math.PI;
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
