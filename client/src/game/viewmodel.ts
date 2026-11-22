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
  private arms = new THREE.Group();
  private armR: THREE.Mesh;
  private armL: THREE.Mesh;

  constructor(camera: THREE.Camera) {
    camera.add(this.hand);
    // Blocky arms: a sleeve with a skin-coloured hand, like a Minecraft arm.
    const sleeve = new THREE.MeshStandardMaterial({ color: '#2f80ed', roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: '#e0a882', roughness: 0.8 });
    const makeArm = () => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.42), sleeve);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.1), skin);
      hand.position.z = -0.24;
      arm.add(hand);
      return arm;
    };
    this.armR = makeArm();
    this.armL = makeArm();
    this.arms.add(this.armR, this.armL);
    this.hand.add(this.arms);
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
    // Held weapons glow far less than in the Armory, so they never cover the screen.
    const model = buildWeaponModel(w.id, rarity, 0.2);
    // Size each weapon by its type, Krunker-style: long guns ~48 cm, pistols ~24 cm.
    const dual = w.id === 'super_pistols' || w.id === 'dual_heavy_mgs';
    const targetLen = w.slot === 'melee' ? 0.3 : w.slot === 'secondary' ? 0.24 : dual ? 0.34 : 0.48;
    const len = Math.max(model.size.z, 1);
    const s = Math.min(0.012, targetLen / len);
    model.group.scale.setScalar(s);
    model.group.traverse((o) => { o.castShadow = false; });
    if (w.slot === 'melee') {
      model.group.rotation.set(0.55, 0.3, 0.25);
      this.hip.set(0.2, -0.19, -0.3);
    } else {
      // Grip sits low on the right; the barrel points slightly in toward the crosshair.
      model.group.rotation.set(0.02, 0.035, 0);
      this.hip.set(dual ? 0 : 0.13, -0.14, -0.2 - model.center.z * s * 0.35);
    }
    model.group.position.copy(this.hip);
    this.hand.add(model.group);
    this.model = model;

    // Arms: right hand on the grip, left hand on the front of long guns.
    const grip = this.hip.clone().add(new THREE.Vector3(0, -0.04, 0.05));
    this.armR.position.copy(grip).add(new THREE.Vector3(0.05, -0.08, 0.2));
    this.armR.rotation.set(0.35, 0.18, 0);
    const twoHanded = w.slot === 'primary' && !dual;
    this.armL.visible = twoHanded || dual;
    if (dual) {
      this.armL.position.set(-this.armR.position.x, this.armR.position.y, this.armR.position.z);
      this.armL.rotation.set(0.35, -0.18, 0);
    } else {
      const front = this.hip.clone().add(new THREE.Vector3(-0.01, -0.06, (model.center.z - model.size.z * 0.15) * s));
      this.armL.position.copy(front).add(new THREE.Vector3(-0.16, -0.1, 0.16));
      this.armL.rotation.set(0.4, -0.75, 0);
    }
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
      const target = new THREE.Vector3(0, -0.135, this.hip.z + 0.02);
      this.model.group.position.lerpVectors(this.hip, target, adsK);
      this.arms.position.set(-this.hip.x * adsK, (-0.135 - this.hip.y) * adsK, 0.02 * adsK);
      // A scoped sniper disappears behind the scope overlay.
      this.model.group.visible = !(this.weapon.zoom >= 2 && s.ads > 0.9);
    }
    this.model?.finish.update(t);
  }
}
