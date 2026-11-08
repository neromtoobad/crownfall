// Real grass round your feet: a patch of blade clumps that travels with you, thick where the ground is grass,
// thinning to nothing on roads, sand, fields and floors, coloured from the terrain under it. The wind and your
// legs bend it (wind.ts). Only in play: from the map it would be invisible anyway.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ground } from './heights.ts';
import { roadDist } from './layout.ts';
import { solid } from './collide.ts';
import { groundAt } from './Terrain.tsx';
import { grassy } from './wind.ts';
import { me, usePlay } from './play.ts';

const N = 7;          // cells per side of the patch
const CELL = 8;       // world units per cell
const PER = 215;      // clumps per cell
const RADIUS = (N / 2) * CELL - 2;

/** One clump: five tapered blades, 1 unit tall, normals straight up so they light like the ground they grow from. */
function clumpGeo() {
  const pos: number[] = [], col: number[] = [], nor: number[] = [], idx: number[] = [];
  const SEG = 3;
  for (let b = 0; b < 5; b++) {
    const a = (b / 5) * Math.PI + b * 0.7, ca = Math.cos(a), sa = Math.sin(a);
    const ox = Math.cos(b * 2.4) * 0.16 * (b % 2 ? 1 : 0.5), oz = Math.sin(b * 2.4) * 0.16 * (b % 2 ? 1 : 0.5), h = 0.6 + ((b * 0.37) % 0.4), lean = 0.12 + (b % 3) * 0.06;
    const base = pos.length / 3;
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG, w = 0.026 * (1 - t * 0.9);
      const cx = ox + ca * lean * t * t, cz = oz + sa * lean * t * t;
      for (const side of [-1, 1]) {
        pos.push(cx - sa * w * side, t * h, cz + ca * w * side);
        nor.push(0, 1, 0);
        const k = 0.55 + t * 0.6; // dark at the root, sunlit tips
        col.push(k, k * 1.02, k * (0.9 + t * 0.05));
      }
    }
    for (let s = 0; s < SEG; s++) { const i = base + s * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function hash(a: number, b: number) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822519) + 0x9e3779b9 | 0; return ((h >>> 0) % 100000) / 100000; };
}

export function Grass() {
  const mode = usePlay().mode;
  return mode === 'play' ? <Patch /> : null;
}

function Patch() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(clumpGeo, []);
  const mat = useMemo(() => grassy(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), RADIUS), []);
  const slots = useRef<Int32Array>(new Int32Array(N * N * 2).fill(1 << 30));
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  // Instance colours must exist before the first draw, or the shader is built without them.
  useLayoutEffect(() => { const m = ref.current!; m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * N * PER * 3), 3); }, []);

  const fill = (slot: number, cx: number, cz: number) => {
    const m = ref.current!, rnd = hash(cx, cz), t = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color(), g = { grass: 0, dirt: 0, col: new THREE.Color() };
    // Whole cells far from any road skip the per-clump road test.
    const roadNear = roadDist((cx + 0.5) * CELL, (cz + 0.5) * CELL) < CELL * 0.75 + 7;
    for (let k = 0; k < PER; k++) {
      const i = slot * PER + k;
      const x = (cx + rnd()) * CELL, z = (cz + rnd()) * CELL, r1 = rnd(), r2 = rnd(), r3 = rnd();
      groundAt(x, z, g);
      let dens = THREE.MathUtils.smoothstep(g.grass, 0.35, 0.85);
      if (roadNear) dens *= THREE.MathUtils.smoothstep(roadDist(x, z), 3.4, 6.5);
      const y = ground(x, z);
      if (y < 2.4) dens = 0;
      if (dens > 0 && solid(x, z, 0.2)) dens = 0;
      // Sparse tufts where the grass gives out, a meadow where it doesn't.
      // Ankle to shin high (a person is ~3.3 units): 0.35 to 1.0 units.
      const h = r1 < dens ? (0.45 + r2 * 0.55) * (0.65 + dens * 0.35) : 0;
      t.compose(p.set(x, y - 0.05, z), q.setFromAxisAngle(up, r3 * 6.283), h > 0 ? s.set(0.8 + r2 * 0.5, h, 0.8 + r2 * 0.5) : s.set(0, 0, 0));
      m.setMatrixAt(i, t);
      // A touch lighter and yellower than the ground it grows from, each clump a little different.
      c.copy(g.col).multiplyScalar(1.05 + r3 * 0.25);
      c.g *= 1.03; c.r *= 1 + (r2 - 0.5) * 0.12;
      m.setColorAt(i, c);
    }
  };

  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const pcx = Math.floor(me.x / CELL), pcz = Math.floor(me.z / CELL), lo = (N - 1) / 2;
    let changed = false;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      // The world cell this slot should hold: the one in view whose index matches the slot modulo N.
      const cx = pcx - lo + ((((i - (pcx - lo)) % N) + N) % N), cz = pcz - lo + ((((j - (pcz - lo)) % N) + N) % N);
      const slot = j * N + i, sl = slots.current;
      if (sl[slot * 2] === cx && sl[slot * 2 + 1] === cz) continue;
      sl[slot * 2] = cx; sl[slot * 2 + 1] = cz;
      fill(slot, cx, cz);
      changed = true;
    }
    if (changed) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  });

  return <instancedMesh ref={ref} args={[geo, mat, N * N * PER]} receiveShadow frustumCulled={false} />;
}
