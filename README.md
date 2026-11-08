<h1 align="center">Crownfall</h1>

<p align="center"><b>A 3D medieval realm where the eight great houses are memecoins, on NEAR.</b></p>

<p align="center">
  <a href="https://crownfall.nerom.site"><b>Play it</b></a> ·
  <a href="https://testnet.nearblocks.io/address/crownfall-vael.testnet">Contract on NEAR testnet</a> ·
  <a href="#for-judges-try-it-in-ten-minutes">Try it in ten minutes</a> ·
  <a href="#what-happens-on-near">How the chain side works</a> ·
  <a href="#run-it">Run it</a>
</p>

<p align="center"><img src="docs/shots/01-realm.jpg" alt="The realm of Vael from above: eight keeps around a river valley, the capital in the middle" width="100%"></p>

Ride a chariot across Vael, walk into any house's hall and play its game, back a team at the Hippodrome, and earn the
seven seals that put you on the Ashen Throne. Every round you play burns that house's coin on NEAR, so playing is what
moves the price.

- **Play:** https://crownfall.nerom.site. It runs on NEAR testnet, and you can try it without a wallet.
- **Contract:** [`crownfall-vael.testnet`](https://testnet.nearblocks.io/address/crownfall-vael.testnet) (Rust, near-sdk 5, [`chain/`](chain/src/lib.rs))
- Built for the NEAR HACKATHON, November 2026, in four tracks ([see below](#hackathon-tracks)). The same team's
  other entry is [Parallax](https://github.com/neromtoobad/parallax), a company of AI agents that bid for work. The two
  projects are independent: no shared code or contracts.

<table>
  <tr>
    <td width="50%"><img src="docs/shots/02-capital.jpg" alt="Your lord and chariot in the capital square"></td>
    <td width="50%"><img src="docs/shots/08-hall.jpg" alt="Inside House Draven's hall at Stonedeep"></td>
  </tr>
  <tr>
    <td>The capital. Your lord, your chariot, the Mint ahead.</td>
    <td>Every keep has a hall you can walk into. This is House Draven's, at Stonedeep.</td>
  </tr>
</table>

## For judges: try it in ten minutes

You need a NEAR **testnet** account with about 2 testnet NEAR. If you don't have one, make one in
[MyNearWallet (testnet)](https://testnet.mynearwallet.com/) or Meteor, and top it up at
[near-faucet.io](https://near-faucet.io/). Every call below is on testnet; you can watch them land on
[`crownfall-vael.testnet`](https://testnet.nearblocks.io/address/crownfall-vael.testnet) as you go.

| Do this | You'll see |
|---|---|
| **1.** Open https://crownfall.nerom.site | The realm of Vael from above: eight keeps, the capital, and a live race card bottom left. |
| **2.** Press **Connect wallet & take your seat**, connect your wallet, pick a house, a lord and a name, press **Enter** | Your wallet asks once to add a game key: a function-call key limited to this contract with a 0.5 NEAR gas allowance. You land in the capital, Emberfall, with your account in the pill top left. |
| **3.** Walk to the Mint just ahead (the counter with the big coin) and press **E**: **Trade** | The eight house coins with price, supply, reserve and coin burned, read from the contract. |
| **4.** Pick a house's coin, type `0.1`, press **Buy with 0.1 NEAR** | Your wallet confirms `buy`. The coin lands in your purse (top right), and the pill top left shows **✓ … on NEAR**, linked to the transaction. |
| **5.** Press **M** for the map and tap that house's keep to set a waypoint. Press **C** to whistle for your chariot and **E** to take the reins | The radar draws the road route to the keep. **W** to drive, **A**/**D** to steer, **Space** to whip. |
| **6.** At the keep's lit door press **E** (**Enter**), walk to the table, press **E** (**Play**), then **Play** on the card | No wallet popup: the game key signs `enter`, which burns 400 of that house's coin. Back at the Mint, that coin's burned count has gone up, and its price with it. |
| **7.** Play the round (each game shows its controls) | The result is reported with `finish`: favour with the house, more for a win. |
| **8.** Drive to the Mumtaz Hippodrome (**H** on the radar). At the stables press **E** (**Race**), then **Watch and bet on NEAR**. While the teams parade, choose a stake and press **Back** on one | Your wallet confirms `bet` in NEAR. In the first 40 seconds of the run, **Crack the whip** burns 200 of that team's coin through the game key (`whip`). |
| **9.** Watch to the line | The card reads **Settled on NEAR**: `settle` re-ran the race inside the contract ([`sim.rs`](chain/src/sim.rs)) and got the same finish you watched. A winning ticket shows **Collect** (`claim_race`). |
| **10.** Press **J** for the Seal Book and follow the objective line to the Wardens | Each trial you finish writes a seal to your account with `seal`; the contract checks the ones it can see (coin bought, hall wins). |
| **11.** Enter the hall of the Ashen Throne (**♛** on the radar) | Every house ranked by this season's favour (yours is marked), the season clock and the crown pool, all read from the contract. |

**Check the chain directly.** These read-only calls need no account:

```bash
near contract call-function as-read-only crownfall-vael.testnet get_realm json-args {} network-config testnet now
near contract call-function as-read-only crownfall-vael.testnet get_account json-args '{"account":"YOUR_ACCOUNT.testnet"}' network-config testnet now
```

**Seasons.** A season lasts 24 hours on the contract clock. Enter the hall of the Ashen Throne in the capital (**♛**
on the radar, **E**: **Enter**) to see this season's favour by house, the time left and the crown pool. Once the time is
up, anyone there can press **Crown the house with the most favour** (`end_season`), and the next time you come in, the
last season's result is at the top with **Take your share** (`claim_crown`) if you played for the crowned house. What
you'd be paid is read first with `get_crown`, so the button shows the exact amount.

**No wallet?** Press **Practice without a wallet** in the seat picker: everything plays on a practice purse kept in
your browser, and nothing goes on chain.

**On a phone.** Turn it sideways. The left thumb is the joystick, drag on the right to look, and the buttons on the
right are Use, Run, Chariot and Map. Each hall game has its own touch buttons.

## Hackathon tracks

| Track | What Crownfall does for it | Where to look |
|---|---|---|
| **Memecoins With Mechanics** | Eight house coins, each on its own curve (price = NEAR reserve ÷ supply). The meme is the mechanic: the only way to play a house's hall game is to burn its coin, so every round played lifts the price for everyone who holds that house. Whips at the races burn coin too, and 2% of every trade feeds the crown pool. | [`chain/src/lib.rs`](chain/src/lib.rs) (`buy`, `sell`, `enter`, `whip`), [`web/src/chain/game.ts`](web/src/chain/game.ts), the Mint panel in [`web/src/PlayHud.tsx`](web/src/PlayHud.tsx) |
| **Games With Real Economies** | A 3D realm with nine hall games, a story of seven trials and chariot racing. Rounds cost real coin, the Library is staked in NEAR, and races take pari-mutuel NEAR bets settled by running the race inside the contract. The chain stays in the background: one wallet connect and a game key, then rounds, seals and whips sign without popups. | [`web/src/games/`](web/src/games/) (`host.ts` is the round lifecycle), [`web/src/realm/missions.ts`](web/src/realm/missions.ts), [`chain/src/sim.rs`](chain/src/sim.rs) + [`web/src/realm/raceSim.ts`](web/src/realm/raceSim.ts), [`web/src/chain/near.ts`](web/src/chain/near.ts) (game key) |
| **Social Money** | Each house is a community with a shared treasury and reward rules. The crown pool collects 2% of every trade and every lost stake. When the season ends the house its players lifted highest is crowned, and the pool is split among that house's players by the favour they earned. | [`chain/src/lib.rs`](chain/src/lib.rs) (`add_favour`, `end_season`, `claim_crown`), the crown test in [`chain/src/tests.rs`](chain/src/tests.rs) |
| **Open Innovation** | A memecoin market you walk through: the price chart is a living realm, trading is a trip to the Mint, and the leaderboard is a throne. The race that pays out is the same deterministic race you watch, checked bit for bit between Rust and TypeScript. | The whole repo; the race check is `sim_matches_js` in [`chain/src/tests.rs`](chain/src/tests.rs) |

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

The Wardens are named for the hackathon's judges, with roles drawn from their work. We use their names and roles
only. The figures are our own characters, and every line they speak is in-world.

<table>
  <tr>
    <td width="50%"><img src="docs/shots/04-seal-book.jpg" alt="The Seal Book: seven seals, the trial for each, and every hall"></td>
    <td width="50%"><img src="docs/shots/05-map.jpg" alt="The map of Vael with the eight keeps, the capital and the Hippodrome"></td>
  </tr>
  <tr>
    <td><b>The Seal Book</b> (J): every trial, every hall, what you've won.</td>
    <td><b>The map</b> (M): eight keeps, the capital, the Hippodrome.</td>
  </tr>
</table>

## The eight houses

Each house has a seat, a coin and a hall game.

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

There's also **Liar's Dice** in Qureshi's Library (staked in NEAR) and **chariot racing** at the Mumtaz Hippodrome.

### The hall games

<table>
  <tr>
    <td width="33%"><img src="docs/shots/12-signals.jpg" alt="Lantern Signals at Greywater"></td>
    <td width="33%"><img src="docs/shots/13-axes.jpg" alt="Axe Throw at Redfield Keep"></td>
    <td width="33%"><img src="docs/shots/14-cups.jpg" alt="The Vintner's Cups at Vinehold"></td>
  </tr>
  <tr>
    <td><b>Lantern Signals</b> · Ashveil · $HERON</td>
    <td><b>Axe Throw</b> · Corrin · $BOAR</td>
    <td><b>The Vintner's Cups</b> · Velmont · $RAM</td>
  </tr>
  <tr>
    <td><img src="docs/shots/15-asp.jpg" alt="The Asp's Basket at Mirefort"></td>
    <td><img src="docs/shots/10-archery.jpg" alt="Pinewatch Archery"></td>
    <td><img src="docs/shots/16-forge.jpg" alt="The Forge at Stonedeep"></td>
  </tr>
  <tr>
    <td><b>The Asp's Basket</b> · Thorne · $ASP</td>
    <td><b>Pinewatch Archery</b> · Halloway · $OWL</td>
    <td><b>The Forge</b> · Draven · $BULL</td>
  </tr>
  <tr>
    <td><img src="docs/shots/17-stones.jpg" alt="Ice Stones at High Marrow"></td>
    <td><img src="docs/shots/18-falcon.jpg" alt="Falconry at Gullcrest"></td>
    <td><img src="docs/shots/11-dice.jpg" alt="Liar's Dice in the Library"></td>
  </tr>
  <tr>
    <td><b>Ice Stones</b> · Marrow · $LYNX</td>
    <td><b>Falconry</b> · Sorrel · $HAWK</td>
    <td><b>Liar's Dice</b> · the Library · 1 NEAR</td>
  </tr>
</table>

Each game opens on a card that tells you what the round costs and what a win pays before you commit:

<p align="center"><img src="docs/shots/09-archery-card.jpg" alt="The round card for Pinewatch Archery: entry burn, payout, controls" width="80%"></p>

## How to play

1. Open the site, look over the realm, and press **Connect wallet & take your seat**. Connect a NEAR testnet
   wallet, then pick a house, a lord and a name. On the way in, your wallet asks once for the game key.
2. **WASD** to walk (Shift to run), **E** to talk, trade, enter and take the reins, **C** to whistle for your
   chariot, **Space** to crack the whip, **M** for the map, **J** for the Seal Book, **Esc** to pause.
   On a phone, turn it sideways: the left thumb is the joystick, drag on the right to look, and the buttons on the
   right are Use, Run, Chariot and Map.
3. Follow the objective line at the bottom of the screen. The Seal Book (J) lists every trial and every hall.

With the game key in place, hall rounds, whips and seals are signed without a popup. Buying coin, staking and betting
NEAR still go through your wallet. No wallet yet? **Practice without a wallet** plays on a practice purse kept in your
browser, and the pill at the top left connects one whenever you're ready.

<table>
  <tr>
    <td width="50%"><img src="docs/shots/03-mint.jpg" alt="The Mint: eight coins with live price, supply, reserve and burned"></td>
    <td width="50%"><img src="docs/shots/07-hippodrome.jpg" alt="A chariot race in progress at the Hippodrome, with the race card"></td>
  </tr>
  <tr>
    <td><b>The Mint.</b> Each coin's price, supply, reserve and burn, read from the contract.</td>
    <td><b>The Hippodrome.</b> Eight teams, pari-mutuel bets, three whips each, settled on chain.</td>
  </tr>
</table>

## What happens on NEAR

The realm's ledger is one contract, [`chain/`](chain/src/lib.rs).

```mermaid
flowchart LR
  subgraph Browser["Browser (web/)"]
    G[Hall games<br/>and the realm]
    S[Race drawing<br/>raceSim.ts]
    K[Game key<br/>function-call only]
  end
  W[Your NEAR wallet]
  subgraph C["crownfall-vael.testnet (chain/)"]
    M[8 coin curves<br/>buy · sell]
    H[Hall rounds<br/>enter · finish · stake]
    SE[Seals<br/>seal]
    R[Races<br/>call_race · bet · whip · settle]
    SIM[sim.rs<br/>same race, bit for bit]
    P[(Crown pool)]
    T[Seasons<br/>end_season · claim_crown]
  end
  W -- "buy, stake, bet (NEAR)" --> C
  K -- "enter, finish, seal, whip, settle" --> C
  G --> K
  S -. same seed and whips .- SIM
  R --> SIM
  M -- "2% of every trade" --> P
  H -- "lost stakes" --> P
  P --> T
```

- **Eight coins on curves.** A coin's price is its house's NEAR reserve divided by its supply. Buying adds NEAR and
  mints coin at that price; selling burns coin and pays NEAR back. Every trade pays a 5% fee: 3 points stay in the
  reserve, which lifts the price for holders, and 2 go to the crown pool.
- **Play to burn.** Every hall round burns that house's coin (`enter`: 400 coin, 500 at High Marrow). Burning shrinks
  supply against the same reserve, so every round played raises the price for everyone who holds that house. Burns
  earn favour with the house, and a won round earns more (`finish`).
- **The Library.** Liar's Dice is staked at 1 NEAR. Your first win pays the stake back doubled, with the bonus taken
  from the crown pool while it lasts. Later wins return the stake, and a lost stake goes to the crown pool.
- **The seals** are kept per account, and the contract checks what it can see. The Mint seal needs a coin bought and
  a round played. The Bridge, Lighthouse and Library seals each need a won round in that hall. The Throne needs the
  other six seals and wins in three halls.
- **The Hippodrome.** Anyone can call a race (`call_race`), seeded from the block's randomness. Bets are pari-mutuel
  in NEAR for 90 seconds. In the first 40 seconds of the run you can crack up to three whips for a team, each burning
  200 of that house's coin. `settle` **runs the race inside the contract** ([`sim.rs`](chain/src/sim.rs)), the same
  deterministic simulation the browser draws ([`raceSim.ts`](web/src/realm/raceSim.ts)), so the race you watch is
  the race that pays out. A test checks the two match bit for bit over 40 races.
- **The Ashen Throne.** When a season ends, the house with the most favour is crowned (`end_season`). The crown pool
  is shared among that house's players in proportion to their favour (`claim_crown`).

**The game key.** When you connect, your wallet adds one function-call key, limited to this contract and to `enter`,
`finish`, `seal`, `whip`, `call_race`, `settle`, `claim_race`, `claim_crown`, `end_season` and `sell`, with a
0.5 NEAR gas allowance. It can't send your NEAR anywhere except back to you. Anything that spends NEAR goes through
your wallet.

**What isn't proven on chain.** A hall game runs in your browser, and your own client reports the result (`finish`).
A false win can only add favour on top of coin you really burned. In the Library it can win back your own stake,
plus the doubled bonus once per account. Race results and every other payout are computed on chain.

| Call | Who signs | What it does |
|---|---|---|
| `buy(house)` / `sell(house, amount)` | wallet / game key | Trade a house coin on its curve |
| `enter(house)` | game key | Burn the entry and open a hall round |
| `stake()` | wallet | Put 1 NEAR on the Library table |
| `finish(round, won, grade)` | game key | Close a round: favour, wins, Library payout |
| `seal(n)` | game key | Take a Warden's seal once its trial is met |
| `call_race()` / `bet(race, house)` | game key / wallet | Open a race; back a team in NEAR |
| `whip(race, house)` | game key | Burn 200 coin to drive a team on |
| `settle(race)` / `claim_race(race)` | game key | Run the race on chain; collect a winning ticket |
| `end_season()` / `claim_crown(season)` | game key | Crown a house; take your share of the pool |

Views: `get_realm`, `get_account`, `get_race`, `get_ticket`, `get_season`, `get_crown`, `quote_buy`, `quote_sell`, `preview_race`.

## Built with

- **Game:** Vite, React and three.js through react-three-fiber. The lords, the horses and the keeps are rigged and
  textured glTF models generated from our own character sheets. The chariot and the props are scripted in Blender
  ([`design/blender/`](design/blender/)).
- **Chain:** Rust and near-sdk 5.30 for the contract. The web side uses near-api-js for calls and
  [near-connect](https://github.com/hot-dao/near-connect) for wallets.
- **Hosting:** Vercel, at crownfall.nerom.site.

## Repo layout

| Path | What |
|---|---|
| `web/` | The game: Vite, React, three.js via react-three-fiber |
| `web/src/realm/` | The world: terrain, roads, keeps, halls, people, the player, races, missions |
| `web/src/games/` | The nine hall games and the round lifecycle (`host.ts`) |
| `web/src/chain/` | NEAR: wallet (near-connect), game key, contract calls, race polling |
| `chain/` | The contract, the race simulation and its tests |
| `contract/`, `sim/` | An earlier design (houses, decrees, councils), kept for reference and not deployed |
| `design/` | Design notes, the story, playtest audits |
| `docs/shots/` | The screenshots in this README |

## Run it

The game opens on http://localhost:5196.

```bash
cd web && npm install && npm run dev
```

The contract's tests include the race check against the browser sim.

```bash
cd chain && cargo test
```

```bash
cd chain && cargo near build non-reproducible-wasm
```

The web app talks to `crownfall-vael.testnet` by default. Set `VITE_CONTRACT` to point it at your own deployment
([`web/src/chain/near.ts`](web/src/chain/near.ts)).

## License

MIT, see [LICENSE](LICENSE).
