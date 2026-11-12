//! Hall games the chain can judge. Two halls are played from a seed the chain rolls when you enter, so the contract
//! can replay your round and decide the win itself instead of taking your word for it:
//!
//! - **The Vintner's Cups** (House Velmont, hall 2). Every shuffle comes from the seed. You send the cup (table slot)
//!   you lifted each round; the chain replays the shuffles and counts the rounds you got right, up to your first miss.
//!   Three of five wins.
//! - **Lantern Signals** (House Ashveil, hall 0). Every ship's lantern sequence comes from the seed. You send every lamp
//!   you answered, in order (`TOO_SLOW` where you ran out of time); the chain replays the ships and counts the ones you
//!   brought in. Six in before three wrecks wins.
//!
//! The browser runs the same generator (`web/src/games/seeded.ts`) to put on the same show. Change one, change the other.
//!
//! What the chain still can't see: how long you took. The seed is in the `enter` event, so a script that reads it can
//! answer perfectly; the check stops a forged "I won", not a bot.

/// The cups hall and the signals hall (house indexes).
pub const CUPS: u8 = 2;
pub const SIGNALS: u8 = 0;
pub fn judged(hall: u8) -> bool {
    hall == CUPS || hall == SIGNALS
}

/// mulberry32: a small 32-bit generator, the same in Rust and in the browser.
pub struct Rng(u32);
impl Rng {
    pub fn new(seed: u32) -> Self {
        Rng(seed)
    }
    pub fn next_u32(&mut self) -> u32 {
        self.0 = self.0.wrapping_add(0x6D2B_79F5);
        let a = self.0;
        let mut t = (a ^ (a >> 15)).wrapping_mul(a | 1);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61)) ^ t;
        t ^ (t >> 14)
    }
    /// A whole number below `n`, exactly `Math.floor(rand() * n)` in the browser.
    pub fn int(&mut self, n: u32) -> u32 {
        ((self.next_u32() as u64 * n as u64) >> 32) as u32
    }
    /// True with `pct` percent odds, exactly `rand() < pct / 100` in the browser.
    pub fn chance(&mut self, pct: u64) -> bool {
        (self.next_u32() as u64) * 100 < pct << 32
    }
}

// ---------- The Vintner's Cups ----------

pub const CUP_ROUNDS: u32 = 5;
pub const CUP_TO_WIN: u32 = 3;
/// Round `round` (from 1) shuffles this many times.
pub fn cup_swaps(round: u32) -> u32 {
    3 + round * 2
}
/// One shuffle: the cups at table slots `a` and `b` trade places, unless it's a feint (from round 4), which only looks
/// like one.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Swap {
    pub a: u8,
    pub b: u8,
    pub feint: bool,
}
pub fn cup_round(rng: &mut Rng, round: u32) -> Vec<Swap> {
    (0..cup_swaps(round))
        .map(|_| {
            let a = rng.int(3) as u8;
            let mut b = rng.int(2) as u8;
            if b >= a {
                b += 1;
            }
            let feint = round >= 4 && rng.chance(28);
            Swap { a, b, feint }
        })
        .collect()
}
/// Rounds cleared: the ram coin is under cup 1, which starts in slot 1; `picks[i]` is the slot lifted in round i+1.
pub fn judge_cups(seed: u32, picks: &[u8]) -> u32 {
    let mut rng = Rng::new(seed);
    let mut slot = [0u8, 1, 2]; // slot[cup] = the table position that cup is in
    let ram = 1usize;
    let mut cleared = 0;
    for round in 1..=CUP_ROUNDS {
        for w in cup_round(&mut rng, round) {
            if !w.feint {
                let ca = slot.iter().position(|&s| s == w.a).unwrap();
                let cb = slot.iter().position(|&s| s == w.b).unwrap();
                slot[ca] = w.b;
                slot[cb] = w.a;
            }
        }
        match picks.get(round as usize - 1) {
            Some(&p) if slot[ram] == p => cleared += 1,
            _ => break,
        }
    }
    cleared
}

// ---------- Lantern Signals ----------

pub const SIG_WIN: u32 = 6;
pub const SIG_MAX_SHIPS: u32 = 8;
pub const SIG_MAX_WRECKS: u32 = 3;
/// Sent in place of a lamp when the answer ran out of time.
pub const TOO_SLOW: u8 = 9;
/// How many flashes the next ship shows, once `saved` are in.
pub fn sig_len(saved: u32) -> usize {
    3 + (saved as usize * 3) / 4
}
pub fn sig_ship(rng: &mut Rng, saved: u32) -> Vec<u8> {
    (0..sig_len(saved)).map(|_| rng.int(4) as u8).collect()
}
/// (ships brought in, wrecks) from every lamp answered, in order. A wrong lamp (or TOO_SLOW) wrecks that ship and the
/// next lamp answers the next one.
pub fn judge_signals(seed: u32, lamps: &[u8]) -> (u32, u32) {
    let mut rng = Rng::new(seed);
    let (mut saved, mut wrecks) = (0, 0);
    let mut it = lamps.iter();
    'ships: while saved < SIG_MAX_SHIPS && wrecks < SIG_MAX_WRECKS {
        let seq = sig_ship(&mut rng, saved);
        for &want in &seq {
            match it.next() {
                Some(&got) if got == want => {}
                Some(_) => {
                    wrecks += 1;
                    continue 'ships;
                }
                None => break 'ships, // the round ended here (walked out): this ship never came in
            }
        }
        saved += 1;
    }
    (saved, wrecks)
}

/// The chain's verdict on a judged hall: (won, grade 0–100, score).
pub fn judge(hall: u8, seed: u32, play: &[u8]) -> (bool, u8, u32) {
    let (score, win, top) = if hall == CUPS {
        (judge_cups(seed, play), CUP_TO_WIN, CUP_ROUNDS)
    } else {
        (judge_signals(seed, play).0, SIG_WIN, SIG_MAX_SHIPS)
    };
    let won = score >= win;
    let grade = if won { ((score - win + 1) * 100 / (top - win + 1)) as u8 } else { 0 };
    (won, grade, score)
}

/// What a perfect player sends (tests): the cup with the ram each round, or (per `plan`) every ship answered right or
/// wrecked on its first lamp.
#[cfg(test)]
pub fn perfect(hall: u8, seed: u32) -> Vec<u8> {
    if hall == CUPS { cup_answers(seed) } else { sig_all(seed, &[true; 8]) }
}
#[cfg(test)]
pub fn cup_answers(seed: u32) -> Vec<u8> {
    let mut rng = Rng::new(seed);
    let mut slot = [0u8, 1, 2];
    (1..=CUP_ROUNDS)
        .map(|round| {
            for w in cup_round(&mut rng, round) {
                if !w.feint {
                    let ca = slot.iter().position(|&s| s == w.a).unwrap();
                    let cb = slot.iter().position(|&s| s == w.b).unwrap();
                    slot[ca] = w.b;
                    slot[cb] = w.a;
                }
            }
            slot[1]
        })
        .collect()
}
#[cfg(test)]
pub fn sig_all(seed: u32, plan: &[bool]) -> Vec<u8> {
    // plan[i]: answer ship i right (true) or wreck it on its first lamp (false).
    let mut rng = Rng::new(seed);
    let mut saved = 0;
    let mut out = vec![];
    for &ok in plan {
        let seq = sig_ship(&mut rng, saved);
        if ok {
            out.extend(&seq);
            saved += 1;
        } else {
            out.push(TOO_SLOW);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The same numbers the browser's generator prints for seed 1 (checked by `node web/src/games/seeded.check.mjs`).
    #[test]
    fn mulberry_matches_reference() {
        let mut r = Rng::new(1);
        let got: Vec<u32> = (0..3).map(|_| r.next_u32()).collect();
        assert_eq!(got, vec![2_693_262_067, 11_749_833, 2_265_367_787]);
    }

    #[test]
    fn cups_count_until_the_first_miss() {
        for seed in [7u32, 99, 123_456, u32::MAX] {
            let right = cup_answers(seed);
            assert_eq!(judge_cups(seed, &right), 5);
            assert_eq!(judge(CUPS, seed, &right), (true, 100, 5));
            let mut miss = right.clone();
            miss[3] = (miss[3] + 1) % 3;
            assert_eq!(judge_cups(seed, &miss), 3);
            assert!(judge(CUPS, seed, &miss).0);
            miss[1] = (miss[1] + 1) % 3;
            assert_eq!(judge_cups(seed, &miss), 1, "nothing after a miss counts");
            assert!(!judge(CUPS, seed, &miss).0);
            assert_eq!(judge_cups(seed, &[]), 0);
        }
    }

    #[test]
    fn signals_count_ships_and_wrecks() {
        for seed in [3u32, 4242, 0xdead_beef] {
            let all = sig_all(seed, &[true; 8]);
            assert_eq!(judge_signals(seed, &all), (8, 0));
            assert_eq!(judge(SIGNALS, seed, &all), (true, 100, 8));
            let six = sig_all(seed, &[true, false, true, true, false, true, true, true]);
            assert_eq!(judge_signals(seed, &six), (6, 2));
            assert_eq!(judge(SIGNALS, seed, &six).0, true);
            let sunk = sig_all(seed, &[true, false, false, false, true, true]);
            assert_eq!(judge_signals(seed, &sunk), (1, 3), "three wrecks end it; the rest is ignored");
            // A forged "all right" stream from a different seed brings in almost nothing.
            assert!(judge_signals(seed ^ 1, &all).0 < SIG_WIN);
        }
    }
}
