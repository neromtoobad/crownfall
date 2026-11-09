// Inside the hall of the Ashen Throne in Emberfall: a long stone nave, two rows of columns carrying pointed arches,
// tall windows down both sides letting the low sun in across a chequered floor, the eight houses' banners on the
// walls, a red runner lined with braziers from the door to the dais, and at the far end the empty throne itself,
// lit from behind by a great rose window. Built in the room's own frame (x across, z toward the door, y up) and placed
// off the map at the room's origin, like the keeps' halls and the Library.
import { useMemo } from 'react';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';
import AVG from './texAvg.json';
import { triplanar } from './materials.ts';
import { addBox, addCircle } from './collide.ts';
import { HOUSES } from './layout.ts';
import { FireLight, Flames, type FlameSpot } from './fire.tsx';
import { THRONE_HALL as R, THRONE_SEAT } from './rooms.ts';
import { Dust, Panes, Shafts, Standing, T, block, masonry, merge, paint, rng, wall, type Opening } from './Hall.tsx';
import { sigilTexture } from './sigils.ts';
import { THRONE_SIZE, ThroneModel } from './Throne.tsx';

type G = THREE.BufferGeometry;
/** The throne: its scale here, where its dais stands, where its stair ends. */
const THRONE_SCALE = THRONE_SEAT.scale, THRONE_Z = THRONE_SEAT.z, STAIR_Z = THRONE_SEAT.stair;
const COL_X = R.w / 2 - 9;                                        // the two rows of columns
const COLS = [-23, -9, 5, 19, 33];                               // their z, between the windows
const COL_TOP = R.h - 10;
const BRAZ = [-11, 5, 21, 37];                                   // braziers either side of the runner

/** Tall windows down both long walls and two beside the door; none in the end wall behind the throne. */
function openings(): Opening[] {
  const out: Opening[] = [];
  for (let z = -30; z < R.d / 2 - 6; z += 14) for (const w of ['w', 'e'] as const) out.push({ wall: w, at: z, width: 4.4, y0: 9, y1: 26 });
  for (const x of [-R.w / 4, R.w / 4]) out.push({ wall: 's', at: x, width: 4, y0: 13, y1: 27 });
  return out;
}

/** A pointed arch from u0 to u1 springing at y, rising `rise`: points along it (u, y). */
function pointed(u0: number, u1: number, y: number, rise: number, n = 12): [number, number][] {
  const w = u1 - u0, c = (u0 + u1) / 2, r = (w * w / 4 + rise * rise) / w, cx = w / 2 - r, a1 = Math.atan2(rise, -cx);
  const right: [number, number][] = [], left: [number, number][] = [];
  for (let i = 0; i <= n; i++) { const a = (a1 * i) / n; right.push([c + cx + r * Math.cos(a), y + r * Math.sin(a)]); }
  for (let i = n; i >= 0; i--) { const a = (a1 * i) / n; left.push([c - cx - r * Math.cos(a), y + r * Math.sin(a)]); }
  return [...left, ...right.reverse()];
}
/** A rib of stone along those points, across the hall (alongZ false) or down it (true), at `at`. */
function rib(pts: [number, number][], at: number, alongZ: boolean, thick: number, deep: number, color: string, rnd: () => number, out: G[]) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [u0, y0] = pts[i], [u1, y1] = pts[i + 1];
    const len = Math.hypot(u1 - u0, y1 - y0) + 0.08, ang = Math.atan2(y1 - y0, u1 - u0);
    const g = new THREE.BoxGeometry(len, thick, deep).rotateZ(ang);
    if (alongZ) g.rotateY(-Math.PI / 2);
    const mu = (u0 + u1) / 2, my = (y0 + y1) / 2;
    g.translate(alongZ ? at : mu, my, alongZ ? mu : at);
    out.push(paint(g, color, 0.04, rnd));
  }
}

let registered = false;
function collide() {
  if (registered) return;
  registered = true;
  const X = R.x, Z = R.z, W = R.w, D = R.d;
  addBox(X - W / 2 - T / 2, Z, T * 2, D + 4, 0);
  addBox(X + W / 2 + T / 2, Z, T * 2, D + 4, 0);
  addBox(X, Z - D / 2 - T / 2, W + 4, T * 2, 0);
  const half = (W - 7) / 2;
  addBox(X - 3.5 - half / 2, Z + D / 2 + T / 2, half, T * 2, 0);
  addBox(X + 3.5 + half / 2, Z + D / 2 + T / 2, half, T * 2, 0);
  addBox(X, Z + D / 2 + 4, 8, 2, 0);
  addCircle(X, Z + THRONE_Z, THRONE_SIZE.r * THRONE_SCALE);                              // the dais
  addBox(X, Z + (THRONE_Z + STAIR_Z) / 2, 4.6, STAIR_Z - THRONE_Z, 0);                    // and its stair
  for (const z of COLS) for (const s of [-1, 1]) addCircle(X + s * COL_X, Z + z, 1.8);
  for (const z of BRAZ) for (const s of [-1, 1]) addCircle(X + s * 5.5, Z + z, 0.9);
}

/** The great rose window behind the throne: sixteen petals of coloured glass in the houses' colours, led in black. */
function roseTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d')!, C = 256;
  g.fillStyle = '#120c08'; g.fillRect(0, 0, 512, 512);
  const glass = ['#b3261e', '#e0b23a', '#2f6aa8', '#2f8a3f', '#c07a2a', '#8a3a9e', '#e0442e', '#a9d3ee'];
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI * 2, a1 = ((i + 1) / 16) * Math.PI * 2;
    g.beginPath(); g.moveTo(C, C); g.arc(C, C, 246, a0, a1); g.closePath();
    g.fillStyle = glass[i % 8]; g.fill();
    g.beginPath(); g.moveTo(C, C); g.arc(C, C, 150, a0, a1); g.closePath();
    g.fillStyle = glass[(i + 3) % 8]; g.fill();
  }
  g.beginPath(); g.arc(C, C, 70, 0, Math.PI * 2); g.fillStyle = '#f2c35a'; g.fill();
  g.strokeStyle = '#120c08';
  for (const [r, w] of [[246, 10], [150, 7], [70, 7], [205, 4], [110, 4]] as const) { g.lineWidth = w; g.beginPath(); g.arc(C, C, r, 0, Math.PI * 2); g.stroke(); }
  g.lineWidth = 6;
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; g.beginPath(); g.moveTo(C + Math.cos(a) * 70, C + Math.sin(a) * 70); g.lineTo(C + Math.cos(a) * 246, C + Math.sin(a) * 246); g.stroke(); }
  // Cut the corners away so only the round window shows.
  g.globalCompositeOperation = 'destination-in'; g.beginPath(); g.arc(C, C, 251, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function useShell() {
  return useMemo(() => {
    const rnd = rng(4242);
    const stone: G[] = [], dark: G[] = [], floor: G[] = [], iron: G[] = [], cloth: G[] = [], gold: G[] = [];
    const W = R.w, D = R.d, H = R.h, ops = openings();
    // ---- Walls, with a plinth course and pilasters between the windows.
    wall(D, H, -W / 2 - T / 2, 0, false, ops.filter((o) => o.wall === 'w'), R.wall, rnd, stone);
    wall(D, H, W / 2 + T / 2, 0, false, ops.filter((o) => o.wall === 'e'), R.wall, rnd, stone);
    wall(W, H, 0, -D / 2 - T / 2, true, [], R.wall, rnd, stone);
    wall(W, H, 0, D / 2 + T / 2, true, [{ at: 0, width: 7, y0: 0, y1: 10.5 }, ...ops.filter((o) => o.wall === 's')], R.wall, rnd, stone);
    for (const s of [-1, 1]) {
      stone.push(block(0.6, 1.4, D, s * (W / 2 - 0.3), 0, 0, '#6d6458', 0.03, rnd));
      for (const z of COLS) stone.push(block(1.4, H, 1.6, s * (W / 2 - 0.6), 0, z, R.wall, 0.06, rnd));
    }
    for (const o of ops) {
      const across = o.wall === 's', sx = o.wall === 'w' ? -W / 2 : o.wall === 'e' ? W / 2 : o.at, sz = across ? D / 2 : o.at;
      stone.push(across ? block(o.width + 0.8, 0.4, T + 0.8, sx, o.y0 - 0.4, sz, '#8d8476', 0.03, rnd) : block(T + 0.8, 0.4, o.width + 0.8, sx, o.y0 - 0.4, sz, '#8d8476', 0.03, rnd));
      // Tracery: a mullion down the middle and two transoms.
      iron.push(across ? block(0.16, o.y1 - o.y0, 0.16, sx, o.y0, sz, '#1d1a18', 0, rnd) : block(0.16, o.y1 - o.y0, 0.16, sx, o.y0, sz, '#1d1a18', 0, rnd));
      for (const k of [0.36, 0.7]) { const y = o.y0 + (o.y1 - o.y0) * k; iron.push(across ? block(o.width, 0.16, 0.16, sx, y, sz, '#1d1a18', 0, rnd) : block(0.16, 0.16, o.width, sx, y, sz, '#1d1a18', 0, rnd)); }
    }
    // ---- A chequered floor of pale and dark flags.
    for (let i = 0, x = -W / 2; x < W / 2; x += 4, i++) for (let j = 0, z = -D / 2; z < D / 2; z += 4, j++) {
      floor.push(block(3.96, 0.25, 3.96, x + 2, -0.25, z + 2, (i + j) % 2 ? '#3c3631' : '#9a9184', 0.06, rnd));
    }
    floor.push(block(W, 0.2, D, 0, -0.27, 0, '#2a2522', 0.02, rnd));
    // ---- The ceiling, the columns and the arches they carry.
    dark.push(block(W + 2 * T, 0.8, D + 2 * T, 0, H, 0, '#5a4636', 0.04, rnd));
    for (let z = -D / 2 + 4; z < D / 2; z += 7) dark.push(block(W, 0.9, 0.7, 0, H - 0.9, z, '#3a2c22', 0.05, rnd)); // timbers
    for (const z of COLS) for (const s of [-1, 1]) {
      const x = s * COL_X;
      stone.push(block(3.2, 1.2, 3.2, x, 0, z, '#7c7468', 0.04, rnd));
      stone.push(paint(new THREE.CylinderGeometry(1.25, 1.35, COL_TOP - 2.4, 16).translate(x, 1.2 + (COL_TOP - 2.4) / 2, z), '#958b7d', 0.05, rnd));
      stone.push(block(3.4, 1.2, 3.4, x, COL_TOP - 1.2, z, '#8a8173', 0.04, rnd));
      gold.push(paint(new THREE.TorusGeometry(1.32, 0.12, 6, 24).rotateX(Math.PI / 2).translate(x, COL_TOP - 1.5, z), '#c9a24a', 0, rnd));
      // From the column to the wall, a half arch.
      rib(pointed(s < 0 ? -W / 2 : x, s < 0 ? x : W / 2, COL_TOP, 5), z, false, 1.0, 1.4, '#8a8173', rnd, stone);
    }
    for (const z of COLS) rib(pointed(-COL_X, COL_X, COL_TOP, H - COL_TOP - 1.2), z, false, 1.2, 1.6, '#8a8173', rnd, stone); // across the nave
    for (const s of [-1, 1]) for (let i = 0; i < COLS.length - 1; i++) rib(pointed(COLS[i], COLS[i + 1], COL_TOP, 4.5, 8), s * COL_X, true, 1.0, 1.4, '#8a8173', rnd, stone); // the arcade
    // ---- The runner from the door to the stair, with a gold border.
    const z0 = STAIR_Z + 0.4, z1 = D / 2 - 0.5, zl = z1 - z0, zm = (z0 + z1) / 2;
    cloth.push(block(5, 0.05, zl, 0, 0.0, zm, '#6a0f17', 0.02, rnd));
    for (const s of [-1, 1]) gold.push(block(0.3, 0.06, zl, s * 2.6, 0.0, zm, '#c9a24a', 0, rnd));
    // ---- Braziers along the runner, and torches on the pilasters.
    const flames: FlameSpot[] = [], lights: [number, number, number, number][] = [];
    for (const z of BRAZ) {
      for (const s of [-1, 1]) {
        const x = s * 5.5;
        iron.push(paint(new THREE.CylinderGeometry(0.2, 0.32, 2.4, 8).translate(x, 1.2, z), '#2a2522', 0, rnd));
        iron.push(paint(new THREE.CylinderGeometry(1.0, 0.4, 0.8, 12).translate(x, 2.8, z), '#2a2522', 0, rnd));
        gold.push(paint(new THREE.TorusGeometry(1.0, 0.07, 6, 20).rotateX(Math.PI / 2).translate(x, 3.2, z), '#c9a24a', 0, rnd));
        for (let i = 0; i < 3; i++) flames.push([x + (rnd() - 0.5) * 0.6, 3.1, z + (rnd() - 0.5) * 0.6, 0.7 + rnd() * 0.3]);
      }
      lights.push([0, 4.5, z, 260]);
    }
    for (const z of COLS) for (const s of [-1, 1]) {
      const tx = s * (W / 2 - 1.4);
      iron.push(block(0.2, 1, 0.2, tx, 7, z, '#2a2522', 0, rnd));
      flames.push([tx, 8.1, z, 0.85]);
    }
    // ---- Chandeliers down the nave: great iron rings of candles.
    for (const z of [-6, 12, 30]) {
      const y = H - 13;
      iron.push(paint(new THREE.TorusGeometry(3.4, 0.14, 6, 36).rotateX(Math.PI / 2).translate(0, y, z), '#1f1c1a', 0, rnd));
      iron.push(paint(new THREE.TorusGeometry(2.0, 0.1, 6, 28).rotateX(Math.PI / 2).translate(0, y + 1.2, z), '#1f1c1a', 0, rnd));
      iron.push(block(0.08, H - y, 0.08, 0, y, z, '#1f1c1a', 0, rnd));
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2, x = Math.cos(a) * 3.4, cz = z + Math.sin(a) * 3.4;
        cloth.push(paint(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 6).translate(x, y + 0.3, cz), '#efe6cf', 0, rnd));
        flames.push([x, y + 0.56, cz, 0.26]);
      }
      lights.push([0, y, z, 160]);
    }
    // ---- The rose window's stone frame.
    stone.push(paint(new THREE.TorusGeometry(7.4, 0.7, 10, 48).translate(0, 26, -D / 2 + 0.3), '#8a8173', 0.04, rnd));
    collide();
    return { stone: merge(stone), dark: merge(dark), floor: merge(floor), iron: merge(iron), cloth: merge(cloth), gold: merge(gold), ops, flames, lights };
  }, []);
}

/** The eight houses' banners down the walls, four a side. */
function HouseBanners() {
  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1, 4, 10).translate(0, -0.5, 0), []);
  const spots = useMemo(() => HOUSES.map((h, i) => {
    const s = i < 4 ? -1 : 1, z = [-16, -2, 12, 26][i % 4];
    return { h: h.id, x: s * (R.w / 2 - 0.3), z, ry: s < 0 ? Math.PI / 2 : -Math.PI / 2 };
  }), []);
  const texs = useMemo(() => HOUSES.map((h) => sigilTexture(h.id, 'banner')), []);
  return (
    <group>
      {spots.map((b) => (
        <mesh key={b.h} geometry={geo} position={[b.x, 30, b.z]} rotation-y={b.ry} scale={[4.6, 13, 1]}>
          <meshStandardMaterial map={texs[b.h]} side={THREE.DoubleSide} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function Shell() {
  const [rock] = useTexture(['/tex/rock.jpg']);
  const built = useShell();
  const rose = useMemo(() => roseTexture(), []);
  const mats = useMemo(() => {
    rock.wrapS = rock.wrapT = THREE.MirroredRepeatWrapping; rock.colorSpace = THREE.SRGBColorSpace; rock.anisotropy = 4; rock.needsUpdate = true;
    const A = AVG as Record<string, number[]>;
    const stone = masonry(triplanar(rock, A.rock, 0.45, '#ffffff', true, 0.7), 0.5);
    const floor = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.05 }); // polished flags
    const plain = (rough: number, metal = 0) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal });
    return { stone, floor, dark: plain(0.95), iron: plain(0.5, 0.6), cloth: plain(0.85), gold: plain(0.3, 0.8) };
  }, [rock]);
  return (
    <group>
      <mesh geometry={built.stone} material={mats.stone} castShadow receiveShadow />
      <mesh geometry={built.floor} material={mats.floor} receiveShadow />
      <mesh geometry={built.dark} material={mats.dark} receiveShadow />
      <mesh geometry={built.iron} material={mats.iron} castShadow />
      <mesh geometry={built.cloth} material={mats.cloth} receiveShadow />
      <mesh geometry={built.gold} material={mats.gold} />
      <mesh position={[0, 26, -R.d / 2 + 0.2]}>
        <circleGeometry args={[7.2, 64]} />
        <meshBasicMaterial map={rose} transparent toneMapped={false} color={new THREE.Color(1.7, 1.55, 1.4)} />
      </mesh>
      {/* The window's colour falling down the nave onto the throne. */}
      <spotLight position={[0, 27, -R.d / 2 + 2]} target-position={[0, 4, THRONE_Z + 6]} angle={0.6} penumbra={0.7} intensity={2600} distance={70} color="#ffcf9a" decay={1.5} />
      <HouseBanners />
      <Panes room={R} ops={built.ops} />
      <Shafts room={R} ops={built.ops} />
      <Dust room={R} />
      <Flames spots={built.flames} />
      {built.lights.map(([x, y, z, i], k) => <FireLight key={k} position={[x, y, z]} color={R.fire} intensity={i} distance={40} />)}
      <group position={[0, 0, THRONE_Z]}>
        <ThroneModel scale={THRONE_SCALE} glow={6} />
      </group>
    </group>
  );
}

/** Everything in the throne hall: the room, the throne, the guards at its foot and at the door. */
export function ThroneRoomScene() {
  return (
    <>
      <group position={[R.x, 0, R.z]}>
        <Shell />
      </group>
      <Standing url="/models/soldier.glb" kind="soldier" name="A guard of the Ashen Throne" spots={[[-6.5, STAIR_Z + 1.5, 0, 0], [6.5, STAIR_Z + 1.5, 0, 0], [-4.6, R.d / 2 - 3, Math.PI, 0], [4.6, R.d / 2 - 3, Math.PI, 0]]} />
    </>
  );
}
