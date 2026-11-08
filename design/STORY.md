# Crownfall: story, the Seven Wardens and the house halls (Nov 8)

The user's notes after the feel pass:
- "running through the horses"
- "once i start the game i am lost. what do i do? whats the story line?"
- "inputing the judges like i asked"
- "i cant enter other villas and participate. each house should have something fun to do inside. like maybe mini games"

## The story in one breath

The old king of Vael is dead and the Ashen Throne stands empty for one season. By the old law, the crown goes to
whoever earns the seals of the **Seven Wardens** before the season ends. The Wardens don't rule; they judge.
You arrive at the Gershuni Gate as a nobody with a borrowed chariot. Collect seven seals, sit the throne.

The goal is always on screen: the **seal bar** (seven seals, lit when earned) and one objective line under it.
**J** opens the Seal Book: every trial, where it is, and what every house hall offers. The **Two Scribes**
(Claude & Codex, who read every scroll before the Wardens do) stand in the Library and tell you what to do next.

## The Wardens (the judges, by name; roles drawn from their work; no likeness, no deaths, no mockery)

Bodies are our own medieval characters. Names are real, roles are tributes, and nothing puts real opinions in their
mouths: lines are in-world.

| # | Warden | Real | Where | Trial | Seal |
|---|---|---|---|---|---|
| 1 | **Stepan Gershuni**, Warden of the Gate | cyber•Fund | Gershuni Gate | Learn the reins: drive the Greywater markers | Gate |
| 2 | **Kain Warwick**, Master of the Mint | Synthetix, Infinex | Warwick Mint | Swear to a house: buy its coin. Your hall opens | Mint |
| 3 | **Eddy Lazzarin**, Keeper of the Bridge | a16z crypto | Lazzarin Bridge | "Don't trust, verify": win the Vintner's Cups in House Velmont's cellar | Bridge |
| 4 | **Avichal Garg**, Keeper of the Lighthouse | Electric Capital | Garg's Lighthouse | "Count every ship": bring six ships in at House Ashveil's signal hall | Lighthouse |
| 5 | **Haseeb Qureshi**, Keeper of the Library | Dragonfly (and once a poker pro) | Qureshi's Library | Beat him at Liar's Dice | Library |
| 6 | **Mert Mumtaz**, Master of the Hippodrome | Helius | Hippodrome stables | Finish top four in a race | Hippodrome |
| 7 | **Illia Polosukhin**, the Founder, Lord of the Reach | NEAR | Hall of the Ashen Throne | Needs the six seals: win in three house halls, then win the Crown Race | Throne |

Then you're crowned: a cutscene in the throne hall, your banner on every tower, and the title "Keeper of the Ashen Throne".

## The house halls (enter any keep: E at its door)

Every keep has a door. Inside is a hall dressed for that house, with its lord, its people, its hearth and its game.
Every game costs **an entry in that house's coin, which burns**, so every play is a tiny decree that raises the price
for that house's holders. Winning pays from the house treasury and earns **favour** with that house. This is the
memecoin mechanic as gameplay: playing a house's game is how its coin burns.

| House | Hall | Game | Loop |
|---|---|---|---|
| Ashveil (heron, harbour) | Signal hall over the harbour | **Lantern Signals** | Ships flash a lantern sequence; repeat it on four lamps to bring each ship in. Grows by one each ship |
| Corrin (boar, wheat) | Feast hall, long tables, a boar's head | **Axe Throw** | Swinging aim + power; five throws at a target that starts moving; bullseye rings |
| Velmont (ram, vineyard) | Wine cellar under the hill | **The Vintner's Cups** | A gold ram coin under one of three goblets; they shuffle, faster each round; pick the cup |
| Thorne (asp, marsh) | Reed hall on stilts, green gloom | **The Asp's Basket** | Steal coins from a basket while the asp sways; freeze when it rears; caught = bitten |
| Halloway (owl, pine) | Timber lodge with a long range | **Pinewatch Archery** | Draw, aim, allow for the realm's wind (gusts are shared with the trees), five arrows |
| Draven (bull, quarry) | The forge under the mountain | **The Forge** | Strike on the glow: a rhythm of hammer blows shapes a blade; misses crack it |
| Marrow (lynx, snow) | Ice hall, frozen floor | **Ice Stones** | Slide stones toward the lynx mark; aim, weight, sweep to carry; knock theirs out |
| Sorrel (hawk, cliffs) | Cliff aerie, open arches over the sea | **Falconry** | Fly the house hawk through the cliffs and snatch gulls; dive for speed |
| (Library) | Qureshi's Library | **Liar's Dice** | Five dice each under cups, bid or call liar, against Haseeb |

Scoring: each game returns `{ won, score, line }`. A win pays 1–4 NEAR (practice purse now, house treasury on chain
later), +1 favour with that house, and the house lord says something.

## The first ten minutes

1. Prologue (letterbox): the empty throne, the law of seals, "the Wardens are watching". You stand at the Gershuni Gate.
2. Stepan Gershuni is right there (yellow marker). He explains the seals, hands you the Seal Book, and sets the
   first trial: the reins.
3. Kain Warwick at the Mint: buy your house's coin. "Your hall's doors are open to you now. Every hall in Vael is,
   for a price."
4. The objective sends you home to your own hall (GPS), where you play your house's game once (practice, free).
5. From then on the Seal Book lists the remaining Wardens and you choose the order.

## Contract mapping (later)

Entry burns = `decree(house, 'play', burn)`. Payouts = house treasury transfers. Favour = standing. Seals are a
per-account bitmask in the world contract, and the throne claim checks it.
