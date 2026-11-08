# Crownfall

**A 3D medieval realm where the eight great houses are memecoins.** Ride a chariot across Vael, walk into any house's
hall and play its game, back a team at the Hippodrome, and earn the seven seals that put you on the Ashen Throne.
Every round you play burns that house's coin on NEAR, so playing is what moves the price.

- **Play:** https://crownfall.nerom.site (NEAR testnet; no wallet needed to try it)
- **Contract:** [`crownfall-vael.testnet`](https://testnet.nearblocks.io/address/crownfall-vael.testnet)
- Built for the NEAR HACKATHON (Nov 2026).

## The story

The old king of Vael is dead and the Ashen Throne stands empty for one season. By the old law the crown goes to
whoever earns the seals of the **Seven Wardens** before the season ends. You arrive at the south gate with a borrowed
chariot and a house to swear to.

| Warden | Trial | Seal |
|---|---|---|
| Stepan Gershuni, Warden of the Gate | Drive the Greywater markers against the clock | Gate |
| Kain Warwick, Master of the Mint | Buy your house's coin, then play your own hall's game | Mint |
| Eddy Lazzarin, Keeper of the Bridge | Win the Vintner's Cups in House Velmont's cellar | Bridge |
| Avichal Garg, Keeper of the Lighthouse | Bring six ships in at House Ashveil's signal hall | Lighthouse |
| Haseeb Qureshi, Keeper of the Library | Beat him at Liar's Dice | Library |
| Mert Mumtaz, Master of the Hippodrome | Finish in the top four of a chariot race | Hippodrome |
| Illia Polosukhin, Founder of the Reach | Hold six seals, win in three halls, then win the Crown Race | Throne |

The Wardens are named for the hackathon's judges, with roles drawn from their work. Names and roles only: the figures
are our own characters, and every line they speak is in-world.

## The eight houses

Each house is a seat, a coin and a hall game.

| House | Seat | Coin | Hall game |
|---|---|---|---|
| Ashveil | Greywater | $HERON | Lantern Signals: repeat the ships' lantern signals |
| Corrin | Redfield Keep | $BOAR | Axe Throw |
| Velmont | Vinehold | $RAM | The Vintner's Cups: follow the ram under the goblets |
| Thorne | Mirefort | $ASP | The Asp's Basket: steal gold, freeze when it rises |
| Halloway | Pinewatch | $OWL | Pinewatch Archery: five arrows, mind the wind |
| Draven | Stonedeep | $BULL | The Forge: strike while the steel glows |
| Marrow | High Marrow | $LYNX | Ice Stones: slide and sweep to the mark |
| Sorrel | Gullcrest | $HAWK | Falconry: fly the hawk along the cliffs |

Plus **Liar's Dice** in Qureshi's Library (staked in NEAR) and **chariot races** at the Mumtaz Hippodrome.

## How to play

1. Open the site, look over the realm, and **Take your seat**: pick a house, a lord and a name.
2. **WASD** to walk (Shift to run), **E** to talk, trade, enter and take the reins, **C** to whistle for your
   chariot, **Space** to crack the whip, **M** for the map, **J** for the Seal Book, **Esc** to pause.
3. Follow the objective line at the bottom of the screen. The Seal Book (J) lists every trial and every hall.

Without a wallet you play on a **practice purse** kept in your browser. Press **Play on NEAR testnet** (top left)
to play the real thing: connect a NEAR wallet once, approve a session key for the game, and from then on hall rounds,
whips and seals are signed without a popup. Buying coin and staking or betting NEAR still go through your wallet.

## What happens on NEAR

The realm's ledger is one contract, [`chain/`](chain/src/lib.rs) (Rust, near-sdk 5).

- **Eight coins on curves.** A coin's price is its house's NEAR reserve divided by its supply. Buying adds NEAR and
  mints coin at that price; selling burns coin and pays NEAR back. A 5% fee on every trade: 3 points stay in the
  reserve (the price rises for holders), 2 go to the crown pool.
- **Play to burn.** Every hall round burns that house's coin (`enter`: 400 coin, 500 at High Marrow). Burning shrinks
  supply against the same reserve, so every round played raises the price for everyone who holds that house. Burns
  earn favour with the house; a won round earns more (`finish`).
- **The Library.** Liar's Dice is staked at 1 NEAR. Your first win pays the stake back doubled (the bonus comes from
  the crown pool, while it lasts); later wins hand the stake back; a lost stake goes to the crown pool.
- **The seals** are kept per account, and the contract checks what it can see: the Mint seal needs a coin bought and a
  round played, the Bridge, Lighthouse and Library seals need a won round in that hall, the Throne needs the other six
  and wins in three halls.
- **The Hippodrome.** Anyone can call a race (`call_race`); it is seeded from the block's randomness. Bets are
  pari-mutuel in NEAR for 90 seconds. In the first 40 seconds of the run you can crack up to three whips for a team,
  each burning 200 of that house's coin. `settle` **runs the race inside the contract** ([`sim.rs`](chain/src/sim.rs)),
  the same deterministic simulation the browser draws ([`raceSim.ts`](web/src/realm/raceSim.ts)), so the result on
  screen and the result that pays out are the same race. A test checks the two bit for bit over 40 races.
- **The Ashen Throne.** When a season ends, the house with the most favour is crowned (`end_season`) and the crown
  pool is shared by that house's players in proportion to their favour (`claim_crown`).

**What isn't proven on chain:** a hall game runs in your browser, and its result is reported by your own client
(`finish`). A false win can only add favour on top of coin you really burned; in the Library it can win back your own
stake, plus the doubled bonus once per account. Race results and every other payout are computed on chain.

Views: `get_realm`, `get_account`, `get_race`, `get_ticket`, `get_season`, `quote_buy`, `quote_sell`, `preview_race`.

## Repo layout

| Path | What |
|---|---|
| `web/` | The game: Vite, React, three.js via react-three-fiber |
| `web/src/realm/` | The world: terrain, roads, keeps, halls, people, the player, races, missions |
| `web/src/games/` | The nine hall games and the round lifecycle (`host.ts`) |
| `web/src/chain/` | NEAR: wallet (near-connect), session key, contract calls, race polling |
| `chain/` | The contract, the race simulation and its tests |
| `contract/`, `sim/` | An earlier design (houses, decrees, councils), kept for reference; not deployed |
| `design/` | Design notes, the story, playtest audits |

## Run it

```bash
cd web && npm install && npm run dev
```

The game opens on http://localhost:5196.

```bash
cd chain && cargo test
```

```bash
cd chain && cargo near build non-reproducible-wasm
```

The contract talks to `crownfall-vael.testnet` by default (`web/src/chain/near.ts`).
