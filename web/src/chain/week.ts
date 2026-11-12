// Fast-forward: a week of trading in Vael in a minute, so you can watch the merchants work. It starts from the eight
// houses as they stand on chain now and runs the contract's own pricing rule (market.ts, which mirrors
// chain/src/market.rs) against simulated traders: loyalists who buy their own house and play its hall, momentum
// chasers who pile into a rush, bargain hunters who buy what's cheap, flippers who sell into a rush, the odd whale
// who rushes a house and later dumps it, and the four rivals, who buy back into their own house when a run shuts it.
// Nothing here touches the chain.
import { HOUSES } from '../realm/layout.ts';
import { breaks, demandNow, factor, FACTOR_ONE, reopens, sellFactor, type Stall } from './market.ts';
import type { ChainHouse } from './near.ts';
import type { Market } from './market.ts';

const ONE = 10n ** 24n;
const near = (x: number) => (BigInt(Math.round(x * 1e6)) * ONE) / 1_000_000n;
const toN = (x: bigint) => Number(x / 10n ** 15n) / 1e9;
export const WEEK = 7 * 24 * 3600;
const STEP = 300; // five minutes of realm time per step
const ENTRY = 400n * ONE;
const FEE_BPS = 500n, POOL_BPS = 200n;

export interface SimEvent { t: number; house: number; kind: 'shut' | 'reopen' | 'rush' | 'dump' | 'invest'; text: string }
interface House { reserve: bigint; supply: bigint; st: Stall; burned: bigint; rounds: number }
type Style = 'loyal' | 'momentum' | 'bargain' | 'flipper' | 'whale' | 'rival';
interface Trader { name: string; style: Style; house: number; purse: bigint; coins: bigint[]; plan?: { house: number; dumpAt: number } }

const RIVALS = [{ name: 'Ser Odo', house: 3 }, { name: 'Lady Isolde', house: 6 }, { name: 'Old Bram', house: 4 }, { name: 'Nell the Fox', house: 7 }];

/** A small seeded random source, so a replay with the same seed runs the same week. */
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

export class Week {
  t = 0;
  houses: House[];
  traders: Trader[] = [];
  /** Buy price relative to where it started, one sample per realm hour, per house. */
  series: number[][];
  /** Fair value (purse ÷ supply) relative to where it started, one sample per realm hour. */
  fair: number[][];
  /** Each house's purse (NEAR), one sample per realm hour. */
  purses: number[][];
  events: SimEvent[] = [];
  pool = 0n;
  trades = 0;
  private start: number[];
  private startFair: number[];
  private target = 0;
  private r: () => number;

  constructor(from: (ChainHouse & { market?: Market })[] | undefined, seed = 7) {
    this.r = rng(seed);
    this.houses = HOUSES.map((_, i) => {
      const x = from?.[i];
      const reserve = x ? BigInt(x.reserve) : near(0.35 + 0.02 * i);
      const supply = x ? BigInt(x.supply) : BigInt(220_000 + 40_000 * i) * ONE;
      const m = x?.market;
      return { reserve, supply, burned: 0n, rounds: 0,
        st: { demand: m ? BigInt(m.demand) : 0n, atSecs: 0, shut: !!m?.shut, peak: m ? BigInt(m.peak) : reserve } };
    });
    this.start = this.houses.map((h) => this.buyPrice(h));
    this.startFair = this.houses.map((h) => this.fairOf(h));
    this.series = this.houses.map(() => [1]);
    this.fair = this.houses.map(() => [1]);
    this.purses = this.houses.map((h) => [toN(h.reserve)]);
    const styles: Style[] = ['loyal', 'loyal', 'loyal', 'momentum', 'momentum', 'bargain', 'bargain', 'flipper'];
    for (let k = 0; k < 40; k++) {
      const style = styles[k % styles.length];
      this.traders.push({ name: `trader ${k + 1}`, style, house: Math.floor(this.r() * 8), purse: near(0.3 + this.r() * 0.6), coins: Array(8).fill(0n) });
    }
    for (let k = 0; k < 3; k++) this.traders.push({ name: `a whale`, style: 'whale', house: 0, purse: near(6), coins: Array(8).fill(0n) });
    for (const v of RIVALS) this.traders.push({ name: v.name, style: 'rival', house: v.house, purse: near(3), coins: Array(8).fill(0n) });
  }

  // ---------- The merchant, exactly as the contract prices ----------

  private fairOf(h: House) { return toN(h.reserve) / toN(h.supply); }
  buyPrice(h: House) { return (this.fairOf(h) * Number(factor(demandNow(h.st, this.t)))) / 10_000; }
  private touch(h: House) { h.st.demand = demandNow(h.st, this.t); h.st.atSecs = this.t; }

  private buy(tr: Trader, i: number, amount: bigint) {
    if (amount <= 0n || tr.purse < amount) return 0n;
    const h = this.houses[i];
    const d = demandNow(h.st, this.t);
    const fee = (amount * FEE_BPS) / 10_000n, toPool = (amount * POOL_BPS) / 10_000n, net = amount - fee;
    const got = (((net * h.supply) / h.reserve) * FACTOR_ONE) / factor(d);
    h.reserve += amount - toPool; h.supply += got; this.pool += toPool;
    tr.purse -= amount; tr.coins[i] += got;
    h.st.demand = d + net; h.st.atSecs = this.t;
    if (h.st.shut) {
      if (reopens(h.reserve, h.st.peak)) {
        h.st.shut = false; h.st.peak = h.reserve;
        this.note(i, 'reopen', `House ${HOUSES[i].name} reopens: buyers brought its purse back to ${toN(h.reserve).toFixed(3)} NEAR`);
      }
    } else if (h.reserve > h.st.peak) h.st.peak = h.reserve;
    this.trades++;
    return got;
  }

  private sell(tr: Trader, i: number, coins: bigint) {
    const h = this.houses[i];
    if (h.st.shut || coins <= 0n || coins > tr.coins[i]) return 0n;
    const d = demandNow(h.st, this.t);
    if (h.st.peak < h.reserve) h.st.peak = h.reserve;
    const gross = (((coins * h.reserve) / h.supply) * sellFactor(d)) / FACTOR_ONE;
    const fee = (gross * FEE_BPS) / 10_000n, toPool = (gross * POOL_BPS) / 10_000n, out = gross - fee;
    h.supply -= coins; h.reserve -= out + toPool; this.pool += toPool;
    tr.coins[i] -= coins; tr.purse += out;
    h.st.demand = d - gross; h.st.atSecs = this.t;
    if (breaks(h.reserve, h.st.peak)) {
      h.st.shut = true;
      this.note(i, 'shut', `A run on House ${HOUSES[i].name}: its purse fell to ${toN(h.reserve).toFixed(3)} NEAR, under 70% of its peak. The hall shuts`);
    }
    this.trades++;
    return out;
  }

  private play(tr: Trader, i: number) {
    const h = this.houses[i];
    if (h.st.shut || tr.coins[i] < ENTRY) return;
    tr.coins[i] -= ENTRY; h.supply -= ENTRY; h.burned += ENTRY; h.rounds++;
  }

  private note(house: number, kind: SimEvent['kind'], text: string) {
    this.events.push({ t: this.t, house, kind, text });
    if (this.events.length > 200) this.events.shift();
  }

  // ---------- The traders ----------

  private act(tr: Trader) {
    const r = this.r, H = this.houses;
    const f = H.map((h) => Number(factor(demandNow(h.st, this.t))));
    const open = (i: number) => !H[i].st.shut;
    const some = () => near(0.01 + r() * 0.05);
    // Short of NEAR? Cash in the biggest holding in an open house first.
    if (tr.style !== 'whale' && tr.style !== 'rival' && tr.purse < near(0.08)) {
      let k = -1;
      tr.coins.forEach((c, i) => { if (c > 0n && open(i) && (k < 0 || c * H[i].reserve / H[i].supply > tr.coins[k] * H[k].reserve / H[k].supply)) k = i; });
      if (k >= 0) { this.sell(tr, k, tr.coins[k] / 2n); return; }
    }
    switch (tr.style) {
      case 'loyal':
        if (tr.coins[tr.house] >= ENTRY && r() < 0.6) this.play(tr, tr.house);
        else this.buy(tr, tr.house, some());
        break;
      case 'momentum': {
        const hot = f.indexOf(Math.max(...f));
        if (f[hot] > 10_500 && open(hot)) this.buy(tr, hot, some());
        else { const k = tr.coins.findIndex((c, i) => c > 0n && f[i] < 9_800 && open(i)); if (k >= 0) this.sell(tr, k, tr.coins[k]); }
        break;
      }
      case 'bargain': {
        const cheap = f.indexOf(Math.min(...f));
        if (f[cheap] < 9_700 || H[cheap].st.shut) this.buy(tr, cheap, some());
        else if (tr.coins[tr.house] >= ENTRY && r() < 0.5) this.play(tr, tr.house);
        else this.buy(tr, tr.house, near(0.02));
        break;
      }
      case 'flipper': {
        const k = tr.coins.findIndex((c, i) => c > 0n && f[i] > 11_500 && open(i));
        if (k >= 0) this.sell(tr, k, tr.coins[k] / 2n);
        else this.buy(tr, Math.floor(r() * 8), some());
        break;
      }
      case 'whale':
        if (!tr.plan && r() < 0.06) {
          const i = Math.floor(r() * 8);
          if (open(i)) {
            // A rush the size of the house's whole purse, give or take.
            this.buy(tr, i, (H[i].reserve * BigInt(Math.round(800 + r() * 600))) / 1000n);
            tr.plan = { house: i, dumpAt: this.t + 3600 * (2 + r() * 20) };
            this.note(i, 'rush', `A whale rushes House ${HOUSES[i].name}: its coin jumps to ×${(Number(factor(demandNow(H[i].st, this.t))) / 10_000).toFixed(2)}`);
          }
        } else if (tr.plan && this.t >= tr.plan.dumpAt) {
          const i = tr.plan.house;
          if (open(i) && tr.coins[i] > 0n) { this.note(i, 'dump', `The whale dumps ${HOUSES[i].name}`); this.sell(tr, i, (tr.coins[i] * 19n) / 20n); }
          tr.plan = undefined;
        }
        break;
      case 'rival':
        if (H[tr.house].st.shut && tr.purse > near(0.6)) {
          this.buy(tr, tr.house, near(0.05));
          if (r() < 0.25) this.note(tr.house, 'invest', `${tr.name} buys back into House ${HOUSES[tr.house].name} to reopen it`);
        } else if (tr.coins[tr.house] >= ENTRY && r() < 0.3) this.play(tr, tr.house);
        else if (r() < 0.2) this.buy(tr, tr.house, near(0.03));
        break;
    }
  }

  /** Run the realm forward `secs` of realm time. */
  advance(secs: number) {
    // Time short of a whole step carries over to the next call, so small frames add up.
    this.target = Math.min(WEEK, this.target + secs);
    while (this.t + STEP <= this.target) {
      this.t += STEP;
      // Quieter at night: the realm's day runs from 06:00 to 24:00.
      const hour = (this.t / 3600) % 24, busy = hour < 6 ? 0.3 : 1;
      for (const tr of this.traders) {
        const p = tr.style === 'whale' ? 0.02 : tr.style === 'rival' ? 0.25 : 0.035;
        if (this.r() < p * busy) this.act(tr);
      }
      if (this.t % 3600 === 0) {
        this.houses.forEach((h, i) => { this.touch(h); this.series[i].push(this.buyPrice(h) / this.start[i]); this.fair[i].push(this.fairOf(h) / this.startFair[i]); this.purses[i].push(toN(h.reserve)); });
      }
    }
  }

  get done() { return this.t >= WEEK; }
  /** Where each house stands now: buy price vs the start, its factor, its purse, shut or not. */
  standing() {
    return this.houses.map((h, i) => ({ i, rel: this.buyPrice(h) / this.start[i], fair: this.fairOf(h) / this.startFair[i], factor: Number(factor(demandNow(h.st, this.t))) / 10_000,
      purse: toN(h.reserve), shut: h.st.shut, rounds: h.rounds, burned: toN(h.burned) }));
  }
}

/** "Day 3, 14:05" for a realm time in seconds. */
export const when = (t: number) => `Day ${Math.floor(t / 86400) + 1}, ${String(Math.floor((t % 86400) / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}`;
