// Spoken lines: the Wardens, the Chronicle, the scribes, the race caller and the Mint clerk have real voices
// (design/audio/lines.mjs makes them; web/public/audio/vo/<id>.mp3). A story line is found by its exact text, so a
// line whose text changes per player (a house's name in it) keeps the murmur instead. One voice at a time: a new line
// cuts the last one off, and the music dips while anyone speaks.
import INDEX from './vo-index.json';
import { audio } from './sound.ts';
import { musicDuck } from './music.ts';

const byText = INDEX.text as Record<string, string>;
const events = new Set(INDEX.events as string[]);
const cache = new Map<string, Promise<AudioBuffer | undefined>>();
let cur: { src: AudioBufferSourceNode; g: GainNode } | undefined;
let speaking = 0;

function load(id: string) {
  let p = cache.get(id);
  if (!p) {
    const a = audio();
    p = a ? fetch(`/audio/vo/${id}.mp3`).then((r) => r.arrayBuffer()).then((b) => a.decodeAudioData(b)).catch(() => undefined) : Promise.resolve(undefined);
    cache.set(id, p);
  }
  return p;
}

export const voicedText = (text: string) => byText[text];
export const hasEvent = (id: string) => events.has(id);

/** Warm the cache for lines about to be needed (a talk's lines, say), so the first one starts on time. */
export function preload(texts: string[]) { for (const t of texts) { const id = byText[t]; if (id) void load(id); } }

export function stopVoice() {
  if (!cur) return;
  const a = audio(), c = cur;
  cur = undefined;
  if (a) { c.g.gain.setTargetAtTime(0, a.currentTime, 0.04); try { c.src.stop(a.currentTime + 0.2); } catch { /* done */ } }
  speaking = 0; musicDuck.amount = 0;
}

/** Play line `id`. Resolves to its length in seconds, or undefined if there is no audio for it. */
export async function playVoice(id: string, opts: { gain?: number; pan?: number } = {}): Promise<number | undefined> {
  const a = audio();
  const b = await load(id);
  if (!a || !b) return undefined;
  stopVoice();
  const src = a.createBufferSource(), g = a.createGain(), p = a.createStereoPanner();
  src.buffer = b; g.gain.value = opts.gain ?? 0.9; p.pan.value = Math.max(-0.8, Math.min(0.8, opts.pan ?? 0));
  src.connect(g).connect(p).connect(a.destination);
  src.start();
  const me = { src, g };
  cur = me; speaking = 1; musicDuck.amount = 1;
  src.onended = () => { if (cur === me) { cur = undefined; speaking = 0; musicDuck.amount = 0; } };
  return b.duration;
}

/** Speak a story line if it has a voice. Resolves to its length, or undefined (then the caller murmurs instead). */
export function sayLine(text: string) {
  const id = byText[text];
  return id ? playVoice(id) : Promise.resolve(undefined);
}
export const isSpeaking = () => speaking > 0;
