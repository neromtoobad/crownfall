// The Crownfall theme (an original track, design/audio/theme-take1.mp3), played the way open-world games play music:
// in sets, with rests of wind and town between them, so it lifts the realm instead of wallpapering it. It plays
// louder at the Hippodrome, low under a hall game, and dips whenever someone speaks. N turns it off and on.
import { liveAudio } from './sound.ts';
import { play, me } from './play.ts';
import { HIPPODROME } from './layout.ts';

const SRC = '/audio/theme.mp3';
/** Where a later set starts: past the quiet harp opening, on a bar line (105 bpm: a bar is 2.2857 s). */
const LOOP_FROM = 9 * (60 / 105) * 4;
const FADE = 2.5;
const KEY = 'crownfall.music';

let on = (() => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } })();
let buf: AudioBuffer | undefined, loading = false;
let bus: GainNode | undefined, duck: GainNode | undefined;
let src: AudioBufferSourceNode | undefined, seg: GainNode | undefined;
let segEnd = 0, restUntil = 0, sets = 0;
/** How much the music gives way to a voice right now (vo.ts sets it). */
export const musicDuck = { amount: 0 };

export const musicOn = () => on;
export function setMusic(v: boolean) {
  on = v;
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* private window */ }
  if (!v) stopSet(0.8);
}

function stopSet(fade: number) {
  const a = liveAudio();
  if (!a || !src || !seg) return;
  const t = a.currentTime;
  seg.gain.cancelScheduledValues(t); seg.gain.setValueAtTime(seg.gain.value, t); seg.gain.linearRampToValueAtTime(0, t + fade);
  try { src.stop(t + fade + 0.05); } catch { /* already stopped */ }
  src = undefined; seg = undefined; segEnd = 0;
}

function startSet(a: AudioContext, from: number) {
  const s = a.createBufferSource(), g = a.createGain();
  s.buffer = buf!;
  s.connect(g).connect(bus!);
  const t = a.currentTime, len = buf!.duration - from;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + (from > 0 ? FADE : 0.05));
  // The track ends on a held chord: fade the last seconds so a set never clips off.
  g.gain.setValueAtTime(1, t + len - FADE); g.gain.linearRampToValueAtTime(0, t + len);
  s.start(t, from);
  src = s; seg = g; segEnd = t + len; sets++;
}

/** Call every frame. */
export function tickMusic() {
  const a = liveAudio();
  if (!a) return;
  if (!bus) {
    bus = a.createGain(); duck = a.createGain();
    bus.gain.value = 0; bus.connect(duck).connect(a.destination);
  }
  if (!buf && !loading) {
    loading = true;
    fetch(SRC).then((r) => r.arrayBuffer()).then((b) => a.decodeAudioData(b)).then((b) => { buf = b; }).catch(() => { loading = false; });
  }
  const now = a.currentTime;
  const atRace = Math.hypot(me.x - HIPPODROME.pos[0], me.z - HIPPODROME.pos[1]) < 140;
  const racing = play.racing || atRace;
  // How loud, where you are. The map view (before you take your seat) plays it as a title theme.
  const level = !on ? 0
    : play.paused ? 0.12
      : play.mode === 'map' ? 0.42
        : play.game ? 0.1
          : racing ? 0.4
            : play.inside >= 0 ? 0.2
              : 0.3;
  const k = 1 - Math.exp(-1 / 60 / 0.6);
  bus.gain.value += (level - bus.gain.value) * k;
  duck!.gain.value += ((1 - 0.6 * musicDuck.amount) - duck!.gain.value) * (1 - Math.exp(-1 / 60 / 0.15));
  if (!buf || !on) return;
  if (src && now >= segEnd) { src = undefined; seg = undefined; restUntil = now + (racing || play.mode === 'map' ? 0 : 40 + Math.random() * 50); }
  if (!src && now >= restUntil) startSet(a, sets === 0 ? 0 : LOOP_FROM);
  // Arriving at the races mid-rest: the music comes in at once.
  if (!src && racing && restUntil > now + 2) restUntil = now + 2;
}

if (typeof window !== 'undefined') {
  const loop = () => { tickMusic(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key.toLowerCase() === 'n' && !play.game) setMusic(!on);
  });
}
