"""
Blockfire sound designer.

Renders every game sound to client/public/sounds/*.mp3 from layered, physically motivated
parts instead of simple beeps:

  gunshot = sharp crack (the supersonic snap) + punchy filtered-noise body + low thump
            + mechanical action clicks + a short outdoor echo (convolution reverb)

Run:  python3 tools/make_sounds.py
Swap any file for a real recording (same name) and the game will use it.
"""
import os
import subprocess
import tempfile
import wave

import numpy as np
from scipy.signal import butter, lfilter, fftconvolve

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), '..', 'client', 'public', 'sounds')
rng = np.random.default_rng(7)


def t(dur):
    return np.arange(int(SR * dur)) / SR


def noise(dur):
    return rng.standard_normal(int(SR * dur))


def band(x, lo, hi, order=2):
    nyq = SR / 2
    lo = max(lo, 20) / nyq
    hi = min(hi, nyq - 100) / nyq
    b, a = butter(order, [lo, hi], btype='band')
    return lfilter(b, a, x)


def low(x, f, order=2):
    b, a = butter(order, f / (SR / 2), btype='low')
    return lfilter(b, a, x)


def high(x, f, order=2):
    b, a = butter(order, f / (SR / 2), btype='high')
    return lfilter(b, a, x)


def env(dur, attack, decay, total=None):
    """Fast attack, exponential decay envelope."""
    n = int(SR * (total or dur))
    tt = np.arange(n) / SR
    e = np.exp(-tt / decay)
    a = max(1, int(SR * attack))
    e[:a] *= np.linspace(0, 1, a)
    return e


def sweep(f0, f1, dur, decay):
    tt = t(dur)
    f = f1 + (f0 - f1) * np.exp(-tt / (dur / 4))
    phase = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(phase) * np.exp(-tt / decay)


def ring(freq, dur, decay, delay=0.0):
    tt = t(dur)
    x = np.sin(2 * np.pi * freq * tt) * np.exp(-tt / decay)
    return pad(np.zeros(int(SR * delay)), x)


def pad(*parts):
    n = max(len(p) for p in parts)
    out = np.zeros(n)
    for p in parts:
        out[:len(p)] += p
    return out


def mix(*layers):
    n = max(len(x) for x, _ in layers)
    out = np.zeros(n)
    for x, g in layers:
        out[:len(x)] += x * g
    return out


def place(x, delay):
    return np.concatenate([np.zeros(int(SR * delay)), x])


def reverb(x, size=0.35, wet=0.25, bright=4000):
    """Outdoor-ish echo: a few early reflections + a diffuse decaying tail."""
    ir = noise(size)
    n = len(ir)
    ir = ir * np.exp(-np.arange(n) / (SR * size / 5))
    ir = low(ir, bright)
    for d, g in [(0.011, 0.5), (0.023, 0.35), (0.041, 0.25), (0.067, 0.18)]:
        i = int(SR * d)
        if i < n:
            ir[i] += g * 6
    ir /= np.max(np.abs(ir)) + 1e-9
    dry = np.concatenate([x, np.zeros(n)])
    w = fftconvolve(x, ir)[: len(dry)]
    w = np.pad(w, (0, len(dry) - len(w)))
    w /= np.max(np.abs(w)) + 1e-9
    dry /= np.max(np.abs(dry)) + 1e-9
    return dry * (1 - wet) + w * wet


def finish(x, peak=0.89, fade=0.02):
    x = x - np.mean(x)
    f = int(SR * fade)
    if len(x) > f:
        x[-f:] *= np.linspace(1, 0, f)
    m = np.max(np.abs(x)) + 1e-9
    # Gentle soft-clip for punch.
    x = np.tanh(x / m * 1.6) / np.tanh(1.6)
    return x * peak


# ---------------- Building blocks ----------------

def gunshot(crack_hi=6000, body=(300, 2400), body_decay=0.045, thump=(140, 50), thump_decay=0.06,
            thump_gain=0.9, crack_gain=1.0, body_gain=1.0, mech=(2800, 4100), mech_gain=0.12,
            tail=0.45, wet=0.28, dur=0.6):
    crack = high(noise(0.006), crack_hi * 0.5) * env(0.006, 0.0002, 0.0015)
    bod = band(noise(dur), *body) * env(dur, 0.0005, body_decay)
    th = sweep(thump[0], thump[1], dur, thump_decay)
    mc = pad(ring(mech[0], 0.05, 0.008, 0.035), ring(mech[1], 0.05, 0.006, 0.05)) if mech_gain else np.zeros(1)
    x = mix((crack, crack_gain * 1.4), (bod, body_gain), (th, thump_gain), (mc, mech_gain))
    return finish(reverb(x, tail, wet))


def launcher(deep=False):
    dur = 0.9 if deep else 0.6
    pop = sweep(180 if deep else 260, 45 if deep else 70, dur, 0.09 if deep else 0.06)
    whoosh = band(noise(dur), 600, 3000) * env(dur, 0.03, 0.18 if deep else 0.12)
    clack = high(noise(0.01), 2000) * env(0.01, 0.0002, 0.002)
    return finish(reverb(mix((pop, 1.2), (whoosh, 0.35), (clack, 0.5)), 0.5, 0.25))


def explosion(big=False):
    dur = 2.2 if big else 1.3
    boom = low(noise(dur), 420 if big else 600) * env(dur, 0.002, 0.5 if big else 0.28)
    sub = sweep(70 if big else 90, 28, dur, 0.6 if big else 0.35)
    crack = high(noise(0.02), 1500) * env(0.02, 0.0003, 0.006)
    debris = np.zeros(int(SR * dur))
    for _ in range(40 if big else 22):
        p = int(rng.uniform(0.05, dur * 0.7) * SR)
        g = high(noise(0.01), 3000) * env(0.01, 0.0002, 0.002) * rng.uniform(0.05, 0.25)
        debris[p:p + len(g)] += g[: max(0, len(debris) - p)]
    return finish(reverb(mix((boom, 1.4), (sub, 1.0), (crack, 0.7), (debris, 0.6)), 0.8 if big else 0.6, 0.3), 0.95)


def zap():
    dur = 0.25
    tt = t(dur)
    f = 1800 * np.exp(-tt / 0.05) + 300
    mod = np.sin(2 * np.pi * 90 * tt) * 6
    x = np.sin(2 * np.pi * np.cumsum(f) / SR + mod) * np.exp(-tt / 0.07)
    fizz = band(noise(dur), 3000, 9000) * env(dur, 0.001, 0.03)
    return finish(reverb(mix((x, 0.8), (fizz, 0.4), (sweep(200, 60, dur, 0.03), 0.4)), 0.3, 0.2))


def firecracker():
    pop = high(noise(0.02), 1200) * env(0.02, 0.0002, 0.004)
    crackle = np.zeros(int(SR * 0.35))
    for _ in range(9):
        p = int(rng.uniform(0.02, 0.25) * SR)
        g = high(noise(0.006), 2500) * env(0.006, 0.0002, 0.0015) * rng.uniform(0.2, 0.6)
        crackle[p:p + len(g)] += g
    whistle = sweep(2400, 3200, 0.1, 0.05) * 0.2
    return finish(reverb(mix((pop, 1.2), (crackle, 0.9), (sweep(220, 90, 0.2, 0.04), 0.6), (whistle, 0.4)), 0.35, 0.25))


def whoosh(dur=0.3, lo=400, hi=2500, attack=0.08, gain=1.0):
    x = band(noise(dur), lo, hi) * env(dur, attack, dur / 3)
    return finish(x, 0.6 * gain)


def footstep(i):
    dur = 0.12
    heel = low(noise(dur), 900 + i * 80) * env(dur, 0.001, 0.02)
    grit = band(noise(dur), 2500, 7000) * env(dur, 0.003, 0.012)
    thud = sweep(110 + i * 7, 60, dur, 0.02)
    return finish(mix((heel, 1), (grit, 0.25), (thud, 0.5)), 0.55)


def land():
    dur = 0.25
    return finish(mix((low(noise(dur), 500) * env(dur, 0.001, 0.04), 1), (sweep(90, 45, dur, 0.06), 0.9),
                      (band(noise(dur), 2000, 6000) * env(dur, 0.002, 0.02), 0.2)), 0.7)


def slide():
    dur = 0.55
    tt = t(dur)
    scrape = band(noise(dur), 900, 5000) * (np.exp(-tt / 0.3) * np.minimum(1, tt / 0.03))
    rumble = low(noise(dur), 300) * np.exp(-tt / 0.25)
    return finish(mix((scrape, 0.9), (rumble, 0.5)), 0.55)


def click(freqs=(3200, 2100), dur=0.06, gain=0.6, delay=0.0):
    x = pad(*[ring(f, dur, 0.006, delay + i * 0.012) for i, f in enumerate(freqs)])
    tick = high(noise(0.004), 3000) * env(0.004, 0.0002, 0.001) * 0.5
    x = pad(x, place(tick, delay))
    return finish(x, gain)


def reload_sound():
    out = pad(
        click((2600, 1700), 0.08, 1.0),
        place(low(noise(0.08), 900) * env(0.08, 0.001, 0.02), 0.12),
        place(click((3400, 2300, 1500), 0.1, 1.0), 0.32),
    )
    return finish(out, 0.55)


def bell(freqs, dur=0.5, decay=0.18, gain=0.5, stagger=0.0):
    x = pad(*[ring(f, dur, decay * (1 - i * 0.15), i * stagger) * (1 - i * 0.25) for i, f in enumerate(freqs)])
    return finish(x, gain)


def hurt():
    dur = 0.2
    return finish(mix((low(noise(dur), 400) * env(dur, 0.001, 0.05), 1), (sweep(160, 70, dur, 0.05), 0.8)), 0.6)


def write(name, x):
    os.makedirs(OUT, exist_ok=True)
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        path = tmp.name
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    out = os.path.join(OUT, f'{name}.mp3')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', path, '-codec:a', 'libmp3lame', '-b:a', '96k', out], check=True)
    os.unlink(path)


SOUNDS = {
    # ---- Guns ----
    'shot_rifle': lambda: gunshot(),
    'shot_smg': lambda: gunshot(body=(500, 3200), body_decay=0.03, thump=(170, 70), thump_decay=0.04, thump_gain=0.6, tail=0.35, wet=0.22, dur=0.4),
    'shot_mg': lambda: gunshot(body=(250, 2000), body_decay=0.055, thump=(120, 45), thump_decay=0.07, thump_gain=1.1, tail=0.5),
    'shot_sniper': lambda: gunshot(body=(150, 1800), body_decay=0.12, thump=(95, 32), thump_decay=0.16, thump_gain=1.3, crack_gain=1.4, mech=(2200, 3300), mech_gain=0.2, tail=0.9, wet=0.38, dur=1.2),
    'shot_speedy': lambda: gunshot(body=(220, 2400), body_decay=0.08, thump=(120, 45), thump_decay=0.1, thump_gain=1.0, crack_gain=1.3, tail=0.7, wet=0.33, dur=0.9),
    'shot_revolver': lambda: gunshot(body=(200, 2200), body_decay=0.08, thump=(115, 40), thump_decay=0.1, thump_gain=1.2, mech=(1800, 2600), mech_gain=0.18, tail=0.7, wet=0.33, dur=0.9),
    'shot_pistol': lambda: gunshot(body=(450, 3000), body_decay=0.035, thump=(160, 60), thump_decay=0.045, thump_gain=0.7, tail=0.4, wet=0.25, dur=0.5),
    'shot_handcannon': lambda: gunshot(body=(160, 1900), body_decay=0.1, thump=(90, 30), thump_decay=0.13, thump_gain=1.4, crack_gain=1.3, tail=0.9, wet=0.36, dur=1.1),
    'shot_shotgun': lambda: gunshot(body=(150, 2600), body_decay=0.12, thump=(85, 30), thump_decay=0.13, thump_gain=1.4, mech=(1500, 2400), mech_gain=0.25, tail=0.8, wet=0.35, dur=1.0),
    'shot_heavy': lambda: gunshot(body=(200, 1700), body_decay=0.06, thump=(100, 38), thump_decay=0.08, thump_gain=1.3, tail=0.45, dur=0.5),
    'shot_launcher': lambda: launcher(False),
    'shot_k2': lambda: launcher(True),
    'shot_energy': zap,
    'shot_firecracker': firecracker,
    'shot_flare': lambda: finish(mix((launcher(False), 0.6), (whoosh(0.6, 800, 4000, 0.01), 0.6))),
    # ---- Explosions / impacts ----
    'explosion': lambda: explosion(False),
    'explosion_big': lambda: explosion(True),
    'impact': lambda: finish(mix((high(noise(0.05), 2000) * env(0.05, 0.0005, 0.008), 1), (ring(1900, 0.05, 0.01), 0.3)), 0.4),
    # ---- Movement ----
    'step1': lambda: footstep(0), 'step2': lambda: footstep(1), 'step3': lambda: footstep(2), 'step4': lambda: footstep(3),
    'jump': lambda: whoosh(0.22, 300, 1600, 0.02, 0.7),
    'land': land,
    'slide': slide,
    'slidehop': lambda: whoosh(0.35, 500, 3000, 0.01, 0.9),
    'walljump': lambda: finish(mix((land(), 0.8), (whoosh(0.25, 600, 2500, 0.01), 0.6)), 0.7),
    'climb': lambda: finish(mix((low(noise(0.2), 700) * env(0.2, 0.01, 0.05), 1), (whoosh(0.2, 400, 1500, 0.02), 0.5)), 0.5),
    # ---- Weapon handling ----
    'reload': reload_sound,
    'empty': lambda: click((3800,), 0.04, 0.4),
    'swap': lambda: click((2400, 1600), 0.06, 0.4),
    'swing': lambda: whoosh(0.25, 900, 5000, 0.02, 0.9),
    'stab': lambda: finish(mix((low(noise(0.15), 600) * env(0.15, 0.001, 0.03), 1), (sweep(180, 70, 0.15, 0.04), 0.8)), 0.7),
    # ---- Feedback ----
    'hitmarker': lambda: finish(mix((high(noise(0.03), 4000) * env(0.03, 0.0003, 0.004), 1), (ring(3100, 0.05, 0.01), 0.6)), 0.5),
    'headshot': lambda: bell((2350, 3540, 4720), 0.45, 0.14, 0.5),
    'kill': lambda: bell((880, 1320), 0.4, 0.12, 0.5, 0.07),
    'hurt': hurt,
    'death': lambda: finish(mix((explosion(False), 0.3), (sweep(260, 60, 0.7, 0.3), 0.6)), 0.6),
    # ---- Interface ----
    'ui_click': lambda: click((1900,), 0.05, 0.35),
    'checkpoint': lambda: bell((1320, 1980), 0.5, 0.15, 0.45, 0.09),
    'finish': lambda: bell((1047, 1319, 1568, 2093), 0.9, 0.25, 0.5, 0.09),
    'respawn': lambda: finish(mix((whoosh(0.5, 300, 3000, 0.2), 0.8), (bell((660, 990), 0.5, 0.2, 1, 0.1), 0.4)), 0.5),
}


if __name__ == '__main__':
    for name, make in SOUNDS.items():
        write(name, make())
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print(f'wrote {len(SOUNDS)} sounds, {total / 1024:.0f} KB')
