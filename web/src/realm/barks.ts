// What the people of Vael say to you in passing. A rule table in the manner of Valve's dynamic dialogue
// (Ruskin, GDC 2012): every rule names an event, optionally who says it and a condition, and the most specific
// rule that matches wins. Lines said recently are skipped, and idle chatter keeps a 9 to 15 second gap so the
// world comments on you without nattering. Reactions (a shove, a chariot bearing down) jump the queue.
import { HOUSES } from './layout.ts';
import { me, play } from './play.ts';
import { story } from './missions.ts';
import { voice } from './sound.ts';
import { chain, units } from '../chain/near.ts';
import { crowd } from './collide.ts';

export type BarkEvent = 'greet' | 'bumped' | 'dodged' | 'stare';
export type Speaker = 'man' | 'woman' | 'soldier' | 'lord';
interface Ctx {
  ev: BarkEvent; who: Speaker; driving: boolean; running: boolean; renown: number; home: boolean; house: string; theirs?: string;
  /** What the town knows from the chain right now: a shut house, a dear or cheap coin, the house leading the season,
   *  the house that took the last cup. Undefined when there's nothing to say about it. */
  shut?: string; dear?: string; cheap?: string; leader?: string; leading: boolean; lastWin?: string;
}
interface Rule { ev: BarkEvent; who?: Speaker; when?: (c: Ctx) => boolean; lines: (string | ((c: Ctx) => string))[] }

const RULES: Rule[] = [
  { ev: 'greet', lines: ['Fair roads to you.', 'Good day, my lord.', 'Mind the ruts past the bridge.', 'Lovely weather for losing money at the races.'] },
  { ev: 'greet', who: 'man', lines: ['Bread’s gone up again at the Mint, they say.', 'You’re a long way from your hall.', 'Fair roads, m’lord. Mostly fair. Some ruts.', 'If you’re after work, the folk with yellow on them have plenty.'] },
  { ev: 'greet', who: 'woman', lines: ['Don’t let the ravens near your purse.', 'My brother bet his boots at the Hippodrome. Walks barefoot now.', 'Good day. Lovely horses you keep, I hear.', 'Off to the Mint? Buy low, they tell me. Nobody tells me when low is.'] },
  { ev: 'greet', who: 'soldier', lines: ['Keep moving.', 'Eyes front, citizen. Ah. My lord.', 'Quiet on the road today. I don’t trust it.', 'Stay off the march routes when the drums go.'] },
  { ev: 'greet', who: 'lord', lines: [(c) => `House ${c.house}. You look poorer than I remember.`, (c) => `Come to admire ${c.theirs}? Everyone does.`, 'Mind my lawn.', 'We should race some time. You’d lose, but we should.'] },
  { ev: 'greet', when: (c) => c.home, lines: [(c) => `Welcome home, m’lord. ${c.house} hasn’t burned down while you were out.`, (c) => `${c.house}’s own! Back from the capital?`, 'The steward’s been asking after you.'] },
  { ev: 'greet', when: (c) => c.renown >= 4, lines: ['That’s the one from the Stakes!', 'Make way, a lord of some renown.', 'My cousin won three coin on you. Thank you, my lord.'] },
  { ev: 'greet', who: 'lord', when: (c) => c.renown >= 4, lines: ['So the whole realm knows your name now. Enjoy it while it lasts.', 'Renown is a loan, friend. The Throne collects.'] },
  // The realm as it stands on NEAR: people talk about what is actually happening.
  { ev: 'greet', when: (c) => !!c.shut, lines: [(c) => `Did you hear? House ${c.shut} shut its doors. A run on the coin.`, (c) => `They say ${c.shut}’s purse is near empty. Somebody ought to buy in.`, (c) => `${c.shut}’s hall is dark tonight. Shame. Good bread there.`] },
  { ev: 'greet', who: 'lord', when: (c) => !!c.shut, lines: [(c) => `${c.shut} shut? Good. One fewer at the table.`, (c) => `Buy into ${c.shut} now and you own the reopening. Not that I’m telling you.`] },
  { ev: 'greet', when: (c) => !!c.dear, lines: [(c) => `Everyone’s buying ${c.dear} coin this morning. Dear as gold.`, (c) => `${c.dear} coin’s up again. My sister swears she sold too early.`] },
  { ev: 'greet', when: (c) => !!c.cheap, lines: [(c) => `${c.cheap} coin’s going for a song at the Mint.`, (c) => `Folk have been dumping ${c.cheap} all day. Cheap, if you’ve the nerve.`] },
  { ev: 'greet', when: (c) => !!c.leader && !c.leading, lines: [(c) => `${c.leader} leads the season. The Throne’s theirs if nobody stirs.`, (c) => `Most favour’s with ${c.leader} this season, they say.`] },
  { ev: 'greet', when: (c) => c.leading, lines: [(c) => `${c.house} leads the season! Keep it up, my lord.`, 'The Throne’s yours to lose, they say.'] },
  { ev: 'greet', who: 'lord', when: (c) => c.leading, lines: ['Leading the season, are we? Seasons end.', (c) => `Enjoy the top while it lasts, ${c.house}.`] },
  { ev: 'greet', when: (c) => !!c.lastWin, lines: [(c) => `${c.lastWin} took the last cup. Never saw it coming.`, (c) => `Lost a week’s wage on the race. Should’ve backed ${c.lastWin}.`] },
  { ev: 'bumped', lines: ['Oi! Watch it!', 'Steady on!', 'The road’s wide enough for two, my lord.', 'Mind where you’re going.'] },
  { ev: 'bumped', who: 'soldier', lines: ['Hands off the uniform.', 'Do that again and we’ll talk at the gate.'] },
  { ev: 'bumped', who: 'lord', lines: ['Do you know whose boots those were?', 'Barbarian.'] },
  { ev: 'bumped', when: (c) => c.running, lines: ['Where’s the fire?', 'Slow down, you’ll do yourself a mischief!'] },
  { ev: 'dodged', lines: ['Rein in, you madman!', 'Gods’ teeth, the horses!', 'Are you trying to kill us?', 'Save it for the Hippodrome!', 'This is a road, not a racetrack!'] },
  { ev: 'dodged', who: 'soldier', lines: ['Halt! ...Ah. Carry on, my lord.', 'I’ll be writing that down!'] },
  { ev: 'dodged', who: 'lord', lines: ['My solicitor will hear of this.', 'You call that driving?'] },
  { ev: 'stare', lines: ['Can I help you?', 'You’re staring, my lord.', 'Something on my face?'] },
];

const NAMES: Record<Speaker, string[]> = {
  man: ['A farmer', 'A carter', 'A miller', 'A traveller'],
  woman: ['A goodwife', 'A traveller', 'A weaver', 'A pilgrim'],
  soldier: ['A soldier', 'A guard'],
  lord: [],
};

export const bark = { text: '', who: '', at: -1e9 };
/** What the town remembers: the house that took the last cup (the race caller sets it). */
export const town = { lastWin: -1, lastWinAt: 0 };

/** The town's read of the chain right now. */
function news(seatHouse: number | undefined) {
  const hs = chain.realm?.houses;
  if (!hs?.length) return { leading: false };
  const shut = hs.find((h) => h.market?.shut);
  const dear = [...hs].sort((a, b) => (b.market?.factor ?? 0) - (a.market?.factor ?? 0))[0];
  const cheap = [...hs].sort((a, b) => (a.market?.factor ?? 2e4) - (b.market?.factor ?? 2e4))[0];
  const lead = [...hs].sort((a, b) => units(b.favour) - units(a.favour))[0];
  const fresh = town.lastWin >= 0 && performance.now() / 1000 - town.lastWinAt < 15 * 60;
  return {
    shut: shut ? HOUSES[shut.id].name : undefined,
    dear: (dear?.market?.factor ?? 0) >= 11_500 && !dear.market?.shut ? HOUSES[dear.id].name : undefined,
    cheap: (cheap?.market?.factor ?? 2e4) <= 9_000 && !cheap.market?.shut ? HOUSES[cheap.id].name : undefined,
    leader: units(lead.favour) > 0 ? HOUSES[lead.id].name : undefined,
    leading: units(lead.favour) > 0 && lead.id === seatHouse,
    lastWin: fresh ? HOUSES[town.lastWin].name : undefined,
  };
}

/** Left/right of a point as you see it (-1..1), for panning a voice. */
export function panOf(x: number, z: number) {
  const dx = x - me.x, dz = z - me.z, d = Math.hypot(dx, dz) || 1;
  return (dx * Math.cos(me.camYaw) - dz * Math.sin(me.camYaw)) / d;
}
/** A person (anything in the crowd) reacts out loud, using the kind and name their figure carries. */
export function speakAs(ev: BarkEvent, p: { position: { x: number; z: number }; userData: { kind?: string; name?: string; theirs?: string } }) {
  const who = (p.userData.kind ?? 'man') as Speaker;
  speak(ev, who, { name: p.userData.name, theirs: p.userData.theirs, pan: panOf(p.position.x, p.position.z) });
}
const recent: string[] = [];
let nextIdle = 0;

/** Something happened to someone near you: maybe they say something. `pan` is -1 (left) to 1 (right). */
export function speak(ev: BarkEvent, who: Speaker, opts: { name?: string; theirs?: string; pan?: number } = {}) {
  const now = performance.now() / 1000;
  const reaction = ev === 'bumped' || ev === 'dodged';
  if (reaction ? now - bark.at < 2.5 : now < nextIdle) return;
  const seat = play.seat ? HOUSES[play.seat.house] : undefined;
  const home = !!seat && Math.hypot(me.x - seat.pos[0], me.z - seat.pos[1]) < 120;
  const c: Ctx = { ev, who, driving: play.driving, running: me.speed > 9, renown: story.saved.renown, home, house: seat?.name ?? 'Velmont', theirs: opts.theirs, ...news(play.seat?.house) };
  let best: Rule[] = [], top = -1;
  for (const r of RULES) {
    if (r.ev !== ev || (r.who && r.who !== who) || (r.when && !r.when(c))) continue;
    const s = (r.who ? 1 : 0) + (r.when ? 2 : 0);
    // News isn't on everyone's lips: half the time a newsy rule stands back for the ordinary ones.
    if (r.when && ev === 'greet' && Math.random() < 0.5 && !r.when({ ...c, shut: undefined, dear: undefined, cheap: undefined, leader: undefined, leading: false, lastWin: undefined })) continue;
    if (s > top) { top = s; best = [r]; } else if (s === top) best.push(r);
  }
  const lines = best.flatMap((r) => r.lines.map((l) => (typeof l === 'function' ? l(c) : l))).filter((l) => !recent.includes(l));
  if (!lines.length) return;
  const line = lines[Math.floor(Math.random() * lines.length)];
  recent.push(line); if (recent.length > 10) recent.shift();
  const names = NAMES[who];
  bark.text = line; bark.who = opts.name ?? names[Math.floor(Math.random() * names.length)] ?? 'Someone'; bark.at = now;
  nextIdle = now + 9 + Math.random() * 6;
  voice(who, line.length, opts.pan ?? 0, reaction);
}

// ---------- Overheard ----------
// Two townsfolk standing together talk to each other, not to you: a short exchange you catch walking past. Lines
// follow the realm (the market, the season, the races) as well as plain gossip. One every 40 to 80 seconds at most.
type Chat = [string, string][];
const CHATS: ((n: ReturnType<typeof news>) => Chat | undefined)[] = [
  () => [['Bought any coin this week?', 'With what? The Mint took my last silver.']],
  () => [['Going to the Stakes?', 'Every race. I never win. I like the noise.']],
  () => [['The ravens were out at dawn.', 'Means a lord’s writing to the Throne. Mark me.']],
  () => [['My cousin swears the Library dice are loaded.', 'The chain replays every throw. He’s just bad at dice.']],
  () => [['Who’s that walking?', 'A lord, by the boots. Look busy.']],
  () => [['The bridge toll went up.', 'It did not. You just got poorer.']],
  (n) => n.shut ? [[`${n.shut} shut its doors, did you hear?`, 'A run, they said. Everyone sold at once.'], ['Will it open again?', 'If somebody buys in. Not me.']] : undefined,
  (n) => n.dear ? [[`Everyone’s after ${n.dear} coin.`, 'Then I’m selling mine. Buy low, sell to the crowd.']] : undefined,
  (n) => n.cheap ? [[`${n.cheap} coin’s cheap today.`, 'Cheap for a reason, I expect.']] : undefined,
  (n) => n.leader ? [['Who’s for the Throne this season?', `${n.leader}, unless someone gets busy.`]] : undefined,
  (n) => n.lastWin ? [['Did you see the last race?', `${n.lastWin} by a nose. I had my boots on it.`], ['Your boots?', 'Well. Had.']] : undefined,
];
let nextChat = 0;
const FOLK = ['man', 'woman', 'soldier'];
const heard: string[] = [];

function overhear() {
  const now = performance.now() / 1000;
  if (now < nextChat || play.mode !== 'play' || play.panel || play.game || play.racing || play.paused || play.inside >= 0 || story.talk || now - bark.at < 6) return;
  // Two people near each other and within earshot of you, walking or standing: not talking to you.
  const near = [...crowd].filter((p) => FOLK.includes(p.userData.kind ?? '')).filter((p) => { const d = Math.hypot(p.position.x - me.x, p.position.z - me.z); return d > 3 && d < 24; });
  let pair: [typeof near[0], typeof near[0]] | undefined;
  for (let i = 0; i < near.length && !pair; i++) for (let j = i + 1; j < near.length; j++) {
    if (Math.hypot(near[i].position.x - near[j].position.x, near[i].position.z - near[j].position.z) < 14) { pair = [near[i], near[j]]; break; }
  }
  if (!pair) { nextChat = now + 3; return; }
  const n = news(play.seat?.house);
  const pool = CHATS.map((f) => f(n)).filter((c): c is Chat => !!c && !heard.includes(c[0][0]));
  if (!pool.length) { heard.length = 0; nextChat = now + 5; return; }
  // A chat about the realm when there is news, half the time.
  const newsy = pool.filter((c) => CHATS.slice(6).some((f) => f(n)?.[0][0] === c[0][0]));
  const chat = newsy.length && Math.random() < 0.5 ? newsy[Math.floor(Math.random() * newsy.length)] : pool[Math.floor(Math.random() * pool.length)];
  heard.push(chat[0][0]); if (heard.length > 6) heard.shift();
  nextChat = now + 40 + Math.random() * 40;
  nextIdle = Math.max(nextIdle, now + 4 + chat.length * 6.4);
  const [a, b] = pair;
  const lines = chat.flatMap(([x, y]) => [[a, x], [b, y]] as const);
  lines.forEach(([p, text], k) => setTimeout(() => {
    if (play.panel || play.game || story.talk) return;
    const who = (p.userData.kind ?? 'man') as Speaker;
    const names = NAMES[who];
    bark.text = text; bark.who = `${p.userData.name ?? names[Math.floor(Math.random() * names.length)] ?? 'Someone'} (overheard)`; bark.at = performance.now() / 1000;
    voice(who, text.length * 0.8, panOf(p.position.x, p.position.z), false);
  }, k * 3200));
}
if (typeof window !== 'undefined') setInterval(overhear, 1000);
