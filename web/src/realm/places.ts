// Places in the realm where E does something: the Mint counter, your war table, the council, the rookery,
// the library, the gate where marches form, the Hippodrome stables, and every lord on their village green.
import { HIPPODROME, HOUSES, LANDMARKS, yardOf } from './layout.ts';
import { ARENA } from './race.ts';
import { play, type Prompt, type Seat } from './play.ts';
import { LIBRARY, LIB_ROOM, ROOMS, doorOf, inRoom, libDoor } from './rooms.ts';

export interface Place extends Prompt { x: number; z: number; r: number }

const MINT_RY = 0.2; // matches Buildings.tsx
const [mx, mz] = LANDMARKS[4].pos;
const [gx, gz] = LANDMARKS[6].pos;

/** A point in the Hippodrome's own frame, in world coordinates. */
function arena(ax: number, az: number): [number, number] {
  const c = Math.cos(HIPPODROME.rot), s = Math.sin(HIPPODROME.rot);
  return [HIPPODROME.pos[0] + ax * c + az * s, HIPPODROME.pos[1] - ax * s + az * c];
}
export const STABLES = arena(0, -(ARENA.R + 24));

export const PLACES: Place[] = [
  { id: 'mint', verb: 'Trade', what: 'at the Warwick Mint counter', panel: 'mint', x: mx + Math.sin(MINT_RY) * 20, z: mz + Math.cos(MINT_RY) * 20, r: 8 },
  { id: 'door-lib', verb: 'Enter', what: "Qureshi's Library", panel: 'enter', house: LIBRARY, x: libDoor().out[0], z: libDoor().out[1], r: 5 },
  { id: 'council', verb: 'Enter', what: 'the hall of the Ashen Throne', panel: 'council', x: 35, z: -23, r: 11 },
  { id: 'rookery', verb: 'Send', what: 'a raven from the rookery', panel: 'raven', x: 77, z: -37, r: 8 },
  { id: 'gate', verb: 'Muster', what: 'a march at the Gershuni Gate', panel: 'march', x: gx, z: gz, r: 12 },
  { id: 'stables', verb: 'Race', what: 'drive a chariot, or bet from the stands', panel: 'race', x: STABLES[0], z: STABLES[1], r: 14 },
  ...HOUSES.flatMap((h): Place[] => {
    const [hx, hz] = h.pos, d = Math.hypot(hx, hz) || 1;
    const [yx, yz] = yardOf(h);
    const door = doorOf(h);
    return [
      { id: `door-${h.id}`, verb: 'Enter', what: `the hall of House ${h.name}`, panel: 'enter', house: h.id, x: door.x + Math.sin(door.face) * 3, z: door.z + Math.cos(door.face) * 3, r: 7 },
      { id: `lord-${h.id}`, verb: 'Talk', what: `to the lord of House ${h.name}`, panel: 'lord', house: h.id, x: yx, z: yz, r: 13 },
    ];
  }),
];

/** Inside each hall: the way out, the lord on the dais, the house's game, and (in your own hall) the war table. */
export const ROOM_PLACES: Place[] = ROOMS.flatMap((r): Place[] => {
  const h = HOUSES[r.house];
  const at = (lx: number, lz: number) => { const [x, z] = inRoom(r, lx, lz); return { x, z }; };
  return [
    { id: `leave-${r.house}`, verb: 'Leave', what: `the hall of House ${h.name}`, panel: 'leave', house: r.house, ...at(0, r.d / 2 - 1.5), r: 4 },
    { id: `hall-lord-${r.house}`, verb: 'Talk', what: `to the lord of House ${h.name}`, panel: 'lord', house: r.house, ...at(0, -r.d / 2 + 11.5), r: 4.5 },
    { id: `game-${r.house}`, verb: 'Play', what: `${r.gameName}`, panel: 'game', house: r.house, ...at(r.station[0], r.station[1] + 3.5), r: 4 },
    { id: `keep-${r.house}`, verb: 'Sit', what: `at the war table of House ${h.name}`, panel: 'war', house: r.house, ...at(-r.w / 2 + 7, -r.d / 2 + 14), r: 4 },
  ];
});
// Inside the Library: the door, the dice table, the chronicle on its lectern, and the two scribes at their desks.
{
  const r = LIB_ROOM, at = (lx: number, lz: number) => { const [x, z] = inRoom(r, lx, lz); return { x, z }; };
  ROOM_PLACES.push(
    { id: 'leave-lib', verb: 'Leave', what: "Qureshi's Library", panel: 'leave', house: LIBRARY, ...at(0, r.d / 2 - 0.5), r: 2.6 },
    { id: 'game-lib', verb: 'Sit down', what: 'to Liar’s Dice with Haseeb Qureshi', panel: 'game', house: LIBRARY, ...at(0, 3.6), r: 2.6 },
    { id: 'chronicle', verb: 'Read', what: 'the chronicle, the Book of Ages', panel: 'library', ...at(-8.5, -8.5), r: 3.2 },
    { id: 'scribes', verb: 'Ask', what: 'the scribes Claude and Codex what to do next', panel: 'scribes', ...at(9, -7.5), r: 3.6 },
  );
}

/** The nearest thing you can do from (x, z), if any. Your own keep's war table is yours; a rival's is a gate you knock on. */
export function findPlace(x: number, z: number, seat: Seat): Prompt | undefined {
  let best: Place | undefined, bd = Infinity;
  for (const p of play.inside >= 0 ? ROOM_PLACES : PLACES) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < p.r && d < bd) { bd = d; best = p; }
  }
  if (!best) return undefined;
  if (best.panel === 'war' && best.house !== seat.house) return { ...best, verb: 'Look', what: `at House ${HOUSES[best.house!].name}'s war table (not yours to use)`, panel: 'gate-of' };
  if (best.panel === 'lord' && best.house === seat.house) return { ...best, verb: 'Talk', what: 'to your steward' };
  return best;
}
