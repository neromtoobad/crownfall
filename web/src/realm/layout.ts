// The realm of Vael: where everything stands. x runs east, z runs south, y is up. One unit is about a metre,
// but the map is squeezed the way strategy games do it: castles are big, the distances between them are short.
import * as THREE from 'three';

export const SIZE = 1800; // terrain is SIZE x SIZE, centred on the capital
export const SEA = 0;

export interface House {
  id: number;
  name: string;
  sigil: string;
  seat: string;
  land: string;
  coin: string;
  colors: [string, string];
  pos: [number, number];
  /** The rigged model for the house's lord or lady (public/models/<lord>.glb). */
  lord: string;
}

export const HOUSES: House[] = [
  { id: 0, name: 'Ashveil', sigil: 'Black heron', seat: 'Greywater', land: 'harbour city', coin: 'HERON', colors: ['#1d1f24', '#c9cdd4'], pos: [330, 395], lord: 'lady-heron' },
  { id: 1, name: 'Corrin', sigil: 'Red boar', seat: 'Redfield Keep', land: 'wheatlands', coin: 'BOAR', colors: ['#8c1c1c', '#1a1414'], pos: [-430, 110], lord: 'lord-boar' },
  { id: 2, name: 'Velmont', sigil: 'Golden ram', seat: 'Vinehold', land: 'vineyard hills', coin: 'RAM', colors: ['#c99a2e', '#4b2340'], pos: [-330, 370], lord: 'lord-ram' },
  { id: 3, name: 'Thorne', sigil: 'Green asp', seat: 'Mirefort', land: 'marsh delta', coin: 'ASP', colors: ['#2f5a33', '#e6dcc4'], pos: [-60, 455], lord: 'lady-asp' },
  { id: 4, name: 'Halloway', sigil: 'White owl', seat: 'Pinewatch', land: 'pine forest', coin: 'OWL', colors: ['#e9e7e1', '#46505c'], pos: [-440, -260], lord: 'lord-owl' },
  { id: 5, name: 'Draven', sigil: 'Iron bull', seat: 'Stonedeep', land: 'quarry and mines', coin: 'BULL', colors: ['#5a5d63', '#c07a2a'], pos: [400, -290], lord: 'lord-bull' },
  { id: 6, name: 'Marrow', sigil: 'Grey lynx', seat: 'High Marrow', land: 'snow mountains', coin: 'LYNX', colors: ['#8a9097', '#a9d3ee'], pos: [-120, -470], lord: 'queen-lynx' },
  { id: 7, name: 'Sorrel', sigil: 'Crimson hawk', seat: 'Gullcrest', land: 'sea cliffs', coin: 'HAWK', colors: ['#b3261e', '#d9c39a'], pos: [560, 120], lord: 'lord-hawk' },
];

/** The village green in front of a seat's gate, on the side facing the capital: kept clear of houses, where the lord walks. */
export function yardOf(h: House): [number, number] {
  const [x, z] = h.pos, d = Math.hypot(x, z) || 1;
  return [x - (x / d) * 52, z - (z / d) * 52];
}

export const CAPITAL = { name: 'Emberfall', pos: [0, 0] as [number, number] };
export const HIPPODROME = { name: 'Mumtaz Hippodrome', pos: [330, 210] as [number, number], rot: -0.3 };

/** The judges, as names on landmarks. No likeness and no part in the fighting. */
export const LANDMARKS: { name: string; note: string; pos: [number, number] }[] = [
  { name: "Polosukhin's Reach", note: 'the great north road', pos: [-60, -250] },
  { name: 'The Lazzarin Bridge', note: 'over the Ember River', pos: [0, 0] }, // set in bridges.ts
  { name: 'Mumtaz Hippodrome', note: 'the chariot arena', pos: HIPPODROME.pos },
  { name: "Garg's Lighthouse", note: 'guides ships into Greywater', pos: [425, 455] },
  { name: 'The Warwick Mint', note: 'where coins graduate', pos: [-5, 42] },
  { name: "Qureshi's Library", note: 'the Book of Ages', pos: [70, 38] },
  { name: 'Gershuni Gate', note: 'the south gate of the capital', pos: [54, 93] },
];

/** The Ember River, from the snows in the north down through the capital to the delta in the south. */
export const RIVER = new THREE.CatmullRomCurve3(
  [[-20, -900], [10, -640], [60, -420], [30, -220], [-40, -90], [-55, 10], [-20, 140], [10, 270], [-30, 400], [-70, 560], [-90, 900]].map(
    ([x, z]) => new THREE.Vector3(x, 0, z),
  ),
);


/** Every western road leaves the capital the same way: out of the west gate and over the Lazzarin Bridge. */
const WEST: [number, number][] = [[-25, 3], [-90, 5]];

/** Roads: every seat links to the capital, plus a few between neighbours. Each is a list of waypoints. */
export const ROADS: { from: number | 'capital'; to: number | 'capital'; via: [number, number][] }[] = [
  { from: 'capital', to: 6, via: [...WEST, [-95, -110], [-100, -250], [-115, -370]] }, // Polosukhin's Reach
  { from: 'capital', to: 4, via: [...WEST, [-150, -60], [-300, -170]] },
  { from: 'capital', to: 1, via: [...WEST, [-160, 30], [-300, 90]] },
  { from: 'capital', to: 2, via: [...WEST, [-130, 140], [-230, 280]] },
  { from: 'capital', to: 3, via: [...WEST, [-100, 100], [-95, 250], [-90, 380]] },
  { from: 'capital', to: 0, via: [[80, 140], [200, 280]] },
  { from: 'capital', to: 7, via: [[150, 20], [360, 80]] },
  { from: 'capital', to: 5, via: [[110, -90], [270, -220]] },
  { from: 1, to: 2, via: [[-400, 250]] },
  { from: 4, to: 1, via: [[-470, -80]] },
  { from: 5, to: 7, via: [[520, -100]] },
  { from: 0, to: 3, via: [[140, 450]] },
];

export const posOf = (k: number | 'capital'): [number, number] => (k === 'capital' ? CAPITAL.pos : HOUSES[k].pos);

/** A road as a curve on the ground (y filled in by the terrain later). */
export function roadCurve(r: (typeof ROADS)[number]) {
  const pts = [posOf(r.from), ...r.via, posOf(r.to)].map(([x, z]) => new THREE.Vector3(x, 0, z));
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
}

/** The road between two places, in either direction (for marches and travellers). */
export function routeBetween(a: number | 'capital', b: number | 'capital'): THREE.CatmullRomCurve3 | null {
  const r = ROADS.find((x) => x.from === a && x.to === b);
  if (r) return roadCurve(r);
  const back = ROADS.find((x) => x.from === b && x.to === a);
  if (back) {
    const pts = [posOf(back.from), ...back.via, posOf(back.to)].reverse().map(([x, z]) => new THREE.Vector3(x, 0, z));
    return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  }
  // No direct road: go through the capital.
  const one = routeBetween(a, 'capital'), two = routeBetween('capital', b);
  if (!one || !two) return null;
  return new THREE.CatmullRomCurve3([...one.points, ...two.points.slice(1)], false, 'centripetal');
}

let roadPts: [number, number][] | undefined;
/** Is (x, z) within `d` units of any road? Roads are sampled every 3 units the first time this is asked. */
/** Distance to the nearest road centreline (sampled every 3 units; roads are 7 wide). */
export function roadDist(x: number, z: number) {
  nearRoad(0, 0, 0);
  let best = Infinity;
  for (const [rx, rz] of roadPts!) { const d = (rx - x) * (rx - x) + (rz - z) * (rz - z); if (d < best) best = d; }
  return Math.sqrt(best);
}
export function nearRoad(x: number, z: number, d: number) {
  roadPts ??= ROADS.flatMap((r) => { const c = roadCurve(r); return c.getSpacedPoints(Math.ceil(c.getLength() / 3)); }).map((p) => [p.x, p.z]);
  const d2 = d * d;
  return roadPts.some(([rx, rz]) => (rx - x) * (rx - x) + (rz - z) * (rz - z) < d2);
}
