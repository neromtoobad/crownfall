// What the game asks of the purse, on chain when a wallet is connected and on the practice purse otherwise.
import { HOUSES } from '../realm/layout.ts';
import { buy as practiceBuy, fmt, ledger, note, priceAt, sell as practiceSell } from '../realm/ledger.ts';
import { chain, keyCall, onChain, priceOf, units, view, walletCall, yocto } from './near.ts';

export const held = (h: number) => (onChain() ? units(chain.me?.houses[h]?.coins) : ledger.held[h]);
export const price = (h: number) => {
  const x = chain.realm?.houses[h];
  return onChain() && x ? priceOf(x) : priceAt(ledger.supply[h]);
};
export const supply = (h: number) => (onChain() && chain.realm ? units(chain.realm.houses[h].supply) : ledger.supply[h]);
export const burned = (h: number) => (chain.realm ? units(chain.realm.houses[h].burned) : 0);
export const favour = (h: number) => (onChain() ? units(chain.me?.houses[h]?.favour) : ledger.favour[h] ?? 0);

/** Buy house coin. On chain the wallet asks; resolves to the coins minted (0 if it didn't happen). */
export async function buyCoin(h: number, near: number): Promise<number> {
  if (!onChain()) return practiceBuy(h, near);
  try {
    const got = await walletCall<string>(`Buying $${HOUSES[h].coin} with ${near} NEAR`, 'buy', { house: h }, near);
    note(`Bought ${fmt(units(got))} $${HOUSES[h].coin} for ${near} NEAR at the Warwick Mint, on NEAR.`, h);
    return units(got);
  } catch { return 0; }
}

export async function sellCoin(h: number, q: number): Promise<number> {
  if (!onChain()) return practiceSell(h, q);
  try {
    await keyCall(`Selling ${fmt(q)} $${HOUSES[h].coin}`, 'sell', { house: h, amount: yocto(q).toString() });
    note(`Sold ${fmt(q)} $${HOUSES[h].coin} at the Warwick Mint, on NEAR.`, h);
    return q;
  } catch { return 0; }
}

/** NEAR put on Haseeb's table for one wager on chain. */
export const LIB_STAKE = 0.1;
/** The Gate's toll: its trial is a drive the chain can't see, so its seal is paid for (it goes to the crown pool). */
export const GATE_TOLL = 0.01;

/** A hall round's entry on chain: the coin is burned and a round opened. The Library is staked through the wallet. */
export async function enterHall(hall: number, library: boolean): Promise<number> {
  return library
    ? Number(await walletCall<number>(`Staking ${LIB_STAKE} NEAR at Haseeb’s table`, 'stake', {}, LIB_STAKE))
    : Number(await keyCall<number>(`Burning the entry: ${fmt(units(chain.realm?.houses[hall]?.entry ?? '0'))} $${HOUSES[hall].coin}`, 'enter', { house: hall }));
}

export async function finishHall(round: number, won: boolean, grade: number) {
  return keyCall('Recording the round', 'finish', { round, won, grade: Math.round(Math.max(0, Math.min(1, grade)) * 100) }, true);
}

// ---------- Qureshi's Library: a wager the contract settles ----------

export interface Library { bank: string; min: string; max: string; edge_bps: number; odds: number[]; of: number; cup: { mine: number[]; height: number } | null }
export interface LibResult { round: number; won: boolean; bid?: [number, number]; mine?: number[]; his?: number[]; shown?: number; paid?: string; refunded?: string }
/** The Library's bank and odds, and (with a round) your five dice, rolled on chain when you staked. */
export const library = (round?: number) => view<Library>('get_library', { round: round ?? null });
/** What a true bid pays back in all, in NEAR, when Haseeb's cup must show `need` more of the face (0 if none). */
export const libPays = (lib: Library, stake: number, need: number) =>
  need < 1 || need > 5 ? 0 : (stake * lib.of / lib.odds[need - 1]) * (1 - lib.edge_bps / 10_000);
/** The chance a bid needing `need` more from Haseeb's five dice is true. */
export const libChance = (lib: Library, need: number) => (need < 1 ? 1 : need > 5 ? 0 : lib.odds[need - 1] / lib.of);
/** Bid on the table: the contract rolls Haseeb's dice from this block and pays a true bid. */
export const bidLibrary = (round: number, count: number, face: number) =>
  keyCall<LibResult>('Haseeb lifts his cup', 'finish', { round, won: false, bid: [count, face] });

/** Take a Warden's seal on chain (the contract checks what it can see; a seal it refuses stays a practice seal). The
 *  Gate's seal takes its toll through the wallet. */
export async function takeSeal(i: number) {
  if (!onChain()) return false;
  try {
    if (i === 0) await walletCall(`Paying the Gate’s toll: ${GATE_TOLL} NEAR`, 'seal', { seal: 0 }, GATE_TOLL);
    else await keyCall('Sealing it on NEAR', 'seal', { seal: i }, true);
    return true;
  } catch { return false; }
}

// ---------- The Ashen Throne: seasons ----------

export interface Crown { season: number; crowned: number | null; pool: string; favour: string; mine: string; share: string; claimed: boolean; ended_ns: string }
/** What a finished season paid out, and what's yours (null while the season is still running). */
export const crownOf = (season: number, account: string) => view<Crown | null>('get_crown', { season, account });

/** End the season once it's due: the house with the most favour takes the throne. Anyone can call it. */
export async function endSeason(): Promise<number | null> {
  const h = await keyCall<number | null>('Crowning the house with the most favour', 'end_season', {});
  note(h === null || h === undefined ? 'The season ended with no favour earned: nobody was crowned.' : `House ${HOUSES[h].name} took the Ashen Throne, on NEAR.`, h ?? undefined);
  return h ?? null;
}

/** Take your share of a crowned season's pool (sent to your account as NEAR). */
export async function claimCrown(season: number, near: number) {
  await keyCall(`Taking your share of the crown pool: ${near.toFixed(4)} NEAR`, 'claim_crown', { season });
  note(`Took ${near.toFixed(4)} NEAR from the crown pool of season ${season}, on NEAR.`);
}
