use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::testing_env;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(who: &str, deposit: u128, ts_secs: u64) {
    let mut b = VMContextBuilder::new();
    b.predecessor_account_id(acc(who))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(ts_secs * 1_000_000_000)
        .random_seed([7u8; 32]);
    testing_env!(b.build());
}

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
    assert_eq!(r.pool, NEAR * 200 / 10_000);
    ctx("ana.testnet", 0, 1002);
    let round = r.enter(2);
    let p2 = price(&r, 2);
    assert!(p2 > p1, "a burn lifts the price");
    assert_eq!(r.houses[2].burned, ENTRY[2]);
    assert_eq!(r.holding(2, &acc("ana.testnet")).coins, got - ENTRY[2]);
    ctx("ana.testnet", 0, 1010);
    r.finish(round, true, Some(100));
    let hold = r.holding(2, &acc("ana.testnet"));
    assert_eq!(hold.favour, ENTRY[2] * 3, "a perfect win counts the burn three times in all");
    let p = r.player(&acc("ana.testnet"));
    assert_eq!((p.plays, p.wins, p.halls_won), (1, 1, 1 << 2));
    // Selling all of it back pays less than was paid in (the fees), and leaves the house solvent.
    ctx("ana.testnet", 0, 1011);
    let before = r.houses[2].reserve;
    r.sell(2, U128(hold.coins), None);
    assert!(r.houses[2].reserve < before);
    assert!(r.houses[2].reserve > NEAR / 2, "the founders' reserve is still there");
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
    r.finish(id, true, None);
}

#[test]
fn a_late_round_is_lost() {
    let mut r = realm();
    ctx("ana.testnet", NEAR, 1001);
    r.buy(0, None);
    ctx("ana.testnet", 0, 1002);
    let id = r.enter(0);
    ctx("bob.testnet", 0, 1002 + 3601);
    r.finish(id, true, None);
    assert_eq!(r.player(&acc("ana.testnet")).wins, 0);
}

#[test]
fn library_stakes() {
    let mut r = realm();
    ctx("ana.testnet", NEAR, 1001);
    let a = r.stake();
    ctx("ana.testnet", 0, 1002);
    assert!(r.finish(a, true, Some(80)).is_some(), "a win hands the stake back");
    ctx("ana.testnet", NEAR, 1003);
    let b = r.stake();
    let pool = r.pool;
    ctx("ana.testnet", 0, 1004);
    assert!(r.finish(b, false, None).is_none());
    assert_eq!(r.pool, pool + NEAR, "a lost stake goes to the crown");
    assert_eq!(r.player(&acc("ana.testnet")).halls_won, 1 << 8);
}

#[test]
fn library_first_win_doubles() {
    let mut r = realm();
    // Bo loses one, so the crown pool holds at least a stake.
    ctx("bo.testnet", NEAR, 1001);
    let lost = r.stake();
    ctx("bo.testnet", 0, 1002);
    r.finish(lost, false, None);
    let pool = r.pool;
    assert!(pool >= NEAR);
    // Ana's first win: stake back plus a stake from the pool.
    ctx("ana.testnet", NEAR, 1003);
    let a = r.stake();
    ctx("ana.testnet", 0, 1004);
    assert!(r.finish(a, true, Some(60)).is_some());
    assert_eq!(r.pool, pool - NEAR, "the first win's bonus comes out of the crown pool");
    // Her second win: the stake back, nothing from the pool.
    ctx("ana.testnet", NEAR, 1005);
    let b = r.stake();
    ctx("ana.testnet", 0, 1006);
    assert!(r.finish(b, true, Some(60)).is_some());
    assert_eq!(r.pool, pool - NEAR, "later wins take nothing from the pool");
}

#[test]
fn library_bonus_capped_by_pool() {
    let mut r = realm();
    let pool = r.pool;
    ctx("ana.testnet", NEAR, 1001);
    let a = r.stake();
    ctx("ana.testnet", 0, 1002);
    assert!(r.finish(a, true, Some(60)).is_some());
    assert_eq!(r.pool, pool.saturating_sub(NEAR.min(pool)), "the bonus never takes more than the pool holds");
}

#[test]
fn seals_follow_the_story() {
    let mut r = realm();
    ctx("ana.testnet", 0, 1001);
    r.seal(0);
    ctx("ana.testnet", NEAR, 1002);
    r.buy(2, None);
    ctx("ana.testnet", 0, 1003);
    let id = r.enter(2);
    r.finish(id, true, Some(50));
    r.seal(1);
    r.seal(2); // the cups are Velmont's: the Bridge
    r.seal(5);
    let p = r.player(&acc("ana.testnet"));
    assert_eq!(p.seals, 0b10_0111);
    assert!(get_logs().iter().any(|l| l.contains("\"seal\"")));
}

#[test]
#[should_panic(expected = "win that hall's game first")]
fn the_lighthouse_needs_a_win_at_signals() {
    let mut r = realm();
    ctx("ana.testnet", 0, 1001);
    r.seal(0);
    ctx("ana.testnet", NEAR, 1002);
    r.buy(2, None);
    ctx("ana.testnet", 0, 1003);
    let id = r.enter(2);
    r.finish(id, true, None);
    r.seal(1);
    r.seal(3);
}

#[test]
fn a_race_from_call_to_claim() {
    let mut r = realm();
    ctx("ana.testnet", 0, 2000);
    let n = r.call_race();
    let race = r.race(n);
    // Find the winner first, from the same sim, so the test knows whom to back.
    let fav = sim::run(race.seed, race.laps, &[]).order[0];
    let other = (fav + 1) % 8;
    ctx("ana.testnet", NEAR, 2001);
    r.bet(n, fav);
    ctx("bob.testnet", 2 * NEAR, 2002);
    r.bet(n, other);
    // Bob whips his team once.
    ctx("bob.testnet", NEAR, 2003);
    r.buy(other, None);
    ctx("bob.testnet", 0, 2000 + BET_SECS + 5);
    let tick = r.whip(n, other);
    assert_eq!(tick, 51);
    ctx("ana.testnet", 0, 2000 + BET_SECS + WHIP_SECS + 1);
    let order = r.settle(n);
    let expect = sim::run(race.seed, race.laps, &[sim::Whip { tick: 51, house: other }]).order;
    assert_eq!(order, expect, "settle runs the same race the browser draws");
    let win = order[0];
    let total = 3 * NEAR;
    let r2 = r.race(n);
    if win == fav {
        assert_eq!(r2.payout, total - total * 500 / 10_000);
        r.claim_race(n);
    } else if win == other {
        ctx("bob.testnet", 0, 3000);
        r.claim_race(n);
    } else {
        assert_eq!(r2.payout, 0, "nobody backed the winner: it all goes to the crown");
    }
    ctx("ana.testnet", 0, 4000);
    r.call_race();
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

#[test]
fn the_crown_goes_to_the_house_with_most_favour() {
    let mut r = realm();
    ctx("ana.testnet", NEAR, 1001);
    r.buy(4, None);
    ctx("ana.testnet", 0, 1002);
    for _ in 0..3 {
        let id = r.enter(4);
        r.finish(id, true, Some(100));
    }
    ctx("bob.testnet", NEAR, 1003);
    r.buy(1, None);
    ctx("bob.testnet", 0, 1004);
    let id = r.enter(1);
    r.finish(id, false, None);
    let pool = r.pool;
    assert!(pool > 0);
    ctx("bob.testnet", 0, 1000 + 3600);
    assert_eq!(r.end_season(), Some(4));
    assert_eq!(r.pool, 0);
    // Ana played for Halloway: she takes the whole pool.
    ctx("ana.testnet", 0, 1000 + 3601);
    let s = r.get_season(1).unwrap();
    assert_eq!(s.pool.0, pool);
    r.claim_crown(1);
    assert_eq!(r.seasons.get(0).unwrap().claimed.0, pool);
}
