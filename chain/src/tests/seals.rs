// The Seven Wardens' seals.
use super::*;

#[test]
#[should_panic(expected = "toll")]
fn the_gate_takes_a_toll() {
    let mut r = realm();
    ctx("ana.testnet", 0, 1001);
    r.seal(0);
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
