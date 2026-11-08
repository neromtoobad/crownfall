// Play mode: you take a seat in the realm as a lord and walk it, ride it, and race in it.
// Shared by the 3D scene (which moves you) and the HUD (which shows prompts and panels).
import { useSyncExternalStore } from 'react';

export const BODIES = [
  { id: 'lord-ram', name: 'The golden lord' },
  { id: 'lady-heron', name: 'The grey lady' },
  { id: 'lord-boar', name: 'The boar lord' },
  { id: 'lady-asp', name: 'The marsh lady' },
  { id: 'lord-owl', name: 'The owl lord' },
  { id: 'lord-bull', name: 'The iron lord' },
  { id: 'queen-lynx', name: 'The snow queen' },
  { id: 'lord-hawk', name: 'The hawk lord' },
  { id: 'soldier', name: 'A sworn sword' },
  { id: 'peasant-m', name: 'A farmer' },
  { id: 'peasant-f', name: 'A farmwife' },
] as const;

export interface Seat { body: string; house: number; name: string; motto: string }

/** Something you can do where you stand. */
export interface Prompt { id: string; verb: string; what: string; panel?: string; house?: number }

const q = new URLSearchParams(location.search);
function loadSeat(): Seat | undefined {
  try { const s = localStorage.getItem('crownfall.seat'); return s ? JSON.parse(s) : undefined; } catch { return undefined; }
}

export const play = {
  mode: (import.meta.env.DEV && q.get('play') !== null ? 'play' : 'map') as 'map' | 'play',
  seat: loadSeat() ?? (import.meta.env.DEV && q.get('play') !== null ? { body: q.get('body') ?? 'lord-ram', house: Number(q.get('house') ?? 2), name: 'Test Lord', motto: '' } : undefined) as Seat | undefined,
  picking: false,
  driving: false,
  prompt: undefined as Prompt | undefined,
  panel: undefined as Prompt | undefined,
  /** In the race, driving your own house's chariot. */
  racing: false,
  /** The pause menu (Esc or P). */
  paused: false,
  /** The house whose hall you are standing in, or -1 outdoors (rooms.ts). */
  inside: -1,
  /** The hall game being played, if any (games/host.ts): it owns the camera and the keys. */
  game: undefined as { id: string; house: number; t: number } | undefined,
  speed: 0,
  version: 0,
};
/** Where you are. Moved by Player.tsx; read by the map camera, the race and checks (window.__me in dev). */
export const me = {
  x: 22, z: 50, yaw: 0.52, speed: 0,
  camYaw: 0, camPitch: 0.26, camDist: 8.5, lastLook: -10,
  /** Set when you're moved somewhere new (through a door): the camera jumps there instead of gliding. */
  cut: false,
  // On the Greywater road beside the Mint square, facing the Gershuni Gate.
  car: { x: 25.5, z: 44.5, yaw: 0.52, v: 0, boost: 0, cool: 0, gait: 0 },
};
if (import.meta.env.DEV) Object.assign(window, { __me: me });

const subs = new Set<() => void>();
if (import.meta.env.DEV) Object.assign(window, { __play: play });
export function emitPlay() { play.version++; subs.forEach((f) => f()); }
export function usePlay() {
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => play.version);
  return play;
}

export function takeSeat(seat: Seat) {
  play.seat = seat;
  try { localStorage.setItem('crownfall.seat', JSON.stringify(seat)); } catch { /* private window */ }
  play.picking = false;
  play.mode = 'play';
  emitPlay();
}
/** You chose "Practice without a wallet" on this visit: entering the realm stops asking. */
let practising = false;
export function practise() { practising = true; }
/** Whether a wallet is connected, set by the chain module (play.ts doesn't import it). */
export const wallet = { connected: () => false };
export function setMode(mode: 'map' | 'play') {
  // Wallet first: entering without one opens the seat picker on its wallet step.
  if (mode === 'play' && (!play.seat || (!wallet.connected() && !practising))) { play.picking = true; emitPlay(); return; }
  play.mode = mode;
  play.panel = undefined;
  play.paused = false;
  if (mode === 'map') document.exitPointerLock?.();
  emitPlay();
}
export function pause(on: boolean) { play.paused = on; if (on) document.exitPointerLock?.(); emitPlay(); }
export function openPanel(p?: Prompt) { play.panel = p; if (p) document.exitPointerLock?.(); emitPlay(); }

// Keys held right now. Typing in a form field never moves you.
export const keys = new Set<string>();
const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
const pressed: string[] = [];
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (typing(e)) return;
    const k = e.key.toLowerCase();
    if (!keys.has(k)) pressed.push(k);
    keys.add(k);
    if (play.mode === 'play' && [' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
}
/** A short hush on the action keys (E, Space, Enter): set when a conversation closes or a card opens, so a key meant
 *  for the last line or the last screen never lands on whatever comes up next. */
let hushUntil = 0;
export function hush(ms: number) { hushUntil = Math.max(hushUntil, performance.now() + ms); }
export const isAction = (k: string) => k === 'e' || k === ' ' || k === 'enter';
export function hushed() { return performance.now() < hushUntil; }
/** Keys pressed since the last call (for one-shot actions like E or Space). */
export function takePressed() { const out = pressed.splice(0); return out; }

/** A one-shot key from a touch button (the same path as a real key press). */
export function press(k: string) { pressed.push(k); }
/** The touch joystick: x right, y forward, each −1…1. */
export const stick = { x: 0, y: 0, active: false };
export const TOUCH = typeof window !== 'undefined' && (new URLSearchParams(location.search).has('touch') || matchMedia('(pointer: coarse)').matches);
