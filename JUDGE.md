# Crownfall for judges

Each claim below comes with a way to check it. Every link goes to the chain, the code or a test, not to us.

- **Play:** https://crownfall.nerom.site
- **Judge's seat:** https://crownfall.nerom.site/?judge. It makes you a testnet account with NEAR in it (no wallet, no
  sign-in) and keeps a checklist on screen. Each line ticks itself when the contract says so.
- **Demo (2:10):** https://x.com/neromtoobad/status/2119855648150339694
- **Contract:** [`crownfall-vael.testnet`](https://testnet.nearblocks.io/address/crownfall-vael.testnet), source in [`chain/`](chain/src/lib.rs)
- **Tracks:** Games, Memecoins, Social Money, Open Innovation (the [README](README.md#hackathon-tracks) maps each one to the code)

## 1. The claims, and how to check each one

| Claim | Check it in the game | Check it on chain | Check it in code |
|---|---|---|---|
| Every house is a coin you can buy and sell | `?judge`, first line: **Buy now** | [buy](https://testnet.nearblocks.io/txns/32aYEBmczXYyXYreh6oiMcCUicbJoZ2z9R3VstxfFUsZ) (logs `mt_mint`) | `buy`, `sell` in [`lib.rs`](chain/src/lib.rs); `a_purchase_pays_for_its_records`, `every_holder_can_always_be_paid` |
| Playing a hall game burns that house's coin | Walk into your hall, play one round | [enter](https://testnet.nearblocks.io/txns/BPG9vKCie5ZaWoWyj2CWenKzgibhQdAQFAQbE5WjQUyt) (logs `mt_burn` of 400 OWL), then [finish](https://testnet.nearblocks.io/txns/9AHdgP9sjnvQPnefPAbhJ7uX34oSAPay2CZsoF3D54G9) (the `enter` event logs `burned`) | `enter` in [`lib.rs`](chain/src/lib.rs); `buying_and_burning_move_the_price`, `no_coin_no_entry` |
| Two hall games are judged by the contract, not the browser | Play Signals (Ashveil, at Greywater) or the Cups (Velmont, at Vinehold) | [enter](https://testnet.nearblocks.io/txns/3d7U8vMPihvHdyAb2LX8vtDLoUFWUwvuZNa5HwAx3KPf) rolls the seed; a [finish claiming a win](https://testnet.nearblocks.io/txns/DEBv7JDPoYYhVFHgNJT1tgdke7fo4qp1gGC48u1fgXUh) with made-up moves is replayed, scored 0 and logged `won: false, judged: true` | [`halls.rs`](chain/src/halls.rs); `a_judged_hall_ignores_a_forged_win` |
| Races are run and settled inside the contract | Bet at the Hippodrome, watch, collect | [settle](https://testnet.nearblocks.io/txns/4cvdtaye9Ma2g5yt6P6KwLiHbDwRn48X1ZkzuMrkDusM) (settle), [bet](https://testnet.nearblocks.io/txns/3V3pieYUqbcpXycULDfFRefxUYMwRGRWVSh873vVrqWe), [whip](https://testnet.nearblocks.io/txns/8DSpi2S7fwQ5p8S5q5sGNYw9eycX1SxcFsoDWFB8H1uy), [claim](https://testnet.nearblocks.io/txns/CXakAxDojcPgxaXH9mkFiabF3AQHEB87ZMApEZBEVfg7) (bet) | [`sim.rs`](chain/src/sim.rs); `sim_matches_js` (Rust race = browser race, bit for bit, 40+ cases), `the_seed_is_drawn_after_betting_closes` |
| Seals are kept on chain and follow the story | Meet the Warden of the Gate | [Gate seal](https://testnet.nearblocks.io/txns/CHnjsQtopTJYuBaskgL2Mkk9trXJkCZ985Y1AsUcUZV3) (0.01 NEAR toll), then the [Mint seal](https://testnet.nearblocks.io/txns/AGuxD8yxh8BfpPGio71SRTG2ipZXDtZ2iFZGeWhpsEU5), which the contract only grants after a buy and a played round | `seal` in [`lib.rs`](chain/src/lib.rs); `seals_follow_the_story`, `the_gate_takes_a_toll` |
| The season crowns a house and pays its players | Seal Book, then the Ashen Throne | END_SEASON_TX (season 1 crowned House Halloway) | `end_season`, `claim_crown`; `the_crown_goes_to_the_house_with_most_favour` |
| Coins are standard NEP-245 tokens | – | `mt_balance_of` on the contract page | `mt_*` in [`lib.rs`](chain/src/lib.rs); `coins_are_multi_tokens`, `a_transfer_call_returns_what_isnt_used` |
| Four rival agents play with their own wallets | Their moves show in the feed on the map | [`cf-odo-vael.testnet`](https://testnet.nearblocks.io/address/cf-odo-vael.testnet) and the other rivals | [`agents/rivals.mjs`](agents/rivals.mjs) |

## 2. Tests

52 contract tests run on every push to `chain/` ([CI](https://github.com/neromtoobad/crownfall/actions/workflows/contract.yml)).
To run them yourself:

```bash
cd chain && cargo test --release
```

```text
running 52 tests
test result: ok. 52 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

They are named after the rules they hold: `a_reported_win_moves_no_money`, `no_bets_after_the_off`,
`haseeb_rolls_in_a_later_block`, `the_first_version_upgrades_in_place`, and 48 more.

## 3. The deployed code is this repo

The contract is built with `cargo near build reproducible-wasm`, which compiles it in a pinned Docker image (set in
[`chain/Cargo.toml`](chain/Cargo.toml)). The same commit gives the same bytes on any machine.

| | |
|---|---|
| Commit | [`0daf80b`](https://github.com/neromtoobad/crownfall/tree/0daf80b7ef84553140bbea62d1c63eab09aa4dfb) |
| Code hash (base58, as NEAR shows it) | `DEq9f3kLGrTQuiWAjMbk8oyfPtxHo3173bhvV4GGFA4b` |
| sha256 of the wasm | `b5d73c74a3cfa641f52fef5b3730608f20681a227938576e36c4e5595e9de354` |
| Deployed in | DEPLOY_TX |

To check: rebuild at that commit and compare the hash with the one on the
[contract page](https://testnet.nearblocks.io/address/crownfall-vael.testnet). The contract also reports its own
source through `contract_source_metadata`.

```bash
git checkout 0daf80b && cd chain && cargo near build reproducible-wasm
shasum -a 256 target/near/crownfall_realm.wasm
```

## 4. On mainnet

The game runs on testnet so anyone can play without buying NEAR. To show the same contract works on mainnet, it was
deployed there once and the coin loop was run with real NEAR: one buy, then one hall entry that burns coin.
[`chain/mainnet.sh`](chain/mainnet.sh) is the script that did it. It was rehearsed on testnet first
([buy](https://testnet.nearblocks.io/txns/5Y2zg26tMSrWtQdVMLC6JPkLKEj7DnAnY3K86mCeX7LE),
[burn](https://testnet.nearblocks.io/txns/5SVuGNGbh6jKSdkMe4aVurDcDp9SxQ23c5LCE9eVcYRc)).

| | |
|---|---|
| Contract | MAINNET_CONTRACT |
| Buy | MAINNET_BUY |
| Burn | MAINNET_BURN |

## 5. What existed before 1 November

Nothing. The hackathon ran 1 to 14 November 2026. The design notes for an earlier idea (Pantheon) were started on 4
November, a first contract for it on 7 November, and Crownfall replaced it the same day. The repo's first commit is
[`25edcfb`](https://github.com/neromtoobad/crownfall/commit/25edcfb) on 8 November; everything since is in the
history. That first commit also carried the Pantheon contract and simulator (`contract/`, `sim/`). They were never
deployed for Crownfall and were removed on 12 November; the first commit still has them. More in the README,
[When it was built](README.md#when-it-was-built).

Outside code: near-sdk, near-api-js, near-connect, React, three.js and react-three-fiber. The models, art, music and
voices were made for this game.

**The other entry.** The same team entered [Parallax](https://github.com/neromtoobad/parallax) (AI agents that bid
for work). The two share no code, contracts or accounts.
