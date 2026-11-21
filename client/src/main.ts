import './style.css';
import * as THREE from 'three';
import {
  RARITIES, RARITY_BY_ID, TEST_MAP, WEAPON_BY_ID, bodyTtk, weaponsInSlot, type RarityId, type Slot, type WeaponDef,
} from '@blockfire/shared';
import { Game, formatTime } from './game/game.js';
import { Input } from './game/input.js';
import { Sfx } from './game/audio.js';
import { animateCharacter, buildCharacter } from './game/character.js';
import { pixelTexture, skyTexture } from './game/textures.js';
import { Graphics, QUALITY_LABELS, refreshMaterials, type Quality } from './game/graphics.js';
import { ArmoryScene } from './game/armory.js';
import { loadLoadout, rarityOf, saveLoadout, type Loadout } from './game/loadout.js';
import {
  ACTION_LABELS, DEFAULT_SETTINGS, keyLabel, loadBest, loadSettings, saveSettings,
  type Action, type Settings,
} from './game/settings.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- Core objects ----------
const canvas = $<HTMLCanvasElement>('view');
let settings: Settings = loadSettings();
let loadout: Loadout = loadLoadout();
const getSettings = () => settings;
const getLoadout = () => loadout;

let gfx: Graphics;
try {
  gfx = new Graphics(canvas, settings.quality);
} catch {
  document.body.innerHTML = '<p style="padding:24px;font:18px system-ui;color:#fff">Blockfire needs WebGL. Please try an up-to-date Chrome, Edge, Firefox or Safari.</p>';
  throw new Error('WebGL unavailable');
}
const sfx = new Sfx();
sfx.setVolume(settings.volume);
const input = new Input(canvas, getSettings);

// ---------- Menu scene: the blocky character on a grass block ----------
const menuScene = new THREE.Scene();
menuScene.background = skyTexture('#3f7fe6', '#ffcf9a');
menuScene.backgroundIntensity = 1;
menuScene.add(new THREE.HemisphereLight(0xffffff, 0x6a5a4a, 1.3));
const menuSun = new THREE.DirectionalLight(0xfff0dd, 2.2);
menuSun.position.set(3, 6, 4);
menuSun.castShadow = true;
menuSun.shadow.mapSize.set(1024, 1024);
menuScene.add(menuSun);
const pedestalSide = new THREE.MeshStandardMaterial({ map: pixelTexture('#8a5a33', 'wood'), roughness: 0.8 });
const pedestal = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1, 2.4), [
  pedestalSide, pedestalSide, new THREE.MeshStandardMaterial({ map: pixelTexture('#62b04f', 'grass'), roughness: 0.9 }),
  pedestalSide, pedestalSide, pedestalSide,
]);
pedestal.position.y = -0.5;
pedestal.receiveShadow = true;
menuScene.add(pedestal);
const hero = buildCharacter();
menuScene.add(hero);
const floaters: THREE.Mesh[] = [];
['#ff5a1f', '#ffd23f', '#3ddc84', '#b38cff', '#5aa0ff'].forEach((c, i) => {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshStandardMaterial({ map: pixelTexture(c, 'neon'), emissive: new THREE.Color(c), emissiveIntensity: 0.9, roughness: 0.4 }),
  );
  m.position.set(Math.cos(i * 1.3) * 2.6, 0.6 + i * 0.45, Math.sin(i * 1.3) * 2.6 - 1);
  menuScene.add(m);
  floaters.push(m);
});
const menuCam = new THREE.PerspectiveCamera(40, 1, 0.1, 100);

// ---------- Armory ----------
const armory = new ArmoryScene(gfx.renderer, canvas);

// ---------- State ----------
type Mode = 'menu' | 'playing' | 'paused' | 'armory';
let mode: Mode = 'menu';
let game: Game | null = null;
let usingFallbackLook = false;

const show = (id: string, on: boolean) => { $(id).hidden = !on; };

function toast(text: string, ms = 3500): void {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { t.hidden = true; }, ms);
}
let toastTimer = 0;

function refreshMenuBest(): void {
  const best = loadBest(TEST_MAP.id);
  $('menu-best').textContent = best !== null ? `Best parkour time: ${formatTime(best)}` : '';
}

async function startPlaying(): Promise<void> {
  sfx.unlock();
  sfx.click();
  if (!game) {
    game = new Game(TEST_MAP, input, sfx, getSettings, gfx, getLoadout);
    resize();
  }
  game.refreshWeapon();
  input.setEnabled(true);
  const locked = await input.lock();
  usingFallbackLook = !locked;
  if (!locked) toast('Your browser blocked mouse capture here. Hold a mouse button and drag to look. Esc pauses.', 6000);
  mode = 'playing';
  show('menu', false); show('pause', false); show('hud', true);
}

function pause(): void {
  if (mode !== 'playing') return;
  mode = 'paused';
  input.setEnabled(false);
  input.unlock();
  show('pause', true);
}

function toMenu(): void {
  mode = 'menu';
  input.setEnabled(false);
  input.unlock();
  show('pause', false); show('hud', false); show('armory', false); show('menu', true);
  refreshMenuBest();
}

document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && mode === 'playing' && !usingFallbackLook) pause();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && mode === 'playing' && usingFallbackLook) pause();
  if (e.code === 'Escape' && mode === 'armory') toMenu();
});

$('play').addEventListener('click', () => void startPlaying());
$('resume').addEventListener('click', () => void startPlaying());
$('quit').addEventListener('click', () => { sfx.click(); toMenu(); });

// ---------- Armory UI ----------
let armTab: Slot = 'primary';
let armWeapon: WeaponDef = WEAPON_BY_ID[loadout.primary]!;
let armRarity: RarityId = rarityOf(loadout, armWeapon.id);

const STAT_ROWS: Array<{ label: string; value: (w: WeaponDef) => string; frac: (w: WeaponDef) => number; show?: (w: WeaponDef) => boolean }> = [
  { label: 'Damage', value: (w) => `${w.damage.body}${w.pellets ? ` × ${w.pellets}` : ''}${w.slot !== 'melee' ? ` / ${w.damage.head}` : ''}`, frac: (w) => (w.damage.body * (w.pellets ?? 1)) / 150 },
  { label: 'Fire rate', value: (w) => (w.slot === 'melee' ? `${(60 / w.rpm).toFixed(2)} s swing` : `${w.rpm} rpm`), frac: (w) => w.rpm / 1000 },
  { label: 'Magazine', value: (w) => `${w.mag}`, frac: (w) => w.mag / 100, show: (w) => w.slot !== 'melee' },
  { label: 'Reload', value: (w) => `${w.reloadSec.toFixed(1)} s`, frac: (w) => 1 - w.reloadSec / 6.5, show: (w) => w.slot !== 'melee' },
  { label: 'Reach', value: (w) => `${w.reach?.toFixed(1)} m`, frac: (w) => (w.reach ?? 0) / 4, show: (w) => w.slot === 'melee' },
  { label: 'Move speed', value: (w) => `${Math.round(w.moveSpeed * 100)}%`, frac: (w) => (w.moveSpeed - 0.55) / 0.75 },
  { label: 'Time to kill', value: (w) => (bodyTtk(w) === 0 ? 'Instant' : `${bodyTtk(w).toFixed(2)} s`), frac: (w) => 1 - Math.min(1, bodyTtk(w) / 1.2) },
];

function renderArmoryList(): void {
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset['tab'] === armTab)));
  const list = $('arm-list');
  list.innerHTML = '';
  for (const w of weaponsInSlot(armTab)) {
    const b = document.createElement('button');
    b.className = `arm-item${w.id === armWeapon.id ? ' on' : ''}`;
    b.id = `arm-${w.id}`;
    const left = document.createElement('span');
    left.innerHTML = `${w.name}<br><small>${w.role}</small>`;
    b.append(left);
    if (loadout[armTab] === w.id) {
      const eq = document.createElement('span');
      eq.className = 'eq';
      eq.textContent = 'EQUIPPED';
      b.append(eq);
    }
    b.onclick = () => { sfx.click(); selectArmoryWeapon(w); };
    list.append(b);
  }
}

function renderArmoryPanel(): void {
  const w = armWeapon;
  const r = RARITY_BY_ID[armRarity];
  $('arm-role').textContent = `${w.slot[0]!.toUpperCase()}${w.slot.slice(1)} · ${w.role}`;
  $('arm-name').textContent = w.name;
  const rar = $('arm-rarity');
  rar.textContent = `${r.name} skin · ${r.changes}`;
  rar.style.color = r.color;

  const chips = $('arm-chips');
  chips.innerHTML = '';
  for (const rr of RARITIES) {
    const c = document.createElement('button');
    c.className = `chip${rr.id === armRarity ? ' on' : ''}`;
    c.style.color = rr.color;
    c.title = `${rr.name} (${rr.odds})`;
    c.innerHTML = `<span>${rr.name}</span>`;
    if (rr.id !== armRarity) (c.firstChild as HTMLElement).style.color = rr.color;
    c.onclick = () => {
      sfx.click();
      armRarity = rr.id;
      armory.show(armWeapon.id, armRarity);
      renderArmoryPanel();
    };
    chips.append(c);
  }

  const stats = $('arm-stats');
  stats.innerHTML = '';
  for (const row of STAT_ROWS) {
    if (row.show && !row.show(w)) continue;
    const el = document.createElement('div');
    el.className = 'stat';
    const pct = Math.round(Math.max(0.04, Math.min(1, row.frac(w))) * 100);
    el.innerHTML = `<span>${row.label}</span><div class="bar"><i style="width:${pct}%"></i></div><b>${row.value(w)}</b>`;
    stats.append(el);
  }
  $('arm-special').textContent = w.special;
  $('arm-unlock').textContent = `How to get it: ${w.unlock}${w.masteryUnlock ? ` · Mastery 5 unlocks the ${WEAPON_BY_ID[w.masteryUnlock]!.name}` : ''}`;
  const equipped = loadout[w.slot] === w.id && rarityOf(loadout, w.id) === armRarity;
  const eqBtn = $<HTMLButtonElement>('arm-equip');
  eqBtn.textContent = equipped ? 'Equipped' : 'Equip';
  eqBtn.disabled = equipped;
  $('arm-view').textContent = armory.currentView === 'holo' ? 'Show real model' : 'Show hologram';
}

function selectArmoryWeapon(w: WeaponDef): void {
  armWeapon = w;
  armRarity = rarityOf(loadout, w.id);
  armory.show(w.id, armRarity);
  renderArmoryList();
  renderArmoryPanel();
}

function openArmory(): void {
  sfx.unlock();
  sfx.click();
  mode = 'armory';
  show('menu', false); show('armory', true);
  armTab = armWeapon.slot;
  selectArmoryWeapon(armWeapon);
  resize();
}

$('open-armory').addEventListener('click', openArmory);
$('arm-back').addEventListener('click', () => { sfx.click(); toMenu(); });
document.querySelectorAll<HTMLButtonElement>('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    sfx.click();
    armTab = t.dataset['tab'] as Slot;
    const first = WEAPON_BY_ID[loadout[armTab]] ?? weaponsInSlot(armTab)[0]!;
    selectArmoryWeapon(first);
  });
});
$('arm-view').addEventListener('click', () => {
  sfx.click();
  armory.setView(armory.currentView === 'holo' ? 'real' : 'holo');
  renderArmoryPanel();
});
$('arm-equip').addEventListener('click', () => {
  sfx.checkpoint();
  loadout = { ...loadout, [armWeapon.slot]: armWeapon.id, rarity: { ...loadout.rarity, [armWeapon.id]: armRarity } };
  saveLoadout(loadout);
  game?.refreshWeapon();
  renderArmoryList();
  renderArmoryPanel();
  toast(`${armWeapon.name} (${RARITY_BY_ID[armRarity].name}) equipped as your ${armWeapon.slot} weapon`, 2500);
});

// ---------- Settings sheet ----------
let returnTo: 'menu' | 'pause' = 'menu';
let listening: { action: Action; el: HTMLButtonElement } | null = null;

function openSheet(id: 'settings' | 'controls', from: 'menu' | 'pause'): void {
  sfx.unlock();
  sfx.click();
  returnTo = from;
  show(from, false);
  if (id === 'settings') renderSettings();
  show(id, true);
}
function closeSheet(id: 'settings' | 'controls'): void {
  sfx.click();
  show(id, false);
  show(returnTo, true);
}

function bindRange(id: string, key: 'sensitivity' | 'fov' | 'volume', fmt: (v: number) => string): void {
  const el = $<HTMLInputElement>(id);
  const out = $(`${id}-v`);
  el.value = String(settings[key]);
  out.textContent = fmt(settings[key]);
  el.oninput = () => {
    settings = { ...settings, [key]: Number(el.value) };
    out.textContent = fmt(settings[key]);
    if (key === 'volume') sfx.setVolume(settings.volume);
    if (key === 'fov') resize();
    saveSettings(settings);
  };
}

function applyQuality(q: Quality): void {
  gfx.setQuality(q);
  refreshMaterials(menuScene, gfx.shadowSize);
  refreshMaterials(armory.scene, gfx.shadowSize);
  if (game) refreshMaterials(game.world.scene, gfx.shadowSize);
  resize();
}

function renderSettings(): void {
  const qs = $<HTMLSelectElement>('s-quality');
  qs.innerHTML = (Object.keys(QUALITY_LABELS) as Quality[]).map((q) => `<option value="${q}">${QUALITY_LABELS[q]}</option>`).join('');
  qs.value = settings.quality;
  qs.onchange = () => {
    settings = { ...settings, quality: qs.value as Quality };
    saveSettings(settings);
    applyQuality(settings.quality);
  };
  bindRange('s-sens', 'sensitivity', (v) => v.toFixed(2));
  bindRange('s-fov', 'fov', (v) => `${v}°`);
  bindRange('s-vol', 'volume', (v) => `${Math.round(v * 100)}%`);
  const inv = $<HTMLInputElement>('s-invert');
  inv.checked = settings.invertY;
  inv.onchange = () => { settings = { ...settings, invertY: inv.checked }; saveSettings(settings); };
  const fps = $<HTMLInputElement>('s-fps');
  fps.checked = settings.showFps;
  fps.onchange = () => { settings = { ...settings, showFps: fps.checked }; saveSettings(settings); };

  const binds = $('binds');
  binds.innerHTML = '';
  (Object.keys(ACTION_LABELS) as Action[]).forEach((action) => {
    const label = document.createElement('span');
    label.textContent = ACTION_LABELS[action];
    const btn = document.createElement('button');
    btn.className = 'bind';
    btn.id = `bind-${action}`;
    btn.textContent = keyLabel(settings.keys[action]);
    btn.onclick = () => {
      if (listening) listening.el.classList.remove('listening');
      listening = { action, el: btn };
      btn.classList.add('listening');
      btn.textContent = 'Press a key…';
    };
    binds.append(label, btn);
  });
}

function finishBinding(code: string | null): void {
  if (!listening) return;
  const { action, el } = listening;
  listening = null;
  el.classList.remove('listening');
  if (code) {
    settings = { ...settings, keys: { ...settings.keys, [action]: code } };
    saveSettings(settings);
  }
  el.textContent = keyLabel(settings.keys[action]);
}
window.addEventListener('keydown', (e) => {
  if (!listening) return;
  e.preventDefault();
  e.stopPropagation();
  finishBinding(e.code === 'Escape' ? null : e.code);
}, true);
window.addEventListener('mousedown', (e) => {
  if (!listening || (e.target as HTMLElement).classList.contains('bind')) return;
  e.preventDefault();
  finishBinding(`Mouse${e.button}`);
}, true);

$('open-settings').addEventListener('click', () => openSheet('settings', 'menu'));
$('pause-settings').addEventListener('click', () => openSheet('settings', 'pause'));
$('open-controls').addEventListener('click', () => openSheet('controls', 'menu'));
$('pause-controls').addEventListener('click', () => openSheet('controls', 'pause'));
$('s-close').addEventListener('click', () => closeSheet('settings'));
$('c-close').addEventListener('click', () => closeSheet('controls'));
$('s-reset').addEventListener('click', () => {
  settings = structuredClone(DEFAULT_SETTINGS);
  saveSettings(settings);
  sfx.setVolume(settings.volume);
  applyQuality(settings.quality);
  renderSettings();
});

// ---------- HUD ----------
const hudEls = {
  speed: $('speed'), speedbar: $('speedbar'), slidebar: $('slidebar'), walljumps: $('walljumps'),
  weapon: $('weapon'), weaponSub: $('weapon-sub'), timer: $('timer'), split: $('split'), fps: $('fps'), slots: $('slots'),
};
let fpsFrames = 0;
let fpsTime = 0;

function updateHud(dt: number): void {
  if (!game) return;
  const h = game.hud();
  hudEls.speed.textContent = h.speed.toFixed(1);
  hudEls.speedbar.style.width = `${Math.min(100, (h.speed / 14) * 100)}%`;
  hudEls.slidebar.style.width = `${Math.round(h.slideReady * 100)}%`;
  hudEls.slidebar.classList.toggle('ready', h.slideReady >= 1);
  hudEls.walljumps.hidden = !h.weapon.wallJump;
  hudEls.walljumps.querySelectorAll('b').forEach((b, i) => b.classList.toggle('used', i >= h.wallJumpsLeft));
  hudEls.weapon.textContent = h.weapon.name;
  hudEls.weapon.style.color = RARITY_BY_ID[h.rarity].color;
  hudEls.weaponSub.textContent = `${RARITY_BY_ID[h.rarity].name} · ${Math.round(h.weapon.moveSpeed * 100)}% speed${h.weapon.wallJump ? ' · wall-jumps on' : ''}`;
  hudEls.slots.querySelectorAll<HTMLElement>('span').forEach((s) => s.classList.toggle('on', s.dataset['slot'] === h.slot));

  const showTimer = h.run !== 'idle';
  hudEls.timer.hidden = !showTimer;
  hudEls.timer.textContent = formatTime(h.runTime);
  hudEls.timer.classList.toggle('done', h.run === 'finished');
  hudEls.split.hidden = !h.splitText;
  if (h.splitText) hudEls.split.textContent = h.splitText;

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    hudEls.fps.textContent = `${Math.round(fpsFrames / fpsTime)} fps`;
    fpsFrames = 0;
    fpsTime = 0;
  }
  hudEls.fps.hidden = !settings.showFps;
}

// ---------- Resize + loop ----------
function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  gfx.setSize(w, h);
  menuCam.aspect = w / h;
  const narrow = w / h < 1;
  menuCam.position.set(narrow ? 0 : -1.5, 1.6, narrow ? 7.5 : 5.6);
  menuCam.lookAt(narrow ? 0 : -1.5, 1.1, 0);
  menuCam.updateProjectionMatrix();
  armory.resize(w, h);
  game?.resize(w, h);
}
window.addEventListener('resize', resize);
resize();
refreshMenuBest();

let last = performance.now();
let menuT = 0;
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  if (mode === 'playing' && game) {
    game.update(dt);
    input.endFrame();
    gfx.render(game.world.scene, game.camera, 0.5);
    updateHud(dt);
  } else if (mode === 'paused' && game) {
    gfx.render(game.world.scene, game.camera, 0.5);
  } else if (mode === 'armory') {
    armory.update(dt);
    gfx.render(armory.scene, armory.camera, 0.75);
  } else {
    menuT += dt;
    hero.rotation.y = -0.5 + Math.sin(menuT * 0.5) * 0.6;
    animateCharacter(hero, menuT, 0.15);
    floaters.forEach((m, i) => {
      m.rotation.x += dt * (0.4 + i * 0.1);
      m.rotation.y += dt * 0.6;
      m.position.y += Math.sin(menuT * 1.5 + i) * 0.003;
    });
    gfx.render(menuScene, menuCam, 0.45);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy for automated checks and debugging in the console.
(window as unknown as { blockfire: unknown }).blockfire = {
  get mode() { return mode; }, get game() { return game; }, armory, openArmory, selectArmoryWeapon,
  setRarity: (r: RarityId) => { armRarity = r; armory.show(armWeapon.id, r); renderArmoryPanel(); },
  pick: (id: string, r?: RarityId) => {
    const w = WEAPON_BY_ID[id]!;
    armTab = w.slot;
    selectArmoryWeapon(w);
    if (r) { armRarity = r; armory.show(w.id, r); renderArmoryPanel(); }
  },
};
