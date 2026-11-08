# CROWNFALL

A living 3D realm where eight great houses fight for the Ashen Throne, and every house is a memecoin on NEAR.

NEAR HACKATHON, due Nov 14 2026 23:59 UTC. Tracks: **Memecoins With Mechanics**, **Games With Real Economies**,
**Social Money**, **Open Innovation**. Replaces the Pantheon island design (DESIGN.md), keeping its contract engine:
gods become houses, temples become councils, miracles become decrees.

The theme is original: rival houses, a throne, ravens, betrayal, war. No names, places, sigils or art from any existing
show or book.

## The pitch in one breath

You open a 3D realm. Peasants work the fields, knights ride the roads, ravens cross the sky. Each raven is a real NEAR
transaction between houses. Pick a house and buy its coin, and you have sworn to it. Its biggest holders sit on its
council, which is a real Sputnik DAO with a real treasury: they vote to march on a rival, and you watch the army leave
the castle gates and cross the map. Houses that fall leave ruins and their holders scatter. A house whose coin grows big
enough graduates to a real Ref Finance pool. Once a day, the houses race chariots in the capital's arena, and you bet in
house coins. Whoever sits the Ashen Throne when the season ends takes the crown pool.

## The realm of Vael

Eight seats around one capital, Emberfall, with the throne hall and the Hippodrome.

| House | Sigil | Seat | Land | Colours | Coin |
|---|---|---|---|---|---|
| Ashveil | Black heron | Greywater | harbour city | black, silver | $HERON |
| Corrin | Red boar | Redfield Keep | wheatlands | crimson, black | $BOAR |
| Velmont | Golden ram | Vinehold | vineyard hills | gold, plum | $RAM |
| Thorne | Green asp | Mirefort | marsh delta | green, bone | $ASP |
| Halloway | White owl | Pinewatch | pine forest | white, slate | $OWL |
| Draven | Iron bull | Stonedeep | quarry and mines | iron, ochre | $BULL |
| Marrow | Grey lynx | High Marrow | snow mountains | grey, ice blue | $LYNX |
| Sorrel | Crimson hawk | Gullcrest | sea cliffs | scarlet, sand | $HAWK |

### The judges, as honours (names only, no likeness)

Landmarks named for the judges. They're not characters, they don't fight, and they don't die.

- **Polosukhin's Reach**: the great north road every army takes to the capital.
- **The Lazzarin Bridge**: the only bridge over the Ember River.
- **Mumtaz Hippodrome**: the chariot arena in Emberfall.
- **Garg's Lighthouse**: guides the trade ships into Greywater.
- **The Warwick Mint**: where house coins graduate to the open market.
- **Qureshi's Library**: the Book of Ages, the chronicle of every season.
- **Gershuni Gate**: the gate of the capital.

### Take your seat (opt-in)

Anyone, judges included, can take a seat. Connect a NEAR wallet, choose a body and a house, and set a name, sigil
colours and motto. Your lord walks the realm as a 3D character with your name over their head, and joins your house's
army when it marches. Nobody is put in the game without choosing it.

## How the coins work (Memecoins With Mechanics)

- **Bonding curve.** Price = house treasury NEAR ÷ coin supply. A 5% fee on every trade: 3 points to the treasury (price
  goes up for holders), 1 to the council, 1 to the crown pool.
- **Decrees burn coins.** Every action a house takes is paid by burning its own coin: march, raise walls, hire
  sellswords, send a raven, sabotage, sponsor a chariot. Burns shrink supply, so they raise the price for everyone who
  holds. The cost rises ×1.25 per use per season.
- **Loyalty.** Burning for a house that is not leading counts double toward your standing in it.
- **Idle coins rust.** After 24 seasons without acting, unused coins lose 1% a season. The NEAR goes to the council,
  and the price doesn't move. (The sim shows passive holders otherwise win.)
- **Fall and inherit.** A house with fewer than 5 sworn men falls. Half its treasury goes to the crown pool, and half to
  the houses that took its land.
- **Graduation at the Warwick Mint.** When a house treasury passes a line, the world contract deploys a real NEP-141 token
  for it (`heron.crownfall.near`). Holders can withdraw into it, and the world seeds a Ref Finance pool with part of the
  treasury. From then on the coin trades anywhere on NEAR.
- **The Ashen Throne.** At the end of the season, the house on the throne is crowned. Its holders split the crown pool
  by standing.

## Councils (Social Money)

- Each house council is a **Sputnik DAO**, created by the world contract. The world can only seat or unseat members.
  The top 7 holders by standing sit on the council and vote on everything else. The treasury is visible in **Trezu**.
- Council proposals: declare war, make peace, marriage pact (alliance), build (walls, granary, stables), set a bounty
  on a rival, alms to small holders, hire sellswords, name the house champion for the chariot races.
- A third of the council can **split** the house: the splitters take the NEAR behind their own coins, and the price
  stays put for the people who stay.

## The Hippodrome (Open Innovation)

- A chariot race every few hours. One chariot per house, driven by the champion the council named.
- Bets in house coins go into one pari-mutuel pot. Winners are paid in the coins of the houses that lost, so a race
  moves value between houses.
- The result is seeded on chain (`env::random_seed` at the race block) and replayed in 3D frame by frame. Anyone can
  check it.
- Players who bet can **whip** during the race. Each whip is a tiny burn that adds a little speed, so the race is part
  luck and part money.

## The AI lords (agents)

NEAR AI agents run houses nobody has claimed yet, and hold their own coins. They read the chronicle, scheme, send ravens
(on-chain messages) and propose on their councils. Players can talk to them at their seat. They're just players with
memory.

## Join from any chain

NEAR Intents (1Click) lets someone pay with SOL, ETH or USDC on another chain and land as a holder of a house coin.

## What you see (3D, Three.js)

- **The realm:** a stylised-real terrain with mountains, the river, forests and fields. The eight seats sit around
  Emberfall, with roads between them.
- **Characters with real rigs and animations** (Meshy auto-rig: idle, walk, run, attack): lords, knights, soldiers,
  peasants, the players' own lords.
- **Life:** peasants walk between fields and the town, patrols ride the roads, ravens fly for every cross-house
  transaction, smoke rises from the forges.
- **War:** when a council declares war, the soldiers form a column and march along Polosukhin's Reach. Battles are shown at
  the walls, the defender burns or holds, and the outcome comes from the contract's turn.
- **Ruins:** fallen seats go dark and broken, with crows.
- **Cutscenes:** Higgsfield video clips play when war is declared, a house falls, the throne changes, or a race is won.
- **Camera:** free orbit over the realm; click a seat to fly in. Each house has a hall view with its council, coin
  chart, decrees and your lord.

## Build plan (Nov 8–14)

| Day | Work |
|---|---|
| Nov 7–8 | Design, asset pipeline proven (one rigged lord), realm terrain + camera, houses on chain (rename of the god contract) |
| Nov 9 | Character batch (8 lords, knight, soldier, peasant, champion), castles, chariot, crowd sim on the roads |
| Nov 10 | War marches + battles from contract turns, ravens from transactions, hall view, wallet actions |
| Nov 11 | Hippodrome: race contract + 3D race replay + whip, bets |
| Nov 12 | Graduation (NEP-141 per house + Ref pool on testnet), councils wired, AI lords, Take your seat |
| Nov 13 | Cutscenes, sound, deploy (Railway + crownfall.nerom.site), README that matches what runs |
| Nov 14 | Demo video, X post, submit |
