// Hall rounds: entry burns, reported and late wins, and the race simulator against the browser.
use super::*;

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
    let play = crate::halls::perfect(2, r.hall_seed(round).unwrap());
    r.finish(round, true, Some(100), None, Some(play));
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
        r.finish(a, true, Some(100), None, None);
        ctx("bob.testnet", 0, 1002 + i);
        let b = r.enter(4);
        r.finish(b, false, None, None, None);
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
    r.finish(id, true, None, None, None);
}

#[test]
fn a_late_round_is_lost() {
    let mut r = realm();
    ctx("ana.testnet", NEAR, 1001);
    r.buy(0, None);
    ctx("ana.testnet", 0, 1002);
    let id = r.enter(0);
    ctx("bob.testnet", 0, 1002 + 3601);
    r.finish(id, true, None, None, None);
    assert_eq!(r.player(&acc("ana.testnet")).wins, 0);
}
