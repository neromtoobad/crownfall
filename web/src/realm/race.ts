// Chariot races at the Mumtaz Hippodrome. The race is a pure function of its seed plus the whips cracked during it,
// stepped at a fixed 10 Hz, so the contract (or anyone) can replay a result from the same inputs.
import { useSyncExternalStore } from 'react';
import { DT, laneLen, laneR, newRace, tick, type Race, type Runner } from './raceSim.ts';
export * from './raceSim.ts';

const PARADE = 9; // seconds of parade and betting before the off
const AFTER = 12; // seconds the podium stays up

// The live race, shared by the 3D scene (which steps it) and the HUD (which reads it a few times a second).
const q = new URLSearchParams(location.search);
export const live = {
  race: newRace(Number(q.get('race-n') ?? Math.floor(Date.now() / 120000) % 1000)),
  acc: 0,
  watch: q.get('race') === 'watch',
  /** Waiting to drive this house in the next race. */
  nextDriver: undefined as number | undefined,
  /** Called when a race the player drove has ended and the next one is about to start. */
  onEnd: undefined as ((r: Race) => void) | undefined,
  /** The contract's latest race, as last read (chain/races.ts polls it). Shown on the track unless you are driving. */
  chain: undefined as ChainRaceView | undefined,
  version: 0,
};

export interface ChainRaceView {
  n: number; seed: number; laps: number;
  /** When the teams are off, in ms since the epoch (the chain's clock). */
  offMs: number;
  whips: [number, number][];
  settled: boolean; order: number[]; finishMs: number[];
  /** NEAR backed on each house, and what the winners share once settled. */
  pools: number[]; payout: number;
  ticket?: { bets: number[]; whips: number; claimed: boolean };
}

/** Put the contract's race on the track: built from its seed and laps, with every whip cracked on chain, and caught up
 *  to the chain's clock. Rebuilt whenever a new whip lands, since a whip changes everything after it. */
export function showChainRace(cv: ChainRaceView) {
  const prev = live.chain;
  live.chain = cv;
  if (live.race.driver !== undefined || live.nextDriver !== undefined) { emit(); return; }
  const cur = live.race;
  const same = cur.chain && cur.n === cv.n && prev && prev.n === cv.n && prev.whips.length === cv.whips.length;
  if (!same) {
    const r = newRace(cv.n, cv.seed, cv.laps);
    r.chain = true;
    r.backed = cur.chain && cur.n === cv.n ? cur.backed : undefined;
    r.whips = cv.whips.map(([t, h]) => ({ tick: t, house: h, by: 'you' as const }));
    live.race = r;
    catchUp(r);
  }
  emit();
}
function catchUp(r: Race) {
  const off = live.chain?.offMs ?? 0, el = (Date.now() - off) / 1000;
  if (el < 0) { r.phase = 'parade'; live.acc = 0; return; }
  if (r.phase === 'parade') r.phase = 'run';
  const target = Math.min(2400, el / DT), whole = Math.floor(target);
  while (r.tick < whole) tick(r);
  live.acc = r.tick === whole ? (target - whole) * DT : 0;
}
/** Seconds to the off of the race on the track (chain races keep the chain's clock). */
export function toOff(r: Race) { return r.chain ? Math.max(0, ((live.chain?.offMs ?? 0) - Date.now()) / 1000) : Math.max(0, PARADE - r.t); }
const subs = new Set<() => void>();
function emit() { live.version++; subs.forEach((f) => f()); }
let lastEmit = 0;

/** Advance the live race by real time dt (called every frame by the arena). */
export function advance(dt: number) {
  const r = live.race;
  r.t += dt;
  if (r.chain) {
    // A contract race runs on the chain's clock and stays on the track, result and all, until the next one is called.
    catchUp(r);
  } else if (r.phase === 'parade') {
    if (r.t >= PARADE) { r.phase = 'run'; r.t = 0; live.acc = 0; emit(); }
  } else if (r.phase === 'run') {
    live.acc += Math.min(dt, 0.25);
    while (live.acc >= DT) { live.acc -= DT; tick(r); }
  } else {
    live.acc += Math.min(dt, 0.25);
    while (live.acc >= DT) { live.acc -= DT; tick(r); } // let the cool-down lap play out
    if (r.t - (r.doneAt ?? 0) > AFTER) {
      const backed = r.backed;
      if (r.driver !== undefined) live.onEnd?.(r);
      live.race = newRace(r.n + 1); live.race.backed = backed;
      if (live.nextDriver !== undefined) { live.race.driver = live.nextDriver; live.nextDriver = undefined; }
      emit();
    }
  }
  const now = performance.now();
  if (now - lastEmit > 250) { lastEmit = now; emit(); }
}

/** Where a team is drawn this frame, between its last two ticks: the lane radius, the distance along it, and the wheel turn. */
export function drawAt(ru: Runner, out = { r: 0, s: 0, roll: 0 }) {
  const a = live.race.phase === 'parade' ? 1 : Math.min(1, live.acc / DT);
  out.r = laneR(ru.prevLn + (ru.ln - ru.prevLn) * a);
  out.s = (ru.prevP + (ru.p - ru.prevP) * a) * laneLen(out.r);
  out.roll = ru.prev + (ru.dist - ru.prev) * a;
  return out;
}

export function back(house: number) { if (live.race.phase === 'parade') { live.race.backed = house; emit(); } }
/** Crack one of your three whips over the team you drive, or else the team you backed. */
export function crack() {
  const r = live.race, h = r.driver ?? r.backed;
  if (r.phase !== 'run' || h === undefined || r.yourWhips <= 0 || r.runners[h].finish !== undefined) return false;
  r.yourWhips--;
  r.whips.push({ tick: r.tick + 1, house: h, by: 'you' });
  emit();
  return true;
}
/** Ask to change lane in the team you drive. It happens on the next tick if the lane is clear. */
export function steer(dir: -1 | 1) {
  const r = live.race;
  if (r.driver === undefined) return;
  r.moves.push({ tick: r.tick + 1, house: r.driver, dir });
}
/** The player takes (or gives back) the reins of a house's team: in this race if it hasn't started, else in the next. */
export function setDriver(house: number | undefined) {
  if (house === undefined) { live.race.driver = undefined; live.nextDriver = undefined; emit(); return; }
  // A contract race can't be driven: you take the reins in a practice heat that starts now.
  if (live.race.chain) { live.race = newRace(Math.floor(Date.now() / 120000) % 1000); live.acc = 0; live.race.driver = house; emit(); return; }
  if (live.race.phase === 'parade') live.race.driver = house; else live.nextDriver = house;
  emit();
}
export function setWatch(on: boolean) { live.watch = on; emit(); }

export function useRace() {
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => live.version);
  return live;
}

if (import.meta.env.DEV) Object.assign(window, { __race: { live, newRace, showChainRace } });
