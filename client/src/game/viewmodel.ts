import * as THREE from 'three';
import type { RarityId, WeaponDef } from '@blockfire/shared';
import { buildWeaponModel, type WeaponModel } from './weapon-models.js';

export interface ViewmodelState {
  speed: number;
  onGround: boolean;
  sliding: boolean;
  /** 0..1 progress through a reload, or -1 when not reloading. */
  reload: number;
  /** 0..1 how far into aim-down-sights. */
  ads: number;
}

/**
 * The weapon held in front of the camera: sway, bob, slide tilt, swap, recoil kick,
 * reload dip, melee swing, and sliding to the centre when aiming down sights.
 */
export class Viewmodel {
  readonly hand = new THREE.Group();
  private model: WeaponModel | null = null;
  private key = '';
  private weapon: WeaponDef | null = null;
  private swap = 0;
  private kick = 0;
  private kickVel = 0;
  private swing = 0;
  private swayX = 0;
  private swayY = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private dip = 0;
  private dipVel = 0;
  private time = 0;
  private hip = new THREE.Vector3();

  constructor(camera: THREE.Camera) {
    camera.add(this.hand);
    const fill = new THREE.PointLight(0xffffff, 0.12, 1.2);
    fill.position.set(0.1, 0.1, 0);
    camera.add(fill);
  }

  set(w: WeaponDef, rarity: RarityId): void {
    const key = `${w.id}|${rarity}`;
    if (key === this.key) return;
    const swapping = this.weapon !== null && this.weapon.id !== w.id;
    this.key = key;
    this.weapon = w;
    if (this.model) this.hand.remove(this.model.group);
    const model = buildWeaponModel(w.id, rarity);
    const len = Math.max(model.size.z, model.size.x * 0.6);
    const s = THREE.MathUtils.clamp(42 / len, 0.45, 0.8) * 0.01 * (w.slot === 'melee' ? 0.7 : 1);
    model.group.scale.setScalar(s);
    model.group.traverse((o) => { o.castShadow = false; });
    const dual = w.id === 'super_pistols' || w.id === 'dual_heavy_mgs';
    if (w.slot === 'melee') {
      model.group.rotation.set(0.75, 0.35, 0.35);
      this.hip.set(0.2, -0.2, -0.28);
    } else {
      model.group.rotation.set(0, -0.04, 0);
      this.hip.set(dual ? 0 : 0.16, -0.15, -0.26 - model.center.z * s);
    }
    model.group.position.copy(this.hip);
    this.hand.add(model.group);
    this.model = model;
    if (swapping) this.swap = 1;
  }

  /** Called when the local player fires. */
  fire(recoilDeg: number): void {
    if (this.weapon?.slot === 'melee') { this.swing = 1; return; }
    this.kickVel += 0.6 + recoilDeg * 0.25;
  }

  land(): void { this.dipVel -= 1.6; }

  /** Where bullets visually leave the gun, in world space. */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    if (!this.model) return out.set(0, 0, 0);
    const local = new THREE.Vector3(this.model.center.x, this.model.center.y + this.model.size.y * 0.25, this.model.center.z - this.model.size.z / 2);
    return this.model.group.localToWorld(out.copy(local));
  }

  update(dt: number, yaw: number, pitch: number, s: ViewmodelState): void {
    this.time += dt;
    const t = this.time;
    const dYaw = yaw - this.lastYaw;
    const dPitch = pitch - this.lastPitch;
    this.lastYaw = yaw;
    this.lastPitch = pitch;
    this.swayX += (THREE.MathUtils.clamp(dYaw * 2.5, -0.06, 0.06) - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (THREE.MathUtils.clamp(-dPitch * 2.5, -0.06, 0.06) - this.swayY) * Math.min(1, dt * 10);
    this.swap = Math.max(0, this.swap - dt * 4);
    this.swing = Math.max(0, this.swing - dt * 5);
    this.kickVel += (-this.kick * 220 - this.kickVel * 22) * dt;
    this.kick += this.kickVel * dt;
    this.dipVel += (-this.dip * 120 - this.dipVel * 14) * dt;
    this.dip += this.dipVel * dt;

    const adsK = s.ads * (1 - s.ads * 0.15);
    const bob = s.onGround && !s.sliding ? Math.min(s.speed / 6, 1.4) * (1 - s.ads * 0.8) : 0;
    const reloading = s.reload >= 0 ? Math.sin(Math.min(1, s.reload) * Math.PI) : 0;

    this.hand.position.set(
      this.swayX * (1 - adsK) + Math.sin(t * 9) * 0.008 * bob,
      this.swayY * (1 - adsK) + Math.abs(Math.cos(t * 9)) * 0.008 * bob - (s.sliding ? 0.03 : 0) + this.dip * 0.025 - this.swap * 0.25 - reloading * 0.12,
      this.kick * 0.06,
    );
    this.hand.rotation.set(
      -this.swap * 0.6 + this.kick * 0.35 + reloading * 0.5 - Math.sin(this.swing * Math.PI) * 1.1,
      Math.sin(this.swing * Math.PI) * 0.6,
      THREE.MathUtils.lerp(this.hand.rotation.z, s.sliding ? 0.22 : 0, Math.min(1, dt * 12)) + reloading * 0.35,
    );

    // Aim down sights: slide the gun to the middle of the screen.
    if (this.model && this.weapon && this.weapon.slot !== 'melee') {
      const target = new THREE.Vector3(0, -0.1, this.hip.z + 0.06);
      this.model.group.position.lerpVectors(this.hip, target, adsK);
      // A scoped sniper disappears behind the scope overlay.
      this.model.group.visible = !(this.weapon.zoom >= 2 && s.ads > 0.9);
    }
    this.model?.finish.update(t);
  }
}
