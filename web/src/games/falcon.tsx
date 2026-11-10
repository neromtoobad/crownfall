// House Sorrel's game, from the aerie: Falconry. Cast the house hawk out through the west arch and over the sea cliffs,
// where the gulls wheel along the face and round the stacks. Bank with A/D, hold W or Space to fold the wings and
// stoop (a dive turns height into speed), S to climb back up. Strike a gull to take it. The gulls scatter when
// they see you coming, and grow warier with every one you take. Eight before the sun touches the sea (75 seconds) wins.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { audio, burst, flutter, noise, thud, voice } from '../realm/sound.ts';
import { FireLight, Flames } from '../realm/fire.tsx';
import type { Room } from '../realm/rooms.ts';
import { keys, TOUCH, usePlay } from '../realm/play.ts';
import { gameKeys, gameUi, register, session, type Result } from './host.ts';
import { DuskSky, Sea, Sparks, halo, useOutdoorAir } from './signals.tsx';
import './falcon.css';

const STATION: [number, number] = [0, -14]; // rooms.ts
const TIME = 75, WIN = 8, BEST = 13, GULLS = 14;
const SEA_Y = -40;

// ---- The coast: cliffs run north–south west of the aerie, the sea beyond them to the west.
const coast = (z: number) => -66 + 26 * Math.sin(z * 0.012) + 12 * Math.sin(z * 0.031 + 1) + 4 * Math.sin(z * 0.13);
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function topAt(x: number, z: number) {
  return 1.5 + 2 * Math.sin(x * 0.03) * Math.sin(z * 0.025) + 1 * Math.sin(z * 0.07 + x * 0.02) + 0.8 * Math.sin(x * 0.11 + z * 0.05);
}
/** Ground height (local frame), the cliffs stepping down in ledges to a rocky foot just under the water. */
export function heightAt(x: number, z: number) {
  const d = x - coast(z) + 2.5 * Math.sin(z * 0.21 + x * 0.05);
  const top = topAt(x, z) * smooth(-24, -60, x) + 1.5;
  if (d >= 0) return top;
  const FACE = 16;
  if (d > -FACE) {
    const u = (d + FACE) / FACE, k = u * 4, ledge = (Math.floor(k) + smooth(0.55, 1, k % 1)) / 4;
    return SEA_Y - 3 + (top - SEA_Y + 3) * (ledge * 0.75 + u * 0.25) + Math.sin(z * 0.4 + x) * 0.8;
  }
  return SEA_Y - 3 + (d + FACE) * 0.35;
}
const STACKS: [number, number, number, number][] = [ // x offset from the coast, z, radius, top y
  [-34, -210, 8, -6], [-52, -128, 10, 2], [-30, -52, 7, -12], [-62, 30, 11, 6], [-36, 104, 8, -4], [-58, 178, 9, -10], [-44, 250, 10, 0],
].map(([dx, z, r, y]) => [coast(z) + dx, z, r, y]);

// ---- The hawk: built from primitives, wings jointed at shoulder and wrist so they flap, and fold for the stoop.
const M = {
  back: new THREE.MeshStandardMaterial({ color: '#7a3a24', roughness: 0.75 }),
  under: new THREE.MeshStandardMaterial({ color: '#d9c39a', roughness: 0.8, side: THREE.BackSide }),
  dark: new THREE.MeshStandardMaterial({ color: '#2b1d16', roughness: 0.8, side: THREE.DoubleSide }),
  tail: new THREE.MeshStandardMaterial({ color: '#a8502c', roughness: 0.75, side: THREE.DoubleSide }),
  breast: new THREE.MeshStandardMaterial({ color: '#d8c4a0', roughness: 0.8 }),
  beak: new THREE.MeshStandardMaterial({ color: '#e5b733', roughness: 0.5 }),
  eye: new THREE.MeshStandardMaterial({ color: '#120c08', roughness: 0.2, metalness: 0.3 }),
};
function flat(pts: [number, number][]) {
  // An outline in the x–z plane (z forward), facing up.
  const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
}
const INNER = flat([[0, 0.34], [0.5, 0.36], [1.15, 0.3], [1.2, -0.3], [0.6, -0.5], [0, -0.55]]);
const OUTER = flat([[0, 0.3], [0.7, 0.22], [1.15, 0.05], [1.2, -0.2], [0.8, -0.38], [0, -0.3]]);
const PRIMARY = flat([[0, 0.07], [0.75, 0.04], [0.85, 0], [0.75, -0.05], [0, -0.06]]);
const TAILF = flat([[-0.08, 0], [0.08, 0], [0.13, -0.95], [0, -1.02], [-0.13, -0.95]]);

export interface HawkRig { root: THREE.Group; sh: THREE.Group[]; el: THREE.Group[]; tail: THREE.Group; head: THREE.Group }
export function buildHawk(): HawkRig {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), M.back); body.scale.set(1, 0.85, 2.1); root.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.33, 14, 10), M.breast); belly.scale.set(0.92, 0.8, 1.8); belly.position.set(0, -0.06, 0.08); root.add(belly);
  const head = new THREE.Group(); head.position.set(0, 0.12, 0.72); root.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), M.back); skull.scale.set(1, 0.95, 1.15); head.add(skull);
  const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 8), M.breast); cheek.position.set(0, -0.07, 0.06); head.add(cheek);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.26, 8).rotateX(Math.PI / 2), M.beak); beak.position.set(0, -0.02, 0.27); beak.rotation.x = 0.35; head.add(beak);
  const hook = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 4), M.dark); hook.position.set(0, -0.08, 0.36); head.add(hook);
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), M.eye); e.position.set(s * 0.15, 0.05, 0.12); head.add(e);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.014, 5, 10), M.beak); ring.position.set(s * 0.155, 0.05, 0.12); ring.rotation.y = s * Math.PI / 2; head.add(ring);
  }
  const tail = new THREE.Group(); tail.position.set(0, 0.02, -0.62); root.add(tail);
  for (let k = -2; k <= 2; k++) { const f = new THREE.Mesh(TAILF, k % 2 ? M.tail : M.back); f.rotation.y = k * 0.16; f.position.y = Math.abs(k) * -0.005; tail.add(f); }
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.012, 0.06), M.dark); band.position.set(0, 0.012, -0.8); tail.add(band);
  const sh: THREE.Group[] = [], el: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Group(); shoulder.position.set(s * 0.22, 0.12, 0.18); shoulder.scale.x = s; root.add(shoulder);
    shoulder.add(new THREE.Mesh(INNER, M.back)); const ui = new THREE.Mesh(INNER, M.under); ui.position.y = -0.012; shoulder.add(ui);
    const elbow = new THREE.Group(); elbow.position.set(1.15, 0, -0.02); shoulder.add(elbow);
    elbow.add(new THREE.Mesh(OUTER, M.back)); const uo = new THREE.Mesh(OUTER, M.under); uo.position.y = -0.012; elbow.add(uo);
    for (let k = 0; k < 5; k++) { const p = new THREE.Mesh(PRIMARY, M.dark); p.position.set(1.0, 0.004 * k, 0.02 - k * 0.11); p.rotation.y = -k * 0.2 + 0.1; elbow.add(p); }
    sh.push(shoulder); el.push(elbow);
  }
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return { root, sh, el, tail, head };
}
/** Pose the wings: flap 0..2π, amp, and fold 0 (spread) .. 1 (tucked back for the stoop). */
function pose(h: HawkRig, flap: number, amp: number, fold: number) {
  for (let i = 0; i < 2; i++) {
    h.sh[i].rotation.set(0, -fold * 1.05, Math.sin(flap) * amp + 0.06 - fold * 0.15);
    h.el[i].rotation.set(0, -fold * 1.6 + 0.04, Math.sin(flap - 0.7) * amp * 0.7);
    h.sh[i].scale.z = 1 - fold * 0.15;
  }
  h.tail.scale.set(1 - fold * 0.5, 1, 1);
}

// ---- Gulls: white bodies, grey wings with black tips, a yellow bill.
const GM = {
  white: new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.7 }),
  grey: new THREE.MeshStandardMaterial({ color: '#a9b0b8', roughness: 0.75, side: THREE.DoubleSide }),
  tip: new THREE.MeshStandardMaterial({ color: '#1b1b1d', roughness: 0.8, side: THREE.DoubleSide }),
  bill: new THREE.MeshStandardMaterial({ color: '#efc23a', roughness: 0.5 }),
};
const GWING = flat([[0, 0.2], [0.8, 0.16], [1.5, 0.02], [1.6, -0.1], [0.9, -0.2], [0, -0.26]]);
const GTIP = flat([[0, 0.1], [0.4, 0.02], [0.45, -0.06], [0, -0.12]]);
interface Gull {
  g: THREE.Group; w: THREE.Group[]; mark: THREE.Sprite;
  home: THREE.Vector3; r: number; ang: number; spin: number; pos: THREE.Vector3; vel: THREE.Vector3; flap: number; alive: boolean; wait: number; scared: number; grow: number;
}
function buildGull(): Gull {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), GM.white); b.scale.set(0.9, 0.85, 2.2); g.add(b);
  const hd = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), GM.white); hd.position.set(0, 0.12, 0.62); g.add(hd);
  const bl = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.24, 6).rotateX(Math.PI / 2), GM.bill); bl.position.set(0, 0.08, 0.86); g.add(bl);
  const tl = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 4).rotateX(-Math.PI / 2), GM.white); tl.scale.y = 0.3; tl.position.set(0, 0.02, -0.75); g.add(tl);
  const w: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * 0.18, 0.1, 0.1); sh.scale.x = s; g.add(sh);
    sh.add(new THREE.Mesh(GWING, GM.grey));
    const t = new THREE.Mesh(GTIP, GM.tip); t.position.set(1.35, 0.005, -0.02); sh.add(t);
    w.push(sh);
  }
  g.scale.setScalar(1.25);
  // A faint glint above each gull so they read against the sea from far off.
  const mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo(), color: '#fff6e0', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  mark.scale.setScalar(3.2);
  return { g, w, mark, home: new THREE.Vector3(), r: 10, ang: 0, spin: 0.6, pos: new THREE.Vector3(), vel: new THREE.Vector3(), flap: Math.random() * 6, alive: true, wait: 0, scared: 0, grow: 0 };
}
function placeGull(gl: Gull, avoid?: THREE.Vector3) {
  for (let tries = 0; tries < 12; tries++) {
    const z = -260 + Math.random() * 520;
    const nearStack = Math.random() < 0.4 ? STACKS[Math.floor(Math.random() * STACKS.length)] : undefined;
    if (nearStack) gl.home.set(nearStack[0], nearStack[3] + 4 + Math.random() * 18, nearStack[1]);
    else gl.home.set(coast(z) - 8 - Math.random() * 46, SEA_Y + 8 + Math.random() * 46, z);
    if (!avoid || gl.home.distanceTo(avoid) > 90) break;
  }
  gl.r = 7 + Math.random() * 14; gl.ang = Math.random() * Math.PI * 2; gl.spin = (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.3);
  gl.pos.set(gl.home.x + Math.cos(gl.ang) * gl.r, gl.home.y, gl.home.z + Math.sin(gl.ang) * gl.r);
  gl.vel.set(0, 0, 0); gl.alive = true; gl.g.visible = true; gl.mark.visible = true; gl.scared = 0;
  gl.grow = 0; gl.g.scale.setScalar(0.001); // a new gull swells in over a moment (see the flight loop); it used to blink into the sky
}

// ---- The terrain: one heightfield, coloured by slope and height (grass on top, banded rock, guano on the ledges).
function Coast() {
  const geo = useMemo(() => {
    const X0 = -470, X1 = -27, Z0 = -420, Z1 = 420, nx = 200, nz = 330;
    const g = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0, nx, nz).rotateX(-Math.PI / 2).translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
    const p = g.attributes.position as THREE.BufferAttribute, col = new Float32Array(p.count * 3);
    const grass = new THREE.Color('#6f7a43'), grass2 = new THREE.Color('#8b8a50'), rock = new THREE.Color('#8a7d6c'), rock2 = new THREE.Color('#665c52'), white = new THREE.Color('#e4dfd2'), wet = new THREE.Color('#3f3a35'), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), y = heightAt(x, z);
      p.setY(i, y);
      const e = 1.2, sl = Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
      if (sl < 0.55 && y > SEA_Y + 6) c.copy(grass).lerp(grass2, 0.5 + 0.5 * Math.sin(x * 0.07 + z * 0.05));
      else {
        c.copy(rock).lerp(rock2, 0.5 + 0.5 * Math.sin(y * 1.3 + Math.sin(z * 0.05) * 2));
        if (sl < 1.2 && y < 0 && y > SEA_Y + 3 && Math.sin(z * 0.9 + y) > 0.2) c.lerp(white, 0.55);
        if (y < SEA_Y + 2.5) c.lerp(wet, 0.7);
      }
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }, []);
  const stackGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.75, 1, 1, 9, 6).translate(0, 0.5, 0), p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + 0.18 * Math.sin(Math.atan2(z, x) * 3 + y * 7) + 0.1 * Math.sin(y * 13); p.setXYZ(i, x * k, y, z * k); }
    g.computeVertexNormals();
    return g;
  }, []);
  const scatter = useMemo(() => {
    const rocks: THREE.Matrix4[] = [], bushes: THREE.Matrix4[] = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 900 && (rocks.length < 70 || bushes.length < 140); i++) {
      const z = -400 + rnd() * 800, x = coast(z) + 3 + rnd() * (-30 - coast(z) - 3);
      if (x > -30) continue;
      const y = heightAt(x, z), k = rnd();
      q.setFromEuler(e.set(rnd() * 0.4, rnd() * 6.28, rnd() * 0.4));
      if (k < 0.35 && rocks.length < 70) { const sc = 0.6 + rnd() * 1.8; rocks.push(m.clone().compose(new THREE.Vector3(x, y + sc * 0.2, z), q, new THREE.Vector3(sc * 1.3, sc * 0.8, sc))); }
      else if (bushes.length < 140) { const sc = 0.7 + rnd() * 1.1; bushes.push(m.clone().compose(new THREE.Vector3(x, y + sc * 0.3, z), q, new THREE.Vector3(sc * 1.4, sc, sc * 1.2))); }
    }
    return { rocks, bushes };
  }, []);
  // Handed to the meshes as props, so nothing frees them when the round ends: the cliff alone is 66,000 points a round.
  useEffect(() => () => { geo.dispose(); stackGeo.dispose(); }, [geo, stackGeo]);
  const inst = (mats: THREE.Matrix4[]) => (r: THREE.InstancedMesh | null) => { if (r) { mats.forEach((mm, i) => r.setMatrixAt(i, mm)); r.instanceMatrix.needsUpdate = true; } };
  return (
    <group>
      <instancedMesh ref={inst(scatter.rocks)} args={[undefined, undefined, scatter.rocks.length]} castShadow><dodecahedronGeometry args={[1, 0]} /><meshStandardMaterial color="#8a8172" roughness={1} flatShading /></instancedMesh>
      <instancedMesh ref={inst(scatter.bushes)} args={[undefined, undefined, scatter.bushes.length]} castShadow><icosahedronGeometry args={[1, 0]} /><meshStandardMaterial color="#4e5a2c" roughness={1} flatShading /></instancedMesh>
      <mesh geometry={geo} receiveShadow><meshStandardMaterial vertexColors roughness={0.95} flatShading /></mesh>
      {STACKS.map(([x, z, r, top], i) => (
        <group key={i} position={[x, SEA_Y - 4, z]}>
          <mesh geometry={stackGeo} scale={[r, top - SEA_Y + 4, r]} rotation-y={i}><meshStandardMaterial color={i % 2 ? '#7c7064' : '#8a7e70'} roughness={1} flatShading /></mesh>
          <mesh position-y={top - SEA_Y + 4.1} rotation-x={-Math.PI / 2}><circleGeometry args={[r * 0.72, 9]} /><meshStandardMaterial color="#76804a" roughness={1} /></mesh>
          <mesh position-y={4.2} rotation-x={-Math.PI / 2}><ringGeometry args={[r * 1.05, r * 2.1, 24]} /><meshBasicMaterial map={halo()} color="#fff1dc" transparent opacity={0.35} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} /></mesh>
        </group>
      ))}
    </group>
  );
}
/** Surf along the foot of the cliffs. */
function Surf() {
  const geo = useMemo(() => {
    const pts: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let k = 0; k <= 160; k++) {
      const z = -420 + k * 5.25, x = coast(z) - 17.5;
      pts.push(x - 6, SEA_Y + 0.25, z, x + 3, SEA_Y + 0.25, z); uv.push(0, k * 0.3, 1, k * 0.3);
      if (k) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    return g;
  }, []);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, uniforms: { time: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float time; varying vec2 vUv; void main(){ float w = 0.5 + 0.5 * sin(vUv.y * 3.0 + time * 1.3) * sin(vUv.y * 1.1 - time * 0.7); float a = smoothstep(0.0, 0.5, vUv.x) * smoothstep(1.0, 0.75, vUv.x) * (0.25 + 0.5 * w); gl_FragColor = vec4(vec3(1.0, 0.97, 0.92), a * 0.8); }',
  }), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  useFrame(({ clock }) => { mat.uniforms.time.value = clock.elapsedTime; });
  return <mesh geometry={geo} material={mat} />;
}

// ---- Wind: filtered noise that rises with the hawk's speed.
function useWind() {
  const ref = useRef<{ g: GainNode; f: BiquadFilterNode; s: AudioBufferSourceNode } | null>(null);
  useEffect(() => {
    const a = audio(); if (!a) return;
    const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = noise(a); s.loop = true; f.type = 'bandpass'; f.Q.value = 0.7; f.frequency.value = 400; g.gain.value = 0;
    s.connect(f).connect(g).connect(a.destination); s.start();
    ref.current = { g, f, s };
    return () => { g.gain.setTargetAtTime(0, a.currentTime, 0.1); s.stop(a.currentTime + 0.5); ref.current = null; };
  }, []);
  return ref;
}
function kee(loud = 1) {
  const a = audio(); if (!a) return;
  for (const [when, f0] of [[0, 2300], [0.16, 2100]] as const) {
    const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + when;
    o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.62, t + 0.22);
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 3;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06 * loud, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    o.connect(bp).connect(g).connect(a.destination); o.start(t); o.stop(t + 0.26);
  }
}
function splash() { burst(500, 0.6, 0.35, 0.6, 0, 'lowpass'); burst(2200, 0.7, 0.12, 0.4, 0.03); }

// ---- In the aerie: a T-perch with the house hawk on it, and the falconer's table (glove, hood, lure, feathers).
const wood = new THREE.MeshStandardMaterial({ color: '#5a3b26', roughness: 0.8 });
const leather = new THREE.MeshStandardMaterial({ color: '#8b5a34', roughness: 0.7 });
function Station() {
  const [x, z] = STATION;
  const hawk = useMemo(() => { const h = buildHawk(); pose(h, 0, 0, 1); h.root.scale.setScalar(1.15); return h; }, []);
  const playing = usePlay().game && session.phase === 'play';
  const flames = useMemo(() => [[x - 6.2, 3.55, z + 2.2, 0.35]] as [number, number, number, number][], [x, z]);
  return (
    <group>
      {/* The perch: a square stone foot, an oak post, a crossbar wrapped in leather. */}
      <mesh position={[x, 0.3, z]} castShadow receiveShadow><boxGeometry args={[1.6, 0.6, 1.6]} /><meshStandardMaterial color="#6e655b" roughness={0.95} /></mesh>
      <mesh position={[x, 2.2, z]} material={wood} castShadow><cylinderGeometry args={[0.13, 0.17, 3.2, 8]} /></mesh>
      <mesh position={[x, 3.85, z]} rotation-z={Math.PI / 2} material={wood} castShadow><cylinderGeometry args={[0.11, 0.11, 2.6, 8]} /></mesh>
      {[-0.7, -0.35, 0, 0.35, 0.7].map((o) => <mesh key={o} position={[x + o, 3.85, z]} rotation-z={Math.PI / 2} material={leather}><torusGeometry args={[0.13, 0.035, 6, 10]} /></mesh>)}
      <group visible={!playing}><primitive object={hawk.root} position={[x, 4.45, z]} rotation={[-0.25, 0.35, 0]} /></group>
      {/* The jesses hanging from the bar. */}
      {[-0.12, 0.12].map((o) => <mesh key={o} position={[x + o, 3.35, z + 0.05]} material={leather}><boxGeometry args={[0.04, 0.9, 0.02]} /></mesh>)}
      {/* The falconer's table: glove, hood with its plume, a lure on a cord, feathers. */}
      <group position={[x - 5.4, 0, z + 1.4]}>
        <mesh position={[0, 1.45, 0]} material={wood} castShadow receiveShadow><boxGeometry args={[3.2, 0.14, 1.6]} /></mesh>
        {[-1, 1].map((sx) => [-1, 1].map((sz) => <mesh key={`${sx}${sz}`} position={[sx * 1.4, 0.7, sz * 0.62]} castShadow><boxGeometry args={[0.16, 1.4, 0.16]} /><meshStandardMaterial color="#3e2a1b" /></mesh>))}
        <group position={[-0.8, 1.6, 0.1]} rotation-y={0.4}>
          <mesh material={leather} scale={[1, 0.45, 1.5]}><sphereGeometry args={[0.28, 12, 8]} /></mesh>
          <mesh material={leather} position={[0, 0, -0.6]} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.2, 0.26, 0.7, 10]} /></mesh>
          {[0, 1, 2, 3].map((k) => <mesh key={k} material={leather} position={[-0.17 + k * 0.11, 0, 0.42]} rotation-x={Math.PI / 2}><capsuleGeometry args={[0.045, 0.2, 3, 6]} /></mesh>)}
        </group>
        <group position={[0.5, 1.68, -0.2]}>
          <mesh scale={[1, 0.8, 1.2]}><sphereGeometry args={[0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#6e2a1e" roughness={0.6} /></mesh>
          <mesh position={[0, 0.2, 0]}><coneGeometry args={[0.04, 0.3, 6]} /><meshStandardMaterial color="#c9a14a" /></mesh>
        </group>
        {[0, 1, 2].map((k) => <mesh key={k} position={[1.1 + k * 0.08, 1.53, 0.35 - k * 0.15]} rotation={[-Math.PI / 2, 0, 0.5 + k * 0.4]} material={M.tail}><planeGeometry args={[0.08, 0.6]} /></mesh>)}
        <mesh position={[0.9, 1.56, 0.45]} rotation-x={-Math.PI / 2}><torusGeometry args={[0.22, 0.02, 4, 18]} /><meshStandardMaterial color="#c4b494" /></mesh>
      </group>
      <mesh position={[x - 6.2, 3.1, z + 2.2]}><cylinderGeometry args={[0.12, 0.08, 0.9, 6]} /><meshStandardMaterial color="#3a2a1c" /></mesh>
      <Flames spots={flames} />
      <FireLight position={[x - 4, 5, z + 3]} color="#ffaa5e" intensity={180} distance={22} />
    </group>
  );
}

// ---- The flight.
const ui = gameUi({ caught: 0, left: TIME, line: 'Out through the arch…', speed: 0, phase: 'launch' as 'launch' | 'fly' | 'done', flash: 0 });
/** The marker the Play loop moves straight in the DOM (a ring on the nearest gull, or an arrow at the screen's edge). */
const marker: { el: HTMLDivElement | null } = { el: null };
const LAUNCH = new THREE.Vector3(-12, 9, -17); // the west arch nearest the perch (rooms.ts / Hall.tsx: arches at z = −17, −4, 9, 22)

function Play({ room, end }: { room: Room; end: (r: Result) => void }) {
  const camera = useThree((s) => s.camera);
  useOutdoorAir('#d99a6c', 220, 1300);
  const wind = useWind();
  const hawk = useMemo(() => { const h = buildHawk(); h.root.scale.setScalar(0.8); return h; }, []);
  const gulls = useMemo(() => Array.from({ length: GULLS }, () => { const g = buildGull(); placeGull(g); return g; }), []);
  const feathers = useMemo(() => new Sparks(500, 4, THREE.NormalBlending), []);
  const spray = useMemo(() => new Sparks(300, 26, THREE.NormalBlending), []);
  const streaks = useMemo(() => new Sparks(260, 0, THREE.AdditiveBlending), []);
  const st = useRef({
    t: 0, left: TIME, caught: 0, pos: LAUNCH.clone(), yaw: -Math.PI / 2, pitch: 0.05, roll: 0, v: 20, flap: 0, fold: 0, stun: 0, shake: 0, slow: 0,
    fov: 60, lastCatch: -10, placed: false, ended: false, flapCue: 0, punch: 0,
    armed: false, diving: false, spin: 0, dip: 0, streak: 0, sec: TIME, prev: LAUNCH.clone(),
  });
  useMemo(() => { ui.reset(); }, []);
  // The birds and the three clouds of points are built by hand and shown as they are, so they are freed by hand.
  // The wing and tail outlines and every material are shared with the hawk on the perch: those stay.
  useEffect(() => () => {
    const shared = new Set<THREE.BufferGeometry>([INNER, OUTER, PRIMARY, TAILF, GWING, GTIP]);
    const free = (o: THREE.Object3D) => o.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh && !shared.has(m.geometry)) m.geometry.dispose(); });
    free(hawk.root);
    for (const g of gulls) { free(g.g); g.mark.material.dispose(); }
    for (const p of [feathers, spray, streaks]) { p.geo.dispose(); (p.points.material as THREE.Material).dispose(); }
  }, [hawk, gulls, feathers, spray, streaks]);
  if (import.meta.env.DEV) Object.assign(window, { __fal: { st, gulls } });
  const fwd = useMemo(() => new THREE.Vector3(), []), tmp = useMemo(() => new THREE.Vector3(), []), camPos = useMemo(() => new THREE.Vector3(), []), look = useMemo(() => new THREE.Vector3(), []), lookNow = useMemo(() => new THREE.Vector3(), []);
  const white = useMemo(() => new THREE.Color('#f6f2ea'), []), rust = useMemo(() => new THREE.Color('#9a4a2a'), []), foam = useMemo(() => new THREE.Color('#eef0ec'), []), streakC = useMemo(() => new THREE.Color('#b8a99a'), []);
  const proj = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }, rawDt) => {
    const s = st.current, now = clock.elapsedTime;
    gameKeys();
    let dt = Math.min(rawDt, 0.05);
    if (s.slow > 0) { s.slow -= dt; dt *= 0.3; }
    s.t += dt;
    const flying = s.t > 1.2 && !s.ended;
    if (flying) s.left = Math.max(0, s.left - dt);
    // ---- Controls. She answers only once she is out through the arch (banked or stooped before that she went
    // through the wall or into the floor), and the Space that started the round has to come up before it means stoop.
    const space = keys.has(' ');
    if (!space) s.armed = true;
    const L = flying && (keys.has('a') || keys.has('arrowleft')), R = flying && (keys.has('d') || keys.has('arrowright'));
    const dive = flying && (keys.has('w') || keys.has('arrowup') || (space && s.armed)), climb = flying && (keys.has('s') || keys.has('arrowdown'));
    if (dive && !s.diving) burst(420, 0.7, 0.06, 0.3, 0, 'lowpass'); // the wings folding
    s.diving = dive;
    const ctl = s.stun > 0 ? 0.25 : 1;
    s.stun = Math.max(0, s.stun - dt);
    const wantRoll = s.ended ? 0.25 : ((R ? 1 : 0) - (L ? 1 : 0)) * 0.95 * ctl;
    s.roll += (wantRoll - s.roll) * (1 - Math.exp(-dt * 4));
    let wantPitch = dive ? -0.85 : climb ? 0.5 : -0.04;
    // Over the clifftop, a hawk that isn't stooping lifts clear of the grass by itself.
    const clear = s.pos.y - heightAt(s.pos.x, s.pos.z);
    if (!dive && clear < 6) wantPitch = Math.max(wantPitch, 0.35 * (1 - clear / 6));
    // Soft walls: too high, too far out to sea, or wandering inland: lean back toward the cliffs.
    const out = s.pos.x < -440 || s.pos.x > -30 || Math.abs(s.pos.z) > 360;
    if (s.pos.y > 70) wantPitch = Math.min(wantPitch, -0.25);
    s.pitch += (wantPitch * (s.ended ? 0 : 1) - s.pitch) * (1 - Math.exp(-dt * (dive ? 2.4 : 1.8))) * (s.stun > 0 ? 0.3 : 1);
    let yawRate = -s.roll * 1.35;
    if (out) {
      const want = Math.atan2(coast(s.pos.z) - 40 - s.pos.x, -s.pos.z * 0.6);
      let d = want - s.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      yawRate += d * 1.5;
    }
    s.yaw += yawRate * dt;
    // Speed: a stoop turns height into speed; a climb bleeds it; below stall the hawk flaps.
    const flapping = s.v < 17 || (climb && s.v < 26) || s.t < 1.4;
    s.v += (-30 * Math.sin(s.pitch) - 0.6 * (s.v - 22) + (flapping ? 9 : 0)) * dt;
    s.v = THREE.MathUtils.clamp(s.v, 11, 64);
    fwd.set(Math.sin(s.yaw) * Math.cos(s.pitch), Math.sin(s.pitch), Math.cos(s.yaw) * Math.cos(s.pitch));
    s.prev.copy(s.pos);
    s.pos.addScaledVector(fwd, s.v * dt);
    // A knock turns her flight at once, but her body and the eye behind her come round after it over half a second:
    // `spin` and `dip` are what is left of the old heading, and they drain away.
    s.spin *= Math.exp(-dt * 6); s.dip *= Math.exp(-dt * 6);
    // ---- Wings.
    s.fold += ((dive ? Math.min(1, (s.v - 18) / 20) : 0) - s.fold) * (1 - Math.exp(-dt * 6));
    const amp = flapping ? 0.75 : s.fold > 0.3 ? 0.04 : 0.1;
    s.flap += dt * (flapping ? 12 : 3);
    if (flapping && (s.flapCue -= dt) < 0) { s.flapCue = 0.52; flutter(3, 0.5); }
    pose(hawk, s.flap, amp, s.fold);
    hawk.root.position.copy(s.pos);
    hawk.root.rotation.set(-(s.pitch + s.dip), s.yaw + s.spin, s.roll, 'YXZ');
    hawk.head.rotation.set((s.pitch + s.dip) * 0.5, 0, -s.roll * 0.4);
    // ---- Hitting things.
    const ground = heightAt(s.pos.x, s.pos.z);
    let stack: (typeof STACKS)[number] | undefined;
    for (const sk of STACKS) if (Math.hypot(s.pos.x - sk[0], s.pos.z - sk[1]) < sk[2] * 1.05 + 0.8 && s.pos.y < sk[3] + 1) stack = sk;
    if (s.pos.y < SEA_Y + 0.7) {
      s.dip += s.pitch - 0.45;
      s.pos.y = SEA_Y + 0.8; s.pitch = 0.45; s.v *= 0.55; s.shake = 0.7; s.stun = 0.6;
      spray.emit(s.pos, 80, foam, 16, 0.7, 1.1, 1.2); splash();
      ui.set({ line: 'Into the sea! Pull up sooner.', flash: now });
    } else if (s.pos.y < ground + 1 || stack) {
      // Which way is clear of the rock: out from the middle of a stack, or down the slope from a cliff face.
      let cx = 0, cz = 0;
      if (stack && s.pos.y > stack[3] - 1.5) s.pos.y = stack[3] + 1.6; // down onto a stack's crown: she bounces up off it (she used to be thrown out to its rim)
      else if (stack) { tmp.set(s.pos.x - stack[0], 0, s.pos.z - stack[1]).setLength(stack[2] * 1.05 + 1.2); s.pos.set(stack[0] + tmp.x, s.pos.y, stack[1] + tmp.z); cx = tmp.x; cz = tmp.z; }
      else {
        const e = 1, nx = heightAt(s.pos.x - e, s.pos.z) - heightAt(s.pos.x + e, s.pos.z), nz = heightAt(s.pos.x, s.pos.z - e) - heightAt(s.pos.x, s.pos.z + e);
        if (Math.hypot(nx, nz) > 0.6) { s.pos.x += Math.sign(nx || -1) * 2.5; } // off a cliff face, out over the sea
        s.pos.y = Math.max(s.pos.y, heightAt(s.pos.x, s.pos.z) + 1.6);
        cx = nx; cz = nz;
      }
      // She comes off the rock heading mostly the clear way: three quarters of the turn from her heading to it.
      // (Turned by the side she happened to be banking, a glancing blow could throw her straight back at the face.)
      // On flat ground there is no clear way to prefer, and she breaks off to the side as before.
      let turn = Math.PI * 0.75 * (s.roll >= 0 ? 1 : -1);
      if (Math.hypot(cx, cz) > 0.3) { const d = Math.atan2(cx, cz) - s.yaw; turn = Math.atan2(Math.sin(d), Math.cos(d)) * 0.75; }
      s.spin -= turn; s.dip += s.pitch - 0.35;
      s.yaw += turn; s.pitch = 0.35; s.v *= 0.5; s.stun = 0.8; s.shake = 1;
      feathers.emit(s.pos, 30, rust, 7, 0.8, 0.45, 1.6); thud(1.2); burst(300, 0.8, 0.2, 0.3, 0, 'lowpass');
      ui.set({ line: 'Struck the rock! Feathers everywhere.', flash: now });
    }
    // ---- Gulls: wheel round their stations, scatter from the hawk, and get warier with every catch.
    const wary = 1 + s.caught * 0.09;
    let near: Gull | undefined, nd = Infinity;
    for (const g of gulls) {
      if (!g.alive) { if ((g.wait -= dt) <= 0) placeGull(g, s.pos); else continue; }
      if (g.grow < 1) { g.grow = Math.min(1, g.grow + dt * 2.2); const k = g.grow - 1; g.g.scale.setScalar(1.25 * Math.max(0.001, 1 + 2.7 * k * k * k + 1.7 * k * k)); }
      g.ang += g.spin * dt * 0.9 / (g.r / 10);
      tmp.set(g.home.x + Math.cos(g.ang) * g.r, g.home.y + Math.sin(g.ang * 2 + g.r) * 2, g.home.z + Math.sin(g.ang) * g.r);
      tmp.sub(g.pos).multiplyScalar(1.6);
      const d = g.pos.distanceTo(s.pos), see = 13 * wary;
      if (d < see) {
        g.scared = 1;
        const away = proj.copy(g.pos).sub(s.pos).setLength((see - d) / see * 34 * wary);
        away.y += (g.pos.y < s.pos.y ? -6 : 8) * wary;
        tmp.add(away);
        if (g.scared && Math.random() < dt * 2) burst(2600 + Math.random() * 800, 6, 0.025, 0.12);
      } else g.scared = Math.max(0, g.scared - dt);
      g.vel.lerp(tmp, 1 - Math.exp(-dt * 2.5));
      const max = 12 + 6 * g.scared * wary;
      if (g.vel.length() > max) g.vel.setLength(max);
      g.pos.addScaledVector(g.vel, dt);
      g.pos.y = Math.max(g.pos.y, Math.max(SEA_Y + 2.5, heightAt(g.pos.x, g.pos.z) + 2));
      g.flap += dt * (g.scared > 0.2 ? 16 : 7);
      const a = Math.sin(g.flap) * (g.scared > 0.2 ? 0.8 : 0.35 + 0.25 * Math.max(0, Math.sin(now * 0.7 + g.r)));
      g.w[0].rotation.z = a; g.w[1].rotation.z = a;
      g.g.position.copy(g.pos);
      if (g.vel.lengthSq() > 0.1) g.g.rotation.set(-Math.atan2(g.vel.y, Math.hypot(g.vel.x, g.vel.z)) * 0.6, Math.atan2(g.vel.x, g.vel.z), -g.spin * 0.5, 'YXZ');
      g.mark.position.copy(g.g.position); g.mark.position.y += 1.6;
      (g.mark.material as THREE.SpriteMaterial).opacity = THREE.MathUtils.clamp((d - 25) / 60, 0, 0.6) * g.grow;
      // The strike: anywhere along this frame's stretch of flight, not only where it ends, so a fast stoop on a
      // slow screen takes the same gulls as on a quick one.
      const sx = s.pos.x - s.prev.x, sy = s.pos.y - s.prev.y, sz = s.pos.z - s.prev.z, sl = sx * sx + sy * sy + sz * sz;
      const u = sl > 1e-6 ? THREE.MathUtils.clamp(((g.pos.x - s.prev.x) * sx + (g.pos.y - s.prev.y) * sy + (g.pos.z - s.prev.z) * sz) / sl, 0, 1) : 1;
      const reach = Math.hypot(s.prev.x + sx * u - g.pos.x, s.prev.y + sy * u - g.pos.y, s.prev.z + sz * u - g.pos.z);
      if (flying && reach < 2.6 + s.v * 0.05) {
        g.alive = false; g.g.visible = false; g.mark.visible = false; g.wait = 5 + Math.random() * 3;
        s.caught++; s.slow = 0.22; s.punch = 1; s.shake = Math.max(s.shake, 0.4);
        feathers.emit(g.pos, 70, white, 9, 0.9, 0.45, 2.2);
        kee(1); burst(900, 1.2, 0.3, 0.1); thud(0.6);
        const quick = s.t - s.lastCatch < 5; s.lastCatch = s.t;
        const left = WIN - s.caught;
        ui.set({ caught: s.caught, flash: now, line: quick ? 'Two in a breath! The aerie roars.' : left > 0 ? `Taken! ${left} more.` : left === 0 ? 'Eight! The house is yours. Keep hunting.' : `${s.caught} gulls. Greedy bird.` });
        if (quick || s.caught === WIN) voice('soldier', 10, 0, true);
        continue;
      }
      if (d < nd) { nd = d; near = g; }
    }
    // ---- Feathers, spray, speed streaks.
    // So many streaks a second for the speed, counted in time: counted per frame, a slow screen drew fewer.
    if (s.v > 34 && flying) s.streak += (s.v - 30) * 6 * dt;
    for (; s.streak >= 1; s.streak--) {
      const r = (Math.random() - 0.5) * 16, u = (Math.random() - 0.5) * 10;
      tmp.set(s.pos.x + fwd.x * 26 + Math.cos(s.yaw) * r, s.pos.y + fwd.y * 26 + u, s.pos.z + fwd.z * 26 - Math.sin(s.yaw) * r);
      streaks.emit(tmp, 1, streakC, 0.1, 0, 0.6, 0.7);
    }
    feathers.update(dt); spray.update(dt); streaks.update(dt);
    // ---- Wind in your ears.
    const w = wind.current, a = audio();
    if (w && a) { w.g.gain.setTargetAtTime(Math.min(0.22, 0.015 + ((s.v - 15) / 50) ** 2 * 0.25), a.currentTime, 0.1); w.f.frequency.setTargetAtTime(250 + s.v * 14, a.currentTime, 0.1); }
    // ---- Chase camera: behind and above, lagging, widening with speed, leaning into the bank.
    // It follows the heading she shows (so after a knock it swings round with her and is not thrown across the sky).
    const vy = s.yaw + s.spin, vp = s.pitch + s.dip;
    const back = 8 + s.fold * 2, up = 2.6 - vp * 2;
    const pc = camera as THREE.PerspectiveCamera;
    camPos.set(room.x + s.pos.x - Math.sin(vy) * back, s.pos.y + up, room.z + s.pos.z - Math.cos(vy) * back);
    look.set(room.x + s.pos.x + Math.sin(vy) * Math.cos(vp) * 8, s.pos.y + Math.sin(vp) * 8 + 0.6, room.z + s.pos.z + Math.cos(vy) * Math.cos(vp) * 8);
    if (!s.placed) {
      // The round opens on the card's view of the perch, and the eye sweeps from there out through the arch after
      // her (it used to cut to her tail). Only a camera left far off, by a round started again before it had come
      // home, is put straight behind her. The lens starts from what the card left too.
      s.placed = true; s.fov = pc.fov;
      if (camera.position.distanceTo(camPos) > 40) { camera.position.copy(camPos); lookNow.copy(look); }
      else camera.getWorldDirection(lookNow).multiplyScalar(12).add(camera.position);
    }
    camera.position.lerp(camPos, 1 - Math.exp(-dt * (3 + 3 * smooth(1, 2.2, s.t))));
    const cg = heightAt(camera.position.x - room.x, camera.position.z - room.z) + 1.2;
    if (camera.position.y < cg && camera.position.x - room.x < -27) camera.position.y = cg;
    if (camera.position.y < SEA_Y + 1) camera.position.y = SEA_Y + 1;
    // The gaze is loose while she leaves the perch and close on her from then on.
    lookNow.lerp(look, 1 - Math.exp(-dt * (4 + 56 * smooth(0, 1.4, s.t))));
    camera.lookAt(lookNow);
    camera.rotateZ(-s.roll * 0.35);
    s.punch = Math.max(0, s.punch - dt * 3);
    const fov = THREE.MathUtils.clamp(56 + (s.v - 20) * 0.55, 54, 84) - s.punch * 8;
    s.fov += (fov - s.fov) * (1 - Math.exp(-dt * 4));
    if (Math.abs(pc.fov - s.fov) > 0.05) { pc.fov = s.fov; pc.updateProjectionMatrix(); }
    s.shake = Math.max(0, s.shake - dt * 1.6);
    if (s.shake > 0) { const k = s.shake * s.shake; camera.rotateX(Math.sin(now * 41) * k * 0.03); camera.rotateY(Math.sin(now * 33 + 2) * k * 0.03); }
    // ---- The marker on the nearest gull.
    const el = marker.el;
    if (el) {
      if (near && flying) {
        proj.copy(near.g.position); proj.x += room.x; proj.z += room.z; proj.project(camera);
        const behind = proj.z > 1, inView = !behind && Math.abs(proj.x) < 0.92 && Math.abs(proj.y) < 0.86;
        if (inView) {
          el.className = `fal-mark ring${nd < 30 ? ' close' : ''}`;
          el.style.transform = `translate(${(proj.x * 0.5 + 0.5) * innerWidth}px, ${(-proj.y * 0.5 + 0.5) * innerHeight}px)`;
          el.dataset.d = `${Math.round(nd / 1.85)} m`;
        } else {
          let ax = proj.x, ay = proj.y; if (behind) { ax = -ax; ay = -ay; }
          const ang = Math.atan2(-ay, ax), r = Math.min(innerWidth, innerHeight) * 0.38;
          el.className = 'fal-mark arrow';
          el.style.transform = `translate(${innerWidth / 2 + Math.cos(ang) * r}px, ${innerHeight / 2 + Math.sin(ang) * r}px) rotate(${ang}rad)`;
          el.dataset.d = '';
        }
      } else el.className = 'fal-mark off';
    }
    // ---- The clock.
    if (Math.abs(s.left - ui.state.left) > 0.2 || Math.abs(s.v - ui.state.speed) > 1) ui.set({ left: s.left, speed: s.v });
    if (s.t > 1.2 && ui.state.phase === 'launch') ui.set({ phase: 'fly', line: `Find the gulls along the cliffs. Hold ${TOUCH ? 'Stoop' : 'W'} to dive on them.` });
    // The last of the light: a word at fifteen seconds, then a tick for each of the last ten.
    const sec = Math.ceil(s.left);
    if (sec !== s.sec && flying) {
      s.sec = sec;
      if (sec === 15) ui.set({ line: s.caught < WIN ? `The sun is low. ${WIN - s.caught} more to win.` : 'The sun is low.' });
      if (sec <= 10 && sec > 0) burst(sec <= 3 ? 1500 : 1100, 9, 0.05, 0.05);
    }
    if (s.left <= 0 && !s.ended) {
      s.ended = true;
      const won = s.caught >= WIN;
      ui.set({ phase: 'done', line: 'The sun is on the sea.' });
      kee(0.7);
      end({ won, score: s.caught, grade: THREE.MathUtils.clamp((s.caught - WIN + 1) / (BEST - WIN + 1), 0, 1), line: `${s.caught} gull${s.caught === 1 ? '' : 's'} taken before sundown. ${won ? s.caught >= BEST ? 'The falconers have never seen the like.' : 'The house hawk has earned her supper.' : `The aerie wanted ${WIN}.`}` });
    }
  });

  return (
    <group>
      <hemisphereLight args={['#e3c0b4', '#4a4552', 1]} />
      <directionalLight position={[300, 160, 80]} color="#d8b9c9" intensity={0.8} />
      <DuskSky center={[-200, 0, 0]} />
      <Sea y={SEA_Y} center={[-700, 0]} size={3200} chop={0.45} shine={0.5} />
      <Coast />
      <Surf />
      <primitive object={hawk.root} />
      {gulls.map((g, i) => <group key={i}><primitive object={g.g} /><primitive object={g.mark} /></group>)}
      <primitive object={feathers.points} />
      <primitive object={spray.points} />
      <primitive object={streaks.points} />
    </group>
  );
}

function Hud() {
  const s = ui.use();
  const m = Math.floor(s.left / 60), sec = Math.floor(s.left % 60);
  return (
    <>
      <div ref={(el) => { marker.el = el; }} className="fal-mark off" />
      <div className="fal-top">
        <div className={`fal-clock${s.left < 15 ? ' low' : ''}`}>{m}:{String(sec).padStart(2, '0')}</div>
      </div>
      <div className="game-hud fal-hud">
        <div className="fal-count" key={s.flash}><b>{s.caught}</b><span>/ {WIN} gulls</span></div>
        <div className="pips">{Array.from({ length: Math.max(WIN, s.caught) }, (_, i) => <i key={i} className={i < s.caught ? 'on' : ''} />)}</div>
        <div className="line">{s.line}</div>
        <div className="fal-speed"><span style={{ transform: `scaleX(${Math.min(1, (s.speed - 10) / 54)})` }} /></div>
        <div className="hint"><kbd>A</kbd><kbd>D</kbd> or <kbd>←</kbd><kbd>→</kbd> bank · hold <kbd>W</kbd>, <kbd>↑</kbd> or <kbd>Space</kbd> to stoop · <kbd>S</kbd> or <kbd>↓</kbd> climb</div>
      </div>
    </>
  );
}

register({
  id: 'falcon', name: 'Falconry',
  pitch: 'Cast the house hawk off the aerie and hunt the gulls along the sea cliffs. Fold your wings to stoop and you’ll outrun anything, but pull up before the water. Eight gulls before sundown.',
  keys: [['A D / ← →', 'bank left and right'], ['W / ↑ / Space (hold)', 'stoop: dive for speed'], ['S / ↓', 'climb'], ['Esc', 'leave']],
  entry: 400,
  Station, Play, Hud,
  view: () => ({ pos: [STATION[0] + 6, 6.5, STATION[1] + 8], look: [STATION[0] - 1, 3.5, STATION[1]] }),
});
