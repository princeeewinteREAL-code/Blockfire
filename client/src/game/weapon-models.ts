import * as THREE from 'three';
import type { RarityId } from '@blockfire/shared';

/**
 * Blocky 3D weapon models, built from simple parts (boxes, cylinders, cones, rings).
 * Units are centimetres; the barrel points toward -Z, the grip sits near the origin, +Y is up.
 * Every model uses the same 9 material slots, so one rarity "finish" restyles any weapon.
 */
export type MatKey = 'body' | 'accent' | 'metal' | 'grip' | 'glass' | 'blade' | 'wood' | 'gold' | 'bone';

// ---------------- Rarity finishes ----------------

interface FinishSpec {
  body: string; accent: string; glow: number; bodyMetal: number; bodyRough: number;
  pattern?: 'camo' | 'carbon' | 'circuit' | 'engrave' | 'stripes';
  animate?: 'rainbow' | 'flame' | 'pulse' | 'shimmer';
}

const FINISHES: Record<RarityId, FinishSpec> = {
  basic: { body: '#5b616b', accent: '#9aa3ad', glow: 0, bodyMetal: 0.35, bodyRough: 0.62 },
  common: { body: '#8a7656', accent: '#c9b38a', glow: 0, bodyMetal: 0.2, bodyRough: 0.7, pattern: 'stripes' },
  uncommon: { body: '#2c7a4f', accent: '#7cf0a8', glow: 0.25, bodyMetal: 0.2, bodyRough: 0.65, pattern: 'camo' },
  rare: { body: '#1d4fae', accent: '#6fb2ff', glow: 0.55, bodyMetal: 0.45, bodyRough: 0.38, pattern: 'carbon' },
  epic: { body: '#2c1450', accent: '#c86bff', glow: 1.1, bodyMetal: 0.5, bodyRough: 0.32, pattern: 'circuit', animate: 'pulse' },
  legendary: { body: '#d4a12a', accent: '#ffd76a', glow: 1.0, bodyMetal: 1, bodyRough: 0.22, pattern: 'engrave', animate: 'shimmer' },
  uncontrollable: { body: '#1a1a24', accent: '#ff4fd8', glow: 1.4, bodyMetal: 0.6, bodyRough: 0.25, pattern: 'circuit', animate: 'rainbow' },
  hot: { body: '#2a0e05', accent: '#ff5a1f', glow: 1.6, bodyMetal: 0.4, bodyRough: 0.4, pattern: 'stripes', animate: 'flame' },
  lifelong: { body: '#f1f1f4', accent: '#bfe6ff', glow: 1.1, bodyMetal: 0.65, bodyRough: 0.18, pattern: 'engrave', animate: 'pulse' },
};

function patternTexture(kind: NonNullable<FinishSpec['pattern']>, base: string, accent: string): THREE.CanvasTexture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, s, s);
  const dark = new THREE.Color(base).offsetHSL(0, 0, -0.08).getStyle();
  const light = new THREE.Color(base).offsetHSL(0, 0, 0.08).getStyle();
  let seed = 3;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  switch (kind) {
    case 'camo':
      for (let i = 0; i < 18; i++) {
        g.fillStyle = i % 2 ? dark : light;
        g.fillRect(Math.floor(r() * s), Math.floor(r() * s), 6 + Math.floor(r() * 14), 4 + Math.floor(r() * 10));
      }
      break;
    case 'carbon':
      for (let y = 0; y < s; y += 4) for (let x = 0; x < s; x += 4) {
        g.fillStyle = (x + y) % 8 === 0 ? dark : light;
        g.fillRect(x, y, 4, 4);
      }
      break;
    case 'circuit':
      g.strokeStyle = accent;
      g.globalAlpha = 0.5;
      g.lineWidth = 1;
      for (let i = 0; i < 10; i++) {
        const x = Math.floor(r() * s), y = Math.floor(r() * s);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + 12, y); g.lineTo(x + 12, y + 10); g.stroke();
        g.fillStyle = accent; g.fillRect(x + 11, y + 9, 3, 3);
      }
      break;
    case 'engrave':
      g.strokeStyle = dark;
      g.lineWidth = 1;
      for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(r() * s, r() * s, 6 + r() * 10, 0, Math.PI * 1.5); g.stroke(); }
      break;
    case 'stripes':
      g.fillStyle = dark;
      for (let x = -s; x < s; x += 10) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 5, 0); g.lineTo(x + s + 5, s); g.lineTo(x + s, s); g.fill(); }
      break;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

export interface Finish {
  mats: Record<MatKey, THREE.MeshStandardMaterial>;
  /** Animate the finish (rainbow shift, flame flicker…). Call every frame. */
  update(t: number): void;
}

export function makeFinish(rarity: RarityId, glowScale = 1): Finish {
  const f = { ...FINISHES[rarity], glow: FINISHES[rarity].glow * glowScale };
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  const accentColor = new THREE.Color(f.accent);
  const mats: Record<MatKey, THREE.MeshStandardMaterial> = {
    body: std({
      color: f.pattern ? 0xffffff : f.body,
      map: f.pattern ? patternTexture(f.pattern, f.body, f.accent) : null,
      metalness: f.bodyMetal, roughness: f.bodyRough,
    }),
    accent: std({ color: accentColor, emissive: accentColor, emissiveIntensity: f.glow, metalness: 0.3, roughness: 0.3 }),
    metal: std({ color: rarity === 'lifelong' ? '#1c1c22' : '#2b3038', metalness: 0.85, roughness: 0.32 }),
    grip: std({ color: rarity === 'lifelong' ? '#111114' : '#22252b', metalness: 0.05, roughness: 0.85 }),
    glass: std({ color: '#8fe3ff', emissive: rarity === 'basic' || rarity === 'common' ? '#1d5d7a' : accentColor, emissiveIntensity: 0.5 * glowScale, metalness: 0.1, roughness: 0.05 }),
    blade: std({ color: rarity === 'legendary' ? '#f0d58a' : '#d7dce3', metalness: 1, roughness: 0.18 }),
    wood: std({ color: '#8a5a33', metalness: 0, roughness: 0.7 }),
    gold: std({ color: '#e2b33c', metalness: 1, roughness: 0.24 }),
    bone: std({ color: '#e9dcc0', metalness: 0, roughness: 0.55 }),
  };
  return {
    mats,
    update(t: number) {
      const a = mats.accent;
      switch (f.animate) {
        case 'rainbow': {
          a.color.setHSL((t * 0.25) % 1, 1, 0.55);
          a.emissive.copy(a.color);
          mats.glass.emissive.setHSL((t * 0.25 + 0.5) % 1, 1, 0.5);
          break;
        }
        case 'flame':
          a.emissiveIntensity = f.glow * (0.75 + 0.25 * Math.sin(t * 13) * Math.sin(t * 7.3));
          a.emissive.setHSL(0.03 + 0.04 * Math.sin(t * 5), 1, 0.5);
          break;
        case 'pulse':
          a.emissiveIntensity = f.glow * (0.7 + 0.3 * Math.sin(t * 3));
          break;
        case 'shimmer':
          mats.body.roughness = 0.2 + 0.08 * Math.sin(t * 2);
          a.emissiveIntensity = f.glow * (0.8 + 0.2 * Math.sin(t * 4));
          break;
        default:
          break;
      }
    },
  };
}

// ---------------- Part builder ----------------

type Axis = 'x' | 'y' | 'z';

class Builder {
  readonly group = new THREE.Group();
  constructor(private mats: Record<MatKey, THREE.Material>) {}

  private add(geo: THREE.BufferGeometry, mat: MatKey, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh {
    const m = new THREE.Mesh(geo, this.mats[mat]);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.userData['mat'] = mat;
    this.group.add(m);
    return m;
  }

  /** Box: width (x), height (y), depth (z). */
  b(w: number, h: number, d: number, x: number, y: number, z: number, mat: MatKey, rx = 0, ry = 0, rz = 0): this {
    this.add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz);
    return this;
  }

  /** Cylinder of radius r and length len along an axis. */
  c(r: number, len: number, x: number, y: number, z: number, mat: MatKey, axis: Axis = 'z', seg = 14): this {
    const geo = new THREE.CylinderGeometry(r, r, len, seg);
    if (axis === 'z') geo.rotateX(Math.PI / 2);
    if (axis === 'x') geo.rotateZ(Math.PI / 2);
    this.add(geo, mat, x, y, z);
    return this;
  }

  /** Cone pointing toward -Z (or +Z with back = true). */
  k(r: number, len: number, x: number, y: number, z: number, mat: MatKey, back = false): this {
    const geo = new THREE.ConeGeometry(r, len, 12);
    geo.rotateX(back ? Math.PI / 2 : -Math.PI / 2);
    this.add(geo, mat, x, y, z);
    return this;
  }

  /** Ring (torus) whose hole faces along an axis. */
  t(r: number, tube: number, x: number, y: number, z: number, mat: MatKey, axis: Axis = 'z'): this {
    const geo = new THREE.TorusGeometry(r, tube, 8, 20);
    if (axis === 'x') geo.rotateY(Math.PI / 2);
    if (axis === 'y') geo.rotateX(Math.PI / 2);
    this.add(geo, mat, x, y, z);
    return this;
  }

  /** Copy everything built so far, mirrored to the other side (for dual weapons). */
  pairAt(offsetX: number): this {
    const parts = [...this.group.children];
    for (const p of parts) p.position.x += offsetX;
    for (const p of parts) {
      const copy = p.clone();
      copy.position.x = -p.position.x;
      this.group.add(copy);
    }
    return this;
  }
}

// ---------------- Shared sub-assemblies ----------------

function pistolBase(m: Builder, opts: { slideMat?: MatKey; extMag?: boolean } = {}): Builder {
  return m
    .b(2.6, 3.2, 14, 0, 4, -5, opts.slideMat ?? 'body')
    .b(2.8, 0.7, 11, 0, 5.3, -5, 'accent')
    .b(2.4, 2.2, 11, 0, 1.6, -4, 'metal')
    .b(2.6, 9, 4, 0, -3, 1.5, 'grip', -0.25)
    .b(0.8, 0.8, 4.4, 0, -0.5, -3.2, 'metal')
    .b(0.6, 1, 1, 0, 6.1, -11, 'metal')
    .b(1.8, 1, 1, 0, 6.1, 1, 'metal')
    .c(0.8, 1.6, 0, 4, -12.7, 'metal')
    .b(opts.extMag ? 2.2 : 0.01, opts.extMag ? 7 : 0.01, 2.8, 0, -9.5, 2.9, 'metal', -0.25);
}

function revolverBase(m: Builder, big = false): Builder {
  const k = big ? 1.3 : 1;
  return m
    .b(2.4 * k, 3 * k, 16 * k, 0, 4.2 * k, -14 * k, 'metal')
    .b(1 * k, 0.9 * k, 16 * k, 0, 6.1 * k, -14 * k, 'accent')
    .b(2.8 * k, 5 * k, 8 * k, 0, 2.5 * k, -3 * k, 'body')
    .c(3 * k, 6 * k, 0, 3 * k, -4 * k, 'metal', 'z', 8)
    .b(3.2 * k, 0.6 * k, 6.2 * k, 0, 3 * k + 2.6 * k, -4 * k, 'accent')
    .b(1 * k, 2.5 * k, 2 * k, 0, 6 * k, 1.5 * k, 'metal', 0.4)
    .b(2.6 * k, 9 * k, 4 * k, 0, -3 * k, 2.5 * k, 'wood', -0.35)
    .b(0.8, 0.8, 4 * k, 0, -0.5, -3 * k, 'metal')
    .b(0.6, 1.5, 1, 0, 6.8 * k, -21.5 * k, 'metal');
}

function rifleGrip(m: Builder, z = 2): Builder {
  return m.b(3, 8, 4, 0, -4, z, 'grip', -0.3).b(1, 0.8, 5, 0, -1.6, z - 3, 'metal');
}

function knifeBlade(m: Builder, len: number, height: number, x = 0): Builder {
  return m
    .b(0.5, height, len, x, 0.4, -len / 2 - 1.5, 'blade')
    .b(0.5, height * 0.55, 4, x, 0.4 + height * 0.22, -len - 2.6, 'blade', -0.45)
    .b(0.6, 0.4, len * 0.85, x, 0.4 - height / 2 + 0.2, -len / 2 - 1.5, 'accent');
}

// ---------------- The 34 weapons ----------------

const BUILDERS: Record<string, (m: Builder) => void> = {
  // ---- Primaries ----
  assault_rifle: (m) => {
    m.b(5, 7, 22, 0, 2, -4, 'body').b(5.2, 1, 14, 0, 2.6, -4, 'accent')
      .b(4.4, 5, 16, 0, 2, -23, 'body')
      .b(4.6, 0.8, 2, 0, 3.8, -18, 'metal').b(4.6, 0.8, 2, 0, 3.8, -22, 'metal').b(4.6, 0.8, 2, 0, 3.8, -26, 'metal')
      .c(1, 14, 0, 2.5, -38, 'metal').c(1.6, 4, 0, 2.5, -46, 'metal')
      .b(2.4, 1, 30, 0, 6, -12, 'metal').b(3.2, 3.4, 6, 0, 8.2, -6, 'metal').b(2.4, 2.4, 0.4, 0, 8.4, -9.2, 'glass')
      .b(3, 10, 5, 0, -5, -9, 'metal', 0.18)
      .b(3.6, 6, 16, 0, 1, 14, 'body').b(4, 8, 1.5, 0, 0, 22.5, 'grip');
    rifleGrip(m);
  },
  smg: (m) => {
    m.b(5, 7, 18, 0, 2, -3, 'body').b(5.2, 1, 10, 0, 4.2, -3, 'accent')
      .c(1.8, 8, 0, 2, -16, 'metal').c(1.2, 3, 0, 2, -21.5, 'metal')
      .b(2.6, 14, 3.4, 0, -7, -6, 'metal').b(2.6, 7, 3, 0, -3.5, -11, 'grip')
      .b(1, 1, 12, 1.4, 2, 11, 'metal').b(1, 1, 12, -1.4, 2, 11, 'metal').b(4, 6, 1.2, 0, 1, 17, 'grip')
      .b(1, 2, 1, 0, 6.4, -10, 'metal').b(2, 2, 1, 0, 6.4, 4, 'metal');
    rifleGrip(m);
  },
  machine_gun: (m) => {
    m.b(7, 9, 26, 0, 2, -2, 'body').b(7.2, 1.2, 20, 0, 0, -2, 'accent')
      .c(3, 26, 0, 3, -28, 'metal')
      .c(3.2, 1, 0, 3, -20, 'accent').c(3.2, 1, 0, 3, -27, 'accent').c(3.2, 1, 0, 3, -34, 'accent')
      .c(1.3, 12, 0, 3, -46, 'metal').c(2, 4, 0, 3, -54, 'metal')
      .b(2, 2.5, 12, 0, 10, -4, 'metal').b(2, 3, 2, 0, 7.8, -9, 'metal').b(2, 3, 2, 0, 7.8, 1, 'metal')
      .b(7, 8, 9, -5, -3, -4, 'metal').b(2, 2, 6, -1.6, 1.5, -4, 'gold')
      .b(5, 7, 14, 0, 1, 16, 'body').b(5.4, 8, 1.5, 0, 0.5, 23.5, 'grip')
      .b(1, 12, 1, 2.5, -4, -38, 'metal', 0, 0, 0.25).b(1, 12, 1, -2.5, -4, -38, 'metal', 0, 0, -0.25);
    rifleGrip(m, 6);
  },
  sniper: (m) => {
    m.b(5, 6.5, 24, 0, 2, -2, 'body').b(5.2, 1, 18, 0, 1, -2, 'accent')
      .c(1.1, 42, 0, 2.5, -35, 'metal').b(3, 3, 5, 0, 2.5, -57, 'metal')
      .c(2, 26, 0, 9, -4, 'metal').c(3, 5, 0, 9, -17, 'metal').c(2.7, 4, 0, 9, 9, 'metal')
      .c(2.6, 0.4, 0, 9, -19.6, 'glass').c(2.3, 0.4, 0, 9, 11.1, 'glass')
      .c(2.15, 3, 0, 9, -4, 'accent')
      .b(2, 3, 2, 0, 6, -8, 'metal').b(2, 3, 2, 0, 6, 2, 'metal').c(1.2, 2.5, 0, 11.8, -3, 'metal', 'y')
      .b(0.8, 0.8, 4, 3.5, 3, 4, 'metal').c(1, 1.5, 5.8, 3, 4, 'metal', 'x')
      .b(4, 8, 20, 0, 0, 20, 'body').b(3.6, 2.5, 8, 0, 5, 18, 'grip').b(4.4, 9, 1.5, 0, 0, 30.5, 'grip')
      .b(3, 6, 6, 0, -3, -6, 'metal');
    rifleGrip(m, 6);
  },
  speedy_sniper: (m) => {
    m.b(4, 5.5, 20, 0, 2, -2, 'body')
      .b(0.6, 4, 10, 2.4, 2, -14, 'accent').b(0.6, 4, 10, -2.4, 2, -14, 'accent')
      .c(0.9, 34, 0, 2.5, -29, 'metal').c(1.6, 4, 0, 2.5, -47, 'metal')
      .c(1.6, 14, 0, 7.5, -3, 'metal').c(1.5, 0.4, 0, 7.5, -10.2, 'glass').b(1.6, 2.4, 6, 0, 5.2, -3, 'metal')
      .b(1.5, 1.5, 16, 0, 3, 15, 'body').b(1.5, 1.5, 16, 0, -3, 15, 'body').b(1.5, 8, 1.5, 0, 0, 23, 'body')
      .b(1.2, 6.5, 1.2, 0, 0, 15, 'accent', 0.7)
      .b(2.6, 5, 4, 0, -2.5, -5, 'metal');
    rifleGrip(m);
  },
  revolver: (m) => { revolverBase(m); },
  bomber: (m) => {
    m.c(4, 46, 0, 4, -10, 'body').c(4.8, 4, 0, 4, -33, 'accent').c(4.6, 3, 0, 4, 13, 'metal')
      .c(4.2, 1.5, 0, 4, -24, 'accent').k(3.2, 6, 0, 4, -37.5, 'gold')
      .b(3, 8, 3, 0, -4, -16, 'grip').b(1.2, 4, 3, -4.6, 8.5, -18, 'metal').b(1.2, 4, 2, -4.6, 8.5, 2, 'metal');
    rifleGrip(m);
  },
  k2_bomber: (m) => {
    m.c(6, 60, 0, 6, -10, 'body').c(8, 6, 0, 6, -42, 'metal').c(6.6, 6.2, 0, 6, -42, 'accent')
      .b(4, 4, 14, 6.4, 6, -8, 'glass')
      .b(13, 1.2, 1.5, 0, 6, 12, 'metal').b(13, 1.2, 1.5, 0, 6, 15, 'metal').b(13, 1.2, 1.5, 0, 6, 18, 'metal')
      .c(6.6, 3, 0, 6, 21.5, 'metal').b(2, 6, 14, 0, 15, -8, 'metal')
      .b(3, 9, 3, 0, -3, -18, 'grip').b(14, 1.2, 1.2, 0, -0.4, -30, 'accent');
    rifleGrip(m, 4);
  },
  electronic_gun: (m) => {
    m.b(6, 8, 22, 0, 3, -4, 'body').b(1.5, 4, 16, 0, 8.5, -6, 'accent')
      .c(3.4, 1.6, 0, 3, -19, 'accent').c(3.4, 1.6, 0, 3, -23, 'accent').c(3.4, 1.6, 0, 3, -27, 'accent')
      .c(1.6, 16, 0, 3, -24, 'glass')
      .b(1, 1, 8, 2.8, 3, -34, 'metal').b(1, 1, 8, -2.8, 3, -34, 'metal')
      .b(2, 4, 8, 3.6, 1, -2, 'glass').b(4, 6, 8, 0, 2, 11, 'body');
    rifleGrip(m);
  },
  super_pistols: (m) => { pistolBase(m).pairAt(7); },
  dual_heavy_mgs: (m) => {
    m.c(4.5, 12, 0, 4, -2, 'body').c(4.8, 1.5, 0, 4, -8, 'accent');
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      m.c(0.9, 26, Math.cos(a) * 2.4, 4 + Math.sin(a) * 2.4, -20, 'metal', 'z', 8);
    }
    m.c(4, 1.2, 0, 4, -30, 'metal').b(6, 7, 8, 0, -3, 6, 'metal').b(2, 8, 3, 0, -3, -6, 'grip').b(1.6, 3, 10, 0, 10, -2, 'metal');
    m.pairAt(9);
  },

  // ---- Secondaries ----
  pistol: (m) => { pistolBase(m); },
  auto_pistol: (m) => { pistolBase(m, { extMag: true }).b(2.8, 3, 3, 0, 4, -13.5, 'accent'); },
  snake_pistol: (m) => {
    pistolBase(m);
    for (let i = 0; i < 6; i++) m.b(2.9, 0.6, 1.4, 0, 5.75, -10 + i * 2.2, 'accent', 0.2);
    m.b(0.5, 1.6, 0.5, 0.8, 2.2, -11.5, 'blade').b(0.5, 1.6, 0.5, -0.8, 2.2, -11.5, 'blade');
  },
  snake_auto_pistol: (m) => {
    pistolBase(m, { extMag: true });
    for (let i = 0; i < 6; i++) m.b(2.9, 0.6, 1.4, 0, 5.75, -10 + i * 2.2, 'accent', 0.2);
    m.b(0.5, 1.6, 0.5, 0.8, 2.2, -11.5, 'blade').b(0.5, 1.6, 0.5, -0.8, 2.2, -11.5, 'blade').b(2.8, 3, 3, 0, 4, -13.5, 'metal');
  },
  firecrackers: (m) => {
    m.b(3, 4, 9, 0, 3, -2, 'body').b(2.6, 9, 4, 0, -3, 1.5, 'grip', -0.25)
      .c(4, 5, 0, 4, -6, 'metal').c(1.8, 9, 0, 4, -13, 'metal').c(2.2, 1.2, 0, 4, -17.6, 'accent');
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      m.c(0.9, 5.4, Math.cos(a) * 2.6, 4 + Math.sin(a) * 2.6, -6, i % 2 ? 'accent' : 'gold', 'z', 8);
    }
  },
  rocketeer: (m) => {
    m.c(2.6, 18, 0, 5, -4, 'body').c(2.9, 1.5, 0, 5, -12, 'accent').k(2, 5, 0, 5, -15.5, 'gold')
      .b(0.4, 3, 3, 2.6, 5, 5, 'accent').b(0.4, 3, 3, -2.6, 5, 5, 'accent')
      .b(2.6, 9, 4, 0, -2, 1.5, 'grip', -0.25).b(0.8, 0.8, 4.4, 0, 0.5, -2.5, 'metal');
  },
  auto_revolver: (m) => {
    revolverBase(m);
    m.b(1.6, 1, 14, 0, 7.5, -10, 'metal').c(3.5, 6.4, 0, 3, -4, 'metal', 'z', 8).c(3.7, 1, 0, 3, -6.5, 'accent');
  },
  grapple_pistol: (m) => {
    pistolBase(m);
    m.c(2.5, 3, 0, 0.6, -8, 'accent', 'x').c(0.6, 6, 0, 4, -16, 'metal')
      .b(0.6, 0.6, 4, 1.5, 4, -20, 'blade', 0, 0.5).b(0.6, 0.6, 4, -1.5, 4, -20, 'blade', 0, -0.5)
      .b(0.6, 0.6, 4, 0, 5.5, -20, 'blade', 0.5).b(0.6, 0.6, 4, 0, 2.5, -20, 'blade', -0.5);
  },
  hand_cannon: (m) => { revolverBase(m, true); },
  flare_pistol: (m) => {
    m.b(3, 4, 8, 0, 3, -2, 'body').b(2.6, 9, 4, 0, -3, 1.5, 'grip', -0.25)
      .c(2.8, 12, 0, 4, -11, 'accent').c(3.1, 1, 0, 4, -16.6, 'metal').c(1, 3.4, 0, 2, -5, 'metal', 'x');
  },
  sticky_bomb: (m) => {
    m.b(4, 5, 10, 0, 3, -2, 'body').b(2.6, 9, 4, 0, -3, 1.5, 'grip', -0.25)
      .c(3.2, 12, 0, 4, -13, 'metal').c(3.6, 4, 0, 1, -4, 'metal', 'x')
      .b(4.4, 4.4, 4.4, 0, 4, -21, 'accent', 0.3, 0.4).b(3, 3, 3, 0, 4, -21, 'glass');
  },
  sawed_off: (m) => {
    m.c(1.5, 22, 1.6, 4, -12, 'metal').c(1.5, 22, -1.6, 4, -12, 'metal').b(1, 0.6, 22, 0, 5.6, -12, 'accent')
      .b(4.6, 4, 9, 0, 3, 3, 'wood').b(3, 9, 4, 0, -3, 7, 'wood', -0.4).b(4.8, 2, 2, 0, 2, -1, 'metal');
  },

  // ---- Melee ----
  combat_knife: (m) => {
    m.b(2, 2.4, 10, 0, 0, 4, 'grip').b(2.4, 2.8, 1.5, 0, 0, 9.5, 'metal').b(6, 1.4, 1.2, 0, 0, -1.2, 'metal');
    knifeBlade(m, 16, 3.4);
  },
  kitchen_knife: (m) => {
    m.b(2, 2.6, 12, 0, 0, 5, 'wood').c(0.5, 2.2, 0, 0, 2, 'metal', 'x').c(0.5, 2.2, 0, 0, 5, 'metal', 'x').c(0.5, 2.2, 0, 0, 8, 'metal', 'x')
      .b(2.2, 3, 1.5, 0, 0.2, -1.5, 'metal');
    knifeBlade(m, 28, 5);
  },
  katana: (m) => {
    m.b(2.2, 2.6, 24, 0, 0, 10, 'grip');
    for (let i = 0; i < 5; i++) m.b(2.4, 2.8, 1, 0, 0, 2 + i * 4.5, 'accent');
    m.c(4.5, 1, 0, 0, -2.5, 'gold')
      .b(0.5, 3, 24, 0, 0.5, -15, 'blade').b(0.5, 2.8, 24, 0, 1.6, -38, 'blade', 0.06).b(0.5, 2.4, 14, 0, 3.4, -56, 'blade', 0.12)
      .b(0.5, 1.6, 4, 0, 4.6, -64, 'blade', 0.5).b(0.6, 0.5, 60, 0, -0.8, -34, 'accent', 0.07);
  },
  spear: (m) => {
    m.c(1.1, 110, 0, 0, -20, 'wood').c(1.4, 8, 0, 0, 10, 'grip').c(1.4, 3, 0, 0, -68, 'accent').c(1.6, 5, 0, 0, -74, 'metal')
      .b(0.6, 6, 14, 0, 0, -84, 'blade').k(3, 8, 0, 0, -95, 'blade').c(1.8, 1.2, 0, 0, 34, 'accent');
  },
  dragon_tooth: (m) => {
    m.b(3, 3, 12, 0, 0, 5, 'grip').b(7, 2, 2, 0, 0, -2, 'gold').b(1.2, 4, 1.2, 3.4, 1.5, -2, 'gold').b(1.2, 4, 1.2, -3.4, 1.5, -2, 'gold');
    for (let i = 0; i < 6; i++) m.b(2.8 - i * 0.35, 6 - i * 0.8, 7, 0, 1 + i * 1.4, -6 - i * 6.3, 'bone', i * 0.11);
    m.b(0.3, 0.8, 30, 1.25, 2.5, -20, 'accent', 0.22).b(0.3, 0.8, 30, -1.25, 2.5, -20, 'accent', 0.22);
  },
  hammer: (m) => {
    m.c(1.3, 40, 0, 0, -12, 'wood').c(1.6, 10, 0, 0, 6, 'grip')
      .b(18, 9, 9, 0, 0, -34, 'metal').b(1.5, 10, 10, 9.5, 0, -34, 'accent').b(1.5, 10, 10, -9.5, 0, -34, 'accent')
      .b(18.4, 1.5, 9.4, 0, 0, -34, 'gold');
  },
  brass_knuckles: (m) => {
    m.b(14, 3, 3, 0, -3, 0, 'gold');
    for (let i = 0; i < 4; i++) m.t(1.8, 0.9, -5.25 + i * 3.5, 1.4, 0, 'gold', 'z').b(1.2, 1.6, 1.2, -5.25 + i * 3.5, 4.6, 0, 'accent');
  },
  nunchucks: (m) => {
    m.c(1.4, 18, 0, 0, -9, 'wood').c(1.6, 1.5, 0, 0, -0.5, 'accent').c(1.6, 1.5, 0, 0, -17.5, 'accent');
    for (let i = 0; i < 4; i++) m.b(0.7, 0.7, 1.4, 1.8 * i, 0, -19 - i * 1.1, 'metal');
    m.c(1.4, 18, 7, 0, -31, 'wood').c(1.6, 1.5, 7, 0, -23.5, 'accent').c(1.6, 1.5, 7, 0, -39.5, 'accent');
  },
  daggers: (m) => {
    for (const s of [1, -1]) {
      m.b(1.6, 1.8, 7, 3 * s, 0, 3, 'grip', 0, 0.15 * s).b(4, 1, 1, 3 * s, 0, -1, 'gold', 0, 0.15 * s);
      knifeBlade(m, 11, 2.4, 3 * s);
    }
  },
  home_key: (m) => {
    m.t(4, 1.2, 0, 0, 6, 'gold', 'x').b(1.2, 1.6, 16, 0, 0, -6, 'gold')
      .b(1.2, 3, 1.6, 0, -2, -10, 'gold').b(1.2, 2, 1.6, 0, -1.6, -12.5, 'gold').b(1.2, 3.6, 1.6, 0, -2.2, -14.6, 'gold')
      .b(0.8, 5, 6, 0, 0, 14.5, 'accent');
  },
  toothpick: (m) => {
    m.c(0.35, 12, 0, 0, 0, 'wood', 'z', 8).k(0.35, 1.5, 0, 0, -6.75, 'wood').k(0.35, 1.5, 0, 0, 6.75, 'wood', true)
      .c(0.38, 0.6, 0, 0, 3, 'accent', 'z', 8);
  },
};

export interface WeaponModel {
  group: THREE.Group;
  finish: Finish;
  /** Size of the model's bounding box in cm, and its centre. */
  size: THREE.Vector3;
  center: THREE.Vector3;
}

/** Build any weapon in any rarity. Returns a group in centimetres (scale by 0.01 for metres). */
export function buildWeaponModel(id: string, rarity: RarityId, glowScale = 1): WeaponModel {
  const finish = makeFinish(rarity, glowScale);
  const b = new Builder(finish.mats);
  const build = BUILDERS[id];
  if (!build) throw new Error(`No model for weapon "${id}"`);
  build(b);
  const box = new THREE.Box3().setFromObject(b.group);
  return { group: b.group, finish, size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()) };
}

export const MODELLED_WEAPONS = Object.keys(BUILDERS);
