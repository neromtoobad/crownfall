use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::testing_env;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(who: &str, deposit: u128, ts_secs: u64) {
    ctx_seed(who, deposit, ts_secs, 7);
}

fn ctx_seed(who: &str, deposit: u128, ts_secs: u64, seed: u8) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("realm.testnet"))
        .predecessor_account_id(acc(who))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(ts_secs * 1_000_000_000)
        .random_seed([seed; 32]);
    testing_env!(b.build());
}

const SEED7: u32 = u32::from_le_bytes([7, 7, 7, 7]);

fn realm() -> Realm {
    ctx("owner.testnet", 4 * NEAR, 1000);
    Realm::new(acc("owner.testnet"), Some(3600))
}

fn price(r: &Realm, h: usize) -> f64 {
    r.houses[h].reserve as f64 / r.houses[h].supply as f64
}

#[test]
fn sim_matches_js() {
    let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/race-fixture.json")).unwrap();
    let cases: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let cases = cases.as_array().unwrap();
    assert!(cases.len() >= 40);
    for (i, c) in cases.iter().enumerate() {
        let whips: Vec<sim::Whip> = c["whips"]
            .as_array()
            .unwrap()
            .iter()
            .map(|w| sim::Whip { tick: w[0].as_u64().unwrap() as u32, house: w[1].as_u64().unwrap() as u8 })
            .collect();
        let out = sim::run(c["seed"].as_u64().unwrap() as u32, c["laps"].as_u64().unwrap() as u8, &whips);
        let order: Vec<u8> = c["order"].as_array().unwrap().iter().map(|v| v.as_u64().unwrap() as u8).collect();
        let lanes: Vec<u8> = c["lanes"].as_array().unwrap().iter().map(|v| v.as_u64().unwrap() as u8).collect();
        assert_eq!(out.lanes, lanes, "race {i}: lanes");
        assert_eq!(out.order, order, "race {i}: order");
        assert_eq!(out.ticks as u64, c["ticks"].as_u64().unwrap(), "race {i}: ticks");
        for h in 0..8 {
            let js = c["finish"][h].as_f64();
            assert_eq!(out.finish[h].map(f64::to_bits), js.map(f64::to_bits), "race {i}: house {h} finish {:?} vs {:?}", out.finish[h], js);
        }
    }
}

#[test]
fn buying_and_burning_move_the_price() {
    let mut r = realm();
    let p0 = price(&r, 2);
    ctx("ana.testnet", NEAR, 1001);
    let got = r.buy(2, None).0;
    assert!(got > 0);
    let p1 = price(&r, 2);
    assert!(p1 > p0, "the fee left in the reserve lifts the price");
    // Ana's first purchase opened two records (her holding of RAM, her player record): they came out of the deposit.
    let paid = NEAR - 2 * RECORD_FEE;
    assert_eq!(r.pool, paid * 200 / 10_000);
    assert!(get_logs().iter().any(|l| l.contains("\"nep245\"") && l.contains("mt_mint") && l.contains("\"ram\"")));
    ctx("ana.testnet", NEAR, 1001);
    let pool = r.pool;
    r.buy(2, None);
    assert_eq!(r.pool - pool, NEAR * 200 / 10_000, "a second purchase opens nothing and pays no record fee");
    ctx("ana.testnet", 0, 1002);
    let held = r.holding(2, &acc("ana.testnet")).coins;
    let round = r.enter(2);
    let p2 = price(&r, 2);
    assert!(p2 > p1, "a burn lifts the price");
    assert_eq!(r.houses[2].burned, ENTRY[2]);
    assert_eq!(r.holding(2, &acc("ana.testnet")).coins, held - ENTRY[2]);
    assert!(get_logs().iter().any(|l| l.contains("mt_burn")));
    ctx("ana.testnet", 0, 1010);
    r.finish(round, true, Some(100), None);
    let hold = r.holding(2, &acc("ana.testnet"));
    assert_eq!(hold.favour, ENTRY[2], "favour is the coin burned: a reported win adds none");
    assert_eq!(r.houses[2].wins, 1, "the win goes on the house's tally");
    let p = r.player(&acc("ana.testnet"));
    assert_eq!((p.plays, p.wins, p.halls_won), (1, 1, 1 << 2));
    // Selling all of it back pays less than was paid in (the fees), and leaves the house solvent.
    ctx("ana.testnet", 0, 1011);
    let before = r.houses[2].reserve;
    let _ = r.sell(2, U128(hold.coins), None);
    assert!(r.houses[2].reserve < before);
    assert!(r.houses[2].reserve > NEAR / 2, "the founders' reserve is still there");
}

#[test]
#[should_panic(expected = "attach at least 0.01 NEAR")]
fn a_purchase_pays_for_its_records() {
    let mut r = realm();
    ctx("ana.testnet", NEAR / 1000, 1001);
    r.buy(0, None);
}

#[test]
fn a_reported_win_moves_no_money() {
    let mut r = realm();
    ctx("ana.testnet", NEAR, 1001);
    r.buy(4, None);
    ctx("bob.testnet", NEAR, 1001);
    r.buy(4, None);
    // Ana reports every round won and perfect; Bob reports every round lost. Same burns, same favour.
    for i in 0..3 {
        ctx("ana.testnet", 0, 1002 + i);
        let a = r.enter(4);
        r.finish(a, true, Some(100), None);
        ctx("bob.testnet", 0, 1002 + i);
        let b = r.enter(4);
        r.finish(b, false, None, None);
    }
    let fa = r.holding(4, &acc("ana.testnet")).favour;
    let fb = r.holding(4, &acc("bob.testnet")).favour;
    assert_eq!(fa, fb);
    assert_eq!(fa, 3 * ENTRY[4]);
}

#[test]
#[should_panic(expected = "not enough coin")]
fn no_coin_no_entry() {
    let mut r = realm();
    ctx("ana.testnet", 0, 1001);
    r.enter(0);
}

#[test]
#[should_panic(expected = "not your round")]
fn only_you_finish_your_round() {
    let mut r = realm();
    ctx("ana.testnet", NEAR, 1001);
    r.buy(0, None);
    ctx("ana.testnet", 0, 1002);
    let id = r.enter(0);
    ctx("bob.testnet", 0, 1003);
    r.finish(id, true, None, None);
}

#[test]
fn a_late_round_is_lost() {
    let mut r = realm();
    ctx("ana.testnet", NEAR, 1001);
    r.buy(0, None);
    ctx("ana.testnet", 0, 1002);
    let id = r.enter(0);
    ctx("bob.testnet", 0, 1002 + 3601);
    r.finish(id, true, None, None);
    assert_eq!(r.player(&acc("ana.testnet")).wins, 0);
}

fn ctx_at(who: &str, deposit: u128, ts_secs: u64, height: u64, seed: u8) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("realm.testnet"))
        .predecessor_account_id(acc(who))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(ts_secs * 1_000_000_000)
        .block_height(height)
        .random_seed([seed; 32]);
    testing_env!(b.build());
}

fn funded_library() -> Realm {
    let mut r = realm();
    ctx("owner.testnet", 10 * NEAR, 1000);
    r.fund_library();
    r
}

/// Stake, then bid `count` of the face you hold most of (or `face` if given), from a later block with `seed`.
fn wager(r: &mut Realm, who: &str, stake: u128, more: u8, seed: u8) -> (u64, Value) {
    ctx_at(who, stake, 1001, 10, 3);
    let id = r.stake();
    let cup = r.cup(id).unwrap();
    let face = (1..=6u8).max_by_key(|f| cup.mine.iter().filter(|&&d| d == *f).count()).unwrap();
    let have = cup.mine.iter().filter(|&&d| d == face).count() as u8;
    ctx_at(who, 0, 1002, 11, seed);
    let out = r.finish(id, false, None, Some((have + more, face)));
    (id, out)
}

#[test]
fn the_library_settles_the_bid_itself() {
    let mut r = funded_library();
    let bank = r.bank();
    let (id, out) = wager(&mut r, "ana.testnet", NEAR / 10, 1, 9);
    assert!(r.cup(id).is_none(), "the cup is cleared");
    let won = out["won"].as_bool().unwrap();
    // The result is the chain's: recount it from both cups.
    let face = out["bid"][1].as_u64().unwrap();
    let count = out["bid"][0].as_u64().unwrap();
    let all: Vec<u64> = out["mine"].as_array().unwrap().iter().chain(out["his"].as_array().unwrap()).map(|v| v.as_u64().unwrap()).collect();
    let shown = all.iter().filter(|&&d| d == face).count() as u64;
    assert_eq!(shown, out["shown"].as_u64().unwrap());
    assert_eq!(won, shown >= count);
    let pays = library_pays(NEAR / 10, 1);
    if won {
        assert_eq!(out["paid"], json!(U128(pays)));
        assert_eq!(r.bank(), bank - (pays - NEAR / 10));
        assert_ne!(r.player(&acc("ana.testnet")).halls_won & (1 << LIBRARY), 0);
    } else {
        assert_eq!(r.bank(), bank + NEAR / 10);
        assert_eq!(r.player(&acc("ana.testnet")).halls_won & (1 << LIBRARY), 0);
    }
}

#[test]
fn a_reported_win_counts_for_nothing_in_the_library() {
    let mut r = funded_library();
    let bank = r.bank();
    ctx_at("ana.testnet", NEAR / 10, 1001, 10, 3);
    let id = r.stake();
    ctx_at("ana.testnet", 0, 1002, 11, 4);
    let out = r.finish(id, true, Some(100), None);
    assert_eq!(out["won"], false, "no bid: the stake is lost whatever the client says");
    assert_eq!(r.bank(), bank + NEAR / 10);
    assert_eq!(r.player(&acc("ana.testnet")).halls_won, 0);
}

#[test]
fn the_odds_are_fair_less_five_percent() {
    // Exact counts of 7776 rolls: at least k of a face among five dice.
    for k in 1..=5u32 {
        let n = (0..7776u32)
            .filter(|&x| (0..5).filter(|i| (x / 6u32.pow(*i)) % 6 == 0).count() as u32 >= k)
            .count() as u128;
        assert_eq!(n, LIBRARY_ODDS[k as usize - 1]);
    }
    let fair = mul_div(NEAR, 7776, 4651);
    assert_eq!(library_pays(NEAR, 1), fair - fair / 20);
    // Over many seeds, wins land near the stated odds.
    let mut wins = 0;
    for seed in 0..=255u8 {
        let mut r = funded_library();
        if wager(&mut r, "ana.testnet", NEAR / 100, 1, seed).1["won"] == true {
            wins += 1;
        }
    }
    let p = wins as f64 / 256.0;
    assert!((p - 4651.0 / 7776.0).abs() < 0.1, "won {wins} of 256");
}

#[test]
#[should_panic(expected = "a later block")]
fn haseeb_rolls_in_a_later_block() {
    let mut r = funded_library();
    ctx_at("ana.testnet", NEAR / 10, 1001, 10, 3);
    let id = r.stake();
    let cup = r.cup(id).unwrap();
    r.finish(id, false, None, Some((cup.mine.iter().filter(|&&d| d == 2).count() as u8 + 1, 2)));
}

#[test]
#[should_panic(expected = "can't cover")]
fn the_bank_must_cover_the_bid() {
    let mut r = funded_library();
    wager(&mut r, "ana.testnet", NEAR, 3, 9);
}

#[test]
#[should_panic(expected = "stake 0.01 to 1 NEAR")]
fn stakes_are_limited() {
    let mut r = funded_library();
    ctx("ana.testnet", 2 * NEAR, 1001);
    r.stake();
}

#[test]
fn a_late_library_round_is_lost() {
    let mut r = funded_library();
    let bank = r.bank();
    ctx_at("ana.testnet", NEAR / 10, 1001, 10, 3);
    let id = r.stake();
    ctx_at("bob.testnet", 0, 1001 + 3601, 99, 4);
    assert_eq!(r.finish(id, false, None, Some((5, 6)))["won"], false);
    assert_eq!(r.bank(), bank + NEAR / 10);
}

#[test]
#[should_panic(expected = "toll")]
fn the_gate_takes_a_toll() {
    let mut r = realm();
    ctx("ana.testnet", 0, 1001);
    r.seal(0);
}

fn sealed_up_to_mint(r: &mut Realm, who: &str) {
    ctx(who, GATE_TOLL, 1001);
    let pool = r.pool;
    r.seal(0);
    assert_eq!(r.pool, pool + GATE_TOLL, "the toll goes to the crown");
    ctx(who, NEAR, 1002);
    r.buy(2, None);
    ctx(who, 0, 1003);
    let id = r.enter(2);
    r.finish(id, true, Some(50), None);
    r.seal(1);
}

#[test]
fn seals_follow_the_story() {
    let mut r = realm();
    sealed_up_to_mint(&mut r, "ana.testnet");
    ctx("ana.testnet", 0, 1003);
    r.seal(2); // the cups are Velmont's: the Bridge
    ctx("ana.testnet", 0, 2000);
    let n = r.call_race();
    ctx("ana.testnet", NEAR / 10, 2001);
    r.bet(n, 3);
    ctx("ana.testnet", 0, 2002);
    r.seal(5);
    let p = r.player(&acc("ana.testnet"));
    assert_eq!(p.seals, 0b10_0111);
    assert!(get_logs().iter().any(|l| l.contains("\"seal\"")));
}

#[test]
#[should_panic(expected = "back a team in a race")]
fn the_hippodrome_needs_a_bet() {
    let mut r = realm();
    sealed_up_to_mint(&mut r, "ana.testnet");
    ctx("ana.testnet", 0, 1004);
    r.seal(5);
}

#[test]
#[should_panic(expected = "win that hall's game first")]
fn the_lighthouse_needs_a_win_at_signals() {
    let mut r = realm();
    sealed_up_to_mint(&mut r, "ana.testnet");
    r.seal(3);
}

#[test]
fn the_seed_is_drawn_after_betting_closes() {
    let mut r = realm();
    ctx("ana.testnet", 0, 2000);
    let n = r.call_race();
    assert_eq!(r.race(n).seed, 0, "no seed while the bets are open");
    assert_eq!(r.get_race(n).unwrap()["started"], false);
    ctx("ana.testnet", NEAR, 2000 + BET_SECS - 1);
    r.bet(n, 1);
    ctx_seed("bob.testnet", 0, 2000 + BET_SECS, 9);
    let seed = r.start_race(n);
    assert_eq!(seed, u32::from_le_bytes([9, 9, 9, 9]), "the seed comes from the block that starts it");
    let race = r.race(n);
    assert_eq!((race.seed, race.started_ns), (seed, (2000 + BET_SECS) * 1_000_000_000));
    assert!(get_logs().iter().any(|l| l.contains("\"start\"")));
}

#[test]
#[should_panic(expected = "betting is still open")]
fn no_start_before_the_off() {
    let mut r = realm();
    ctx("ana.testnet", 0, 2000);
    let n = r.call_race();
    ctx("ana.testnet", 0, 2000 + BET_SECS - 1);
    r.start_race(n);
}

#[test]
#[should_panic(expected = "already started")]
fn a_race_starts_once() {
    let mut r = realm();
    ctx("ana.testnet", 0, 2000);
    let n = r.call_race();
    ctx_seed("ana.testnet", 0, 2000 + BET_SECS, 1);
    r.start_race(n);
    ctx_seed("ana.testnet", 0, 2000 + BET_SECS + 1, 2);
    r.start_race(n);
}

#[test]
fn a_race_from_call_to_claim() {
    let mut r = realm();
    ctx("ana.testnet", 0, 2000);
    let n = r.call_race();
    let fav = sim::run(SEED7, r.race(n).laps, &[]).order[0];
    let other = (fav + 1) % 8;
    ctx("ana.testnet", NEAR, 2001);
    r.bet(n, fav);
    ctx("bob.testnet", 2 * NEAR, 2002);
    r.bet(n, other);
    ctx("bob.testnet", NEAR, 2003);
    r.buy(other, None);
    // Bob's whip is the first call after the off: it starts the race (seed from this block) and lands on tick 1.
    ctx("bob.testnet", 0, 2000 + BET_SECS + 5);
    let tick = r.whip(n, other);
    assert_eq!(tick, 1);
    let race = r.race(n);
    assert_eq!(race.seed, SEED7);
    ctx("bob.testnet", 0, 2000 + BET_SECS + 7);
    assert_eq!(r.whip(n, other), 21, "two seconds on: tick 21");
    ctx("ana.testnet", 0, 2000 + BET_SECS + 5 + WHIP_SECS);
    let order = r.settle(n);
    let expect = sim::run(SEED7, race.laps, &[sim::Whip { tick: 1, house: other }, sim::Whip { tick: 21, house: other }]).order;
    assert_eq!(order, expect, "settle runs the same race the browser draws");
    let win = order[0];
    // Two first bets, each paying a ticket out of the stake (both already had player records? Ana no, Bob no).
    let total = 3 * NEAR - 4 * RECORD_FEE;
    let r2 = r.race(n);
    assert_eq!(r2.pools.iter().sum::<u128>(), total);
    if win == fav || win == other {
        assert_eq!(r2.payout, total - total * 500 / 10_000);
        ctx(if win == fav { "ana.testnet" } else { "bob.testnet" }, 0, 3000);
        let _ = r.claim_race(n);
        assert_eq!(r.race(n).claimed, r2.payout, "the only backer of the winner takes the whole payout");
    } else {
        assert_eq!(r2.payout, 0, "nobody backed the winner: it all goes to the crown");
    }
    ctx("ana.testnet", 0, 4000);
    r.call_race();
}

#[test]
fn an_unstarted_race_settles_without_whips() {
    let mut r = realm();
    ctx("ana.testnet", 0, 2000);
    let n = r.call_race();
    ctx_seed("ana.testnet", 0, 2000 + BET_SECS + WHIP_SECS, 5);
    let order = r.settle(n);
    assert_eq!(order, sim::run(u32::from_le_bytes([5, 5, 5, 5]), r.race(n).laps, &[]).order);
}

#[test]
#[should_panic(expected = "the race is still on")]
fn no_settling_inside_the_whip_window() {
    let mut r = realm();
    ctx("ana.testnet", 0, 2000);
    let n = r.call_race();
    ctx("ana.testnet", 0, 2000 + BET_SECS + 10);
    r.start_race(n);
    ctx("ana.testnet", 0, 2000 + BET_SECS + 10 + WHIP_SECS - 1);
    r.settle(n);
}

#[test]
#[should_panic(expected = "back a team in this race")]
fn whips_need_a_ticket() {
    let mut r = realm();
    ctx("bob.testnet", NEAR, 1999);
    r.buy(3, None);
    ctx("ana.testnet", 0, 2000);
    let n = r.call_race();
    ctx("bob.testnet", 0, 2000 + BET_SECS + 1);
    r.whip(n, 3);
}

#[test]
#[should_panic(expected = "betting is closed")]
fn no_bets_after_the_off() {
    let mut r = realm();
    ctx("ana.testnet", 0, 2000);
    let n = r.call_race();
    ctx("ana.testnet", NEAR, 2000 + BET_SECS);
    r.bet(n, 0);
}

/// Run one race with Ana alone on `house`, settle it, and return the winner.
fn quick_race(r: &mut Realm, t: u64, house: Option<u8>) -> (u32, u8) {
    ctx("ana.testnet", 0, t);
    let n = r.call_race();
    if let Some(h) = house {
        ctx("ana.testnet", NEAR / 10, t + 1);
        r.bet(n, h);
    }
    ctx("ana.testnet", 0, t + BET_SECS + WHIP_SECS);
    let w = r.settle(n)[0];
    (n, w)
}

#[test]
fn old_races_go_and_their_unclaimed_winnings_go_to_the_crown() {
    let mut r = realm();
    // Ana backs the team that wins race 0 and never collects.
    let laps = CUP_LAPS[0];
    let fav = sim::run(SEED7, laps, &[]).order[0];
    let (n, w) = quick_race(&mut r, 2000, Some(fav));
    assert_eq!((n, w), (0, fav));
    let payout = r.race(0).payout;
    assert!(payout > 0);
    let mut t = 3000;
    for _ in 1..RACE_KEEP {
        quick_race(&mut r, t, None);
        t += 200;
    }
    assert!(r.get_race(0).is_some(), "race 0 is still in the book");
    let pool = r.pool;
    ctx("ana.testnet", 0, t);
    r.call_race();
    assert!(r.get_race(0).is_none(), "the call of race 100 deleted race 0");
    assert_eq!(r.pool, pool + payout, "and its unclaimed winnings went to the crown");
}

#[test]
fn the_crown_goes_to_the_house_with_most_favour() {
    let mut r = realm();
    ctx("ana.testnet", NEAR, 1001);
    r.buy(4, None);
    ctx("ana.testnet", 0, 1002);
    for _ in 0..3 {
        let id = r.enter(4);
        r.finish(id, true, Some(100), None);
    }
    ctx("bob.testnet", NEAR, 1003);
    r.buy(1, None);
    ctx("bob.testnet", 0, 1004);
    let id = r.enter(1);
    r.finish(id, false, None, None);
    let pool = r.pool;
    assert!(pool > 0);
    ctx("bob.testnet", 0, 1000 + 3600);
    assert_eq!(r.end_season(), Some(4));
    assert_eq!(r.pool, 0);
    // Ana played for Halloway: she takes the whole pool.
    ctx("ana.testnet", 0, 1000 + 3601);
    let s = r.get_season(1).unwrap();
    assert_eq!(s.pool.0, pool);
    assert!(r.get_crown(0, "ana.testnet".parse().unwrap()).is_none());
    let c = r.get_crown(1, "ana.testnet".parse().unwrap()).unwrap();
    assert_eq!(c["crowned"], 4);
    assert_eq!(c["share"], pool.to_string());
    assert_eq!(c["claimed"], false);
    assert_eq!(r.get_crown(1, "bob.testnet".parse().unwrap()).unwrap()["share"], "0");
    let _ = r.claim_crown(1);
    assert_eq!(r.seasons.get(0).unwrap().claimed.0, pool);
    assert_eq!(r.get_crown(1, "ana.testnet".parse().unwrap()).unwrap()["claimed"], true);
}

#[test]
fn an_unclaimed_crown_rolls_into_the_next() {
    let mut r = realm();
    ctx("ana.testnet", NEAR, 1001);
    r.buy(4, None);
    ctx("ana.testnet", 0, 1002);
    let id = r.enter(4);
    r.finish(id, false, None, None);
    let pool = r.pool;
    ctx("ana.testnet", 0, 1000 + 3600);
    assert_eq!(r.end_season(), Some(4));
    // Ana never claims. Season 2 ends: season 1's pool joins season 2's (nobody earned favour, so nobody is crowned
    // and the pool waits).
    ctx("ana.testnet", 0, 1000 + 7300);
    assert_eq!(r.end_season(), None);
    assert_eq!(r.pool, pool);
    assert_eq!(r.get_crown(1, acc("ana.testnet")).unwrap()["closed"], true);
}

#[test]
#[should_panic(expected = "claims have closed")]
fn a_closed_crown_cant_be_claimed() {
    let mut r = realm();
    ctx("ana.testnet", NEAR, 1001);
    r.buy(4, None);
    ctx("ana.testnet", 0, 1002);
    let id = r.enter(4);
    r.finish(id, false, None, None);
    ctx("ana.testnet", 0, 1000 + 3600);
    r.end_season();
    ctx("ana.testnet", 0, 1000 + 7300);
    r.end_season();
    let _ = r.claim_crown(1);
}

// ---------- NEP-245 ----------

#[test]
fn coins_are_multi_tokens() {
    let mut r = realm();
    ctx("ana.testnet", NEAR, 1001);
    let got = r.buy(5, None).0;
    assert_eq!(r.mt_balance_of(acc("ana.testnet"), "bull".into()).0, got);
    assert_eq!(r.mt_balance_of(acc("ana.testnet"), "BULL".into()).0, got, "ids are case-blind");
    assert_eq!(r.mt_supply("bull".into()).unwrap().0, r.houses[5].supply);
    assert!(r.mt_supply("nope".into()).is_none());
    assert_eq!(r.mt_metadata_base_by_token_id(vec!["hawk".into()])[0].as_ref().unwrap()["symbol"], "HAWK");
    // To a new holder: 1 yocto isn't enough, the new holding needs its storage.
    ctx("ana.testnet", RECORD_FEE, 1002);
    r.mt_transfer(acc("bob.testnet"), "bull".into(), U128(got / 4), None, Some("for the road".into()));
    assert!(get_logs().iter().any(|l| l.contains("mt_transfer") && l.contains("for the road")));
    // To an existing holder: 1 yocto.
    ctx("ana.testnet", 1, 1003);
    r.mt_transfer(acc("bob.testnet"), "bull".into(), U128(got / 4), None, None);
    assert_eq!(r.mt_batch_balance_of(acc("bob.testnet"), vec!["bull".into(), "owl".into()]), vec![U128(got / 4 * 2), U128(0)]);
    assert_eq!(r.holding(5, &acc("bob.testnet")).favour, 0, "favour stays with the one who burned");
    // Bob can burn what he was sent.
    ctx("bob.testnet", 0, 1004);
    r.enter(5);
}

#[test]
#[should_panic(expected = "attach 0.0025 NEAR")]
fn a_new_holder_needs_storage() {
    let mut r = realm();
    ctx("ana.testnet", NEAR, 1001);
    let got = r.buy(5, None).0;
    ctx("ana.testnet", 1, 1002);
    r.mt_transfer(acc("bob.testnet"), "bull".into(), U128(got), None, None);
}

#[test]
#[should_panic(expected = "attach 1 yoctoNEAR")]
fn a_transfer_needs_a_yocto() {
    let mut r = realm();
    ctx("ana.testnet", NEAR, 1001);
    let got = r.buy(5, None).0;
    ctx("bob.testnet", NEAR, 1001);
    r.buy(5, None);
    ctx("ana.testnet", 0, 1002);
    r.mt_transfer(acc("bob.testnet"), "bull".into(), U128(got), None, None);
}

#[test]
fn a_transfer_call_returns_what_isnt_used() {
    let mut r = realm();
    ctx("ana.testnet", NEAR, 1001);
    let got = r.buy(1, None).0;
    ctx("ana.testnet", RECORD_FEE, 1002);
    let _ = r.mt_transfer_call(acc("shop.testnet"), "boar".into(), U128(1000), None, None, "".into());
    assert_eq!(r.mt_balance_of(acc("shop.testnet"), "boar".into()).0, 1000);
    // The shop used 600 and hands 400 back.
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("realm.testnet")).predecessor_account_id(acc("realm.testnet"));
    testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![near_sdk::PromiseResult::Successful(near_sdk::serde_json::to_vec(&vec![U128(400)]).unwrap())]
    );
    let used = r.mt_resolve_transfer(vec![acc("ana.testnet")], acc("shop.testnet"), vec!["boar".into()], vec![U128(1000)], None);
    assert_eq!(used, vec![U128(600)]);
    assert_eq!(r.mt_balance_of(acc("shop.testnet"), "boar".into()).0, 600);
    assert_eq!(r.mt_balance_of(acc("ana.testnet"), "boar".into()).0, got - 600);
}

// ---------- Storage and the upgrade ----------

/// Every record a deposit pays for fits in RECORD_FEE, even for the longest account name NEAR allows.
#[test]
fn records_fit_their_fee() {
    let long = format!("{}.testnet", "a".repeat(56));
    let bytes = (RECORD_FEE / env::storage_byte_cost().as_yoctonear()) as u64;
    let mut r = realm();
    ctx("ana.testnet", 0, 1999);
    let n = r.call_race();
    r.races2.flush();
    ctx(&long, NEAR, 2000);
    let before = env::storage_usage();
    r.buy(3, None);
    r.holdings.flush();
    r.players2.flush();
    let grew = env::storage_usage() - before;
    assert!(grew <= 2 * bytes, "buy opened two records in {grew} bytes");
    ctx(&long, NEAR, 2001);
    let before = env::storage_usage();
    r.bet(n, 2);
    r.tickets.flush();
    r.races2.flush();
    r.players2.flush();
    let grew = env::storage_usage() - before;
    assert!(grew <= bytes, "a ticket took {grew} bytes");
}

#[test]
fn the_first_version_upgrades_in_place() {
    // Write the first version's state as it is on testnet: a player, a race with its seed drawn at the call.
    ctx("owner.testnet", 0, 1000);
    let mut players: LookupMap<AccountId, PlayerV1> = LookupMap::new(Key::Players);
    players.insert(acc("ana.testnet"), PlayerV1 { seals: 0b11, halls_won: 1 << 2, plays: 2, wins: 1, bought: true });
    players.flush();
    let mut races: Vector<RaceV1> = Vector::new(Key::Races);
    races.push(RaceV1 {
        n: 0, seed: 1234, laps: 3, called_ns: 0, off_ns: 900 * 1_000_000_000, pools: [0; HOUSES], whips: vec![],
        settled: false, order: vec![], finish_ms: vec![], payout: 0,
    });
    races.flush();
    let old = RealmV1 {
        owner: acc("owner.testnet"),
        houses: (0..HOUSES).map(|_| HouseV1 { reserve: NEAR / 4, supply: 180_000 * COIN, burned: 0, rounds: 0, favour: 0, fav_season: 1 }).collect(),
        holdings: LookupMap::new(Key::Holdings),
        players,
        rounds: LookupMap::new(Key::Rounds),
        next_round: 3,
        races,
        tickets: LookupMap::new(Key::Bets),
        pool: 5,
        season: 1,
        season_secs: 3600,
        season_ends_ns: 4600 * 1_000_000_000,
        seasons: Vector::new(Key::Seasons),
    };
    env::state_write(&old);
    let mut r = Realm::migrate();
    assert_eq!((r.race_count, r.legacy_races, r.pool, r.next_round), (1, 1, 5, 3));
    let p = r.player(&acc("ana.testnet"));
    assert_eq!((p.seals, p.plays, p.bought), (0b11, 2, true));
    // The old race settles with the seed it was called with.
    ctx("ana.testnet", 0, 1000);
    assert_eq!(r.settle(0), sim::run(1234, 3, &[]).order);
    // A new race is a v2 race; the old player moves over when touched.
    let n = r.call_race();
    assert_eq!((n, r.race(n).seed), (1, 0));
    ctx("ana.testnet", NEAR / 10, 1001);
    r.bet(n, 0);
    assert!(r.players2.contains_key(&acc("ana.testnet")) && !r.players.contains_key(&acc("ana.testnet")));
    assert!(r.player(&acc("ana.testnet")).raced);
}
