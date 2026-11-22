/**
 * Placeholder sound effects made with the browser's Web Audio synthesizer — no files to
 * download. Phase 5 replaces these with real CC0 recordings.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume = 0.6;

  /** Must be called from a click (browsers only allow audio after the player interacts). */
  unlock(): void {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private tone(freq: number, to: number, dur: number, type: OscillatorType, gain: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, freq: number, gain: number, sweepTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq, ctx.currentTime);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start();
  }

  jump(): void { this.tone(220, 420, 0.12, 'square', 0.06); }
  land(): void { this.noise(0.09, 180, 0.35); }
  step(): void { this.noise(0.05, 900, 0.08); }
  slide(): void { this.noise(0.45, 1800, 0.18, 500); }
  wallJump(): void { this.tone(330, 660, 0.16, 'triangle', 0.12); this.noise(0.06, 1200, 0.15); }
  climb(): void { this.tone(180, 260, 0.15, 'triangle', 0.1); }
  checkpoint(): void { this.tone(660, 660, 0.12, 'sine', 0.15); this.tone(990, 990, 0.18, 'sine', 0.12, 0.1); }
  start(): void { this.tone(520, 520, 0.1, 'square', 0.06); }
  finish(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.22, 'triangle', 0.14, i * 0.09));
  }
  respawn(): void { this.tone(400, 120, 0.25, 'sawtooth', 0.06); }
  click(): void { this.tone(800, 600, 0.05, 'square', 0.04); }
}
