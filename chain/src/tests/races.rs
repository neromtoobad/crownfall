// The Hippodrome on NEAR: betting, the off, whips, settling, claims and the season crown.
use super::*;

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
        r.finish(id, true, Some(100), None, None);
    }
    ctx("bob.testnet", NEAR, 1003);
    r.buy(1, None);
    ctx("bob.testnet", 0, 1004);
    let id = r.enter(1);
    r.finish(id, false, None, None, None);
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
    r.finish(id, false, None, None, None);
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
    r.finish(id, false, None, None, None);
    ctx("ana.testnet", 0, 1000 + 3600);
    r.end_season();
    ctx("ana.testnet", 0, 1000 + 7300);
    r.end_season();
    let _ = r.claim_crown(1);
}
