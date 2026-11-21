/**
 * Placeholder sound effects made with the browser's Web Audio synthesizer — no files to
 * download. Every sound can be placed in 3D (volume by distance, left/right by direction).
 * Phase 5 replaces these with real CC0 recordings.
 */
export interface Where { vol?: number; pan?: number }

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume = 0.6;
  private noiseBuf: AudioBuffer | null = null;

  unlock(): void {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        const comp = this.ctx.createDynamicsCompressor();
        this.master.connect(comp).connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
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

  private out(where: Where): AudioNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.master) return null;
    const g = ctx.createGain();
    g.gain.value = where.vol ?? 1;
    if (where.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, where.pan));
      g.connect(p).connect(this.master);
    } else {
      g.connect(this.master);
    }
    return g;
  }

  private tone(freq: number, to: number, dur: number, type: OscillatorType, gain: number, where: Where = {}, delay = 0): void {
    const ctx = this.ctx;
    const out = this.out(where);
    if (!ctx || !out || (where.vol ?? 1) < 0.01) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, freq: number, gain: number, where: Where = {}, sweepTo?: number, type: BiquadFilterType = 'bandpass', q = 1): void {
    const ctx = this.ctx;
    const out = this.out(where);
    if (!ctx || !out || !this.noiseBuf || (where.vol ?? 1) < 0.01) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loopStart = Math.random() * 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, ctx.currentTime);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(filter).connect(g).connect(out);
    src.start(0, Math.random() * 0.5, dur + 0.05);
  }

  // ---- Movement ----
  jump(w: Where = {}): void { this.tone(220, 420, 0.12, 'square', 0.05, w); }
  land(w: Where = {}): void { this.noise(0.09, 180, 0.35, w); }
  step(w: Where = {}): void { this.noise(0.05, 900, 0.08, w); }
  slide(w: Where = {}): void { this.noise(0.45, 1800, 0.18, w, 500); }
  wallJump(w: Where = {}): void { this.tone(330, 660, 0.16, 'triangle', 0.12, w); this.noise(0.06, 1200, 0.15, w); }
  climb(w: Where = {}): void { this.tone(180, 260, 0.15, 'triangle', 0.1, w); }

  // ---- Weapons ----
  /** A gunshot that sounds different for each weapon family. */
  shot(weapon: string, w: Where = {}): void {
    switch (weapon) {
      case 'sniper': case 'hand_cannon':
        this.noise(0.5, 400, 0.9, w, 120, 'lowpass'); this.tone(90, 40, 0.35, 'sine', 0.5, w); break;
      case 'speedy_sniper': case 'revolver': case 'auto_revolver':
        this.noise(0.3, 700, 0.7, w, 200, 'lowpass'); this.tone(120, 50, 0.2, 'sine', 0.35, w); break;
      case 'bomber': case 'k2_bomber': case 'rocketeer': case 'sticky_bomb':
        this.noise(0.35, 300, 0.6, w, 900, 'bandpass'); this.tone(80, 160, 0.25, 'sawtooth', 0.12, w); break;
      case 'electronic_gun':
        this.tone(1400, 300, 0.12, 'sawtooth', 0.12, w); this.tone(2200, 600, 0.08, 'square', 0.05, w); break;
      case 'firecrackers':
        this.tone(900, 1800, 0.08, 'square', 0.08, w); this.noise(0.08, 3000, 0.25, w); break;
      case 'flare_pistol':
        this.noise(0.4, 600, 0.4, w, 2000); break;
      case 'sawed_off':
        this.noise(0.45, 500, 1, w, 100, 'lowpass'); this.tone(70, 35, 0.3, 'sine', 0.5, w); break;
      case 'super_pistols': case 'smg': case 'auto_pistol': case 'snake_auto_pistol':
        this.noise(0.07, 1800, 0.45, w, 700, 'bandpass', 0.7); break;
      case 'dual_heavy_mgs': case 'machine_gun':
        this.noise(0.12, 900, 0.6, w, 300, 'lowpass'); this.tone(100, 60, 0.08, 'sine', 0.2, w); break;
      default:
        this.noise(0.12, 1300, 0.55, w, 400, 'bandpass', 0.8); this.tone(140, 60, 0.1, 'sine', 0.2, w);
    }
  }
  swing(w: Where = {}): void { this.noise(0.16, 2400, 0.25, w, 600); }
  stab(w: Where = {}): void { this.noise(0.08, 500, 0.5, w); this.tone(200, 90, 0.1, 'triangle', 0.2, w); }
  explosion(big: boolean, w: Where = {}): void {
    this.noise(big ? 1.4 : 0.8, 900, big ? 1.2 : 0.9, w, 60, 'lowpass');
    this.tone(big ? 55 : 75, 25, big ? 0.9 : 0.5, 'sine', 0.7, w);
  }
  impact(w: Where = {}): void { this.noise(0.05, 2500, 0.15, w); }
  reload(w: Where = {}): void { this.tone(600, 400, 0.05, 'square', 0.05, w); this.tone(500, 700, 0.06, 'square', 0.05, w, 0.18); }
  empty(): void { this.tone(1200, 1100, 0.03, 'square', 0.05); }
  hitmarker(head: boolean): void {
    if (head) { this.tone(1800, 1800, 0.08, 'sine', 0.18); this.tone(2700, 2700, 0.12, 'sine', 0.12, {}, 0.03); }
    else this.tone(1400, 1300, 0.05, 'square', 0.08);
  }
  hurt(): void { this.noise(0.12, 300, 0.4); }
  killConfirm(): void { [880, 1320].forEach((f, i) => this.tone(f, f, 0.1, 'triangle', 0.14, {}, i * 0.06)); }
  death(): void { this.tone(300, 60, 0.6, 'sawtooth', 0.12); }

  // ---- Interface ----
  checkpoint(): void { this.tone(660, 660, 0.12, 'sine', 0.15); this.tone(990, 990, 0.18, 'sine', 0.12, {}, 0.1); }
  start(): void { this.tone(520, 520, 0.1, 'square', 0.06); }
  finish(): void { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.22, 'triangle', 0.14, {}, i * 0.09)); }
  respawn(): void { this.tone(400, 120, 0.25, 'sawtooth', 0.06); }
  click(): void { this.tone(800, 600, 0.05, 'square', 0.04); }
}
