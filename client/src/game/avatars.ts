import * as THREE from 'three';
import { WEAPON_BY_ID, horizontalSpeed, playerHeight, type Fighter, type RarityId } from '@blockfire/shared';
import { animateCharacter, buildCharacter, type SkinColors } from './character.js';
import { buildWeaponModel, type WeaponModel } from './weapon-models.js';

const SKINS: SkinColors[] = [
  { skin: '#e0a882', hair: '#3b2a20', shirt: '#e0453a', pants: '#2d3142', shoes: '#1b1b1f', eyes: '#ffffff' },
  { skin: '#8d5a3b', hair: '#121212', shirt: '#2fbf71', pants: '#3a2f25', shoes: '#111111', eyes: '#ffffff' },
  { skin: '#f1c6a5', hair: '#d9a441', shirt: '#7c5cff', pants: '#22252b', shoes: '#2b2b2b', eyes: '#ffffff' },
  { skin: '#c68863', hair: '#5a2d16', shirt: '#ffb000', pants: '#253b6e', shoes: '#151515', eyes: '#ffffff' },
  { skin: '#6b4430', hair: '#0e0e0e', shirt: '#00b3c7', pants: '#33231b', shoes: '#202020', eyes: '#ffffff' },
  { skin: '#e8b996', hair: '#a33b20', shirt: '#ff5fa2', pants: '#1f2a1f', shoes: '#101010', eyes: '#ffffff' },
  { skin: '#b07a55', hair: '#2a1a10', shirt: '#9aa3ad', pants: '#4a1f1f', shoes: '#1a1a1a', eyes: '#ffffff' },
  { skin: '#f3d2b8', hair: '#f2f2f2', shirt: '#3d8bff', pants: '#2b2b38', shoes: '#0c0c0c', eyes: '#ffffff' },
];

function nameTag(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 48;
  const g = c.getContext('2d')!;
  g.font = '700 26px Rubik, system-ui, sans-serif';
  const w = Math.min(250, g.measureText(text).width + 20);
  g.fillStyle = 'rgba(10,10,20,0.6)';
  g.fillRect((256 - w) / 2, 6, w, 36);
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 25);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(1.6, 0.3, 1);
  return s;
}

interface Avatar {
  root: THREE.Group;
  body: THREE.Group;
  tag: THREE.Sprite;
  weapon: WeaponModel | null;
  weaponKey: string;
  skin: SkinColors;
  wasAlive: boolean;
  walk: number;
}

/** Draws every other player as a blocky character holding their weapon. */
export class Avatars {
  private avatars = new Map<number, Avatar>();

  constructor(private scene: THREE.Scene) {}

  skinColors(id: number): THREE.Color[] {
    const s = SKINS[id % SKINS.length]!;
    return [s.shirt, s.pants, s.skin, s.hair].map((c) => new THREE.Color(c));
  }

  private create(f: Fighter): Avatar {
    const skin = SKINS[f.id % SKINS.length]!;
    const root = new THREE.Group();
    const body = buildCharacter(skin);
    root.add(body);
    const tag = nameTag(f.name, f.isBot ? '#ffd36a' : '#7fe9ff');
    tag.position.y = 2.15;
    root.add(tag);
    this.scene.add(root);
    return { root, body, tag, weapon: null, weaponKey: '', skin, wasAlive: true, walk: 0 };
  }

  update(fighters: Fighter[], localId: number, dt: number, rarityFor: (f: Fighter, weaponId: string) => RarityId): void {
    for (const f of fighters) {
      if (f.id === localId) continue;
      let a = this.avatars.get(f.id);
      if (!a) { a = this.create(f); this.avatars.set(f.id, a); }
      a.root.visible = f.alive;
      a.wasAlive = f.alive;
      if (!f.alive) continue;

      // Weapon in the right hand.
      const wid = f.loadout[f.slot];
      const rarity = rarityFor(f, wid);
      const key = `${wid}|${rarity}`;
      if (key !== a.weaponKey) {
        const arm = a.body.getObjectByName('armR')!;
        if (a.weapon) arm.remove(a.weapon.group);
        const model = buildWeaponModel(wid, rarity);
        const s = Math.min(0.0075, 0.55 / Math.max(model.size.z, 1) );
        model.group.scale.setScalar(s);
        // Hold it at the hand, pointing forward (+Z is the character's front).
        // The arm points forward, so the weapon's barrel (-Z) is turned to run down the arm (-Y), top side up.
        model.group.rotation.set(-Math.PI / 2, 0, Math.PI);
        model.group.position.set(0, -0.66, 0);
        void WEAPON_BY_ID;
        arm.add(model.group);
        a.weapon = model;
        a.weaponKey = key;
      }

      a.root.position.set(f.p.pos.x, f.p.pos.y, f.p.pos.z);
      a.root.rotation.y = f.yaw + Math.PI;
      const speed = horizontalSpeed(f.p);
      a.walk += dt * (f.p.onGround ? Math.min(speed / 6, 1.6) : 0.2);
      animateCharacter(a.body, a.walk, f.p.onGround ? Math.min(speed / 6, 1) : 0.3);
      // Aim: right arm points where they look; crouch/slide lowers and tilts the body.
      const armR = a.body.getObjectByName('armR')!;
      armR.rotation.x = -Math.PI / 2 - f.pitch;
      const armL = a.body.getObjectByName('armL')!;
      armL.rotation.x = -Math.PI / 2.4 - f.pitch * 0.8;
      armL.rotation.z = 0.5;
      const h = playerHeight(f.p);
      a.body.scale.y = h / 1.8;
      a.body.rotation.x = f.p.sliding ? -0.5 : 0;
      a.body.getObjectByName('head')!.rotation.x = -f.pitch * 0.6;
      a.tag.position.y = h + 0.35;
      // Flicker while spawn-protected.
      a.body.visible = f.protectLeft <= 0 || Math.floor(f.protectLeft * 10) % 2 === 0;
      a.weapon?.finish.update(a.walk);
    }
  }

  clear(): void {
    for (const a of this.avatars.values()) this.scene.remove(a.root);
    this.avatars.clear();
  }
}
