import type { Action, Settings } from './settings.js';

/**
 * Keyboard + mouse input. Uses pointer lock when the browser allows it; otherwise
 * falls back to "hold the mouse button and drag to look".
 */
export class Input {
  private down = new Set<string>();
  private pressedOnce = new Set<string>();
  yaw = 0;
  pitch = 0;
  locked = false;
  private dragging = false;
  private enabled = false;

  constructor(private canvas: HTMLElement, private settings: () => Settings) {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
      if (!this.down.has(e.code)) this.pressedOnce.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());

    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      const code = `Mouse${e.button}`;
      if (!this.down.has(code)) this.pressedOnce.add(code);
      this.down.add(code);
      if (!this.locked) this.dragging = true;
    });
    window.addEventListener('mouseup', (e) => {
      this.down.delete(`Mouse${e.button}`);
      this.dragging = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || (!this.locked && !this.dragging)) return;
      const s = this.settings();
      const k = 0.0022 * s.sensitivity;
      this.yaw -= e.movementX * k;
      this.pitch -= e.movementY * k * (s.invertY ? -1 : 1);
      const limit = Math.PI / 2 - 0.01;
      this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
    });
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) { this.down.clear(); this.pressedOnce.clear(); this.dragging = false; }
  }

  /** Ask for pointer lock. Call from a click handler. Resolves true if granted. */
  async lock(): Promise<boolean> {
    try {
      const req = this.canvas.requestPointerLock() as unknown;
      if (req && typeof (req as Promise<void>).then === 'function') await (req as Promise<void>);
      return true;
    } catch {
      return false;
    }
  }

  unlock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  held(action: Action): boolean {
    return this.down.has(this.settings().keys[action]);
  }

  /** True once per key press. */
  pressed(action: Action): boolean {
    const code = this.settings().keys[action];
    if (this.pressedOnce.has(code)) {
      this.pressedOnce.delete(code);
      return true;
    }
    return false;
  }

  /** Forget unread presses (call once per frame after reading). */
  endFrame(): void {
    this.pressedOnce.clear();
  }
}
