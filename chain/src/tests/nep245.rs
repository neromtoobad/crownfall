// House coins as NEP-245 multi-tokens.
use super::*;


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
