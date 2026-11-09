// Town dressing made in Blender (design/blender/props.py → public/env/props/*.glb): market stalls round Mint
// Square and outside every house's walls, wells, carts and hay by the roads, signposts where roads leave a town,
// and the rookery tower. Plus loose crates and barrels that go flying when you run or drive into them.
import { THRONE } from './Throne.tsx';
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { surfaced } from './materials.ts';
import * as THREE from 'three';
import { walkY } from './bridges.ts';
import { addBox, addCircle, free, solid } from './collide.ts';
import { ground } from './heights.ts';
import { CAPITAL, HOUSES, LANDMARKS, ROADS, nearRoad, roadCurve } from './layout.ts';
import { me, play } from './play.ts';
import { Props, type Place } from './Props.tsx';
import { M } from './race.ts';
import { thud } from './sound.ts';

if (import.meta.hot) import.meta.hot.accept(() => location.reload()); // placements register collision once

// Sizes in metres from props.json (x, height, depth).
const SIZE: Record<string, [number, number, number]> = {
  stall: [3.1, 2.82, 2.0], barrel: [0.8, 0.9, 0.8], crate: [0.87, 0.84, 0.84], cart: [1.8, 1.22, 3.9],
  well: [2.5, 3.43, 2.2], rookery: [5.36, 17.84, 5.6], signpost: [2.4, 3.2, 0.27], hay: [1.4, 0.84, 0.94],
};
/** Where the rookery tower stands, east of the Ashen Throne's hall; the raven place sits at its door. */
export const ROOKERY: [number, number] = [84, -44];
const ROOK_SCALE = 1.25;

const KEEP_CLEAR: [number, number, number][] = [
  [7.2, 67.1, 7], // Odo's marker by the Mint
  [22, 50, 6], [25.5, 44.5, 9], // where you start, and your chariot
];

interface Loose { kind: 'crate' | 'barrel'; hx: number; hz: number; hry: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; rx: number; ry: number; rz: number; wx: number; wy: number; wz: number; moving: boolean; t: number }

function rng(seed: number) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

function layout() {
  const P: Record<string, Place[]> = { 'stall-red': [], 'stall-blue': [], 'stall-green': [], well: [], cart: [], hay: [], signpost: [], rookery: [] };
  const loose: Loose[] = [];
  const rnd = rng(4242);
  const clear = (x: number, z: number, r: number, road = 5) =>
    ground(x, z) > 2.4 && free(x, z, r) && !nearRoad(x, z, road) && !KEEP_CLEAR.some(([a, b, k]) => Math.hypot(x - a, z - b) < k + r);
  const put = (name: string, x: number, z: number, ry: number, k = 1) => {
    const s = SIZE[name.startsWith('stall') ? 'stall' : name];
    P[name].push({ x, y: ground(x, z) - 0.15, z, ry, sx: s[0] * M * k, sy: s[1] * M * k, sz: s[2] * M * k });
  };
  const stall = (x: number, z: number, ry: number) => {
    const s = SIZE.stall;
    put(['stall-red', 'stall-blue', 'stall-green'][Math.floor(rnd() * 3)], x, z, ry);
    addBox(x, z, s[0] * M * 0.95, s[2] * M * 0.95, ry);
  };
  const scatter = (x: number, z: number, n: number, spread: number) => {
    for (let i = 0, tries = 0; i < n && tries < n * 6; tries++) {
      const a = rnd() * Math.PI * 2, d = rnd() * spread, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (!clear(px, pz, 1.1, 3) || loose.some((l) => Math.hypot(l.hx - px, l.hz - pz) < 1.9)) continue;
      const kind = rnd() < 0.5 ? 'crate' : 'barrel', ry = rnd() * Math.PI;
      loose.push({ kind, hx: px, hz: pz, hry: ry, x: px, y: 0, z: pz, vx: 0, vy: 0, vz: 0, rx: 0, ry, rz: 0, wx: 0, wy: 0, wz: 0, moving: false, t: 0 });
      i++;
    }
  };

  // The rookery first, so nothing else takes its spot.
  {
    const [x, z] = ROOKERY, r = SIZE.rookery[0] * M * ROOK_SCALE / 2;
    put('rookery', x, z, Math.atan2(72 - x, -31 - z), ROOK_SCALE);
    addCircle(x, z, r * 0.95);
  }

  // Mint Square: a ring of stalls round the Mint, facing it, with crates and barrels between.
  {
    const [mx, mz] = LANDMARKS[4].pos;
    let n = 0;
    for (const R of [27, 31]) for (let i = 0; i < 26 && n < 12; i++) {
      const a = (i / 26) * Math.PI * 2 + R * 0.01, x = mx + Math.sin(a) * R, z = mz + Math.cos(a) * R;
      if (!clear(x, z, 3.6)) continue;
      stall(x, z, Math.atan2(mx - x, mz - z)); n++;
      scatter(x + Math.sin(a + 0.35) * R * 0.08, z + Math.cos(a + 0.35) * R * 0.08, 3, 3);
    }
    scatter(mx + 6, mz + 26, 6, 8);
  }

  // Every house: a market square with a well outside its walls, on the side facing the capital.
  for (const h of HOUSES) {
    const [hx, hz] = h.pos, d = Math.hypot(hx, hz) || 1, base = Math.atan2(-hx / d, -hz / d);
    for (const off of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4]) {
      const a = base + off, cx = hx + Math.sin(a) * 47, cz = hz + Math.cos(a) * 47;
      if (!clear(cx, cz, 9, 4)) continue;
      put('well', cx, cz, a); addCircle(cx, cz, SIZE.well[0] * M * 0.5);
      for (const k of [-1, 0, 1]) {
        const b = a + Math.PI / 2 * k + (k === 0 ? 0 : 0), sx = cx + Math.sin(b) * 9, sz = cz + Math.cos(b) * 9;
        if (clear(sx, sz, 3.4, 3)) stall(sx, sz, Math.atan2(cx - sx, cz - sz));
      }
      scatter(cx, cz, 6, 11);
      break;
    }
  }

  // Wells in the capital's lanes.
  {
    const [cx, cz] = CAPITAL.pos;
    let n = 0;
    for (let i = 0; i < 60 && n < 5; i++) {
      const a = rnd() * Math.PI * 2, r = 30 + rnd() * 60, x = cx + 20 + Math.cos(a) * r, z = cz + 10 + Math.sin(a) * r;
      if (!clear(x, z, 4.5, 6)) continue;
      put('well', x, z, rnd() * 6); addCircle(x, z, SIZE.well[0] * M * 0.5); n++;
      scatter(x, z, 2, 5);
    }
  }

  const byThrone = (x: number, z: number) => Math.hypot(x - THRONE.x, z - THRONE.z) < THRONE.r + 8;
  // Along the roads: a cart and some hay every so often, signposts where a road leaves its towns.
  for (const r of ROADS) {
    const c = roadCurve(r), len = c.getLength();
    for (let u = 60; u < len - 60; u += 110 + rnd() * 60) {
      const t = u / len, p = c.getPointAt(t), tan = c.getTangentAt(t), side = rnd() < 0.5 ? 1 : -1;
      const x = p.x + tan.z * 8 * side, z = p.z - tan.x * 8 * side;
      if (!clear(x, z, 3.6, 5) || byThrone(x, z)) continue;
      const ry = Math.atan2(tan.x, tan.z) + (rnd() - 0.5) * 0.4;
      put('cart', x, z, ry); addBox(x, z, SIZE.cart[0] * M * 0.9, SIZE.cart[2] * M * 0.9, ry);
      if (rnd() < 0.7) {
        const hx2 = x + tan.x * 7, hz2 = z + tan.z * 7;
        if (clear(hx2, hz2, 1.8, 5)) { put('hay', hx2, hz2, ry + 0.3); addBox(hx2, hz2, SIZE.hay[0] * M, SIZE.hay[2] * M, ry + 0.3); }
      }
    }
    for (const t of [0.06, 0.94]) {
      const p = c.getPointAt(t), tan = c.getTangentAt(t), x = p.x + tan.z * 5.5, z = p.z - tan.x * 5.5;
      if (!clear(x, z, 0.8, 4) || byThrone(x, z)) continue;
      put('signpost', x, z, Math.atan2(tan.x, tan.z) + Math.PI / 2); addCircle(x, z, 0.35);
    }
  }
  // Hay ricks round the farms of the wheatlands and the vineyard hills.
  for (const id of [1, 2, 3]) {
    const [hx, hz] = HOUSES[id].pos;
    for (let i = 0, n = 0; i < 40 && n < 7; i++) {
      const a = rnd() * Math.PI * 2, r = 80 + rnd() * 60, x = hx + Math.cos(a) * r, z = hz + Math.sin(a) * r;
      if (!clear(x, z, 2, 6)) continue;
      const ry = rnd() * 3;
      put('hay', x, z, ry); addBox(x, z, SIZE.hay[0] * M, SIZE.hay[2] * M, ry); n++;
    }
  }
  for (const l of loose) l.y = walkY(l.x, l.z);
  return { P, loose };
}

// Placed once, after the forest and the buildings have registered (so stalls never land in a tree or a house):
// an effect only runs once everything in the realm's Suspense boundary has committed.
let LAYOUT: ReturnType<typeof layout> | undefined;
/** Where the wells are, once the market is laid out (pigeons gather there). */
export const wellSpots = () => LAYOUT?.P.well.map((p) => [p.x, p.z] as [number, number]);
export function Market() {
  const [placed, setPlaced] = useState(LAYOUT);
  useEffect(() => {
    LAYOUT ??= layout(); setPlaced(LAYOUT);
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__market = LAYOUT;
  }, []);
  if (!placed) return null;
  const { P, loose } = placed;
  return (
    <Suspense fallback={null}><group>
      {Object.entries(P).map(([name, items]) => items.length > 0 && <Props key={name} name={`props/${name}`} items={items} />)}
      <LooseProps items={loose} kind="crate" />
      <LooseProps items={loose} kind="barrel" />
    </group></Suspense>
  );
}

// ---- Loose things: knocked about by whoever runs or drives into them. ----
const CAR_BODY: [number, number][] = [[0, 2.3], [4, 2.1], [8, 1.7]];
const GRAV = 24;
const q = new THREE.Quaternion(), e = new THREE.Euler(), mtx = new THREE.Matrix4(), v3 = new THREE.Vector3(), one = new THREE.Vector3();

function LooseProps({ items, kind }: { items: Loose[]; kind: 'crate' | 'barrel' }) {
  const mine = useMemo(() => items.filter((l) => l.kind === kind), [items, kind]);
  const gltf = useGLTF(`/env/props/${kind}.glb`);
  const s = SIZE[kind], half = (s[1] * M) / 2, rad = (Math.max(s[0], s[2]) * M) / 2;
  const { geo, mat } = useMemo(() => {
    let mesh: THREE.Mesh | undefined;
    gltf.scene.traverse((o) => { if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh; });
    const geo = mesh!.geometry.clone();
    geo.computeBoundingBox();
    const b = geo.boundingBox!, size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    // Centred on its middle (so it tumbles about it) and scaled to world size.
    geo.translate(-c.x, -c.y, -c.z).scale((s[0] * M) / size.x, (s[1] * M) / size.y, (s[2] * M) / size.z);
    const mat = (mesh!.material as THREE.MeshStandardMaterial).clone();
    mat.roughness = 0.9; mat.metalness = 0;
    surfaced(mat, geo, 1.4 / M);
    return { geo, mat };
  }, [gltf, s]);
  const ref = useRef<THREE.InstancedMesh>(null);
  const write = (i: number, l: Loose) => {
    q.setFromEuler(e.set(l.rx, l.ry, l.rz, 'YXZ'));
    mtx.compose(v3.set(l.x, l.y + half, l.z), q, one.set(1, 1, 1));
    ref.current!.setMatrixAt(i, mtx);
  };
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    mine.forEach((l, i) => write(i, l));
    m.count = mine.length; m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere();
  }, [mine]);

  useFrame(({ clock }, rawDt) => {
    const m = ref.current;
    if (!m || play.mode !== 'play') return;
    const dt = Math.min(0.05, rawDt), now = clock.elapsedTime;
    // Who's pushing: you on foot, or the three circles of your chariot.
    const bodies: [number, number, number, number, number][] = [];
    if (play.driving) {
      const c = me.car, hx = Math.sin(c.yaw), hz = Math.cos(c.yaw);
      for (const [off, r] of CAR_BODY) bodies.push([c.x + hx * off, c.z + hz * off, r, hx * c.v, hz * c.v]);
    } else if (!play.racing) bodies.push([me.x, me.z, 1, Math.sin(me.yaw) * me.speed, Math.cos(me.yaw) * me.speed]);
    let dirty = false;
    mine.forEach((l, i) => {
      const near = (l.x - me.x) ** 2 + (l.z - me.z) ** 2 < 900;
      if (near) for (const [bx, bz, br, bvx, bvz] of bodies) {
        const dx = l.x - bx, dz = l.z - bz, d = Math.hypot(dx, dz), min = br + rad;
        if (d >= min || l.y > walkY(l.x, l.z) + 2.5) continue;
        const nx = dx / (d || 1), nz = dz / (d || 1), sp = Math.hypot(bvx, bvz);
        l.x = bx + nx * min; l.z = bz + nz * min; // never inside you
        const hard = play.driving ? Math.max(sp, 3) : Math.max(sp * 0.7, 1.5);
        l.vx = nx * hard + bvx * 0.6; l.vz = nz * hard + bvz * 0.6;
        if (play.driving && sp > 8) { l.vy = 4 + sp * 0.35; l.wx = (Math.random() - 0.5) * sp; l.wz = (Math.random() - 0.5) * sp; l.wy = (Math.random() - 0.5) * 6; }
        else if (sp > 9) { l.vy = 3; l.wx = (Math.random() - 0.5) * 6; l.wz = (Math.random() - 0.5) * 6; }
        else l.wy = (Math.random() - 0.5) * 2;
        if (!l.moving || now - l.t > 0.25) thud(Math.min(1, sp / 20 + 0.2));
        l.moving = true; l.t = now;
      }
      if (!l.moving) {
        // Knocked-over things drift home when nobody is looking.
        if ((l.x !== l.hx || l.z !== l.hz) && !near && (l.x - me.x) ** 2 + (l.z - me.z) ** 2 > 200 * 200) {
          l.x = l.hx; l.z = l.hz; l.ry = l.hry; l.rx = l.rz = 0; l.y = walkY(l.x, l.z); write(i, l); dirty = true;
        }
        return;
      }
      l.vy -= GRAV * dt;
      let nx = l.x + l.vx * dt, nz = l.z + l.vz * dt;
      if (solid(nx, nz, rad * 0.8)) { l.vx *= -0.4; l.vz *= -0.4; nx = l.x; nz = l.z; }
      l.x = nx; l.z = nz; l.y += l.vy * dt;
      l.rx += l.wx * dt; l.ry += l.wy * dt; l.rz += l.wz * dt;
      const g = walkY(l.x, l.z);
      if (l.y <= g) {
        l.y = g;
        if (l.vy < -4) { l.vy *= -0.32; thud(Math.min(1, -l.vy / 10)); } else l.vy = 0;
        const f = Math.pow(0.04, dt); // ground friction
        l.vx *= f; l.vz *= f; l.wx *= f; l.wy *= f; l.wz *= f;
        // Settle on a face (a barrel can lie on its side).
        const snap = (a: number) => Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
        l.rx += (snap(l.rx) - l.rx) * Math.min(1, dt * 6); l.rz += (snap(l.rz) - l.rz) * Math.min(1, dt * 6);
        if (Math.hypot(l.vx, l.vz) < 0.2 && Math.abs(l.vy) < 0.1 && Math.abs(l.wy) < 0.2) { l.moving = false; l.rx = snap(l.rx); l.rz = snap(l.rz); }
      }
      write(i, l); dirty = true;
    });
    if (dirty) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); }
  });
  return <instancedMesh ref={ref} args={[geo, mat, Math.max(1, mine.length)]} castShadow receiveShadow frustumCulled={false} />;
}
