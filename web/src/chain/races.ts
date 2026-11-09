// The Mumtaz Hippodrome on NEAR: read the contract's latest race, keep the track showing it, and do the chores any
// player may do (settle a finished race, call the next one). Bets go through the wallet; whips and claims use the game key.
import { live, showChainRace, type ChainRaceView } from '../realm/race.ts';
import { HOUSES } from '../realm/layout.ts';
import { note } from '../realm/ledger.ts';
import { chain, keyCall, onChain, units, view, walletCall, type ChainRace, type ChainRealm } from './near.ts';

/** Matches the contract: betting closes at the off; then the race is started (its seed drawn from that block), and
 *  whips count for the first 40 s from the start. */
export const WHIP_SECS = 40;
export const WHIP_COINS = 200;

const settling = new Set<number>(), calling = new Set<number>(), starting = new Set<number>();
let settledSeen = { n: -1, at: 0 };

export async function pollRace() {
  if (!onChain()) return;
  try {
    const realm = await view<ChainRealm>('get_realm');
    chain.realm = realm;
    if (realm.races === 0) { maybeCall(-1); return; }
    const n = realm.races - 1;
    const [r, t] = await Promise.all([
      view<ChainRace>('get_race', { race: n }),
      chain.account ? view<{ bets: string[]; whips: number; claimed: boolean } | null>('get_ticket', { race: n, account: chain.account }) : Promise.resolve(null),
    ]);
    const cv: ChainRaceView = {
      n: r.n, seed: r.seed, laps: r.laps,
      offMs: Number(BigInt(r.off_ns) / 1_000_000n),
      startMs: r.started && r.started_ns ? Number(BigInt(r.started_ns) / 1_000_000n) : undefined,
      whips: r.whips, settled: r.settled, order: r.order, finishMs: r.finish_ms,
      pools: r.pools.map(units), payout: units(r.payout),
      ticket: t ? { bets: t.bets.map(units), whips: t.whips, claimed: t.claimed } : undefined,
    };
    showChainRace(cv);
    // At the off anyone may start the race: the contract draws its seed from that block, after the last bet.
    if (!cv.settled && cv.startMs === undefined && Date.now() > cv.offMs + 1000 && !starting.has(cv.n) && chain.keyed) {
      starting.add(cv.n);
      keyCall('Starting the race: the seed is drawn on NEAR', 'start_race', { race: cv.n }, true).catch(() => {}).finally(() => void pollRace());
    }
    // Anyone may settle a race once the whip window has closed: the contract runs it.
    const runFrom = cv.startMs ?? cv.offMs;
    if (!cv.settled && Date.now() > runFrom + (WHIP_SECS + 2) * 1000 && !settling.has(cv.n) && chain.keyed) {
      settling.add(cv.n);
      keyCall('Settling the race on NEAR', 'settle', { race: cv.n }, true).then(() => note(`Race ${cv.n} settled on NEAR: House ${HOUSES[cv.order[0] ?? 0]?.name ?? '?'} first.`)).catch(() => {}).finally(() => void pollRace());
    }
    if (cv.settled) {
      // Leave the result up a little if it has only just finished; an old result is replaced at once.
      if (settledSeen.n !== cv.n) settledSeen = { n: cv.n, at: Date.now() - (Date.now() > cv.offMs + 120_000 ? 60_000 : 0) };
      maybeCall(cv.n);
    }
  } catch (e) { console.warn('[chain] race', e); }
}

/** While you watch, call the next race a little after the last one settled (it opens 90 s of betting). */
function maybeCall(last: number) {
  if (!live.watch || !chain.keyed || calling.has(last)) return;
  if (last >= 0 && Date.now() - settledSeen.at < 15000) return;
  calling.add(last);
  void callRace().catch(() => {});
}

export async function callRace() {
  await keyCall('Calling the next race', 'call_race', {});
  await pollRace();
}

export async function bet(house: number, near: number) {
  const cv = live.chain!;
  await walletCall(`Backing House ${HOUSES[house].name} with ${near} NEAR`, 'bet', { race: cv.n, house }, near);
  live.race.backed = house;
  note(`Backed House ${HOUSES[house].name} with ${near} NEAR in race ${cv.n}, on NEAR.`, house);
  await pollRace();
}

export async function whip(house: number) {
  const cv = live.chain!;
  const tick = await keyCall<number>(`Cracking the whip for ${HOUSES[house].name}`, 'whip', { race: cv.n, house });
  note(`Cracked a whip for House ${HOUSES[house].name} in race ${cv.n} at tick ${tick}: ${WHIP_COINS} $${HOUSES[house].coin} burned on NEAR.`, house);
  await pollRace();
}

export async function collect() {
  const cv = live.chain!;
  await keyCall('Collecting your winnings', 'claim_race', { race: cv.n });
  note(`Collected winnings from race ${cv.n} on NEAR.`);
  await pollRace();
}

/** What your bets on the winner pay, once the race is settled. */
export function winnings(cv: ChainRaceView) {
  if (!cv.settled || !cv.ticket) return 0;
  const w = cv.order[0], mine = cv.ticket.bets[w] ?? 0;
  return mine > 0 && cv.pools[w] > 0 ? (cv.payout * mine) / cv.pools[w] : 0;
}

let timer: ReturnType<typeof setInterval> | undefined;
/** Start polling (every 3 s while you are on NEAR). */
export function startRacePolling() {
  if (timer) return;
  timer = setInterval(() => { if (onChain()) void pollRace(); }, 3000);
  void pollRace();
}

if (import.meta.env.DEV) Object.assign(window, { __races: { pollRace, callRace, bet, whip, collect } });
