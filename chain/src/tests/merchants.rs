// The merchants: how each house prices its coin (market.rs).
use super::*;

#[test]
fn a_rush_of_buying_makes_the_coin_dearer_and_it_cools_off() {
    let mut r = realm();
    ctx("bo.testnet", 0, 1001);
    let calm = r.quote_buy(1, U128(NEAR / 10)).0;
    buy_as(&mut r, "ana.testnet", 1, 3 * NEAR / 10, 1001);
    ctx("bo.testnet", 0, 1002);
    let hot = r.quote_buy(1, U128(NEAR / 10)).0;
    // Fair value rose a little with the fee, and the merchant charges ~×1.29 for the rush on top.
    assert!(hot * 120 < calm * 100, "0.1 NEAR buys far less coin right after a rush: {hot} vs {calm}");
    let m = &r.get_realm()["houses"][1]["market"];
    assert!(m["factor"].as_u64().unwrap() > 12_500, "{m}");
    // Two half-lives later only a quarter of the rush is left.
    ctx("bo.testnet", 0, 1002 + 2 * market::DEMAND_HALF_SECS);
    let f = r.get_realm()["houses"][1]["market"]["factor"].as_u64().unwrap();
    assert!((10_650..10_800).contains(&f), "{f}");
    // Other houses never noticed.
    assert_eq!(r.get_realm()["houses"][2]["market"]["factor"].as_u64().unwrap(), 10_000);
}

#[test]
fn a_flood_of_selling_makes_it_cheap_and_never_pays_above_fair_value() {
    let mut r = realm();
    let got = buy_as(&mut r, "ana.testnet", 3, NEAR / 2, 1001);
    // Long after, demand has gone: selling a slice pays fair value less the fee.
    let later = 1001 + 50 * market::DEMAND_HALF_SECS;
    ctx("ana.testnet", 0, later);
    let fair = mul_div(got / 10, r.houses[3].reserve, r.houses[3].supply);
    assert_eq!(r.quote_sell(3, U128(got / 10)).0, fair - fair * FEE_BPS / 10_000);
    r.sell(3, U128(got / 10), None);
    // Each further sale finds the merchant less keen.
    ctx("ana.testnet", 0, later + 1);
    let f1 = r.get_realm()["houses"][3]["market"]["sell_factor"].as_u64().unwrap();
    assert!(f1 < 10_000);
    r.sell(3, U128(got / 10), None);
    ctx("ana.testnet", 0, later + 2);
    let f2 = r.get_realm()["houses"][3]["market"]["sell_factor"].as_u64().unwrap();
    assert!(f2 < f1, "{f2} < {f1}");
    // And a buyer now gets more coin per NEAR than fair value would give.
    let g = &r.houses[3];
    let at_fair = mul_div(NEAR / 10 - NEAR / 10 * FEE_BPS / 10_000, g.supply, g.reserve);
    assert!(r.quote_buy(3, U128(NEAR / 10)).0 > at_fair);
}

#[test]
fn a_run_shuts_the_house_and_investment_reopens_it() {
    let mut r = realm();
    let got = buy_as(&mut r, "ana.testnet", 5, NEAR, 1001);
    let peak = r.houses[5].reserve;
    // Ana sells most of it back at once: a run.
    ctx("ana.testnet", 0, 1002);
    r.sell(5, U128(got * 9 / 10), None);
    assert!(r.houses[5].reserve * 10 < peak * 7, "the purse fell under 70% of its peak");
    assert!(get_logs().iter().any(|l| l.contains("\"shut\"")));
    assert_eq!(r.get_realm()["houses"][5]["market"]["shut"], true);
    // Shut: nobody sells, the hall takes no rounds; the coin is cheap.
    ctx("ana.testnet", 0, 1003);
    assert_eq!(r.quote_sell(5, U128(got / 20)).0, 0);
    // An investor buys in; once the purse is back to 85% of the peak the doors open again.
    let mut n = 0;
    while r.get_realm()["houses"][5]["market"]["shut"] == true {
        buy_as(&mut r, "bo.testnet", 5, NEAR / 10, 1004 + n);
        n += 1;
        assert!(n < 20);
    }
    assert!(r.houses[5].reserve * 100 >= peak * 85);
    assert!(get_logs().iter().any(|l| l.contains("\"reopened\"")));
    ctx("ana.testnet", 0, 2000);
    r.enter(5);
}

#[test]
#[should_panic(expected = "this hall is shut")]
fn a_shut_hall_takes_no_rounds() {
    let mut r = realm();
    let got = buy_as(&mut r, "ana.testnet", 5, NEAR, 1001);
    ctx("ana.testnet", 0, 1002);
    r.sell(5, U128(got * 9 / 10), None);
    ctx("ana.testnet", 0, 1003);
    r.enter(5);
}

#[test]
fn every_holder_can_always_be_paid() {
    // Whatever the merchant does, the purse covers every coin anyone holds at fair value.
    let mut r = realm();
    let who = ["ana.testnet", "bo.testnet", "cy.testnet"];
    let mut t = 1001;
    for k in 0..30u128 {
        let w = who[(k % 3) as usize];
        buy_as(&mut r, w, 0, NEAR / 20 + k * NEAR / 200, t);
        t += 7;
        if k % 4 == 3 && r.get_realm()["houses"][0]["market"]["shut"] == false {
            ctx(w, 0, t);
            let c = r.holding(0, &acc(w)).coins / 2;
            if c > 0 { r.sell(0, U128(c), None); }
        }
        let held: u128 = who.iter().map(|w| r.holding(0, &acc(w)).coins).sum();
        let owed = mul_div(held, r.houses[0].reserve, r.houses[0].supply);
        assert!(owed <= r.houses[0].reserve);
    }
}

#[test]
#[should_panic(expected = "this house is shut")]
fn a_shut_house_buys_no_coin_back() {
    let mut r = realm();
    let got = buy_as(&mut r, "ana.testnet", 5, NEAR, 1001);
    ctx("ana.testnet", 0, 1002);
    r.sell(5, U128(got * 9 / 10), None);
    ctx("ana.testnet", 0, 1003);
    r.sell(5, U128(got / 20), None);
}

// ---------- Judged halls: the chain replays Cups and Signals from the seed it rolled ----------

#[test]
fn a_judged_hall_ignores_a_forged_win() {
    let mut r = realm();
    for (h, who) in [(2u8, "ana.testnet"), (0, "bob.testnet")] {
        ctx(who, NEAR, 1001);
        r.buy(h, None);
        ctx_seed(who, 0, 1002, 7);
        let id = r.enter(h);
        let seed = r.hall_seed(id).expect("a judged hall rolls a seed");
        assert!(get_logs().iter().any(|l| l.contains("\"enter\"") && l.contains(&format!("\"seed\":{seed}"))));
        // "I won, perfectly", with no moves (or the moves for some other seed): lost.
        let wrong = crate::halls::perfect(h, seed ^ 0x5555);
        let out = r.finish(id, true, Some(100), None, Some(wrong));
        assert_eq!(out["won"], false, "hall {h}");
        assert_eq!(out["judged"], true);
        assert!(r.hall_seed(id).is_none(), "the seed is dropped with the round");
        assert_eq!(r.player(&acc(who)).wins, 0);
        assert_eq!(r.houses[h as usize].wins, 0);
    }
}

#[test]
fn a_judged_hall_counts_a_real_win() {
    let mut r = realm();
    ctx("ana.testnet", NEAR, 1001);
    r.buy(0, None);
    ctx_seed("ana.testnet", 0, 1002, 9);
    let id = r.enter(0);
    let seed = r.hall_seed(id).unwrap();
    // Six ships in, two wrecked on the way: a win, graded for six of eight.
    let play = crate::halls::sig_all(seed, &[true, false, true, true, false, true, true, true]);
    let out = r.finish(id, false, Some(0), None, Some(play));
    assert_eq!((out["won"].as_bool(), out["score"].as_u64()), (Some(true), Some(6)));
    let p = r.player(&acc("ana.testnet"));
    assert_eq!((p.wins, p.halls_won), (1, 1));
    assert_eq!(r.houses[0].wins, 1);
    assert!(get_logs().iter().any(|l| l.contains("\"judged\":true") && l.contains("\"grade\":33")));
}

#[test]
fn two_rounds_in_one_block_get_different_seeds() {
    let mut r = realm();
    ctx("ana.testnet", NEAR, 1001);
    r.buy(2, None);
    ctx_seed("ana.testnet", 0, 1002, 3);
    let a = r.enter(2);
    let b = r.enter(2);
    assert_ne!(r.hall_seed(a), r.hall_seed(b));
}

#[test]
fn other_halls_roll_no_seed() {
    let mut r = realm();
    ctx("ana.testnet", NEAR, 1001);
    r.buy(4, None);
    ctx("ana.testnet", 0, 1002);
    let id = r.enter(4);
    assert!(r.hall_seed(id).is_none());
    assert_eq!(r.finish(id, true, Some(80), None, None)["won"], true);
}
