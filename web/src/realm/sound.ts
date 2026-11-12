// Small sounds made in WebAudio (no files): the whip, hooves on the road, the crowd at the Hippodrome.
let ctx: AudioContext | undefined;
export function audio() {
  if (!ctx) { try { ctx = new AudioContext(); } catch { return undefined; } }
  if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
  return ctx;
}
/** The context only if it is already running (never creates or nags one): for the ambience, every frame. */
export const liveAudio = () => (ctx?.state === 'running' ? ctx : undefined);
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__audio = () => ctx?.state;
// Browsers start audio suspended until the player touches something: wake it on the first key or click.
if (typeof window !== 'undefined') {
  const wake = () => { if (audio()?.state === 'running') { window.removeEventListener('pointerdown', wake); window.removeEventListener('keydown', wake); } };
  window.addEventListener('pointerdown', wake); window.addEventListener('keydown', wake);
}
let noiseBuf: AudioBuffer | undefined;
export function noise(a: AudioContext) {
  if (noiseBuf) return noiseBuf;
  noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}
export function burst(freq: number, q: number, gain: number, dur: number, when = 0, type: BiquadFilterType = 'bandpass') {
  const a = audio(); if (!a) return;
  const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  s.buffer = noise(a); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const t = a.currentTime + when;
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(a.destination);
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}
/** A sharp crack. */
export function crackWhip() { burst(3200, 0.8, 0.5, 0.09); burst(1400, 1.5, 0.25, 0.16, 0.012); }
/** One hoof on packed earth (a dull thud with a little grit). */
export function hoof(loud = 1) { burst(180 + Math.random() * 60, 2.5, 0.22 * loud, 0.08); burst(900, 1, 0.04 * loud, 0.04); }
/** A step. */
export type Surface = 'grass' | 'dirt' | 'stone';
/** A footfall that sounds like what it lands on, never twice the same: a soft swish on grass, a gritty crunch on
 * the roads, a hard click on stone. `loud` rises when running. */
export function step(surface: Surface = 'dirt', loud = 1) {
  const r = () => Math.random();
  if (surface === 'grass') {
    burst(2600 + r() * 1400, 0.7, 0.03 * loud, 0.1, 0, 'bandpass');
    burst(140 + r() * 40, 1.5, 0.035 * loud, 0.06);
  } else if (surface === 'stone') {
    burst(2300 + r() * 900, 4, 0.05 * loud, 0.03);
    burst(210 + r() * 60, 2, 0.06 * loud, 0.05);
  } else {
    for (let i = 0; i < 3; i++) burst(1700 + r() * 1500, 2, 0.026 * loud, 0.03, i * (0.008 + r() * 0.01));
    burst(150 + r() * 50, 1.6, 0.05 * loud, 0.06);
  }
}

/** Something wooden hitting the ground or being knocked. */
export function thud(loud = 1) { burst(110 + Math.random() * 40, 1.4, 0.35 * loud, 0.12); burst(520, 1, 0.08 * loud, 0.05); }

/** A flock bursting up: a ragged run of wing claps, fast then thinning out. */
export function flutter(n = 12, loud = 1) {
  for (let i = 0; i < n; i++) { const t = i * 0.035 + Math.random() * 0.05 + (i / n) ** 2 * 0.4; burst(700 + Math.random() * 900, 1.1, 0.07 * loud * (1 - (i / n) * 0.6), 0.05, t); }
}

const VOWELS = [[730, 1090], [270, 2290], [530, 1840], [570, 840], [300, 870], [660, 1700]];
const PITCH = { man: 112, woman: 205, soldier: 98, lord: 124 } as const;
/** Speech without words: a run of syllables through two vowel formants, pitched for who is talking, so a line
 * of dialogue arrives with a voice under it. `len` is the line's length in characters. */
export function voice(who: keyof typeof PITCH, len: number, pan = 0, urgent = false) {
  const a = audio(); if (!a) return;
  const out = a.createStereoPanner(); out.pan.value = Math.max(-0.9, Math.min(0.9, pan)); out.connect(a.destination);
  const n = Math.max(3, Math.min(11, Math.round(len / 6))), p0 = PITCH[who] * (urgent ? 1.3 : 1) * (0.94 + Math.random() * 0.12);
  let t = a.currentTime + 0.03;
  for (let i = 0; i < n; i++) {
    const d = 0.07 + Math.random() * 0.07, [f1, f2] = VOWELS[Math.floor(Math.random() * VOWELS.length)];
    const o = a.createOscillator(), b1 = a.createBiquadFilter(), b2 = a.createBiquadFilter(), g = a.createGain();
    o.type = 'sawtooth';
    // Phrases fall in pitch toward the end; a shout rises.
    const pf = p0 * (urgent ? 1 + 0.15 * Math.sin((i / n) * Math.PI) : 1.08 - 0.18 * (i / n)) * (0.95 + Math.random() * 0.1);
    o.frequency.setValueAtTime(pf, t); o.frequency.linearRampToValueAtTime(pf * (0.92 + Math.random() * 0.12), t + d);
    b1.type = b2.type = 'bandpass'; b1.frequency.value = f1; b2.frequency.value = f2; b1.Q.value = 6; b2.Q.value = 8;
    const v = (urgent ? 0.05 : 0.03);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(b1); o.connect(b2); b1.connect(g); b2.connect(g); g.connect(out);
    o.start(t); o.stop(t + d + 0.02);
    t += d + (Math.random() < 0.18 ? 0.09 : 0.012);
  }
}

// ---------- One-shots for moments: the Mint, the seals, the Hippodrome, the halls ----------

/** A short tone with an attack and a tail. */
function tone(freq: number, gain: number, dur: number, when = 0, type: OscillatorType = 'sine', glide = 1) {
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + when;
  o.type = type; o.frequency.setValueAtTime(freq, t); if (glide !== 1) o.frequency.exponentialRampToValueAtTime(freq * glide, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.05);
}
/** Coins: a few bright clinks, a little apart, landing on each other. `n` rises with the size of the trade. */
export function coins(n = 4) {
  for (let i = 0; i < n; i++) {
    const t = i * (0.045 + Math.random() * 0.05), f = 2600 + Math.random() * 1800;
    tone(f, 0.05, 0.22, t, 'triangle'); tone(f * 2.71, 0.018, 0.12, t, 'sine');
    burst(5200, 6, 0.03, 0.03, t);
  }
}
/** A wax seal pressed: a dull knock, then the soft lift. */
export function stamp() { burst(160, 1.2, 0.45, 0.16); burst(900, 2, 0.08, 0.05); burst(2400, 3, 0.02, 0.08, 0.18); }
/** Three brass notes rising to a held chord: a seal earned, a crown claimed. */
export function fanfare(big = false) {
  const notes = big ? [392, 523.3, 659.3, 784] : [392, 523.3, 659.3];
  notes.forEach((f, i) => {
    const last = i === notes.length - 1, d = last ? (big ? 1.6 : 1.1) : 0.2;
    for (const det of [1, 1.004]) tone(f * det, 0.035, d, i * 0.16, 'sawtooth');
    tone(f / 2, 0.02, d, i * 0.16, 'square');
  });
}
/** The crowd: a swell of voices (noise through a vowel-ish band) that rises and falls over `dur` seconds. */
export function crowd(dur = 2.5, loud = 1) {
  const a = audio(); if (!a) return;
  const t = a.currentTime;
  for (const [f, q, v] of [[520, 0.8, 0.16], [1250, 1.1, 0.08], [2600, 1.5, 0.03]] as const) {
    const s = a.createBufferSource(), fl = a.createBiquadFilter(), g = a.createGain(), lfo = a.createOscillator(), lg = a.createGain();
    s.buffer = noise(a); s.loop = true; fl.type = 'bandpass'; fl.frequency.value = f; fl.Q.value = q;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v * loud, t + dur * 0.25); g.gain.setValueAtTime(v * loud, t + dur * 0.55); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    lfo.frequency.value = 3 + Math.random() * 3; lg.gain.value = v * loud * 0.3; lfo.connect(lg).connect(g.gain);
    s.connect(fl).connect(g).connect(a.destination); s.start(t, Math.random()); s.stop(t + dur + 0.1); lfo.start(t); lfo.stop(t + dur + 0.1);
  }
}
/** A heavy door on old hinges. */
export function door() {
  const a = audio(); if (!a) return;
  const t = a.currentTime, o = a.createOscillator(), f = a.createBiquadFilter(), g = a.createGain();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(115, t + 0.5); o.frequency.linearRampToValueAtTime(85, t + 0.75);
  f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 9;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
  o.connect(f).connect(g).connect(a.destination); o.start(t); o.stop(t + 0.85);
  thud(0.6);
}
/** A page turned. */
export function page() { burst(3800, 0.6, 0.05, 0.18, 0, 'highpass'); burst(1800, 1, 0.025, 0.12, 0.05); }
/** A horse answering a whistle. */
export function whinny() {
  const a = audio(); if (!a) return;
  const t = a.currentTime, o = a.createOscillator(), f = a.createBiquadFilter(), g = a.createGain(), vib = a.createOscillator(), vg = a.createGain();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(620, t); o.frequency.exponentialRampToValueAtTime(980, t + 0.25); o.frequency.exponentialRampToValueAtTime(380, t + 1.1);
  vib.frequency.value = 22; vg.gain.value = 60; vib.connect(vg).connect(o.frequency);
  f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 2.5;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.035, t + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
  o.connect(f).connect(g).connect(a.destination); o.start(t); o.stop(t + 1.2); vib.start(t); vib.stop(t + 1.2);
}
/** A soft click for buttons and panels. */
export function click() { tone(1800, 0.025, 0.05, 0, 'triangle'); }
/** The end of a hall game: up for a win, down for a loss. */
export function sting(won: boolean) {
  const n = won ? [523.3, 659.3, 784, 1046.5] : [392, 349.2, 293.7];
  n.forEach((f, i) => tone(f, won ? 0.06 : 0.045, won && i === n.length - 1 ? 0.9 : 0.28, i * 0.11, 'triangle'));
}
