// The merchants of Vael, as the contract prices them. This is chain/src/market.rs line for line, so the browser can
// say why a coin costs what it costs (and the fast-forward can run the same rule). Change one, change the other.
//
//   fair value   = reserve ÷ supply                      what one coin's share of the house's purse is worth
//   demand       = NEAR bought (+) and sold (−) lately     halves every 20 minutes
//   factor       = 1 + demand ÷ 1 NEAR, held to ×0.7–×1.5  a rush of buying makes it dear, a flood of selling cheap
//   buy price    = fair value × factor (+ the 5% fee)      what a buyer pays above fair value stays in the purse
//   sell price   = fair value × min(factor, 1) (− fee)     the merchant never pays above fair value
//   a run        = a sale drains the purse below 70% of its peak: the house is broke and shuts (no rounds, no
//                  buying back) until purchases bring the purse back to 85% of the peak
import type { ChainHouse } from './near.ts';

export const DEMAND_HALF_SECS = 20 * 60;
export const DEPTH = 10n ** 24n; // 1 NEAR of net demand moves the factor by ×1
export const FACTOR_ONE = 10_000n;
export const FACTOR_MIN = 7_000n;
export const FACTOR_MAX = 15_000n;
export const RUN_BPS = 7_000n;
export const REOPEN_BPS = 8_500n;
export const FEE = 0.05;

export interface Stall { demand: bigint; atSecs: number; shut: boolean; peak: bigint }

/** Demand as it stands `now` seconds: halved per whole half-life, eased down in a straight line within one. */
export function demandNow(s: Stall, nowSecs: number): bigint {
  const dt = Math.max(0, Math.floor(nowSecs - s.atSecs));
  const halves = Math.floor(dt / DEMAND_HALF_SECS);
  if (halves >= 100) return 0n;
  const rem = BigInt(dt % DEMAND_HALF_SECS), half = BigInt(DEMAND_HALF_SECS);
  let mag = (s.demand < 0n ? -s.demand : s.demand) >> BigInt(halves);
  mag = (mag * (2n * half - rem)) / (2n * half);
  return s.demand < 0n ? -mag : mag;
}
export function factor(demand: bigint): bigint {
  const f = FACTOR_ONE + (demand * FACTOR_ONE) / DEPTH;
  return f < FACTOR_MIN ? FACTOR_MIN : f > FACTOR_MAX ? FACTOR_MAX : f;
}
export const sellFactor = (demand: bigint) => (factor(demand) < FACTOR_ONE ? factor(demand) : FACTOR_ONE);
export const breaks = (reserve: bigint, peak: bigint) => (reserve / FACTOR_ONE) * FACTOR_ONE < (peak / FACTOR_ONE) * RUN_BPS;
export const reopens = (reserve: bigint, peak: bigint) => (reserve / FACTOR_ONE) * FACTOR_ONE >= (peak / FACTOR_ONE) * REOPEN_BPS;

// ---------- Reading a house as the contract reports it ----------

export interface Market { demand: string; factor: number; sell_factor: number; shut: boolean; peak: string }
const n24 = (s: string | bigint) => Number(BigInt(s) / 10n ** 15n) / 1e9;

export interface Quote {
  fair: number; buy: number; sell: number; factor: number; sellFactor: number; demand: number; shut: boolean;
  reserve: number; peak: number; runAt: number; reopenAt: number;
  /** Plain-language reasons, one line each, for the tooltip. */
  why: string[];
}

/** Everything the Mint shows about one house's price, and why. */
export function quote(h: ChainHouse & { market?: Market }): Quote {
  const reserve = n24(h.reserve), supply = n24(h.supply);
  const fair = reserve / supply;
  const m = h.market;
  const f = m ? m.factor / 10_000 : 1, sf = m ? m.sell_factor / 10_000 : 1;
  const demand = m ? n24(m.demand) : 0;
  const peak = m ? Math.max(n24(m.peak), reserve) : reserve;
  const shut = !!m?.shut;
  const fmtN = (x: number) => (x >= 0.01 ? x.toFixed(3) : x.toPrecision(3));
  const why = [
    `Fair value ${fmtN(fair)} NEAR: the purse (${reserve.toFixed(3)} NEAR) ÷ ${Math.round(supply).toLocaleString()} coins.`,
    Math.abs(demand) < 0.0005
      ? 'No rush either way lately, so the merchant asks fair value.'
      : demand > 0
        ? `${demand.toFixed(3)} NEAR net bought lately (it halves every 20 min): the merchant asks ×${f.toFixed(2)}${f >= 1.5 ? ', its highest' : ''}.`
        : `${(-demand).toFixed(3)} NEAR net sold lately (it halves every 20 min): the merchant takes ×${f.toFixed(2)}${f <= 0.7 ? ', its lowest' : ''}, cheap.`,
    sf < 1 ? `Selling pays ×${sf.toFixed(2)} too: a flood of coin lowers what it fetches.` : 'Selling pays fair value at most, so the purse always covers every holder.',
    shut
      ? `Shut: a run drained the purse under 70% of its ${peak.toFixed(3)} NEAR peak. Buying in reopens it at ${(peak * 0.85).toFixed(3)} NEAR.`
      : `A run shuts the house if selling drains the purse under ${(peak * 0.7).toFixed(3)} NEAR (70% of its peak).`,
    'A 5% fee on every trade: 3 points stay in the purse, 2 go to the crown pool.',
  ];
  return { fair, buy: fair * f, sell: shut ? 0 : fair * sf, factor: f, sellFactor: sf, demand, shut, reserve, peak, runAt: peak * 0.7, reopenAt: peak * 0.85, why };
}
