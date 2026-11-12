// Every voiced line in Crownfall, and who speaks it. Story lines are read from web/src/realm/missions.ts (only the
// static ones: a line with ${…} in it changes per player, so it keeps the murmur voice). Event lines (the race caller,
// the Mint clerk) are keyed by id. The game finds a story line's audio by the exact text, so editing a line's text
// in missions.ts drops it back to the murmur until it is voiced again.
//   node design/audio/lines.mjs            -> prints the list (and what's already voiced)
// Voices: Higgsfield text2speech_v2, variant minimax, preset voices (never the user's own clone).
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const CAST = {
  'The Chronicle': 'd9d5c263-f84e-4752-97b5-3750fcc6fd2f', // Alistair
  'Stepan Gershuni': 'd603a8cd-3fe1-55e0-9245-617a2589131e', // Barrett
  'Kain Warwick': 'dc382508-c8bd-443c-8cb2-46e57b8d2e6f', // Sterling
  'Your steward': 'bd072316-f77c-588b-b6e5-e46b9b03d008', // Archie
  'Eddy Lazzarin': '95429266-c0ac-4137-a209-63b8812b0f23', // Julian
  'Avichal Garg': 'ef70cc83-3015-4bad-9359-0ea968c43ec0', // Caspian
  'Haseeb Qureshi': '1ad38ba4-9cc4-4f2f-9fde-b0fefdf67ae5', // Gideon
  'Mert Mumtaz': '6f98d3dd-324f-4845-8c28-c1d1647a06cd', // Marcus
  'Illia Polosukhin': 'ed69c516-92d2-4b30-a967-617737a342e5', // Orion
  Ysolde: '3811e986-0891-47cf-a1f5-78a1d62a547a', // Imogen
  'Captain Brannoc': '195e386a-cb61-5c1b-a53b-0e2f0669c408', // Knox
  'Claude, a scribe': 'd081b915-6623-4a44-bacf-80d0f1c90a03', // Nora
  'Codex, a scribe': 'f1e8226e-2248-4d5f-b43c-0a79e9949dbf', // Andre
  'The race caller': '573e5163-59b3-4926-aab1-951ef2985f81', // Harrison
  'The Mint clerk': 'fa64fba4-ad02-405e-99d0-1f085d87c706', // Mabel
};

const HOUSES = ['Ashveil', 'Corrin', 'Velmont', 'Thorne', 'Halloway', 'Draven', 'Marrow', 'Sorrel'];
export const EVENTS = [
  ['race.line', 'The race caller', 'Riders, to the line! Eight houses, one cup.'],
  ['race.off', 'The race caller', 'And they’re off!'],
  ['race.whips', 'The race caller', 'Whips out! Here comes the rush!'],
  ['race.last', 'The race caller', 'Last lap! Hold nothing back!'],
  ['race.close', 'The race caller', 'At the line, and it’s close!'],
  ...HOUSES.map((h, i) => [`race.win.${i}`, 'The race caller', `House ${h} takes the cup!`]),
  ['mint.calm', 'The Mint clerk', 'Fair prices today, my lord. Nobody’s rushing anything.'],
  ['mint.dear', 'The Mint clerk', 'Everyone’s buying today. Coin’s dear, my lord. Mind what you pay.'],
  ['mint.cheap', 'The Mint clerk', 'They’ve been selling all morning. Some coin’s going cheap.'],
  ['mint.shut', 'The Mint clerk', 'A house has shut its doors, my lord. A run, they say. Buy in and you reopen it.'],
];

export const key = (text) => createHash('sha1').update(text).digest('hex').slice(0, 12);

export function storyLines() {
  const src = readFileSync(new URL('../../web/src/realm/missions.ts', import.meta.url), 'utf8');
  const out = [];
  const re = /\{ who: '([^']+)', text: '((?:[^'\\]|\\.)*)' \}/g;
  for (const m of src.matchAll(re)) if (CAST[m[1]]) out.push([key(m[2]), m[1], m[2].replace(/\\'/g, "'")]);
  // The Codex scribe's tips are plain strings in a list.
  const tips = src.match(/const tips = \[([\s\S]*?)\];/);
  if (tips) for (const m of tips[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)) out.push([key(m[1]), 'Codex, a scribe', m[1]]);
  const seen = new Set();
  return out.filter(([k]) => !seen.has(k) && seen.add(k));
}

export const all = () => [...storyLines(), ...EVENTS];

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = new URL('../../web/public/audio/vo/', import.meta.url);
  const rows = all();
  for (const [id, who, text] of rows) console.log(existsSync(new URL(`${id}.mp3`, dir)) ? '✓' : '·', id.padEnd(14), who.padEnd(18), text.slice(0, 70));
  console.log(rows.length, 'lines');
  // What the game reads: story text -> file id, and the event ids, for every line that has audio.
  const voiced = rows.filter(([id]) => existsSync(new URL(`${id}.mp3`, dir)));
  const index = { text: Object.fromEntries(voiced.filter(([id]) => !id.includes('.')).map(([id, , text]) => [text, id])), events: voiced.filter(([id]) => id.includes('.')).map(([id]) => id) };
  writeFileSync(new URL('../../web/src/realm/vo-index.json', import.meta.url), JSON.stringify(index, null, 1) + '\n');
  console.log('wrote web/src/realm/vo-index.json:', voiced.length, 'voiced');
}
