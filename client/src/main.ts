import './style.css';
import * as THREE from 'three';
import {
  BLOCKTOWN, NEON_YARD, RARITIES, RARITY_BY_ID, TEST_MAP, WEAPON_BY_ID, bodyTtk, weaponsInSlot, type RarityId, type Slot, type WeaponDef,
} from '@blockfire/shared';
import { Game, formatTime } from './game/game.js';
import { FfaGame } from './game/ffa.js';
import { OnlineGame, serverUrl } from './game/online.js';
import { Input } from './game/input.js';
import { Sfx } from './game/audio.js';
import { animateCharacter, buildCharacter } from './game/character.js';
import { pixelTexture, skyTexture } from './game/textures.js';
import { Graphics, QUALITY_LABELS, refreshMaterials, type Quality } from './game/graphics.js';
import { ArmoryScene } from './game/armory.js';
import { loadLoadout, rarityOf, saveLoadout, type Loadout } from './game/loadout.js';
import {
  ACTION_LABELS, DEFAULT_SETTINGS, keyLabel, loadBest, loadSettings, saveSettings,
  type Action, type BotLevel, type FfaMap, type Settings,
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
type Mode = 'menu' | 'playing' | 'paused' | 'armory' | 'ended';
let mode: Mode = 'menu';
let game: Game | null = null;
let ffa: FfaGame | null = null;
let kind: 'parkour' | 'ffa' = 'ffa';
let lastWasOnline = false;
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

async function startPlaying(next?: 'parkour' | 'ffa', fresh = false): Promise<void> {
  sfx.unlock();
  sfx.click();
  if (next) kind = next;
  if (fresh && ffa instanceof OnlineGame) { ffa.leave(); ffa = null; }
  if (kind === 'parkour') {
    if (!game) game = new Game(TEST_MAP, input, sfx, getSettings, gfx, getLoadout);
    game.refreshWeapon();
  } else {
    const map = settings.map === 'neon-yard' ? NEON_YARD : BLOCKTOWN;
    if (!ffa || fresh || ffa.over) ffa = new FfaGame(map, input, sfx, getSettings, gfx, getLoadout, settings.botLevel, map === BLOCKTOWN ? 9 : 7);
    $('f-board-title').textContent = `Free For All · ${map.name}`;
    ffa.refreshWeapon();
  }
  resize();
  input.setEnabled(true);
  const locked = await input.lock();
  usingFallbackLook = !locked;
  if (!locked) toast('Your browser blocked mouse capture here. Hold the left mouse button and drag to look. Esc pauses.', 6000);
  mode = 'playing';
  show('menu', false); show('pause', false); show('match-end', false);
  show('hud', kind === 'parkour'); show('ffa-hud', kind === 'ffa');
}

// ---------- Online ----------
async function startOnline(mode: 'quick' | 'create' | 'join', code = ''): Promise<void> {
  const url = serverUrl();
  if (!url) { toast('Online play needs the game server, which is not set up yet.'); return; }
  const name = ($<HTMLInputElement>('o-name').value.trim() || 'Player').slice(0, 18);
  settings = { ...settings, name };
  saveSettings(settings);
  if (ffa instanceof OnlineGame) ffa.leave();
  const map = settings.map === 'neon-yard' ? NEON_YARD : BLOCKTOWN;
  ffa = new OnlineGame(map, input, sfx, getSettings, gfx, getLoadout, url, mode, code.toUpperCase(), name);
  $('f-board-title').textContent = `Online · ${map.name}`;
  show('online', false);
  toast('Connecting…', 2000);
  await startPlaying('ffa');
}

function openOnline(): void {
  sfx.unlock();
  sfx.click();
  const url = serverUrl();
  $('o-server').textContent = url ? `Server: ${url.replace(/^wss?:\/\//, '')}` : 'The online server is not set up yet. Free For All vs bots works offline.';
  $<HTMLInputElement>('o-name').value = settings.name;
  show('menu', false);
  show('online', true);
}
$('play-online').addEventListener('click', openOnline);
$('o-close').addEventListener('click', () => { sfx.click(); show('online', false); show('menu', true); });
$('o-quick').addEventListener('click', () => void startOnline('quick'));
$('o-create').addEventListener('click', () => void startOnline('create'));
$('o-join').addEventListener('click', () => {
  const code = $<HTMLInputElement>('o-code').value.trim();
  if (code.length !== 6) { toast('Room codes are 6 letters and numbers.'); return; }
  void startOnline('join', code);
});

function pause(): void {
  if (mode !== 'playing') return;
  mode = 'paused';
  input.setEnabled(false);
  input.unlock();
  show('pause', true);
}

function toMenu(): void {
  if (ffa instanceof OnlineGame) { ffa.leave(); ffa = null; }
  mode = 'menu';
  input.setEnabled(false);
  input.unlock();
  show('pause', false); show('hud', false); show('ffa-hud', false); show('match-end', false); show('armory', false); show('menu', true);
  refreshMenuBest();
}

document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && mode === 'playing' && !usingFallbackLook) pause();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && mode === 'playing' && usingFallbackLook) pause();
  if (e.code === 'Escape' && mode === 'armory') toMenu();
});

$('play').addEventListener('click', () => void startPlaying('parkour'));
$('play-ffa').addEventListener('click', () => void startPlaying('ffa', true));
$('resume').addEventListener('click', () => void startPlaying());
$('end-again').addEventListener('click', () => {
  if (lastWasOnline) void startOnline('quick'); else void startPlaying('ffa', true);
});
$('end-menu').addEventListener('click', () => { sfx.click(); toMenu(); });

function renderLevels(): void {
  document.querySelectorAll<HTMLButtonElement>('.lvlbtn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset['level'] === settings.botLevel)));
  document.querySelectorAll<HTMLButtonElement>('.mapbtn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset['map'] === settings.map)));
}
document.querySelectorAll<HTMLButtonElement>('.lvlbtn').forEach((b) => {
  b.addEventListener('click', () => {
    sfx.unlock();
    sfx.click();
    settings = { ...settings, botLevel: b.dataset['level'] as BotLevel };
    saveSettings(settings);
    renderLevels();
  });
});
document.querySelectorAll<HTMLButtonElement>('.mapbtn').forEach((b) => {
  b.addEventListener('click', () => {
    sfx.unlock();
    sfx.click();
    settings = { ...settings, map: b.dataset['map'] as FfaMap };
    saveSettings(settings);
    renderLevels();
  });
});
renderLevels();
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
  ffa = null; // the next Free For All match uses the new loadout
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
  if (ffa) refreshMaterials(ffa.world.scene, gfx.shadowSize);
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

// ---------- Free For All HUD ----------
const f$ = {
  hurt: $('f-hurt'), scope: $('f-scope'), cross: $('f-cross'), hit: $('f-hit'), mine: $('f-mine'), clock: $('f-clock'), lead: $('f-lead'),
  sub: $('f-sub'), feed: $('f-feed'), callout: $('f-callout'), protect: $('f-protect'), hp: $('f-hp'), hpbar: $('f-hpbar'),
  speed: $('f-speed'), slidebar: $('f-slidebar'), walljumps: $('f-walljumps'), slots: $('f-slots'), weapon: $('f-weapon'),
  ammo: $('f-ammo'), mag: $('f-mag'), reloadWrap: $('f-reloadwrap'), reload: $('f-reload'), dead: $('f-dead'),
  deadTitle: $('f-dead-title'), deadBy: $('f-dead-by'), deadTimer: $('f-dead-timer'), board: $('f-board'), boardRows: $('f-board-rows'),
};
let feedKey = '';

function esc(t: string): string {
  return t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function standingsRows(rows: ReturnType<FfaGame['hud']>['standings']): string {
  return rows.map((r, i) => `<tr class="${r.me ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td><td>${r.kills}</td><td>${r.deaths}</td></tr>`).join('');
}

function updateFfaHud(dt: number): void {
  if (!ffa) return;
  const h = ffa.hud();
  f$.hurt.style.opacity = String(Math.min(0.9, h.hurt + (h.hp < 35 && h.alive ? 0.25 : 0)));
  f$.scope.hidden = !h.scoped;
  f$.cross.style.opacity = String(h.scoped ? 0 : 1 - h.ads * 0.7);
  f$.hit.style.opacity = String(h.hitmarker);
  f$.hit.classList.toggle('head', h.hitHead);
  const m = Math.floor(h.timeLeft / 60);
  f$.clock.textContent = `${m}:${String(Math.floor(h.timeLeft % 60)).padStart(2, '0')}`;
  f$.mine.textContent = String(h.myKills);
  const leadOther = h.standings.find((r) => !r.me);
  f$.lead.textContent = String(leadOther?.kills ?? 0);
  if (ffa instanceof OnlineGame) {
    const o = ffa;
    if (o.status === 'error' || o.status === 'closed') {
      toast(o.error || 'Disconnected.', 5000);
      toMenu();
      return;
    }
    f$.sub.textContent = o.status === 'connecting' ? 'Connecting to the server…'
      : `Room ${o.code} · ${Math.round(o.ping)} ms · first to ${h.scoreLimit}`;
  } else {
    f$.sub.textContent = `You ${h.myKills} · best bot ${leadOther?.kills ?? 0} · first to ${h.scoreLimit}`;
  }

  const key = h.feed.map((f) => f.killer + f.victim + f.age.toFixed(0)).join('|');
  if (key !== feedKey) {
    feedKey = key;
    f$.feed.innerHTML = h.feed.map((f) =>
      `<div class="${f.mine ? `mine-${f.mine}` : ''}">${esc(f.killer)} <span class="w">[${esc(f.weapon)}]</span>${f.head ? ' <span class="hs">HEADSHOT</span>' : ''} ${esc(f.victim)}</div>`).join('');
  }
  f$.callout.hidden = !h.callout;
  if (h.callout) f$.callout.textContent = h.callout;
  f$.protect.hidden = !(h.alive && h.protect > 0);

  f$.hp.textContent = String(Math.ceil(h.hp));
  f$.hpbar.style.width = `${h.hp}%`;
  f$.hpbar.classList.toggle('low', h.hp < 35);
  f$.speed.textContent = h.speed.toFixed(1);
  f$.slidebar.style.width = `${Math.round(h.slideReady * 100)}%`;
  f$.slidebar.classList.toggle('ready', h.slideReady >= 1);
  f$.walljumps.hidden = !h.weapon.wallJump;
  f$.walljumps.querySelectorAll('b').forEach((b, i) => b.classList.toggle('used', i >= h.wallJumpsLeft));
  f$.slots.querySelectorAll<HTMLElement>('span').forEach((s) => s.classList.toggle('on', s.dataset['slot'] === h.slot));
  f$.weapon.textContent = h.weapon.name;
  f$.weapon.style.color = RARITY_BY_ID[h.rarity].color;
  const melee = h.weapon.slot === 'melee';
  f$.ammo.textContent = melee ? '∞' : String(h.ammo);
  f$.mag.textContent = melee ? '' : `/ ${h.weapon.mag}`;
  f$.reloadWrap.hidden = h.reload < 0;
  f$.reload.style.width = `${Math.max(0, h.reload) * 100}%`;

  f$.dead.hidden = h.alive;
  if (!h.alive) {
    f$.deadBy.textContent = h.killedBy ? `${h.killedBy} got you with the ${h.killedWith ?? 'weapon'}` : 'You fell';
    f$.deadTimer.textContent = `Respawning in ${Math.max(1, Math.ceil(h.respawnIn))}`;
  }
  const showBoard = input.held('scoreboard');
  f$.board.hidden = !showBoard;
  if (showBoard) f$.boardRows.innerHTML = standingsRows(h.standings);

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) { hudEls.fps.textContent = `${Math.round(fpsFrames / fpsTime)} fps`; fpsFrames = 0; fpsTime = 0; }
}

function endMatch(): void {
  if (!ffa || mode === 'ended') return;
  mode = 'ended';
  input.setEnabled(false);
  input.unlock();
  const h = ffa.hud();
  const meFirst = h.standings[0]?.me;
  $('end-title').textContent = meFirst ? 'You win!' : `${h.winner ?? 'A bot'} wins`;
  lastWasOnline = ffa instanceof OnlineGame;
  if (ffa instanceof OnlineGame) { ffa.leave(); }
  $('end-rows').innerHTML = standingsRows(h.standings);
  show('ffa-hud', false);
  show('match-end', true);
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
  ffa?.resize(w, h);
}
window.addEventListener('resize', resize);
resize();
refreshMenuBest();

let last = performance.now();
let menuT = 0;
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  if (mode === 'playing' && kind === 'parkour' && game) {
    game.update(dt);
    input.endFrame();
    gfx.render(game.world.scene, game.camera, 0.4);
    updateHud(dt);
  } else if (mode === 'playing' && kind === 'ffa' && ffa) {
    ffa.update(dt);
    input.endFrame();
    gfx.render(ffa.world.scene, ffa.camera, 0.4);
    updateFfaHud(dt);
    if (ffa.over) endMatch();
  } else if ((mode === 'paused' || mode === 'ended') && kind === 'ffa' && ffa) {
    gfx.render(ffa.world.scene, ffa.camera, 0.4);
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
  get mode() { return mode; }, get game() { return game; }, get ffa() { return ffa; }, armory, openArmory, selectArmoryWeapon,
  setRarity: (r: RarityId) => { armRarity = r; armory.show(armWeapon.id, r); renderArmoryPanel(); },
  pick: (id: string, r?: RarityId) => {
    const w = WEAPON_BY_ID[id]!;
    armTab = w.slot;
    selectArmoryWeapon(w);
    if (r) { armRarity = r; armory.show(w.id, r); renderArmoryPanel(); }
  },
};
