// The halls inside the eight keeps. Each is built off the edge of the map (x ≥ ROOM_X), on a flat floor at y = 0,
// so the same walking, camera, collision and lighting code works indoors: walk into a keep's door outside and you
// are moved to its hall; walk back out of the hall door and you stand on the green before the keep again.
// While you are inside, the realm outside is hidden and the sun only reaches the floor through the windows.
import { CAPITAL, HOUSES, LANDMARKS, type House } from './layout.ts';
import { ground } from './heights.ts';
import { emitPlay, me, play } from './play.ts';

export const ROOM_X = 2400, ROOM_GAP = 300;
/** Anything past this x is indoors (the map ends at ±900). */
export const INDOOR_X = 1500;
export const indoors = (x: number) => x > INDOOR_X;

export type GameId = 'signals' | 'axes' | 'cups' | 'asp' | 'archery' | 'forge' | 'stones' | 'falcon' | 'dice';
export type Hall = 'harbour' | 'feast' | 'cellar' | 'marsh' | 'lodge' | 'forge' | 'ice' | 'aerie' | 'library' | 'throne';

export interface Room {
  house: number;
  /** Centre of the floor, in world units. */
  x: number; z: number;
  /** Width (x), depth (z) and height of the hall. */
  w: number; d: number; h: number;
  hall: Hall;
  game: GameId;
  gameName: string;
  /** One line on the game, for the Seal Book and the prompt. */
  pitch: string;
  /** Walls, floor, beams and the hearth's light. */
  wall: string; floor: 'planks' | 'flags' | 'ice' | 'earth'; beam: string; fire: string;
  /** Where the game is played and where you stand to start it, in the hall's own frame (x right, z toward the door). */
  station: [number, number];
  /** How the hall's people are dressed. */
  folk: string[];
}

const T: Record<number, Omit<Room, 'house' | 'x' | 'z'>> = {
  0: { w: 46, d: 64, h: 18, hall: 'harbour', game: 'signals', gameName: 'Lantern Signals', pitch: 'Repeat the ships’ lantern signals to bring them into Greywater.', wall: '#8f8f8c', floor: 'planks', beam: '#3b3631', fire: '#ffb066', station: [0, -12], folk: ['peasant-m', 'soldier', 'peasant-f'] },
  1: { w: 44, d: 70, h: 17, hall: 'feast', game: 'axes', gameName: 'Axe Throw', pitch: 'Five axes at the boar target. Bullseyes buy the next round.', wall: '#9c8a74', floor: 'flags', beam: '#4a2f22', fire: '#ff9a4a', station: [0, -6], folk: ['peasant-m', 'peasant-f', 'soldier', 'peasant-m'] },
  2: { w: 40, d: 60, h: 13, hall: 'cellar', game: 'cups', gameName: 'The Vintner’s Cups', pitch: 'A gold ram under one of three goblets. Watch the shuffle.', wall: '#7d6650', floor: 'flags', beam: '#3a2418', fire: '#ffb35c', station: [0, -10], folk: ['peasant-f', 'peasant-m'] },
  3: { w: 42, d: 62, h: 15, hall: 'marsh', game: 'asp', gameName: 'The Asp’s Basket', pitch: 'Steal gold from the asp’s basket. Freeze when it rises.', wall: '#6f7a62', floor: 'planks', beam: '#2c3324', fire: '#ffd79a', station: [0, -10], folk: ['peasant-f', 'soldier'] },
  4: { w: 40, d: 92, h: 17, hall: 'lodge', game: 'archery', gameName: 'Pinewatch Archery', pitch: 'Five arrows down the long range. Mind the wind.', wall: '#8a7356', floor: 'planks', beam: '#3d2c1c', fire: '#ffa65a', station: [0, 24], folk: ['peasant-m', 'soldier'] },
  5: { w: 48, d: 62, h: 20, hall: 'forge', game: 'forge', gameName: 'The Forge', pitch: 'Strike while the steel glows. Shape a blade worth a lord.', wall: '#6c625a', floor: 'earth', beam: '#2a221d', fire: '#ff7a2a', station: [0, -10], folk: ['soldier', 'peasant-m'] },
  6: { w: 44, d: 76, h: 18, hall: 'ice', game: 'stones', gameName: 'Ice Stones', pitch: 'Slide your stones to the lynx mark. Sweep to carry them.', wall: '#9aa3ab', floor: 'ice', beam: '#3e464f', fire: '#ffc48a', station: [0, 18], folk: ['soldier', 'peasant-f'] },
  7: { w: 46, d: 62, h: 19, hall: 'aerie', game: 'falcon', gameName: 'Falconry', pitch: 'Fly the house hawk along the cliffs and snatch the gulls.', wall: '#a8957a', floor: 'flags', beam: '#4b3324', fire: '#ffaa5e', station: [0, -14], folk: ['soldier', 'peasant-m'] },
};

export const ROOMS: Room[] = HOUSES.map((h) => ({ house: h.id, x: ROOM_X + h.id * ROOM_GAP, z: 0, ...T[h.id] }));

/** Qureshi's Library is the ninth room: a round reading room under the dome, where Haseeb Qureshi plays Liar's Dice. */
export const LIBRARY = 8;
export const LIB_ROOM: Room = {
  house: LIBRARY, x: ROOM_X + LIBRARY * ROOM_GAP, z: 0, w: 32, d: 32, h: 24, hall: 'library', game: 'dice', gameName: 'Liar’s Dice',
  pitch: 'Five dice each under the cup. Bid on what’s under both, or call the bluff.', wall: '#8a7a66', floor: 'flags', beam: '#3a2618', fire: '#ffc07a',
  station: [0, 0], folk: [],
};
/** The tenth: the hall of the Ashen Throne in Emberfall, a long stone nave with the empty throne at its far end.
 * No game is played here (game is unused); you come to look at what every house is fighting for. */
export const THRONE_ROOM = 9;
export const THRONE_HALL: Room = {
  house: THRONE_ROOM, x: ROOM_X + THRONE_ROOM * ROOM_GAP, z: 0, w: 52, d: 100, h: 36, hall: 'throne', game: 'dice', gameName: '',
  pitch: 'The empty seat every house in Vael is fighting for.', wall: '#8a8378', floor: 'flags', beam: '#2e2622', fire: '#ffb066',
  station: [0, 0], folk: [],
};
/** Who a room belongs to, for its name and colours: a house, the Library or the throne hall. */
export const LIB_HOUSE = { id: LIBRARY, name: 'the Library', colors: ['#5b3f6e', '#d6b26e'] as [string, string], coin: 'NEAR', seat: 'Emberfall' };
/** Where the throne stands in its hall (room frame): its scale, its dais centre, the front of its stair (the model's
 * stair reaches 9.8 m in front of the dais centre; Throne.tsx THRONE_SIZE). */
export const THRONE_SEAT = { scale: 1.2, z: -100 / 2 + 17, stair: -100 / 2 + 17 + 9.8 * 1.2 };
export const THRONE_HOUSE = { id: THRONE_ROOM, name: 'the Ashen Throne', colors: ['#6a0f17', '#d4a849'] as [string, string], coin: 'NEAR', seat: 'Emberfall' };
export const hallHouse = (i: number) => (i === LIBRARY ? LIB_HOUSE : i === THRONE_ROOM ? THRONE_HOUSE : HOUSES[i]);
export const roomOf = (i: number) => (i === LIBRARY ? LIB_ROOM : i === THRONE_ROOM ? THRONE_HALL : ROOMS[i]);
export const ALL_ROOMS = [...ROOMS, LIB_ROOM, THRONE_HALL];

/** The throne hall's great door in Emberfall, in the middle of its south front (the hall stands at the capital's
 * x + 35, z - 40 and is 23 deep). */
export function throneDoor() {
  const x = CAPITAL.pos[0] + 35, z = CAPITAL.pos[1] - 40 + 11.5;
  return { x, z, face: 0, out: [x, z + 4] as [number, number] };
}

/** The Library's door, on the drum between two of the sixteen columns, facing south toward the Mint. */
export function libDoor() {
  const [lx, lz] = LANDMARKS[5].pos, a = Math.PI / 2 + Math.PI / 16;
  const dx = Math.cos(a), dz = Math.sin(a);
  return { x: lx + dx * 9.1, z: lz + dz * 9.1, face: Math.atan2(dx, dz), y: ground(lx, lz) - 0.4 + 1.4, out: [lx + dx * 13, lz + dz * 13] as [number, number] };
}

/** The hall you're in, if any. */
export const roomAt = (x: number) => (indoors(x) ? roomOf(Math.round((x - ROOM_X) / ROOM_GAP)) : undefined);
/** A point in a room's own frame, in world units. */
export const inRoom = (r: Room, lx: number, lz: number): [number, number] => [r.x + lx, r.z + lz];

/** The keep's front door outside: on the face that looks toward the capital. */
export function doorOf(h: House): { x: number; z: number; face: number } {
  const [cx, cz] = h.pos, d = Math.hypot(cx, cz) || 1;
  return { x: cx - (cx / d) * 16.5, z: cz - (cz / d) * 16.5, face: Math.atan2(-cx, -cz) };
}

/** The black fade between outside and in. The HUD draws it; `at` is when it started. */
export const fade = { at: -1e9, dur: 900 };

/** Walk through a keep's door. */
export function enterRoom(h: number) {
  const r = roomOf(h);
  fade.at = performance.now();
  setTimeout(() => {
    play.inside = h;
    play.driving = false;
    me.x = r.x; me.z = r.z + r.d / 2 - (h === LIBRARY ? 4.5 : 11); me.yaw = Math.PI; me.speed = 0;
    me.camYaw = 0; me.camPitch = 0.18; me.cut = true;
    emitPlay();
  }, fade.dur / 2);
}
/** Walk out of the hall door: on the green before the keep, facing the capital. */
export function leaveRoom() {
  const h = play.inside;
  if (h < 0) return;
  const d = h === LIBRARY ? libDoor() : h === THRONE_ROOM ? throneDoor() : doorOf(HOUSES[h]);
  fade.at = performance.now();
  setTimeout(() => {
    play.inside = -1;
    const out = h === LIBRARY ? 6 : h === THRONE_ROOM ? 7 : 5;
    me.x = d.x + Math.sin(d.face) * out; me.z = d.z + Math.cos(d.face) * out; me.yaw = d.face; me.speed = 0;
    me.camYaw = d.face + Math.PI; me.camPitch = 0.22; me.cut = true;
    emitPlay();
  }, fade.dur / 2);
}

if (import.meta.env.DEV) Object.assign(window, { __rooms: { enterRoom, leaveRoom, ROOMS, LIB_ROOM, THRONE_HALL } });
