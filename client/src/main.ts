import './style.css';
import * as THREE from 'three';
import { TEST_MAP } from '@blockfire/shared';
import { Game, formatTime } from './game/game.js';
import { Input } from './game/input.js';
import { Sfx } from './game/audio.js';
import { animateCharacter, buildCharacter } from './game/character.js';
import { pixelTexture, skyTexture } from './game/textures.js';
import {
  ACTION_LABELS, DEFAULT_SETTINGS, keyLabel, loadBest, loadSettings, saveSettings,
  type Action, type Settings,
} from './game/settings.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- Core objects ----------
const canvas = $<HTMLCanvasElement>('view');
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch {
  document.body.innerHTML = '<p style="padding:24px;font:18px system-ui;color:#fff">Blockfire needs WebGL. Please try an up-to-date Chrome, Edge, Firefox or Safari.</p>';
  throw new Error('WebGL unavailable');
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

let settings: Settings = loadSettings();
const getSettings = () => settings;
const sfx = new Sfx();
sfx.setVolume(settings.volume);
const input = new Input(canvas, getSettings);

// ---------- Menu scene: the blocky character on a grass block ----------
const menuScene = new THREE.Scene();
menuScene.background = skyTexture('#4f8ff0', '#ffd9a8');
menuScene.add(new THREE.HemisphereLight(0xffffff, 0x6a5a4a, 1.4));
const menuSun = new THREE.DirectionalLight(0xfff0dd, 1.8);
menuSun.position.set(3, 6, 4);
menuSun.castShadow = true;
menuSun.shadow.mapSize.set(1024, 1024);
menuScene.add(menuSun);
const pedestal = new THREE.Mesh(
  new THREE.BoxGeometry(2.4, 1, 2.4),
  [
    new THREE.MeshLambertMaterial({ map: pixelTexture('#8a5a33', 'wood') }),
    new THREE.MeshLambertMaterial({ map: pixelTexture('#8a5a33', 'wood') }),
    new THREE.MeshLambertMaterial({ map: pixelTexture('#62b04f', 'grass') }),
    new THREE.MeshLambertMaterial({ map: pixelTexture('#8a5a33', 'wood') }),
    new THREE.MeshLambertMaterial({ map: pixelTexture('#8a5a33', 'wood') }),
    new THREE.MeshLambertMaterial({ map: pixelTexture('#8a5a33', 'wood') }),
  ],
);
pedestal.position.y = -0.5;
pedestal.receiveShadow = true;
menuScene.add(pedestal);
const hero = buildCharacter();
menuScene.add(hero);
const floaters: THREE.Mesh[] = [];
['#ff5a1f', '#ffd23f', '#3ddc84', '#b38cff', '#5aa0ff'].forEach((c, i) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshLambertMaterial({ map: pixelTexture(c, 'neon') }));
  m.position.set(Math.cos(i * 1.3) * 2.6, 0.6 + i * 0.45, Math.sin(i * 1.3) * 2.6 - 1);
  menuScene.add(m);
  floaters.push(m);
});
const menuCam = new THREE.PerspectiveCamera(40, 1, 0.1, 100);

// ---------- State ----------
type Mode = 'menu' | 'playing' | 'paused';
let mode: Mode = 'menu';
let game: Game | null = null;
let usingFallbackLook = false;

const show = (id: string, on: boolean) => { $(id).hidden = !on; };

function toast(text: string, ms = 3500): void {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  window.clearTimeout((toast as unknown as { h?: number }).h);
  (toast as unknown as { h?: number }).h = window.setTimeout(() => { t.hidden = true; }, ms);
}

function refreshMenuBest(): void {
  const best = loadBest(TEST_MAP.id);
  $('menu-best').textContent = best !== null ? `Best parkour time: ${formatTime(best)}` : '';
}

async function startPlaying(): Promise<void> {
  sfx.unlock();
  sfx.click();
  if (!game) {
    game = new Game(TEST_MAP, input, sfx, getSettings);
    resize();
  }
  input.setEnabled(true);
  const locked = await input.lock();
  usingFallbackLook = !locked;
  if (!locked) toast('Your browser blocked mouse capture here — hold a mouse button and drag to look. Esc pauses.', 6000);
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
  show('pause', false); show('hud', false); show('menu', true);
  refreshMenuBest();
}

document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && mode === 'playing' && !usingFallbackLook) pause();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && mode === 'playing' && usingFallbackLook) pause();
});

$('play').addEventListener('click', () => void startPlaying());
$('resume').addEventListener('click', () => void startPlaying());
$('quit').addEventListener('click', () => { sfx.click(); toMenu(); });

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

function renderSettings(): void {
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
  renderSettings();
  resize();
});

// ---------- HUD ----------
const hudEls = {
  speed: $('speed'), speedbar: $('speedbar'), slidebar: $('slidebar'), walljumps: $('walljumps'),
  weapon: $('weapon'), weaponSub: $('weapon-sub'), timer: $('timer'), split: $('split'), fps: $('fps'),
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
  hudEls.walljumps.hidden = !h.weapon.snake;
  hudEls.walljumps.querySelectorAll('b').forEach((b, i) => b.classList.toggle('used', i >= h.wallJumpsLeft));
  hudEls.weapon.textContent = h.weapon.name;
  hudEls.weaponSub.textContent = `${Math.round(h.weapon.speedMul * 100)}% speed${h.weapon.snake ? ' · wall-jumps on' : ''}`;

  const showTimer = h.run === 'running' || h.run === 'finished' || h.run === 'ready';
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
  renderer.setSize(w, h, false);
  menuCam.aspect = w / h;
  // On narrow screens, move the character to the middle and pull the camera back.
  const narrow = w / h < 1;
  menuCam.position.set(narrow ? 0 : -1.5, 1.6, narrow ? 7.5 : 5.6);
  menuCam.lookAt(narrow ? 0 : -1.5, 1.1, 0);
  menuCam.updateProjectionMatrix();
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
    renderer.render(game.world.scene, game.camera);
    updateHud(dt);
  } else if (mode === 'paused' && game) {
    renderer.render(game.world.scene, game.camera);
  } else {
    menuT += dt;
    hero.rotation.y = -0.5 + Math.sin(menuT * 0.5) * 0.6;
    animateCharacter(hero, menuT, 0.15);
    floaters.forEach((m, i) => {
      m.rotation.x += dt * (0.4 + i * 0.1);
      m.rotation.y += dt * 0.6;
      m.position.y += Math.sin(menuT * 1.5 + i) * 0.003;
    });
    renderer.render(menuScene, menuCam);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy for automated checks and debugging in the console.
(window as unknown as { blockfire: unknown }).blockfire = { get mode() { return mode; }, get game() { return game; } };
