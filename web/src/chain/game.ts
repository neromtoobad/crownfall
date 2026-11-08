// What the game asks of the purse, on chain when a wallet is connected and on the practice purse otherwise.
import { HOUSES } from '../realm/layout.ts';
import { buy as practiceBuy, fmt, ledger, note, priceAt, sell as practiceSell } from '../realm/ledger.ts';
import { chain, keyCall, onChain, priceOf, units, walletCall, yocto } from './near.ts';

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

/** A hall round's entry on chain: the coin is burned and a round opened. The Library is staked through the wallet. */
export async function enterHall(hall: number, library: boolean): Promise<number> {
  return library
    ? Number(await walletCall<number>('Staking 1 NEAR at Haseeb’s table', 'stake', {}, 1))
    : Number(await keyCall<number>(`Burning the entry: ${fmt(units(chain.realm?.houses[hall]?.entry ?? '0'))} $${HOUSES[hall].coin}`, 'enter', { house: hall }));
}

export async function finishHall(round: number, won: boolean, grade: number) {
  return keyCall('Recording the round', 'finish', { round, won, grade: Math.round(Math.max(0, Math.min(1, grade)) * 100) }, true);
}

/** Take a Warden's seal on chain (the contract checks what it can see; a seal it refuses stays a practice seal). */
export async function takeSeal(i: number) {
  if (!onChain()) return false;
  try { await keyCall('Sealing it on NEAR', 'seal', { seal: i }, true); return true; } catch { return false; }
}
