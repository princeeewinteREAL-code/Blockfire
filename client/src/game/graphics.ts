import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export const QUALITY_LABELS: Record<Quality, string> = {
  low: 'Low — fastest, for older laptops',
  medium: 'Medium — shadows + glow',
  high: 'High — sharp shadows, smooth edges',
  ultra: 'Ultra — maximum detail',
};

interface QualityProfile {
  pixelRatio: number;
  shadows: boolean;
  shadowSize: number;
  bloom: boolean;
  msaa: number;
}

export function qualityProfile(q: Quality): QualityProfile {
  const dpr = window.devicePixelRatio || 1;
  switch (q) {
    case 'low': return { pixelRatio: Math.min(dpr, 1) * 0.8, shadows: false, shadowSize: 512, bloom: false, msaa: 0 };
    case 'medium': return { pixelRatio: Math.min(dpr, 1), shadows: true, shadowSize: 1024, bloom: true, msaa: 0 };
    case 'high': return { pixelRatio: Math.min(dpr, 1.5), shadows: true, shadowSize: 2048, bloom: true, msaa: 4 };
    case 'ultra': return { pixelRatio: Math.min(dpr, 2), shadows: true, shadowSize: 4096, bloom: true, msaa: 8 };
  }
}

/**
 * Owns the WebGL renderer and the post-processing chain (bloom + tone mapping).
 * Every screen (menu, armory, game) renders through `render(scene, camera)`.
 */
export class Graphics {
  readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private profile: QualityProfile;
  private width = 1;
  private height = 1;

  constructor(canvas: HTMLCanvasElement, public quality: Quality) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.profile = qualityProfile(quality);
    this.apply();
  }

  get shadowsOn(): boolean { return this.profile.shadows; }
  get shadowSize(): number { return this.profile.shadowSize; }

  setQuality(q: Quality): void {
    this.quality = q;
    this.profile = qualityProfile(q);
    this.apply();
  }

  private apply(): void {
    const p = this.profile;
    this.renderer.setPixelRatio(p.pixelRatio);
    this.renderer.shadowMap.enabled = p.shadows;
    this.composer?.dispose();
    this.composer = null;
    this.renderPass = null;
    this.bloom = null;
    if (p.bloom) {
      const target = new THREE.WebGLRenderTarget(this.width, this.height, {
        type: THREE.HalfFloatType,
        samples: p.msaa,
      });
      this.composer = new EffectComposer(this.renderer, target);
      this.composer.setPixelRatio(p.pixelRatio);
      this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
      this.composer.addPass(this.renderPass);
      this.bloom = new UnrealBloomPass(new THREE.Vector2(this.width, this.height), 0.55, 0.45, 0.92);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.setSize(this.width, this.height);
  }

  setSize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    // Very big screens (4K and up): cap the pixels drawn so the game stays smooth.
    const pr = Math.min(this.profile.pixelRatio, Math.sqrt(4_200_000 / Math.max(1, this.width * this.height)));
    this.renderer.setPixelRatio(pr);
    this.composer?.setPixelRatio(pr);
    this.renderer.setSize(this.width, this.height, false);
    this.composer?.setSize(this.width, this.height);
  }

  /** Render a scene. `bloomStrength` lets a screen (like the Armory) glow harder. */
  render(scene: THREE.Scene, camera: THREE.Camera, bloomStrength = 0.55): void {
    if (this.composer && this.renderPass && this.bloom) {
      this.renderPass.scene = scene;
      this.renderPass.camera = camera;
      this.bloom.strength = bloomStrength;
      this.composer.render();
    } else {
      this.renderer.render(scene, camera);
    }
  }
}

/** Make every material in a scene recompile (needed after turning shadows on or off). */
export function refreshMaterials(root: THREE.Object3D, shadowSize: number): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) m.needsUpdate = true;
    }
    const light = o as THREE.DirectionalLight;
    if (light.isDirectionalLight && light.shadow) {
      light.shadow.mapSize.set(shadowSize, shadowSize);
      light.shadow.map?.dispose();
      light.shadow.map = null;
    }
  });
}
