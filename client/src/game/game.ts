import * as THREE from 'three';
import {
  MOVEMENT, createPlayer, emptyInput, eyeHeight, horizontalSpeed, pointInZone, stepPlayer,
  type MapDef, type MoveEvent, type PlayerState, type Vec3, type Zone,
} from '@blockfire/shared';
import { buildWorld, type BuiltWorld } from './world.js';
import type { Input } from './input.js';
import type { Sfx } from './audio.js';
import { loadBest, saveBest, type Settings } from './settings.js';

export const TICK = 1 / 60;

export interface HeldWeapon { name: string; speedMul: number; snake: boolean }

const WEAPONS: Record<'normal' | 'fast' | 'heavy', HeldWeapon> = {
  normal: { name: 'Revolver', speedMul: 1.0, snake: false },
  fast: { name: 'Super Pistols', speedMul: 1.25, snake: false },
  heavy: { name: 'Dual Heavy MGs', speedMul: 0.65, snake: false },
};
const SNAKE: HeldWeapon = { name: 'Snake Pistol', speedMul: 1.05, snake: true };

export type RunPhase = 'idle' | 'ready' | 'running' | 'finished';

export interface HudState {
  speed: number;
  onGround: boolean;
  sliding: boolean;
  slideReady: number;   // 0..1
  wallJumpsLeft: number;
  weapon: HeldWeapon;
  run: RunPhase;
  runTime: number;
  best: number | null;
  splitText: string | null;
  checkpoint: string | null;
}

export class Game {
  readonly camera: THREE.PerspectiveCamera;
  readonly world: BuiltWorld;
  private player: PlayerState;
  private prevPos: Vec3;
  private acc = 0;
  private time = 0;
  private weapon: HeldWeapon = WEAPONS.normal;
  private lastNonSnake: HeldWeapon = WEAPONS.normal;
  private eye = MOVEMENT.standHeight - MOVEMENT.eyeOffset;
  private dip = 0;
  private dipVel = 0;
  private stepClock = 0;
  private viewmodel: THREE.Group;
  private gunMat: THREE.MeshLambertMaterial;

  // Parkour run
  private run: RunPhase = 'idle';
  private runTime = 0;
  private reached = new Set<string>();
  private respawnPoint: { pos: Vec3; yaw: number };
  private best: number | null;
  private splitText: string | null = null;
  private splitTimer = 0;
  private wasInStart = false;
  private lastCheckpoint: string | null = null;

  constructor(private map: MapDef, private input: Input, private sfx: Sfx, private settings: () => Settings) {
    this.world = buildWorld(map);
    this.camera = new THREE.PerspectiveCamera(settings().fov, 1, 0.05, 400);
    this.camera.rotation.order = 'YXZ';
    this.world.scene.add(this.camera);

    const [x, y, z] = map.spawn.pos;
    this.respawnPoint = { pos: { x, y, z }, yaw: map.spawn.yaw };
    this.player = createPlayer({ x, y, z });
    this.prevPos = { x, y, z };
    this.input.yaw = map.spawn.yaw;
    this.input.pitch = 0;
    this.best = loadBest(map.id);

    // A simple blocky gun held in the bottom-right of the screen.
    this.gunMat = new THREE.MeshLambertMaterial({ color: 0x3c4452 });
    const gripMat = new THREE.MeshLambertMaterial({ color: 0x8a5a33 });
    this.viewmodel = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.3), this.gunMat);
    barrel.position.set(0, 0, -0.14);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), gripMat);
    grip.position.set(0, -0.1, -0.02);
    grip.rotation.x = 0.25;
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshLambertMaterial({ color: 0xe0a882 }));
    hand.position.set(0, -0.14, 0.04);
    this.viewmodel.add(barrel, grip, hand);
    this.viewmodel.position.set(0.26, -0.24, -0.5);
    this.viewmodel.rotation.y = -0.06;
    this.camera.add(this.viewmodel);
  }

  /** Called every animation frame with real elapsed seconds. */
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

  private handleKeys(): void {
    if (this.input.pressed('snake')) {
      if (this.weapon.snake) this.weapon = this.lastNonSnake;
      else { this.lastNonSnake = this.weapon; this.weapon = SNAKE; }
      this.sfx.click();
    }
    if (this.input.pressed('speed1')) this.setWeapon(WEAPONS.normal);
    if (this.input.pressed('speed2')) this.setWeapon(WEAPONS.fast);
    if (this.input.pressed('speed3')) this.setWeapon(WEAPONS.heavy);
    if (this.input.pressed('respawn')) this.respawn(true);
    this.gunMat.color.set(this.weapon.snake ? 0x2fbf71 : this.weapon === WEAPONS.heavy ? 0x23272e : this.weapon === WEAPONS.fast ? 0xd9a62e : 0x3c4452);
  }

  private setWeapon(w: HeldWeapon): void {
    this.weapon = w;
    this.lastNonSnake = w;
    this.sfx.click();
  }

  private tick(): void {
    const p = this.player;
    this.prevPos = { ...p.pos };
    const input = emptyInput();
    input.forward = (this.input.held('forward') ? 1 : 0) - (this.input.held('back') ? 1 : 0);
    input.strafe = (this.input.held('right') ? 1 : 0) - (this.input.held('left') ? 1 : 0);
    input.jump = this.input.held('jump');
    input.crouch = this.input.held('crouch');
    input.walk = this.input.held('walk');
    input.yaw = this.input.yaw;
    input.wallJump = this.weapon.snake;
    input.speedMul = this.weapon.speedMul;

    const { events } = stepPlayer(p, input, this.map, TICK);
    this.time += TICK;
    for (const e of events) this.onEvent(e);

    // Footsteps (silent while walking or crouching).
    const speed = horizontalSpeed(p);
    if (p.onGround && !p.sliding && !input.walk && !input.crouch && speed > 1) {
      this.stepClock += TICK * speed;
      if (this.stepClock > 2.2) { this.stepClock = 0; this.sfx.step(); }
    }

    if (p.pos.y < MOVEMENT.killHeight) this.respawn(false);
    this.updateRun();
    if (this.splitTimer > 0) {
      this.splitTimer -= TICK;
      if (this.splitTimer <= 0) this.splitText = null;
    }
  }

  private onEvent(e: MoveEvent): void {
    switch (e) {
      case 'jump': this.sfx.jump(); break;
      case 'land': this.sfx.land(); this.dipVel -= 1.6; break;
      case 'slide': this.sfx.slide(); break;
      case 'wallJump': this.sfx.wallJump(); break;
      case 'climb': this.sfx.climb(); break;
      default: break;
    }
  }

  private zone(kind: Zone['kind']): Zone[] {
    return this.map.zones.filter((z) => z.kind === kind);
  }

  private inZone(z: Zone): boolean {
    const p = this.player.pos;
    return pointInZone(z, p.x, p.y + 0.5, p.z);
  }

  private updateRun(): void {
    const start = this.zone('start')[0];
    const inStart = !!start && this.inZone(start);

    if (inStart) {
      if (this.run !== 'ready') {
        this.run = 'ready';
        this.runTime = 0;
        this.reached.clear();
        this.lastCheckpoint = null;
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

    for (const cp of this.zone('checkpoint')) {
      if (this.reached.has(cp.id) || !this.inZone(cp)) continue;
      this.reached.add(cp.id);
      this.lastCheckpoint = cp.id;
      if (cp.respawn) {
        const [x, y, z] = cp.respawn.pos;
        this.respawnPoint = { pos: { x, y, z }, yaw: cp.respawn.yaw };
      }
      this.flash(`Checkpoint ${this.reached.size} — ${formatTime(this.runTime)}`);
      this.sfx.checkpoint();
    }

    const finish = this.zone('finish')[0];
    if (finish && this.inZone(finish)) {
      this.run = 'finished';
      const t = this.runTime;
      const isBest = this.best === null || t < this.best;
      if (isBest) { this.best = t; saveBest(this.map.id, t); }
      this.flash(isBest ? `Finished in ${formatTime(t)} — new best!` : `Finished in ${formatTime(t)}`, 5);
      this.sfx.finish();
    }
  }

  private flash(text: string, seconds = 2.5): void {
    this.splitText = text;
    this.splitTimer = seconds;
  }

  /** Respawn at the last checkpoint during a run, otherwise at the map spawn. */
  respawn(manual: boolean): void {
    const point = this.run === 'running'
      ? this.respawnPoint
      : { pos: { x: this.map.spawn.pos[0], y: this.map.spawn.pos[1], z: this.map.spawn.pos[2] }, yaw: this.map.spawn.yaw };
    const fresh = createPlayer(point.pos);
    Object.assign(this.player, fresh);
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

    // Smooth crouch/slide camera height.
    const targetEye = eyeHeight(p);
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 14);

    // Landing dip spring.
    this.dipVel += (-this.dip * 120 - this.dipVel * 14) * dt;
    this.dip += this.dipVel * dt;

    this.camera.position.set(x, y + this.eye + this.dip * 0.08, z);
    this.camera.rotation.set(this.input.pitch, this.input.yaw, 0);

    // Speed adds a little field of view, so going fast feels fast.
    const speed = horizontalSpeed(p);
    const fov = this.settings().fov + Math.max(0, Math.min(10, (speed - MOVEMENT.runSpeed) * 1.1));
    const vfov = horizontalToVerticalFov(fov, this.camera.aspect);
    if (Math.abs(this.camera.fov - vfov) > 0.01) {
      this.camera.fov += (vfov - this.camera.fov) * Math.min(1, dt * 8);
      this.camera.updateProjectionMatrix();
    }

    // Gun bob.
    const bob = p.onGround && !p.sliding ? Math.min(speed / 6, 1.4) : 0;
    const t = this.time;
    this.viewmodel.position.set(
      0.26 + Math.sin(t * 9) * 0.012 * bob,
      -0.24 + Math.abs(Math.cos(t * 9)) * 0.012 * bob - (p.sliding ? 0.04 : 0) + this.dip * 0.03,
      -0.5,
    );
    this.viewmodel.rotation.z += ((p.sliding ? 0.25 : 0) - this.viewmodel.rotation.z) * Math.min(1, dt * 12);

    this.world.clouds.position.x = (t * 0.6) % 60;
  }

  hud(): HudState {
    const p = this.player;
    const cooldownFrac = p.sliding ? 0 : 1 - Math.min(1, p.slideCooldown / MOVEMENT.slideCooldown);
    return {
      speed: horizontalSpeed(p),
      onGround: p.onGround,
      sliding: p.sliding,
      slideReady: cooldownFrac,
      wallJumpsLeft: p.wallJumpsLeft,
      weapon: this.weapon,
      run: this.run,
      runTime: this.runTime,
      best: this.best,
      splitText: this.splitText,
      checkpoint: this.lastCheckpoint,
    };
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.fov = horizontalToVerticalFov(this.settings().fov, this.camera.aspect);
    this.camera.updateProjectionMatrix();
  }
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
