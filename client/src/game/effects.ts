import * as THREE from 'three';
import { RARITY_BY_ID, WEAPON_BY_ID, type Projectile, type RarityId } from '@blockfire/shared';

interface Tracer { mesh: THREE.Mesh; life: number; max: number }
interface Burst { pos: THREE.Vector3; vel: THREE.Vector3; life: number; max: number; color: THREE.Color; size: number }
interface Blast { mesh: THREE.Mesh; light: THREE.PointLight; life: number; max: number; radius: number }

/** Tracer colour by rarity (Basic/Common use warm yellow). */
export function tracerColor(r: RarityId): THREE.Color {
  if (r === 'basic' || r === 'common') return new THREE.Color('#ffd36a');
  if (r === 'lifelong') return new THREE.Color('#ffffff');
  return new THREE.Color(RARITY_BY_ID[r].color);
}

const PROJECTILE_LOOK: Record<string, { color: string; size: [number, number, number]; glow: number }> = {
  bomber: { color: '#ffb347', size: [0.16, 0.16, 0.3], glow: 1.1 },
  k2_bomber: { color: '#ff3b1f', size: [0.38, 0.38, 0.6], glow: 1.6 },
  electronic_gun: { color: '#38e1ff', size: [0.06, 0.06, 0.6], glow: 2 },
  firecrackers: { color: '#ff4fd8', size: [0.1, 0.1, 0.22], glow: 1.8 },
  rocketeer: { color: '#ffd36a', size: [0.1, 0.1, 0.24], glow: 1.2 },
  flare_pistol: { color: '#ff4b2b', size: [0.12, 0.12, 0.12], glow: 2.5 },
  sticky_bomb: { color: '#7dff5a', size: [0.2, 0.2, 0.2], glow: 1.4 },
};

/**
 * All short-lived visual effects in a match: bullet tracers, muzzle flashes, sparks,
 * explosions and in-flight projectiles. Everything is pooled so it stays fast.
 */
export class Effects {
  private tracers: Tracer[] = [];
  private bursts: Burst[] = [];
  private blasts: Blast[] = [];
  private sparkMesh: THREE.InstancedMesh;
  private flash: THREE.PointLight;
  private flashLife = 0;
  private projMeshes = new Map<number, THREE.Mesh>();
  private fireworkColors = ['#ff4fd8', '#ffd23f', '#3ddc84', '#38e1ff', '#ff5a1f'].map((c) => new THREE.Color(c));
  shake = 0;

  constructor(private scene: THREE.Scene) {
    this.sparkMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      600,
    );
    this.sparkMesh.count = 0;
    this.sparkMesh.frustumCulled = false;
    scene.add(this.sparkMesh);
    this.flash = new THREE.PointLight(0xffd9a0, 0, 7, 2);
    scene.add(this.flash);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color: THREE.Color, thick = 0.012): void {
    const len = from.distanceTo(to);
    if (len < 0.3) return;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(thick, thick, len),
      new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.4), transparent: true, opacity: 0.55, toneMapped: false, depthWrite: false }),
    );
    mesh.position.copy(from).lerp(to, 0.5);
    mesh.lookAt(to);
    this.scene.add(mesh);
    this.tracers.push({ mesh, life: 0.045, max: 0.045 });
  }

  /** A quick light flash at the gun (only for your own shots). */
  muzzle(at: THREE.Vector3): void {
    this.flash.position.copy(at);
    this.flash.color.set(1, 0.85, 0.6);
    this.flash.intensity = 1.6;
    this.flashLife = 0.035;
  }

  sparks(at: THREE.Vector3, color: THREE.Color, count: number, speed: number, size = 0.05): void {
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random()));
      this.bursts.push({ pos: at.clone(), vel: v, life: 0.2 + Math.random() * 0.2, max: 0.4, color: color.clone().multiplyScalar(1.2), size });
    }
  }

  /** Blocks flying apart (deaths) — pass the character's colours. */
  shatter(at: THREE.Vector3, colors: THREE.Color[]): void {
    for (let i = 0; i < 14; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 1.2 + 0.3, Math.random() - 0.5).multiplyScalar(6);
      const p = at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, Math.random() * 1.6, (Math.random() - 0.5) * 0.5));
      this.bursts.push({ pos: p, vel: v, life: 0.9 + Math.random() * 0.5, max: 1.4, color: colors[i % colors.length]!.clone(), size: 0.12 });
    }
  }

  explosion(at: THREE.Vector3, radius: number, weapon: string): void {
    const big = weapon === 'k2_bomber';
    const color = weapon === 'sticky_bomb' ? new THREE.Color('#9dff5a') : new THREE.Color('#ff8a2b');
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2), transparent: true, opacity: 0.7, toneMapped: false, depthWrite: false }),
    );
    mesh.position.copy(at);
    const light = new THREE.PointLight(color, big ? 60 : 25, radius * 3, 2);
    light.position.copy(at);
    this.scene.add(mesh, light);
    this.blasts.push({ mesh, light, life: big ? 0.6 : 0.4, max: big ? 0.6 : 0.4, radius });
    this.sparks(at, new THREE.Color('#ffcf6a'), big ? 26 : 12, big ? 12 : 8, big ? 0.12 : 0.08);
    this.sparks(at, new THREE.Color('#444444'), big ? 12 : 6, big ? 7 : 5, 0.16);
  }

  /** Keep projectile meshes in sync with the match. */
  syncProjectiles(list: Projectile[], t: number): void {
    const alive = new Set<number>();
    for (const p of list) {
      alive.add(p.id);
      let m = this.projMeshes.get(p.id);
      if (!m) {
        const look = PROJECTILE_LOOK[p.weapon] ?? { color: '#ffffff', size: [0.1, 0.1, 0.2], glow: 2 };
        const color = p.weapon === 'firecrackers' ? this.fireworkColors[p.id % this.fireworkColors.length]! : new THREE.Color(look.color);
        m = new THREE.Mesh(
          new THREE.BoxGeometry(...look.size),
          new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(look.glow), toneMapped: false }),
        );
        this.scene.add(m);
        this.projMeshes.set(p.id, m);
      }
      m.position.set(p.pos.x, p.pos.y, p.pos.z);
      if (!p.stuck) m.lookAt(p.pos.x + p.vel.x, p.pos.y + p.vel.y, p.pos.z + p.vel.z);
      else m.scale.setScalar(1 + 0.25 * Math.sin(t * 30));
      // Trails for slow explosive shells.
      if (!p.stuck && WEAPON_BY_ID[p.weapon]?.splash && Math.random() < 0.25) {
        this.bursts.push({ pos: m.position.clone(), vel: new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.5, (Math.random() - 0.5) * 0.4), life: 0.4, max: 0.4, color: new THREE.Color('#888888'), size: 0.1 });
      }
    }
    for (const [id, m] of this.projMeshes) {
      if (alive.has(id)) continue;
      this.scene.remove(m);
      m.geometry.dispose();
      this.projMeshes.delete(id);
    }
  }

  update(dt: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i]!;
      tr.life -= dt;
      (tr.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, tr.life / tr.max) * 0.9;
      if (tr.life <= 0) {
        this.scene.remove(tr.mesh);
        tr.mesh.geometry.dispose();
        (tr.mesh.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i]!;
      b.life -= dt;
      const k = 1 - b.life / b.max;
      b.mesh.scale.setScalar(0.3 + b.radius * Math.pow(k, 0.5));
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k) * 0.85;
      b.light.intensity *= Math.pow(0.02, dt);
      if (b.life <= 0) {
        this.scene.remove(b.mesh, b.light);
        b.mesh.geometry.dispose();
        this.blasts.splice(i, 1);
      }
    }
    this.flashLife -= dt;
    if (this.flashLife <= 0) this.flash.intensity = 0;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let n = 0;
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      b.life -= dt;
      if (b.life <= 0) { this.bursts.splice(i, 1); continue; }
      b.vel.y -= 14 * dt;
      b.pos.addScaledVector(b.vel, dt);
      if (n >= 600) continue;
      const s = b.size * Math.min(1, b.life / b.max + 0.3);
      m.compose(b.pos, q, new THREE.Vector3(s, s, s));
      this.sparkMesh.setMatrixAt(n, m);
      this.sparkMesh.setColorAt(n, b.color);
      n++;
    }
    this.sparkMesh.count = n;
    this.sparkMesh.instanceMatrix.needsUpdate = true;
    if (this.sparkMesh.instanceColor) this.sparkMesh.instanceColor.needsUpdate = true;
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }
}
