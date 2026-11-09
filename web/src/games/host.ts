// The hall games: one per house (and Liar's Dice in the Library). This file runs a game's life:
//   intro card (what it is, the keys, the entry) → play (the game owns the camera and the keys) → result card.
// The entry is paid in the house's own coin and BURNED: if you hold none, the entry is bought on the house's curve
// first. So every round played in a hall raises the price for that house's holders: play-to-burn, the memecoin
// mechanic as gameplay. On NEAR the burn is the favour; a win counts for the seals. On the practice purse a win pays
// from the house treasury.
import { useSyncExternalStore, type FC } from 'react';
import { ledger, note, pay, playBurn } from '../realm/ledger.ts';
import { emitPlay, hush, hushed, isAction, play, takePressed } from '../realm/play.ts';
import { LIBRARY, hallHouse, roomOf, type GameId, type Room } from '../realm/rooms.ts';
import { enterHall, finishHall, held } from '../chain/game.ts';
import { onChain } from '../chain/near.ts';

export interface Result {
  won: boolean;
  /** The game's own score, shown on the card ("4 of 5 bullseyes"). */
  score: number;
  /** One line for the card: what happened. */
  line: string;
  /** How good the win was, 0..1: scales the payout between 1 and 4 NEAR. */
  grade?: number;
}

export interface GameDef {
  id: GameId;
  name: string;
  /** The rule in one line, shown on the intro card. */
  pitch: string;
  /** Controls, as [keys, what they do]. */
  keys: [string, string][];
  /** Coins burned to play one round (or, in the Library, NEAR staked on the table). */
  entry: number;
  /** The game's furniture, always standing in the hall (local frame: x right, z toward the door, y up). */
  Station: FC<{ room: Room }>;
  /** The round itself, mounted inside the 3D scene while it runs. Call `end` once. */
  Play: FC<{ room: Room; end: (r: Result) => void }>;
  /** The game's own HUD while it runs (DOM, over the canvas). */
  Hud?: FC;
  /** Where the camera sits for the intro and result cards, in the hall's frame: [x, y, z] and the point it looks at. */
  view: (room: Room) => { pos: [number, number, number]; look: [number, number, number] };
}

const DEFS = new Map<GameId, GameDef>();
export function register(d: GameDef) { DEFS.set(d.id, d); }
export const gameDef = (id: GameId) => DEFS.get(id);

export const session = {
  phase: 'none' as 'none' | 'intro' | 'play' | 'result',
  room: undefined as Room | undefined,
  result: undefined as Result | undefined,
  payout: 0,
  /** A round counter: remounts the Play component for each new round. */
  round: 0,
  /** The house stands you your first round in each hall. */
  free: false,
  error: '',
  /** On NEAR: the round the contract opened for this play, and whether we're waiting on the chain. */
  chainRound: undefined as number | undefined,
  busy: false,
  /** NEAR put on the Library table this round (0 when Haseeb stood you the game). */
  staked: 0,
  /** Esc was pressed mid-round: leaving needs a second Esc (until this time, ms). */
  leaving: 0,
};
if (import.meta.env.DEV) Object.assign(window, { __game: session });

const freeKey = 'crownfall.freeRounds';
const freeUsed = (): number[] => { try { return JSON.parse(localStorage.getItem(freeKey) ?? '[]'); } catch { return []; } };

/** Walk up to a hall's game and press E: the intro card. */
export function startGame(house: number) {
  const room = roomOf(house);
  if (!gameDef(room.game)) return;
  session.room = room; session.phase = 'intro'; session.result = undefined; session.error = '';
  // The house stands you your first round on the practice purse. On NEAR every round is a real burn.
  session.free = !onChain() && !freeUsed().includes(house);
  play.game = { id: room.game, house, t: performance.now() };
  document.exitPointerLock?.();
  takePressed();
  hush(600);
  emitPlay();
}

/** Pay (burn) the entry and begin a round. */
export function beginRound() {
  const r = session.room!, def = gameDef(r.game)!;
  if (session.busy) return;
  session.chainRound = undefined;
  session.leaving = 0;
  session.staked = r.house === LIBRARY && (onChain() || !session.free) ? def.entry : 0;
  if (onChain()) {
    const lib = r.house === LIBRARY;
    if (!lib && held(r.house) < def.entry) { session.error = `You need ${def.entry} $${hallHouse(r.house).coin} for the entry.`; emitPlay(); return; }
    session.busy = true; session.error = ''; emitPlay();
    enterHall(r.house, lib).then((id) => {
      session.busy = false; session.chainRound = id;
      note(lib ? `Staked 1 NEAR at ${def.name} in Qureshi's Library, on NEAR.` : `Played ${def.name} in the hall of House ${hallHouse(r.house).name}: ${def.entry} $${hallHouse(r.house).coin} burned on NEAR.`, lib ? undefined : r.house);
      session.phase = 'play'; session.round++;
      takePressed();
      emitPlay();
    }).catch((e: Error) => { session.busy = false; session.error = e.message; emitPlay(); });
    return;
  }
  if (!session.free && r.house === LIBRARY) {
    if (ledger.near < def.entry) { session.error = `You need ${def.entry} NEAR for the stake.`; emitPlay(); return; }
    ledger.near -= def.entry; note(`Staked ${def.entry} NEAR at ${def.name} in Qureshi's Library.`);
  } else if (!session.free) {
    const ok = playBurn(r.house, def.entry, def.name);
    if (!ok) { session.error = `You need about ${(def.entry * 0.0011).toFixed(2)} NEAR for the entry.`; emitPlay(); return; }
  } else {
    try { localStorage.setItem(freeKey, JSON.stringify([...freeUsed(), r.house])); } catch { /* private window */ }
  }
  session.free = false;
  session.phase = 'play'; session.round++; session.error = '';
  takePressed();
  emitPlay();
}

export const flagsGame: { last?: { id: GameId; house: number; won: boolean; score: number; t: number } } = {};

/** The round is over. */
export function endRound(res: Result) {
  if (session.phase !== 'play') return;
  const r = session.room!, h = hallHouse(r.house);
  session.result = res; session.phase = 'result';
  // On the practice purse a hall win pays 1–4 NEAR from the house treasury. The Library works as on NEAR: a win hands
  // the stake back (a free first game pays the stake's worth).
  const g = Math.min(1, Math.max(0, res.grade ?? 0.5));
  session.payout = !res.won ? 0 : r.house === LIBRARY ? (session.staked === 0 ? gameDef(r.game)!.entry : session.staked) : Math.round((1 + 3 * g) * 10) / 10;
  if (session.chainRound !== undefined) {
    // On NEAR the round is closed on chain. The chain can't see the game, so a win moves no money and no favour (the
    // entry's burn already was the favour): it marks the hall won for the seals, and in the Library hands the stake back.
    const round = session.chainRound;
    session.chainRound = undefined;
    session.payout = 0;
    void finishHall(round, res.won, g).catch(() => { /* shown in the chain bar */ });
  } else if (res.won) {
    ledger.favour[r.house] = (ledger.favour[r.house] ?? 0) + 1;
    const where = r.house === LIBRARY ? 'Qureshi’s Library' : `the hall of House ${h.name}`;
    pay(session.payout, `Won ${gameDef(r.game)!.name} in ${where}`);
  } else note(`Lost at ${gameDef(r.game)!.name} in ${r.house === LIBRARY ? 'Qureshi’s Library' : `the hall of House ${h.name}`}.`, r.house < LIBRARY ? r.house : undefined);
  flagsGame.last = { id: r.game, house: r.house, won: res.won, score: res.score, t: Date.now() };
  takePressed();
  // Keys still going from the round (a last arrow, a last bid) must not hit "Again" and pay for another.
  hush(1200);
  emitPlay();
}

/** Leave the game (Esc), back to walking the hall. */
export function quitGame() {
  // Walking out mid-round on NEAR: close the round as lost now (the contract would after an hour anyway).
  if (session.phase === 'play' && session.chainRound !== undefined) {
    const round = session.chainRound;
    session.chainRound = undefined;
    void finishHall(round, false, 0).catch(() => {});
  }
  session.phase = 'none'; session.room = undefined; session.leaving = 0;
  play.game = undefined;
  takePressed();
  emitPlay();
}

/** A small shared state between a game's Play (in the canvas) and its Hud (in the DOM): `set` re-renders the Hud. */
export function gameUi<T extends object>(init: T) {
  const state = { ...init };
  const subs = new Set<() => void>();
  let v = 0;
  return {
    state,
    set(patch: Partial<T>) { Object.assign(state, patch); v++; subs.forEach((f) => f()); },
    reset() { Object.assign(state, init); v++; subs.forEach((f) => f()); },
    use() { useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => v); return state; },
  };
}

/** One-shot keys for a round in progress. Esc asks first ("Esc again to leave"); a second Esc within a few seconds
 *  walks out, and the round counts as lost. Any other key keeps you at the table. */
export function gameKeys() {
  const ks = takePressed();
  if (ks.includes('escape')) {
    if (performance.now() < session.leaving) { quitGame(); return []; }
    session.leaving = performance.now() + 4000; emitPlay();
    return ks.filter((k) => k !== 'escape');
  }
  if (session.leaving && (ks.length || performance.now() >= session.leaving)) { session.leaving = 0; emitPlay(); }
  return ks;
}

/** Keys while a card is up (the round itself reads its own). Called every frame by the stage. */
export function tickCards() {
  if (session.phase !== 'intro' && session.phase !== 'result') return;
  for (const k of takePressed()) {
    if (k === 'escape') { quitGame(); return; }
    if (isAction(k) && !hushed()) { beginRound(); return; }
  }
}

if (import.meta.env.DEV) Object.assign(window, { __games: { startGame, beginRound, endRound, quitGame, session } });
