//! The chariot race, line for line the same as `web/src/realm/race.ts` (`newRace` + `tick`, with no player driving).
//!
//! A race is a pure function of its seed, its lap count and the whips cracked during it. Both sides use IEEE-754
//! doubles with the same operations in the same order, and the same 32-bit generator, so the browser's replay and the
//! contract's result agree to the bit. `tests::sim_matches_js` checks that against a fixture written by the web code.

use std::f64::consts::PI;

pub const LANES: usize = 8;
const L: f64 = 120.0;
const INNER: f64 = 9.0;
const GAP: f64 = 5.3;
pub const DT: f64 = 0.1;
const SPEED: f64 = 26.0;
const BODY: f64 = 10.0;
/** No race runs longer than this (about 3 minutes); a team that hasn't finished by then is placed by distance. */
pub const MAX_TICKS: u32 = 1800;

fn lane_r(lane: f64) -> f64 {
    INNER + lane * GAP
}
fn lane_len(r: f64) -> f64 {
    2.0 * L + 2.0 * PI * r
}
fn mid() -> f64 {
    lane_len(lane_r(3.5))
}
fn lap_len(ln: f64) -> f64 {
    let m = mid();
    m * (1.0 + 0.25 * (lane_len(lane_r(ln)) / m - 1.0))
}

/// The same generator as `rng` in race.ts (a mulberry32).
pub struct Rng(u32);
impl Rng {
    pub fn new(seed: u32) -> Self {
        Rng(seed)
    }
    pub fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
}

#[derive(Clone, Debug)]
struct Runner {
    lane: usize,
    ln: f64,
    tl: f64,
    form: f64,
    p: f64,
    v: f64,
    stamina: f64,
    drift: f64,
    whip: f64,
    finish: Option<f64>,
}

/// One whip: from tick `tick` on, team `house` runs 14% faster for 2.2 s and tires.
#[derive(Clone, Copy, Debug)]
pub struct Whip {
    pub tick: u32,
    pub house: u8,
}

pub struct Outcome {
    /// Houses from first to last.
    pub order: Vec<u8>,
    /// Seconds after the off when each house crossed the line (by house; none if it never did).
    pub finish: Vec<Option<f64>>,
    /// The lane each house started in.
    pub lanes: Vec<u8>,
    pub ticks: u32,
}

/// Run a race to the end: every team over the line, or `MAX_TICKS`.
pub fn run(seed: u32, laps: u8, whips: &[Whip]) -> Outcome {
    let mut rand = Rng::new(seed);
    let mut lanes: Vec<usize> = (0..LANES).collect();
    for i in (1..LANES).rev() {
        let j = (rand.next() * (i as f64 + 1.0)).floor() as usize;
        lanes.swap(i, j);
    }
    let mut rs: Vec<Runner> = (0..LANES)
        .map(|h| {
            let lane = lanes.iter().position(|&x| x == h).unwrap();
            let form = 0.95 + rand.next() * 0.1;
            let _pool = rand.next(); // race.ts draws a practice pool here: keep the stream in step
            Runner { lane, ln: lane as f64, tl: lane as f64, form, p: 0.0, v: 0.0, stamina: 1.0, drift: 0.0, whip: 0.0, finish: None }
        })
        .collect();
    let mut wh: Vec<Whip> = whips.to_vec();
    let laps_f = laps as f64;
    let m = mid();
    let base = SPEED / m;
    let mut tick: u32 = 0;
    while tick < MAX_TICKS && rs.iter().any(|r| r.finish.is_none()) {
        tick += 1;
        let t = tick as f64 * DT;
        for w in wh.iter() {
            if w.tick == tick {
                rs[w.house as usize].whip = 2.2;
            }
        }
        for i in 0..LANES {
            let left = laps_f - rs[i].p;
            if rs[i].finish.is_none() && rs[i].whip <= 0.0 && rand.next() < (if left < 1.0 { 0.02 } else { 0.004 }) {
                wh.push(Whip { tick: tick + 1, house: i as u8 });
            }
            let ru = &mut rs[i];
            ru.drift = ru.drift * 0.97 + (rand.next() - 0.5) * 0.012;
            let mut target = base * ru.form * (1.0 + ru.drift);
            if ru.whip > 0.0 {
                target *= 1.14;
                ru.stamina = f64::max(0.0, ru.stamina - 0.016);
                ru.whip -= DT;
            } else {
                ru.stamina = f64::min(1.0, ru.stamina + 0.002);
            }
            target *= 0.84 + 0.16 * ru.stamina;
            if ru.finish.is_some() {
                target = base * 0.45;
            }
            let front = if rs[i].finish.is_none() { ahead(&rs, i, m) } else { None };
            let blocked = match front {
                Some(f) => rs[f].v < target,
                None => false,
            };
            if let Some(f) = front {
                let k = if (rs[f].p - rs[i].p) * m < BODY { 0.97 } else { 1.0 };
                target = f64::min(target, rs[f].v * k);
            }
            if rs[i].finish.is_none() && (rs[i].ln - rs[i].tl).abs() < 0.05 {
                let at = rs[i].tl.round();
                let roll = rand.next();
                if blocked && roll < 0.08 {
                    let (out, inn) = (at + 1.0, at - 1.0);
                    rs[i].tl = if clear(&rs, i, out, m) { out } else if clear(&rs, i, inn, m) { inn } else { at };
                } else if !blocked && roll < 0.025 && clear(&rs, i, at - 1.0, m) {
                    rs[i].tl = at - 1.0;
                }
            }
            let ru = &mut rs[i];
            ru.v += (target - ru.v) * (if ru.v < base * 0.5 { 0.05 } else { 0.09 });
            let d = ru.tl - ru.ln;
            ru.ln += f64::max(-0.16, f64::min(0.16, d));
            let before = ru.p;
            ru.p += (ru.v * DT * m) / lap_len(ru.ln);
            if ru.finish.is_none() && ru.p >= laps_f {
                ru.finish = Some(t - ((ru.p - laps_f) / (ru.p - before)) * DT);
            }
        }
    }
    let mut order: Vec<usize> = (0..LANES).collect();
    order.sort_by(|&a, &b| {
        let (ra, rb) = (&rs[a], &rs[b]);
        match (ra.finish, rb.finish) {
            (Some(x), Some(y)) => x.partial_cmp(&y).unwrap(),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => rb.p.partial_cmp(&ra.p).unwrap(),
        }
    });
    Outcome {
        order: order.iter().map(|&h| h as u8).collect(),
        finish: rs.iter().map(|r| r.finish).collect(),
        lanes: rs.iter().map(|r| r.lane as u8).collect(),
        ticks: tick,
    }
}

/// The team right ahead of runner `i` in its lane, within a length and a half.
fn ahead(rs: &[Runner], i: usize, m: f64) -> Option<usize> {
    let mut best = None;
    let mut bg = BODY * 1.5;
    for (j, o) in rs.iter().enumerate() {
        if j == i || o.finish.is_some() || (o.ln - rs[i].ln).abs() > 0.7 {
            continue;
        }
        let g = (o.p - rs[i].p) * m;
        if g > 0.0 && g < bg {
            bg = g;
            best = Some(j);
        }
    }
    best
}

/// Is lane `l` clear beside runner `i`?
fn clear(rs: &[Runner], i: usize, l: f64, m: f64) -> bool {
    if l < 0.0 || l > (LANES - 1) as f64 {
        return false;
    }
    for (j, o) in rs.iter().enumerate() {
        if j != i && (o.ln - l).abs() < 0.85 && ((o.p - rs[i].p) * m).abs() < BODY * 0.8 {
            return false;
        }
    }
    true
}
