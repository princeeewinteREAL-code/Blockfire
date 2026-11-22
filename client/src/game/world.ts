import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { Box, MapDef, Ramp, Zone } from '@blockfire/shared';
import { pixelTexture, skyTexture } from './textures.js';

/** Each texture pixel-block covers this many metres. */
const TILE = 1;

/** Physically based surface settings per block material. */
const SURFACE: Record<NonNullable<Box['material']>, { rough: number; metal: number; glow: number }> = {
  grass: { rough: 0.95, metal: 0, glow: 0 },
  stone: { rough: 0.85, metal: 0.02, glow: 0 },
  wood: { rough: 0.72, metal: 0, glow: 0 },
  metal: { rough: 0.32, metal: 0.85, glow: 0 },
  ice: { rough: 0.08, metal: 0.1, glow: 0 },
  neon: { rough: 0.35, metal: 0.3, glow: 1.4 },
};

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function blockMaterial(color: string, material: NonNullable<Box['material']>): THREE.MeshStandardMaterial {
  const key = `${color}|${material}`;
  const hit = matCache.get(key);
  if (hit) return hit;
  const s = SURFACE[material];
  const mat = new THREE.MeshStandardMaterial({
    map: pixelTexture(color, material),
    roughness: s.rough,
    metalness: s.metal,
    emissive: s.glow > 0 ? new THREE.Color(color) : new THREE.Color(0x000000),
    emissiveIntensity: s.glow,
  });
  matCache.set(key, mat);
  return mat;
}

/** A box mesh whose texture tiles once per metre on every face. */
function boxMesh(b: Box): THREE.Mesh {
  const sx = b.max[0] - b.min[0];
  const sy = b.max[1] - b.min[1];
  const sz = b.max[2] - b.min[2];
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  // Face order in BoxGeometry: +x, -x, +y, -y, +z, -z (4 vertices each).
  const faceSize: Array<[number, number]> = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) {
    const [u, v] = faceSize[f]!;
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * (u / TILE), uv.getY(idx) * (v / TILE));
    }
  }
  uv.needsUpdate = true;
  const mesh = new THREE.Mesh(geo, blockMaterial(b.color, b.material ?? 'stone'));
  mesh.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
  mesh.castShadow = sy > 0.3;
  mesh.receiveShadow = true;
  return mesh;
}

/** A wedge-shaped ramp: sloped top, two triangle sides and a back wall. */
function rampMesh(r: Ramp): THREE.Mesh {
  const { x0, x1, z0, z1, low, high } = r;
  const base = Math.min(low, 0) - 0.01;
  const h = (x: number, z: number): number => {
    switch (r.rise) {
      case '+x': return x === x1 ? high : low;
      case '-x': return x === x0 ? high : low;
      case '+z': return z === z1 ? high : low;
      case '-z': return z === z0 ? high : low;
    }
  };
  const A = new THREE.Vector3(x0, h(x0, z0), z0);
  const B = new THREE.Vector3(x1, h(x1, z0), z0);
  const Cc = new THREE.Vector3(x1, h(x1, z1), z1);
  const D = new THREE.Vector3(x0, h(x0, z1), z1);
  const a = new THREE.Vector3(x0, base, z0);
  const b = new THREE.Vector3(x1, base, z0);
  const c = new THREE.Vector3(x1, base, z1);
  const d = new THREE.Vector3(x0, base, z1);
  const pos: number[] = [];
  const uvs: number[] = [];
  const quad = (p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, p4: THREE.Vector3, planar: 'xz' | 'xy' | 'zy') => {
    for (const p of [p1, p2, p3, p1, p3, p4]) {
      pos.push(p.x, p.y, p.z);
      if (planar === 'xz') uvs.push(p.x / TILE, p.z / TILE);
      else if (planar === 'xy') uvs.push(p.x / TILE, p.y / TILE);
      else uvs.push(p.z / TILE, p.y / TILE);
    }
  };
  quad(A, D, Cc, B, 'xz');
  quad(a, b, B, A, 'xy');
  quad(c, d, D, Cc, 'xy');
  quad(d, a, A, D, 'zy');
  quad(b, c, Cc, B, 'zy');
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: pixelTexture(r.color, 'wood'), roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const ZONE_COLORS: Record<Zone['kind'], number> = { start: 0x3ddc84, checkpoint: 0x43c9db, finish: 0xb38cff };

function zoneMesh(z: Zone): THREE.Group {
  const group = new THREE.Group();
  const sx = z.max[0] - z.min[0];
  const sz = z.max[2] - z.min[2];
  const color = ZONE_COLORS[z.kind];
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(sx, sz),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false }),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set((z.min[0] + z.max[0]) / 2, z.min[1] + 0.02, (z.min[2] + z.max[2]) / 2);
  group.add(pad);
  const glow = new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: 2.2, roughness: 0.4 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.35, metalness: 0.8 });
  const cz = (z.min[2] + z.max[2]) / 2;
  for (const x of [z.min[0] + 0.25, z.max[0] - 0.25]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.4, 0.5), frame);
    p.position.set(x, z.min[1] + 1.7, cz);
    p.castShadow = true;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3.2, 0.52), glow);
    strip.position.set(x, z.min[1] + 1.7, cz);
    group.add(p, strip);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.55, 0.5), frame);
  bar.position.set((z.min[0] + z.max[0]) / 2, z.min[1] + 3.4, cz);
  const barGlow = new THREE.Mesh(new THREE.BoxGeometry(sx - 0.6, 0.18, 0.52), glow);
  barGlow.position.copy(bar.position);
  group.add(bar, barGlow);
  return group;
}

/** Deterministic blocky clouds floating above the map. */
function clouds(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.35, transparent: true, opacity: 0.92 });
  let s = 7;
  const rand = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 30; i++) {
    const cloud = new THREE.Group();
    const parts = 2 + Math.floor(rand() * 3);
    for (let j = 0; j < parts; j++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(6 + rand() * 9, 1.6 + rand() * 1.2, 4 + rand() * 7), mat);
      m.position.set(j * 4 - 4, rand() * 0.8, rand() * 3 - 1.5);
      cloud.add(m);
    }
    cloud.position.set(rand() * 300 - 150, 42 + rand() * 20, rand() * 300 - 150);
    group.add(cloud);
  }
  return group;
}

/** Smooth pseudo-random height for the surrounding voxel mountains. */
function hillHeight(x: number, z: number): number {
  const n = (a: number, b: number) => {
    const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const smooth = (x0: number, z0: number, scale: number) => {
    const fx = x0 / scale, fz = z0 / scale;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
    const a = n(ix, iz), b = n(ix + 1, iz), c = n(ix, iz + 1), d = n(ix + 1, iz + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  };
  const r = Math.hypot(x, z);
  const rise = Math.min(1, Math.max(0, (r - 64) / 40));
  return 3 + rise * (smooth(x, z, 38) * 34 + smooth(x, z, 14) * 9);
}

/** A ring of blocky mountains around the arena, drawn with instancing so it stays fast. */
function mountains(): THREE.Group {
  const group = new THREE.Group();
  const step = 4;
  const cells: Array<{ x: number; z: number; h: number }> = [];
  for (let x = -150; x <= 150; x += step) {
    for (let z = -150; z <= 150; z += step) {
      if (Math.abs(x) < 64 && Math.abs(z) < 64) continue;
      if (Math.hypot(x, z) > 160) continue;
      cells.push({ x, z, h: Math.round(hillHeight(x, z) / 2) * 2 });
    }
  }
  const body = new THREE.InstancedMesh(
    new THREE.BoxGeometry(step, 1, step),
    new THREE.MeshStandardMaterial({ map: pixelTexture('#9a8f84', 'stone'), roughness: 0.95 }),
    cells.length,
  );
  const cap = new THREE.InstancedMesh(
    new THREE.BoxGeometry(step, 1, step),
    new THREE.MeshStandardMaterial({ map: pixelTexture('#ffffff', 'grass'), roughness: 0.95 }),
    cells.length,
  );
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  cells.forEach((c, i) => {
    const bodyH = Math.max(0.5, c.h - 1);
    m.makeScale(1, bodyH, 1).setPosition(c.x, bodyH / 2 - 1, c.z);
    body.setMatrixAt(i, m);
    m.makeScale(1, 1, 1).setPosition(c.x, c.h - 0.5, c.z);
    cap.setMatrixAt(i, m);
    if (c.h > 30) col.set('#f4f7fb');
    else if (c.h > 20) col.set('#a7a39b');
    else col.set('#5fae4e').offsetHSL(0, 0, (Math.sin(c.x * 0.3 + c.z * 0.7) * 0.5) * 0.06);
    cap.setColorAt(i, col);
  });
  body.receiveShadow = true;
  cap.receiveShadow = true;
  group.add(body, cap);
  return group;
}

/** A glowing, slowly flowing lava texture. */
function lavaTexture(): THREE.CanvasTexture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.sin(x * 0.35) * Math.cos(y * 0.28) + Math.sin((x + y) * 0.15);
      const t = (v + 2) / 4;
      const r = 255;
      const gg = Math.floor(70 + t * 150);
      const b = Math.floor(t * t * 60);
      g.fillStyle = `rgb(${r},${gg},${b})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface BuiltWorld {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  update(t: number): void;
}

export function buildWorld(map: MapDef, renderer: THREE.WebGLRenderer, shadowSize: number): BuiltWorld {
  const scene = new THREE.Scene();

  // Background: a clean sky gradient plus a glowing sun disc (it blooms on Medium and up).
  scene.background = skyTexture(map.sky.top, map.sky.bottom);
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 32), THREE.MathUtils.degToRad(150));
  const night = map.lighting === 'night';
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(night ? 6 : 9, 32),
    new THREE.MeshBasicMaterial({ color: (night ? new THREE.Color(0.85, 0.9, 1) : new THREE.Color(1, 0.95, 0.85)).multiplyScalar(night ? 1.6 : 3), fog: false }),
  );
  sunDisc.position.copy(sunDir).multiplyScalar(330);
  sunDisc.lookAt(0, 0, 0);
  scene.add(sunDisc);

  // Reflections: bake a physically based sky into an environment map for metal and glass.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene();
  const sky = new Sky();
  sky.scale.setScalar(350);
  const u = sky.material.uniforms;
  u['turbidity']!.value = 5;
  u['rayleigh']!.value = 1.4;
  u['mieCoefficient']!.value = 0.004;
  u['mieDirectionalG']!.value = 0.82;
  u['sunPosition']!.value.copy(sunDir);
  skyScene.add(sky);
  scene.environment = pmrem.fromScene(skyScene, 0.02).texture;
  scene.environmentIntensity = night ? 0.08 : 0.32;
  pmrem.dispose();

  scene.fog = night ? new THREE.Fog(map.sky.fog, 40, 160) : new THREE.Fog(map.sky.fog, 120, 340);

  scene.add(night ? new THREE.HemisphereLight(0x6a6aff, 0x1a1020, 0.55) : new THREE.HemisphereLight(0xcfe3ff, 0x4a5536, 0.7));
  const sun = night ? new THREE.DirectionalLight(0x9db4ff, 0.75) : new THREE.DirectionalLight(0xfff0d8, 1.9);
  sun.position.copy(sunDir).multiplyScalar(90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const cam = sun.shadow.camera;
  cam.left = -78; cam.right = 78; cam.top = 78; cam.bottom = -78; cam.near = 1; cam.far = 220;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);

  for (const b of map.boxes) scene.add(boxMesh(b));
  for (const r of map.ramps) scene.add(rampMesh(r));
  for (const z of map.zones) scene.add(zoneMesh(z));
  if (!night) scene.add(mountains());
  else {
    // Neon glow: coloured lights near each glowing block so the neon actually lights the yard.
    const glowSpots = map.boxes.filter((b) => b.material === 'neon' && (b.max[1] - b.min[1]) < 1 && (b.max[0] - b.min[0]) < 3);
    for (const b of glowSpots.slice(0, 6)) {
      const l = new THREE.PointLight(new THREE.Color(b.color), 40, 22, 1.8);
      l.position.set((b.min[0] + b.max[0]) / 2, b.min[1] - 0.6, (b.min[2] + b.max[2]) / 2);
      scene.add(l);
    }
    // Stars.
    const starGeo = new THREE.BufferGeometry();
    const pts: number[] = [];
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 700; i++) {
      const th = rnd() * Math.PI * 2, ph = rnd() * Math.PI * 0.45;
      pts.push(Math.cos(th) * Math.sin(ph) * 300, Math.cos(ph) * 300, Math.sin(th) * Math.sin(ph) * 300);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false, fog: false })));
  }

  let lavaTex: THREE.CanvasTexture | null = null;
  if (map.lava) {
    const l = map.lava;
    lavaTex = lavaTexture();
    lavaTex.repeat.set((l.x1 - l.x0) / 8, (l.z1 - l.z0) / 8);
    const lava = new THREE.Mesh(
      new THREE.PlaneGeometry(l.x1 - l.x0, l.z1 - l.z0),
      new THREE.MeshStandardMaterial({ color: 0x220800, emissive: 0xffffff, emissiveMap: lavaTex, emissiveIntensity: 1.6, roughness: 0.6 }),
    );
    lava.rotation.x = -Math.PI / 2;
    lava.position.set((l.x0 + l.x1) / 2, l.y, (l.z0 + l.z1) / 2);
    scene.add(lava);
    // Dark pit walls down to the lava.
    const wallMat = new THREE.MeshStandardMaterial({ map: pixelTexture('#4a3a33', 'stone'), roughness: 0.9 });
    const depth = -l.y;
    const walls: Array<[number, number, number, number]> = [
      [l.x0, l.z0, l.x1, l.z0 + 0.01], [l.x0, l.z1 - 0.01, l.x1, l.z1], [l.x0, l.z0, l.x0 + 0.01, l.z1], [l.x1 - 0.01, l.z0, l.x1, l.z1],
    ];
    for (const [ax, az, bx, bz] of walls) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.5, bx - ax), depth, Math.max(0.5, bz - az)), wallMat);
      w.position.set((ax + bx) / 2, l.y / 2 - 0.5, (az + bz) / 2);
      scene.add(w);
    }
    const glow = new THREE.PointLight(0xff6a1f, 60, 40, 1.6);
    glow.position.set((l.x0 + l.x1) / 2, l.y + 3, (l.z0 + l.z1) / 2);
    scene.add(glow);
  }

  const sky2 = clouds();
  if (!night) scene.add(sky2);

  return {
    scene,
    sun,
    update(t: number) {
      sky2.position.x = (t * 0.6) % 80;
      if (lavaTex) { lavaTex.offset.x = t * 0.02; lavaTex.offset.y = Math.sin(t * 0.2) * 0.05; }
    },
  };
}
