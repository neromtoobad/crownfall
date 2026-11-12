// The contract's unit tests, one file per part of the realm. Shared helpers live here.
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
    let out = r.finish(id, false, None, Some((have + more, face)), None);
    (id, out)
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
    let play = crate::halls::perfect(2, r.hall_seed(id).unwrap());
    r.finish(id, false, Some(0), None, Some(play));
    r.seal(1);
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


fn buy_as(r: &mut Realm, who: &str, h: u8, near: u128, t: u64) -> u128 {
    ctx(who, near, t);
    r.buy(h, None).0
}

mod rounds;
mod library;
mod seals;
mod races;
mod nep245;
mod upgrade;
mod merchants;
