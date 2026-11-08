//! The season: the same rules as `sim/age.mjs`, in fixed point. The browser replays it from the logged seed.
use crate::*;
use near_sdk::serde_json::json;

/// Deterministic numbers from the season's seed: sha256(seed || counter), as a fraction of `U`.
pub struct Rng {
    seed: Vec<u8>,
    n: u32,
}

impl Rng {
    pub fn new(seed: Vec<u8>) -> Self {
        Self { seed, n: 0 }
    }
    /// A number in [0, U).
    pub fn next(&mut self) -> i128 {
        let mut b = self.seed.clone();
        b.extend_from_slice(&self.n.to_le_bytes());
        self.n += 1;
        let h = env::sha256(&b);
        let x = u64::from_le_bytes(h[0..8].try_into().unwrap());
        (x as u128 * U as u128 / (u64::MAX as u128 + 1)) as i128
    }
}

fn neighbours(seats: &[Option<u32>; SEATS], v: u8) -> [Option<u32>; 2] {
    [seats[(v as usize + 1) % SEATS], seats[(v as usize + SEATS - 1) % SEATS]]
}

fn defence(g: &House) -> i128 {
    let mut d = g.folk.army;
    if g.works.contains(&Work::Walls) {
        d = d * 3 / 2;
    }
    if g.stance == Stance::Fortify {
        d = d * 6 / 5;
    }
    d
}

#[near]
impl World {
    /// Turn the season. Anyone can call it once it is due.
    pub fn turn(&mut self) {
        require!(env::block_timestamp() >= self.next_turn_ns, "the season isn't over yet");
        let seed = env::random_seed();
        self.turn_with(seed);
    }
}

impl World {
    pub(crate) fn fresh_folk(&self, salt: u64) -> Folk {
        let mut seed = env::random_seed();
        seed.extend_from_slice(&salt.to_le_bytes());
        let mut r = Rng::new(seed);
        Folk {
            pop: 60 * U + r.next() * 30,
            food: 40 * U,
            land: 250 * U + r.next() * 100,
            morale: U * 70 / 100,
            fealty: U * 80 / 100,
            army: 0,
            sellswords: 0,
            weather: U,
        }
    }

    pub(crate) fn turn_with(&mut self, seed: Vec<u8>) {
        let mut rng = Rng::new(seed.clone());
        let n = self.houses.len() as usize;
        let mut houses: Vec<House> = (0..n).map(|i| self.houses.get(i as u32).unwrap().clone()).collect();
        let live: Vec<usize> = (0..n).filter(|&i| houses[i].alive).collect();
        let by_id = |houses: &Vec<House>, id: Option<u32>| id.filter(|&i| houses[i as usize].alive).map(|i| i as usize);

        // Weather, and a new season's decree prices.
        for &i in &live {
            houses[i].casts = [0; 8];
            houses[i].folk.weather = U * 85 / 100 + rng.next() * 30 / 100;
        }
        // The world moves: harvest, hunger, births and deaths, fealty, armies.
        for &i in &live {
            let granary = houses[i].works.contains(&Work::Granary);
            let shrine = houses[i].works.contains(&Work::Hall);
            let trade = houses[i].stance == Stance::Trade;
            let t = &mut houses[i].folk;
            let mut harvest = t.pop.min(t.land) * 102 / 100 * t.weather / U;
            if trade {
                harvest = harvest * 105 / 100;
            }
            t.food += harvest - t.pop;
            if t.food < 0 {
                t.pop += t.food * 40 / 100;
                t.food = 0;
                t.morale -= U * 4 / 100;
            } else {
                t.morale += U / 100;
            }
            t.food = t.food.min(t.pop * if granary { 3 } else { 2 });
            let fed = if t.food > t.pop * 30 / 100 { U } else { U / 5 };
            t.pop += t.pop * 18 / 1000 * t.morale / U * fed / U - t.pop * 8 / 1000;
            t.pop = t.pop.max(0);
            t.morale = t.morale.clamp(0, U);
            t.fealty = (t.fealty - if shrine { U * 2 / 1000 } else { U * 4 / 1000 }).max(U / 5);
            t.army = t.pop / 5 * if t.sellswords > 0 { 3 } else { 1 };
            t.sellswords = t.sellswords.saturating_sub(1);
        }
        // Missionaries: the happier, more devout folk converts its neighbours' unhappy people.
        for &i in &live {
            let v = houses[i].seat;
            let mut targets: Vec<usize> = neighbours(&self.seats, v).iter().filter_map(|x| by_id(&houses, *x)).collect();
            if let Some((mv, left)) = houses[i].envoy {
                if left > 0 {
                    if let Some(j) = by_id(&houses, self.seats[mv as usize]) {
                        if !targets.contains(&j) && j != i {
                            targets.push(j);
                        }
                    }
                }
            }
            for j in targets {
                let pull = houses[i].folk.morale * houses[i].folk.fealty / U - houses[j].folk.morale * houses[j].folk.fealty / U;
                if pull > U * 5 / 100 {
                    let mut c = houses[j].folk.pop * 3 / 100 * pull / U;
                    if houses[i].stance == Stance::Court {
                        c = c * 3 / 2;
                    }
                    if matches!(houses[i].envoy, Some((mv, l)) if l > 0 && Some(j as u32) == self.seats[mv as usize]) {
                        c *= 2;
                    }
                    houses[j].folk.pop -= c;
                    houses[i].folk.pop += c;
                    add_taken(&mut houses[i], j as u32, c);
                }
            }
            if let Some((mv, left)) = houses[i].envoy {
                houses[i].envoy = if left > 1 { Some((mv, left - 1)) } else { None };
            }
        }
        // Wars: a chief that is expanding attacks its weakest neighbour when clearly stronger.
        let mut wars = vec![];
        for &i in &live {
            if houses[i].stance != Stance::Conquer {
                continue;
            }
            let v = houses[i].seat;
            let target = neighbours(&self.seats, v)
                .iter()
                .filter_map(|x| by_id(&houses, *x))
                .filter(|&j| !houses[i].pacts.iter().any(|(o, u)| *o == j as u32 && *u > self.gseason))
                .min_by_key(|&j| defence(&houses[j]));
            let roll = rng.next();
            let Some(j) = target else { continue };
            let d = defence(&houses[j]);
            if houses[i].folk.army < d * 14 / 10 || roll > U * 15 / 100 || houses[i].folk.army == 0 {
                continue;
            }
            let win = rng.next() < houses[i].folk.army * U / (houses[i].folk.army + d);
            let (w, l) = if win { (i, j) } else { (j, i) };
            let lost = houses[l].folk.pop * 12 / 100;
            houses[l].folk.pop -= lost;
            houses[w].folk.pop += lost / 2;
            let ground = houses[l].folk.land * 8 / 100;
            houses[l].folk.land -= ground;
            houses[w].folk.land += ground;
            add_taken(&mut houses[w], l as u32, lost);
            houses[l].folk.morale = (houses[l].folk.morale - U / 10).max(0);
            houses[w].folk.morale = (houses[w].folk.morale + U * 5 / 100).min(U);
            wars.push(json!({"attacker": i, "defender": j, "winner": w, "people": lost}));
        }
        // Prayers: every house mints coins for its believers, to this age's devotees by fealty.
        for &i in &live {
            let g = &mut houses[i];
            let believers = g.folk.pop * g.folk.fealty / U;
            let mint = (believers.max(0) as u128) * self.rules.mint_per_believer as u128 * COIN / 1_000_000 / U as u128;
            if g.standing_total > 0 && mint > 0 {
                g.acc += mul_div(mint, COIN, g.standing_total);
                g.supply += mint;
                g.minted += mint;
            }
        }
        // Schisms that have the backing, then fades.
        let rebellions = self.run_rebellions(&mut houses);
        let mut fades = vec![];
        for i in 0..houses.len() {
            if houses[i].alive && houses[i].folk.pop < self.rules.fade_below as i128 * U {
                fades.push(i);
            }
        }
        for &i in &fades {
            let r = houses[i].reserve;
            let to_pool = r / 2;
            let heirs: Vec<(usize, i128)> = (0..houses.len())
                .filter(|&k| houses[k].alive && !fades.contains(&k))
                .filter_map(|k| houses[k].taken.iter().find(|(id, _)| *id == i as u32).map(|(_, c)| (k, *c)))
                .filter(|(_, c)| *c > 0)
                .collect();
            let sum: i128 = heirs.iter().map(|(_, c)| *c).sum();
            let mut paid = 0;
            for (k, c) in &heirs {
                let share = mul_div(r - to_pool, *c as u128, sum as u128);
                houses[*k].reserve += share;
                paid += share;
            }
            self.pool += r - paid;
            houses[i].reserve = 0;
            houses[i].alive = false;
            houses[i].faded_at = Some((self.age, self.season + 1));
            event("fade", json!({"house": i, "name": houses[i].name, "released": U128(r), "heirs": heirs.iter().map(|(k, _)| k).collect::<Vec<_>>()}));
        }

        self.season += 1;
        self.gseason += 1;
        self.last_seed = seed.clone();
        self.next_turn_ns = env::block_timestamp() + self.rules.season_secs * 1_000_000_000;
        let alive: Vec<usize> = (0..houses.len()).filter(|&i| houses[i].alive).collect();
        self.leader = alive.iter().max_by_key(|&&i| houses[i].folk.pop * houses[i].folk.fealty / U).map(|&i| i as u32);
        event(
            "turn",
            json!({"age": self.age, "season": self.season, "seed": hex_seed(&seed), "wars": wars, "rebellions": rebellions, "faded": fades, "leader": self.leader}),
        );

        // The crowning, and a new age.
        if self.season >= self.rules.seasons_per_age {
            let crowned = self.leader;
            let standing_total = crowned.map(|c| houses[c as usize].standing_total).unwrap_or(0);
            let pool = if standing_total > 0 { self.pool } else { 0 };
            self.ages.push(AgeResult { age: self.age, crowned, pool: U128(pool), standing_total: U128(standing_total), claimed: U128(0) });
            self.pool -= pool;
            event("crown", json!({"age": self.age, "house": crowned, "pool": U128(pool)}));
            for (i, g) in houses.iter_mut().enumerate() {
                g.acc_marks.push((self.age, g.acc));
                g.alms_marks.push((self.age, g.alms_acc));
                g.standing_total = 0;
                g.top.clear();
                g.taken.clear();
                if g.alive {
                    // Survivors carry into the next age with a fresh folk in the same seat.
                    let mut t = self.fresh_folk(i as u64 + 1000 * self.age as u64);
                    t.fealty = U * 80 / 100;
                    g.folk = t;
                    g.bounty_on = None;
                }
            }
            self.age += 1;
            self.season = 0;
            self.rebellions.clear();
        }
        for (i, g) in houses.into_iter().enumerate() {
            self.houses.replace(i as u32, g);
        }
    }

    /// Carry out rebellions whose backers hold the needed share of the elders' fealty and that have a
    /// free seat. Expired ones are dropped.
    fn run_rebellions(&mut self, houses: &mut Vec<House>) -> Vec<near_sdk::serde_json::Value> {
        let mut done = vec![];
        let open = std::mem::take(&mut self.rebellions);
        for s in open {
            let gi = s.house as usize;
            if !houses[gi].alive || self.gseason >= s.opened + self.rules.rebellion_window as u64 {
                continue;
            }
            let elders = self.elders_of(&houses[gi]);
            let standing_of = |a: &AccountId| houses[gi].top.iter().find(|(b, _)| b == a).map(|(_, d)| *d).unwrap_or(0);
            let elders_standing: u128 = elders.iter().map(standing_of).sum();
            let backers: Vec<AccountId> = s.backers.iter().filter(|b| elders.contains(b)).cloned().collect();
            let back_standing: u128 = backers.iter().map(standing_of).sum();
            let free = (0..SEATS as u8)
                .map(|k| ((houses[gi].seat as usize + k as usize) % SEATS) as u8)
                .find(|&v| match self.seats[v as usize] { None => true, Some(id) => !houses[id as usize].alive });
            if elders_standing == 0 || back_standing * 100 < elders_standing * self.rules.rebellion_pct as u128 || free.is_none() {
                self.rebellions.push(s);
                continue;
            }
            let seat = free.unwrap();
            let share_u = (back_standing * U as u128 / elders_standing) as i128;
            // The schismatics take the NEAR behind their own coins, so the price for those who stay doesn't move.
            let new_id = houses.len() as u32;
            let mut coins = 0u128;
            let mut moved = vec![];
            for b in &backers {
                let mut h = self.holding(s.house, b);
                let mut g = houses[gi].clone();
                self.settle_into(&mut g, &mut h);
                houses[gi] = g;
                coins += h.coins;
                moved.push((b.clone(), h));
            }
            if coins == 0 {
                continue;
            }
            let backing = mul_div(coins, houses[gi].reserve, houses[gi].supply);
            let old = &mut houses[gi];
            old.reserve -= backing;
            old.supply -= coins;
            let mut t = old.folk.clone();
            t.pop = old.folk.pop * share_u / U;
            t.food = old.folk.food * share_u / U;
            t.land = 220 * U;
            t.morale = U * 80 / 100;
            t.sellswords = 0;
            old.folk.pop -= t.pop;
            old.folk.food -= t.food;
            let council = mul_div(old.council_due, share_u as u128, U as u128);
            old.council_due -= council;
            let mut ng = new_house(new_id, s.name.clone(), seat, backers[0].clone(), self.age, t);
            ng.reserve = backing;
            ng.supply = coins;
            ng.council_due = council;
            ng.acc_marks = vec![];
            for (b, mut h) in moved {
                let standing = h.standing;
                let nh = Holding { coins: h.coins, standing, standing_age: self.age, idle_base: self.gseason, faded_to: self.gseason, ..Default::default() };
                ng.standing_total += standing;
                rank(&mut ng.top, &b, standing);
                houses[gi].standing_total -= standing.min(houses[gi].standing_total);
                houses[gi].top.retain(|(a, _)| a != &b);
                h.coins = 0;
                h.standing = 0;
                self.holdings.insert((s.house, b.clone()), h);
                self.holdings.insert((new_id, b), nh);
            }
            houses.push(ng.clone());
            self.houses.push(ng);
            self.seats[seat as usize] = Some(new_id);
            done.push(json!({"from": s.house, "house": new_id, "name": s.name, "seat": seat, "share": share_u, "coins": U128(coins), "near": U128(backing)}));
        }
        done
    }

    fn settle_into(&self, g: &mut House, h: &mut Holding) {
        self.settle_pub(g, h);
    }
}

fn add_taken(g: &mut House, from: u32, c: i128) {
    if let Some(e) = g.taken.iter_mut().find(|(id, _)| *id == from) {
        e.1 += c;
    } else {
        g.taken.push((from, c));
    }
}

fn hex_seed(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}
