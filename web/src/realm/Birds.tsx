// Birds: ravens over the Rookery, crows over Emberfall and the Hippodrome, a kite over every seat, and pigeons
// pecking round the wells that burst up when you walk or drive at them, wheel about, and settle again once you
// have gone. One instanced mesh; the wings flap in the vertex shader.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ground } from './heights.ts';
import { CAPITAL, HIPPODROME, HOUSES } from './layout.ts';
import { ROOKERY, wellSpots } from './Market.tsx';
import { me, play } from './play.ts';
import { flutter } from './sound.ts';
import { wind } from './wind.ts';

/** A bird 1 unit across the wings, beak along +z. `aWing` is how far out along the wing a vertex sits (0 at the body). */
function birdGeo() {
  const P: number[] = [], W: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => { P.push(...a, ...b, ...c); for (const v of [a, b, c]) W.push(Math.abs(v[0]) * 2); };
  // Body and head, a little tail fan.
  tri([0, 0.035, 0.32], [-0.05, 0, 0.05], [0.05, 0, 0.05]);
  tri([-0.05, 0, 0.05], [0, 0.03, -0.24], [0.05, 0, 0.05]);
  tri([-0.05, 0, 0.05], [0, -0.03, -0.12], [0.05, 0, 0.05]);
  tri([0, 0.02, -0.2], [-0.09, 0, -0.38], [0.09, 0, -0.38]);
  // Wings: broad inner part and a swept tip on each side.
  for (const s of [-1, 1]) {
    tri([0.04 * s, 0, 0.12], [0.04 * s, 0, -0.1], [0.27 * s, 0, 0.06]);
    tri([0.04 * s, 0, -0.1], [0.27 * s, 0, -0.08], [0.27 * s, 0, 0.06]);
    tri([0.27 * s, 0, 0.06], [0.27 * s, 0, -0.08], [0.5 * s, 0, -0.14]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(W, 1));
  g.computeVertexNormals();
  return g;
}

function birdMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 0.8, side: THREE.DoubleSide, vertexColors: false });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.wTime = wind.time;
    sh.vertexShader = 'uniform float wTime;\nattribute float aWing;\nattribute float aFlap;\nattribute float aRate;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        // aFlap: 0 folded on the ground, 0..1 gliding with a held dihedral, above 1 flapping.
        float open = clamp(aFlap, 0.0, 1.0), beat = clamp(aFlap - 1.0, 0.0, 1.0);
        float ang = 0.18 + beat * sin(wTime * aRate + float(gl_InstanceID) * 1.7) * 0.85;
        float side = sign(position.x), r = abs(position.x);
        float folded = mix(0.16, 1.0, open);
        transformed.x = side * r * folded * cos(ang * open);
        transformed.y += r * sin(ang * open) * folded + (1.0 - open) * aWing * 0.05;
      }`);
  };
  m.customProgramCacheKey = () => 'bird';
  return m;
}

type Mode = 'soar' | 'ground' | 'up' | 'wheel' | 'home';
interface Bird {
  mode: Mode; x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number; pitch: number; bank: number;
  size: number; flap: number; rate: number; t: number;
  // soaring: a circle round (cx, cz) at height h; ground: a home spot and a flock id.
  cx: number; cz: number; r: number; h: number; speed: number; a: number; flock: number; hx: number; hz: number;
}

const SOARS: { at: [number, number]; n: number; h: number; r: number; size: number; speed: number }[] = [
  { at: [ROOKERY[0], ROOKERY[1]], n: 9, h: 34, r: 16, size: 1.9, speed: 9 },
  { at: [CAPITAL.pos[0] + 30, CAPITAL.pos[1] - 20], n: 6, h: 48, r: 34, size: 1.8, speed: 10 },
  { at: [HIPPODROME.pos[0], HIPPODROME.pos[1]], n: 5, h: 55, r: 42, size: 1.8, speed: 11 },
  ...HOUSES.map((h) => ({ at: [h.pos[0] + 20, h.pos[1] - 15] as [number, number], n: 1, h: 70, r: 38, size: 3.2, speed: 8 })),
];
const PER_WELL = 6;
const MAX = SOARS.reduce((s, f) => s + f.n, 0) + 18 * PER_WELL;

function blank(): Bird {
  return { mode: 'soar', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, bank: 0, size: 1, flap: 0.6, rate: 8, t: 0, cx: 0, cz: 0, r: 0, h: 0, speed: 0, a: 0, flock: -1, hx: 0, hz: 0 };
}

export function Birds() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { geo, mat, flap, rate } = useMemo(() => {
    const geo = birdGeo();
    const flap = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1), rate = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    flap.setUsage(THREE.DynamicDrawUsage); rate.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFlap', flap); geo.setAttribute('aRate', rate);
    return { geo, mat: birdMaterial(), flap, rate };
  }, []);
  const birds = useRef<Bird[]>([]);
  const flocks = useRef<{ x: number; z: number; scared: number }[]>([]);
  const built = useRef(false);

  const build = () => {
    const B: Bird[] = [];
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (const f of SOARS) for (let i = 0; i < f.n; i++) {
      const b = blank();
      Object.assign(b, { mode: 'soar', cx: f.at[0], cz: f.at[1], r: f.r * (0.7 + rnd() * 0.6), h: f.h + rnd() * 10, speed: f.speed * (0.85 + rnd() * 0.3), a: rnd() * 6.28, size: f.size * (0.9 + rnd() * 0.2), rate: 6 + rnd() * 2 });
      B.push(b);
    }
    const wells = wellSpots() ?? [];
    flocks.current = [];
    for (const [wx, wz] of wells.slice(0, 18)) {
      const id = flocks.current.length;
      flocks.current.push({ x: wx, z: wz, scared: 0 });
      for (let i = 0; i < PER_WELL; i++) {
        const b = blank(), a = rnd() * 6.28, d = 4 + rnd() * 4;
        Object.assign(b, { mode: 'ground', flock: id, hx: wx + Math.cos(a) * d, hz: wz + Math.sin(a) * d, size: 0.9 + rnd() * 0.2, rate: 15 + rnd() * 4, yaw: rnd() * 6.28, t: rnd() * 3 });
        b.x = b.hx; b.z = b.hz; b.y = ground(b.x, b.z);
        B.push(b);
      }
    }
    birds.current = B;
    built.current = wells.length > 0;
  };

  const o = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }, rawDt) => {
    const m = ref.current;
    if (!m) return;
    if (!built.current && (birds.current.length === 0 || wellSpots())) build();
    const dt = Math.min(rawDt, 0.05), t = clock.elapsedTime;
    // What frightens pigeons: you on foot within 8, the chariot within 16.
    const fx = play.driving ? me.car.x : me.x, fz = play.driving ? me.car.z : me.z, fear = play.mode !== 'play' ? -1 : play.driving ? 16 : 8;
    for (const [id, f] of flocks.current.entries()) {
      const d = Math.hypot(f.x - fx, f.z - fz);
      if (d < fear + 4 && f.scared <= 0) {
        f.scared = 1;
        if (d < 60) flutter(10 + PER_WELL, Math.max(0.2, 1 - d / 40));
        for (const b of birds.current) if (b.flock === id && b.mode === 'ground') {
          const ax = b.x - fx, az = b.z - fz, al = Math.hypot(ax, az) || 1;
          b.mode = 'up'; b.t = Math.random() * 0.25;
          b.vx = (ax / al) * 7 + (Math.random() - 0.5) * 4; b.vz = (az / al) * 7 + (Math.random() - 0.5) * 4; b.vy = 8 + Math.random() * 4;
        }
      }
      // They come back once you have moved off and things have been quiet a while.
      if (f.scared > 0) { f.scared += dt; if (d < fear + 10) f.scared = Math.min(f.scared, 2); }
    }

    birds.current.forEach((b, i) => {
      if (b.mode === 'soar') {
        b.a += (b.speed / b.r) * dt;
        const px = b.x, pz = b.z;
        b.x = b.cx + Math.cos(b.a) * b.r; b.z = b.cz + Math.sin(b.a) * b.r;
        b.y = ground(b.cx, b.cz) + b.h + Math.sin(t * 0.3 + i) * 3;
        b.yaw = Math.atan2(b.x - px, b.z - pz); b.bank = -0.45; b.pitch = 0;
        // Glide, with a few beats now and then.
        b.flap = Math.sin(t * 0.37 + i * 2.1) > 0.75 ? 2 : 0.85;
      } else if (b.mode === 'ground') {
        b.t += dt;
        // Peck and shuffle: a hop to a nearby spot every few seconds.
        if (b.t > 2.5 + (i % 5) * 0.7) {
          b.t = 0; b.yaw += (Math.random() - 0.5) * 2.4;
          const nx = b.x + Math.sin(b.yaw) * 0.6, nz = b.z + Math.cos(b.yaw) * 0.6;
          if (Math.hypot(nx - b.hx, nz - b.hz) < 3) { b.x = nx; b.z = nz; }
        }
        const hop = b.t < 0.18 ? Math.sin((b.t / 0.18) * Math.PI) * 0.25 : 0;
        b.y = ground(b.x, b.z) + 0.12 + hop;
        b.pitch = Math.sin(t * 4 + i) > 0.6 ? 0.6 : 0; // head down to peck
        b.bank = 0; b.flap = 0;
      } else if (b.mode === 'up') {
        b.t -= dt;
        if (b.t > 0) { b.flap = 0; return place(b, i); }
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        b.vy = Math.max(2, b.vy - 3 * dt);
        b.yaw = Math.atan2(b.vx, b.vz); b.pitch = -0.5; b.bank = 0; b.flap = 2;
        if (b.y > ground(b.x, b.z) + 16) { b.mode = 'wheel'; b.cx = flocks.current[b.flock].x; b.cz = flocks.current[b.flock].z; b.r = 14 + (i % 4) * 3; b.a = Math.atan2(b.z - b.cz, b.x - b.cx); b.h = 18 + (i % 3) * 3; }
      } else if (b.mode === 'wheel') {
        b.a += (11 / b.r) * dt;
        const tx = b.cx + Math.cos(b.a) * b.r, tz = b.cz + Math.sin(b.a) * b.r, ty = ground(b.cx, b.cz) + b.h;
        const px = b.x, pz = b.z;
        b.x += (tx - b.x) * Math.min(1, dt * 2); b.z += (tz - b.z) * Math.min(1, dt * 2); b.y += (ty - b.y) * Math.min(1, dt * 1.5);
        b.yaw = Math.atan2(b.x - px, b.z - pz); b.bank = -0.4; b.pitch = 0; b.flap = Math.sin(t * 0.9 + i) > 0 ? 2 : 0.9;
        if (flocks.current[b.flock].scared > 9 + (i % 4)) b.mode = 'home';
      } else if (b.mode === 'home') {
        const gy = ground(b.hx, b.hz) + 0.12, dx = b.hx - b.x, dy = gy - b.y, dz = b.hz - b.z, d = Math.hypot(dx, dy, dz);
        const sp = Math.min(9, d * 1.5 + 1);
        b.x += (dx / d) * sp * dt; b.y += (dy / d) * sp * dt; b.z += (dz / d) * sp * dt;
        b.yaw = Math.atan2(dx, dz); b.pitch = 0.2; b.bank = 0; b.flap = d < 3 ? 2 : 0.9;
        if (d < 0.3) {
          b.mode = 'ground'; b.x = b.hx; b.z = b.hz; b.t = 0;
          if (birds.current.every((o2) => o2.flock !== b.flock || o2.mode === 'ground')) flocks.current[b.flock].scared = 0;
        }
      }
      place(b, i);
    });
    m.count = birds.current.length;
    m.instanceMatrix.needsUpdate = true; flap.needsUpdate = true; rate.needsUpdate = true;

    function place(b: Bird, i: number) {
      o.position.set(b.x, b.y, b.z);
      o.rotation.set(b.pitch, b.yaw, b.bank, 'YXZ');
      o.scale.setScalar(b.size);
      o.updateMatrix();
      m!.setMatrixAt(i, o.matrix);
      flap.setX(i, b.flap); rate.setX(i, b.rate);
    }
  });

  return <instancedMesh ref={ref} args={[geo, mat, MAX]} frustumCulled={false} />;
}
