// What the people of Vael say to you in passing. A rule table in the manner of Valve's dynamic dialogue
// (Ruskin, GDC 2012): every rule names an event, optionally who says it and a condition, and the most specific
// rule that matches wins. Lines said recently are skipped, and idle chatter keeps a 9 to 15 second gap so the
// world comments on you without nattering. Reactions (a shove, a chariot bearing down) jump the queue.
import { HOUSES } from './layout.ts';
import { me, play } from './play.ts';
import { story } from './missions.ts';
import { voice } from './sound.ts';

export type BarkEvent = 'greet' | 'bumped' | 'dodged' | 'stare';
export type Speaker = 'man' | 'woman' | 'soldier' | 'lord';
interface Ctx { ev: BarkEvent; who: Speaker; driving: boolean; running: boolean; renown: number; home: boolean; house: string; theirs?: string }
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
  const c: Ctx = { ev, who, driving: play.driving, running: me.speed > 9, renown: story.saved.renown, home, house: seat?.name ?? 'Velmont', theirs: opts.theirs };
  let best: Rule[] = [], top = -1;
  for (const r of RULES) {
    if (r.ev !== ev || (r.who && r.who !== who) || (r.when && !r.when(c))) continue;
    const s = (r.who ? 1 : 0) + (r.when ? 2 : 0);
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
