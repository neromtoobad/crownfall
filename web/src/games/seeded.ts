// The halls the chain judges (the Vintner's Cups, Lantern Signals) are played from a seed the contract rolls at `enter`.
// This is the same generator as chain/src/halls.rs, so the browser shows the shuffles and the ships the contract will
// replay at `finish`. Change one, change the other. Off chain (practice) the seed is just random.

/** mulberry32. `int(n)` and `chance(pct)` are exact integer maths, so they agree with Rust to the last bit. */
export class Rng {
  private a: number;
  constructor(seed: number) { this.a = seed >>> 0; }
  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    const a = this.a;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }
  /** A whole number below n (n ≤ 2^21 keeps it exact). */
  int(n: number): number { return Math.floor((this.next() * n) / 4294967296); }
  /** True with pct percent odds. */
  chance(pct: number): boolean { return this.next() * 100 < pct * 4294967296; }
}

/** Sent in place of a lamp when the answer ran out of time (halls.rs TOO_SLOW). */
export const TOO_SLOW = 9;

/** The round's seed and what the player did, for the contract to replay. */
export const hallPlay = {
  seed: undefined as number | undefined,
  moves: [] as number[],
};
/** A generator for the round about to start: the chain's seed on NEAR, a random one in practice. */
export function roundRng(): Rng {
  hallPlay.moves = [];
  return new Rng(hallPlay.seed ?? Math.floor(Math.random() * 4294967296));
}
