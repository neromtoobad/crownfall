//! Crownfall on NEAR: the realm of Vael's ledger.
//!
//! - **Eight houses, eight coins.** Each coin's price is its house's NEAR reserve divided by its supply. Buying adds
//!   NEAR and mints coin at that price; selling burns coin and pays NEAR back, so a house never owes more than it holds.
//!   A 5% fee on every trade: 3 points stay in the reserve (the price rises for holders), 2 go to the crown pool.
//!   The coins are NEP-245 multi-tokens on this contract (`mt_*`, token ids `heron`, `boar`, … `hawk`), so wallets,
//!   other contracts and NEAR Intents can hold and move them.
//! - **Play to burn.** Every round of a hall game burns the house's coin (`enter`). Burning shrinks supply against the
//!   same reserve, so every round played raises the price for everyone who holds that house. Coin burned is favour for
//!   the house: the only favour there is.
//! - **The Library.** A wager the contract settles itself: stake 0.01–1 NEAR and your five dice are rolled from that
//!   block. Bid how many of one face lie under both cups; Haseeb's five are rolled from the block that takes your bid,
//!   so neither of you could know them. A true bid pays fair odds less 5%, from the Library's own bank; a false one
//!   goes to the bank. Only a win the chain decided counts for the Library seal.
//! - **The Seven Wardens' seals** are kept per account. Mint needs a coin bought and a round played; Bridge,
//!   Lighthouse and Library a won round of that hall's game; Hippodrome a bet on a race here; the Throne the other six
//!   and wins in three halls.
//! - **The Mumtaz Hippodrome.** Races are bet on in NEAR (pari-mutuel) and whipped by burning coin. A race's seed is
//!   drawn from the block that starts it, after betting has closed, so nobody who bet could have known how it would
//!   run. `settle` runs the race itself in the contract (`sim.rs`, the same code the browser draws), so the result is
//!   the chain's, not a server's.
//! - **The Ashen Throne.** When a season ends the house with the most favour is crowned, and the crown pool goes to
//!   that house's players in proportion to their favour. Shares left unclaimed when the next season ends roll into
//!   that season's pool; race winnings left unclaimed 100 races later go to the crown pool.
//!
//! What is NOT proven here: a hall round's result (outside the Library) is reported by the player's own client
//! (`finish`). So such a win moves no money and no favour: it counts for the seals and for the house's tally of wins,
//! nothing else. NEAR only moves on what the chain itself computes: the curve, burns, races, the Library's dice, the
//! Gate's toll, and the crown.
//!
//! Storage: a record a player's deposit creates (an account's first holding of a coin, its player record, its ticket
//! for a race) costs a flat 0.0025 NEAR taken from that deposit. Races older than 100 are deleted as new ones are
//! called, so the race book doesn't grow without end.
//!
//! Amounts: NEAR in yoctoNEAR, coin in yocto-coin (24 decimals).

use near_sdk::json_types::U128;
use near_sdk::serde_json::{json, Value};
use near_sdk::store::{LookupMap, Vector};
use market::Stall;
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
};

pub mod halls;
pub mod market;
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
/// The least NEAR a purchase takes (it pays for its records first).
pub const MIN_BUY: u128 = NEAR / 100;
/// Storage for one new record (a holding, a player, a ticket), taken from the deposit that creates it: 250 bytes at
/// NEAR's 10^19 yoctoNEAR a byte. A test checks that no record, even for a 64-character account, outgrows it.
pub const RECORD_FEE: u128 = NEAR / 400;
/// Coin burned for one whip at the Hippodrome.
pub const WHIP_COINS: u128 = 200 * COIN;
pub const WHIPS_PER_RACE: u8 = 3;
/// Betting is open this long after a race is called, then the teams are off.
pub const BET_SECS: u64 = 90;
/// Whips count only in the first part of the run (no race is shorter than this), counted from the start.
pub const WHIP_SECS: u64 = 40;
/// A race this many races old is deleted when a new one is called; what its winners left unclaimed goes to the crown.
pub const RACE_KEEP: u32 = 100;
/// A round must be finished within the hour, or it counts as lost.
const ROUND_SECS: u64 = 3600;
const SEC: u64 = 1_000_000_000;
const GAS_ON_TRANSFER: Gas = Gas::from_tgas(35);
const GAS_RESOLVE: Gas = Gas::from_tgas(15);

pub const NAMES: [&str; HOUSES] = ["Ashveil", "Corrin", "Velmont", "Thorne", "Halloway", "Draven", "Marrow", "Sorrel"];
pub const TICKERS: [&str; HOUSES] = ["HERON", "BOAR", "RAM", "ASP", "OWL", "BULL", "LYNX", "HAWK"];
pub const GAMES: [&str; 9] = ["signals", "axes", "cups", "asp", "archery", "forge", "stones", "falcon", "dice"];
/// Coin burned for one round in each house's hall.
pub const ENTRY: [u128; HOUSES] = [400 * COIN, 400 * COIN, 400 * COIN, 400 * COIN, 400 * COIN, 400 * COIN, 500 * COIN, 400 * COIN];
/// The least and most NEAR one wager in the Library takes.
pub const LIBRARY_MIN: u128 = NEAR / 100;
pub const LIBRARY_MAX: u128 = NEAR;
/// The Library keeps 5% of a fair payout.
pub const LIBRARY_EDGE_BPS: u128 = 500;
/// Out of 6^5 = 7776 rolls of Haseeb's five dice, how many show at least k of one face (k = 1..5).
pub const LIBRARY_ODDS: [u128; 5] = [4651, 1526, 276, 26, 1];
/// The toll to pass the Gate: its trial is a drive the chain can't see, so the seal is paid for. It goes to the crown.
pub const GATE_TOLL: u128 = NEAR / 100;
/// The Library's bank and its open cups live in raw storage beside the realm's state (no migration needed).
const LIB_BANK: &[u8] = b"lib:bank";
/// A judged hall round's seed (see halls.rs), rolled at `enter` and dropped at `finish`.
fn hall_key(round: u64) -> Vec<u8> {
    [b"hall:seed:".as_slice(), &round.to_le_bytes()].concat()
}
fn lib_key(round: u64) -> Vec<u8> {
    [b"lib:cup:".as_slice(), &round.to_le_bytes()].concat()
}
/// Five dice from a block's randomness, mixed with the round (two stakes in one block differ) and whose cup it is.
pub fn roll5(seed: &[u8], round: u64, cup: u8) -> [u8; 5] {
    let h = env::sha256(&[seed, &round.to_le_bytes(), &[cup]].concat());
    let mut out = [0u8; 5];
    let mut n = 0;
    // 252 = 42 × 6: bytes above it are skipped so every face is equally likely.
    for &b in h.iter() {
        if b < 252 && n < 5 {
            out[n] = b % 6 + 1;
            n += 1;
        }
    }
    require!(n == 5, "unlucky hash");
    out
}
/// What a true bid pays back in all (stake included), when Haseeb must show `need` more of the face.
pub fn library_pays(stake: u128, need: u8) -> u128 {
    require!((1..=5).contains(&need), "bid one to five more than you hold");
    let fair = mul_div(stake, 7776, LIBRARY_ODDS[need as usize - 1]);
    fair - fair * LIBRARY_EDGE_BPS / 10_000
}
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
    Players2,
    Races2,
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
    /// Rounds won in this house's hall, as their players reported them. A tally only: it pays nothing.
    pub wins: u64,
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
    /// You have backed a team in a race here.
    pub raced: bool,
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

/// Your five dice in the Library, rolled when you stake, and the block they came from.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct LibCup {
    pub mine: [u8; 5],
    pub height: u64,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Race {
    pub n: u32,
    /// 0 until the race starts: it is drawn from the starting block, after betting has closed.
    pub seed: u32,
    pub laps: u8,
    pub called_ns: u64,
    pub off_ns: u64,
    /// When the seed was drawn (0 until then). Whip ticks count from here.
    pub started_ns: u64,
    pub pools: [u128; HOUSES],
    pub whips: Vec<(u32, u8)>,
    pub settled: bool,
    pub order: Vec<u8>,
    /// Finish times in milliseconds after the start (0 if a team never finished).
    pub finish_ms: Vec<u32>,
    /// What the winners share (the pools less the 5% that goes to the crown).
    pub payout: u128,
    /// What the winners have claimed so far.
    pub claimed: u128,
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

// ---------- The first version's layout, read once by `migrate` ----------

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct HouseV1 {
    pub reserve: u128,
    pub supply: u128,
    pub burned: u128,
    pub rounds: u64,
    pub favour: u128,
    pub fav_season: u32,
}

#[near(serializers = [borsh])]
#[derive(Clone, Default)]
pub struct PlayerV1 {
    pub seals: u8,
    pub halls_won: u16,
    pub plays: u32,
    pub wins: u32,
    pub bought: bool,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct RaceV1 {
    pub n: u32,
    pub seed: u32,
    pub laps: u8,
    pub called_ns: u64,
    pub off_ns: u64,
    pub pools: [u128; HOUSES],
    pub whips: Vec<(u32, u8)>,
    pub settled: bool,
    pub order: Vec<u8>,
    pub finish_ms: Vec<u32>,
    pub payout: u128,
}

#[near(serializers = [borsh])]
pub struct RealmV1 {
    pub owner: AccountId,
    pub houses: Vec<HouseV1>,
    pub holdings: LookupMap<(u8, AccountId), Holding>,
    pub players: LookupMap<AccountId, PlayerV1>,
    pub rounds: LookupMap<u64, Round>,
    pub next_round: u64,
    pub races: Vector<RaceV1>,
    pub tickets: LookupMap<(u32, AccountId), Ticket>,
    pub pool: u128,
    pub season: u32,
    pub season_secs: u64,
    pub season_ends_ns: u64,
    pub seasons: Vector<Season>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Realm {
    pub owner: AccountId,
    pub houses: Vec<House>,
    pub holdings: LookupMap<(u8, AccountId), Holding>,
    /// Players from the first version, moved to `players2` the next time they play.
    pub players: LookupMap<AccountId, PlayerV1>,
    pub rounds: LookupMap<u64, Round>,
    pub next_round: u64,
    /// Races from the first version (their seed was drawn at the call). Kept, and still settled and claimed.
    pub races: Vector<RaceV1>,
    pub tickets: LookupMap<(u32, AccountId), Ticket>,
    pub pool: u128,
    pub season: u32,
    pub season_secs: u64,
    pub season_ends_ns: u64,
    pub seasons: Vector<Season>,
    pub players2: LookupMap<AccountId, Player>,
    /// Races since, by number. Only the last RACE_KEEP are kept.
    pub races2: LookupMap<u32, Race>,
    pub race_count: u32,
    pub legacy_races: u32,
    /// Seasons whose crown claims have closed (their leftover rolled into the next pool).
    pub seasons_closed: u32,
}

pub(crate) fn event(name: &str, data: Value) {
    env::log_str(&format!("EVENT_JSON:{}", json!({"standard": "crownfall", "version": "2", "event": name, "data": data})));
}

/// A NEP-245 event (mt_mint, mt_burn, mt_transfer).
pub(crate) fn mt_event(name: &str, data: Value) {
    env::log_str(&format!("EVENT_JSON:{}", json!({"standard": "nep245", "version": "1.0.0", "event": name, "data": [data]})));
}

/// The NEP-245 token id of a house's coin.
pub fn token_of(h: usize) -> String {
    TICKERS[h].to_lowercase()
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

#[ext_contract(ext_mt_receiver)]
pub trait MtReceiver {
    fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>>;
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
                wins: 0,
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
            season_ends_ns: env::block_timestamp() + season_secs * SEC,
            seasons: Vector::new(Key::Seasons),
            players2: LookupMap::new(Key::Players2),
            races2: LookupMap::new(Key::Races2),
            race_count: 0,
            legacy_races: 0,
            seasons_closed: 0,
        }
    }

    /// Upgrade the first version's state in place: holdings, rounds, tickets and seasons keep their layout; houses
    /// gain a win tally; old races and players are read as they are and moved over as they're touched.
    #[init(ignore_state)]
    #[private]
    pub fn migrate() -> Self {
        let old: RealmV1 = env::state_read().unwrap_or_else(|| env::panic_str("no state to migrate"));
        let n = old.races.len();
        let houses = old
            .houses
            .iter()
            .map(|g| House { reserve: g.reserve, supply: g.supply, burned: g.burned, rounds: g.rounds, favour: g.favour, fav_season: g.fav_season, wins: 0 })
            .collect();
        event("migrated", json!({"version": "2", "legacy_races": n}));
        Self {
            owner: old.owner,
            houses,
            holdings: old.holdings,
            players: old.players,
            rounds: old.rounds,
            next_round: old.next_round,
            races: old.races,
            tickets: old.tickets,
            pool: old.pool,
            season: old.season,
            season_secs: old.season_secs,
            season_ends_ns: old.season_ends_ns,
            seasons: old.seasons,
            players2: LookupMap::new(Key::Players2),
            races2: LookupMap::new(Key::Races2),
            race_count: n,
            legacy_races: n,
            seasons_closed: 0,
        }
    }

    pub fn version(&self) -> String {
        "5".into()
    }

    // ---------- Coin ----------

    /// Buy house coin with the attached NEAR at the current price. An account's first purchase of a house's coin
    /// (and its first purchase of all) pays for the record it opens, out of the deposit.
    #[payable]
    pub fn buy(&mut self, house: u8, min_out: Option<U128>) -> U128 {
        let who = env::predecessor_account_id();
        let deposit = env::attached_deposit().as_yoctonear();
        require!(deposit >= MIN_BUY, "attach at least 0.01 NEAR");
        let h = self.house_idx(house);
        let records = (!self.holdings.contains_key(&(house, who.clone()))) as u128 + (!self.has_player(&who)) as u128;
        let paid = deposit - records * RECORD_FEE;
        let fee = paid * FEE_BPS / 10_000;
        let to_pool = paid * FEE_POOL_BPS / 10_000;
        let net = paid - fee;
        let now = env::block_timestamp();
        let mut st = self.stall(h);
        let demand = market::demand_now(&st, now);
        let g = &mut self.houses[h];
        // Fair value × the merchant's factor (market.rs).
        let got = mul_div(mul_div(net, g.supply, g.reserve), market::FACTOR_ONE, market::factor(demand));
        require!(got >= min_out.map(|m| m.0).unwrap_or(0), "the price moved");
        g.reserve += paid - to_pool;
        g.supply += got;
        self.pool += to_pool;
        let reserve = g.reserve;
        st.demand = demand + net as i128;
        st.at_ns = now;
        if st.shut {
            if market::reopens(reserve, st.peak) {
                st.shut = false;
                st.peak = reserve;
                event("reopened", json!({"house": house, "by": who, "reserve": U128(reserve)}));
            }
        } else {
            st.peak = st.peak.max(reserve);
        }
        self.set_stall(h, &st);
        let mut hold = self.holding(house, &who);
        hold.coins += got;
        self.holdings.insert((house, who.clone()), hold);
        let mut p = self.player(&who);
        p.bought = true;
        self.put_player(&who, p);
        event("buy", json!({"house": house, "who": who, "near": U128(paid), "coins": U128(got)}));
        mt_event("mt_mint", json!({"owner_id": who, "token_ids": [token_of(h)], "amounts": [U128(got)]}));
        U128(got)
    }

    /// Sell house coin back for NEAR.
    pub fn sell(&mut self, house: u8, amount: U128, min_out: Option<U128>) -> Promise {
        let who = env::predecessor_account_id();
        let h = self.house_idx(house);
        let mut hold = self.holding(house, &who);
        require!(amount.0 > 0 && amount.0 <= hold.coins, "you don't hold that much");
        let now = env::block_timestamp();
        let mut st = self.stall(h);
        require!(!st.shut, "this house is shut: a run drained its purse. Buying its coin reopens it");
        let demand = market::demand_now(&st, now);
        let g = &mut self.houses[h];
        // A house trading for the first time under this rule starts its peak where its purse stands.
        st.peak = st.peak.max(g.reserve);
        // Fair value × the merchant's factor, never above fair value (market.rs).
        let gross = mul_div(mul_div(amount.0, g.reserve, g.supply), market::sell_factor(demand), market::FACTOR_ONE);
        let fee = gross * FEE_BPS / 10_000;
        let to_pool = gross * FEE_POOL_BPS / 10_000;
        let out = gross - fee;
        require!(out >= min_out.map(|m| m.0).unwrap_or(0), "the price moved");
        g.supply -= amount.0;
        g.reserve -= out + to_pool;
        self.pool += to_pool;
        let reserve = g.reserve;
        st.demand = demand - gross as i128;
        st.at_ns = now;
        if market::breaks(reserve, st.peak) {
            st.shut = true;
            event("shut", json!({"house": house, "by": who, "reserve": U128(reserve)}));
        }
        self.set_stall(h, &st);
        hold.coins -= amount.0;
        self.holdings.insert((house, who.clone()), hold);
        event("sell", json!({"house": house, "who": who, "coins": amount, "near": U128(out)}));
        mt_event("mt_burn", json!({"owner_id": who, "token_ids": [token_of(h)], "amounts": [amount]}));
        Promise::new(who).transfer(NearToken::from_yoctonear(out))
    }

    // ---------- Hall games ----------

    /// Start a round in a house's hall: its entry is burned from your coin, and the burn is favour for the house.
    /// Returns the round's id. No deposit, so a game's signless key can call it.
    pub fn enter(&mut self, house: u8) -> u64 {
        let who = env::predecessor_account_id();
        let h = self.house_idx(house);
        let cost = ENTRY[h];
        require!(!self.stall(h).shut, "this hall is shut: a run broke its house. Buying its coin at the Warwick Mint reopens it");
        self.burn(&who, h, cost, "not enough coin for the entry: buy some at the Warwick Mint");
        self.houses[h].rounds += 1;
        let id = self.open_round(&who, house, cost);
        if halls::judged(house) {
            // The round is played from this seed, so the chain can replay it at `finish` and judge the win itself.
            let hsh = env::sha256(&[env::random_seed().as_slice(), &id.to_le_bytes(), b"hall"].concat());
            let seed = u32::from_le_bytes([hsh[0], hsh[1], hsh[2], hsh[3]]);
            env::storage_write(&hall_key(id), &seed.to_le_bytes());
            event("enter", json!({"round": id, "house": house, "game": GAMES[h], "who": who, "burned": U128(cost), "seed": seed}));
        } else {
            event("enter", json!({"round": id, "house": house, "game": GAMES[h], "who": who, "burned": U128(cost)}));
        }
        id
    }

    /// Sit down at Haseeb's table in the Library with 0.01–1 NEAR attached. Your five dice are rolled from this block
    /// (they're in the event and in `get_library`); Haseeb's aren't rolled until you bid.
    #[payable]
    pub fn stake(&mut self) -> u64 {
        let who = env::predecessor_account_id();
        let amount = env::attached_deposit().as_yoctonear();
        require!((LIBRARY_MIN..=LIBRARY_MAX).contains(&amount), "stake 0.01 to 1 NEAR");
        let id = self.open_round(&who, LIBRARY, amount);
        let cup = LibCup { mine: roll5(&env::random_seed(), id, 0), height: env::block_height() };
        env::storage_write(&lib_key(id), &near_sdk::borsh::to_vec(&cup).unwrap());
        event("stake", json!({"round": id, "who": who, "near": U128(amount), "dice": cup.mine}));
        id
    }

    /// Fund the Library's bank (anyone). Wins are paid from it, lost stakes go into it.
    #[payable]
    pub fn fund_library(&mut self) -> U128 {
        let near = env::attached_deposit().as_yoctonear();
        require!(near > 0, "attach some NEAR");
        let bank = self.bank() + near;
        self.set_bank(bank);
        event("library_funded", json!({"who": env::predecessor_account_id(), "near": U128(near), "bank": U128(bank)}));
        U128(bank)
    }

    /// End a round. `grade` is how good a win was, 0–100. The round's player reports it; anyone can close a round
    /// that has run past the hour, as lost. The chain can't see a hall game, so a reported win pays nothing: it marks
    /// the hall as won (for the seals) and adds to the house's tally of wins.
    ///
    /// In the Library `won` is ignored: the player's `bid` [count, face] is settled here. Haseeb's five dice are rolled
    /// from this block; if both cups show at least `count` of `face`, the bid pays fair odds less 5%. No bid (walking
    /// out) or a late close loses the stake to the Library's bank.
    ///
    /// The Cups and Signals halls are judged by the chain: `won` and `grade` are ignored there, and `play` (the cup
    /// lifted each round, or every lamp answered) is replayed against the round's seed to decide the win (halls.rs).
    pub fn finish(&mut self, round: u64, won: bool, grade: Option<u8>, bid: Option<(u8, u8)>, play: Option<Vec<u8>>) -> Value {
        let who = env::predecessor_account_id();
        let r = self.rounds.remove(&round).unwrap_or_else(|| env::panic_str("no such round, or it's over"));
        let late = env::block_timestamp() > r.at_ns + ROUND_SECS * SEC;
        require!(who == r.who || late, "not your round");
        if r.hall == LIBRARY {
            let bid = if late || who != r.who { None } else { bid };
            return self.close_library(round, r, bid);
        }
        let mine = !late && who == r.who;
        let seed = env::storage_read(&hall_key(round)).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]));
        let (won, grade, judged) = match seed {
            Some(seed) => {
                env::storage_remove(&hall_key(round));
                let play = play.unwrap_or_default();
                require!(play.len() <= 128, "too many moves for one round");
                let (w, g, score) = if mine { halls::judge(r.hall, seed, &play) } else { (false, 0, 0) };
                (w, g, Some((seed, score)))
            }
            // A round entered before the hall was judged (or a hall the chain can't see): the player's word.
            None => (won && mine, grade.unwrap_or(50).min(100), None),
        };
        let mut p = self.player(&r.who);
        if won {
            p.wins += 1;
            p.halls_won |= 1 << r.hall;
            self.houses[r.hall as usize].wins += 1;
        }
        self.put_player(&r.who, p);
        match judged {
            Some((seed, score)) => {
                event("finish", json!({"round": round, "who": r.who, "hall": r.hall, "won": won, "grade": grade, "judged": true, "seed": seed, "score": score}));
                json!({"round": round, "won": won, "judged": true, "score": score})
            }
            None => {
                event("finish", json!({"round": round, "who": r.who, "hall": r.hall, "won": won, "grade": grade}));
                json!({"round": round, "won": won})
            }
        }
    }

    // ---------- The Seven Wardens ----------

    /// Take a Warden's seal. Each one checks what the chain can see. (The Gate's trial is the drive in from the gate,
    /// which the chain can't see, so its seal takes a 0.01 NEAR toll for the crown pool instead.)
    #[payable]
    pub fn seal(&mut self, seal: u8) {
        let who = env::predecessor_account_id();
        require!((seal as usize) < SEALS.len(), "no such seal");
        let paid = env::attached_deposit().as_yoctonear();
        if seal == 0 {
            require!(paid == GATE_TOLL, "the Gate's toll is 0.01 NEAR");
            self.pool += paid;
        } else {
            require!(paid == 0, "this seal takes no NEAR");
        }
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
            5 => {
                require!(has(&p, 1), "Warwick's seal first");
                require!(p.raced, "back a team in a race at the Hippodrome first");
            }
            _ => {
                require!(p.seals & 0b11_1111 == 0b11_1111, "the six other seals first");
                require!((p.halls_won & 0xff).count_ones() >= 3, "win in three houses' halls");
            }
        }
        p.seals |= 1 << seal;
        self.put_player(&who, p);
        event("seal", json!({"who": who, "seal": SEALS[seal as usize]}));
    }

    // ---------- The Mumtaz Hippodrome ----------

    /// Call the next race (anyone, once the last one is settled). Betting opens; the seed isn't drawn yet. The race
    /// RACE_KEEP back is deleted, and whatever its winners never claimed goes to the crown pool.
    pub fn call_race(&mut self) -> u32 {
        if let Some(last) = self.race_count.checked_sub(1) {
            require!(self.race(last).settled, "the last race isn't settled yet");
        }
        let n = self.race_count;
        if let Some(old) = n.checked_sub(RACE_KEEP).filter(|&o| o >= self.legacy_races) {
            if let Some(r) = self.races2.remove(&old) {
                let left = r.payout.saturating_sub(r.claimed);
                self.pool += left;
                if left > 0 {
                    event("unclaimed", json!({"race": old, "near": U128(left)}));
                }
            }
        }
        let now = env::block_timestamp();
        let laps = CUP_LAPS[n as usize % CUP_LAPS.len()];
        let race = Race {
            n,
            seed: 0,
            laps,
            called_ns: now,
            off_ns: now + BET_SECS * SEC,
            started_ns: 0,
            pools: [0; HOUSES],
            whips: vec![],
            settled: false,
            order: vec![],
            finish_ms: vec![],
            payout: 0,
            claimed: 0,
        };
        self.races2.insert(n, race);
        self.race_count += 1;
        event("race", json!({"n": n, "laps": laps, "off_ns": U128((now + BET_SECS * SEC) as u128)}));
        n
    }

    /// Back a team with the attached NEAR, before the off. Your first bet in a race pays for its ticket (0.0025 NEAR,
    /// and as much again for a player record if you have none) out of the stake.
    #[payable]
    pub fn bet(&mut self, race: u32, house: u8) {
        let who = env::predecessor_account_id();
        let deposit = env::attached_deposit().as_yoctonear();
        require!(deposit >= NEAR / 100, "bet at least 0.01 NEAR");
        let h = self.house_idx(house);
        let mut r = self.race(race);
        require!(env::block_timestamp() < r.off_ns, "they're off: betting is closed");
        let key = (race, who.clone());
        let records = (!self.tickets.contains_key(&key)) as u128 + (!self.has_player(&who)) as u128;
        let amt = deposit - records * RECORD_FEE;
        r.pools[h] += amt;
        self.put_race(r);
        let mut t = self.tickets.get(&key).cloned().unwrap_or_default();
        t.bets[h] += amt;
        self.tickets.insert(key, t);
        let mut p = self.player(&who);
        if !p.raced {
            p.raced = true;
            self.put_player(&who, p);
        }
        event("bet", json!({"race": race, "house": house, "who": who, "near": U128(amt)}));
    }

    /// Start a race once betting has closed: its seed is drawn from this block. Anyone may call it; a whip or a settle
    /// starts it too if nobody has.
    pub fn start_race(&mut self, race: u32) -> u32 {
        let mut r = self.race(race);
        require!(env::block_timestamp() >= r.off_ns, "betting is still open");
        require!(r.started_ns == 0, "already started");
        self.start(&mut r);
        let seed = r.seed;
        self.put_race(r);
        seed
    }

    /// Crack a whip over a team during the run: it burns that house's coin from you. Only for those holding a ticket
    /// on the race (back a team first).
    pub fn whip(&mut self, race: u32, house: u8) -> u32 {
        let who = env::predecessor_account_id();
        let h = self.house_idx(house);
        let mut r = self.race(race);
        let now = env::block_timestamp();
        require!(now >= r.off_ns, "they aren't off yet");
        if r.started_ns == 0 {
            self.start(&mut r);
        }
        require!(now < r.started_ns + WHIP_SECS * SEC, "too late to whip");
        let key = (race, who.clone());
        let mut t = self.tickets.get(&key).cloned().unwrap_or_else(|| env::panic_str("back a team in this race to crack the whip"));
        require!(t.whips < WHIPS_PER_RACE, "three whips a race");
        self.burn(&who, h, WHIP_COINS, "a whip burns 200 of that house's coin");
        t.whips += 1;
        self.tickets.insert(key, t);
        // The tick the whip lands on: tenths of a second since the start, plus one (the sim's next tick).
        let tick = ((now - r.started_ns) / 100_000_000) as u32 + 1;
        r.whips.push((tick, house));
        self.put_race(r);
        event("whip", json!({"race": race, "house": house, "who": who, "tick": tick}));
        tick
    }

    /// Run the race on chain and fix the result (anyone, once the whip window has closed). A race nobody started is
    /// started here, and run without whips, once a whole whip window has passed since the off.
    pub fn settle(&mut self, race: u32) -> Vec<u8> {
        let mut r = self.race(race);
        require!(!r.settled, "already settled");
        let now = env::block_timestamp();
        if r.started_ns == 0 {
            require!(now >= r.off_ns + WHIP_SECS * SEC, "the race is still on");
            self.start(&mut r);
        } else {
            require!(now >= r.started_ns + WHIP_SECS * SEC, "the race is still on");
        }
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
        event("settle", json!({"race": race, "seed": r.seed, "order": out.order, "finish_ms": r.finish_ms, "pool": U128(total)}));
        self.put_race(r);
        out.order
    }

    /// Collect what your bets on a race's winner earned (within RACE_KEEP races; after that it's the crown's).
    pub fn claim_race(&mut self, race: u32) -> Promise {
        let who = env::predecessor_account_id();
        let mut r = self.race(race);
        require!(r.settled, "not settled yet");
        let mut t = self.tickets.get(&(race, who.clone())).cloned().unwrap_or_else(|| env::panic_str("no ticket"));
        require!(!t.claimed, "already claimed");
        let win = r.order[0] as usize;
        require!(t.bets[win] > 0, "you didn't back the winner");
        let amount = mul_div(r.payout, t.bets[win], r.pools[win]);
        t.claimed = true;
        self.tickets.insert((race, who.clone()), t);
        r.claimed += amount;
        self.put_race(r);
        event("claim_race", json!({"race": race, "who": who, "near": U128(amount)}));
        Promise::new(who).transfer(NearToken::from_yoctonear(amount))
    }

    // ---------- The Ashen Throne ----------

    /// End the season (anyone, once it's due): crown the house with the most favour and set the crown pool aside for
    /// its players. Claims on the season before close now, and what was left of its pool joins this one.
    pub fn end_season(&mut self) -> Option<u8> {
        let now = env::block_timestamp();
        require!(now >= self.season_ends_ns, "the season isn't over");
        let s = self.season;
        if s >= 2 && self.seasons_closed < s - 1 {
            if let Some(prev) = self.seasons.get(s - 2) {
                let left = prev.pool.0.saturating_sub(prev.claimed.0);
                self.pool += left;
                event("crown_rolled", json!({"season": s - 1, "near": U128(left)}));
            }
            self.seasons_closed = s - 1;
        }
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
        self.season_ends_ns = now + self.season_secs * SEC;
        crowned
    }

    /// Take your share of a season's crown pool, if you played for the crowned house. Open until the next season ends.
    pub fn claim_crown(&mut self, season: u32) -> Promise {
        let who = env::predecessor_account_id();
        require!(season > self.seasons_closed, "that season's claims have closed: what was left joined the next crown");
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

    // ---------- NEP-245: the house coins as multi-tokens ----------

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: String) -> U128 {
        U128(self.holding(self.token_house(&token_id), &account_id).coins)
    }

    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<String>) -> Vec<U128> {
        token_ids.iter().map(|t| U128(self.holding(self.token_house(t), &account_id).coins)).collect()
    }

    pub fn mt_supply(&self, token_id: String) -> Option<U128> {
        self.token_house_opt(&token_id).map(|h| U128(self.houses[h as usize].supply))
    }

    pub fn mt_batch_supply(&self, token_ids: Vec<String>) -> Vec<Option<U128>> {
        token_ids.iter().map(|t| self.token_house_opt(t).map(|h| U128(self.houses[h as usize].supply))).collect()
    }

    pub fn mt_token(&self, token_ids: Vec<String>) -> Vec<Option<Value>> {
        token_ids.iter().map(|t| self.token_house_opt(t).map(|h| json!({"token_id": token_of(h as usize), "owner_id": null}))).collect()
    }

    /// Send house coin. Attach 1 yoctoNEAR (the standard's confirmation), plus 0.0025 NEAR if the receiver holds none
    /// of that coin yet: it pays for the receiver's new holding. Coin moves, favour doesn't.
    #[payable]
    pub fn mt_transfer(&mut self, receiver_id: AccountId, token_id: String, amount: U128, approval: Option<(AccountId, u64)>, memo: Option<String>) {
        self.mt_batch_transfer(receiver_id, vec![token_id], vec![amount], approval.map(|a| vec![Some(a)]), memo);
    }

    #[payable]
    pub fn mt_batch_transfer(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
    ) {
        let sender = env::predecessor_account_id();
        self.move_coins(&sender, &receiver_id, &token_ids, &amounts, approvals.is_some(), memo);
    }

    #[payable]
    pub fn mt_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        self.mt_batch_transfer_call(receiver_id, vec![token_id], vec![amount], approval.map(|a| vec![Some(a)]), memo, msg)
    }

    /// Send house coin to a contract and tell it (`mt_on_transfer`); whatever it hands back as unused returns to you.
    #[payable]
    pub fn mt_batch_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        let sender = env::predecessor_account_id();
        let ids = self.move_coins(&sender, &receiver_id, &token_ids, &amounts, approvals.is_some(), memo);
        let owners = vec![sender.clone(); ids.len()];
        ext_mt_receiver::ext(receiver_id.clone())
            .with_static_gas(GAS_ON_TRANSFER)
            .mt_on_transfer(sender, owners.clone(), ids.clone(), amounts.clone(), msg)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_RESOLVE).mt_resolve_transfer(owners, receiver_id, ids, amounts, None))
            .into()
    }

    /// After `mt_on_transfer`: return what the receiver didn't use (as much of it as the receiver still holds).
    /// Returns what was used, per token.
    #[private]
    pub fn mt_resolve_transfer(
        &mut self,
        previous_owner_ids: Vec<AccountId>,
        receiver_id: AccountId,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        #[allow(unused_variables)] approvals: Option<Vec<Option<Vec<(AccountId, u64, U128)>>>>,
    ) -> Vec<U128> {
        let unused: Vec<U128> = env::promise_result_checked(0, 4096)
            .ok()
            .and_then(|v| near_sdk::serde_json::from_slice::<Vec<U128>>(&v).ok())
            .filter(|u| u.len() == amounts.len())
            .unwrap_or_else(|| amounts.clone());
        let mut used = Vec::with_capacity(amounts.len());
        for (i, t) in token_ids.iter().enumerate() {
            let h = self.token_house(t);
            let mut back = self.holding(h, &receiver_id);
            let refund = unused[i].0.min(amounts[i].0).min(back.coins);
            if refund > 0 {
                back.coins -= refund;
                self.holdings.insert((h, receiver_id.clone()), back);
                let owner = &previous_owner_ids[i];
                let mut mine = self.holding(h, owner);
                mine.coins += refund;
                self.holdings.insert((h, owner.clone()), mine);
                mt_event("mt_transfer", json!({"old_owner_id": receiver_id, "new_owner_id": owner, "token_ids": [token_of(h as usize)], "amounts": [U128(refund)]}));
            }
            used.push(U128(amounts[i].0 - refund));
        }
        used
    }

    pub fn mt_metadata_contract(&self) -> Value {
        json!({"spec": "mt-1.0.0", "name": "Crownfall house coins"})
    }

    pub fn mt_metadata_base_by_token_id(&self, token_ids: Vec<String>) -> Vec<Option<Value>> {
        token_ids.iter().map(|t| self.token_house_opt(t).map(|h| Self::base_meta(h as usize))).collect()
    }

    pub fn mt_metadata_token_all(&self, token_ids: Vec<String>) -> Vec<Option<Value>> {
        token_ids
            .iter()
            .map(|t| {
                self.token_house_opt(t).map(|h| {
                    let h = h as usize;
                    json!({"base": Self::base_meta(h), "token": {"title": format!("${}", TICKERS[h]),
                        "description": format!("The coin of House {} of Vael. Burned to play in its hall; priced by its reserve.", NAMES[h])}})
                })
            })
            .collect()
    }

    // ---------- Views ----------

    pub fn get_realm(&self) -> Value {
        let s = self.season;
        json!({
            "version": "4",
            "season": s,
            "season_ends_ns": U128(self.season_ends_ns as u128),
            "pool": U128(self.pool),
            "races": self.race_count,
            "houses": self.houses.iter().enumerate().map(|(i, g)| json!({
                "id": i, "name": NAMES[i], "coin": TICKERS[i], "token_id": token_of(i), "game": GAMES[i],
                "reserve": U128(g.reserve), "supply": U128(g.supply), "burned": U128(g.burned), "rounds": g.rounds,
                "wins": g.wins, "entry": U128(ENTRY[i]),
                "favour": U128(if g.fav_season == s { g.favour } else { 0 }),
                "market": self.market_of(i),
            })).collect::<Vec<_>>(),
            "rules": json!({"demand_half_secs": market::DEMAND_HALF_SECS, "depth": U128(market::DEPTH as u128),
                "factor_min": market::FACTOR_MIN, "factor_max": market::FACTOR_MAX, "run_bps": market::RUN_BPS, "reopen_bps": market::REOPEN_BPS}),
        })
    }

    /// The seed a judged hall round (Cups, Signals) is played from: rolled at `enter`, gone once it's finished.
    pub fn hall_seed(&self, round: u64) -> Option<u32> {
        env::storage_read(&hall_key(round)).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    /// The Library: its bank, the stake limits, the odds, and (with `round`) your cup.
    pub fn get_library(&self, round: Option<u64>) -> Value {
        json!({
            "bank": U128(self.bank()),
            "min": U128(LIBRARY_MIN), "max": U128(LIBRARY_MAX), "edge_bps": LIBRARY_EDGE_BPS as u64,
            "odds": LIBRARY_ODDS.iter().map(|&n| n as u64).collect::<Vec<_>>(), "of": 7776,
            "cup": round.and_then(|id| self.cup(id)),
            "round": round.and_then(|id| self.rounds.get(&id).map(|r| json!({"who": r.who, "near": U128(r.amount), "at_ns": U128(r.at_ns as u128)}))),
        })
    }

    pub fn get_account(&self, account: AccountId) -> Value {
        let s = self.season;
        let p = self.player(&account);
        let holds: Vec<Value> = (0..HOUSES as u8)
            .map(|h| {
                let x = self.holdings.get(&(h, account.clone())).cloned().unwrap_or_default();
                json!({"coins": U128(x.coins), "favour": U128(if x.fav_season == s { x.favour } else { 0 })})
            })
            .collect();
        json!({
            "seals": SEALS.iter().enumerate().filter(|(i, _)| p.seals & (1 << i) != 0).map(|(_, s)| *s).collect::<Vec<_>>(),
            "halls_won": (0..9).filter(|h| p.halls_won & (1 << h) != 0).collect::<Vec<u8>>(),
            "plays": p.plays, "wins": p.wins, "bought": p.bought, "raced": p.raced,
            "houses": holds,
        })
    }

    pub fn get_race(&self, race: u32) -> Option<Value> {
        self.race_opt(race).map(|r| {
            json!({
                "n": r.n, "seed": r.seed, "laps": r.laps, "started": r.started_ns > 0,
                "called_ns": U128(r.called_ns as u128), "off_ns": U128(r.off_ns as u128), "started_ns": U128(r.started_ns as u128),
                "pools": r.pools.iter().map(|&p| U128(p)).collect::<Vec<_>>(),
                "whips": r.whips, "settled": r.settled, "order": r.order, "finish_ms": r.finish_ms, "payout": U128(r.payout),
                "claimed": U128(r.claimed),
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
    /// favour with it that season, your share, and whether you've taken it (or the claims have closed). None until the
    /// season has ended.
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
                    "share": U128(share), "claimed": claimed, "closed": season <= self.seasons_closed, "ended_ns": U128(s.ended_ns as u128)}))
    }

    /// Coin `near` would buy now (records aside), at the merchant's price.
    pub fn quote_buy(&self, house: u8, near: U128) -> U128 {
        let h = self.house_idx(house);
        let g = &self.houses[h];
        let d = market::demand_now(&self.stall(h), env::block_timestamp());
        U128(mul_div(mul_div(near.0 - near.0 * FEE_BPS / 10_000, g.supply, g.reserve), market::FACTOR_ONE, market::factor(d)))
    }

    /// NEAR `coins` would sell for now (0 while the house is shut).
    pub fn quote_sell(&self, house: u8, coins: U128) -> U128 {
        let h = self.house_idx(house);
        let g = &self.houses[h];
        let st = self.stall(h);
        if st.shut {
            return U128(0);
        }
        let d = market::demand_now(&st, env::block_timestamp());
        let gross = mul_div(mul_div(coins.0, g.reserve, g.supply), market::sell_factor(d), market::FACTOR_ONE);
        U128(gross - gross * FEE_BPS / 10_000)
    }

    /// Replay a race off chain with extra whips, to see what they would have done (the browser does this too). A
    /// race's seed only exists once betting has closed, so this can't tell a bettor anything.
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
    fn token_house_opt(&self, id: &str) -> Option<u8> {
        let id = id.to_ascii_uppercase();
        TICKERS.iter().position(|t| *t == id).map(|h| h as u8)
    }
    fn token_house(&self, id: &str) -> u8 {
        self.token_house_opt(id).unwrap_or_else(|| env::panic_str("no such token"))
    }
    fn base_meta(h: usize) -> Value {
        json!({"name": format!("House {} coin", NAMES[h]), "id": token_of(h), "symbol": TICKERS[h], "icon": null,
               "decimals": "24", "base_uri": null, "reference": null, "copies": null, "reference_hash": null})
    }
    fn holding(&self, house: u8, who: &AccountId) -> Holding {
        self.holdings.get(&(house, who.clone())).cloned().unwrap_or_default()
    }
    fn has_player(&self, who: &AccountId) -> bool {
        self.players2.contains_key(who) || self.players.contains_key(who)
    }
    fn player(&self, who: &AccountId) -> Player {
        if let Some(p) = self.players2.get(who) {
            return p.clone();
        }
        self.players
            .get(who)
            .map(|o| Player { seals: o.seals, halls_won: o.halls_won, plays: o.plays, wins: o.wins, bought: o.bought, raced: false })
            .unwrap_or_default()
    }
    fn put_player(&mut self, who: &AccountId, p: Player) {
        if self.players.contains_key(who) {
            self.players.remove(who);
        }
        self.players2.insert(who.clone(), p);
    }
    fn race_opt(&self, n: u32) -> Option<Race> {
        if n < self.legacy_races {
            return self.races.get(n).map(|o| Race {
                n: o.n,
                seed: o.seed,
                laps: o.laps,
                called_ns: o.called_ns,
                off_ns: o.off_ns,
                started_ns: o.off_ns,
                pools: o.pools,
                whips: o.whips.clone(),
                settled: o.settled,
                order: o.order.clone(),
                finish_ms: o.finish_ms.clone(),
                payout: o.payout,
                claimed: 0,
            });
        }
        self.races2.get(&n).cloned()
    }
    fn race(&self, n: u32) -> Race {
        self.race_opt(n).unwrap_or_else(|| env::panic_str("no such race (or it's more than 100 races old)"))
    }
    fn put_race(&mut self, r: Race) {
        if r.n < self.legacy_races {
            let o = RaceV1 {
                n: r.n,
                seed: r.seed,
                laps: r.laps,
                called_ns: r.called_ns,
                off_ns: r.off_ns,
                pools: r.pools,
                whips: r.whips,
                settled: r.settled,
                order: r.order,
                finish_ms: r.finish_ms,
                payout: r.payout,
            };
            self.races.replace(o.n, o);
        } else {
            self.races2.insert(r.n, r);
        }
    }
    /// Draw a race's seed from this block, now that betting has closed.
    fn start(&mut self, r: &mut Race) {
        let s = env::random_seed();
        r.seed = u32::from_le_bytes([s[0], s[1], s[2], s[3]]);
        r.started_ns = env::block_timestamp();
        event("start", json!({"race": r.n, "seed": r.seed, "started_ns": U128(r.started_ns as u128)}));
    }
    /// Burn a player's house coin: the supply shrinks against the same reserve, and the burn is favour for the house.
    fn burn(&mut self, who: &AccountId, h: usize, amount: u128, short: &str) {
        let mut hold = self.holding(h as u8, who);
        require!(hold.coins >= amount, short);
        hold.coins -= amount;
        self.add_favour(&mut hold, h, amount);
        self.holdings.insert((h as u8, who.clone()), hold);
        let g = &mut self.houses[h];
        g.supply -= amount;
        g.burned += amount;
        mt_event("mt_burn", json!({"owner_id": who, "token_ids": [token_of(h)], "amounts": [U128(amount)]}));
    }
    /// Move coin between accounts (NEP-245). Returns the token ids, normalised.
    fn move_coins(&mut self, from: &AccountId, to: &AccountId, token_ids: &[String], amounts: &[U128], approvals: bool, memo: Option<String>) -> Vec<String> {
        require!(!approvals, "approvals aren't supported: send your own coin");
        require!(from != to, "sender and receiver are the same");
        require!(!token_ids.is_empty() && token_ids.len() == amounts.len(), "token_ids and amounts must match");
        let mut opened = 0u128;
        let mut ids = Vec::with_capacity(token_ids.len());
        for (t, a) in token_ids.iter().zip(amounts) {
            let h = self.token_house(t);
            require!(a.0 > 0, "amount must be positive");
            let mut mine = self.holding(h, from);
            require!(mine.coins >= a.0, "you don't hold that much");
            mine.coins -= a.0;
            self.holdings.insert((h, from.clone()), mine);
            if !self.holdings.contains_key(&(h, to.clone())) {
                opened += 1;
            }
            let mut theirs = self.holding(h, to);
            theirs.coins += a.0;
            self.holdings.insert((h, to.clone()), theirs);
            ids.push(token_of(h as usize));
        }
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached >= 1, "attach 1 yoctoNEAR to confirm the transfer");
        require!(attached >= opened * RECORD_FEE, "the receiver holds none of that coin yet: attach 0.0025 NEAR for its new holding");
        let mut e = json!({"old_owner_id": from, "new_owner_id": to, "token_ids": ids, "amounts": amounts});
        if let Some(m) = memo {
            e["memo"] = json!(m);
        }
        mt_event("mt_transfer", e);
        ids
    }
    /// A merchant's stall (market.rs), in raw storage beside the realm's state.
    pub(crate) fn stall(&self, h: usize) -> Stall {
        env::storage_read(&[b"mkt:".as_slice(), &[h as u8]].concat())
            .map(|b| near_sdk::borsh::from_slice(&b).unwrap())
            .unwrap_or_default()
    }
    fn set_stall(&mut self, h: usize, st: &Stall) {
        env::storage_write(&[b"mkt:".as_slice(), &[h as u8]].concat(), &near_sdk::borsh::to_vec(st).unwrap());
    }
    /// What the merchant is doing now: demand, its buy and sell factors, and whether it's shut.
    fn market_of(&self, h: usize) -> Value {
        let st = self.stall(h);
        let d = market::demand_now(&st, env::block_timestamp());
        json!({"demand": d.to_string(), "factor": market::factor(d), "sell_factor": market::sell_factor(d), "shut": st.shut,
               "peak": U128(st.peak.max(self.houses[h].reserve))})
    }
    fn bank(&self) -> u128 {
        env::storage_read(LIB_BANK).map(|b| u128::from_le_bytes(b.try_into().unwrap())).unwrap_or(0)
    }
    fn set_bank(&mut self, v: u128) {
        env::storage_write(LIB_BANK, &v.to_le_bytes());
    }
    fn cup(&self, round: u64) -> Option<LibCup> {
        env::storage_read(&lib_key(round)).map(|b| near_sdk::borsh::from_slice(&b).unwrap())
    }
    fn close_library(&mut self, id: u64, r: Round, bid: Option<(u8, u8)>) -> Value {
        let Some(cup) = self.cup(id) else {
            // Staked before the Library rolled dice on chain: there's nothing to settle, so the stake goes back.
            Promise::new(r.who.clone()).transfer(NearToken::from_yoctonear(r.amount)).detach();
            event("finish", json!({"round": id, "who": r.who, "hall": LIBRARY, "won": false, "refunded": U128(r.amount)}));
            return json!({"round": id, "won": false, "refunded": U128(r.amount)});
        };
        let bank = self.bank();
        let Some((count, face)) = bid else {
            env::storage_remove(&lib_key(id));
            self.set_bank(bank + r.amount);
            event("finish", json!({"round": id, "who": r.who, "hall": LIBRARY, "won": false, "mine": cup.mine}));
            return json!({"round": id, "won": false, "mine": cup.mine});
        };
        require!((1..=6).contains(&face), "a face is 1 to 6");
        let have = cup.mine.iter().filter(|&&d| d == face).count() as u8;
        require!(count > have, "bid more than you hold yourself");
        let pays = library_pays(r.amount, count - have);
        require!(pays - r.amount <= bank / 2, "the Library's bank can't cover that bid: bid lower");
        require!(env::block_height() > cup.height, "Haseeb rolls in a later block than yours: try again");
        env::storage_remove(&lib_key(id));
        let his = roll5(&env::random_seed(), id, 1);
        let shown = have + his.iter().filter(|&&d| d == face).count() as u8;
        let won = shown >= count;
        let mut p = self.player(&r.who);
        if won {
            p.wins += 1;
            p.halls_won |= 1 << LIBRARY;
            self.set_bank(bank - (pays - r.amount));
            Promise::new(r.who.clone()).transfer(NearToken::from_yoctonear(pays)).detach();
        } else {
            self.set_bank(bank + r.amount);
        }
        self.put_player(&r.who, p);
        let paid = U128(if won { pays } else { 0 });
        event("finish", json!({"round": id, "who": r.who, "hall": LIBRARY, "won": won, "bid": [count, face], "mine": cup.mine, "his": his, "shown": shown, "paid": paid}));
        json!({"round": id, "won": won, "bid": [count, face], "mine": cup.mine, "his": his, "shown": shown, "paid": paid})
    }
    fn open_round(&mut self, who: &AccountId, hall: u8, amount: u128) -> u64 {
        let id = self.next_round;
        self.next_round += 1;
        self.rounds.insert(id, Round { who: who.clone(), hall, amount, at_ns: env::block_timestamp() });
        let mut p = self.player(who);
        p.plays += 1;
        self.put_player(who, p);
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
