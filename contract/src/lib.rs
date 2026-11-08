//! Crownfall: a house game on NEAR where every house is a memecoin of coins.
//!
//! One contract runs the whole island. Eight seats, each home to at most one folk and its house.
//!
//! - **Coins coins.** Every house is a coin whose price is its NEAR reserve divided by its coins supply.
//!   Every coin can always be sold back, so a house never owes more than it holds. A 5% fee on every trade
//!   splits three points to the reserve, one to the house's council and one to the age's offering pool.
//! - **Decrees** burn coins and act on a folk. Burning records fealty, which counts double for a house
//!   that isn't leading (the loyalty bonus).
//! - **Prayers.** Every season each house mints coins in proportion to its believers. It goes to that age's
//!   devotees by fealty, never to holders.
//! - **Idle coins fades.** Coins held by an account that hasn't cast for that house in 24 seasons loses 1%
//!   a season. The NEAR behind it moves to the council, so the price doesn't move.
//! - **The season** (`turn`, anyone can call it once it is due) moves the world: harvests, births and
//!   deaths, envoys, wars, the prayer mint, rebellions and fades. Randomness comes from the block.
//! - **Fading.** A folk under 5 people is gone. Its house's trading stops, half its NEAR goes to the
//!   offering pool and half to the houses that took its people.
//! - **The crowning.** When the age ends, the house with the most believers is crowned and its devotees
//!   claim the offering pool by fealty. Surviving houses carry into the next age with a fresh folk.
//! - **Temples.** Each house's congregation is a Sputnik DAO. Its elders are the house's top devotees this
//!   age, kept in step by this contract. The DAO pays for works, bounties and alms through calls here.
//!
//! Amounts: NEAR in yoctoNEAR, coins in yocto-COIN (24 decimals). Folk numbers are fixed point,
//! `U` = 1.0.

use near_sdk::borsh::BorshSerialize;
use near_sdk::json_types::U128;
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise};

mod math;
mod council;
mod world;
#[cfg(test)]
mod tests;

pub use math::*;

/// 1.0 in folk fixed point.
pub const U: i128 = 1_000_000;
/// One COIN.
pub const COIN: u128 = 1_000_000_000_000_000_000_000_000;
/// One NEAR.
pub const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
pub const SEATS: usize = 8;
pub const ELDER_SEATS: usize = 7;
const TOP_KEPT: usize = 12;

/// What the contract fixes at launch. Nobody can change it afterwards.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Rules {
    /// Seconds between seasons (300 on the day island, 20 on the fast island).
    pub season_secs: u64,
    /// Seasons in an age (288 on the day island).
    pub seasons_per_age: u32,
    /// NEAR a founder puts into a new house's reserve.
    pub founding: U128,
    /// COIN the founder gets for it.
    pub founding_coins: U128,
    /// Trading fee in basis points, and the parts of it that go to the council and the pool.
    pub fee_bps: u32,
    pub fee_council_bps: u32,
    pub fee_pool_bps: u32,
    /// COIN minted per believer per season, in millionths (60_000 = 0.06).
    pub mint_per_believer: u32,
    /// A folk under this many people is gone.
    pub fade_below: u32,
    /// Seasons without casting before coins starts to fade, and the fade per season in basis points.
    pub idle_after: u32,
    pub idle_fade_bps: u32,
    /// Devotion multiplier for a house that isn't leading, in percent (200 = double).
    pub loyalty_pct: u32,
    /// Share of the elders' fealty a rebellion needs, in percent.
    pub rebellion_pct: u32,
    /// Seasons a rebellion stays open for backers.
    pub rebellion_window: u32,
}

impl Rules {
    pub fn day() -> Self {
        Self {
            season_secs: 300,
            seasons_per_age: 288,
            founding: U128(NEAR),
            founding_coins: U128(100 * COIN),
            fee_bps: 500,
            fee_council_bps: 100,
            fee_pool_bps: 100,
            mint_per_believer: 60_000,
            fade_below: 5,
            idle_after: 24,
            idle_fade_bps: 100,
            loyalty_pct: 200,
            rebellion_pct: 34,
            rebellion_window: 12,
        }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Decree {
    Sow,
    Provision,
    Healers,
    Feast,
    Sermon,
    Sellswords,
    Raid,
    Poison,
}

impl Decree {
    pub const ALL: [Decree; 8] = [
        Decree::Sow,
        Decree::Provision,
        Decree::Healers,
        Decree::Feast,
        Decree::Sermon,
        Decree::Sellswords,
        Decree::Raid,
        Decree::Poison,
    ];
    /// Base cost in whole COIN.
    pub fn base(self) -> u128 {
        match self {
            Decree::Sow => 2,
            Decree::Provision => 5,
            Decree::Healers => 4,
            Decree::Feast => 3,
            Decree::Sermon => 8,
            Decree::Sellswords => 60,
            Decree::Raid => 6,
            Decree::Poison => 15,
        }
    }
    /// Cast on your own folk (true) or on a rival's (false).
    pub fn own(self) -> bool {
        !matches!(self, Decree::Raid | Decree::Poison)
    }
    fn idx(self) -> usize {
        Decree::ALL.iter().position(|m| *m == self).unwrap()
    }
}

/// A chief's stance for the coming seasons, posted by the house's chief agent.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Stance {
    /// Goes to war on a clearly weaker neighbour (the default).
    Conquer,
    /// Never attacks; defends at 1.2x.
    Fortify,
    /// Missionaries work 1.5x as hard.
    Court,
    /// Trades with neighbours: +5% food.
    Trade,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Work {
    /// Stores 3 seasons of food instead of 2.
    Granary,
    /// The folk defends at 1.5x.
    Walls,
    /// Devotion falls half as fast.
    Hall,
}

impl Work {
    pub fn price(self) -> u128 {
        match self {
            Work::Granary => 4 * NEAR / 10,
            Work::Walls => 6 * NEAR / 10,
            Work::Hall => 8 * NEAR / 10,
        }
    }
}

/// A folk: the people in a seat. Fixed point, `U` = 1.0 (so `pop` 60 * U is 60 people).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Folk {
    pub pop: i128,
    pub food: i128,
    pub land: i128,
    pub morale: i128,
    pub fealty: i128,
    pub army: i128,
    pub sellswords: u32,
    pub weather: i128,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct House {
    pub id: u32,
    pub name: String,
    pub seat: u8,
    pub founder: AccountId,
    pub born_age: u32,
    pub alive: bool,
    pub faded_at: Option<(u32, u32)>,
    pub reserve: u128,
    pub supply: u128,
    pub minted: u128,
    pub burned: u128,
    pub folk: Folk,
    /// People this house's folk took from other houses this age, by house id (for the fade split).
    pub taken: Vec<(u32, i128)>,
    /// Casts of each decree this season (prices rise 25% each time).
    pub casts: [u8; 8],
    pub stance: Stance,
    pub chief: Option<AccountId>,
    /// Prayer mint: coins per unit of fealty, scaled by COIN. It only rises; `acc_marks` keeps its
    /// value at the end of each age so fealty from an old age is paid what that age owed it.
    pub acc: u128,
    pub acc_marks: Vec<(u32, u128)>,
    /// Devotion this age.
    pub standing_total: u128,
    /// Top devotees this age, highest first (elders are the first seven not barred).
    pub top: Vec<(AccountId, u128)>,
    /// Elders barred by the council, until a global season.
    pub barred: Vec<(AccountId, u64)>,
    // The council.
    pub council_dao: Option<AccountId>,
    /// Council NEAR held here until it is paid to the DAO.
    pub council_due: u128,
    pub works: Vec<Work>,
    pub bounty_on: Option<u32>,
    pub bounty_each: u128,
    pub bounty_left: u128,
    /// Alms: NEAR per unit of fealty, scaled by COIN, with marks at each age's end like `acc`.
    pub alms_acc: u128,
    pub alms_marks: Vec<(u32, u128)>,
    /// Pacts with other houses, until a global season.
    pub pacts: Vec<(u32, u64)>,
    /// A envoy drive: target seat, seasons left.
    pub envoy: Option<(u8, u32)>,
    /// Pact offers this council has made: (other house, seasons).
    pub pact_offers: Vec<(u32, u32)>,
    /// Elders as last written into the DAO.
    pub dao_elders: Vec<AccountId>,
}

/// One account's stake in one house.
#[near(serializers = [borsh])]
#[derive(Clone, Default)]
pub struct Holding {
    pub coins: u128,
    pub standing: u128,
    pub standing_age: u32,
    pub debt: u128,
    pub alms_debt: u128,
    /// Alms earned and not yet claimed, in yoctoNEAR.
    pub alms_owed: u128,
    /// The previous age's fealty, kept so the crown can still be claimed after it resets.
    pub prev_standing: u128,
    pub prev_age: u32,
    /// Global season the idle clock counts from (the last cast, or when this coins first arrived).
    pub idle_base: u64,
    /// Global season up to which the idle fade has been applied.
    pub faded_to: u64,
    pub claimed_age: u32,
}

#[near(serializers = [borsh])]
pub struct Rebellion {
    pub house: u32,
    pub name: String,
    pub backers: Vec<AccountId>,
    pub opened: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct AgeResult {
    pub age: u32,
    pub crowned: Option<u32>,
    pub pool: U128,
    pub standing_total: U128,
    pub claimed: U128,
}

#[derive(BorshStorageKey, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
enum Key {
    Houses,
    Holdings,
    Ages,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct World {
    pub owner: AccountId,
    pub rules: Rules,
    pub age: u32,
    /// Season within the age, from 0.
    pub season: u32,
    /// Seasons since launch (the idle clock).
    pub gseason: u64,
    pub next_turn_ns: u64,
    pub seats: [Option<u32>; SEATS],
    pub houses: Vector<House>,
    pub holdings: LookupMap<(u32, AccountId), Holding>,
    pub pool: u128,
    pub leader: Option<u32>,
    pub ages: Vector<AgeResult>,
    pub rebellions: Vec<Rebellion>,
    /// The Sputnik DAO factory councils are made with.
    pub dao_factory: AccountId,
    pub last_seed: Vec<u8>,
}

pub(crate) fn event(name: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        near_sdk::serde_json::json!({"standard": "crownfall", "version": "1", "event": name, "data": data})
    ));
}

#[near]
impl World {
    #[init]
    pub fn new(owner: AccountId, rules: Option<Rules>, dao_factory: Option<AccountId>) -> Self {
        let rules = rules.unwrap_or_else(Rules::day);
        require!(rules.fee_council_bps + rules.fee_pool_bps <= rules.fee_bps, "fee parts exceed the fee");
        Self {
            owner,
            next_turn_ns: env::block_timestamp() + rules.season_secs * 1_000_000_000,
            rules,
            age: 1,
            season: 0,
            gseason: 0,
            seats: [None; SEATS],
            houses: Vector::new(Key::Houses),
            holdings: LookupMap::new(Key::Holdings),
            pool: 0,
            leader: None,
            ages: Vector::new(Key::Ages),
            rebellions: vec![],
            dao_factory: dao_factory.unwrap_or_else(|| "sputnikv2.testnet".parse().unwrap()),
            last_seed: vec![],
        }
    }

    // ---------- Houses and coins ----------

    /// Found a house in an empty seat. Attach the founding NEAR; you get the founding COIN.
    #[payable]
    pub fn found(&mut self, name: String, seat: u8) -> u32 {
        let who = env::predecessor_account_id();
        let paid = env::attached_deposit().as_yoctonear();
        require!(paid >= self.rules.founding.0, "attach the founding NEAR");
        require!((seat as usize) < SEATS, "no such seat");
        require!(self.seat_free(seat), "that seat is taken");
        let name = clean_name(&name);
        require!(!self.houses.iter().any(|g| g.alive && g.name.eq_ignore_ascii_case(&name)), "a living house has that name");
        let id = self.houses.len();
        let folk = self.fresh_folk(id as u64);
        let mut house = new_house(id, name.clone(), seat, who.clone(), self.age, folk);
        house.reserve = paid;
        house.supply = self.rules.founding_coins.0;
        self.houses.push(house);
        self.seats[seat as usize] = Some(id);
        let mut h = self.holding(id, &who);
        h.coins += self.rules.founding_coins.0;
        self.holdings.insert((id, who.clone()), h);
        event("found", near_sdk::serde_json::json!({"house": id, "name": name, "seat": seat, "founder": who, "reserve": U128(paid)}));
        id
    }

    /// Buy a house's coins with the attached NEAR.
    #[payable]
    pub fn buy(&mut self, house: u32, min_out: Option<U128>) -> U128 {
        let who = env::predecessor_account_id();
        let paid = env::attached_deposit().as_yoctonear();
        require!(paid > 0, "attach NEAR");
        let mut g = self.house(house);
        require!(g.alive, "this house has faded");
        let mut h = self.settled(&mut g, &who);
        let (fee, to_council, to_pool) = self.fees(paid);
        let net = paid - fee;
        let got = mul_div(net, g.supply, g.reserve);
        require!(got >= min_out.map(|m| m.0).unwrap_or(0), "price moved");
        g.reserve += net + fee - to_council - to_pool;
        g.council_due += to_council;
        self.pool += to_pool;
        g.supply += got;
        if h.coins == 0 && h.idle_base < self.gseason {
            h.idle_base = self.gseason;
            h.faded_to = self.gseason;
        }
        h.coins += got;
        self.holdings.insert((house, who.clone()), h);
        event("buy", near_sdk::serde_json::json!({"house": house, "who": who, "near": U128(paid), "coins": U128(got)}));
        self.houses.replace(house, g);
        U128(got)
    }

    /// Sell coins back to its house for NEAR.
    pub fn sell(&mut self, house: u32, amount: U128, min_out: Option<U128>) -> Promise {
        let who = env::predecessor_account_id();
        let mut g = self.house(house);
        require!(g.alive, "this house has faded");
        let mut h = self.settled(&mut g, &who);
        let amt = amount.0;
        require!(amt > 0 && amt <= h.coins, "not that much coins");
        let gross = mul_div(amt, g.reserve, g.supply);
        let (fee, to_council, to_pool) = self.fees(gross);
        let out = gross - fee;
        require!(out >= min_out.map(|m| m.0).unwrap_or(0), "price moved");
        h.coins -= amt;
        g.supply -= amt;
        g.reserve -= out + to_council + to_pool;
        g.council_due += to_council;
        self.pool += to_pool;
        self.holdings.insert((house, who.clone()), h);
        self.houses.replace(house, g);
        event("sell", near_sdk::serde_json::json!({"house": house, "who": who, "coins": amount, "near": U128(out)}));
        Promise::new(who).transfer(NearToken::from_yoctonear(out))
    }

    /// Give coins to another account (it starts its own idle clock).
    pub fn give(&mut self, house: u32, to: AccountId, amount: U128) {
        let who = env::predecessor_account_id();
        require!(to != who, "that's you");
        let mut g = self.house(house);
        let mut h = self.settled(&mut g, &who);
        require!(amount.0 > 0 && amount.0 <= h.coins, "not that much coins");
        h.coins -= amount.0;
        self.holdings.insert((house, who.clone()), h);
        let mut r = self.settled(&mut g, &to);
        if r.coins == 0 {
            r.idle_base = self.gseason;
            r.faded_to = self.gseason;
        }
        r.coins += amount.0;
        self.holdings.insert((house, to.clone()), r);
        self.houses.replace(house, g);
        event("give", near_sdk::serde_json::json!({"house": house, "from": who, "to": to, "coins": amount}));
    }

    /// Cast a decree as `house`, burning your coins in it, on `target` (your own folk, or a rival's).
    pub fn cast(&mut self, house: u32, target: u32, decree: Decree) -> U128 {
        let who = env::predecessor_account_id();
        let mut g = self.house(house);
        require!(g.alive, "this house has faded");
        let t_alive = if target == house { true } else { self.house(target).alive };
        require!(t_alive, "that folk is gone");
        if decree.own() {
            require!(target == house, "this decree is for your own folk");
        } else {
            require!(target != house, "this decree is for a rival");
            require!(!g.pacts.iter().any(|(o, until)| *o == target && *until > self.gseason), "you have a pact with that house");
        }
        let mut h = self.settled(&mut g, &who);
        let cost = decree_cost(decree, g.casts[decree.idx()]);
        require!(h.coins >= cost, "not enough coins");
        h.coins -= cost;
        g.supply -= cost;
        g.burned += cost;
        g.casts[decree.idx()] = g.casts[decree.idx()].saturating_add(1);
        let weight = if self.leader == Some(house) { 100 } else { self.rules.loyalty_pct as u128 };
        let added = cost * weight / 100;
        // `settled` has paid the mint and alms owed so far, so fealty can change the share now.
        h.standing += added;
        g.standing_total += added;
        h.idle_base = self.gseason;
        h.faded_to = self.gseason;
        let standing_now = h.standing;
        self.holdings.insert((house, who.clone()), h);
        rank(&mut g.top, &who, standing_now);
        // The decree itself.
        let mut bounty = 0u128;
        if target == house {
            apply_decree(&mut g.folk, decree);
        } else {
            let mut t = self.house(target);
            apply_decree(&mut t.folk, decree);
            self.houses.replace(target, t);
            if g.bounty_on == Some(target) && g.bounty_left >= g.bounty_each && g.bounty_each > 0 {
                bounty = g.bounty_each;
                g.bounty_left -= bounty;
            }
        }
        self.houses.replace(house, g);
        event(
            "cast",
            near_sdk::serde_json::json!({"house": house, "target": target, "decree": decree, "who": who, "coins": U128(cost), "fealty": U128(added), "bounty": U128(bounty)}),
        );
        if bounty > 0 {
            Promise::new(who).transfer(NearToken::from_yoctonear(bounty)).detach();
        }
        U128(cost)
    }

    /// The chief posts a stance. The founder names the chief.
    pub fn set_chief(&mut self, house: u32, chief: AccountId) {
        let mut g = self.house(house);
        require!(env::predecessor_account_id() == g.founder || Some(env::predecessor_account_id()) == g.council_dao, "only the founder or the council");
        g.chief = Some(chief);
        self.houses.replace(house, g);
    }

    pub fn set_stance(&mut self, house: u32, stance: Stance) {
        let mut g = self.house(house);
        require!(Some(env::predecessor_account_id()) == g.chief, "only the chief");
        require!(g.alive, "this house has faded");
        g.stance = stance;
        self.houses.replace(house, g);
        event("stance", near_sdk::serde_json::json!({"house": house, "stance": stance}));
    }

    /// Claim your share of an age's offering pool, if you were a devotee of the crowned house.
    pub fn claim_crown(&mut self, age: u32) -> Promise {
        let who = env::predecessor_account_id();
        let mut r = self.ages.get(age.checked_sub(1).expect("no such age")).cloned().expect("that age isn't over");
        let house = r.crowned.expect("nobody was crowned");
        let mut h = self.holdings.get(&(house, who.clone())).cloned().expect("you weren't a devotee");
        require!(h.claimed_age < age, "already claimed");
        let standing = if h.standing_age == age { h.standing } else if h.prev_age == age { h.prev_standing } else { 0 };
        require!(standing > 0, "you weren't a devotee");
        let amount = mul_div(r.pool.0, standing, r.standing_total.0);
        h.claimed_age = age;
        r.claimed = U128(r.claimed.0 + amount);
        self.holdings.insert((house, who.clone()), h);
        self.ages.replace(age - 1, r);
        event("claim", near_sdk::serde_json::json!({"age": age, "who": who, "near": U128(amount)}));
        Promise::new(who).transfer(NearToken::from_yoctonear(amount))
    }

    /// Settle accounts' prayer mint and idle fade (anyone can call it; it moves faded NEAR to the council).
    pub fn sweep(&mut self, house: u32, accounts: Vec<AccountId>) {
        require!(accounts.len() <= 50, "50 at a time");
        let mut g = self.house(house);
        for a in accounts {
            if self.holdings.contains_key(&(house, a.clone())) {
                let h = self.settled(&mut g, &a);
                self.holdings.insert((house, a), h);
            }
        }
        self.houses.replace(house, g);
    }

    // ---------- Views ----------

    pub fn get_rules(&self) -> Rules {
        self.rules.clone()
    }

    pub fn get_world(&self) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({
            "age": self.age,
            "season": self.season,
            "seasons_per_age": self.rules.seasons_per_age,
            "gseason": self.gseason,
            "next_turn_ns": near_sdk::json_types::U64(self.next_turn_ns),
            "seats": self.seats,
            "pool": U128(self.pool),
            "leader": self.leader,
            "houses": self.houses.iter().map(|g| self.house_view(g)).collect::<Vec<_>>(),
            "rebellions": self.rebellions.iter().map(|s| near_sdk::serde_json::json!({"house": s.house, "name": s.name, "backers": s.backers, "opened": s.opened})).collect::<Vec<_>>(),
            "seed": hex(&self.last_seed),
        })
    }

    pub fn get_house(&self, house: u32) -> near_sdk::serde_json::Value {
        let g = self.houses.get(house).expect("no such house");
        let mut v = self.house_view(g);
        v["top"] = near_sdk::serde_json::json!(g.top.iter().map(|(a, d)| (a.clone(), U128(*d))).collect::<Vec<_>>());
        v["elders"] = near_sdk::serde_json::json!(self.elders_of(g));
        v["decree_costs"] = near_sdk::serde_json::json!(Decree::ALL.iter().map(|m| (m, U128(decree_cost(*m, g.casts[m.idx()])))).collect::<Vec<_>>());
        v
    }

    /// An account's coins, fealty and what it can claim, with the mint and fade applied.
    pub fn get_holding(&self, house: u32, account: AccountId) -> near_sdk::serde_json::Value {
        let mut g = self.houses.get(house).expect("no such house").clone();
        let h = self.settle_view(&mut g, &account);
        let alms = h.alms_owed;
        near_sdk::serde_json::json!({
            "coins": U128(h.coins), "fealty": U128(h.standing), "worth": U128(if g.alive && g.supply > 0 { mul_div(h.coins, g.reserve, g.supply) } else { 0 }),
            "idle_seasons": self.gseason.saturating_sub(h.idle_base), "alms_due": U128(alms),
            "elder": self.elders_of(&g).contains(&account),
        })
    }

    pub fn quote_buy(&self, house: u32, near: U128) -> U128 {
        let g = self.houses.get(house).expect("no such house");
        let (fee, _, _) = self.fees(near.0);
        U128(mul_div(near.0 - fee, g.supply, g.reserve))
    }

    pub fn quote_sell(&self, house: u32, coins: U128) -> U128 {
        let g = self.houses.get(house).expect("no such house");
        let gross = mul_div(coins.0, g.reserve, g.supply);
        let (fee, _, _) = self.fees(gross);
        U128(gross - fee)
    }

    pub fn get_age(&self, age: u32) -> Option<AgeResult> {
        self.ages.get(age.checked_sub(1)?).cloned()
    }
}

// ---------- Internals ----------

pub(crate) fn new_house(id: u32, name: String, seat: u8, founder: AccountId, age: u32, folk: Folk) -> House {
    House {
        id,
        name,
        seat,
        founder,
        born_age: age,
        alive: true,
        faded_at: None,
        reserve: 0,
        supply: 0,
        minted: 0,
        burned: 0,
        folk,
        taken: vec![],
        casts: [0; 8],
        stance: Stance::Conquer,
        chief: None,
        acc: 0,
        acc_marks: vec![],
        standing_total: 0,
        top: vec![],
        barred: vec![],
        council_dao: None,
        council_due: 0,
        works: vec![],
        bounty_on: None,
        bounty_each: 0,
        bounty_left: 0,
        alms_acc: 0,
        alms_marks: vec![],
        pacts: vec![],
        envoy: None,
        pact_offers: vec![],
        dao_elders: vec![],
    }
}

fn clean_name(s: &str) -> String {
    let n: String = s.chars().filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-' || *c == '\'').collect();
    let n = n.trim().to_string();
    require!(!n.is_empty() && n.chars().count() <= 24, "a name of 1 to 24 letters");
    n
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

/// Price of a decree after `n` casts of it this season: base * 1.25^n COIN.
pub fn decree_cost(m: Decree, n: u8) -> u128 {
    let mut c = m.base() * COIN;
    for _ in 0..n {
        c = c * 5 / 4;
    }
    c
}

/// Keep the top devotees sorted (fealty only rises within an age).
pub(crate) fn rank(top: &mut Vec<(AccountId, u128)>, who: &AccountId, standing: u128) {
    top.retain(|(a, _)| a != who);
    let at = top.iter().position(|(_, d)| *d < standing).unwrap_or(top.len());
    top.insert(at, (who.clone(), standing));
    top.truncate(TOP_KEPT);
}

pub(crate) fn apply_decree(t: &mut Folk, m: Decree) {
    match m {
        Decree::Sow => t.weather = t.weather.max(U * 115 / 100),
        Decree::Provision => t.food += t.pop * 40 / 100,
        Decree::Healers => t.pop += 2 * U,
        Decree::Feast => t.morale = (t.morale + U * 6 / 100).min(U),
        Decree::Sermon => t.fealty = (t.fealty + U * 5 / 100).min(U),
        Decree::Sellswords => t.sellswords = 12,
        Decree::Raid => t.food = (t.food - t.pop * 30 / 100).max(0),
        Decree::Poison => {
            t.pop = (t.pop * 90 / 100 - 2 * U).max(0);
            t.morale = (t.morale - U * 5 / 100).max(0);
        }
    }
}

impl World {
    pub(crate) fn house(&self, id: u32) -> House {
        self.houses.get(id).cloned().expect("no such house")
    }

    pub(crate) fn seat_free(&self, v: u8) -> bool {
        match self.seats[v as usize] {
            None => true,
            Some(id) => !self.houses.get(id).map(|g| g.alive).unwrap_or(false),
        }
    }

    pub(crate) fn fees(&self, amount: u128) -> (u128, u128, u128) {
        let fee = amount * self.rules.fee_bps as u128 / 10_000;
        let t = amount * self.rules.fee_council_bps as u128 / 10_000;
        let p = amount * self.rules.fee_pool_bps as u128 / 10_000;
        (fee, t, p)
    }

    pub(crate) fn holding(&self, house: u32, who: &AccountId) -> Holding {
        self.holdings.get(&(house, who.clone())).cloned().unwrap_or(Holding {
            standing_age: self.age,
            idle_base: self.gseason,
            faded_to: self.gseason,
            ..Default::default()
        })
    }

    /// The holding with the prayer mint paid and the idle fade applied (moving the faded NEAR to the council).
    pub(crate) fn settled(&mut self, g: &mut House, who: &AccountId) -> Holding {
        let mut h = self.holding(g.id, who);
        self.settle_pub(g, &mut h);
        h
    }

    pub(crate) fn settle_view(&self, g: &mut House, who: &AccountId) -> Holding {
        let mut h = self.holding(g.id, who);
        self.settle_pub(g, &mut h);
        h
    }

    pub(crate) fn settle_pub(&self, g: &mut House, h: &mut Holding) {
        // Pay the prayer mint and alms owed to this fealty, up to the end of the age it was earned in.
        let mark = |marks: &Vec<(u32, u128)>, now: u128| marks.iter().find(|(a, _)| *a == h.standing_age).map(|(_, v)| *v).unwrap_or(now);
        let (end_acc, end_alms) = if h.standing_age == self.age { (g.acc, g.alms_acc) } else { (mark(&g.acc_marks, g.acc), mark(&g.alms_marks, g.alms_acc)) };
        if h.standing > 0 {
            if end_acc > h.debt {
                h.coins += mul_div(h.standing, end_acc - h.debt, COIN);
            }
            if end_alms > h.alms_debt {
                h.alms_owed += mul_div(h.standing, end_alms - h.alms_debt, COIN);
            }
        }
        // A new age: fealty starts again (the old figure is kept for the crown).
        if h.standing_age != self.age {
            if h.standing > 0 {
                h.prev_standing = h.standing;
                h.prev_age = h.standing_age;
            }
            h.standing = 0;
            h.standing_age = self.age;
        }
        h.debt = g.acc;
        h.alms_debt = g.alms_acc;
        // Idle fade, for the seasons past the idle window not yet applied.
        let from = (h.idle_base + self.rules.idle_after as u64).max(h.faded_to);
        if g.alive && h.coins > 0 && self.gseason > from {
            let n = self.gseason - from;
            let keep = pow_bps(10_000 - self.rules.idle_fade_bps, n);
            let kept = mul_div(h.coins, keep, COIN);
            let lost = h.coins - kept;
            if lost > 0 && g.supply > 0 {
                let backing = mul_div(lost, g.reserve, g.supply);
                g.supply -= lost;
                g.reserve -= backing;
                g.council_due += backing;
                h.coins = kept;
            }
        }
        h.faded_to = h.faded_to.max(self.gseason);
    }

    pub(crate) fn elders_of(&self, g: &House) -> Vec<AccountId> {
        g.top
            .iter()
            .filter(|(a, _)| !g.barred.iter().any(|(b, until)| b == a && *until > self.gseason))
            .take(ELDER_SEATS)
            .map(|(a, _)| a.clone())
            .collect()
    }

    pub(crate) fn house_view(&self, g: &House) -> near_sdk::serde_json::Value {
        let t = &g.folk;
        near_sdk::serde_json::json!({
            "id": g.id, "name": g.name, "seat": g.seat, "founder": g.founder, "alive": g.alive, "born_age": g.born_age, "faded_at": g.faded_at,
            "reserve": U128(g.reserve), "supply": U128(g.supply), "price": U128(if g.supply > 0 { mul_div(COIN, g.reserve, g.supply) } else { 0 }),
            "minted": U128(g.minted), "burned": U128(g.burned),
            "folk": {"pop": t.pop, "food": t.food, "land": t.land, "morale": t.morale, "fealty": t.fealty, "army": t.army, "sellswords": t.sellswords, "weather": t.weather},
            "believers": t.pop * t.fealty / U,
            "stance": g.stance, "chief": g.chief, "fealty_total": U128(g.standing_total),
            "council": {"dao": g.council_dao, "due": U128(g.council_due), "works": g.works, "bounty_on": g.bounty_on, "bounty_each": U128(g.bounty_each), "bounty_left": U128(g.bounty_left), "pacts": g.pacts, "envoy": g.envoy},
            "casts": g.casts,
        })
    }
}
