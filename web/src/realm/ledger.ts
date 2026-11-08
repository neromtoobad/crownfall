// A practice purse kept in this browser until the Crownfall contract is wired: house coins on a bonding curve,
// decrees that burn them, ravens, marches and a chronicle. Every number here is local, and the HUD says so.
import { HOUSES } from './layout.ts';
import { emitPlay } from './play.ts';

/** Price in NEAR rises with supply: p(s) = BASE · (1 + s / K). */
const BASE = 0.001, K = 1_000_000, FEE = 0.05;
export const priceAt = (s: number) => BASE * (1 + s / K);
/** NEAR it costs to mint q coins when s are out (the area under the curve). */
const area = (s: number, q: number) => BASE * (q + (2 * s * q + q * q) / (2 * K));

export interface Entry { t: number; text: string; house?: number }
export interface Ledger {
  near: number;
  held: number[];
  supply: number[];
  people: number[];
  chronicle: Entry[];
  marches: { id: string; from: number; to: number; started: number }[];
  /** Rounds won in each house's hall. */
  favour: number[];
}

const KEY = 'crownfall.practice';

/** The last thing of each kind you did, with a timestamp: missions watch these. */
export const flags: { bought?: { h: number; t: number }; raven?: { to: number; t: number }; march?: { to: number; t: number }; race?: { place: number; house: number; t: number } } = {};
function fresh(): Ledger {
  return {
    near: 25,
    held: HOUSES.map(() => 0),
    supply: HOUSES.map((h) => 180_000 + ((h.id * 7919) % 9) * 41_000),
    people: HOUSES.map((h) => 40 + ((h.id * 31) % 7) * 6),
    chronicle: [{ t: Date.now(), text: 'You took a seat in the realm of Vael.' }],
    marches: [],
    favour: HOUSES.map(() => 0),
  };
}
export const ledger: Ledger = (() => {
  try { const s = localStorage.getItem(KEY); if (s) return { ...fresh(), ...JSON.parse(s), marches: [] }; } catch { /* private window */ }
  return fresh();
})();
function save(text?: string, house?: number) {
  if (text) ledger.chronicle.unshift({ t: Date.now(), text, house });
  ledger.chronicle.length = Math.min(ledger.chronicle.length, 60);
  try { localStorage.setItem(KEY, JSON.stringify({ ...ledger, marches: [] })); } catch { /* private window */ }
  emitPlay();
}

/** Spend `near` on house h's coin. Returns the coins minted, or 0 if you can't afford it. */
export function buy(h: number, near: number) {
  if (near <= 0 || near > ledger.near + 1e-9) return 0;
  const net = near * (1 - FEE), s = ledger.supply[h];
  // Solve area(s, q) = net for q.
  const a = BASE / (2 * K), b = BASE * (1 + s / K), q = (-b + Math.sqrt(b * b + 4 * a * net)) / (2 * a);
  ledger.near -= near; ledger.supply[h] += q; ledger.held[h] += q;
  flags.bought = { h, t: Date.now() };
  save(`Bought ${fmt(q)} $${HOUSES[h].coin} for ${near.toFixed(2)} NEAR at the Warwick Mint.`, h);
  return q;
}
export function sell(h: number, q: number) {
  q = Math.min(q, ledger.held[h]);
  if (q <= 0) return 0;
  const s = ledger.supply[h], out = area(s - q, q) * (1 - FEE);
  ledger.near += out; ledger.supply[h] -= q; ledger.held[h] -= q;
  save(`Sold ${fmt(q)} $${HOUSES[h].coin} for ${out.toFixed(3)} NEAR.`, h);
  return out;
}

export const DECREES = [
  { id: 'levy', name: 'Raise the levies', burn: 2000, note: 'Burns coin; more people come to the banner.' },
  { id: 'bless', name: 'Bless the harvest', burn: 1200, note: 'Burns coin; the next harvest pays more.' },
  { id: 'wall', name: 'Mend the walls', burn: 1600, note: 'Burns coin; your house is harder to take this season.' },
] as const;
export function decree(h: number, id: (typeof DECREES)[number]['id']) {
  const d = DECREES.find((x) => x.id === id)!;
  if (ledger.held[h] < d.burn) return false;
  ledger.held[h] -= d.burn; ledger.supply[h] -= d.burn;
  if (id === 'levy') ledger.people[h] += 6;
  save(`House ${HOUSES[h].name} decreed: ${d.name.toLowerCase()} (${d.burn} $${HOUSES[h].coin} burned).`, h);
  return true;
}
export function raven(from: number, to: number, text: string) {
  flags.raven = { to, t: Date.now() };
  save(`A raven flew from House ${HOUSES[from].name} to House ${HOUSES[to].name}: “${text.slice(0, 140)}”`, from);
}
export function muster(from: number, to: number) {
  flags.march = { to, t: Date.now() };
  ledger.marches.push({ id: `m${Date.now()}`, from, to, started: Date.now() });
  save(`House ${HOUSES[from].name} marched on House ${HOUSES[to].name}.`, from);
}
/** A hall game's entry: `coins` of house h, burned. Bought on the curve first if you don't hold them. */
export function playBurn(h: number, coins: number, game: string) {
  const short = Math.max(0, coins - ledger.held[h]);
  if (short > 0) {
    const cost = (area(ledger.supply[h], short) / (1 - FEE)) * 1.001;
    if (cost > ledger.near + 1e-9) return false;
    ledger.near -= cost; ledger.supply[h] += short; ledger.held[h] += short;
  }
  ledger.held[h] -= coins; ledger.supply[h] -= coins;
  save(`Played ${game} in the hall of House ${HOUSES[h].name}: ${fmt(coins)} $${HOUSES[h].coin} burned.`, h);
  return true;
}
export function note(text: string, house?: number) { save(text, house); }
/** A reward: practice NEAR into the purse (the HUD shows the "+" ticking up). */
export function pay(near: number, why: string) { ledger.near += near; lastPay.amount = near; lastPay.t = Date.now(); save(`${why} (+${near} NEAR).`); }
export const lastPay = { amount: 0, t: 0 };

export const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : Math.round(n).toLocaleString());
