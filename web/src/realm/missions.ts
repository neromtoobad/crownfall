// The story of a new lord in Vael. The old king is dead and the Ashen Throne stands empty for one season; by the old
// law it goes to whoever earns the seals of the SEVEN WARDENS. The Wardens are the realm's judges, named for the
// judges of the NEAR HACKATHON: names and roles only (drawn from their work), our own figures, no likeness.
// Walk into a Warden's yellow marker to hear their trial; the objective shows at the bottom, the radar shows the way.
import './bridges.ts'; // sets the Lazzarin Bridge's position before the Wardens are placed
import { BRIDGES } from './bridges.ts';
import { HIPPODROME, HOUSES, LANDMARKS, ROADS, roadCurve, yardOf } from './layout.ts';
import { flags, ledger, note, pay } from './ledger.ts';
import { takeSeal } from '../chain/game.ts';
import { chain, onChain } from '../chain/near.ts';
import { PLACES, STABLES } from './places.ts';
import { emitPlay, me, play, hush } from './play.ts';
import { LIBRARY, doorOf, libDoor } from './rooms.ts';
import { flagsGame } from '../games/host.ts';

export interface Line { who: string; text: string }
export interface Step {
  /** The objective, with **keywords** drawn in the marker's colour. */
  text: () => string;
  /** Where the radar and the GPS line point. */
  target?: () => [number, number] | undefined;
  /** Reach the target (within r) to complete this step, or… */
  r?: number;
  /** …make this true. */
  check?: (s: Run) => boolean;
  /** Drive through these in order, against the clock. */
  gates?: () => [number, number][];
  limit?: (s: Run) => number;
  /** Return a reason to fail the mission. */
  fail?: (s: Run) => string | undefined;
  /** Said when the step begins. */
  lines?: () => Line[];
}
export interface Mission {
  id: string; title: string; giver: Giver;
  /** Can it be started yet? (Default: always.) */
  needs?: () => boolean;
  /** The seal it earns, if it is a Warden's trial. */
  seal?: string;
  /** One line for the Seal Book: what the trial asks. */
  brief: () => string;
  intro: () => Line[]; steps: Step[]; outro: () => Line[];
  reward: { near: number; renown: number; title?: string };
}
export interface Giver {
  id: string; name: string; letter: string; body: string; at: [number, number]; face: number;
  /** Their office in Vael ("Warden of the Gate"). */
  title?: string;
  /** Who they are in our world: shown in the Seal Book. */
  real?: string;
  /** A tint over the body's clothes, so two Wardens who share a figure don't look alike. */
  tint?: string;
}
/** The mission in progress. */
export interface Run { id: string; step: number; t0: number; stepT0: number; gate: number; limit?: number }

const seat = () => play.seat!;
const mine = () => HOUSES[seat().house];
const [mx, mz] = LANDMARKS[4].pos;
const MINT_RY = 0.2;
/** The rival nearest to Emberfall, who isn't you: your first neighbour to deal with. */
const rival = () => HOUSES.filter((h) => h.id !== seat().house).sort((a, b) => Math.hypot(...a.pos) - Math.hypot(...b.pos))[0];
/** A second rival, further off: the one you march on. */
const enemy = () => HOUSES.filter((h) => h.id !== seat().house && h.id !== rival().id).sort((a, b) => Math.hypot(...a.pos) - Math.hypot(...b.pos))[0];
const doorAt = (h: number) => { const d = doorOf(HOUSES[h]); return [d.x + Math.sin(d.face) * 3, d.z + Math.cos(d.face) * 3] as [number, number]; };
const since = (f: { t: number } | undefined, s: Run) => !!f && f.t >= s.t0;
const sinceStep = (f: { t: number } | undefined, s: Run) => !!f && f.t >= s.stepT0;
const nth = (n: number) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th');
const won = (id: string, s: Run) => { const g = flagsGame.last; return !!g && g.t >= s.t0 && g.won && g.id === id; };

// Where the Lazzarin Bridge meets the capital's bank: the keeper stands just off the deck on the dry end.
const bridgeFoot = (): [number, number] => {
  const b = BRIDGES.find((x) => Math.hypot(x.a.x - x.b.x, x.a.y - x.b.y) > 0 && Math.abs((x.a.x + x.b.x) / 2 - LANDMARKS[1].pos[0]) < 1 && Math.abs((x.a.y + x.b.y) / 2 - LANDMARKS[1].pos[1]) < 1);
  if (!b) return [LANDMARKS[1].pos[0] + 30, LANDMARKS[1].pos[1]];
  const e = Math.hypot(b.a.x, b.a.y) < Math.hypot(b.b.x, b.b.y) ? b.a : b.b, o = e === b.a ? b.b : b.a;
  const dx = e.x - o.x, dz = e.y - o.y, l = Math.hypot(dx, dz) || 1;
  return [e.x + (dx / l) * 9 - (dz / l) * 9, e.y + (dz / l) * 9 + (dx / l) * 9];
};
const BRIDGE = bridgeFoot();
const [lhx, lhz] = LANDMARKS[3].pos;
const [libx, libz] = LANDMARKS[5].pos;
/** Haseeb waits at the foot of the Library steps, off to one side of the door. */
const QA = Math.PI / 2 + 0.6;

/** The Seven Wardens, and the two who help along the way. */
export const GIVERS: Giver[] = [
  { id: 'gershuni', name: 'Stepan Gershuni', title: 'Warden of the Gate', real: 'cyber•Fund', letter: 'G', body: 'soldier', tint: '#6f7f99', at: [47, 80], face: 0.52 + Math.PI },
  { id: 'warwick', name: 'Kain Warwick', title: 'Master of the Mint', real: 'Synthetix & Infinex', letter: 'W', body: 'peasant-m', tint: '#c9a24a', at: [mx + Math.sin(MINT_RY) * 27 + Math.cos(MINT_RY) * 7, mz + Math.cos(MINT_RY) * 27 - Math.sin(MINT_RY) * 7], face: MINT_RY + Math.PI },
  { id: 'lazzarin', name: 'Eddy Lazzarin', title: 'Keeper of the Bridge', real: 'a16z crypto', letter: 'L', body: 'peasant-m', tint: '#5d7a6a', at: BRIDGE, face: Math.atan2(-BRIDGE[0], -BRIDGE[1]) },
  { id: 'garg', name: 'Avichal Garg', title: 'Keeper of the Lighthouse', real: 'Electric Capital', letter: 'A', body: 'peasant-m', tint: '#3f6f8f', at: [lhx - 14, lhz - 10], face: Math.atan2(-14, -10) + Math.PI },
  { id: 'qureshi', name: 'Haseeb Qureshi', title: 'Keeper of the Library', real: 'Dragonfly', letter: 'Q', body: 'peasant-m', tint: '#6a4a7a', at: [libx + Math.cos(QA) * 18, libz + Math.sin(QA) * 18], face: Math.atan2(Math.cos(QA), Math.sin(QA)) },
  { id: 'mumtaz', name: 'Mert Mumtaz', title: 'Master of the Hippodrome', real: 'Helius', letter: 'M', body: 'soldier', tint: '#c06a2a', at: [STABLES[0] - 8, STABLES[1] - 4], face: 2.6 },
  { id: 'polosukhin', name: 'Illia Polosukhin', title: 'Founder of the Reach', real: 'NEAR', letter: 'I', body: 'peasant-m', tint: '#2f9e75', at: [38, -12], face: Math.PI * 0.95 },
  { id: 'ysolde', name: 'Ysolde of the Rookery', letter: 'Y', body: 'peasant-f', at: [72, -31], face: 0 },
  { id: 'brannoc', name: 'Captain Brannoc', letter: 'B', body: 'soldier', at: [60, 86], face: 0.52 + Math.PI },
];
export const WARDENS = GIVERS.slice(0, 7);
const G = (id: string) => GIVERS.find((g) => g.id === id)!;
export const SEALS = ['Gate', 'Mint', 'Bridge', 'Lighthouse', 'Library', 'Hippodrome', 'Throne'];

// The Greywater road out of the south gate: the markers for learning the reins.
const greywater = () => {
  const c = roadCurve(ROADS.find((r) => r.from === 'capital' && r.to === 0)!);
  return [0.12, 0.2, 0.28, 0.36, 0.44].map((u) => { const p = c.getPointAt(u); return [p.x, p.z] as [number, number]; });
};
const hasSeal = (s: string) => saved.seals.includes(s);
const sealCount = () => saved.seals.length;
/** How many different halls you've won a round in. */
const hallsWon = () => ledger.favour.slice(0, 8).filter((f) => f > 0).length;

export const MISSIONS: Mission[] = [
  {
    id: 'gate', title: 'The Reins', giver: G('gershuni'), seal: 'Gate',
    brief: () => 'Learn the reins: drive the markers down the Greywater road against the clock.',
    intro: () => [
      { who: 'Stepan Gershuni', text: 'Another hopeful at my gate. Good. The realm needs a few.' },
      { who: 'Stepan Gershuni', text: 'Here is how it works. The king is dead. Seven of us are Wardens of Vael, and whoever earns all seven of our seals before the season ends sits the Ashen Throne.' },
      { who: 'Stepan Gershuni', text: 'Mine is the first. A lord who can’t drive can’t hold a realm. Whistle for your chariot with C, climb up with E, and take the Greywater markers in under a minute and a half.' },
    ],
    steps: [
      { text: () => 'Get in your **chariot** (C calls it, E climbs up)', target: () => [me.car.x, me.car.z], check: () => play.driving },
      { text: () => 'Drive through the **markers** on the Greywater road', gates: greywater, limit: () => 90, target: () => greywater()[0] },
    ],
    outro: () => [
      { who: 'Stepan Gershuni', text: 'You drive like someone who means to arrive. The seal of the Gate is yours.' },
      { who: 'Stepan Gershuni', text: 'Press J for your Seal Book. Next, Kain Warwick at the Mint. Nobody sits a throne without coin.' },
    ],
    reward: { near: 3, renown: 1 },
  },
  {
    id: 'mint', title: 'Coin of the Realm', giver: G('warwick'), needs: () => hasSeal('Gate'), seal: 'Mint',
    brief: () => `Buy $${mine().coin} at the Mint, then enter your own hall and play its game once.`,
    intro: () => [
      { who: 'Kain Warwick', text: `House ${mine().name}. A seat is a chair until there's coin under it.` },
      { who: 'Kain Warwick', text: `Every house strikes its own coin here, on NEAR, on a curve: each one costs a little more than the last. Buy some $${mine().coin}.` },
      { who: 'Kain Warwick', text: 'Then go home. Every hall in Vael has a game, and every round played burns that house’s coin. Play yours once. That’s how a coin earns its price here.' },
    ],
    steps: [
      { text: () => `Buy some **$${mine().coin}** at the **Mint counter**`, target: () => { const p = PLACES.find((x) => x.id === 'mint')!; return [p.x, p.z]; }, check: (s) => since(flags.bought, s) && flags.bought!.h === seat().house },
      { text: () => `Ride home and enter **your hall** at ${mine().seat}`, target: () => doorAt(seat().house), check: () => play.inside === seat().house },
      { text: () => `Play **${mine().name}’s game** in your hall (the house stands you the first round)`, target: () => doorAt(seat().house), check: (s) => { const g = flagsGame.last; return !!g && g.t >= s.stepT0 && g.house === seat().house; } },
    ],
    outro: () => [
      { who: 'Your steward', text: 'Word from the Mint, my lord: Master Warwick has sent his seal. He says you understand what a coin is for.' },
      { who: 'Your steward', text: 'The other Wardens will see you now, in any order you like. The Seal Book (J) has them all.' },
    ],
    reward: { near: 2, renown: 1 },
  },
  {
    id: 'bridge', title: 'Don’t Trust, Verify', giver: G('lazzarin'), needs: () => hasSeal('Mint'), seal: 'Bridge',
    brief: () => 'Win the Vintner’s Cups in House Velmont’s cellar at Vinehold.',
    intro: () => [
      { who: 'Eddy Lazzarin', text: 'A bridge you can’t check is a long way down. I don’t take anyone’s word for what’s on the other side.' },
      { who: 'Eddy Lazzarin', text: 'The vintner at Vinehold swears you can’t follow his cups. Prove him wrong. Watch everything; trust nothing.' },
    ],
    steps: [{ text: () => 'Win **the Vintner’s Cups** in House Velmont’s hall at **Vinehold**', target: () => doorAt(2), check: (s) => won('cups', s) }],
    outro: () => [{ who: 'Eddy Lazzarin', text: 'Verified. The seal of the Bridge, and my respect, which is harder to get.' }],
    reward: { near: 4, renown: 1 },
  },
  {
    id: 'lighthouse', title: 'Count Every Ship', giver: G('garg'), needs: () => hasSeal('Mint'), seal: 'Lighthouse',
    brief: () => 'Bring six ships in with the lantern signals in House Ashveil’s hall at Greywater.',
    intro: () => [
      { who: 'Avichal Garg', text: 'I count every ship that comes into Greywater. Every one, every season. The count tells you where the realm is going before the realm knows.' },
      { who: 'Avichal Garg', text: 'Ashveil’s signal hall talks the ships in by lantern. Go and bring me six.' },
    ],
    steps: [{ text: () => 'Bring six ships in at **Lantern Signals**, House Ashveil’s hall in **Greywater**', target: () => doorAt(0), check: (s) => won('signals', s) }],
    outro: () => [{ who: 'Avichal Garg', text: 'Six, logged. That’s a good season for one evening. The seal of the Lighthouse.' }],
    reward: { near: 4, renown: 1 },
  },
  {
    id: 'library', title: 'Read the Table', giver: G('qureshi'), needs: () => hasSeal('Mint'), seal: 'Library',
    brief: () => 'Go into Qureshi’s Library and beat Haseeb at Liar’s Dice (stake 1 NEAR).',
    intro: () => [
      { who: 'Haseeb Qureshi', text: 'Sit down. Every lord in Vael bluffs. Very few do it well, and I’ve watched most of them try.' },
      { who: 'Haseeb Qureshi', text: 'Liar’s Dice. Five each, under the cup. Come inside, sit across from me, and beat me. Then the Library’s seal is yours.' },
    ],
    steps: [{ text: () => (play.inside === LIBRARY ? 'Sit down at the **dice table** under the dome and beat Haseeb Qureshi' : 'Go into **Qureshi’s Library** and beat Haseeb Qureshi at **Liar’s Dice**'), target: () => (play.inside === LIBRARY ? undefined : libDoor().out), check: (s) => won('dice', s) }],
    outro: () => [{ who: 'Haseeb Qureshi', text: 'Well played. I’ll be thinking about that last call for a week. The seal of the Library.' }],
    reward: { near: 4, renown: 1 },
  },
  {
    id: 'hippodrome', title: 'Blood on the Sand', giver: G('mumtaz'), needs: () => hasSeal('Mint'), seal: 'Hippodrome',
    brief: () => 'Drive for your house at the Hippodrome and finish in the top four.',
    intro: () => [
      { who: 'Mert Mumtaz', text: 'Eight houses, eight teams, one line. Fast is the only speed I respect.' },
      { who: 'Mert Mumtaz', text: `Take the reins of House ${mine().name}. Top four and the seal of the Hippodrome is yours. Inside lanes are short. Crowded too.` },
    ],
    steps: [{ text: () => `Drive at the **Hippodrome** (the stables) and finish in the **top four**`, target: () => STABLES,
      check: (s) => since(flags.race, s) && flags.race!.place <= 4,
      fail: (s) => (since(flags.race, s) && flags.race!.place > 4 ? `You finished ${nth(flags.race!.place)}. The crowd wants better.` : undefined) },
      // On NEAR the seal needs what the contract can see: a bet on one of its races. (The practice purse skips this.)
      { text: () => 'Now back a team in a race **on NEAR**, from the stands at the **Hippodrome**', target: () => STABLES,
        check: () => !onChain() || !!chain.me?.raced }],
    outro: () => [{ who: 'Mert Mumtaz', text: `${nth(flags.race?.place ?? 4)}. They were chanting a name up there. The seal of the Hippodrome.` }],
    reward: { near: 5, renown: 2 },
  },
  {
    id: 'throne', title: 'The Ashen Throne', giver: G('polosukhin'), needs: () => ['Gate', 'Mint', 'Bridge', 'Lighthouse', 'Library', 'Hippodrome'].every(hasSeal), seal: 'Throne',
    brief: () => 'Hold six seals, win in three different halls, then win the Crown Race outright.',
    intro: () => [
      { who: 'Illia Polosukhin', text: 'I laid these roads so that anyone could walk them, and here you are with six seals. Pay attention now; it’s all you need.' },
      { who: 'Illia Polosukhin', text: 'A throne is held by the houses, not the Wardens. Win the favour of three halls, then win the Crown Race outright.' },
    ],
    steps: [
      { text: () => `Win a round in **three different halls** (${Math.min(3, hallsWon())} / 3)`, check: () => hallsWon() >= 3 },
      { text: () => 'Win the **Crown Race** at the Hippodrome: first across the line', target: () => STABLES,
        check: (s) => sinceStep(flags.race, s) && flags.race!.place === 1,
        fail: (s) => (sinceStep(flags.race, s) && flags.race!.place > 1 ? `${nth(flags.race!.place)} is not first.` : undefined) },
    ],
    outro: () => [
      { who: 'Illia Polosukhin', text: `Seven seals. By the old law of Vael, the Ashen Throne belongs to House ${mine().name} for this season.` },
      { who: 'The Chronicle', text: `In the year of the empty throne, a lord of House ${mine().name} rode in through the Gershuni Gate with nothing, and left with the crown.` },
    ],
    reward: { near: 25, renown: 5, title: 'Keeper of the Ashen Throne' },
  },
  // ---- Side work: not seals, but coin and renown.
  {
    id: 'raven', title: 'Words on the Wind', giver: G('ysolde'), needs: () => hasSeal('Mint'),
    brief: () => `Send a raven to House ${rival().name} and meet their lord.`,
    intro: () => [
      { who: 'Ysolde', text: 'Ravens are cheaper than armies, my lord. Usually.' },
      { who: 'Ysolde', text: `House ${rival().name} sits closest to the throne. Send them word. If they answer, ride to ${rival().seat} and look their lord in the eye.` },
    ],
    steps: [
      { text: () => `Send a **raven** to House ${rival().name} from the **rookery**`, target: () => [77, -37], check: (s) => since(flags.raven, s) && flags.raven!.to === rival().id },
      { text: () => `Ride to **${rival().seat}** and meet the lord of House ${rival().name}`, target: () => yardOf(rival()), r: 16,
        lines: () => [{ who: 'Ysolde', text: `An answer already. They'll receive you on the green before ${rival().seat}.` }] },
    ],
    outro: () => [
      { who: `Lord of House ${rival().name}`, text: 'Your raven found me. Bold, for a house so young.' },
      { who: `Lord of House ${rival().name}`, text: 'We are watching your coin. If it rises, we will be friends. If it falls, we will be heirs.' },
    ],
    reward: { near: 3, renown: 1 },
  },
  {
    id: 'march', title: 'Iron', giver: G('brannoc'), needs: () => saved.done.includes('raven'),
    brief: () => `Muster a march on House ${enemy().name} and scout their walls.`,
    intro: () => [
      { who: 'Captain Brannoc', text: `Words did not work on House ${enemy().name}. Then iron will.` },
      { who: 'Captain Brannoc', text: 'Muster at the Gershuni Gate, then ride ahead. I want eyes on their walls before our banners reach them.' },
    ],
    steps: [
      { text: () => `Muster a **march** on House ${enemy().name} at the **Gershuni Gate**`, target: () => LANDMARKS[6].pos, check: (s) => since(flags.march, s) && flags.march!.to === enemy().id },
      { text: () => `Ride ahead to the gates of **${enemy().seat}**`, target: () => doorAt(enemy().id), r: 30 },
    ],
    outro: () => [{ who: 'Captain Brannoc', text: 'Their walls are thin on the river side. Our column will be there by dusk. Well ridden, my lord.' }],
    reward: { near: 4, renown: 2 },
  },
];

/** The opening, the first time you take a seat. */
export const PROLOGUE: Line[] = [
  { who: 'The Chronicle', text: 'The old king of Vael is dead, and the Ashen Throne stands empty.' },
  { who: 'The Chronicle', text: 'By the old law, the crown goes to whoever earns the seals of the Seven Wardens before the season ends.' },
  { who: 'The Chronicle', text: 'Eight houses want it. Each strikes its own coin on NEAR, and every coin a house burns is a vote for it.' },
  { who: 'The Chronicle', text: 'You are new here: a name, a seat, a borrowed chariot. The Warden of the Gate is waiting. Follow the yellow light.' },
];

/** The two scribes in the Library, Claude and Codex, who keep the Seal Book and will tell you what to do next. */
export function scribes(): Line[] {
  const plain = (t: string) => t.replace(/\*\*/g, '');
  const n = sealCount(), h = nextHint();
  const tips = [
    'Every round in a hall burns that house’s coin. Your own house’s coin goes up when people play in your hall.',
    'The lit doors on the keeps are open to anyone. Every hall has its own game, and every round you play there burns that house’s coin: the burn is your favour with it.',
    'The radar’s yellow letters are the Wardens. The bright beam over the land is where you should be going.',
    'At the Hippodrome the inside lane is shortest. Crack the whip on the straights, not in the turns.',
  ];
  return [
    { who: 'Claude, a scribe', text: n ? `You hold ${n} of the seven seals. ${plain(h.text)}.` : `No seals yet. ${plain(h.text)}.` },
    { who: 'Codex, a scribe', text: tips[(n + Math.floor(Date.now() / 60000)) % tips.length] },
    { who: 'Claude, a scribe', text: 'Press J whenever you like. The Seal Book has every trial and every hall in it.' },
  ];
}

/** What to do next, in a sentence: for the objective line when no trial is running, and for the Scribes. */
export function nextHint(): { text: string; target?: [number, number] } {
  const open = available();
  if (!open.length) return hasSeal('Throne') ? { text: 'The throne is yours this season. Play the halls, race, and hold it.' } : { text: 'Win rounds in the halls to win their favour.' };
  // The nearest Warden with a trial for you (Wardens first, then side work).
  const pickFrom = open.filter((m) => m.seal).length ? open.filter((m) => m.seal) : open;
  const m = pickFrom.sort((a, b) => Math.hypot(a.giver.at[0] - me.x, a.giver.at[1] - me.z) - Math.hypot(b.giver.at[0] - me.x, b.giver.at[1] - me.z))[0];
  return { text: `Meet **${m.giver.name}**${m.giver.title ? `, ${m.giver.title},` : ''} for ${m.seal ? `the seal of the **${m.seal}**` : `**${m.title}**`}`, target: m.giver.at };
}

// ---- The story's state, saved in this browser ----
const KEY = 'crownfall.story';
interface Saved { done: string[]; renown: number; titles: string[]; seals: string[]; prologue?: boolean }
const saved: Saved = (() => { try { return { done: [], renown: 0, titles: [], seals: [], ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { done: [], renown: 0, titles: [], seals: [] }; } })();
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* private window */ } };

export const story = {
  saved,
  run: undefined as Run | undefined,
  /** Lines being spoken now (the letterbox is down while they are). */
  talk: undefined as { lines: Line[]; i: number; t: number; then?: () => void } | undefined,
  /** The big card: MISSION PASSED / MISSION FAILED. */
  card: undefined as { kind: 'passed' | 'failed'; title: string; sub: string; t: number } | undefined,
};
if (import.meta.env.DEV) Object.assign(window, { __story: story });

export const missionOf = (id: string) => MISSIONS.find((m) => m.id === id)!;
/** Missions you can start now, by giver. */
export function available() {
  return MISSIONS.filter((m) => !saved.done.includes(m.id) && (!m.needs || m.needs()));
}
export function current() { return story.run ? { mission: missionOf(story.run.id), step: missionOf(story.run.id).steps[story.run.step] } : undefined; }

export function say(lines: Line[], then?: () => void) {
  // A hall game owns the screen and the keys: what's said waits until you leave the table, or the key you press to
  // read it would go to the game's card instead (and start a paid round).
  if (play.game) { const id = setInterval(() => { if (!play.game) { clearInterval(id); say(lines, then); } }, 250); return; }
  story.talk = { lines, i: 0, t: performance.now(), then };
  play.panel = undefined; // a cutscene takes the screen: close the counter or table you were at
  document.exitPointerLock?.();
  emitPlay();
}
/** Skip to the end of what's being said (its last step still runs). */
export function skipTalk() {
  const t = story.talk;
  if (!t) return;
  t.i = t.lines.length - 1;
  nextLine();
}
/** Next line (E, Space or a click); the last one closes the talk. */
export function nextLine() {
  const t = story.talk;
  if (!t) return;
  if (t.i < t.lines.length - 1) { t.i++; t.t = performance.now(); emitPlay(); return; }
  story.talk = undefined;
  // Lines also move on by themselves, so a press meant for the last one can come just after it closed.
  hush(900);
  emitPlay();
  t.then?.();
}

export function start(m: Mission) {
  if (story.run || story.talk) return;
  say(m.intro(), () => {
    const now = Date.now();
    story.run = { id: m.id, step: 0, t0: now, stepT0: now, gate: 0 };
    beginStep();
  });
}
function beginStep() {
  const s = current()?.step;
  if (!s) return;
  story.run!.stepT0 = Date.now(); story.run!.gate = 0; story.run!.limit = s.limit?.(story.run!);
  const l = s.lines?.();
  if (l) say(l);
  emitPlay();
}
function advanceStep() {
  const r = story.run!;
  const m = missionOf(r.id);
  if (r.step + 1 < m.steps.length) { r.step++; beginStep(); return; }
  story.run = undefined;
  say(m.outro(), () => pass(m));
}
function pass(m: Mission) {
  saved.done.push(m.id);
  if (m.seal && !saved.seals.includes(m.seal)) saved.seals.push(m.seal);
  saved.renown += m.reward.renown;
  if (m.reward.title) saved.titles.push(m.reward.title);
  persist();
  // On NEAR the seal is taken on chain (the contract checks what it can see). The mission's NEAR is a practice reward.
  const live = onChain();
  if (live && m.seal) void takeSeal(SEALS.indexOf(m.seal));
  else pay(m.reward.near, `Mission passed: ${m.title}`);
  story.card = { kind: 'passed', title: m.seal ? `Seal of the ${m.seal}` : 'Mission passed', sub: `${m.title}${live ? (m.seal ? ' · sealed on NEAR' : '') : ` · +${m.reward.near} NEAR`} · renown +${m.reward.renown}${m.reward.title ? ` · ${m.reward.title}` : ''}`, t: performance.now() };
  emitPlay();
}
export function fail(reason: string) {
  const m = current()?.mission;
  story.run = undefined;
  story.card = { kind: 'failed', title: 'Mission failed', sub: reason, t: performance.now() };
  if (m) note(`Mission failed: ${m.title}. ${reason}`);
  emitPlay();
}
/** Give up the mission in progress (from the HUD). */
export function abandon() { if (story.run) fail('You walked away from it.'); }

/** Seconds left on the step's clock, if it has one. */
export function timeLeft() {
  const c = current();
  if (!c || story.run?.limit === undefined) return undefined;
  return story.run.limit - (Date.now() - story.run.stepT0) / 1000;
}

/** Where the radar points: the step's target, the next gate, or (with no mission) the nearest giver with work. */
export function target(): [number, number] | undefined {
  const c = current();
  if (!c || !story.run) return play.inside < 0 ? nextHint().target : undefined;
  if (c.step.gates) return c.step.gates()[story.run.gate];
  return c.step.target?.();
}

/** Called every frame by the scene. */
export function tickStory() {
  if (play.mode !== 'play' || !play.seat || story.talk) return;
  if (!saved.prologue) { saved.prologue = true; persist(); say(PROLOGUE); return; }
  const c = current();
  if (!c) {
    // Walk into a giver's marker to start their next mission.
    if (play.racing || play.panel) return;
    for (const m of available()) {
      const [gx, gz] = m.giver.at;
      if (Math.hypot(me.x - gx, me.z - gz) < 2.6 && !play.driving) { start(m); return; }
    }
    return;
  }
  const r = story.run!, s = c.step;
  const why = s.fail?.(r);
  if (why) { fail(why); return; }
  const left = timeLeft();
  if (left !== undefined && left <= 0) { fail('Out of time.'); return; }
  if (s.gates) {
    const g = s.gates();
    const [x, z] = g[r.gate];
    if (Math.hypot(me.x - x, me.z - z) < 11) { r.gate++; emitPlay(); if (r.gate >= g.length) advanceStep(); }
    return;
  }
  if (s.check?.(r)) { advanceStep(); return; }
  if (s.r !== undefined && s.target) { const t = s.target(); if (t && Math.hypot(me.x - t[0], me.z - t[1]) < s.r) advanceStep(); }
}

export const HIPPO = HIPPODROME.pos;
if (import.meta.env.DEV) Object.assign(window, { __missions: { saved, MISSIONS, available, start, nextHint } });
