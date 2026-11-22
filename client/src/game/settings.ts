export type Action =
  | 'forward' | 'back' | 'left' | 'right'
  | 'jump' | 'crouch' | 'walk'
  | 'fire' | 'aim' | 'reload' | 'scoreboard'
  | 'respawn' | 'slot1' | 'slot2' | 'slot3';

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Move forward',
  back: 'Move back',
  left: 'Strafe left',
  right: 'Strafe right',
  jump: 'Jump (hold to bunny-hop)',
  crouch: 'Crouch / slide (hold while landing to slide-hop)',
  walk: 'Walk (silent)',
  fire: 'Shoot / swing',
  aim: 'Aim down sights',
  reload: 'Reload',
  scoreboard: 'Scoreboard (hold)',
  respawn: 'Back to checkpoint (parkour)',
  slot1: 'Primary weapon',
  slot2: 'Secondary weapon',
  slot3: 'Melee weapon',
};

export type BotLevel = 'easy' | 'normal' | 'hard' | 'insane';

export type FfaMap = 'blocktown' | 'neon-yard';

export interface Settings {
  name: string;
  botLevel: BotLevel;
  map: FfaMap;
  quality: import('./graphics.js').Quality;
  sensitivity: number;
  fov: number;
  volume: number;
  showFps: boolean;
  invertY: boolean;
  keys: Record<Action, string>;
}

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  botLevel: 'easy',
  map: 'blocktown',
  quality: 'high',
  sensitivity: 1,
  fov: 100,
  volume: 0.6,
  showFps: false,
  invertY: false,
  keys: {
    forward: 'KeyW',
    back: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    jump: 'Space',
    crouch: 'ShiftLeft',
    walk: 'KeyX',
    fire: 'Mouse0',
    aim: 'Mouse2',
    reload: 'KeyR',
    scoreboard: 'Tab',
    respawn: 'KeyR',
    slot1: 'Digit1',
    slot2: 'Digit2',
    slot3: 'Digit3',
  },
};

const STORAGE_KEY = 'blockfire.settings.v3';

/** Load settings from this browser. Falls back to defaults if storage is unavailable. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      keys: { ...DEFAULT_SETTINGS.keys, ...(parsed.keys ?? {}) },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: settings last for this visit only */
  }
}

/** "KeyW" → "W", "Space" → "Space", "ShiftLeft" → "Left Shift". */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const names: Record<string, string> = {
    ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl',
    AltLeft: 'Left Alt', AltRight: 'Right Alt', Space: 'Space', CapsLock: 'Caps Lock', Tab: 'Tab',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Mouse0: 'Left click', Mouse1: 'Middle click', Mouse2: 'Right click', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
  };
  return names[code] ?? code;
}

const BEST_KEY = 'blockfire.best.v1';

export function loadBest(mapId: string): number | null {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    return typeof all[mapId] === 'number' ? all[mapId]! : null;
  } catch {
    return null;
  }
}

export function saveBest(mapId: string, time: number): void {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    all[mapId] = time;
    localStorage.setItem(BEST_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}
