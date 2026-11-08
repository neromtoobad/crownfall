// The chariot race itself: a pure function of its seed, its laps and the whips cracked during it, stepped at a fixed
// 10 Hz. chain/src/sim.rs is the same code in Rust, and the contract runs it to settle a race, so the browser's replay
// and the chain's result agree to the bit (chain/tests/race-fixture.json is written from this file and checked there).
// Keep the two in step: same operations, same order.

const IDS = [0, 1, 2, 3, 4, 5, 6, 7];

/** The arena in its own frame: two straights of length L joined by half-circles around the ends of the spina. */
export const ARENA = { L: 120, R: 50, lanes: 8, inner: 9, gap: 5.3 };
/** World units per metre: the people of the realm are drawn a little over 3.5 units tall. */
export const M = 1.85;
export const laneR = (lane: number) => ARENA.inner + lane * ARENA.gap;
export const laneLen = (r: number) => 2 * ARENA.L + 2 * Math.PI * r;
export const MID = laneLen(laneR(3.5));

/** A point on the lane of radius r, `s` units from the finish line (the middle of the near straight). */
export function lanePoint(r: number, s: number, out: { x: number; z: number; yaw: number }) {
  const { L } = ARENA;
  const P = laneLen(r);
  let u = (((s + L / 2) % P) + P) % P; // measured from the start of the near straight
  if (u < L) { out.x = -L / 2 + u; out.z = r; out.yaw = Math.PI / 2; return out; }
  u -= L;
  if (u < Math.PI * r) { const a = u / r; out.x = L / 2 + r * Math.sin(a); out.z = r * Math.cos(a); out.yaw = Math.PI / 2 + a; return out; }
  u -= Math.PI * r;
  if (u < L) { out.x = L / 2 - u; out.z = -r; out.yaw = -Math.PI / 2; return out; }
  u -= L;
  const a = u / r;
  out.x = -L / 2 - r * Math.sin(a); out.z = -r * Math.cos(a); out.yaw = -Math.PI / 2 + a;
  return out;
}

/** Every race is run for a cup named after one of the judges. Names only. */
export const CUPS = [
  { name: 'The Polosukhin Cup', laps: 3 },
  { name: 'The Lazzarin Stakes', laps: 2 },
  { name: 'The Mumtaz Derby', laps: 3 },
  { name: "Garg's Lantern Sprint", laps: 1 },
  { name: 'The Warwick Purse', laps: 2 },
  { name: 'The Qureshi Classic', laps: 3 },
  { name: 'The Gershuni Gold', laps: 2 },
];

export const DT = 0.1; // one sim tick
const SPEED = 26; // units a second (about 14 m/s), a fair team on an average lane

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = (n: number) => Math.imul(n + 0x9e37, 0x85ebca6b) ^ 0xc2b2ae35;

export interface Runner {
  /** `lane` is where the team started; `ln` is where it is now (it can drift between lanes), `tl` where it is heading. */
  house: number; lane: number; ln: number; tl: number; prevLn: number; prevP: number; form: number;
  /** Held up by a team just ahead in the same lane, this tick. */
  blocked: boolean;
  /** A lane change the driver asked for that waits (up to 2 s) for the lane to clear. */
  want: 0 | -1 | 1; wantUntil: number;
  p: number; v: number; stamina: number; drift: number; whip: number;
  /** Seconds after the off when the team crossed the line. */
  finish?: number;
  /** Distance travelled in units along its own lane, for the wheels and the gait. */
  dist: number;
  /** `dist` at the previous tick: the scene draws between the two, so motion is smooth at any frame rate. */
  prev: number;
  pool: number;
}
export interface Whip { tick: number; house: number; by: 'you' | 'lord' }
/** A lane change asked for by the player driving a team: -1 is inward (to the left), +1 outward. */
export interface Move { tick: number; house: number; dir: -1 | 1 }
export interface Race {
  n: number; seed: number; cup: (typeof CUPS)[number];
  phase: 'parade' | 'run' | 'done';
  t: number; tick: number; runners: Runner[]; whips: Whip[]; moves: Move[];
  backed?: number; yourWhips: number; rand: () => number; doneAt?: number;
  /** The house whose chariot the player drives, if any: its lord neither steers nor whips. */
  driver?: number;
  /** A race the contract called: its clock is the chain's and it is settled there. */
  chain?: boolean;
}

/** Race n of the practice calendar, or (with `seed` and `laps`) a race the contract called. */
export function newRace(n: number, seed = seedOf(n) >>> 0, laps?: number): Race {
  const rand = rng(seed);
  const lanes = IDS.slice();
  for (let i = lanes.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [lanes[i], lanes[j]] = [lanes[j], lanes[i]]; }
  const runners: Runner[] = IDS.map((id) => ({
    house: id, lane: lanes.indexOf(id), ln: lanes.indexOf(id), tl: lanes.indexOf(id), prevLn: lanes.indexOf(id), prevP: 0, blocked: false, want: 0, wantUntil: 0,
    form: 0.95 + rand() * 0.1, p: 0, v: 0, stamina: 1, drift: 0, whip: 0, dist: 0, prev: 0, pool: Math.round(200 + rand() * 1600),
  }));
  const cup = laps === undefined ? CUPS[n % CUPS.length] : { ...CUPS[n % CUPS.length], laps };
  return { n, seed, cup, phase: 'parade', t: 0, tick: 0, runners, whips: [], moves: [], yourWhips: 3, rand };
}

/** How long a lap is for a team in lane `ln`, as the race counts it: the inside is shorter, though not by the full geometry. */
const lapLen = (ln: number) => MID * (1 + 0.25 * (laneLen(laneR(ln)) / MID - 1));
const BODY = 10; // units from the front of a team's horses to the back of its chariot, near enough
/** Is lane `l` clear beside `ru` (no team within a length either way)? */
function clear(r: Race, ru: Runner, l: number) {
  if (l < 0 || l > ARENA.lanes - 1) return false;
  for (const o of r.runners) if (o !== ru && Math.abs(o.ln - l) < 0.85 && Math.abs((o.p - ru.p) * MID) < BODY * 0.8) return false;
  return true;
}
/** The team right ahead of `ru` in its lane, within a length and a half, if any. */
function ahead(r: Race, ru: Runner) {
  let best: Runner | undefined, bg = BODY * 1.5;
  for (const o of r.runners) {
    if (o === ru || o.finish !== undefined || Math.abs(o.ln - ru.ln) > 0.7) continue;
    const g = (o.p - ru.p) * MID;
    if (g > 0 && g < bg) { bg = g; best = o; }
  }
  return best;
}

const THREE_CLAMP = (d: number, k: number) => Math.max(-k, Math.min(k, d));

/** One fixed tick of the race. */
export function tick(r: Race) {
  r.tick++;
  const t = (r.tick * DT);
  for (const w of r.whips) if (w.tick === r.tick) { const ru = r.runners[w.house]; ru.whip = 2.2; }
  for (const m of r.moves) if (m.tick === r.tick) { const ru = r.runners[m.house]; ru.want = m.dir; ru.wantUntil = r.tick + 20; }
  for (const ru of r.runners) if (ru.want) {
    const to = Math.round(ru.tl) + ru.want;
    if (to < 0 || to > ARENA.lanes - 1 || r.tick > ru.wantUntil) ru.want = 0;
    else if (clear(r, ru, to)) { ru.tl = to; ru.want = 0; }
  }
  const base = SPEED / MID;
  for (const ru of r.runners) {
    const left = r.cup.laps - ru.p;
    const lord = ru.house !== r.driver;
    // The lords crack their own whips, more often on the last lap.
    if (lord && ru.finish === undefined && ru.whip <= 0 && r.rand() < (left < 1 ? 0.02 : 0.004)) r.whips.push({ tick: r.tick + 1, house: ru.house, by: 'lord' });
    ru.drift = ru.drift * 0.97 + (r.rand() - 0.5) * 0.012;
    let target = base * ru.form * (1 + ru.drift);
    if (ru.whip > 0) { target *= 1.14; ru.stamina = Math.max(0, ru.stamina - 0.016); ru.whip -= DT; }
    else ru.stamina = Math.min(1, ru.stamina + 0.002);
    target *= 0.84 + 0.16 * ru.stamina;
    if (ru.finish !== undefined) target = base * 0.45; // the cool-down lap
    // Boxed in: a team just ahead in your lane sets your pace. A lord who is boxed in, or sees the rail open, changes lane.
    const front = ru.finish === undefined ? ahead(r, ru) : undefined;
    ru.blocked = !!front && front.v < target;
    if (front) target = Math.min(target, front.v * ((front.p - ru.p) * MID < BODY ? 0.97 : 1));
    if (lord && ru.finish === undefined && Math.abs(ru.ln - ru.tl) < 0.05) {
      const at = Math.round(ru.tl), roll = r.rand();
      if (ru.blocked && roll < 0.08) { const out = at + 1, inn = at - 1; ru.tl = clear(r, ru, out) ? out : clear(r, ru, inn) ? inn : at; }
      else if (!ru.blocked && roll < 0.025 && clear(r, ru, at - 1)) ru.tl = at - 1;
    }
    ru.v += (target - ru.v) * (ru.v < base * 0.5 ? 0.05 : 0.09);
    ru.prevLn = ru.ln;
    ru.ln += THREE_CLAMP(ru.tl - ru.ln, 0.16);
    const before = ru.p;
    ru.prevP = ru.p;
    ru.p += (ru.v * DT * MID) / lapLen(ru.ln);
    ru.prev = ru.dist;
    ru.dist += ru.v * DT * MID;
    if (ru.finish === undefined && ru.p >= r.cup.laps) ru.finish = t - ((ru.p - r.cup.laps) / (ru.p - before)) * DT;
  }
  if (r.runners.every((ru) => ru.finish !== undefined) && r.doneAt === undefined) { r.doneAt = t; r.phase = 'done'; }
}

/** Order by who is ahead: finishers by time, then the rest by distance. */
export function standings(r: Race) {
  return [...r.runners].sort((a, b) =>
    a.finish !== undefined && b.finish !== undefined ? a.finish - b.finish : a.finish !== undefined ? -1 : b.finish !== undefined ? 1 : b.p - a.p);
}
export const totalPool = (r: Race) => r.runners.reduce((s, ru) => s + ru.pool, 0);
/** Pari-mutuel odds: everything staked, less a 5% burn, shared by the backers of the winner. */
export const odds = (r: Race, ru: Runner) => (totalPool(r) * 0.95) / ru.pool;

