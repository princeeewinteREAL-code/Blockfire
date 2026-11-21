import * as THREE from 'three';

/** Colours for a blocky character's procedural skin. */
export interface SkinColors {
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  shoes: string;
  eyes: string;
}

export const DEFAULT_SKIN: SkinColors = {
  skin: '#e0a882',
  hair: '#3b2a20',
  shirt: '#2f80ed',
  pants: '#2d3142',
  shoes: '#1b1b1f',
  eyes: '#ffffff',
};

function pixelCanvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function noisy(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, seed: number): void {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
  let s = seed;
  const base = new THREE.Color(color);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      s = (s * 16807) % 2147483647;
      if (s % 3 === 0) {
        const c = base.clone().offsetHSL(0, 0, ((s % 100) / 100 - 0.5) * 0.08);
        g.fillStyle = `#${c.getHexString()}`;
        g.fillRect(x + i, y + j, 1, 1);
      }
    }
  }
}

/** Materials for the 6 faces of a box: +x, -x, +y, -y, +z (front), -z (back). */
function faceMats(front: THREE.Texture, side: THREE.Texture, top: THREE.Texture, bottom: THREE.Texture, back?: THREE.Texture) {
  const m = (t: THREE.Texture) => new THREE.MeshLambertMaterial({ map: t });
  return [m(side), m(side), m(top), m(bottom), m(front), m(back ?? side)];
}

/**
 * Build a Minecraft-style character from 6 blocks: head, body, 2 arms, 2 legs.
 * 1 unit = 1 metre; the character is 1.8 m tall, matching the player's hitbox.
 */
export function buildCharacter(colors: SkinColors = DEFAULT_SKIN): THREE.Group {
  const px = 1.8 / 32; // one "skin pixel" in metres

  const face = pixelCanvas(8, 8, (g) => {
    noisy(g, 0, 0, 8, 8, colors.skin, 11);
    noisy(g, 0, 0, 8, 2, colors.hair, 12);
    g.fillStyle = colors.hair; g.fillRect(0, 2, 1, 1); g.fillRect(7, 2, 1, 1);
    g.fillStyle = colors.eyes; g.fillRect(1, 4, 2, 1); g.fillRect(5, 4, 2, 1);
    g.fillStyle = '#3a6ea5'; g.fillRect(2, 4, 1, 1); g.fillRect(5, 4, 1, 1);
    g.fillStyle = '#a0614a'; g.fillRect(3, 6, 2, 1);
  });
  const headSide = pixelCanvas(8, 8, (g) => { noisy(g, 0, 0, 8, 8, colors.skin, 13); noisy(g, 0, 0, 8, 3, colors.hair, 14); });
  const headTop = pixelCanvas(8, 8, (g) => noisy(g, 0, 0, 8, 8, colors.hair, 15));
  const headBack = pixelCanvas(8, 8, (g) => noisy(g, 0, 0, 8, 8, colors.hair, 16));
  const shirt = pixelCanvas(8, 12, (g) => { noisy(g, 0, 0, 8, 12, colors.shirt, 17); g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(3, 0, 2, 2); });
  const shirtPlain = pixelCanvas(8, 12, (g) => noisy(g, 0, 0, 8, 12, colors.shirt, 18));
  const arm = pixelCanvas(4, 12, (g) => { noisy(g, 0, 0, 4, 12, colors.shirt, 19); noisy(g, 0, 8, 4, 4, colors.skin, 20); });
  const hand = pixelCanvas(4, 4, (g) => noisy(g, 0, 0, 4, 4, colors.skin, 21));
  const leg = pixelCanvas(4, 12, (g) => { noisy(g, 0, 0, 4, 12, colors.pants, 22); noisy(g, 0, 9, 4, 3, colors.shoes, 23); });
  const sole = pixelCanvas(4, 4, (g) => noisy(g, 0, 0, 4, 4, colors.shoes, 24));
  const hip = pixelCanvas(4, 4, (g) => noisy(g, 0, 0, 4, 4, colors.pants, 25));

  const root = new THREE.Group();

  const head = new THREE.Mesh(new THREE.BoxGeometry(8 * px, 8 * px, 8 * px), faceMats(face, headSide, headTop, headSide, headBack));
  head.position.y = 28 * px;
  head.name = 'head';

  const body = new THREE.Mesh(new THREE.BoxGeometry(8 * px, 12 * px, 4 * px), faceMats(shirt, shirtPlain, shirtPlain, shirtPlain, shirtPlain));
  body.position.y = 18 * px;

  // Limbs pivot at the shoulder / hip so they can swing.
  const limb = (tex: THREE.Texture, end: THREE.Texture, topTex: THREE.Texture, x: number, pivotY: number, name: string) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, pivotY, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(4 * px, 12 * px, 4 * px), faceMats(tex, tex, topTex, end, tex));
    m.position.y = -6 * px;
    pivot.add(m);
    pivot.name = name;
    return pivot;
  };
  const armL = limb(arm, hand, shirtPlain, -6 * px, 24 * px, 'armL');
  const armR = limb(arm, hand, shirtPlain, 6 * px, 24 * px, 'armR');
  const legL = limb(leg, sole, hip, -2 * px, 12 * px, 'legL');
  const legR = limb(leg, sole, hip, 2 * px, 12 * px, 'legR');

  root.add(head, body, armL, armR, legL, legR);
  root.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
  return root;
}

/** Idle / run animation: swing arms and legs. `t` in seconds, `amount` 0..1. */
export function animateCharacter(c: THREE.Group, t: number, amount: number): void {
  const swing = Math.sin(t * 9) * 0.9 * amount;
  const idle = Math.sin(t * 2) * 0.05;
  const get = (n: string) => c.getObjectByName(n);
  get('armL')!.rotation.x = swing + idle;
  get('armR')!.rotation.x = -swing - idle;
  get('legL')!.rotation.x = -swing;
  get('legR')!.rotation.x = swing;
  get('head')!.rotation.y = Math.sin(t * 0.7) * 0.25 * (1 - amount);
}
