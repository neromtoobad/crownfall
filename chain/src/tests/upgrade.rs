// Storage and the in-place upgrade from the first version.
use super::*;


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
