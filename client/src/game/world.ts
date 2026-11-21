import * as THREE from 'three';
import type { Box, MapDef, Ramp, Zone } from '@blockfire/shared';
import { pixelTexture, skyTexture } from './textures.js';

/** Each texture pixel-block covers this many metres. */
const TILE = 1;

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

  const tex = pixelTexture(b.color, b.material ?? 'stone');
  const mat = new THREE.MeshLambertMaterial({
    map: tex,
    emissive: b.material === 'neon' ? new THREE.Color(b.color) : new THREE.Color(0x000000),
    emissiveIntensity: b.material === 'neon' ? 0.35 : 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
  mesh.castShadow = sy > 0.3;
  mesh.receiveShadow = true;
  return mesh;
}

/** A wedge-shaped ramp: sloped top, two triangle sides and a back wall. */
function rampMesh(r: Ramp): THREE.Mesh {
  const { x0, x1, z0, z1, low, high } = r;
  const base = Math.min(low, 0) - 0.01;
  // Heights at the four top corners.
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
  quad(A, D, Cc, B, 'xz');   // top (counter-clockwise seen from above)
  quad(a, b, B, A, 'xy');    // -z side
  quad(c, d, D, Cc, 'xy');   // +z side
  quad(d, a, A, D, 'zy');    // -x side
  quad(b, c, Cc, B, 'zy');   // +x side

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ map: pixelTexture(r.color, 'wood'), side: THREE.DoubleSide });
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
  // Glowing floor pad.
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(sx, sz),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set((z.min[0] + z.max[0]) / 2, z.min[1] + 0.02, (z.min[2] + z.max[2]) / 2);
  group.add(pad);
  // Two pillars + a banner bar, like a race gate.
  const pillarMat = new THREE.MeshLambertMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: 0.5 });
  const cz = (z.min[2] + z.max[2]) / 2;
  for (const x of [z.min[0] + 0.25, z.max[0] - 0.25]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.2, 0.4), pillarMat);
    p.position.set(x, z.min[1] + 1.6, cz);
    group.add(p);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.5, 0.4), pillarMat);
  bar.position.set((z.min[0] + z.max[0]) / 2, z.min[1] + 3.2, cz);
  group.add(bar);
  return group;
}

/** Deterministic blocky clouds floating above the map. */
function clouds(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, fog: false });
  let s = 7;
  const rand = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 26; i++) {
    const cloud = new THREE.Group();
    const parts = 2 + Math.floor(rand() * 3);
    for (let j = 0; j < parts; j++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(6 + rand() * 8, 1.5 + rand(), 4 + rand() * 6), mat);
      m.position.set(j * 4 - 4, rand() * 0.8, rand() * 3 - 1.5);
      cloud.add(m);
    }
    cloud.position.set(rand() * 260 - 130, 38 + rand() * 18, rand() * 260 - 130);
    group.add(cloud);
  }
  return group;
}

export interface BuiltWorld {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  clouds: THREE.Group;
}

export function buildWorld(map: MapDef): BuiltWorld {
  const scene = new THREE.Scene();
  scene.background = skyTexture(map.sky.top, map.sky.bottom);
  scene.fog = new THREE.Fog(map.sky.fog, 70, 190);

  scene.add(new THREE.HemisphereLight(0xdfefff, 0x5a6a4a, 1.25));
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
  sun.position.set(40, 70, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = -75; cam.right = 75; cam.top = 75; cam.bottom = -75; cam.near = 1; cam.far = 200;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  for (const b of map.boxes) scene.add(boxMesh(b));
  for (const r of map.ramps) scene.add(rampMesh(r));
  for (const z of map.zones) scene.add(zoneMesh(z));

  // A deep "void" floor far below the pit, so falling looks like falling.
  const voidFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshBasicMaterial({ color: 0x1b1530 }),
  );
  voidFloor.rotation.x = -Math.PI / 2;
  voidFloor.position.y = -40;
  scene.add(voidFloor);

  const sky = clouds();
  scene.add(sky);
  return { scene, sun, clouds: sky };
}
