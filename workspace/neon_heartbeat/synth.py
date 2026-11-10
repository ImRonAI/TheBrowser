#!/usr/bin/env python3
"""
NEON HEARTBEAT - a Zedd-inspired trancey anthem, synthesized from scratch.
128 BPM, F major. Structure: intro -> verse -> build -> DROP -> bridge -> DROP -> outro.
Pure numpy synthesis + ffmpeg for WAV/MP3 encoding. No external audio needed.
"""
import numpy as np, subprocess, os, math

SR = 44100
BPM = 128
BEAT = 60.0 / BPM          # 0.46875 s
BAR = 4 * BEAT             # 1.875 s
OUT = os.path.dirname(os.path.abspath(__file__))

rng = np.random.default_rng(7)

def t(n): return np.arange(int(n)) / SR

def adsr(n, a, d, s_level, r, sustain_len=None):
    """simple ADSR envelope over n samples"""
    a_n, d_n, r_n = int(a*SR), int(d*SR), int(r*SR)
    s_n = max(0, n - a_n - d_n - r_n)
    env = np.concatenate([
        np.linspace(0, 1, a_n, endpoint=False) if a_n else np.zeros(0),
        np.linspace(1, s_level, d_n, endpoint=False) if d_n else np.zeros(0),
        np.full(s_n, s_level),
        np.linspace(s_level, 0, r_n) if r_n else np.zeros(0),
    ])
    return env[:n] if len(env) >= n else np.pad(env, (0, n-len(env)))

def midi(m): return 440.0 * 2 ** ((m - 69) / 12)

# F major scale degrees -> midi notes (F4=65)
Fmaj = [65, 67, 69, 70, 72, 74, 76]  # F G A Bb C D E

def supersaw(freq, dur, detune_cents=(8, -8, 15, -15, 4, -4, 0), bright=0.5, pw=0.0):
    """detuned saw stack"""
    tt = t(dur)
    sig = np.zeros_like(tt)
    for i, c in enumerate(detune_cents):
        f = freq * 2 ** (c/1200)
        ph = (tt * f) % 1.0
        saw = 2*ph - 1
        if pw > 0:  # pulse-ish width via adding odd harmonics blend
            saw = saw - pw*np.sign(saw)*np.abs(saw)**0.5
        sig += saw / len(detune_cents)
    # simple lowpass-ish: mix with fundamental-heavy version
    return sig * (1-bright) + np.sin(2*np.pi*freq*tt) * bright * 0.6

def pluck(freq, dur, decay=0.35):
    tt = t(dur)
    env = np.exp(-tt/decay)
    sig = np.zeros_like(tt)
    for h in range(1, 9):
        sig += (1.0/h**1.5) * np.sin(2*np.pi*freq*h*tt)
    return sig * env / 3.0

def pad(freqs, dur, attack=1.2, release=1.5):
    tt = t(dur)
    env = adsr(len(tt), attack, 0.5, 0.8, release)
    sig = np.zeros_like(tt)
    for f in freqs:
        vib = 1 + 0.003*np.sin(2*np.pi*5*tt + f)
        sig += (np.sin(2*np.pi*f*vib*tt) + 0.5*np.sin(2*np.pi*f*2.003*vib*tt)) / (len(freqs)*1.5)
    return sig * env

def kick(dur=0.5):
    tt = t(dur)
    f0, f1 = 150, 45
    f = f1 + (f0-f1)*np.exp(-tt*30)
    ph = np.cumsum(f)/SR
    env = np.exp(-tt*9)
    click = np.exp(-tt*300)*0.6*np.sin(2*np.pi*1000*tt)
    return (np.sin(2*np.pi*ph)*env + click)*1.2

def snare(dur=0.3, snap=0.5):
    tt = t(dur)
    noise = rng.standard_normal(len(tt))
    tone = np.sin(2*np.pi*190*tt)*np.exp(-tt*25)
    env = np.exp(-tt*14)
    return (noise*env*0.5 + tone*0.7)*snap

def hat(dur=0.08, open_=False):
    tt = t(dur)
    noise = rng.standard_normal(len(tt))
    # crude highpass: diff
    hp = np.diff(noise, prepend=0)
    env = np.exp(-tt*(60 if open_ else 220))
    return hp*env*0.35

def bass_note(freq, dur, decay=0.3):
    tt = t(dur)
    env = np.exp(-tt/decay)*0.9 + 0.1
    sub = np.sin(2*np.pi*freq*tt)
    sq = np.sign(np.sin(2*np.pi*freq*tt))*0.25
    return (sub + sq)*env*0.8

def vocal_formant(freq, dur, vowel=0, glide_to=None):
    """Stylized 'vocal chop' — formant-filtered saw stack gliding. Not real singing,
    but an anthemic vocal-like lead in the Zedd vocal-chop tradition."""
    tt = t(dur)
    f = freq * (2 ** (glide_to * tt / dur)) if glide_to else np.full_like(tt, freq)
    ph = np.cumsum(f)/SR
    sig = np.zeros_like(tt)
    # formant-ish: emphasize 700Hz and 1200Hz bands via resonant filters (biquad-ish via IIR)
    def resonate(x, fc, q=6):
        w = 2*np.pi*fc/SR
        r = np.exp(-w/q)
        a = [1, -2*r*np.cos(w), r*r]
        # simple 2-pole resonator (direct form II transposed)
        b0 = (1-r)*np.sin(w)
        y = np.zeros_like(x); s1=s2=0.0
        for i, xn in enumerate(x):
            yn = b0*xn + 2*r*np.cos(w)*s1 - r*r*s2
            s2 = s1; s1 = yn
            y[i] = yn
        return y
    saw = 2*((ph)%1.0)-1
    v = resonate(saw, 800, 8) + 0.6*resonate(saw, 1150, 8) + 0.3*resonate(saw, 2900, 10)
    env = adsr(len(tt), 0.05, 0.1, 0.85, 0.15)
    return np.tanh(v*1.4)*env*0.5

# ---------- song arrangement (in bars) ----------
# F major progression: F - C - Dm - Bb  (I - V - vi - IV) — classic anthem
CHORDS = {
    'F':  [65, 69, 72, 76],
    'C':  [60, 64, 67, 72],
    'Dm': [62, 65, 69, 74],
    'Bb': [58, 62, 65, 70],
}
PROG = ['F', 'C', 'Dm', 'Bb']

def chord_midis(name, root_oct=4):
    base = CHORDS[name]
    return [m for m in base]

# sections: (name, bars)
SECTIONS = [
    ('intro',  8),
    ('verse',  8),
    ('build',  4),
    ('drop1',  8),
    ('bridge', 8),
    ('drop2',  8),
    ('outro',  4),
]

total_bars = sum(b for _, b in SECTIONS)
DUR = total_bars * BAR
mix = np.zeros(int(DUR*SR) + SR*2)

def place(sig, at):
    i = int(at*SR)
    j = min(len(mix), i+len(sig))
    mix[i:j] += sig[:j-i]

def section_range(name):
    start = 0
    for n, b in SECTIONS:
        if n == name: return start*BAR, (start+b)*BAR, b
        start += b
    raise KeyError(name)

# ---------- drums ----------
def four_floor(t0, bars, kick_every=1):
    for b in range(bars):
        for beat in range(4):
            place(kick(), t0 + b*BAR + beat*BEAT)

def hats(t0, bars, offbeat=True):
    for b in range(bars):
        for beat in range(4):
            place(hat(0.06), t0 + b*BAR + beat*BEAT)
            if offbeat:
                place(hat(0.09, open_=True), t0 + b*BAR + beat*BEAT + BEAT/2)

def snare_clap(t0, bars):
    for b in range(bars):
        for beat in [1, 3]:
            place(snare(0.28, 0.9), t0 + b*BAR + beat*BEAT)

def build_riser(t0, bars):
    n = int(bars*BAR*SR)
    tt = t(n)
    noise = rng.standard_normal(n)
    hp = np.diff(noise, prepend=0)
    env = (tt/(bars*BAR))**2.2
    place(hp*env*0.5, t0)
    # riser synth
    f = np.linspace(200, 3200, n)
    ph = np.cumsum(f)/SR
    place(np.sin(2*np.pi*ph)*env*0.25, t0)

# ---------- compose each section ----------
bar_idx = 0
for name, bars in SECTIONS:
    t0 = bar_idx*BAR
    prog = [PROG[i % 4] for i in range(bars)]
    for b in range(bars):
        bt = t0 + b*BAR
        ch = prog[b]
        if name == 'intro':
            place(pad([midi(m-12) for m in chord_midis(ch)], BAR, attack=0.8, release=0.9), bt)
            # sparse piano-ish plucks, motif F-A-C
            if b % 2 == 0:
                for k, m in enumerate([77, 81, 84]):
                    place(pluck(midi(m), 0.5, 0.12), bt + k*BEAT/2)
        elif name == 'verse':
            place(pad([midi(m-12) for m in chord_midis(ch)], BAR, attack=0.4, release=0.5), bt)
            four_floor(bt, 1)
            hats(bt, 1)
            # arpeggio
            arp = chord_midis(ch) + [chord_midis(ch)[-1]+12]
            for k in range(8):
                place(pluck(midi(arp[k % len(arp)]+12), 0.22, 0.08), bt + k*BEAT/2)
            # bass on root
            root = chord_midis(ch)[0]-24
            for beat in range(4):
                place(bass_note(midi(root), BEAT*0.9, 0.18), bt + beat*BEAT)
        elif name == 'build':
            place(pad([midi(m-12) for m in chord_midis(ch)], BAR, attack=0.3, release=0.3), bt)
            four_floor(bt, 1)
            hats(bt, 1)
            snare_clap(bt, 1)
            arp = chord_midis(ch) + [chord_midis(ch)[-1]+12]
            for k in range(16):
                place(pluck(midi(arp[k % len(arp)]+12), 0.15, 0.05), bt + k*BEAT/4)
            root = chord_midis(ch)[0]-24
            for beat in range(4):
                place(bass_note(midi(root), BEAT*0.9, 0.12), bt + beat*BEAT)
            if b == bars-1:
                build_riser(bt, 1)
                place(snare(0.4, 1.2), bt + 3*BEAT)  # impact-ish
        elif name in ('drop1', 'drop2'):
            big = name == 'drop2'
            place(pad([midi(m-12) for m in chord_midis(ch)], BAR, attack=0.05, release=0.2), bt)
            four_floor(bt, 1)
            hats(bt, 1)
            snare_clap(bt, 1)
            # supersaw lead: anthemic melody over the chord (8th-note pattern)
            melody_deg = [0, 2, 4, 2, 5, 4, 2, 1]  # scale degrees on top of chord root
            chm = chord_midis(ch)
            root_top = chm[2] + 12
            for k in range(8):
                m = root_top + (Fmaj.index((chm[0] % 12) - 5 + 12) if False else 0)
                deg = melody_deg[k]
                note = chm[0] + 24 + [0, 3, 5, 7, 10, 12, 10, 7][k]
                place(supersaw(midi(note), BEAT/2*0.95, bright=0.35), bt + k*BEAT/2)
            # bass driving 8ths
            root = chord_midis(ch)[0]-24
            for k in range(8):
                place(bass_note(midi(root), BEAT/2*0.9, 0.1), bt + k*BEAT/2)
            # vocal chop hook on bar 3-4 of each 4-bar phrase
            if b % 4 in (2, 3) or big:
                hook = [0, 4, 7, 12, 7, 4, 2, 0]
                for k in range(8):
                    note = chord_midis(ch)[0] + 24 + hook[k]
                    place(vocal_formant(midi(note), BEAT/2*0.9, glide_to=None), bt + k*BEAT/2)
        elif name == 'bridge':
            place(pad([midi(m-12) for m in chord_midis(ch)], BAR, attack=1.0, release=1.0), bt)
            # half-time feel: kick on 1, snare on 3
            place(kick(), bt)
            place(snare(0.3, 0.8), bt + 2*BEAT)
            # soaring lead, long notes
            chm = chord_midis(ch)
            lead = [chm[2]+12, chm[3]+12, chm[2]+12, chm[1]+12]
            place(supersaw(midi(lead[b % 4]), BAR*0.95, bright=0.55), bt)
            root = chord_midis(ch)[0]-24
            place(bass_note(midi(root), BAR*0.9, 0.5), bt)
        elif name == 'outro':
            place(pad([midi(m-12) for m in chord_midis(ch)], BAR, attack=0.8, release=1.2), bt)
            if b == 0:
                for k, m in enumerate([77, 81, 84, 89]):
                    place(pluck(midi(m), 0.8, 0.25), bt + k*BEAT)
    bar_idx += bars

# ---------- sidechain feel on drops: duck everything slightly on each kick ----------
# (approximate: apply gain envelope synced to kicks in drop sections)
for name in ('drop1', 'drop2'):
    s, e, bars = section_range(name)
    n0, n1 = int(s*SR), int(e*SR)
    tt = np.arange(n1-n0)/SR
    duck = np.ones(n1-n0)
    for i in range(int(bars*4)):
        bt = i*BEAT
        idx = int(bt*SR)
        ln = int(0.25*SR)
        if idx+ln < len(duck):
            duck[idx:idx+ln] *= 0.45 + 0.55*np.exp(-np.arange(ln)/SR*22)
    mix[n0:n1] *= duck

# ---------- master: soft clip + fade ----------
mix = np.tanh(mix*1.1)
fade = int(1.5*SR)
mix[-fade:] *= np.linspace(1, 0, fade)
peak = np.max(np.abs(mix))
mix = mix/peak*0.89

# normalize stereo (duplicate with tiny haas for width)
right = np.roll(mix, 12)
st = np.stack([mix, right], axis=1)

# write wav via ffmpeg pipe
import wave
wav_path = os.path.join(OUT, 'neon_heartbeat.wav')
w = wave.open(wav_path, 'wb')
w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
w.writeframes((st*32767).astype(np.int16).tobytes())
w.close()

mp3_path = os.path.join(OUT, 'neon_heartbeat.mp3')
subprocess.run(['ffmpeg','-y','-i',wav_path,'-codec:a','libmp3lame','-q:a','2',mp3_path],
               check=True, capture_output=True)
print('DONE', mp3_path, f'{DUR:.1f}s', f'{total_bars} bars @ {BPM} BPM')
