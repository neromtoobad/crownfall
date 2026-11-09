// The rivals: four agent players with their own testnet wallets (agents/rivals.mjs). Their bets, whips and burns are
// ordinary transactions on the contract; their reasons come from the rivals' feed, polled here while the race card
// is open. If the feed can't be reached the card simply shows no rivals.
import { useSyncExternalStore } from 'react';

export const RIVALS_URL = (import.meta.env.VITE_RIVALS as string | undefined) ?? 'https://crownfall-rivals-production.up.railway.app';

export interface Rival { id: string; account: string; name: string; house: number; style: string; purse?: number; races: number; won: number; net: number }
export interface RivalEvent { t: number; who?: string; kind: string; race?: number; house?: number | null; near?: number; why?: string; by?: 'model' | 'rule'; tx?: string; tick?: number }
export interface Feed { contract: string; model: string | null; rivals: Rival[]; events: RivalEvent[] }

const store = { feed: undefined as Feed | undefined, v: 0 };
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined, users = 0;

async function pull() {
  try {
    const r = await fetch(`${RIVALS_URL}/feed`, { signal: AbortSignal.timeout(6000) });
    if (r.ok) { store.feed = await r.json(); store.v++; subs.forEach((f) => f()); }
  } catch { /* the feed is optional */ }
}

/** The rivals' feed, polled every 4 s while any component uses it. */
export function useRivals(): Feed | undefined {
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      if (users++ === 0) { void pull(); timer = setInterval(pull, 4000); }
      return () => { subs.delete(f); if (--users === 0 && timer) { clearInterval(timer); timer = undefined; } };
    },
    () => store.v,
  );
  return store.feed;
}

export const rivalOf = (feed: Feed | undefined, id?: string) => feed?.rivals.find((r) => r.id === id);
