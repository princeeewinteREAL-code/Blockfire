/**
 * Placeholder sound effects made with the browser's Web Audio synthesizer — no files to
 * download. Every sound can be placed in 3D (volume by distance, left/right by direction).
 * Phase 5 replaces these with real CC0 recordings.
 */
export interface Where { vol?: number; pan?: number }

/** Sound files in client/public/sounds (made by tools/make_sounds.py; swap in real recordings any time). */
const FILES = [
  'shot_rifle', 'shot_smg', 'shot_mg', 'shot_sniper', 'shot_speedy', 'shot_revolver', 'shot_pistol', 'shot_handcannon',
  'shot_shotgun', 'shot_heavy', 'shot_launcher', 'shot_k2', 'shot_energy', 'shot_firecracker', 'shot_flare',
  'explosion', 'explosion_big', 'impact', 'step1', 'step2', 'step3', 'step4', 'jump', 'land', 'slide', 'slidehop',
  'walljump', 'climb', 'reload', 'empty', 'swap', 'swing', 'stab', 'hitmarker', 'headshot', 'kill', 'hurt', 'death',
  'ui_click', 'checkpoint', 'finish', 'respawn',
] as const;
type SoundName = (typeof FILES)[number];

const SHOT_FILE: Record<string, SoundName> = {
  assault_rifle: 'shot_rifle', smg: 'shot_smg', machine_gun: 'shot_mg', sniper: 'shot_sniper', speedy_sniper: 'shot_speedy',
  revolver: 'shot_revolver', auto_revolver: 'shot_revolver', bomber: 'shot_launcher', rocketeer: 'shot_launcher',
  sticky_bomb: 'shot_launcher', k2_bomber: 'shot_k2', electronic_gun: 'shot_energy', firecrackers: 'shot_firecracker',
  flare_pistol: 'shot_flare', super_pistols: 'shot_pistol', pistol: 'shot_pistol', snake_pistol: 'shot_pistol',
  auto_pistol: 'shot_pistol', snake_auto_pistol: 'shot_pistol', grapple_pistol: 'shot_pistol', hand_cannon: 'shot_handcannon',
  sawed_off: 'shot_shotgun', dual_heavy_mgs: 'shot_heavy',
};

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume = 0.6;
  private noiseBuf: AudioBuffer | null = null;
  private buffers = new Map<SoundName, AudioBuffer>();
  private loading = false;

  /** Load the sound files (once). Until they arrive, the built-in synth plays instead. */
  private loadFiles(): void {
    const ctx = this.ctx;
    if (!ctx || this.loading) return;
    this.loading = true;
    for (const name of FILES) {
      fetch(`sounds/${name}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((data) => ctx.decodeAudioData(data))
        .then((buf) => { this.buffers.set(name, buf); })
        .catch(() => { /* keep the synth fallback for this sound */ });
    }
  }

  /** Play a loaded sound file. Returns false if it isn't loaded (caller falls back to synth). */
  private play(name: SoundName, where: Where = {}, gain = 1, rateJitter = 0.05): boolean {
    const ctx = this.ctx;
    const buf = this.buffers.get(name);
    if (!ctx || !buf) return false;
    if ((where.vol ?? 1) < 0.01) return true;
    const out = this.out(where);
    if (!out) return false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1 + (Math.random() * 2 - 1) * rateJitter;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(out);
    src.start();
    return true;
  }

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
        this.loadFiles();
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
  jump(w: Where = {}): void { if (this.play('jump', w, 0.6)) return; this.tone(220, 420, 0.12, 'square', 0.05, w); }
  land(w: Where = {}): void { if (this.play('land', w, 0.8)) return; this.noise(0.09, 180, 0.35, w); }
  step(w: Where = {}): void { if (this.play((['step1', 'step2', 'step3', 'step4'] as const)[Math.floor(Math.random() * 4)]!, w, 0.55, 0.08)) return; this.noise(0.05, 900, 0.08, w); }
  slide(w: Where = {}): void { if (this.play('slide', w, 0.75)) return; this.noise(0.45, 1800, 0.18, w, 500); }
  slideHop(w: Where = {}): void { this.play('slidehop', w, 0.6); }
  wallJump(w: Where = {}): void { if (this.play('walljump', w, 0.8)) return; this.tone(330, 660, 0.16, 'triangle', 0.12, w); this.noise(0.06, 1200, 0.15, w); }
  climb(w: Where = {}): void { if (this.play('climb', w, 0.7)) return; this.tone(180, 260, 0.15, 'triangle', 0.1, w); }

  // ---- Weapons ----
  /** A gunshot that sounds different for each weapon family. */
  shot(weapon: string, w: Where = {}): void {
    const file = SHOT_FILE[weapon];
    if (file && this.play(file, w, 0.75, 0.04)) return;
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
  swing(w: Where = {}): void { if (this.play('swing', w, 0.7)) return; this.noise(0.16, 2400, 0.25, w, 600); }
  stab(w: Where = {}): void { if (this.play('stab', w, 0.9)) return; this.noise(0.08, 500, 0.5, w); this.tone(200, 90, 0.1, 'triangle', 0.2, w); }
  explosion(big: boolean, w: Where = {}): void {
    if (this.play(big ? 'explosion_big' : 'explosion', w, 1, 0.06)) return;
    this.noise(big ? 1.4 : 0.8, 900, big ? 1.2 : 0.9, w, 60, 'lowpass');
    this.tone(big ? 55 : 75, 25, big ? 0.9 : 0.5, 'sine', 0.7, w);
  }
  impact(w: Where = {}): void { if (this.play('impact', w, 0.4, 0.15)) return; this.noise(0.05, 2500, 0.15, w); }
  reload(w: Where = {}): void { if (this.play('reload', w, 0.7, 0.02)) return; this.tone(600, 400, 0.05, 'square', 0.05, w); this.tone(500, 700, 0.06, 'square', 0.05, w, 0.18); }
  empty(): void { if (this.play('empty', {}, 0.7)) return; this.tone(1200, 1100, 0.03, 'square', 0.05); }
  hitmarker(head: boolean): void {
    if (this.play(head ? 'headshot' : 'hitmarker', {}, head ? 0.6 : 0.5, 0.02)) return;
    if (head) { this.tone(1800, 1800, 0.08, 'sine', 0.18); this.tone(2700, 2700, 0.12, 'sine', 0.12, {}, 0.03); }
    else this.tone(1400, 1300, 0.05, 'square', 0.08);
  }
  hurt(): void { if (this.play('hurt', {}, 0.7)) return; this.noise(0.12, 300, 0.4); }
  killConfirm(): void { if (this.play('kill', {}, 0.55, 0)) return; [880, 1320].forEach((f, i) => this.tone(f, f, 0.1, 'triangle', 0.14, {}, i * 0.06)); }
  death(): void { if (this.play('death', {}, 0.7, 0)) return; this.tone(300, 60, 0.6, 'sawtooth', 0.12); }

  // ---- Interface ----
  checkpoint(): void { if (this.play('checkpoint', {}, 0.6, 0)) return; this.tone(660, 660, 0.12, 'sine', 0.15); this.tone(990, 990, 0.18, 'sine', 0.12, {}, 0.1); }
  start(): void { this.tone(520, 520, 0.1, 'square', 0.06); }
  finish(): void { if (this.play('finish', {}, 0.6, 0)) return; [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.22, 'triangle', 0.14, {}, i * 0.09)); }
  respawn(): void { if (this.play('respawn', {}, 0.5, 0)) return; this.tone(400, 120, 0.25, 'sawtooth', 0.06); }
  click(): void { if (this.play('ui_click', {}, 0.5, 0.03)) return; this.tone(800, 600, 0.05, 'square', 0.04); }
}
