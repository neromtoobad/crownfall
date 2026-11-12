// What a walking lord or a driven chariot can't go through: buildings and walls (boxes), towers and round
// buildings (circles), the Hippodrome's stands, deep water and the edge of the world. A coarse grid keeps lookups cheap.
import { bridgeY } from './bridges.ts';
import { ground, landness } from './heights.ts';
import { HIPPODROME } from './layout.ts';
import { ARENA } from './race.ts';

export interface Box { kind: 'box'; x: number; z: number; hx: number; hz: number; c: number; s: number }
export interface Circle { kind: 'circle'; x: number; z: number; r: number; soft?: boolean }
export type Shape = Box | Circle;

const CELL = 16;
const grid = new Map<number, Shape[]>();
/** Every shape once (the grid holds each in several cells), for the ?debug=collide overlay. */
export const ALL: Shape[] = [];
// Buildings register their shapes once; if this file hot-reloads the grid would come back empty, so reload the page.
if (import.meta.hot) import.meta.hot.accept(() => location.reload());
const key = (i: number, j: number) => (i + 1000) * 4000 + (j + 1000);

function insert(s: Shape, reach: number) {
  ALL.push(s);
  reach += 4; // the widest body that asks (a chariot) still finds shapes in the next cell
  const i0 = Math.floor((s.x - reach) / CELL), i1 = Math.floor((s.x + reach) / CELL);
  const j0 = Math.floor((s.z - reach) / CELL), j1 = Math.floor((s.z + reach) / CELL);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const k = key(i, j);
    const list = grid.get(k);
    if (list) list.push(s); else grid.set(k, [s]);
  }
}

/** A solid box of size w × d centred on (x, z), turned by ry the way three.js turns objects. */
export function addBox(x: number, z: number, w: number, d: number, ry: number) {
  insert({ kind: 'box', x, z, hx: w / 2, hz: d / 2, c: Math.cos(ry), s: Math.sin(ry) }, Math.hypot(w, d) / 2);
}
/** `soft` shapes (tree trunks) stop bodies but not the camera. */
export function addCircle(x: number, z: number, r: number, soft = false) {
  insert({ kind: 'circle', x, z, r, soft }, r);
}

/** Is there land to stand on here (not deep water, not off the map)? */
export function dry(x: number, z: number) {
  if (x > 1500) return true; // indoors: the hall's walls hold you in
  if (bridgeY(x, z) !== undefined) return true;
  return ground(x, z) > 0.9 && landness(x, z) > 0.5 && Math.abs(x) < 880 && Math.abs(z) < 880;
}

// The Hippodrome's stands, in the arena's own frame: solid from the track's edge to the outer wall.
const HC = Math.cos(HIPPODROME.rot), HS = Math.sin(HIPPODROME.rot);
function arenaPush(x: number, z: number, r: number, out: { x: number; z: number }) {
  const dx = x - HIPPODROME.pos[0], dz = z - HIPPODROME.pos[1];
  const lx = dx * HC - dz * HS, lz = dx * HS + dz * HC;
  const cx = Math.max(-ARENA.L / 2, Math.min(ARENA.L / 2, lx));
  const ex = lx - cx, d = Math.hypot(ex, lz) || 1e-6;
  const outer = ARENA.R + 16;
  if (d < outer + r && d > ARENA.R - 1 - r) {
    // Outside the arena you are pushed out; inside (on the sand) you are pushed back onto the track.
    const toR = d > (ARENA.R + outer) / 2 ? outer + r : ARENA.R - 1 - r;
    const k = toR / d;
    const nlx = cx + ex * k, nlz = lz * k;
    out.x = HIPPODROME.pos[0] + nlx * HC + nlz * HS;
    out.z = HIPPODROME.pos[1] - nlx * HS + nlz * HC;
    return true;
  }
  return false;
}

const tmp = { x: 0, z: 0 };

/** People walking about (travellers, lords, soldiers): you can't walk through them. Each registers its Object3D. */
export interface Person { position: { x: number; z: number }; userData: { bump?: number; dodge?: number; kind?: string; name?: string; theirs?: string; r?: number } }
export const crowd = new Set<Person>();
export const PERSON_R = 0.75;
/** How wide a person is: most are PERSON_R; a lord in robes says so in userData.r. */
export const radiusOf = (p: { userData: { r?: number } }) => p.userData.r ?? PERSON_R;
/** Push (x, z) out of anyone in the crowd; returns the person hit, if any. */
function pushPeople(x: number, z: number, r: number, out: { x: number; z: number }) {
  let hit: Person | undefined;
  out.x = x; out.z = z;
  for (const p of crowd) {
    const ex = out.x - p.position.x, ez = out.z - p.position.z, min = r + radiusOf(p);
    if (Math.abs(ex) > min || Math.abs(ez) > min) continue;
    const d = Math.hypot(ex, ez);
    if (d < 1e-4) { out.x = p.position.x + min; out.z = p.position.z; hit = p; } // dead centre: any way out will do
    else if (d < min) { const k = min / d; out.x = p.position.x + ex * k; out.z = p.position.z + ez * k; hit = p; }
  }
  return hit;
}
/** Everyone within r of (x, z) (a chariot uses this: people leap out of its way rather than stop it). */
export function peopleNear(x: number, z: number, r: number) {
  const out: Person[] = [];
  for (const p of crowd) if (Math.hypot(p.position.x - x, p.position.z - z) < r + radiusOf(p)) out.push(p);
  return out;
}
/**
 * Things that move but are as solid as a wall: horses and chariots. Each owner ('car', 'race') replaces its own
 * list of circles every frame, so they never go stale; a body can skip its own owner's shapes.
 */
const beasts = new Map<string, { x: number; z: number; r: number }[]>();
export function setBeasts(owner: string, list: { x: number; z: number; r: number }[]) { beasts.set(owner, list); }
/** Every horse and chariot standing or moving in the realm right now (walkers steer round them). */
export function beastLists() { return beasts.values(); }
/** The chariot while you drive it (it isn't in `beasts` then, or it would block itself): people on foot keep clear of it. */
export const driven: { x: number; z: number; r: number }[] = [];
function pushBeasts(x: number, z: number, r: number, skip: string | undefined, out: { x: number; z: number }) {
  let hit = false;
  out.x = x; out.z = z;
  for (const [owner, list] of beasts) {
    if (owner === skip) continue;
    for (const b of list) {
      const ex = out.x - b.x, ez = out.z - b.z, min = r + b.r;
      if (Math.abs(ex) > min || Math.abs(ez) > min) continue;
      const d = Math.hypot(ex, ez);
      if (d < min) { const k = min / (d || 1e-6); out.x = b.x + ex * k; out.z = b.z + ez * k; hit = true; }
    }
  }
  return hit;
}
const res = { x: 0, z: 0 };
/** Push (x, z) out of buildings, walls, the stands, horses and chariots. Writes `res`; returns whether it hit any. */
function pushWalls(x: number, z: number, r: number, skip: string | undefined) {
  let nx = x, nz = z, hit = false;
  const list = grid.get(key(Math.floor(nx / CELL), Math.floor(nz / CELL)));
  if (list) for (const s of list) {
    if (s.kind === 'circle') {
      const ex = nx - s.x, ez = nz - s.z, d = Math.hypot(ex, ez), min = s.r + r;
      if (d < min) { hit = true; const k = min / (d || 1e-6); nx = s.x + ex * k; nz = s.z + ez * k; }
    } else {
      const ex = nx - s.x, ez = nz - s.z;
      const lx = ex * s.c - ez * s.s, lz = ex * s.s + ez * s.c; // into the box's frame
      const qx = Math.max(-s.hx, Math.min(s.hx, lx)), qz = Math.max(-s.hz, Math.min(s.hz, lz));
      let px = lx - qx, pz = lz - qz;
      let d = Math.hypot(px, pz);
      if (d >= r) continue;
      hit = true;
      let fx: number, fz: number;
      if (d < 1e-6) {
        // Inside the box: leave by the nearest face.
        const ox = s.hx - Math.abs(lx), oz = s.hz - Math.abs(lz);
        if (ox < oz) { fx = Math.sign(lx || 1) * (s.hx + r); fz = lz; } else { fx = lx; fz = Math.sign(lz || 1) * (s.hz + r); }
      } else {
        px /= d; pz /= d; d = r;
        fx = qx + px * d; fz = qz + pz * d;
      }
      nx = s.x + fx * s.c + fz * s.s;
      nz = s.z - fx * s.s + fz * s.c;
    }
  }
  if (arenaPush(nx, nz, r, tmp)) { hit = true; nx = tmp.x; nz = tmp.z; }
  if (pushBeasts(nx, nz, r, skip, tmp)) { hit = true; nx = tmp.x; nz = tmp.z; }
  res.x = nx; res.z = nz;
  return hit;
}
/**
 * Move a round body of radius r from (x, z) by (dx, dz), sliding along whatever it hits.
 * Returns the new position, whether it hit something, and (with `people`) who it walked into.
 */
/** `pr` is the body's width against people, when it differs from its width against walls (a lord's robes). */
export function moveBody(x: number, z: number, dx: number, dz: number, r: number, people = false, skip?: string, pr = r) {
  let nx = x + dx, nz = z + dz;
  let hit = false;
  let who: Person | undefined;
  // Water and the edge of the world: try each axis on its own so you slide along the bank.
  if (!dry(nx, nz)) {
    hit = true;
    if (dry(nx, z)) nz = z; else if (dry(x, nz)) nx = x; else { nx = x; nz = z; }
  }
  for (let pass = 0; pass < 2; pass++) {
    if (pushWalls(nx, nz, r, skip)) { hit = true; nx = res.x; nz = res.z; }
    if (people) {
      const p = pushPeople(nx, nz, pr, tmp);
      if (p) { who = p; nx = tmp.x; nz = tmp.z; }
    }
  }
  // Pinned between someone and a wall: people were pushed out of last, so check the wall still holds. If it
  // doesn't, the step isn't made at all (better to stand than to end up inside either).
  if (who && (pushWalls(nx, nz, r - 0.08, skip) || !dry(nx, nz))) { nx = x; nz = z; hit = true; }
  return { x: nx, z: nz, hit, who };
}

/** Is there a building, wall or stand within r of (x, z)? (Water doesn't count: for the camera.) */
export function solid(x: number, z: number, r: number) {
  const list = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (list) for (const s of list) {
    if (s.kind === 'circle') { if (!s.soft && Math.hypot(x - s.x, z - s.z) < s.r + r) return true; continue; }
    const ex = x - s.x, ez = z - s.z, lx = ex * s.c - ez * s.s, lz = ex * s.s + ez * s.c;
    if (Math.abs(lx) < s.hx + r && Math.abs(lz) < s.hz + r) return true;
  }
  return arenaPush(x, z, r, tmp);
}

/** Is (x, z) at height h above the ground inside a tree's canopy? (Trunks are soft circles; the crown is wider.) */
export function leafy(x: number, z: number, h: number) {
  if (h < 3.5) return false;
  const list = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (list) for (const s of list) if (s.kind === 'circle' && s.soft && Math.hypot(x - s.x, z - s.z) < s.r * 3.4 && h < s.r * 14) return true;
  return false;
}

/** Is a round body of radius r at (x, z) standing clear of everything? */
export function free(x: number, z: number, r: number, people = false, skip?: string) {
  if (!dry(x, z)) return false;
  const m = moveBody(x, z, 0, 0, r, people, skip);
  return !m.hit && !m.who && Math.abs(m.x - x) < 1e-3 && Math.abs(m.z - z) < 1e-3;
}
/** The nearest clear spot to (x, z) for a body of radius r, searching outward in rings. */
export function nearestFree(x: number, z: number, r: number, people = false, skip?: string) {
  if (free(x, z, r, people, skip)) return [x, z] as const;
  for (let ring = 1; ring < 40; ring++) {
    const d = ring * 2, n = 8 + ring * 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (free(px, pz, r, people, skip)) return [px, pz] as const;
    }
  }
  return [x, z] as const;
}

if (import.meta.env.DEV) Object.assign(window, { __collide: { solid, moveBody, dry, free, nearestFree, ALL, crowd, beasts } });
