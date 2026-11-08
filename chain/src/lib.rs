//! Crownfall on NEAR: the realm of Vael's ledger.
//!
//! - **Eight houses, eight coins.** Each coin's price is its house's NEAR reserve divided by its supply. Buying adds
//!   NEAR and mints coin at that price; selling burns coin and pays NEAR back, so a house never owes more than it holds.
//!   A 5% fee on every trade: 3 points stay in the reserve (the price rises for holders), 2 go to the crown pool.
//! - **Play to burn.** Every round of a hall game burns the house's coin (`enter`). Burning shrinks supply against the
//!   same reserve, so every round played raises the price for everyone who holds that house. Burns earn favour; a won
//!   round earns more (`finish`).
//! - **The Library.** Liar's Dice against Haseeb Qureshi is staked in NEAR. Your first win pays the stake back doubled
//!   (the bonus from the crown pool, while it lasts); later wins pay the stake back. A lost stake goes to the crown pool.
//! - **The Seven Wardens' seals** are kept per account. Bridge, Lighthouse and Library need a won round of that hall's
//!   game recorded here; the Throne needs the other six and wins in three halls.
//! - **The Mumtaz Hippodrome.** Races are seeded from the block, bet on in NEAR (pari-mutuel), and whipped by burning
//!   coin. `settle` runs the race itself in the contract (`sim.rs`, the same code the browser draws), so the result is
//!   the chain's, not a server's.
//! - **The Ashen Throne.** When a season ends the house with the most favour is crowned, and the crown pool goes to
//!   that house's players in proportion to their favour.
//!
//! What is NOT proven here: a hall round's result is reported by the player's own client (`finish`). A false win can
//! only add favour on top of coin the player really burned, and can't take NEAR out. Race results and every payout
//! are computed on chain.
//!
//! Amounts: NEAR in yoctoNEAR, coin in yocto-coin (24 decimals, ready for NEP-141).

use near_sdk::json_types::U128;
use near_sdk::serde_json::{json, Value};
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise};

pub mod sim;
#[cfg(test)]
mod tests;

pub const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
pub const COIN: u128 = 1_000_000_000_000_000_000_000_000;
pub const HOUSES: usize = 8;
/// The Library is hall 8: it has no coin.
pub const LIBRARY: u8 = 8;
const FEE_BPS: u128 = 500;
const FEE_POOL_BPS: u128 = 200;
/// Coin burned for one whip at the Hippodrome.
pub const WHIP_COINS: u128 = 200 * COIN;
pub const WHIPS_PER_RACE: u8 = 3;
/// Betting is open this long after a race is called, then the teams are off.
pub const BET_SECS: u64 = 90;
/// Whips count only in the first part of the run (no race is shorter than this).
pub const WHIP_SECS: u64 = 40;
/// A round must be finished within the hour, or it counts as lost.
const ROUND_SECS: u64 = 3600;

pub const NAMES: [&str; HOUSES] = ["Ashveil", "Corrin", "Velmont", "Thorne", "Halloway", "Draven", "Marrow", "Sorrel"];
pub const TICKERS: [&str; HOUSES] = ["HERON", "BOAR", "RAM", "ASP", "OWL", "BULL", "LYNX", "HAWK"];
pub const GAMES: [&str; 9] = ["signals", "axes", "cups", "asp", "archery", "forge", "stones", "falcon", "dice"];
/// Coin burned for one round in each house's hall.
pub const ENTRY: [u128; HOUSES] = [400 * COIN, 400 * COIN, 400 * COIN, 400 * COIN, 400 * COIN, 400 * COIN, 500 * COIN, 400 * COIN];
/// NEAR staked on one game in the Library.
pub const LIBRARY_STAKE: u128 = NEAR;
pub const SEALS: [&str; 7] = ["Gate", "Mint", "Bridge", "Lighthouse", "Library", "Hippodrome", "Throne"];
/// Laps per cup, as race.ts names them: race n is run for cup n % 7.
pub const CUP_LAPS: [u8; 7] = [3, 2, 3, 1, 2, 3, 2];

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Holdings,
    Players,
    Rounds,
    Races,
    Bets,
    Seasons,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct House {
    pub reserve: u128,
    pub supply: u128,
    pub burned: u128,
    pub rounds: u64,
    /// Favour earned for this house in `fav_season`.
    pub favour: u128,
    pub fav_season: u32,
}

#[near(serializers = [borsh])]
#[derive(Clone, Default)]
pub struct Holding {
    pub coins: u128,
    pub favour: u128,
    pub fav_season: u32,
    /// The season before, kept so a crowned house's players can still claim after the season turns.
    pub prev_favour: u128,
    pub prev_season: u32,
    pub claimed_season: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Default)]
pub struct Player {
    /// Bit i set: the seal SEALS[i] is yours.
    pub seals: u8,
    /// Bit h set: you have won a round in hall h (8 is the Library).
    pub halls_won: u16,
    pub plays: u32,
    pub wins: u32,
    pub bought: bool,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Round {
    pub who: AccountId,
    pub hall: u8,
    /// Coin burned, or (in the Library) NEAR staked.
    pub amount: u128,
    pub at_ns: u64,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Race {
    pub n: u32,
    pub seed: u32,
    pub laps: u8,
    pub called_ns: u64,
    pub off_ns: u64,
    pub pools: [u128; HOUSES],
    pub whips: Vec<(u32, u8)>,
    pub settled: bool,
    pub order: Vec<u8>,
    /// Finish times in milliseconds after the off (0 if a team never finished).
    pub finish_ms: Vec<u32>,
    /// What the winners share (the pools less the 5% that goes to the crown).
    pub payout: u128,
}

#[near(serializers = [borsh])]
#[derive(Clone, Default)]
pub struct Ticket {
    pub bets: [u128; HOUSES],
    pub whips: u8,
    pub claimed: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Season {
    pub n: u32,
    pub crowned: Option<u8>,
    pub pool: U128,
    pub favour: U128,
    pub claimed: U128,
    pub ended_ns: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Realm {
    pub owner: AccountId,
    pub houses: Vec<House>,
    pub holdings: LookupMap<(u8, AccountId), Holding>,
    pub players: LookupMap<AccountId, Player>,
    pub rounds: LookupMap<u64, Round>,
    pub next_round: u64,
    pub races: Vector<Race>,
    pub tickets: LookupMap<(u32, AccountId), Ticket>,
    pub pool: u128,
    pub season: u32,
    pub season_secs: u64,
    pub season_ends_ns: u64,
    pub seasons: Vector<Season>,
}

pub(crate) fn event(name: &str, data: Value) {
    env::log_str(&format!("EVENT_JSON:{}", json!({"standard": "crownfall", "version": "1", "event": name, "data": data})));
}

uint::construct_uint! {
    pub struct U256(4);
}

/// a·b/c, rounded down, in 256 bits (NEAR and coin amounts are near 1e30, so the products need it).
pub fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    require!(c > 0, "division by zero");
    let r = U256::from(a) * U256::from(b) / U256::from(c);
    require!(r <= U256::from(u128::MAX), "overflow");
    r.as_u128()
}

#[near]
impl Realm {
    /// Open the realm. The deposit seeds the eight reserves equally; each house starts with its own supply, so the
    /// coins open at different prices.
    #[init]
    #[payable]
    pub fn new(owner: AccountId, season_secs: Option<u64>) -> Self {
        let seed = env::attached_deposit().as_yoctonear();
        require!(seed >= 8 * NEAR / 10, "attach at least 0.8 NEAR to seed the eight reserves");
        let each = seed / HOUSES as u128;
        let season_secs = season_secs.unwrap_or(7 * 24 * 3600);
        let houses = (0..HOUSES)
            .map(|h| House {
                reserve: each,
                supply: (180_000 + ((h as u128 * 7919) % 9) * 41_000) * COIN,
                burned: 0,
                rounds: 0,
                favour: 0,
                fav_season: 1,
            })
            .collect();
        Self {
            owner,
            houses,
            holdings: LookupMap::new(Key::Holdings),
            players: LookupMap::new(Key::Players),
            rounds: LookupMap::new(Key::Rounds),
            next_round: 1,
            races: Vector::new(Key::Races),
            tickets: LookupMap::new(Key::Bets),
            pool: 0,
            season: 1,
            season_secs,
            season_ends_ns: env::block_timestamp() + season_secs * 1_000_000_000,
            seasons: Vector::new(Key::Seasons),
        }
    }

    // ---------- Coin ----------

    /// Buy house coin with the attached NEAR at the current price.
    #[payable]
    pub fn buy(&mut self, house: u8, min_out: Option<U128>) -> U128 {
        let who = env::predecessor_account_id();
        let paid = env::attached_deposit().as_yoctonear();
        require!(paid >= NEAR / 1000, "attach at least 0.001 NEAR");
        let h = self.house_idx(house);
        let fee = paid * FEE_BPS / 10_000;
        let to_pool = paid * FEE_POOL_BPS / 10_000;
        let net = paid - fee;
        let g = &mut self.houses[h];
        let got = mul_div(net, g.supply, g.reserve);
        require!(got >= min_out.map(|m| m.0).unwrap_or(0), "the price moved");
        g.reserve += paid - to_pool;
        g.supply += got;
        self.pool += to_pool;
        let mut hold = self.holding(house, &who);
        hold.coins += got;
        self.holdings.insert((house, who.clone()), hold);
        let mut p = self.player(&who);
        p.bought = true;
        self.players.insert(who.clone(), p);
        event("buy", json!({"house": house, "who": who, "near": U128(paid), "coins": U128(got)}));
        U128(got)
    }

    /// Sell house coin back for NEAR.
    pub fn sell(&mut self, house: u8, amount: U128, min_out: Option<U128>) -> Promise {
        let who = env::predecessor_account_id();
        let h = self.house_idx(house);
        let mut hold = self.holding(house, &who);
        require!(amount.0 > 0 && amount.0 <= hold.coins, "you don't hold that much");
        let g = &mut self.houses[h];
        let gross = mul_div(amount.0, g.reserve, g.supply);
        let fee = gross * FEE_BPS / 10_000;
        let to_pool = gross * FEE_POOL_BPS / 10_000;
        let out = gross - fee;
        require!(out >= min_out.map(|m| m.0).unwrap_or(0), "the price moved");
        g.supply -= amount.0;
        g.reserve -= out + to_pool;
        self.pool += to_pool;
        hold.coins -= amount.0;
        self.holdings.insert((house, who.clone()), hold);
        event("sell", json!({"house": house, "who": who, "coins": amount, "near": U128(out)}));
        Promise::new(who).transfer(NearToken::from_yoctonear(out))
    }

    // ---------- Hall games ----------

    /// Start a round in a house's hall: its entry is burned from your coin. Returns the round's id.
    /// No deposit, so a game's signless key can call it.
    pub fn enter(&mut self, house: u8) -> u64 {
        let who = env::predecessor_account_id();
        let h = self.house_idx(house);
        let cost = ENTRY[h];
        let mut hold = self.holding(house, &who);
        require!(hold.coins >= cost, "not enough coin for the entry: buy some at the Warwick Mint");
        hold.coins -= cost;
        self.add_favour(&mut hold, h, cost);
        self.holdings.insert((house, who.clone()), hold);
        let g = &mut self.houses[h];
        g.supply -= cost;
        g.burned += cost;
        g.rounds += 1;
        let id = self.open_round(&who, house, cost);
        event("enter", json!({"round": id, "house": house, "game": GAMES[h], "who": who, "burned": U128(cost)}));
        id
    }

    /// Sit down at Haseeb's table in the Library with the stake attached.
    #[payable]
    pub fn stake(&mut self) -> u64 {
        let who = env::predecessor_account_id();
        require!(env::attached_deposit().as_yoctonear() == LIBRARY_STAKE, "the stake is exactly 1 NEAR");
        let id = self.open_round(&who, LIBRARY, LIBRARY_STAKE);
        event("stake", json!({"round": id, "who": who, "near": U128(LIBRARY_STAKE)}));
        id
    }

    /// End a round. `grade` is how good a win was, 0–100. The round's player reports it; anyone can close a round
    /// that has run past the hour, as lost.
    pub fn finish(&mut self, round: u64, won: bool, grade: Option<u8>) -> Option<Promise> {
        let who = env::predecessor_account_id();
        let r = self.rounds.remove(&round).unwrap_or_else(|| env::panic_str("no such round, or it's over"));
        let late = env::block_timestamp() > r.at_ns + ROUND_SECS * 1_000_000_000;
        require!(who == r.who || late, "not your round");
        let won = won && !late && who == r.who;
        let grade = grade.unwrap_or(50).min(100) as u128;
        let mut p = self.player(&r.who);
        let mut pay = None;
        // Your first win at Haseeb's table: the Library seal's round. Wins are reported by the player's browser, so only
        // this one pays a bonus; a bonus on every win would let a script farm the crown pool.
        let first_lib = won && r.hall == LIBRARY && p.halls_won & (1 << LIBRARY) == 0;
        if won {
            p.wins += 1;
            p.halls_won |= 1 << r.hall;
        }
        if r.hall == LIBRARY {
            // A win takes the stake back (the first one doubled, the bonus from the crown pool while it lasts); a lost
            // stake goes to the crown pool.
            if won {
                let bonus = if first_lib { r.amount.min(self.pool) } else { 0 };
                self.pool -= bonus;
                pay = Some(Promise::new(r.who.clone()).transfer(NearToken::from_yoctonear(r.amount + bonus)));
            } else {
                self.pool += r.amount;
            }
        } else if won {
            // A win counts the burn again, and up to twice again for a perfect one.
            let h = r.hall as usize;
            let mut hold = self.holding(r.hall, &r.who);
            self.add_favour(&mut hold, h, r.amount + r.amount * grade / 100);
            self.holdings.insert((r.hall, r.who.clone()), hold);
        }
        self.players.insert(r.who.clone(), p);
        event("finish", json!({"round": round, "who": r.who, "hall": r.hall, "won": won, "grade": grade as u8}));
        pay
    }

    // ---------- The Seven Wardens ----------

    /// Take a Warden's seal. Each one checks what the chain can see.
    pub fn seal(&mut self, seal: u8) {
        let who = env::predecessor_account_id();
        require!((seal as usize) < SEALS.len(), "no such seal");
        let mut p = self.player(&who);
        let has = |p: &Player, s: usize| p.seals & (1 << s) != 0;
        require!(!has(&p, seal as usize), "you already hold that seal");
        match seal {
            0 => {}
            1 => {
                require!(has(&p, 0), "the Gate first");
                require!(p.bought && p.plays > 0, "buy a house's coin and play a round in a hall");
            }
            2 | 3 | 4 => {
                require!(has(&p, 1), "Warwick's seal first");
                let hall = [2u16, 0, 8][seal as usize - 2];
                require!(p.halls_won & (1 << hall) != 0, "win that hall's game first");
            }
            5 => require!(has(&p, 1), "Warwick's seal first"),
            _ => {
                require!(p.seals & 0b11_1111 == 0b11_1111, "the six other seals first");
                require!((p.halls_won & 0xff).count_ones() >= 3, "win in three houses' halls");
            }
        }
        p.seals |= 1 << seal;
        self.players.insert(who.clone(), p);
        event("seal", json!({"who": who, "seal": SEALS[seal as usize]}));
    }

    // ---------- The Mumtaz Hippodrome ----------

    /// Call the next race (anyone, once the last one is settled). The seed is the block's.
    pub fn call_race(&mut self) -> u32 {
        if let Some(last) = self.races.len().checked_sub(1).and_then(|i| self.races.get(i)) {
            require!(last.settled, "the last race isn't settled yet");
        }
        let n = self.races.len();
        let s = env::random_seed();
        let seed = u32::from_le_bytes([s[0], s[1], s[2], s[3]]);
        let now = env::block_timestamp();
        let race = Race {
            n,
            seed,
            laps: CUP_LAPS[n as usize % CUP_LAPS.len()],
            called_ns: now,
            off_ns: now + BET_SECS * 1_000_000_000,
            pools: [0; HOUSES],
            whips: vec![],
            settled: false,
            order: vec![],
            finish_ms: vec![],
            payout: 0,
        };
        self.races.push(race);
        event("race", json!({"n": n, "seed": seed, "laps": CUP_LAPS[n as usize % CUP_LAPS.len()], "off_ns": U128((now + BET_SECS * 1_000_000_000) as u128)}));
        n
    }

    /// Back a team with the attached NEAR, before the off.
    #[payable]
    pub fn bet(&mut self, race: u32, house: u8) {
        let who = env::predecessor_account_id();
        let amt = env::attached_deposit().as_yoctonear();
        require!(amt >= NEAR / 100, "bet at least 0.01 NEAR");
        let h = self.house_idx(house);
        let mut r = self.race(race);
        require!(env::block_timestamp() < r.off_ns, "they're off: betting is closed");
        r.pools[h] += amt;
        self.races.replace(race, r);
        let mut t = self.tickets.get(&(race, who.clone())).cloned().unwrap_or_default();
        t.bets[h] += amt;
        self.tickets.insert((race, who.clone()), t);
        event("bet", json!({"race": race, "house": house, "who": who, "near": U128(amt)}));
    }

    /// Crack a whip over a team during the run: it burns that house's coin from you.
    pub fn whip(&mut self, race: u32, house: u8) -> u32 {
        let who = env::predecessor_account_id();
        let h = self.house_idx(house);
        let mut r = self.race(race);
        let now = env::block_timestamp();
        require!(now >= r.off_ns, "they aren't off yet");
        require!(now < r.off_ns + WHIP_SECS * 1_000_000_000, "too late to whip");
        let mut t = self.tickets.get(&(race, who.clone())).cloned().unwrap_or_default();
        require!(t.whips < WHIPS_PER_RACE, "three whips a race");
        let mut hold = self.holding(house, &who);
        require!(hold.coins >= WHIP_COINS, "a whip burns 200 of that house's coin");
        hold.coins -= WHIP_COINS;
        self.add_favour(&mut hold, h, WHIP_COINS);
        self.holdings.insert((house, who.clone()), hold);
        let g = &mut self.houses[h];
        g.supply -= WHIP_COINS;
        g.burned += WHIP_COINS;
        t.whips += 1;
        self.tickets.insert((race, who.clone()), t);
        // The tick the whip lands on: tenths of a second since the off, plus one (the sim's next tick).
        let tick = ((now - r.off_ns) / 100_000_000) as u32 + 1;
        r.whips.push((tick, house));
        self.races.replace(race, r);
        event("whip", json!({"race": race, "house": house, "who": who, "tick": tick}));
        tick
    }

    /// Run the race on chain and fix the result (anyone, once the whip window has closed).
    pub fn settle(&mut self, race: u32) -> Vec<u8> {
        let mut r = self.race(race);
        require!(!r.settled, "already settled");
        require!(env::block_timestamp() >= r.off_ns + WHIP_SECS * 1_000_000_000, "the race is still on");
        let whips: Vec<sim::Whip> = r.whips.iter().map(|&(tick, house)| sim::Whip { tick, house }).collect();
        let out = sim::run(r.seed, r.laps, &whips);
        let total: u128 = r.pools.iter().sum();
        let cut = total * FEE_BPS / 10_000;
        let win = out.order[0] as usize;
        if r.pools[win] == 0 {
            // Nobody backed the winner: everything goes to the crown.
            self.pool += total;
            r.payout = 0;
        } else {
            self.pool += cut;
            r.payout = total - cut;
        }
        r.order = out.order.clone();
        r.finish_ms = out.finish.iter().map(|f| f.map(|s| (s * 1000.0).round() as u32).unwrap_or(0)).collect();
        r.settled = true;
        event("settle", json!({"race": race, "order": out.order, "finish_ms": r.finish_ms, "pool": U128(total)}));
        self.races.replace(race, r);
        out.order
    }

    /// Collect what your bets on a race's winner earned.
    pub fn claim_race(&mut self, race: u32) -> Promise {
        let who = env::predecessor_account_id();
        let r = self.race(race);
        require!(r.settled, "not settled yet");
        let mut t = self.tickets.get(&(race, who.clone())).cloned().unwrap_or_else(|| env::panic_str("no ticket"));
        require!(!t.claimed, "already claimed");
        let win = r.order[0] as usize;
        require!(t.bets[win] > 0, "you didn't back the winner");
        let amount = mul_div(r.payout, t.bets[win], r.pools[win]);
        t.claimed = true;
        self.tickets.insert((race, who.clone()), t);
        event("claim_race", json!({"race": race, "who": who, "near": U128(amount)}));
        Promise::new(who).transfer(NearToken::from_yoctonear(amount))
    }

    // ---------- The Ashen Throne ----------

    /// End the season (anyone, once it's due): crown the house with the most favour and set the crown pool aside for
    /// its players.
    pub fn end_season(&mut self) -> Option<u8> {
        let now = env::block_timestamp();
        require!(now >= self.season_ends_ns, "the season isn't over");
        let s = self.season;
        let fav = |g: &House| if g.fav_season == s { g.favour } else { 0 };
        let mut crowned = None;
        let mut best = 0u128;
        for (i, g) in self.houses.iter().enumerate() {
            if fav(g) > best {
                best = fav(g);
                crowned = Some(i as u8);
            }
        }
        let pool = if crowned.is_some() { std::mem::take(&mut self.pool) } else { 0 };
        self.seasons.push(Season { n: s, crowned, pool: U128(pool), favour: U128(best), claimed: U128(0), ended_ns: now });
        event("crowned", json!({"season": s, "house": crowned, "pool": U128(pool)}));
        self.season += 1;
        self.season_ends_ns = now + self.season_secs * 1_000_000_000;
        crowned
    }

    /// Take your share of a season's crown pool, if you played for the crowned house.
    pub fn claim_crown(&mut self, season: u32) -> Promise {
        let who = env::predecessor_account_id();
        let mut s = self.seasons.get(season.checked_sub(1).expect("no such season")).cloned().expect("that season isn't over");
        let house = s.crowned.expect("nobody was crowned");
        let mut hold = self.holding(house, &who);
        require!(hold.claimed_season < season, "already claimed");
        let mine = if hold.fav_season == season { hold.favour } else if hold.prev_season == season { hold.prev_favour } else { 0 };
        require!(mine > 0, "you earned no favour with the crowned house that season");
        let amount = mul_div(s.pool.0, mine, s.favour.0);
        hold.claimed_season = season;
        s.claimed = U128(s.claimed.0 + amount);
        self.holdings.insert((house, who.clone()), hold);
        self.seasons.replace(season - 1, s);
        event("claim_crown", json!({"season": season, "who": who, "near": U128(amount)}));
        Promise::new(who).transfer(NearToken::from_yoctonear(amount))
    }

    // ---------- Views ----------

    pub fn get_realm(&self) -> Value {
        let s = self.season;
        json!({
            "season": s,
            "season_ends_ns": U128(self.season_ends_ns as u128),
            "pool": U128(self.pool),
            "races": self.races.len(),
            "houses": self.houses.iter().enumerate().map(|(i, g)| json!({
                "id": i, "name": NAMES[i], "coin": TICKERS[i], "game": GAMES[i],
                "reserve": U128(g.reserve), "supply": U128(g.supply), "burned": U128(g.burned), "rounds": g.rounds,
                "entry": U128(ENTRY[i]),
                "favour": U128(if g.fav_season == s { g.favour } else { 0 }),
            })).collect::<Vec<_>>(),
        })
    }

    pub fn get_account(&self, account: AccountId) -> Value {
        let s = self.season;
        let p = self.players.get(&account).cloned().unwrap_or_default();
        let holds: Vec<Value> = (0..HOUSES as u8)
            .map(|h| {
                let x = self.holdings.get(&(h, account.clone())).cloned().unwrap_or_default();
                json!({"coins": U128(x.coins), "favour": U128(if x.fav_season == s { x.favour } else { 0 })})
            })
            .collect();
        json!({
            "seals": SEALS.iter().enumerate().filter(|(i, _)| p.seals & (1 << i) != 0).map(|(_, s)| *s).collect::<Vec<_>>(),
            "halls_won": (0..9).filter(|h| p.halls_won & (1 << h) != 0).collect::<Vec<u8>>(),
            "plays": p.plays, "wins": p.wins, "bought": p.bought,
            "houses": holds,
        })
    }

    pub fn get_race(&self, race: u32) -> Option<Value> {
        self.races.get(race).map(|r| {
            json!({
                "n": r.n, "seed": r.seed, "laps": r.laps,
                "called_ns": U128(r.called_ns as u128), "off_ns": U128(r.off_ns as u128),
                "pools": r.pools.iter().map(|&p| U128(p)).collect::<Vec<_>>(),
                "whips": r.whips, "settled": r.settled, "order": r.order, "finish_ms": r.finish_ms, "payout": U128(r.payout),
            })
        })
    }

    pub fn get_ticket(&self, race: u32, account: AccountId) -> Option<Value> {
        self.tickets.get(&(race, account)).map(|t| {
            json!({"bets": t.bets.iter().map(|&b| U128(b)).collect::<Vec<_>>(), "whips": t.whips, "claimed": t.claimed})
        })
    }

    pub fn get_season(&self, season: u32) -> Option<Season> {
        season.checked_sub(1).and_then(|i| self.seasons.get(i)).cloned()
    }

    /// What `claim_crown(season)` would pay this account: the crowned house, the pool, the house's winning favour, your
    /// favour with it that season, your share, and whether you've taken it. None until the season has ended.
    pub fn get_crown(&self, season: u32, account: AccountId) -> Option<Value> {
        let s = season.checked_sub(1).and_then(|i| self.seasons.get(i)).cloned()?;
        let (mine, claimed) = match s.crowned {
            Some(house) => {
                let hold = self.holding(house, &account);
                let mine = if hold.fav_season == season { hold.favour } else if hold.prev_season == season { hold.prev_favour } else { 0 };
                (mine, hold.claimed_season >= season)
            }
            None => (0, false),
        };
        let share = if s.favour.0 > 0 { mul_div(s.pool.0, mine, s.favour.0) } else { 0 };
        Some(json!({"season": season, "crowned": s.crowned, "pool": s.pool, "favour": s.favour, "mine": U128(mine),
                    "share": U128(share), "claimed": claimed, "ended_ns": U128(s.ended_ns as u128)}))
    }

    pub fn quote_buy(&self, house: u8, near: U128) -> U128 {
        let g = &self.houses[self.house_idx(house)];
        U128(mul_div(near.0 - near.0 * FEE_BPS / 10_000, g.supply, g.reserve))
    }

    pub fn quote_sell(&self, house: u8, coins: U128) -> U128 {
        let g = &self.houses[self.house_idx(house)];
        let gross = mul_div(coins.0, g.reserve, g.supply);
        U128(gross - gross * FEE_BPS / 10_000)
    }

    /// Replay a race off chain with extra whips, to see what they would have done (the browser does this too).
    pub fn preview_race(&self, seed: u32, laps: u8, whips: Vec<(u32, u8)>) -> Value {
        let w: Vec<sim::Whip> = whips.into_iter().map(|(tick, house)| sim::Whip { tick, house }).collect();
        let out = sim::run(seed, laps, &w);
        json!({"order": out.order, "lanes": out.lanes, "ticks": out.ticks,
               "finish_ms": out.finish.iter().map(|f| f.map(|s| (s * 1000.0).round() as u32).unwrap_or(0)).collect::<Vec<_>>()})
    }
}

impl Realm {
    fn house_idx(&self, house: u8) -> usize {
        require!((house as usize) < HOUSES, "no such house");
        house as usize
    }
    fn holding(&self, house: u8, who: &AccountId) -> Holding {
        self.holdings.get(&(house, who.clone())).cloned().unwrap_or_default()
    }
    fn player(&self, who: &AccountId) -> Player {
        self.players.get(who).cloned().unwrap_or_default()
    }
    fn race(&self, race: u32) -> Race {
        self.races.get(race).cloned().unwrap_or_else(|| env::panic_str("no such race"))
    }
    fn open_round(&mut self, who: &AccountId, hall: u8, amount: u128) -> u64 {
        let id = self.next_round;
        self.next_round += 1;
        self.rounds.insert(id, Round { who: who.clone(), hall, amount, at_ns: env::block_timestamp() });
        let mut p = self.player(who);
        p.plays += 1;
        self.players.insert(who.clone(), p);
        id
    }
    /// Favour for this season, on the player's holding and on the house.
    fn add_favour(&mut self, hold: &mut Holding, h: usize, amount: u128) {
        let s = self.season;
        if hold.fav_season != s {
            if hold.fav_season != 0 {
                hold.prev_favour = hold.favour;
                hold.prev_season = hold.fav_season;
            }
            hold.favour = 0;
            hold.fav_season = s;
        }
        hold.favour += amount;
        let g = &mut self.houses[h];
        if g.fav_season != s {
            g.favour = 0;
            g.fav_season = s;
        }
        g.favour += amount;
    }
}
