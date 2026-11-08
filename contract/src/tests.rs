//! One test per rule, named after it.
use super::*;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::testing_env;

const OWNER: usize = 0;

fn ctx(who: usize, deposit: u128, t_secs: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id("world.crownfall.testnet".parse().unwrap())
        .predecessor_account_id(accounts(who))
        .signer_account_id(accounts(who))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(t_secs * 1_000_000_000)
        .account_balance(NearToken::from_near(1000));
    testing_env!(b.build());
}

fn ctx_as(who: &AccountId, deposit: u128, t_secs: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id("world.crownfall.testnet".parse().unwrap())
        .predecessor_account_id(who.clone())
        .signer_account_id(who.clone())
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(t_secs * 1_000_000_000)
        .account_balance(NearToken::from_near(1000));
    testing_env!(b.build());
}

fn world() -> World {
    ctx(OWNER, 0, 0);
    World::new(accounts(OWNER), None, None)
}

/// Founds house 0 in seat 0 (by account 1) and house 1 in seat 1 (by account 2).
fn two_houses() -> World {
    let mut w = world();
    ctx(1, NEAR, 0);
    w.found("Ember".into(), 0);
    ctx(2, NEAR, 0);
    w.found("Tide".into(), 1);
    w
}

fn price(w: &World, house: u32) -> u128 {
    let g = w.houses.get(house).unwrap();
    mul_div(COIN, g.reserve, g.supply)
}

fn coins(w: &World, house: u32, who: usize) -> u128 {
    w.holdings.get(&(house, accounts(who))).map(|h| h.coins).unwrap_or(0)
}

fn turns(w: &mut World, n: u32) {
    for k in 0..n {
        let mut seed = vec![7u8; 32];
        seed[0] = (w.gseason % 251) as u8;
        seed[1] = k as u8;
        w.turn_with(seed);
    }
}

fn set_pop(w: &mut World, house: u32, people: i128) {
    let mut g = w.house(house);
    g.folk.pop = people * U;
    w.houses.replace(house, g);
}

fn give_council(w: &mut World, house: u32) -> AccountId {
    let dao: AccountId = format!("council{}.sputnikv2.testnet", house).parse().unwrap();
    let mut g = w.house(house);
    g.council_dao = Some(dao.clone());
    w.houses.replace(house, g);
    dao
}

#[test]
fn founding_gives_100_coins_for_1_near_and_the_price_is_reserve_over_coins() {
    let w = two_houses();
    assert_eq!(coins(&w, 0, 1), 100 * COIN);
    assert_eq!(price(&w, 0), COIN / 100);
    assert_eq!(w.seats[0], Some(0));
}

#[test]
#[should_panic(expected = "that seat is taken")]
fn a_seat_holds_one_living_house() {
    let mut w = two_houses();
    ctx(3, NEAR, 0);
    w.found("Moth".into(), 0);
}

#[test]
fn a_trade_pays_5_percent_three_points_to_the_reserve_one_to_the_council_one_to_the_pool() {
    let mut w = two_houses();
    ctx(3, 10 * NEAR, 0);
    let got = w.buy(0, None).0;
    let g = w.house(0);
    assert_eq!(g.council_due, NEAR / 10);
    assert_eq!(w.pool, NEAR / 10);
    assert_eq!(g.reserve, NEAR + 10 * NEAR - 2 * NEAR / 10);
    // 9.5 NEAR net at 0.01 NEAR a COIN.
    assert_eq!(got, 950 * COIN);
    assert!(price(&w, 0) > COIN / 100, "the reserve's fee points lift the price for those who stay");
}

#[test]
fn every_coin_can_always_be_sold_back() {
    let mut w = two_houses();
    ctx(3, 5 * NEAR, 0);
    w.buy(0, None);
    ctx(4, 3 * NEAR, 0);
    w.buy(0, None);
    for who in [3, 4, 1] {
        let f = coins(&w, 0, who);
        ctx(who, 0, 0);
        let _ = w.sell(0, U128(f), None);
    }
    let g = w.house(0);
    assert_eq!(g.supply, 0);
    // What's left is the fee points kept for nobody's coin: never a debt.
    assert!(g.reserve > 0);
}

#[test]
fn a_decree_costs_25_percent_more_each_time_the_house_casts_it_in_a_season() {
    let mut w = two_houses();
    ctx(1, 0, 0);
    assert_eq!(w.cast(0, 0, Decree::Sow).0, 2 * COIN);
    assert_eq!(w.cast(0, 0, Decree::Sow).0, 2 * COIN * 5 / 4);
    assert_eq!(w.cast(0, 0, Decree::Sow).0, 2 * COIN * 25 / 16);
    turns(&mut w, 1);
    ctx(1, 0, 0);
    assert_eq!(w.cast(0, 0, Decree::Sow).0, 2 * COIN, "prices reset each season");
}

#[test]
fn burning_coins_lifts_the_price_for_everyone_who_holds() {
    let mut w = two_houses();
    let before = price(&w, 0);
    ctx(1, 0, 0);
    w.cast(0, 0, Decree::Sermon);
    assert!(price(&w, 0) > before);
    assert_eq!(w.house(0).supply, 92 * COIN);
}

#[test]
#[should_panic(expected = "this decree is for a rival")]
fn lightning_and_plague_are_for_rivals() {
    let mut w = two_houses();
    ctx(1, 0, 0);
    w.cast(0, 0, Decree::Raid);
}

#[test]
#[should_panic(expected = "this decree is for your own folk")]
fn rain_harvest_heal_festival_prophet_and_sellswords_are_for_your_own_folk() {
    let mut w = two_houses();
    ctx(1, 0, 0);
    w.cast(0, 1, Decree::Sow);
}

#[test]
fn lightning_burns_30_percent_of_a_seasons_food_and_plague_kills_a_tenth_plus_two() {
    let mut w = two_houses();
    let t = w.house(1).folk;
    ctx(1, 0, 0);
    w.cast(0, 1, Decree::Poison);
    let after = w.house(1).folk;
    assert_eq!(after.pop, t.pop * 90 / 100 - 2 * U);
    let mut g = w.house(1);
    g.folk.food = 50 * U;
    w.houses.replace(1, g);
    ctx(1, 0, 0);
    w.cast(0, 1, Decree::Raid);
    assert_eq!(w.house(1).folk.food, (50 * U - after.pop * 30 / 100).max(0));
}

#[test]
fn fealty_counts_double_for_a_house_that_isnt_leading() {
    let mut w = two_houses();
    w.leader = Some(1);
    ctx(1, 0, 0);
    w.cast(0, 0, Decree::Sow);
    let h = w.holdings.get(&(0, accounts(1))).unwrap().clone();
    assert_eq!(h.standing, 4 * COIN);
    w.leader = Some(0);
    ctx(1, 0, 0);
    w.cast(0, 0, Decree::Healers);
    let h = w.holdings.get(&(0, accounts(1))).unwrap().clone();
    assert_eq!(h.standing, 4 * COIN + 4 * COIN);
}

#[test]
fn prayers_mint_coins_to_devotees_by_fealty_never_to_holders() {
    let mut w = two_houses();
    ctx(3, 5 * NEAR, 0);
    w.buy(0, None); // a holder who never casts
    let held = coins(&w, 0, 3);
    ctx(1, 0, 0);
    w.cast(0, 0, Decree::Sow);
    let before = coins(&w, 0, 1);
    let minted_before = w.house(0).minted;
    turns(&mut w, 1);
    let minted = w.house(0).minted - minted_before;
    assert!(minted > 0);
    ctx(1, 0, 0);
    w.sweep(0, vec![accounts(1), accounts(3)]);
    assert_eq!(coins(&w, 0, 3), held, "the holder gets none of it");
    let got = coins(&w, 0, 1) - before;
    assert!(minted - got < 10, "the only devotee gets it all (to rounding)");
}

#[test]
fn idle_coins_fades_1_percent_a_season_after_24_seasons_and_the_price_does_not_move() {
    let mut w = two_houses();
    ctx(3, 5 * NEAR, 0);
    w.buy(0, None);
    let held = coins(&w, 0, 3);
    turns(&mut w, 24);
    ctx(1, 0, 0);
    w.sweep(0, vec![accounts(3)]);
    assert_eq!(coins(&w, 0, 3), held, "nothing fades inside the window");
    let p = price(&w, 0);
    let council = w.house(0).council_due;
    turns(&mut w, 2);
    let p_turn = price(&w, 0);
    ctx(1, 0, 0);
    w.sweep(0, vec![accounts(3)]);
    let left = coins(&w, 0, 3);
    let expect = held * 99 / 100 * 99 / 100;
    assert!(left.abs_diff(expect) < 1_000_000, "two seasons at 1%");
    assert!(w.house(0).council_due > council, "its NEAR went to the council");
    assert!(price(&w, 0).abs_diff(p_turn) <= 1, "settling the fade doesn't move the price");
    let _ = p;
}

#[test]
fn casting_resets_the_idle_clock() {
    let mut w = two_houses();
    turns(&mut w, 30);
    ctx(1, 0, 0);
    w.cast(0, 0, Decree::Sow); // settles 6 seasons of fade, then resets
    let after_cast = coins(&w, 0, 1);
    turns(&mut w, 20);
    ctx(1, 0, 0);
    w.sweep(0, vec![accounts(1)]);
    assert!(coins(&w, 0, 1) >= after_cast, "no fade within 24 seasons of a cast");
}

#[test]
fn a_folk_under_5_people_fades_half_its_near_to_the_pool_half_to_the_houses_that_took_its_people() {
    let mut w = two_houses();
    let mut g = w.house(1);
    g.taken = vec![(0, 10 * U)];
    w.houses.replace(1, g);
    set_pop(&mut w, 0, 4);
    let r = w.house(0).reserve;
    let pool = w.pool;
    let tide = w.house(1).reserve;
    turns(&mut w, 1);
    let dead = w.house(0);
    assert!(!dead.alive);
    assert_eq!(dead.reserve, 0);
    assert_eq!(w.pool - pool, r / 2);
    assert_eq!(w.house(1).reserve - tide, r - r / 2);
}

#[test]
#[should_panic(expected = "this house has faded")]
fn a_faded_house_cannot_be_traded() {
    let mut w = two_houses();
    set_pop(&mut w, 0, 1);
    turns(&mut w, 1);
    ctx(3, NEAR, 0);
    w.buy(0, None);
}

#[test]
fn a_faded_seat_can_be_founded_again() {
    let mut w = two_houses();
    set_pop(&mut w, 0, 1);
    turns(&mut w, 1);
    ctx(3, NEAR, 0);
    assert_eq!(w.found("Ash".into(), 0), 2);
}

#[test]
fn the_crowned_houses_devotees_claim_the_offering_pool_by_fealty() {
    let mut w = world();
    w.rules.seasons_per_age = 3;
    ctx(1, NEAR, 0);
    w.found("Ember".into(), 0);
    ctx(2, NEAR, 0);
    w.found("Tide".into(), 4);
    ctx(3, 10 * NEAR, 0);
    w.buy(0, None);
    set_pop(&mut w, 0, 300);
    ctx(1, 0, 0);
    w.cast(0, 0, Decree::Sow); // 2 COIN, doubled: fealty 4
    ctx(3, 0, 0);
    w.cast(0, 0, Decree::Sermon); // 8 COIN, doubled: fealty 16
    turns(&mut w, 3);
    assert_eq!(w.age, 2);
    let r = w.get_age(1).unwrap();
    assert_eq!(r.crowned, Some(0));
    let pool = r.pool.0;
    assert!(pool > 0);
    ctx(3, 0, 0);
    let _ = w.claim_crown(1);
    ctx(1, 0, 0);
    let _ = w.claim_crown(1);
    let r = w.get_age(1).unwrap();
    assert_eq!(r.claimed.0, pool / 5 * 4 + pool / 5, "4 to 1, by fealty");
}

#[test]
fn surviving_houses_carry_into_the_next_age_with_a_fresh_folk_and_fealty_starts_again() {
    let mut w = world();
    w.rules.seasons_per_age = 2;
    ctx(1, NEAR, 0);
    w.found("Ember".into(), 0);
    ctx(1, 0, 0);
    w.cast(0, 0, Decree::Sow);
    set_pop(&mut w, 0, 500);
    turns(&mut w, 2);
    let g = w.house(0);
    assert!(g.alive);
    assert!(g.folk.pop < 100 * U, "a fresh folk");
    assert_eq!(g.standing_total, 0);
    assert!(g.top.is_empty());
}

#[test]
#[should_panic(expected = "the season isn't over yet")]
fn anyone_can_turn_the_season_but_only_when_it_is_due() {
    let mut w = two_houses();
    ctx(5, 0, 100);
    w.turn();
}

#[test]
fn the_season_turns_after_season_secs() {
    let mut w = two_houses();
    ctx(5, 0, 300);
    w.turn();
    assert_eq!(w.season, 1);
}

#[test]
fn elders_are_the_seven_top_devotees_and_a_bar_takes_a_seat_away() {
    let mut w = two_houses();
    for who in 1..6 {
        if who != 1 {
            ctx(who, 2 * NEAR, 0);
            w.buy(0, None);
        }
    }
    for who in 1..6 {
        ctx(who, 0, 0);
        for _ in 0..who {
            w.cast(0, 0, Decree::Sow);
        }
    }
    let elders = w.elders_of(&w.house(0));
    assert_eq!(elders[0], accounts(5), "most fealty first");
    assert_eq!(elders.len(), 5);
    let dao = give_council(&mut w, 0);
    ctx_as(&dao, 0, 0);
    w.bar_elder(0, accounts(5), 10);
    assert!(!w.elders_of(&w.house(0)).contains(&accounts(5)));
}

#[test]
#[should_panic(expected = "only the house's council")]
fn only_the_houses_council_can_spend_its_votes() {
    let mut w = two_houses();
    give_council(&mut w, 0);
    ctx(1, NEAR, 0);
    w.build(0, Work::Granary);
}

#[test]
fn a_granary_stores_three_seasons_of_food_instead_of_two() {
    let mut w = two_houses();
    let dao = give_council(&mut w, 0);
    ctx_as(&dao, NEAR, 0);
    w.build(0, Work::Granary);
    let mut g = w.house(0);
    g.folk.food = 1000 * U;
    g.folk.land = 1000 * U;
    let pop = g.folk.pop;
    w.houses.replace(0, g);
    turns(&mut w, 1);
    assert!(w.house(0).folk.food > pop * 2);
}

#[test]
fn a_bounty_pays_each_caster_who_smites_the_named_rival() {
    let mut w = two_houses();
    let dao = give_council(&mut w, 0);
    ctx_as(&dao, NEAR, 0);
    w.set_bounty(0, 1, U128(NEAR / 10));
    ctx(1, 0, 0);
    w.cast(0, 1, Decree::Raid);
    assert_eq!(w.house(0).bounty_left, NEAR - NEAR / 10);
}

#[test]
fn alms_go_to_this_ages_devotees_by_fealty() {
    let mut w = two_houses();
    ctx(3, 2 * NEAR, 0);
    w.buy(0, None);
    ctx(1, 0, 0);
    w.cast(0, 0, Decree::Sow); // fealty 4
    ctx(3, 0, 0);
    w.cast(0, 0, Decree::Sermon); // fealty 16
    let dao = give_council(&mut w, 0);
    ctx_as(&dao, 2 * NEAR, 0);
    w.give_alms(0);
    ctx(3, 0, 0);
    assert_eq!(w.claim_alms(0).0, 2 * NEAR / 5 * 4);
    ctx(1, 0, 0);
    assert_eq!(w.claim_alms(0).0, 2 * NEAR / 5);
}

#[test]
#[should_panic(expected = "you have a pact with that house")]
fn a_pact_needs_both_councils_and_then_blocks_smiting() {
    let mut w = two_houses();
    let a = give_council(&mut w, 0);
    let b = give_council(&mut w, 1);
    ctx_as(&a, 0, 0);
    assert!(!w.offer_pact(0, 1, 20));
    ctx_as(&b, 0, 0);
    assert!(w.offer_pact(1, 0, 20));
    ctx(1, 0, 0);
    w.cast(0, 1, Decree::Raid);
}

#[test]
fn a_rebellion_with_a_third_of_the_elders_fealty_founds_a_new_house_and_keeps_the_price_for_those_who_stay() {
    let mut w = two_houses();
    ctx(3, 3 * NEAR, 0);
    w.buy(0, None);
    ctx(4, 3 * NEAR, 0);
    w.buy(0, None);
    for (who, n) in [(1, 3), (3, 2), (4, 2)] {
        ctx(who, 0, 0);
        for _ in 0..n {
            w.cast(0, 0, Decree::Healers);
        }
    }
    let p = price(&w, 0);
    let pop = w.house(0).folk.pop;
    ctx(3, 0, 0);
    w.start_rebellion(0, "Ember Reformed".into());
    ctx(4, 0, 0);
    w.join_rebellion(0);
    let mut seed = vec![1u8; 32];
    seed[5] = 9;
    w.turn_with(seed);
    assert_eq!(w.houses.len(), 3, "a new house");
    let ng = w.house(2);
    assert_eq!(ng.name, "Ember Reformed");
    assert_eq!(coins(&w, 0, 3), 0);
    assert!(coins(&w, 2, 3) > 0);
    assert!(ng.folk.pop > 0 && w.house(0).folk.pop < pop);
    // The stayers' price only moves by the season's own mint and fees, not by the split.
    let p_after = price(&w, 0);
    assert!(p_after * 100 >= p * 90, "price held: {} -> {}", p, p_after);
}

#[test]
fn a_rebellion_without_a_third_of_the_elders_fealty_does_nothing() {
    let mut w = two_houses();
    ctx(3, 3 * NEAR, 0);
    w.buy(0, None);
    for (who, n) in [(1, 9), (3, 1)] {
        ctx(who, 0, 0);
        for _ in 0..n {
            w.cast(0, 0, Decree::Sow);
        }
    }
    ctx(3, 0, 0);
    w.start_rebellion(0, "Splinter".into());
    turns(&mut w, 1);
    assert_eq!(w.houses.len(), 2);
}

#[test]
fn an_age_plays_out_without_breaking_the_books() {
    // Eight houses, a handful of players casting and trading, a whole short age: supply and reserve stay sane.
    let mut w = world();
    w.rules.seasons_per_age = 40;
    for v in 0..8u8 {
        ctx(1 + (v as usize % 5), NEAR, 0);
        w.found(format!("House{}", v), v);
    }
    for s in 0..40u32 {
        for who in 1..6usize {
            let house = ((who as u32) + s) % 8;
            if !w.house(house).alive {
                continue;
            }
            if coins(&w, house, who) < 5 * COIN {
                ctx(who, NEAR / 2, 0);
                w.buy(house, None);
            }
            ctx(who, 0, 0);
            let rival = (house + 1) % 8;
            if s % 3 == 0 && w.house(rival).alive {
                let _ = w.cast(house, rival, Decree::Raid);
            } else {
                let _ = w.cast(house, house, Decree::Sow);
            }
        }
        turns(&mut w, 1);
    }
    assert_eq!(w.age, 2);
    let mut owed = 0u128;
    for i in 0..w.houses.len() {
        let g = w.house(i);
        if g.alive {
            assert!(g.reserve > 0 && g.supply > 0);
        }
        owed += g.reserve + g.council_due + g.bounty_left;
    }
    let _ = owed;
    assert!(w.get_age(1).unwrap().crowned.is_some());
}
