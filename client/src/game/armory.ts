import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RARITY_BY_ID, type RarityId } from '@blockfire/shared';
import { buildWeaponModel, type WeaponModel } from './weapon-models.js';

const HOLO_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vView;
  varying float vY;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vY = wp.y;
    vN = normalize(normalMatrix * normal);
    vec4 mv = viewMatrix * wp;
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const HOLO_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uFlicker;
  varying vec3 vN;
  varying vec3 vView;
  varying float vY;
  void main() {
    float facing = abs(dot(normalize(vN), normalize(vView)));
    float fres = pow(1.0 - facing, 2.2);
    float scan = 0.55 + 0.45 * step(0.5, fract(vY * 22.0 - uTime * 1.6));
    float sweep = 1.0 - smoothstep(0.0, 0.08, abs(fract(vY * 0.45 - uTime * 0.28) - 0.5));
    float alpha = (0.07 + fres * 0.6 + sweep * 0.22) * scan * uFlicker;
    vec3 col = uColor * (0.45 + fres * 1.2) + vec3(1.0) * sweep * 0.35;
    gl_FragColor = vec4(col, alpha);
  }
`;

/** The see-through, scan-lined hologram look. One material shared by every part. */
export function holoMaterial(color: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uTime: { value: 0 }, uFlicker: { value: 1 } },
    vertexShader: HOLO_VERT,
    fragmentShader: HOLO_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** Hologram colour per rarity (Basic/Common use the classic cyan). */
function holoColor(r: RarityId): THREE.Color {
  if (r === 'basic' || r === 'common') return new THREE.Color('#38e1ff');
  if (r === 'lifelong') return new THREE.Color('#e9f4ff');
  return new THREE.Color(RARITY_BY_ID[r].color);
}

/**
 * The Armory: a dark showroom where your selected weapon floats above a projector,
 * either as a hologram or as the real, fully lit model.
 */
export class ArmoryScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  private holder = new THREE.Group();
  private current: WeaponModel | null = null;
  private holoMat = holoMaterial(new THREE.Color('#38e1ff'));
  private edgeMat = new THREE.LineBasicMaterial({ color: '#38e1ff', transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
  private ringMat: THREE.MeshStandardMaterial;
  private beamMat: THREE.ShaderMaterial;
  private particles: THREE.Points;
  private view: 'holo' | 'real' = 'holo';
  private rarity: RarityId = 'basic';
  private spin = 0;
  private dragVel = 0;
  private dragging = false;
  private lastX = 0;
  private time = 0;
  private glitch = 0;

  constructor(renderer: THREE.WebGLRenderer, dom: HTMLElement) {
    const s = this.scene;
    s.background = new THREE.Color('#060913');
    s.fog = new THREE.Fog('#060913', 9, 22);
    const pmrem = new THREE.PMREMGenerator(renderer);
    s.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    s.environmentIntensity = 0.55;
    pmrem.dispose();

    s.add(new THREE.HemisphereLight(0x8fb0ff, 0x0b0d18, 0.4));
    const key = new THREE.SpotLight(0xffffff, 45, 18, 0.55, 0.7, 1.4);
    key.position.set(2.5, 6, 3);
    key.target.position.set(0, 1.8, 0);
    s.add(key, key.target);
    const rim = new THREE.PointLight(0x5ad1ff, 20, 10);
    rim.position.set(-3, 2.5, -2);
    s.add(rim);

    // Glossy floor with a glowing grid.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(14, 48),
      new THREE.MeshStandardMaterial({ color: '#0b0f1d', metalness: 0.7, roughness: 0.28 }),
    );
    floor.rotation.x = -Math.PI / 2;
    s.add(floor);
    const grid = new THREE.GridHelper(28, 28, 0x1d4a7a, 0x12243d);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    grid.position.y = 0.002;
    s.add(grid);

    // Projector: a steel puck with a glowing ring.
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 0.35, 40), new THREE.MeshStandardMaterial({ color: '#1a1f2b', metalness: 0.9, roughness: 0.3 }));
    base.position.y = 0.175;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.1, 0.12, 40), new THREE.MeshStandardMaterial({ color: '#0d1018', metalness: 0.8, roughness: 0.2 }));
    top.position.y = 0.41;
    this.ringMat = new THREE.MeshStandardMaterial({ color: '#38e1ff', emissive: '#38e1ff', emissiveIntensity: 1.6 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.04, 8, 64), this.ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.47;
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.5, 32), new THREE.MeshStandardMaterial({ color: '#0b1220', emissive: '#9fefff', emissiveIntensity: 0.12, roughness: 0.2, metalness: 0.5 }));
    lens.rotation.x = -Math.PI / 2;
    lens.position.y = 0.475;
    s.add(base, top, ring, lens);

    // Light beam rising from the projector (fades upward).
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color('#38e1ff') }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uColor; uniform float uTime; varying vec2 vUv; void main(){ float a = pow(1.0 - vUv.y, 2.2) * 0.07 * (0.85 + 0.15 * sin(uTime * 7.0 + vUv.y * 20.0)); gl_FragColor = vec4(uColor, a); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 0.5, 3.4, 40, 1, true), this.beamMat);
    beam.position.y = 0.48 + 1.7;
    s.add(beam);

    // Sparkles drifting up through the beam.
    const count = 220;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 1.2;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = 0.5 + Math.random() * 3.2;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.particles = new THREE.Points(pg, new THREE.PointsMaterial({ color: '#38e1ff', size: 0.03, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.add(this.particles);

    this.holder.position.y = 2.15;
    s.add(this.holder);

    this.camera.position.set(0, 2.6, 6.4);
    this.camera.lookAt(0, 1.9, 0);

    // Drag to spin the weapon.
    dom.addEventListener('pointerdown', (e) => { this.dragging = true; this.lastX = e.clientX; });
    window.addEventListener('pointerup', () => { this.dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      this.lastX = e.clientX;
      this.spin += dx * 0.01;
      this.dragVel = dx * 0.01;
    });
  }

  show(id: string, rarity: RarityId): void {
    this.rarity = rarity;
    if (this.current) {
      this.holder.remove(this.current.group);
      this.current.group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
      });
    }
    const model = buildWeaponModel(id, rarity);
    // Fit any weapon (huge K2 or tiny Toothpick) to about 2.8 m across.
    const longest = Math.max(model.size.x, model.size.y, model.size.z);
    const scale = 2.9 / longest;
    model.group.scale.setScalar(scale);
    model.group.position.set(-model.center.x * scale, -model.center.y * scale, -model.center.z * scale);
    // Present it side-on: barrel pointing left.
    const pivot = new THREE.Group();
    pivot.rotation.y = Math.PI / 2;
    pivot.add(model.group);
    model.group.userData['pivot'] = pivot;

    // Hologram edges for every part.
    model.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.userData['realMat'] = mesh.material;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 25), this.edgeMat);
      edges.name = 'holo-edges';
      mesh.add(edges);
    });

    const color = holoColor(rarity);
    this.holoMat.uniforms['uColor']!.value.copy(color);
    this.edgeMat.color.copy(color);
    this.ringMat.color.copy(color);
    this.ringMat.emissive.copy(color);
    this.beamMat.uniforms['uColor']!.value.copy(color);
    (this.particles.material as THREE.PointsMaterial).color.copy(color);

    this.holder.clear();
    this.holder.add(pivot);
    this.current = model;
    this.glitch = 0.35;
    this.applyView();
  }

  setView(v: 'holo' | 'real'): void {
    this.view = v;
    this.glitch = 0.25;
    this.applyView();
  }

  get currentView(): 'holo' | 'real' { return this.view; }

  private applyView(): void {
    if (!this.current) return;
    const holo = this.view === 'holo';
    this.current.group.traverse((o) => {
      if (o.name === 'holo-edges') { o.visible = holo; return; }
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = holo ? this.holoMat : (mesh.userData['realMat'] as THREE.Material);
      mesh.castShadow = !holo;
    });
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    // Leave room for the panels: shift the weapon left on wide screens.
    const wide = w / h > 1.2;
    // On wide screens the weapon sits between the list (left) and the stats panel (right).
    const shift = wide ? 0.55 : 0;
    this.camera.position.set(shift, wide ? 2.5 : 3.2, wide ? 5.9 : 8.4);
    this.camera.lookAt(shift, 1.95, 0);
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    if (!this.dragging) {
      this.dragVel *= Math.pow(0.05, dt);
      this.spin += dt * 0.45 + this.dragVel * dt * 10;
    }
    this.holder.rotation.y = this.spin;
    this.holder.position.y = 2.15 + Math.sin(t * 1.4) * 0.06;

    this.glitch = Math.max(0, this.glitch - dt);
    const flicker = 0.92 + 0.08 * Math.sin(t * 31) * Math.sin(t * 17) - (this.glitch > 0 ? Math.random() * 0.6 : 0);
    this.holoMat.uniforms['uTime']!.value = t;
    this.holoMat.uniforms['uFlicker']!.value = flicker;
    this.edgeMat.opacity = 0.55 * flicker;
    this.beamMat.uniforms['uTime']!.value = t;
    if (this.glitch > 0) this.holder.position.x = (Math.random() - 0.5) * 0.06;
    else this.holder.position.x = 0;

    this.current?.finish.update(t);
    if (this.rarity === 'uncontrollable' && this.view === 'holo') {
      const c = new THREE.Color().setHSL((t * 0.2) % 1, 1, 0.6);
      this.holoMat.uniforms['uColor']!.value.copy(c);
      this.edgeMat.color.copy(c);
    }

    const pos = this.particles.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + dt * (0.25 + (i % 7) * 0.05);
      if (y > 3.8) y = 0.5;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
  }
}
