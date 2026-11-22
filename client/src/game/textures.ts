import * as THREE from 'three';

/** Tiny deterministic random generator, so textures look the same every time. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

function shade(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amount)));
  return `#${c.getHexString()}`;
}

const cache = new Map<string, THREE.CanvasTexture>();

/**
 * A 16 x 16 pixel-art texture: a base colour with speckles and a darker block edge,
 * like a Minecraft block. Rendered with no smoothing so pixels stay crisp.
 */
export function pixelTexture(color: string, material = 'stone'): THREE.CanvasTexture {
  const key = `${color}|${material}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d')!;
  const rand = rng(hashString(key));

  g.fillStyle = color;
  g.fillRect(0, 0, size, size);

  const spread = material === 'neon' ? 0.04 : material === 'grass' ? 0.1 : 0.07;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = rand();
      if (r < 0.45) {
        g.fillStyle = shade(color, (rand() - 0.5) * 2 * spread);
        g.fillRect(x, y, 1, 1);
      }
    }
  }

  if (material === 'wood') {
    g.fillStyle = shade(color, -0.12);
    for (let y = 3; y < size; y += 5) g.fillRect(0, y, size, 1);
  } else if (material === 'metal') {
    g.fillStyle = shade(color, 0.12);
    g.fillRect(2, 2, 1, 1); g.fillRect(13, 2, 1, 1); g.fillRect(2, 13, 1, 1); g.fillRect(13, 13, 1, 1);
  } else if (material === 'neon') {
    g.fillStyle = shade(color, 0.2);
    g.fillRect(0, 7, size, 2);
  }

  // Block edge.
  g.fillStyle = shade(color, material === 'grass' ? -0.06 : -0.14);
  g.fillRect(0, 0, size, 1);
  g.fillRect(0, 0, 1, size);
  g.fillStyle = shade(color, material === 'grass' ? -0.03 : -0.08);
  g.fillRect(0, size - 1, size, 1);
  g.fillRect(size - 1, 0, 1, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/** A vertical sky gradient used as the scene background. */
export function skyTexture(top: string, bottom: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const g = canvas.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
