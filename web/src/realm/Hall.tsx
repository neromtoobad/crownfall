// The inside of a keep: stone walls pierced by tall windows, timber trusses under a dark ceiling, a hearth that
// lights the room, chandeliers, a runner carpet from the door to the lord's dais, house banners, tables and the
// people of the house. The low sun comes in through the west and south windows as shafts of light with dust in them.
// Built in the hall's own frame (x across, z toward the door, y up) and placed off the map at the room's origin.
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import AVG from './texAvg.json';
import { triplanar } from './materials.ts';
import { addBox, addCircle } from './collide.ts';
import { HOUSES } from './layout.ts';
import { Props, type Place } from './Props.tsx';
import { Embers, FireLight, Flames, type FlameSpot } from './fire.tsx';
import { LIBRARY, ROOMS, roomOf, type Room } from './rooms.ts';
import { LibraryScene } from './Library.tsx';
import { notice, rest, unturn, useCrowd, useSolid } from './People.tsx';
import { usePlay } from './play.ts';
import { gameDef } from '../games/host.ts';
import { sigilTexture } from './sigils.ts';
import { M } from './race.ts';

type G = THREE.BufferGeometry;
const SUN = new THREE.Vector3(-0.6, 0.42, 0.5).normalize(); // matches Realm.tsx
const T = 1.6; // wall thickness

export function rng(seed: number) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
const col = new THREE.Color();
/** A box with one vertex colour (jittered a little so no two stones or boards match). */
export function block(w: number, h: number, d: number, x: number, y: number, z: number, color: string, jitter = 0.06, r = Math.random, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rz) g.rotateZ(rz);
  if (ry) g.rotateY(ry);
  g.translate(x, y + h / 2, z);
  return paint(g, color, jitter, r);
}
export function paint(g: G, color: string, jitter = 0.06, r = Math.random) {
  col.set(color).multiplyScalar(1 - jitter + r() * jitter * 2);
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
export const merge = (list: G[]) => (list.length ? mergeGeometries(list.map((g) => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); n.deleteAttribute('normal'); n.computeVertexNormals(); return n; })) : new THREE.BufferGeometry());

interface Opening { wall: 'w' | 'e' | 's' | 'n'; at: number; width: number; y0: number; y1: number }

/** Where the windows go: tall ones down the long walls, two flanking the door, none behind the dais or the hearth. */
function openings(r: Room): Opening[] {
  const out: Opening[] = [];
  const cellar = r.hall === 'cellar', aerie = r.hall === 'aerie';
  const width = aerie ? 6.5 : cellar ? 2 : 3.2;
  const y0 = cellar ? r.h - 4 : aerie ? 3 : Math.min(6, r.h * 0.33), y1 = cellar ? r.h - 2 : Math.min(r.h - 3.5, y0 + (aerie ? 11 : 7.5));
  const step = aerie ? 13 : 11;
  for (let z = -r.d / 2 + 14; z < r.d / 2 - 7; z += step) {
    out.push({ wall: 'w', at: z, width, y0, y1 });
    if (Math.abs(z) > 7 && !aerie) out.push({ wall: 'e', at: z, width, y0, y1 }); // the hearth sits mid east wall
  }
  if (!cellar) for (const x of [-r.w / 4, r.w / 4]) out.push({ wall: 's', at: x, width: 3.2, y0: y0 + 1, y1 });
  return out;
}

/** One wall, built around its openings as bands and piers. The wall runs along `len`, centred on (cx, cz). */
function wall(len: number, h: number, cx: number, cz: number, alongX: boolean, holes: { at: number; width: number; y0: number; y1: number }[], color: string, r: () => number, out: G[]) {
  const piece = (a0: number, a1: number, y0: number, y1: number) => {
    if (a1 - a0 < 0.05 || y1 - y0 < 0.05) return;
    const mid = (a0 + a1) / 2, l = a1 - a0;
    out.push(alongX ? block(l, y1 - y0, T, cx + mid, y0, cz, color, 0.04, r) : block(T, y1 - y0, l, cx, y0, cz + mid, color, 0.04, r));
  };
  const sorted = [...holes].sort((a, b) => a.at - b.at);
  // Piers between holes run full height; above and below each hole is a band.
  let a = -len / 2;
  for (const o of sorted) {
    const h0 = o.at - o.width / 2, h1 = o.at + o.width / 2;
    piece(a, h0, 0, h);
    piece(h0, h1, 0, o.y0);
    piece(h0, h1, o.y1, h);
    a = h1;
  }
  piece(a, len / 2, 0, h);
}

const registered = new Set<number>();
/** The walls, posts, tables and dais as solids, once per hall (they live off the map, so they never get in the way outside). */
function collide(r: Room, tables: [number, number, number, number][], posts: [number, number][]) {
  if (registered.has(r.house)) return;
  registered.add(r.house);
  const X = r.x, Z = r.z;
  addBox(X - r.w / 2 - T / 2, Z, T * 2, r.d + 4, 0);
  addBox(X + r.w / 2 + T / 2, Z, T * 2, r.d + 4, 0);
  addBox(X, Z - r.d / 2 - T / 2, r.w + 4, T * 2, 0);
  // The door wall, with the doorway left open (the way out is a place you walk into, not through).
  const half = (r.w - 7) / 2;
  addBox(X - 3.5 - half / 2, Z + r.d / 2 + T / 2, half, T * 2, 0);
  addBox(X + 3.5 + half / 2, Z + r.d / 2 + T / 2, half, T * 2, 0);
  addBox(X, Z + r.d / 2 + 4, 8, 2, 0); // behind the doorway
  addBox(X, Z - r.d / 2 + 4, r.w * 0.62, 8, 0); // the dais
  addBox(X + r.w / 2 - 1.6, Z, 3.2, 10, 0); // the hearth's chimney breast
  for (const [x, z, w, d] of tables) addBox(X + x, Z + z, w, d, 0);
  for (const [x, z] of posts) addCircle(X + x, Z + z, 0.95);
}

export function HallWorld() {
  const p = usePlay();
  if (p.inside < 0) return null;
  if (p.inside === LIBRARY) return <Suspense fallback={null}><LibraryScene /></Suspense>;
  return <Suspense fallback={null}><HallScene room={ROOMS[p.inside]} /></Suspense>;
}

function HallScene({ room }: { room: Room }) {
  const def = gameDef(room.game);
  return (
    <>
      <group position={[room.x, 0, room.z]}>
        <Shell room={room} />
        {def && <def.Station room={room} />}
      </group>
      <Folk room={room} />
    </>
  );
}

function Shell({ room: r }: { room: Room }) {
  const [rock, bark] = useTexture(['/tex/rock.jpg', '/tex/bark.jpg']);
  const h = HOUSES[r.house];
  const built = useMemo(() => {
    const rnd = rng(31 + r.house * 977);
    const stone: G[] = [], wood: G[] = [], dark: G[] = [], floor: G[] = [], iron: G[] = [], cloth: G[] = [], gold: G[] = [];
    const W = r.w, D = r.d, H = r.h;
    const ops = openings(r);
    const timber = r.hall === 'lodge';
    // ---- Walls (timber in the lodge, stone everywhere else), with a plinth course and pilasters.
    const wallC = r.wall;
    const walls = timber ? wood : stone;
    wall(D, H, -W / 2 - T / 2, 0, false, ops.filter((o) => o.wall === 'w'), wallC, rnd, walls);
    wall(D, H, W / 2 + T / 2, 0, false, ops.filter((o) => o.wall === 'e'), wallC, rnd, walls);
    wall(W, H, 0, -D / 2 - T / 2, true, [], wallC, rnd, walls);
    wall(W, H, 0, D / 2 + T / 2, true, [{ at: 0, width: 7, y0: 0, y1: 10.5 }, ...ops.filter((o) => o.wall === 's')], wallC, rnd, walls);
    for (const s of [-1, 1]) {
      stone.push(block(0.5, 1.1, D, s * (W / 2 - 0.25), 0, 0, '#6d6458', 0.03, rnd));
      for (let z = -D / 2 + 3; z < D / 2; z += 11) stone.push(block(1.2, H, 1.4, s * (W / 2 - 0.5), 0, z - 5.5, wallC, 0.08, rnd));
    }
    // Window reveals: deep sills, and a dark iron cross in each pane.
    for (const o of ops) {
      const sx = o.wall === 'w' ? -W / 2 : o.wall === 'e' ? W / 2 : o.at, sz = o.wall === 's' ? D / 2 : o.at;
      const across = o.wall === 's';
      stone.push(across ? block(o.width + 0.6, 0.35, T + 0.8, sx, o.y0 - 0.35, sz, '#8d8476', 0.03, rnd) : block(T + 0.8, 0.35, o.width + 0.6, sx, o.y0 - 0.35, sz, '#8d8476', 0.03, rnd));
      if (r.hall !== 'aerie') {
        const cy = (o.y0 + o.y1) / 2;
        iron.push(across ? block(0.12, o.y1 - o.y0, 0.12, sx, o.y0, sz, '#222', 0, rnd) : block(0.12, o.y1 - o.y0, 0.12, sx, o.y0, sz, '#222', 0, rnd));
        iron.push(across ? block(o.width, 0.12, 0.12, sx, cy, sz, '#222', 0, rnd) : block(0.12, 0.12, o.width, sx, cy, sz, '#222', 0, rnd));
      }
    }
    // ---- Floor.
    if (r.floor === 'planks') {
      for (let x = -W / 2; x < W / 2; x += 1.15) for (let z = -D / 2, k = 0; z < D / 2; k++) {
        const l = Math.min(D / 2 - z, 4 + rnd() * 6 + (k === 0 ? rnd() * 4 : 0));
        floor.push(block(1.1, 0.25, l - 0.06, x + 0.575, -0.25, z + l / 2, '#7a5a3c', 0.14, rnd));
        z += l;
      }
    } else if (r.floor === 'flags' || r.floor === 'earth') {
      const base = r.floor === 'earth' ? '#6b5847' : '#8f8678';
      for (let x = -W / 2; x < W / 2; x += 2.6) for (let z = -D / 2; z < D / 2; z += 2.6) {
        if (r.floor === 'earth' && rnd() < 0.35) continue;
        floor.push(block(2.5, 0.25 + rnd() * 0.04, 2.5, x + 1.3, -0.25, z + 1.3, base, 0.12, rnd));
      }
      if (r.floor === 'earth') floor.push(block(W, 0.2, D, 0, -0.24, 0, '#4e4034', 0.02, rnd));
      else floor.push(block(W, 0.2, D, 0, -0.27, 0, '#3e3830', 0.02, rnd)); // the grout between flags
    } else {
      // Ice: stone margins, a long sheet down the middle.
      floor.push(block(W, 0.2, D, 0, -0.22, 0, '#8d939a', 0.02, rnd));
    }
    // ---- The roof: ceiling boards, tie beams with king posts and struts, wall posts on corbels.
    dark.push(block(W + 2 * T, 0.8, D + 2 * T, 0, H, 0, '#2a211b', 0.02, rnd));
    for (let z = -D / 2 + 4; z < D / 2 - 2; z += 9) {
      const by = H - 3.2;
      if (r.hall === 'cellar') {
        // A vault: a stone rib arching across.
        const N = 40, rx = W / 2 - 0.6, ry = 4.2;
        for (let i = 0; i < N; i++) {
          const a0 = (i / N) * Math.PI, a1 = ((i + 1) / N) * Math.PI;
          const x0 = Math.cos(a0) * rx, y0 = Math.sin(a0) * ry, x1 = Math.cos(a1) * rx, y1 = Math.sin(a1) * ry;
          const len = Math.hypot(x1 - x0, y1 - y0) + 0.06, ang = Math.atan2(y1 - y0, x1 - x0);
          const g = new THREE.BoxGeometry(len, 0.9, 1.2).rotateZ(ang).translate((x0 + x1) / 2, H - 4.6 + (y0 + y1) / 2, z);
          stone.push(paint(g, '#7f7466', 0.05, rnd));
        }
        continue;
      }
      wood.push(block(W, 0.9, 0.9, 0, by, z, r.beam, 0.05, rnd));
      wood.push(block(0.7, H - by - 0.9, 0.7, 0, by + 0.9, z, r.beam, 0.05, rnd));
      for (const s of [-1, 1]) {
        const len = Math.hypot(W / 4, H - by - 0.9);
        const g = new THREE.BoxGeometry(len, 0.55, 0.55).rotateZ(s * Math.atan2(H - by - 0.9, W / 4)).translate(s * W / 8, by + 0.9 + (H - by - 0.9) / 2, z);
        wood.push(paint(g, r.beam, 0.05, rnd));
        wood.push(block(0.7, 4.5, 0.7, s * (W / 2 - 0.5), by - 4.5, z, r.beam, 0.05, rnd)); // wall post
        wood.push(block(1.4, 0.6, 0.8, s * (W / 2 - 0.9), by - 0.6, z, r.beam, 0.05, rnd)); // corbel
      }
      // Purlins along the hall, under the ceiling.
    }
    for (const x of [-W / 3, 0, W / 3]) if (r.hall !== 'cellar') wood.push(block(0.6, 0.6, D, x, H - 0.6, 0, r.beam, 0.05, rnd));
    // ---- Posts down both aisles (not in the cellar, the archery range's lane or the ice sheet).
    const posts: [number, number][] = [];
    if (r.w >= 42 && r.hall !== 'cellar') for (let z = -D / 2 + 13; z < D / 2 - 8; z += 9) for (const s of [-1, 1]) {
      const x = s * (W / 2 - 7);
      posts.push([x, z]);
      wood.push(block(1.1, H - 3.2, 1.1, x, 0, z, r.beam, 0.05, rnd));
      stone.push(block(1.7, 0.7, 1.7, x, 0, z, '#7c7468', 0.04, rnd));
      wood.push(block(2.6, 0.5, 1.1, x, H - 3.7, z, r.beam, 0.05, rnd)); // the post's head
    }
    // ---- The dais at the far end, with steps, the lord's chair and a canopy of house colour.
    const dz = -D / 2 + 4, dw = W * 0.62;
    stone.push(block(dw, 0.75, 8, 0, 0, dz, '#857b6d', 0.03, rnd));
    stone.push(block(dw * 0.7, 0.38, 1.2, 0, 0, dz + 4.6, '#857b6d', 0.03, rnd));
    wood.push(block(2.6, 0.9, 2.2, 0, 0.75, dz - 1.4, r.beam, 0.04, rnd)); // the chair: seat
    wood.push(block(2.6, 5.2, 0.5, 0, 0.75, dz - 2.5, r.beam, 0.04, rnd));  // back
    for (const s of [-1, 1]) wood.push(block(0.4, 1.9, 2.2, s * 1.3, 0.75, dz - 1.4, r.beam, 0.04, rnd)); // arms
    cloth.push(block(2.2, 0.25, 1.8, 0, 1.65, dz - 1.3, h.colors[0], 0, rnd));
    gold.push(block(2.8, 0.35, 0.6, 0, 5.95, dz - 2.5, '#c9a24a', 0, rnd)); // the chair's crest rail
    // ---- The hearth, mid east wall: a chimney breast, a dark firebox, a mantle.
    const hx = W / 2 - 1.2;
    stone.push(block(2.4, H, 9, hx, 0, 0, '#7a7064', 0.05, rnd));
    dark.push(block(1.6, 3.4, 4.6, hx - 0.5, 0, 0, '#140f0c', 0, rnd));
    stone.push(block(3.4, 0.6, 10, hx - 0.5, 4, 0, '#8e8476', 0.03, rnd));
    stone.push(block(3.6, 0.4, 6, hx - 1.3, 0, 0, '#5a5148', 0.03, rnd)); // the hearthstone
    // ---- Tables (feast hall: two long ones; others: one or two short ones and the war table).
    const tables: [number, number, number, number][] = [];
    const table = (x: number, z: number, w: number, d: number) => {
      tables.push([x, z, w + 1.6, d]);
      wood.push(block(w, 0.14, d, x, 1.38, z, '#6a4a30', 0.06, rnd));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) wood.push(block(0.25, 1.38, 0.25, x + sx * (w / 2 - 0.3), 0, z + sz * (d / 2 - 0.5), '#4a3322', 0.05, rnd));
      for (const s of [-1, 1]) wood.push(block(0.55, 0.14, d * 0.96, x + s * (w / 2 + 0.75), 0.78, z, '#5c3f28', 0.06, rnd)); // benches
      // On the table: pewter plates, goblets, loaves.
      for (let k = -d / 2 + 1.5; k < d / 2 - 1; k += 2.2) for (const s of [-1, 1]) {
        iron.push(paint(new THREE.CylinderGeometry(0.26, 0.24, 0.04, 12).translate(x + s * (w / 2 - 0.45), 1.54, z + k), '#8a8d91', 0.05, rnd));
        if (rnd() < 0.6) gold.push(paint(new THREE.CylinderGeometry(0.07, 0.05, 0.32, 8).translate(x + s * (w / 2 - 0.85), 1.68, z + k + 0.3), '#b89442', 0.05, rnd));
        if (rnd() < 0.3) wood.push(paint(new THREE.SphereGeometry(0.22, 8, 6).scale(1.4, 0.7, 0.9).translate(x + s * 0.2, 1.6, z + k), '#a8743d', 0.1, rnd));
      }
    };
    if (r.hall === 'feast') { table(-8, 4, 2, 34); table(8, 4, 2, 34); }
    else if (r.hall === 'lodge') table(-13, -10, 2, 14);
    else if (r.hall !== 'ice') table(-W / 2 + 8, 10, 2, 12);
    // The war table, near the dais on the west side: a map in house colours.
    const wx = -W / 2 + 7, wz = -D / 2 + 14;
    tables.push([wx, wz, 5, 3.6]);
    wood.push(block(4.4, 0.18, 3, wx, 1.3, wz, '#5a3c26', 0.04, rnd));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) wood.push(block(0.3, 1.3, 0.3, wx + sx * 1.9, 0, wz + sz * 1.2, '#3e2a1b', 0.04, rnd));
    cloth.push(block(4, 0.04, 2.6, wx, 1.48, wz, '#cbb98f', 0.02, rnd));
    for (let i = 0; i < 8; i++) cloth.push(paint(new THREE.ConeGeometry(0.12, 0.38, 6).translate(wx - 1.6 + rnd() * 3.2, 1.7, wz - 1 + rnd() * 2), HOUSES[i].colors[0], 0, rnd));
    // ---- Chandeliers: an iron ring of candles hanging from the tie beams.
    const flames: FlameSpot[] = [], lights: [number, number, number, number][] = [];
    const chand = r.hall === 'cellar' ? [] : [-D / 6, D / 6];
    for (const z of chand) {
      const y = H - 7.2;
      iron.push(paint(new THREE.TorusGeometry(2.3, 0.1, 6, 28).rotateX(Math.PI / 2).translate(0, y, z), '#1f1c1a', 0, rnd));
      iron.push(block(0.06, H - 3.2 - y, 0.06, 0, y, z, '#1f1c1a', 0, rnd));
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2, x = Math.cos(a) * 2.3, cz = z + Math.sin(a) * 2.3;
        cloth.push(paint(new THREE.CylinderGeometry(0.07, 0.07, 0.42, 6).translate(x, y + 0.26, cz), '#efe6cf', 0, rnd));
        flames.push([x, y + 0.48, cz, 0.22]);
      }
      lights.push([0, y + 0.3, z, 120]);
    }
    // Candles on the tables and by the dais.
    for (const [x, z, , d] of tables) for (let k = -d / 2 + 2; k < d / 2 - 1; k += 6) {
      cloth.push(paint(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 6).translate(x, 1.7, z + k), '#efe6cf', 0, rnd));
      flames.push([x, 1.96, z + k, 0.2]);
    }
    // Braziers either side of the dais, and torches between the windows.
    for (const s of [-1, 1]) {
      const bx = s * (dw / 2 + 1.6), bz = dz + 3;
      iron.push(paint(new THREE.CylinderGeometry(0.9, 0.35, 0.8, 10).translate(bx, 2.6, bz), '#2a2522', 0, rnd));
      iron.push(paint(new THREE.CylinderGeometry(0.12, 0.2, 2.2, 6).translate(bx, 1.1, bz), '#2a2522', 0, rnd));
      for (let i = 0; i < 4; i++) flames.push([bx + (rnd() - 0.5) * 0.8, 2.9, bz + (rnd() - 0.5) * 0.8, 1.1 + rnd() * 0.4]);
      lights.push([bx, 3.8, bz, 90]);
      for (let z = -D / 2 + 19; z < D / 2 - 6; z += 22) {
        const tx = s * (W / 2 - 0.6);
        iron.push(block(0.18, 0.9, 0.18, tx - s * 0.2, 5.6, z + 5.5, '#2a2522', 0, rnd));
        wood.push(paint(new THREE.CylinderGeometry(0.13, 0.09, 1.1, 6).translate(tx - s * 0.45, 6.4, z + 5.5), '#3a2a1c', 0, rnd));
        flames.push([tx - s * 0.45, 6.95, z + 5.5, 0.75]);
      }
    }
    // The hearth's fire.
    for (let i = 0; i < 7; i++) flames.push([hx - 0.6 + (rnd() - 0.5) * 0.6, 0.15, (rnd() - 0.5) * 3, 1.5 + rnd() * 1.1]);
    // Logs in the firebox.
    for (let i = 0; i < 3; i++) wood.push(paint(new THREE.CylinderGeometry(0.22, 0.22, 3.4, 7).rotateX(Math.PI / 2).rotateY((rnd() - 0.5) * 0.5).translate(hx - 0.6 + (rnd() - 0.5) * 0.4, 0.25 + i * 0.1, 0), '#2b1d12', 0.1, rnd));
    collide(r, tables, posts);
    return { stone: merge(stone), wood: merge(wood), dark: merge(dark), floor: merge(floor), iron: merge(iron), cloth: merge(cloth), gold: merge(gold), ops, flames, lights, hx, dz, dw };
  }, [r, h]);

  const mats = useMemo(() => {
    for (const t of [rock, bark]) { t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.needsUpdate = true; }
    const A = AVG as Record<string, number[]>;
    const stone = masonry(triplanar(rock, A.rock, 0.45, '#ffffff', true, 0.7), 0.45);
    const wood = triplanar(bark, A.bark, 0.42, '#ffffff', true, 0.45);
    const floor = r.floor === 'planks' ? triplanar(bark, A.bark, 0.6, '#ffffff', true, 0.32) : triplanar(rock, A.rock, 0.3, '#ffffff', true, r.floor === 'ice' ? 0.4 : 0.85);
    floor.roughness = r.floor === 'planks' ? 0.78 : 0.88;
    const plain = (rough: number, metal = 0) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal });
    return { stone, wood, floor, dark: plain(0.95), iron: plain(0.5, 0.6), cloth: plain(0.9), gold: plain(0.32, 0.75) };
  }, [rock, bark, r.floor]);

  return (
    <group>
      <mesh geometry={built.stone} material={mats.stone} castShadow receiveShadow />
      <mesh geometry={built.wood} material={mats.wood} castShadow receiveShadow />
      <mesh geometry={built.floor} material={mats.floor} receiveShadow />
      <mesh geometry={built.dark} material={mats.dark} castShadow receiveShadow />
      <mesh geometry={built.iron} material={mats.iron} castShadow />
      <mesh geometry={built.cloth} material={mats.cloth} castShadow receiveShadow />
      <mesh geometry={built.gold} material={mats.gold} castShadow />
      {r.floor === 'ice' && <IceSheet room={r} />}
      <Runner room={r} />
      <Banners room={r} />
      <Panes room={r} ops={built.ops} />
      <Shafts room={r} ops={built.ops} />
      <Dust room={r} />
      <Flames spots={built.flames} />
      <FireLight position={[built.hx - 2.5, 2.2, 0]} color={r.fire} intensity={520} distance={60} />
      <Embers position={[built.hx - 0.7, 0.4, 0]} />
      {built.lights.map(([x, y, z, i], k) => <FireLight key={k} position={[x, y, z]} color={r.fire} intensity={i} distance={38} />)}
      <Dressing room={r} />
    </group>
  );
}

/** Ashlar coursing over a triplanar stone material: mortar joints in staggered courses on every wall face, each block
 * a slightly different shade, the edges a touch darker. Floors and tops (faces pointing up or down) are left plain. */
export function masonry(m: THREE.MeshStandardMaterial, scale: number) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      {
        vec3 p = vOP / ${scale.toFixed(3)}; vec3 n = abs(normalize(vON));
        if (n.y < 0.6) {
          float u = n.x > n.z ? p.z : p.x;
          float row = floor(p.y / 1.15);
          float uu = u / 2.3 + row * 0.5;
          vec2 cell = vec2(floor(uu), row);
          vec2 f = vec2(fract(uu) * 2.3, fract(p.y / 1.15) * 1.15);
          float e = min(min(f.x, 2.3 - f.x), min(f.y, 1.15 - f.y));
          float mortar = smoothstep(0.03, 0.09, e);
          float hsh = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
          diffuseColor.rgb *= mix(0.42, 1.0, mortar) * (0.88 + hsh * 0.22) * (0.9 + 0.1 * smoothstep(0.0, 0.35, e));
          roughnessFactor = mix(1.0, roughnessFactor, mortar);
        }
      }`);
  };
  m.customProgramCacheKey = () => `masonry-${scale}`;
  return m;
}

/** The frozen floor of High Marrow: a long, faintly reflective sheet down the middle. */
function IceSheet({ room: r }: { room: Room }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 2]} receiveShadow>
      <planeGeometry args={[r.w - 12, r.d - 14]} />
      <meshStandardMaterial color="#d6e8f2" roughness={0.12} metalness={0.05} envMapIntensity={1.2} />
    </mesh>
  );
}

/** The long carpet from the door to the dais, in house colours with a woven border. */
function Runner({ room: r }: { room: Room }) {
  const h = HOUSES[r.house];
  const tex = useMemo(() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 1024;
    const g = c.getContext('2d')!;
    g.fillStyle = h.colors[0]; g.fillRect(0, 0, 128, 1024);
    g.fillStyle = h.colors[1]; g.fillRect(6, 0, 10, 1024); g.fillRect(112, 0, 10, 1024);
    g.globalAlpha = 0.55;
    for (let y = 20; y < 1024; y += 48) { g.beginPath(); g.moveTo(64, y); g.lineTo(84, y + 18); g.lineTo(64, y + 36); g.lineTo(44, y + 18); g.closePath(); g.fill(); }
    // Wear: a darker, rubbed middle.
    g.globalAlpha = 0.15; g.fillStyle = '#000';
    for (let i = 0; i < 400; i++) g.fillRect(30 + Math.random() * 68, Math.random() * 1024, 2, 6);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }, [h]);
  if (r.hall === 'ice' || r.hall === 'lodge') return null;
  const len = r.d - 12;
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.07, 4]} receiveShadow>
      <planeGeometry args={[4.6, len]} />
      <meshStandardMaterial map={tex} roughness={0.95} />
    </mesh>
  );
}

/** House banners hanging down the long walls, and a great one behind the lord's chair. */
function Banners({ room: r }: { room: Room }) {
  const h = HOUSES[r.house];
  const tex = useMemo(() => sigilTexture(h.id, 'banner'), [h.id]);
  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1, 4, 10).translate(0, -0.5, 0), []);
  const ref = useRef<THREE.Group>(null);
  const spots = useMemo(() => {
    const out: [number, number, number, number, number][] = []; // x, y, z, ry, scale
    for (let z = -r.d / 2 + 19; z < r.d / 2 - 8; z += 22) for (const s of [-1, 1]) if (Math.abs(z + 5.5) > 6 || s < 0) out.push([s * (r.w / 2 - 0.25), r.h - 3.6, z, s < 0 ? Math.PI / 2 : -Math.PI / 2, 1]);
    out.push([0, r.h - 2.2, -r.d / 2 + 0.2, 0, 2.1]);
    return out;
  }, [r]);
  useFrame(({ clock }) => {
    const g = ref.current; if (!g) return;
    g.children.forEach((m, i) => { m.rotation.x = Math.sin(clock.elapsedTime * 0.7 + i) * 0.015; });
  });
  return (
    <group ref={ref}>
      {spots.map(([x, y, z, ry, s], i) => (
        <mesh key={i} geometry={geo} position={[x, y, z]} rotation-y={ry} scale={[3.4 * s, 7.4 * s, 1]} castShadow>
          <meshStandardMaterial map={tex} side={THREE.DoubleSide} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/** Daylight beyond each window and the door: bright panes the bloom catches, so the openings read as outside. */
function Panes({ room: r, ops }: { room: Room; ops: Opening[] }) {
  const sky = useMemo(() => {
    const c = document.createElement('canvas'); c.width = 4; c.height = 64;
    const g = c.getContext('2d')!, gr = g.createLinearGradient(0, 0, 0, 64);
    const sea = r.hall === 'aerie' || r.hall === 'harbour';
    gr.addColorStop(0, '#cfe0ef'); gr.addColorStop(0.6, '#f4ead6'); gr.addColorStop(sea ? 0.62 : 1, sea ? '#8fb3c7' : '#e9dcbc'); gr.addColorStop(1, sea ? '#5f8aa3' : '#d7c79f');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }, [r.hall]);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ map: sky, toneMapped: false, color: new THREE.Color(1.25, 1.2, 1.1) }), [sky]);
  const door = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.0, 1.7), toneMapped: false }), []);
  return (
    <group>
      {ops.map((o, i) => {
        const y = (o.y0 + o.y1) / 2, hgt = o.y1 - o.y0 + 0.2;
        if (o.wall === 's') return <mesh key={i} material={mat} position={[o.at, y, r.d / 2 + T + 0.6]} rotation-y={Math.PI}><planeGeometry args={[o.width + 0.4, hgt]} /></mesh>;
        const x = o.wall === 'w' ? -r.w / 2 - T - 0.6 : r.w / 2 + T + 0.6;
        return <mesh key={i} material={mat} position={[x, y, o.at]} rotation-y={o.wall === 'w' ? Math.PI / 2 : -Math.PI / 2}><planeGeometry args={[o.width + 0.4, hgt * 1.15]} /></mesh>;
      })}
      <mesh material={door} position={[0, 5.2, r.d / 2 + T + 1]} rotation-y={Math.PI}><planeGeometry args={[7.4, 10.6]} /></mesh>
    </group>
  );
}

/** Shafts of sunlight from the windows on the sun's side, falling across the floor. Additive, faint at the floor end. */
function Shafts({ room: r, ops }: { room: Room; ops: Opening[] }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { time: { value: 0 }, c: { value: new THREE.Color('#ffd9a0') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float time; uniform vec3 c; varying vec3 vP;
      void main(){
        float along = clamp(vP.z + 0.5, 0.0, 1.0);
        float edge = smoothstep(0.5, 0.25, abs(vP.x)) * smoothstep(0.5, 0.25, abs(vP.y));
        float shimmer = 0.85 + 0.15 * sin(time * 0.6 + vP.x * 3.0);
        float a = edge * (1.0 - along * 0.7) * 0.16 * shimmer;
        gl_FragColor = vec4(c * a, a);
      }`,
  }), []);
  useFrame(({ clock }) => { mat.uniforms.time.value = clock.elapsedTime; });
  const dir = useMemo(() => SUN.clone().negate(), []);
  if (r.hall === 'cellar') return null;
  return (
    <group>
      {ops.filter((o) => o.wall === 'w' || o.wall === 's').map((o, i) => {
        const cx = o.wall === 'w' ? -r.w / 2 : o.at, cz = o.wall === 's' ? r.d / 2 : o.at;
        const cy = (o.y0 + o.y1) / 2;
        const len = cy / -dir.y + 2;
        const mid = new THREE.Vector3(cx, cy, cz).addScaledVector(dir, len / 2);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
        return (
          <mesh key={i} material={mat} position={mid} quaternion={q} scale={[o.width, o.y1 - o.y0, len]}>
            <boxGeometry args={[1, 1, 1]} />
          </mesh>
        );
      })}
    </group>
  );
}

/** Dust hanging in the air of the hall, catching the light. */
export function Dust({ room: r }: { room: Room }) {
  const { geo, mat } = useMemo(() => {
    const n = 500, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) p.set([(Math.random() - 0.5) * r.w, Math.random() * r.h * 0.8, (Math.random() - 0.5) * r.d], i * 3);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { time: { value: 0 } },
      vertexShader: `uniform float time; varying float vA;
        void main(){ vec3 q = position; q.x += sin(time * 0.13 + position.y) * 0.8; q.y += sin(time * 0.09 + position.x) * 0.6; q.z += cos(time * 0.11 + position.y * 0.7) * 0.8;
          vec4 mv = modelViewMatrix * vec4(q, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = 90.0 / -mv.z; vA = 0.35 + 0.35 * sin(time + position.z); }`,
      fragmentShader: 'varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(1.0, 0.9, 0.7) * vA * 0.25, vA * 0.25 * smoothstep(0.5, 0.0, d)); }',
    });
    return { geo, mat };
  }, [r]);
  useFrame(({ clock }) => { mat.uniforms.time.value = clock.elapsedTime; });
  return <points geometry={geo} material={mat} frustumCulled={false} />;
}

// Prop sizes in metres (props.json): x, height, depth.
const PROP: Record<string, [number, number, number]> = { barrel: [0.8, 0.9, 0.8], crate: [0.87, 0.84, 0.84], hay: [1.4, 0.84, 0.94] };
const prop = (k: string, x: number, z: number, ry = 0, s = 1, y = 0): Place => ({ x, y, z, ry, sx: PROP[k][0] * M * s, sy: PROP[k][1] * M * s, sz: PROP[k][2] * M * s });

/** Barrels, crates and sacks round the walls: the house's stores, a different heap for each kind of hall. */
function Dressing({ room: r }: { room: Room }) {
  const { barrels, crates, hay } = useMemo(() => {
    const rnd = rng(7 + r.house * 131);
    const barrels: Place[] = [], crates: Place[] = [], hay: Place[] = [];
    const W = r.w, D = r.d;
    // A heap by the door on each side, and by the hearth.
    for (const s of [-1, 1]) {
      const bx = s * (W / 2 - 3), bz = D / 2 - 5;
      barrels.push(prop('barrel', bx, bz, rnd() * 6), prop('barrel', bx - s * 1.6, bz + 0.4, rnd() * 6));
      crates.push(prop('crate', bx, bz - 2, rnd()), prop('crate', bx, bz - 2, rnd(), 0.9, 0.84 * M));
    }
    if (r.hall === 'cellar') {
      // Racks of casks the length of both walls, two high.
      for (let z = -D / 2 + 12; z < D / 2 - 9; z += 1.75) for (const s of [-1, 1]) for (const lvl of [0, 1]) if (rnd() < 0.82) barrels.push({ ...prop('barrel', s * (W / 2 - 2), z, 0, 1.15, lvl * 1.6), ry: Math.PI / 2 });
    }
    if (r.hall === 'forge' || r.hall === 'harbour') for (let i = 0; i < 10; i++) crates.push(prop('crate', -W / 2 + 3 + rnd() * 4, -D / 2 + 22 + rnd() * 18, rnd() * 3, 0.9 + rnd() * 0.3));
    if (r.hall === 'lodge' || r.hall === 'feast' || r.hall === 'marsh') for (let i = 0; i < 6; i++) hay.push(prop('hay', W / 2 - 4 - rnd() * 2, D / 2 - 14 - i * 2.2, rnd() * 0.4));
    return { barrels, crates, hay };
  }, [r]);
  return (
    <group>
      <Props name="props/barrel" items={barrels} />
      <Props name="props/crate" items={crates} />
      {hay.length > 0 && <Props name="props/hay" items={hay} />}
    </group>
  );
}

/** The people of the house: the lord by the chair, a guard either side of the door, and folk about the hall. */
function Folk({ room: r }: { room: Room }) {
  const h = HOUSES[r.house];
  return (
    <group>
      <Standing url={`/models/${h.lord}.glb`} kind="lord" name={`The lord of House ${h.name}`} theirs={h.seat} spots={[[2.6, -r.d / 2 + 6.2, 0.2, 0.75]]} scale={2.4} />
      <Standing url="/models/soldier.glb" kind="soldier" name={`A guard of House ${h.name}`} spots={[[-4.6, r.d / 2 - 3, Math.PI, 0], [4.6, r.d / 2 - 3, Math.PI, 0]]} />
      {r.folk.map((f, i) => (
        <Standing key={i} url={`/models/${f}.glb`} kind={f === 'soldier' ? 'soldier' : f === 'peasant-f' ? 'woman' : 'man'} spots={[FOLK_SPOTS(r)[i % 6]]} />
      ))}
    </group>
  );
}
const FOLK_SPOTS = (r: Room): [number, number, number, number][] => [
  [r.w / 2 - 6, 4.5, -Math.PI / 2 - 0.4, 0],           // warming by the hearth
  [-r.w / 2 + 9.5, -r.d / 2 + 16.5, 2.4, 0],            // by the war table
  [-6, r.d / 2 - 14, 0.6, 0],
  [6.5, -r.d / 2 + 18, -2.2, 0],
  [-r.w / 2 + 5, 8, 1.4, 0],
  [r.w / 2 - 6, -8, -1.8, 0],
];

/** Figures standing in place: posed from the walk clip's feet-together frame, breathing, turning to look at you. */
export function Standing({ url, kind, name, theirs, spots, scale = 2.2, tint }: { url: string; kind: string; name?: string; theirs?: string; spots: [number, number, number, number][]; scale?: number; tint?: string }) {
  const people = useCrowd(url, spots.length, scale, 1, kind, name, theirs);
  const objs = useMemo(() => people.map((p) => p.obj), [people]);
  const room = roomOf(usePlay().inside);
  // A tint over their clothes (the Wardens and scribes), so a shared figure reads as someone in particular.
  useEffect(() => {
    if (!tint) return;
    const t = new THREE.Color(tint);
    for (const o of objs) o.traverse((x) => {
      const m = x as THREE.Mesh;
      if (!m.isMesh || m.userData.tinted) return;
      m.userData.tinted = true;
      const one = (mt: THREE.Material) => { const c = (mt as THREE.MeshStandardMaterial).clone(); c.color?.lerp(t, 0.42); return c; };
      m.material = Array.isArray(m.material) ? m.material.map(one) : one(m.material);
    });
  }, [objs, tint]);
  useEffect(() => {
    people.forEach(({ obj, mixer }, i) => {
      const [x, z, ry, y] = spots[i];
      obj.position.set(room.x + x, y, room.z + z); obj.rotation.y = ry;
      mixer.setTime(0.02);
    });
  }, [people, spots, room]);
  useSolid(objs);
  const t = useRef(Math.random() * 10);
  useFrame((_, dt) => {
    t.current += dt;
    const now = performance.now() / 1000;
    people.forEach(({ obj, mixer }, i) => {
      unturn(obj);
      mixer.setTime(0.02);
      rest(obj);
      notice(obj, now, dt);
      obj.scale.y = scale * (1 + Math.sin(t.current * 1.7 + i) * 0.006);
    });
  });
  return <group>{objs.map((o, i) => <primitive key={i} object={o} />)}</group>;
}
