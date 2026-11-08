// Inside Qureshi's Library: a round reading room under the dome. Two tiers of bookcases run all the way round, with a
// gallery between them; the sun comes straight down through the oculus onto the dice table in the middle, where Haseeb
// Qureshi waits. The chronicle lies open on its lectern, and the two scribes, Claude and Codex, keep the Seal Book at
// their desk under the gallery and will tell you what to do next.
// Built in the room's own frame (x across, z toward the door, y up) and placed off the map at the room's origin.
import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';
import AVG from './texAvg.json';
import { triplanar } from './materials.ts';
import { addBox, addCircle } from './collide.ts';
import { FireLight, Flames, type FlameSpot } from './fire.tsx';
import { LIB_ROOM } from './rooms.ts';
import { gameDef } from '../games/host.ts';
import { Dust, Standing, block, masonry, merge, paint, rng } from './Hall.tsx';

type G = THREE.BufferGeometry;
export const LIB_R = 14.5;          // inner radius of the bookcases' backs
const H1 = 8, GAL = 8.4, H2 = 16.6, DOME0 = 17.2, SQUASH = 0.62;
const BAYS = 20, BW = (2 * Math.PI * LIB_R) / BAYS;
const DOOR_HALF = 0.2;              // the doorway's half-angle (radians) at θ = 0, toward +z
const OCULUS = 0.15;                // the dome's open eye, as a polar angle
const TOP_Y = DOME0 + LIB_R * Math.cos(OCULUS) * SQUASH;
/** Where the scribes' desk and the lectern stand (the places in places.ts sit at the same spots). */
const DESK_A = Math.atan2(9, -7.5), LECTERN: [number, number] = [-8.5, -8.5];

const polar = (a: number, r: number): [number, number] => [Math.sin(a) * r, Math.cos(a) * r];
/** A box in a bay's frame: u along the wall (tangent), v out from the centre, y up. */
function bayBox(th: number, u: number, v: number, y: number, w: number, h: number, d: number, color: string, jitter: number, r: () => number, out: G[], tilt = 0) {
  const tx = Math.cos(th), tz = -Math.sin(th), nx = Math.sin(th), nz = Math.cos(th);
  out.push(block(w, h, d, nx * v + tx * u, y, nz * v + tz * u, color, jitter, r, th, tilt));
}

const BOOK_COLOURS = ['#6b2a22', '#7a4a1f', '#2f4a3a', '#283c5a', '#5a3a5e', '#8a6a3a', '#3e2b1d', '#7a1f1f', '#4a5a2a', '#9a7a4a', '#2a2a3a', '#5e4632'];

function useShell() {
  return useMemo(() => {
    const rnd = rng(808);
    const stone: G[] = [], wood: G[] = [], dark: G[] = [], gold: G[] = [], cloth: G[] = [];
    const books: { m: THREE.Matrix4; c: THREE.Color }[] = [];
    const q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    const flames: FlameSpot[] = [], lights: [number, number, number, number][] = [];

    for (let i = 0; i < BAYS; i++) {
      const th = (i / BAYS) * Math.PI * 2;
      const door = i === 0;
      // The drum wall behind the cases, up to the dome.
      if (!door) bayBox(th, 0, LIB_R + 0.7, 0, BW + 0.15, DOME0, 1.4, LIB_ROOM.wall, 0.04, rnd, stone);
      else {
        // The doorway: piers either side, a lintel, and the wall above it.
        for (const s of [-1, 1]) bayBox(th, s * (BW / 2 - 0.55), LIB_R + 0.7, 0, 1.1, DOME0, 1.4, LIB_ROOM.wall, 0.04, rnd, stone);
        bayBox(th, 0, LIB_R + 0.7, 6.4, BW - 2.2, DOME0 - 6.4, 1.4, LIB_ROOM.wall, 0.04, rnd, stone);
        bayBox(th, 0, LIB_R - 0.2, 6.2, BW - 1.6, 0.7, 0.6, '#a39580', 0.03, rnd, stone); // the lintel
      }
      // Two tiers of cases (none in the doorway's lower tier).
      for (const [y0, y1, lower] of [[0, H1, true], [GAL + 0.35, H2, false]] as const) {
        if (door && lower) continue;
        for (const s of [-1, 1]) bayBox(th, s * (BW / 2 - 0.14), LIB_R - 0.45, y0, 0.28, y1 - y0, 0.95, LIB_ROOM.beam, 0.05, rnd, wood);
        bayBox(th, 0, LIB_R - 0.45, y1 - 0.25, BW, 0.25, 1.0, LIB_ROOM.beam, 0.05, rnd, wood); // the top
        bayBox(th, 0, LIB_R - 0.05, y0, BW, y1 - y0, 0.1, '#20150d', 0.02, rnd, dark); // the case's back
        const step = 1.22;
        for (let y = y0 + (lower ? 0.45 : 0.1); y < y1 - 0.9; y += step) {
          bayBox(th, 0, LIB_R - 0.45, y, BW - 0.3, 0.08, 0.9, LIB_ROOM.beam, 0.06, rnd, wood);
          // Books along the shelf: different widths and heights, a few leaning, a gap now and then.
          let u = -BW / 2 + 0.36;
          while (u < BW / 2 - 0.4) {
            const w = 0.1 + rnd() * 0.12, h = Math.min(step - 0.2, 0.62 + rnd() * 0.42), d = 0.5 + rnd() * 0.18;
            if (rnd() < 0.05) { u += 0.3 + rnd() * 0.4; continue; }
            const lean = rnd() < 0.06 ? (rnd() - 0.5) * 0.5 : 0;
            const tx = Math.cos(th), tz = -Math.sin(th), nx = Math.sin(th), nz = Math.cos(th), v = LIB_R - 0.5 - (0.7 - d) / 2;
            e.set(0, th, lean, 'YXZ'); q.setFromEuler(e);
            ps.set(nx * v + tx * (u + w / 2), y + 0.08 + h / 2, nz * v + tz * (u + w / 2)); sc.set(w, h, d);
            const c = new THREE.Color(BOOK_COLOURS[Math.floor(rnd() * BOOK_COLOURS.length)]).multiplyScalar(0.75 + rnd() * 0.45);
            books.push({ m: new THREE.Matrix4().compose(ps, q, sc), c });
            u += w + 0.01;
          }
        }
      }
      // The gallery: a deck on corbels between the tiers, and a rail.
      bayBox(th, 0, LIB_R - 1.75, GAL, BW + 0.05, 0.32, 2.5, LIB_ROOM.beam, 0.05, rnd, wood);
      bayBox(th, 0, LIB_R - 3.0, GAL + 1.05, BW + 0.05, 0.12, 0.16, '#c9a24a', 0.02, rnd, gold);
      for (const s of [-0.5, 0, 0.5]) bayBox(th, s * BW, LIB_R - 3.0, GAL + 0.32, 0.09, 0.75, 0.09, '#2a1d12', 0.04, rnd, dark);
      bayBox(th, 0, LIB_R - 1.2, GAL - 1.1, 0.4, 1.1, 1.5, LIB_ROOM.beam, 0.05, rnd, wood); // corbel
      // A carved stone cornice under the dome.
      bayBox(th, 0, LIB_R - 0.2, H2, BW + 0.3, 0.6, 1.4, '#a39580', 0.03, rnd, stone);
      bayBox(th, 0, LIB_R + 0.1, H2 + 0.6, BW + 0.3, 0.6, 1.0, '#8f826e', 0.03, rnd, stone);
    }

    // The dome, squashed a little, with gold ribs and the open eye.
    const dome = new THREE.SphereGeometry(LIB_R + 0.7, 56, 18, 0, Math.PI * 2, OCULUS, Math.PI / 2 - OCULUS);
    dome.scale(1, SQUASH, 1); dome.translate(0, DOME0, 0);
    stone.push(paint(dome, '#7c6e5c', 0.02, rnd));
    for (let i = 0; i < 16; i++) {
      const rib = new THREE.TorusGeometry(LIB_R + 0.45, 0.16, 6, 28, Math.PI / 2 - OCULUS);
      rib.rotateY((i / 16) * Math.PI * 2); rib.scale(1, SQUASH, 1); rib.translate(0, DOME0, 0);
      gold.push(paint(rib, '#b8913e', 0.04, rnd));
    }
    const eye = new THREE.TorusGeometry((LIB_R + 0.6) * Math.sin(OCULUS), 0.32, 8, 40).rotateX(Math.PI / 2).translate(0, TOP_Y, 0);
    gold.push(paint(eye, '#c9a24a', 0.02, rnd));

    // The lectern with the chronicle open on it, and a candle.
    {
      const [x, z] = LECTERN, ry = Math.atan2(-x, -z);
      wood.push(block(0.5, 1.6, 0.5, x, 0, z, LIB_ROOM.beam, 0.05, rnd, ry));
      wood.push(block(1.5, 0.12, 1.1, x, 1.6, z, LIB_ROOM.beam, 0.05, rnd, ry, 0));
      for (const s of [-1, 1]) cloth.push(paint(new THREE.BoxGeometry(0.68, 0.05, 0.92).rotateZ(s * 0.12).translate(s * 0.35, 1.78, 0).rotateY(ry).translate(x, 0, z), '#efe2c2', 0.03, rnd));
      flames.push([x + 0.9, 2.15, z + 0.2, 0.18]);
      lights.push([x, 3.2, z, 60]);
    }
    // The scribes' desk under the gallery, with inkpots and scrolls.
    {
      const [x, z] = polar(DESK_A, 12.0);
      wood.push(block(3.8, 1.55, 1.0, x, 0, z, LIB_ROOM.beam, 0.05, rnd, DESK_A));
      for (let k = 0; k < 5; k++) {
        const u = -1.5 + k * 0.75, [ox, oz] = [Math.cos(DESK_A) * u, -Math.sin(DESK_A) * u];
        if (k % 2) dark.push(paint(new THREE.CylinderGeometry(0.09, 0.11, 0.18, 8).translate(x + ox, 1.64, z + oz), '#141018', 0.02, rnd));
        else cloth.push(paint(new THREE.CylinderGeometry(0.1, 0.1, 0.7, 10).rotateZ(Math.PI / 2).rotateY(DESK_A + rnd() * 0.4).translate(x + ox, 1.66, z + oz), '#e8d9b4', 0.05, rnd));
      }
      flames.push([x, 2.05, z, 0.18]);
      lights.push([x, 3, z, 60]);
    }
    // Candle stands round the room (clear of the door, the lectern and the desk).
    for (const a of [1.15, 2.2, 3.3, 4.3, 5.25]) {
      const [x, z] = polar(a, 9.6);
      dark.push(paint(new THREE.CylinderGeometry(0.08, 0.3, 3.0, 8).translate(x, 1.5, z), '#1e1a16', 0.03, rnd));
      for (const s of [-1, 0, 1]) {
        const [ox, oz] = [Math.cos(a) * s * 0.35, -Math.sin(a) * s * 0.35];
        cloth.push(paint(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 6).translate(x + ox, 3.2 - Math.abs(s) * 0.15, z + oz), '#efe6cf', 0.03, rnd));
        flames.push([x + ox, 3.45 - Math.abs(s) * 0.15, z + oz, 0.2]);
      }
      lights.push([x, 4, z, 70]);
    }

    return { stone: merge(stone), wood: merge(wood), dark: merge(dark), gold: merge(gold), cloth: merge(cloth), books, flames, lights };
  }, []);
}

let registered = false;
function collide() {
  if (registered) return;
  registered = true;
  const X = LIB_ROOM.x, Z = LIB_ROOM.z;
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    if (Math.min(a, Math.PI * 2 - a) < DOOR_HALF) continue;
    const [x, z] = polar(a, LIB_R - 0.35);
    addCircle(X + x, Z + z, 0.95);
  }
  addBox(X, Z + LIB_R + 2.2, 7, 2, 0); // behind the doorway
  for (const s of [-1, 1]) { const [x, z] = polar(s * (DOOR_HALF + 0.05), LIB_R - 0.2); addCircle(X + x, Z + z, 1.1); }
  addCircle(X, Z, 2.15); // the dice table
  addCircle(X + LECTERN[0], Z + LECTERN[1], 0.8);
  { const [x, z] = polar(DESK_A, 12.0); addBox(X + x, Z + z, 3.8, 1.0, DESK_A); }
  for (const a of [1.15, 2.2, 3.3, 4.3, 5.25]) { const [x, z] = polar(a, 9.6); addCircle(X + x, Z + z, 0.4); }
}

/** The inlaid floor: a compass rose of the eight houses in brass and dark stone round the table. */
function inlayTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const g = c.getContext('2d')!, m = 512;
  g.clearRect(0, 0, 1024, 1024);
  g.strokeStyle = '#b8913e'; g.lineWidth = 10;
  for (const r of [500, 470, 300]) { g.beginPath(); g.arc(m, m, r, 0, Math.PI * 2); g.stroke(); }
  g.fillStyle = 'rgba(30, 22, 16, 0.55)';
  g.beginPath(); g.arc(m, m, 465, 0, Math.PI * 2); g.arc(m, m, 305, 0, Math.PI * 2, true); g.fill();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, long = i % 2 === 0, r1 = long ? 460 : 400;
    g.fillStyle = long ? '#c9a24a' : '#8a6a3a';
    g.beginPath(); g.moveTo(m + Math.cos(a) * r1, m + Math.sin(a) * r1);
    g.lineTo(m + Math.cos(a + 0.09) * 300, m + Math.sin(a + 0.09) * 300);
    g.lineTo(m + Math.cos(a - 0.09) * 300, m + Math.sin(a - 0.09) * 300); g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function Books({ list }: { list: { m: THREE.Matrix4; c: THREE.Color }[] }) {
  const mesh = useMemo(() => {
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((b, i) => { im.setMatrixAt(i, b.m); im.setColorAt(i, b.c); });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.receiveShadow = true; im.frustumCulled = false;
    return im;
  }, [list]);
  return <primitive object={mesh} />;
}

/** The sun straight down through the oculus: a soft column of light and a bright pool round the table. */
function Oculus() {
  const { shaft, pool, sky } = useMemo(() => {
    const shaft = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { time: { value: 0 } },
      vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: `uniform float time; varying vec2 vU;
        void main(){ float edge = sin(vU.x * 3.14159 * 6.0 + time * 0.2) * 0.15 + 0.85; float a = 0.11 * edge * smoothstep(0.0, 0.25, vU.y) * (0.6 + 0.4 * vU.y);
          gl_FragColor = vec4(vec3(1.0, 0.93, 0.78) * a, a); }`,
    });
    const pool = new THREE.MeshBasicMaterial({ color: '#fff1d0', transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending });
    const sky = new THREE.MeshBasicMaterial({ color: '#cfe1f5', fog: false });
    return { shaft, pool, sky };
  }, []);
  useFrame(({ clock }) => { shaft.uniforms.time.value = clock.elapsedTime; });
  const rEye = (LIB_R + 0.6) * Math.sin(OCULUS);
  return (
    <group>
      <mesh position={[0, TOP_Y + 0.6, 0]} rotation-x={Math.PI / 2} material={sky}><circleGeometry args={[rEye + 0.6, 32]} /></mesh>
      <mesh position={[0, TOP_Y / 2, 0]} material={shaft}><cylinderGeometry args={[rEye * 0.95, rEye * 1.25, TOP_Y, 32, 1, true]} /></mesh>
      <mesh position={[0, 0.035, 0]} rotation-x={-Math.PI / 2} material={pool}><circleGeometry args={[rEye * 1.35, 40]} /></mesh>
      <spotLight position={[0, TOP_Y, 0]} angle={0.2} penumbra={0.6} intensity={2400} distance={60} decay={1.3} color="#fff0d6" castShadow shadow-mapSize={[1024, 1024]} />
    </group>
  );
}

function Shell() {
  const [rock, bark] = useTexture(['/tex/rock.jpg', '/tex/bark.jpg']);
  const built = useShell();
  const inlay = useMemo(inlayTexture, []);
  const mats = useMemo(() => {
    for (const t of [rock, bark]) { t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.needsUpdate = true; }
    const A = AVG as Record<string, number[]>;
    const stone = masonry(triplanar(rock, A.rock, 0.45, '#ffffff', true, 0.7), 0.45);
    stone.side = THREE.DoubleSide;
    const wood = triplanar(bark, A.bark, 0.42, '#ffffff', true, 0.45);
    const floor = triplanar(rock, A.rock, 0.3, '#ffffff', true, 0.85); floor.roughness = 0.82;
    const plain = (rough: number, metal = 0) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal });
    return { stone, wood, floor, dark: plain(0.95), cloth: plain(0.9), gold: plain(0.32, 0.75) };
  }, [rock, bark]);
  collide();
  return (
    <group>
      <mesh geometry={built.stone} material={mats.stone} receiveShadow />
      <mesh geometry={built.wood} material={mats.wood} castShadow receiveShadow />
      <mesh geometry={built.dark} material={mats.dark} receiveShadow />
      <mesh geometry={built.gold} material={mats.gold} />
      <mesh geometry={built.cloth} material={mats.cloth} castShadow />
      <Books list={built.books} />
      <mesh rotation-x={-Math.PI / 2} material={mats.floor} receiveShadow><circleGeometry args={[LIB_R + 1.2, 72]} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.03} receiveShadow><circleGeometry args={[6.4, 72]} /><meshStandardMaterial map={inlay} transparent roughness={0.5} metalness={0.3} depthWrite={false} /></mesh>
      {/* Daylight beyond the doorway. */}
      <mesh position={[0, 3.1, LIB_R + 1.6]} rotation-y={Math.PI}><planeGeometry args={[3.4, 6.2]} /><meshBasicMaterial color="#f1dfbd" fog={false} side={THREE.DoubleSide} /></mesh>
      <pointLight position={[0, 3, LIB_R - 1]} color="#ffe6c0" intensity={90} distance={14} decay={1.6} />
      <Oculus />
      <Flames spots={built.flames} />
      {built.lights.map(([x, y, z, i], k) => <FireLight key={k} position={[x, y, z]} color={LIB_ROOM.fire} intensity={i} distance={22} />)}
      <Dust room={LIB_ROOM} />
    </group>
  );
}

const SCRIBES = (() => {
  const a = polar(DESK_A + 0.11, 13.1), b = polar(DESK_A - 0.11, 13.1), face = DESK_A + Math.PI;
  return { claude: [a[0], a[1], face, 0] as [number, number, number, number], codex: [b[0], b[1], face, 0] as [number, number, number, number] };
})();

/** Everything in the Library: the room, the dice table, Haseeb across it, the scribes at their desk. */
export function LibraryScene() {
  const r = LIB_ROOM, def = gameDef('dice');
  return (
    <>
      <group position={[r.x, 0, r.z]}>
        <Shell />
        {def && <def.Station room={r} />}
      </group>
      <Standing url="/models/peasant-m.glb" kind="lord" name="Haseeb Qureshi" theirs="the Library" spots={[[0, -3.15, 0, 0]]} scale={2.3} tint="#6a4a7a" />
      <Standing url="/models/peasant-f.glb" kind="woman" name="Claude, a scribe" theirs="the Library" spots={[SCRIBES.claude]} tint="#b5603f" />
      <Standing url="/models/peasant-m.glb" kind="man" name="Codex, a scribe" theirs="the Library" spots={[SCRIBES.codex]} tint="#33363d" />
    </>
  );
}
