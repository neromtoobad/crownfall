// Qureshi's Library: dice rolled and settled by the contract.
use super::*;

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
    let out = r.finish(id, true, Some(100), None, None);
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
    r.finish(id, false, None, Some((cup.mine.iter().filter(|&&d| d == 2).count() as u8 + 1, 2)), None);
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
    assert_eq!(r.finish(id, false, None, Some((5, 6)), None)["won"], false);
    assert_eq!(r.bank(), bank + NEAR / 10);
}
