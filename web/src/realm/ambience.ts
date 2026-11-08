// The sound of the place you are standing in, made in WebAudio with no files: wind that swells with the realm's
// gusts (wind.ts), birdsong in the open country, the murmur of a town and a smith's hammer inside one, running
// water by the river, and the rumble of wheels under the chariot. Each bed crossfades over about two seconds as
// you move between zones; one-shots come at random gaps with their pitch varied, so nothing loops audibly.
import * as THREE from 'three';
import { CAPITAL, HOUSES } from './layout.ts';
import { riverDist } from './heights.ts';
import { liveAudio, noise, type Surface } from './sound.ts';
import { ground } from './heights.ts';
import { walkY } from './bridges.ts';
import { roadDist } from './layout.ts';
import { groundAt } from './Terrain.tsx';
import { gustAt } from './wind.ts';

interface Beds { master: GainNode; wind: GainNode; windF: BiquadFilterNode; whistle: GainNode; town: GainNode; water: GainNode; rumble: GainNode; rumbleF: BiquadFilterNode }
let beds: Beds | undefined;
let nextBird = 0, nextHammer = 0, nextVoice = 0;

function loop(a: AudioContext, out: AudioNode, rate = 1) {
  const s = a.createBufferSource();
  s.buffer = noise(a); s.loop = true; s.playbackRate.value = rate;
  s.connect(out); s.start(0, Math.random());
  return s;
}
function filt(a: AudioContext, type: BiquadFilterType, f: number, q = 0.7) {
  const n = a.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n;
}
function gain(a: AudioContext, v: number) { const g = a.createGain(); g.gain.value = v; return g; }

function build(a: AudioContext): Beds {
  const master = gain(a, 0);
  master.connect(a.destination);
  // Wind: low rushing noise whose brightness and level follow the gust; a thin whistle rides the strong gusts.
  const wind = gain(a, 0), windF = filt(a, 'lowpass', 400);
  loop(a, windF, 0.5); windF.connect(wind).connect(master);
  const whistle = gain(a, 0), wf = filt(a, 'bandpass', 1500, 9);
  loop(a, wf, 0.8); wf.connect(whistle).connect(master);
  // Town: crowd murmur as three voice-band layers, each swelling on its own slow clock.
  const town = gain(a, 0);
  town.connect(master);
  [[320, 1.4, 0.13], [650, 1.8, 0.21], [1150, 2.2, 0.37]].forEach(([f, q, lfo]) => {
    const band = filt(a, 'bandpass', f, q), g = gain(a, 0.5), mod = a.createOscillator(), depth = gain(a, 0.35);
    mod.frequency.value = lfo; mod.connect(depth).connect(g.gain); mod.start();
    loop(a, band, 0.9); band.connect(g).connect(town);
  });
  // Water: a babbling band of noise, wobbled fast.
  const water = gain(a, 0), wb = filt(a, 'bandpass', 900, 0.9), wg = gain(a, 0.6), wl = a.createOscillator(), wd = gain(a, 0.4);
  wl.frequency.value = 3.1; wl.connect(wd).connect(wg.gain); wl.start();
  loop(a, wb, 1.2); wb.connect(wg).connect(water).connect(master);
  // Wheels: a deep rumble under the chariot.
  const rumble = gain(a, 0), rumbleF = filt(a, 'lowpass', 120, 1.2);
  loop(a, rumbleF, 0.35); rumbleF.connect(rumble).connect(master);
  return { master, wind, windF, whistle, town, water, rumble, rumbleF };
}

const ease = (p: AudioParam, v: number, a: AudioContext, tc = 0.7) => p.setTargetAtTime(v, a.currentTime, tc);

/** A bird's phrase: a few quick notes swooping between pitches, panned somewhere around you. */
function birdsong(a: AudioContext, out: AudioNode, loud: number) {
  const pan = a.createStereoPanner(); pan.pan.value = Math.random() * 1.6 - 0.8; pan.connect(out);
  const base = 2400 + Math.random() * 2200, notes = 3 + Math.floor(Math.random() * 6), kind = Math.random();
  let t = a.currentTime + 0.05;
  for (let i = 0; i < notes; i++) {
    const o = a.createOscillator(), g = a.createGain(), len = 0.05 + Math.random() * 0.09;
    o.type = 'sine';
    const f0 = base * (0.85 + Math.random() * 0.3), f1 = kind < 0.5 ? f0 * (1.25 + Math.random() * 0.3) : f0 * 0.7;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + len);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03 * loud, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(pan); o.start(t); o.stop(t + len + 0.02);
    t += len + 0.02 + Math.random() * 0.07;
  }
}

/** A smith's hammer on the anvil: a bright ring over a dull knock. */
function hammer(a: AudioContext, out: AudioNode, loud: number) {
  const pan = a.createStereoPanner(); pan.pan.value = Math.random() * 1.2 - 0.6; pan.connect(out);
  const blows = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < blows; i++) {
    const t = a.currentTime + i * (0.38 + Math.random() * 0.06);
    for (const [f, d, v] of [[1870, 0.5, 0.035], [2930, 0.3, 0.02], [4470, 0.18, 0.012]]) {
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'triangle'; o.frequency.value = f * (0.98 + Math.random() * 0.04);
      g.gain.setValueAtTime(v * loud, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(pan); o.start(t); o.stop(t + d + 0.02);
    }
  }
}

/** A voice rising out of the crowd: a short formant-filtered call, like a trader crying wares two streets off. */
function call(a: AudioContext, out: AudioNode, loud: number) {
  const pan = a.createStereoPanner(); pan.pan.value = Math.random() * 1.4 - 0.7; pan.connect(out);
  const o = a.createOscillator(), f1 = filt(a, 'bandpass', 700, 5), f2 = filt(a, 'bandpass', 1200, 6), g = a.createGain();
  const t = a.currentTime + 0.05, len = 0.5 + Math.random() * 0.5, p = 140 + Math.random() * 90;
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(p, t); o.frequency.linearRampToValueAtTime(p * 1.25, t + len * 0.4); o.frequency.linearRampToValueAtTime(p * 0.9, t + len);
  f1.frequency.setValueAtTime(600, t); f1.frequency.linearRampToValueAtTime(900, t + len);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.012 * loud, t + 0.06); g.gain.setValueAtTime(0.012 * loud, t + len - 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g); g.connect(pan);
  o.start(t); o.stop(t + len + 0.05);
}

const TOWNS = [{ x: CAPITAL.pos[0] + 20, z: CAPITAL.pos[1] + 10, r: 105 }, ...HOUSES.map((h) => ({ x: h.pos[0], z: h.pos[1] + 8, r: 80 }))];

/** Call every frame: where you are, how fast the chariot is going (0 on foot), and whether the game is on. */
export function tickAmbience(t: number, x: number, z: number, carSpeed: number, playing: boolean) {
  const a = liveAudio();
  if (!a) return;
  beds ??= build(a);
  const b = beds, g = gustAt(t);
  ease(b.master.gain, playing ? 1 : 0.35, a, 1.2);
  ease(b.wind.gain, 0.05 + g * 0.11, a, 0.4);
  ease(b.windF.frequency, 260 + g * 700, a, 0.4);
  ease(b.whistle.gain, Math.max(0, g - 0.6) * 0.05, a, 0.6);
  // Zones: how deep into a town you are, how near the water.
  let inTown = 0;
  for (const tw of TOWNS) inTown = Math.max(inTown, Math.min(1, Math.max(0, (tw.r - Math.hypot(x - tw.x, z - tw.z)) / 35)));
  const nearWater = Math.min(1, Math.max(0, (45 - riverDist(x, z)) / 30));
  ease(b.town.gain, playing ? inTown * 0.09 : 0, a, 0.9);
  ease(b.water.gain, playing ? nearWater * 0.06 : 0, a, 0.9);
  ease(b.rumble.gain, Math.min(1, carSpeed / 25) * 0.28, a, 0.15);
  ease(b.rumbleF.frequency, 90 + carSpeed * 6, a, 0.15);
  if (!playing) return;
  // One-shots, each on its own random clock.
  const now = a.currentTime;
  if (now > nextBird) { nextBird = now + 3 + Math.random() * 9; if (inTown < 0.6) birdsong(a, b.master, 1 - inTown); }
  if (now > nextHammer) { nextHammer = now + 4 + Math.random() * 8; if (inTown > 0.4) hammer(a, b.master, inTown * 0.8); }
  if (now > nextVoice) { nextVoice = now + 2.5 + Math.random() * 6; if (inTown > 0.5) call(a, b.master, inTown); }
}

const gAt = { grass: 0, dirt: 0, col: new THREE.Color() };
/** What your feet land on here: bridge stone, road grit, or the grass and earth of the ground's own paint. */
export function surfaceAt(x: number, z: number): Surface {
  if (walkY(x, z) > ground(x, z) + 0.3) return 'stone';
  if (roadDist(x, z) < 3.8) return 'dirt';
  const g = groundAt(x, z, gAt);
  return g.grass >= g.dirt ? 'grass' : 'dirt';
}
