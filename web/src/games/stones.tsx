// House Marrow's game, on the frozen floor of High Marrow: Ice Stones. Curling against the house champion, Hild.
// Aim down the sheet, choose the curl, hold Space for weight and let go; then tap Space to sweep, which carries the
// stone further and straighter. Stones are discs on the ice with real friction, curl and elastic knocks; a stone over
// the side or back line is gone, one that stops short of the far hog line is pulled. After every stone the stones
// nearest the button count for one side. Two ends, four stones each; outscore Hild to win.
// Hild is not scripted: she simulates every throw she could make (weight × line × curl) on the real physics, scores
// each outcome, and throws the best one with a human hand's error. So she draws, guards and knocks you out as the
// head calls for it.
import { memo, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { audio, burst, noise, voice } from '../realm/sound.ts';
import { drawSigil } from '../realm/sigils.ts';
import type { Room } from '../realm/rooms.ts';
import { keys, usePlay } from '../realm/play.ts';
import { gameKeys, gameUi, register, session, type Result } from './host.ts';
import './stones.css';

// ---- The sheet, in the hall's frame (z toward the door; stones travel toward −z).
const HACK_Z = 15;            // where stones are let go
const TEE_Z = -22;            // centre of the house
const HOUSE_R = 3.6;          // the outer ring
const R = 0.55;               // a stone's radius
const SIDE = 8.5;             // side lines at ±SIDE
const BACK_Z = TEE_Z - HOUSE_R - 2.4; // the back line
const HOG_Z = -11;            // a delivered stone must come to rest past this
const A = 2.2;                // deceleration on clean ice
const CURL = 0.6;             // how hard a turning stone draws sideways (more as it slows)
const SWEEP = 0.15;           // full sweeping cuts friction by this much…
const ENDS = 2, PER = 4;      // two ends, four stones a side
const YOU = 0, HILD = 1;
const HANDLE = ['#e0a52e', '#4fb0ea'];
const NAMES = ['You', 'Hild'];

// Weight: the meter's 0..1 maps to how far a stone would run on clean ice.
const runOf = (p: number) => 18 + p * 42;
const speedOf = (p: number) => Math.sqrt(2 * A * runOf(p));
const ZONES: [string, number, number][] = [['hog', 0, (HACK_Z - HOG_Z - 18) / 42], ['guard', (HACK_Z - HOG_Z - 18) / 42, (HACK_Z - (TEE_Z + HOUSE_R) - 18) / 42], ['draw', (HACK_Z - (TEE_Z + HOUSE_R) - 18) / 42, (HACK_Z - (TEE_Z - HOUSE_R) - 18) / 42], ['back', (HACK_Z - (TEE_Z - HOUSE_R) - 18) / 42, (HACK_Z - BACK_Z - 18) / 42], ['takeout', (HACK_Z - BACK_Z - 18) / 42, 1]];

// ---- Physics: the same step drives the live stones and Hild's look-ahead.
interface Disc { x: number; z: number; vx: number; vz: number; spin: number; team: number; live: boolean; moving: boolean; touched: boolean }
function step(st: Disc[], dt: number, sweep: number, thrown: Disc | null, hit?: (v: number, x: number, z: number) => void) {
  let any = false;
  for (const s of st) {
    if (!s.moving) continue;
    const v = Math.hypot(s.vx, s.vz);
    if (v < 0.03) { s.vx = s.vz = 0; s.moving = false; continue; }
    any = true;
    const sw = s === thrown ? sweep : 0;
    const dx = s.vx / v, dz = s.vz / v;
    const nv = Math.max(0, v - A * (1 - SWEEP * sw) * dt);
    const lat = (s.spin * CURL * (1 - 0.5 * sw)) / (0.6 + v * 0.25);
    s.vx = dx * nv - dz * lat * dt;
    s.vz = dz * nv + dx * lat * dt;
    s.x += s.vx * dt; s.z += s.vz * dt;
    if (Math.abs(s.x) > SIDE + R || s.z < BACK_Z - R) { s.live = false; s.moving = false; s.vx = s.vz = 0; }
  }
  // Knocks: equal masses, nearly elastic. Overlap is pushed apart evenly.
  for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) {
    const a = st[i], b = st[j];
    if (!a.live || !b.live) continue;
    const ex = b.x - a.x, ez = b.z - a.z, d = Math.hypot(ex, ez);
    if (d >= 2 * R || d < 1e-6) continue;
    const nx = ex / d, nz = ez / d, push = (2 * R - d) / 2;
    a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
    const vrel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
    if (vrel <= 0) continue;
    const imp = vrel * (1 + 0.9) / 2;
    a.vx -= imp * nx; a.vz -= imp * nz; b.vx += imp * nx; b.vz += imp * nz;
    a.moving = b.moving = true; a.touched = b.touched = true;
    a.spin *= 0.3; b.spin *= 0.3;
    hit?.(vrel, (a.x + b.x) / 2, (a.z + b.z) / 2);
  }
  return any;
}
const launch = (team: number, p: number, aim: number, spin: number): Disc => {
  const v = speedOf(p);
  return { x: 0, z: HACK_Z, vx: Math.sin(aim) * v, vz: -Math.cos(aim) * v, spin, team, live: true, moving: true, touched: false };
};
/** Pull a delivered stone that never reached the far hog line and was never touched. */
const hogRule = (s: Disc) => { if (s.live && !s.touched && s.z > HOG_Z) s.live = false; };
const inHouse = (s: Disc) => s.live && Math.hypot(s.x, s.z - TEE_Z) < HOUSE_R + R;
const dist = (s: Disc) => Math.hypot(s.x, s.z - TEE_Z);
/** Who lies, and how many: the side with the nearest stone scores each of its stones nearer than the other's best. */
function count(st: Disc[]) {
  const h = st.filter(inHouse).sort((a, b) => dist(a) - dist(b));
  if (!h.length) return { team: -1, n: 0, scoring: [] as Disc[] };
  const team = h[0].team, scoring: Disc[] = [];
  for (const s of h) { if (s.team !== team) break; scoring.push(s); }
  return { team, n: scoring.length, scoring };
}

/** How good a head is for `team`, with `left` stones still to come. */
function judge(st: Disc[], team: number, left: number) {
  const c = count(st);
  let v = c.team === team ? c.n * 1.1 : c.team >= 0 ? -c.n * 1.25 : 0;
  for (const s of st) {
    if (!s.live) continue;
    if (inHouse(s)) { const w = 0.4 * (1 - dist(s) / (HOUSE_R + R)); v += s.team === team ? w : -w * 1.2; }
    else if (left >= 2 && s.z < HOG_Z && s.z > TEE_Z + HOUSE_R && Math.abs(s.x) < 2.6) v += s.team === team ? (c.team === team ? 0.35 : 0.12) : -0.08;
  }
  return v;
}
function simulate(st: Disc[], shot: Disc) {
  const w = st.filter((s) => s.live).map((s) => ({ ...s, moving: false })), t = { ...shot };
  w.push(t);
  for (let i = 0; i < 1800 && step(w, 1 / 120, 0, null); i++);
  hogRule(t);
  return w;
}
/** Hild weighs every throw she could make, a few at a time: the round gives her a few milliseconds of it each frame. */
function* think(st: Disc[], left: number): Generator<undefined, { p: number; aim: number; spin: number; kind: string }> {
  const PS: number[] = [], AS: number[] = [];
  for (let p = 0.18; p <= 0.961; p += 0.04) PS.push(p);
  for (let a = -0.09; a <= 0.0901; a += 0.0075) AS.push(a);
  const val = [1, -1].map(() => PS.map(() => AS.map(() => 0)));
  let k = 0;
  for (let si = 0; si < 2; si++) for (let pi = 0; pi < PS.length; pi++) for (let ai = 0; ai < AS.length; ai++) {
    val[si][pi][ai] = judge(simulate(st, launch(HILD, PS[pi], AS[ai], si ? -1 : 1)), HILD, left);
    if (++k % 6 === 0) yield undefined;
  }
  // A shot is only as good as the throws either side of it: she plays what still works if her hand is a little off.
  let best = { p: 0.45, aim: 0, spin: 1, v: -1e9 };
  for (let si = 0; si < 2; si++) for (let pi = 0; pi < PS.length; pi++) for (let ai = 0; ai < AS.length; ai++) {
    let sum = 0, n = 0;
    for (let dp = -1; dp <= 1; dp++) for (let da = -1; da <= 1; da++) {
      const row = val[si][pi + dp], x = row?.[ai + da];
      if (x !== undefined) { sum += x; n++; }
    }
    const v = 0.4 * val[si][pi][ai] + 0.6 * (sum / n);
    if (v > best.v + 1e-6) best = { p: PS[pi], aim: AS[ai], spin: si ? -1 : 1, v };
  }
  const before = st.filter((s) => s.live && s.team === YOU).length;
  const after = simulate(st, launch(HILD, best.p, best.aim, best.spin));
  const kind = after.filter((s) => s.live && s.team === YOU).length < before ? 'takeout'
    : after[after.length - 1].live && after[after.length - 1].z > TEE_Z + HOUSE_R ? 'guard' : 'draw';
  return { ...best, kind };
}
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5 * 1.7;

// ---- Looks: granite stones with a goose-neck handle, the house painted under the ice, the lines.
const granite = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#55585d'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.45 ? 'rgba(40,40,44,0.55)' : v < 0.8 ? 'rgba(160,160,165,0.5)' : 'rgba(120,90,80,0.45)';
    g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2.2, 1 + Math.random() * 2.2);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1);
  return t;
})();
const bodyGeo = (() => {
  const pts = [[0, 0.03], [0.34, 0], [0.48, 0.04], [0.54, 0.13], [0.55, 0.2], [0.54, 0.28], [0.48, 0.36], [0.36, 0.41], [0.12, 0.43], [0, 0.43]].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 40); g.computeVertexNormals(); return g;
})();
const bandGeo = new THREE.CylinderGeometry(0.556, 0.556, 0.07, 40, 1, true).translate(0, 0.2, 0);
const handleGeo = (() => {
  const c = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.42, 0.16), new THREE.Vector3(0, 0.6, 0.1), new THREE.Vector3(0, 0.64, -0.08), new THREE.Vector3(0, 0.62, -0.3)]);
  return new THREE.TubeGeometry(c, 16, 0.045, 8);
})();
const baseGeo = new THREE.CylinderGeometry(0.1, 0.12, 0.06, 12).translate(0, 0.44, 0.13);
const ringGeo = new THREE.RingGeometry(0.66, 0.84, 40).rotateX(-Math.PI / 2);
const capGeo = new THREE.RingGeometry(0.17, 0.36, 32).rotateX(-Math.PI / 2).translate(0, 0.432, 0);
const graniteMat = new THREE.MeshStandardMaterial({ map: granite, roughness: 0.45, metalness: 0.05 });
const bandMat = new THREE.MeshStandardMaterial({ color: '#9a9ca0', roughness: 0.25, metalness: 0.1 });
const handleMats = HANDLE.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.15, emissive: new THREE.Color(c), emissiveIntensity: 0.12 }));
const shotMat = new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });

function Stone({ team, setRef }: { team: number; setRef: (g: THREE.Group | null) => void }) {
  return (
    <group ref={setRef}>
      <mesh geometry={bodyGeo} material={graniteMat} castShadow receiveShadow />
      <mesh geometry={bandGeo} material={bandMat} />
      <mesh geometry={capGeo} material={handleMats[team]} />
      <mesh geometry={baseGeo} material={handleMats[team]} castShadow />
      <mesh geometry={handleGeo} material={handleMats[team]} castShadow />
    </group>
  );
}

/** The playing lane: pebbled ice a shade deeper than the hall's sheet, scored by the stones that went before. */
function laneTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 1024;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 256, 0);
  grd.addColorStop(0, '#9fb9c9'); grd.addColorStop(0.5, '#b4cbd8'); grd.addColorStop(1, '#9fb9c9');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 1024);
  for (let i = 0; i < 9000; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.22)' : 'rgba(60,90,110,0.12)'; g.fillRect(Math.random() * 256, Math.random() * 1024, 1.4, 1.4); }
  g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 1;
  for (let i = 0; i < 70; i++) { const x = 128 + (Math.random() - 0.5) * 120; g.beginPath(); g.moveTo(x, 1024); g.quadraticCurveTo(x + (Math.random() - 0.5) * 30, 500, x + (Math.random() - 0.5) * 60, Math.random() * 300); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/** The house: rings in Marrow's grey and ice blue with the lynx on the button. */
function houseTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const g = c.getContext('2d')!, m = 512, k = 512 / HOUSE_R;
  const ring = (r: number, col: string) => { g.fillStyle = col; g.beginPath(); g.arc(m, m, r * k, 0, Math.PI * 2); g.fill(); };
  ring(HOUSE_R, '#2f6e9e'); ring(HOUSE_R * 0.985, '#3f80b3'); ring(HOUSE_R * 2 / 3, '#e9f0f5'); ring(HOUSE_R / 3, '#6b737b'); ring(0.62, '#e9f0f5');
  drawSigil(g, 6, m - 0.5 * k, m - 0.5 * k, k, '#4a5560');
  // Frost on top: it's painted under the ice.
  g.globalAlpha = 0.12; g.fillStyle = '#fff';
  for (let i = 0; i < 2500; i++) g.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function Sheet() {
  const tex = useMemo(houseTexture, []);
  const lane = useMemo(laneTexture, []);
  const LZ0 = HACK_Z + 3.4, LZ1 = BACK_Z - 1.2;
  const line = useMemo(() => new THREE.MeshBasicMaterial({ color: '#33414d', transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), []);
  const hog = useMemo(() => new THREE.MeshBasicMaterial({ color: '#7a2f2f', transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), []);
  const strip = (w: number, d: number, x: number, z: number, m: THREE.Material) => <mesh material={m} rotation-x={-Math.PI / 2} position={[x, 0.025, z]}><planeGeometry args={[w, d]} /></mesh>;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.014, (LZ0 + LZ1) / 2]} receiveShadow>
        <planeGeometry args={[SIDE * 2 + 0.8, LZ0 - LZ1]} />
        <meshStandardMaterial map={lane} roughness={0.16} metalness={0.05} polygonOffset polygonOffsetFactor={-0.5} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, TEE_Z]} receiveShadow>
        <circleGeometry args={[HOUSE_R, 64]} />
        <meshStandardMaterial map={tex} roughness={0.15} polygonOffset polygonOffsetFactor={-1} />
      </mesh>
      {strip(SIDE * 2, 0.08, 0, TEE_Z, line)}
      {strip(0.06, HACK_Z - BACK_Z + 2, 0, (HACK_Z + BACK_Z) / 2, line)}
      {strip(SIDE * 2, 0.1, 0, BACK_Z, line)}
      {strip(SIDE * 2, 0.28, 0, HOG_Z, hog)}
      {strip(SIDE * 2, 0.28, 0, HACK_Z - 4, hog)}
      {[-1, 1].map((s) => <group key={s}>{strip(0.1, HACK_Z - BACK_Z + 3, s * SIDE, (HACK_Z + BACK_Z) / 2, line)}</group>)}
      {/* The hack: two rubber footholds. */}
      {[-1, 1].map((s) => <mesh key={s} position={[s * 0.35, 0.05, HACK_Z + 1.6]} castShadow><boxGeometry args={[0.32, 0.1, 0.5]} /><meshStandardMaterial color="#1a1a1a" roughness={0.9} /></mesh>)}
      {/* A cold light over the house so the head reads from the hack. */}
      <pointLight position={[0, 8, TEE_Z + 1]} color="#d6e8ff" intensity={40} distance={20} decay={1.6} />
    </group>
  );
}

const RACK = (team: number, k: number): [number, number] => [(team === YOU ? -1 : 1) * (SIDE + 1.6), HACK_Z + 1 + k * 1.35];
const RACK_ROT = (team: number) => (team === YOU ? 0.4 : -0.4);
// Where the cards look from and at (the hall's frame); the round's camera hands back to this at the end.
const VIEW = { pos: [0, 5.5, HACK_Z + 9] as [number, number, number], look: [0, 0, TEE_Z + 4] as [number, number, number] };

function Station() {
  const playing = usePlay().game && session.phase === 'play';
  return (
    <group>
      <Sheet />
      {!playing && [YOU, HILD].map((t) => Array.from({ length: PER }, (_, k) => {
        const [x, z] = RACK(t, k);
        return <group key={`${t}${k}`} position={[x, 0, z]} rotation-y={RACK_ROT(t)}><Stone team={t} setRef={() => undefined} /></group>;
      }))}
    </group>
  );
}

// ---- The round.
type Phase = 'aim' | 'charge' | 'slide' | 'think' | 'settle' | 'count' | 'done';
/** A stone as drawn. `ox, oz` is how far the drawn stone still is from the physical one (it starts a throw where it
 *  stood at the hack and catches up in a few frames); `inT` grows a stone back in at the rack; `rx, rz` is its rack. */
interface Live extends Disc { id: number; rot: number; thrown: boolean; outT: number; ox: number; oz: number; inT: number; rx: number; rz: number }
interface Mark { x: number; z: number; team: number; shot: boolean }
const ui = gameUi({
  end: 1, score: [0, 0] as number[], left: [PER, PER] as number[], phase: 'aim' as Phase, turn: YOU, line: '',
  power: 0, aim: 0, spin: 1, sweep: 0, marks: [] as Mark[], banner: '',
});

function rumble() {
  const a = audio();
  if (!a) return undefined;
  const src = a.createBufferSource(); src.buffer = noise(a); src.loop = true; src.playbackRate.value = 0.6;
  const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160; lp.Q.value = 1.4;
  const g = a.createGain(); g.gain.value = 0;
  const scr = a.createBiquadFilter(); scr.type = 'bandpass'; scr.frequency.value = 2200; scr.Q.value = 1.2;
  const g2 = a.createGain(); g2.gain.value = 0;
  src.connect(lp).connect(g).connect(a.destination);
  src.connect(scr).connect(g2).connect(a.destination);
  src.start();
  return { a, src, lp, g, g2 };
}
const crack = (v: number) => {
  const k = Math.min(1, v / 8);
  burst(2600 + Math.random() * 600, 5, 0.32 * k + 0.05, 0.09);
  burst(420, 2.2, 0.28 * k + 0.05, 0.12);
  burst(5200, 9, 0.08 * k, 0.05, 0.004);
};
const shh = () => burst(3800 + Math.random() * 1200, 0.9, 0.05, 0.13, 0, 'bandpass');

function Play({ room, end }: { room: Room; end: (r: Result) => void }) {
  const camera = useThree((s) => s.camera);
  const groups = useRef<(THREE.Group | null)[]>([]);
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const path = useRef<THREE.Points>(null);
  const frost = useRef<THREE.Points>(null);
  const st = useRef({
    phase: 'aim' as Phase, t: 0, end: 1, turn: YOU, first: YOU, thrown: 0,
    stones: [] as Live[], cur: null as Live | null, aim: 0, spin: 1, power: 0, charge: 0,
    sweep: 0, acc: 0, score: [0, 0], fast: false, brain: null as Generator<undefined, { p: number; aim: number; spin: number; kind: string }> | null,
    plan: null as { p: number; aim: number; spin: number; kind: string } | null, shake: 0, lastMarks: 0, pathKey: '',
    finished: false, before: [0, 0],
    // When Space was last pressed outside your turn, when Hild's plan was made, and small caches for the HUD and sound.
    spaceAt: -9, planT: 0, seeded: false, marksKey: '', vmax: -1, frostNext: 0,
  });
  const ringMats = useMemo(() => Array.from({ length: PER * 2 }, () => shotMat.clone()), []);
  const ringPop = useMemo(() => new Float32Array(PER * 2), []);
  const sound = useRef<ReturnType<typeof rumble>>();
  useEffect(() => { sound.current = rumble(); return () => { const s = sound.current; if (s) { s.g.gain.setTargetAtTime(0, s.a.currentTime, 0.05); s.src.stop(s.a.currentTime + 0.3); } }; }, []);

  // A stone for each slot: team YOU ids 0..3, HILD 4..7.
  // At the start they stand exactly where the hall's own rack stones stood; between ends they grow back in.
  const reset = (grow = false) => {
    const s = st.current;
    s.stones = Array.from({ length: PER * 2 }, (_, id) => {
      const team = id < PER ? YOU : HILD, [x, z] = RACK(team, id % PER);
      return { id, team, x, z, vx: 0, vz: 0, spin: 0, live: false, moving: false, touched: false, rot: RACK_ROT(team), thrown: false, outT: -1, ox: 0, oz: 0, inT: grow ? 0 : 1, rx: x, rz: z };
    });
    s.thrown = 0; s.cur = null;
  };
  useMemo(() => { ui.reset(); ui.set({ score: [0, 0], left: [PER, PER], line: 'First stone is yours. Set the line, then hold for weight.', banner: 'End 1' }); reset(); }, []);

  // Frost: a pool of particles kicked up by the brooms.
  const frostGeo = useMemo(() => {
    const g = new THREE.BufferGeometry(), n = 260;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(n), 1));
    return g;
  }, []);
  const frostVel = useMemo(() => new Float32Array(260 * 3), []);
  const frostMat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'attribute float aLife; varying float vL; void main(){ vL = aLife; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = (2.0 + 5.0 * aLife) * (120.0 / -mv.z); }',
    fragmentShader: 'varying float vL; void main(){ float d = length(gl_PointCoord - 0.5); if (vL <= 0.0) discard; gl_FragColor = vec4(vec3(0.85, 0.93, 1.0) * vL, vL * 0.8 * smoothstep(0.5, 0.0, d)); }',
  }), []);
  const puff = (x: number, z: number, n: number) => {
    const p = frostGeo.getAttribute('position') as THREE.BufferAttribute, l = frostGeo.getAttribute('aLife') as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      const k = st.current.frostNext = (st.current.frostNext + 1) % 260;
      p.setXYZ(k, x + (Math.random() - 0.5) * 1.3, 0.08, z + (Math.random() - 0.5) * 0.5);
      frostVel.set([(Math.random() - 0.5) * 3, 0.6 + Math.random() * 1.6, (Math.random() - 0.5) * 1.5], k * 3);
      l.setX(k, 1);
    }
  };

  // The aim line: where a draw weight on this line and turn would run, up to the far hog line.
  const pathGeo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(120 * 3), 3)); return g; }, []);
  const pathMat = useMemo(() => new THREE.PointsMaterial({ color: '#ffcf4a', size: 0.3, transparent: true, opacity: 0.85, depthWrite: false }), []);
  const drawPath = (aim: number, spin: number) => {
    const d: Disc[] = [launch(YOU, 0.47, aim, spin)];
    const pos = pathGeo.getAttribute('position') as THREE.BufferAttribute;
    let n = 0, travelled = 0, lx = d[0].x, lz = d[0].z;
    for (let i = 0; i < 1200 && n < 120 && step(d, 1 / 120, 0, null); i++) {
      travelled += Math.hypot(d[0].x - lx, d[0].z - lz); lx = d[0].x; lz = d[0].z;
      if (d[0].z < HOG_Z + 2) break;
      if (travelled > 0.42) { travelled = 0; pos.setXYZ(n++, d[0].x, 0.06, d[0].z); }
    }
    pathGeo.setDrawRange(0, n); pos.needsUpdate = true;
  };

  const camPos = useMemo(() => new THREE.Vector3(), []), camLook = useMemo(() => new THREE.Vector3(), []), lookNow = useMemo(() => new THREE.Vector3(), []);
  const left = () => { const s = st.current; return [YOU, HILD].map((t) => s.stones.filter((x) => x.team === t && !x.thrown).length); };

  const nextThrow = () => {
    const s = st.current;
    if (s.thrown >= PER * 2) {
      // The end is over: count it.
      const c = count(s.stones);
      if (c.team >= 0) s.score[c.team] += c.n;
      s.phase = 'count'; s.t = 0;
      const who = c.team === YOU ? `You score ${c.n}.` : c.team === HILD ? `Hild scores ${c.n}.` : 'A blank end. Nobody scores.';
      if (c.team === YOU) voice('woman', 14, -0.3, true); else if (c.team === HILD) voice('soldier', 12, 0.3, false);
      ui.set({ phase: 'count', score: [...s.score], line: who, banner: `End ${s.end}` });
      return;
    }
    s.turn = s.thrown % 2 === 0 ? s.first : 1 - s.first;
    s.t = 0;
    if (s.turn === YOU) {
      s.phase = 'aim'; s.aim = 0; s.power = 0; s.pathKey = '';
      ui.set({ phase: 'aim', turn: YOU, left: left(), line: `${s.thrown >= PER * 2 - 2 ? 'Your last stone.' : 'Your stone.'} Set the line, then hold for weight.` });
    } else {
      s.phase = 'think'; s.brain = think(s.stones, PER * 2 - s.thrown); s.plan = null;
      ui.set({ phase: 'think', turn: HILD, left: left(), line: 'Hild studies the head…' });
    }
  };

  const throwStone = (team: number, p: number, aim: number, spin: number) => {
    const s = st.current;
    const stone = s.stones.find((x) => x.team === team && !x.thrown)!;
    // It is let go from the hack, but drawn from where it stood (just behind it), so it is pushed out, not swapped in.
    const ox = stone.x, oz = stone.z - HACK_Z;
    Object.assign(stone, launch(team, p, aim, spin), { thrown: true, outT: -1, ox, oz });
    s.before = [YOU, HILD].map((t) => s.stones.filter((x) => x.team === t && x.thrown && x.live && x !== stone).length);
    s.cur = stone; s.thrown++; s.phase = 'slide'; s.t = 0; s.sweep = 0; s.fast = false; s.acc = 0;
    burst(240, 1.5, 0.2, 0.25); burst(1400, 1, 0.05, 0.3, 0.02);
    ui.set({ phase: 'slide', left: left(), sweep: 0, power: p, line: team === YOU ? 'Sweep to carry it further and straighter.' : ui.state.line });
  };

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = st.current;
    s.t += dt;
    const ks = gameKeys();
    if (s.finished) return;

    const T = clock.elapsedTime;
    // Space pressed just before your turn comes up is remembered for a moment: see the aim, below.
    if (s.phase !== 'aim' && s.phase !== 'charge' && !(s.phase === 'slide' && s.cur?.team === YOU) && ks.includes(' ')) s.spaceAt = T;

    // ---- Your turn: aim, curl, weight.
    if (s.phase === 'aim' || s.phase === 'charge') {
      const steer = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
      s.aim = THREE.MathUtils.clamp(s.aim + steer * dt * (s.phase === 'charge' ? 0.05 : 0.11), -0.1, 0.1);
      let begin = false;
      for (const k of ks) {
        if ((k === 'w' || k === 'arrowup') && s.spin !== 1) { s.spin = 1; burst(1500, 3, 0.02, 0.04); }
        if ((k === 's' || k === 'arrowdown' || k === 'q') && s.spin !== -1) { s.spin = -1; burst(1300, 3, 0.02, 0.04); }
        if (k === ' ') begin = true;
      }
      // Held down a moment early (while the last stone was still being read) counts as held now.
      if (keys.has(' ') && T - s.spaceAt < 0.45) begin = true;
      if (begin && s.phase === 'aim') {
        s.phase = 'charge'; s.charge = 0; s.spaceAt = -9; burst(900, 3, 0.03, 0.2);
        ui.set({ phase: 'charge', line: 'Let go at the weight you want.' });
      }
      if (s.phase === 'charge') {
        // The meter climbs and falls; let go of Space where you want it.
        s.charge += dt / 1.15;
        const c = s.charge % 2;
        s.power = c < 1 ? c : 2 - c;
        if (!keys.has(' ')) {
          // A tap is not a throw: let go this early the stone would only be pulled at the hog line, so it stays in hand.
          if (s.charge < 0.12) { s.phase = 'aim'; s.power = 0; burst(220, 1.4, 0.05, 0.1); ui.set({ phase: 'aim', power: 0, line: 'Hold for weight, then let go to throw.' }); }
          else throwStone(YOU, Math.max(0.02, s.power), s.aim, s.spin);
        }
      }
      // (The cast: the throw above may have moved the phase on, which the compiler can't see.)
      if ((s.phase as Phase) !== 'slide') {
        const key = `${s.aim.toFixed(4)}${s.spin}`;
        if (key !== s.pathKey) { s.pathKey = key; drawPath(s.aim, s.spin); }
        if (Math.abs(ui.state.aim - s.aim) > 1e-4 || ui.state.spin !== s.spin || Math.abs(ui.state.power - s.power) > 0.004) ui.set({ aim: s.aim, spin: s.spin, power: s.power, phase: s.phase });
      }
    }

    // ---- Hild thinks a moment, calls her shot, then throws.
    if (s.phase === 'think') {
      if (s.brain) {
        // About a thousand throws to weigh. A few milliseconds of them each frame: a slow machine thinks longer
        // instead of stuttering.
        const t0 = performance.now();
        let r = s.brain.next();
        while (!r.done && performance.now() - t0 < 6) r = s.brain.next();
        if (r.done) {
          s.plan = r.value; s.brain = null; s.planT = Math.max(s.t, 0.9);
          ui.set({ line: { takeout: 'Hild calls for the takeout.', guard: 'Hild sets a guard.', draw: 'Hild draws to the button.' }[s.plan.kind] ?? '' });
          voice('soldier', 10, 0.4, false);
        }
      }
      // Once she has called it the camera walks back to the hack (below), and she throws when it is there.
      if (s.plan && s.t > s.planT + 1.2) {
        // A human hand: a little off most of the time, now and then a stone thrown heavy or light.
        const slip = Math.random() < 0.22 ? (Math.random() < 0.5 ? -0.08 : 0.08) : 0;
        throwStone(HILD, THREE.MathUtils.clamp(s.plan.p + gauss() * 0.08 + slip, 0.05, 1), s.plan.aim + gauss() * 0.02, s.plan.spin);
      }
    }

    // ---- Stones on the ice.
    if (s.phase === 'slide') {
      for (const k of ks) {
        if (k === ' ' && s.cur?.team === YOU && s.cur.moving) { s.sweep = Math.min(1, s.sweep + 0.3); shh(); puff(s.cur.x, s.cur.z - 1, 10); }
        if ((k === 'e' || k === 'enter') && s.cur?.team === HILD && !s.fast) { s.fast = true; burst(1200, 3, 0.03, 0.1); }
      }
      s.sweep *= Math.exp(-dt * 2.2);
      const scale = s.fast ? 3 : 1;
      s.acc += dt * scale;
      let moving = false;
      while (s.acc >= 1 / 120) {
        s.acc -= 1 / 120;
        moving = step(s.stones, 1 / 120, s.sweep, s.cur, (v) => { crack(v); s.shake = Math.min(0.6, v / 10); }) || moving;
      }
      for (const x of s.stones) if (x.thrown && !x.live && x.outT < 0) x.outT = 0;
      // The broom's bar only needs telling when it has visibly moved (each `set` redraws the whole HUD).
      if (s.cur?.team === YOU && Math.abs(ui.state.sweep - s.sweep) > 0.01) ui.set({ sweep: s.sweep });
      if (!moving && s.stones.every((x) => !x.moving)) {
        const cur = s.cur!;
        hogRule(cur);
        if (!cur.live && cur.outT < 0) cur.outT = 0;
        s.phase = 'settle'; s.t = 0;
        const c = count(s.stones);
        const lie = c.team === YOU ? `You lie ${c.n}.` : c.team === HILD ? `Hild lies ${c.n}.` : 'Nothing in the house.';
        const other = 1 - cur.team, gone = s.before[other] - s.stones.filter((x) => x.team === other && x.thrown && x.live).length;
        let what = !cur.live ? (cur.z > HOG_Z && !cur.touched ? 'Hogged: pulled from play.' : 'Through and gone.') : '';
        if (gone > 0) {
          what = cur.team === YOU ? (gone > 1 ? 'A double! Two of Hild’s gone.' : 'Cracked hers out!') : (gone > 1 ? 'Hild clears two of yours.' : 'Hild knocks yours out.');
          if (cur.team === YOU) { voice('man', 12, -0.4, true); voice('woman', 10, 0.4, true); }
        }
        ui.set({ phase: 'settle', sweep: 0, line: `${what} ${lie}`.trim() });
      }
    } else if (s.phase === 'settle' && (s.t > 2.2 || (s.t > 0.7 && (ks.includes('e') || ks.includes('enter'))))) nextThrow();
    else if (s.phase === 'count') {
      // The end is read for a while; then the head is cleared and the stones grow back in the racks, so neither the
      // next end nor the hall (after the last) begins with stones jumping across the ice.
      if (s.t > 2.6 && s.t - dt <= 2.6) { for (const x of s.stones) if (x.thrown && x.live && x.outT < 0) x.outT = 0; burst(520, 0.8, 0.05, 0.4); }
      if (s.t > 3.4) {
        reset(true);
        if (s.end >= ENDS) { s.phase = 'done'; s.t = 0; }
        else {
          s.end++; s.first = s.first === YOU ? HILD : YOU;
          ui.set({ end: s.end, banner: `End ${s.end}`, left: [PER, PER] });
          nextThrow();
        }
      }
    } else if (s.phase === 'done' && s.t > 0.9) {
      // The camera has turned back to where the result card looks from: hand over.
      s.finished = true;
      const [y, h] = s.score, won = y > h;
      end({ won, score: y, grade: (y - h) / 4, line: `${y}–${h} after ${ENDS} ends. ${won ? y - h >= 3 ? 'High Marrow has not seen a hand like it.' : 'Hild bows. The ice is yours.' : y === h ? 'Level. The champion keeps the hall’s honour.' : 'Hild keeps the hall’s honour.'}` });
      return;
    }

    // ---- Draw the stones.
    const c = count(s.stones);
    // The next stone to go waits at the hack: yours while you aim, Hild's while she thinks.
    const stageTeam = s.phase === 'aim' || s.phase === 'charge' ? YOU : s.phase === 'think' ? HILD : -1;
    const staged = stageTeam < 0 ? undefined : s.stones.find((x) => x.team === stageTeam && !x.thrown);
    const ease = 1 - Math.exp(-dt * 6), catchUp = Math.exp(-dt * 10);
    s.stones.forEach((x, i) => {
      const g = groups.current[i]; if (!g) return;
      if (!x.thrown) {
        // A waiting stone is furniture (the physics ignores it): it slides between its rack and the hack.
        const at = x === staged;
        x.x += ((at ? 0 : x.rx) - x.x) * ease; x.z += ((at ? HACK_Z + 0.9 : x.rz) - x.z) * ease;
        x.rot += ((at ? 0 : RACK_ROT(x.team)) - x.rot) * ease;
      } else {
        if (x.moving) x.rot += x.spin * Math.hypot(x.vx, x.vz) * dt * 0.09;
        x.ox *= catchUp; x.oz *= catchUp;
      }
      x.inT = Math.min(1, x.inT + dt / 0.4);
      if (x.outT >= 0) x.outT += dt;
      g.visible = !x.thrown || x.outT < 0.8;
      g.position.set(x.x + x.ox, x.outT >= 0 ? -Math.min(0.5, x.outT * 0.6) : 0, x.z + x.oz);
      g.rotation.y = x.rot;
      // Out of play it shrinks into the ice; back in the rack it grows in with a small overshoot.
      const u = x.inT - 1;
      g.scale.setScalar(x.outT >= 0 ? Math.max(0.01, 1 - x.outT * 1.2) : Math.max(0.01, 1 + 2.4 * u * u * u + 1.4 * u * u));
      const ring = rings.current[i];
      if (ring) {
        const on = c.scoring.includes(x) && x.outT < 0 && (s.phase === 'settle' || s.phase === 'count' || s.phase === 'aim' || s.phase === 'think');
        // The ring closes in on a counting stone instead of blinking on.
        ringPop[i] = on ? ringPop[i] + (1 - ringPop[i]) * (1 - Math.exp(-dt * 9)) : 0;
        ring.visible = on;
        ring.position.set(x.x, 0.04, x.z);
        ring.scale.setScalar(1.6 - 0.6 * ringPop[i]);
        (ring.material as THREE.MeshBasicMaterial).opacity = (0.55 + Math.sin(T * 5) * 0.3) * ringPop[i];
      }
    });
    // Frost drifts and fades.
    {
      const p = frostGeo.getAttribute('position') as THREE.BufferAttribute, l = frostGeo.getAttribute('aLife') as THREE.BufferAttribute;
      let any = false;
      for (let i = 0; i < 260; i++) {
        const life = l.getX(i); if (life <= 0) continue;
        any = true;
        l.setX(i, life - dt * 1.4);
        frostVel[i * 3 + 1] -= dt * 4;
        p.setXYZ(i, p.getX(i) + frostVel[i * 3] * dt, Math.max(0.05, p.getY(i) + frostVel[i * 3 + 1] * dt), p.getZ(i) + frostVel[i * 3 + 2] * dt);
      }
      if (any) { p.needsUpdate = true; l.needsUpdate = true; }
    }
    if (path.current) path.current.visible = s.phase === 'aim' || s.phase === 'charge';
    // The head, for the HUD's map, a few times a second, and only when a stone has moved.
    if (T - s.lastMarks > 0.12) {
      s.lastMarks = T;
      let key = '';
      for (const x of s.stones) if (x.thrown && x.live && x.outT < 0) key += `${x.id}:${x.x.toFixed(1)},${x.z.toFixed(1)}${c.scoring[0] === x ? '*' : ''};`;
      if (key !== s.marksKey) {
        s.marksKey = key;
        ui.set({ marks: s.stones.filter((x) => x.thrown && x.live && x.outT < 0).map((x) => ({ x: x.x, z: x.z, team: x.team, shot: c.scoring[0] === x })) });
      }
    }

    // ---- The rumble under moving stones.
    const snd = sound.current;
    if (snd) {
      let vmax = 0;
      for (const x of s.stones) if (x.moving) vmax = Math.max(vmax, Math.hypot(x.vx, x.vz));
      // Only retarget the gains when the speed has changed: a still sheet schedules nothing.
      if (Math.abs(vmax - s.vmax) > 0.05 || (vmax === 0 && s.vmax !== 0)) {
        s.vmax = vmax;
        snd.g.gain.setTargetAtTime(Math.min(1, vmax / 12) * 0.22, snd.a.currentTime, 0.08);
        snd.g2.gain.setTargetAtTime(Math.min(1, vmax / 12) * 0.018, snd.a.currentTime, 0.08);
        snd.lp.frequency.setTargetAtTime(110 + vmax * 14, snd.a.currentTime, 0.1);
      }
    }

    // ---- The camera.
    const X = room.x, Z = room.z;
    let fov = 50;
    if (s.phase === 'aim' || s.phase === 'charge') {
      // Low behind the hack, looking down the line you're aiming.
      camPos.set(X - Math.sin(s.aim) * 6, 3.4, Z + HACK_Z + 6.5);
      camLook.set(X + Math.tan(s.aim) * (HACK_Z - TEE_Z), 0.2, Z + TEE_Z + 2);
      fov = 34;
    } else if (s.phase === 'think' && !(s.plan && s.t > s.planT)) {
      camPos.set(X, 9, Z + TEE_Z + 10.5); camLook.set(X, 0, Z + TEE_Z - 0.5); fov = 46;
    } else if (s.phase === 'think') {
      // She has called her shot: back behind the hack, exactly where the ride with her stone starts, so the throw
      // doesn't whip the camera the length of the sheet and back.
      camPos.set(X, 3.6, Z + HACK_Z + 7.5); camLook.set(X, 0.3, Z + HACK_Z - 6); fov = 48;
    } else if (s.phase === 'slide' && s.cur) {
      // Ride with the stone; as it reaches the house, rise to look down into it.
      const near = THREE.MathUtils.smoothstep(s.cur.z, TEE_Z + 14, TEE_Z + 26);
      const fx = X + s.cur.x, fz = Z + s.cur.z;
      camPos.set(fx * near + X * (1 - near), 3.6 * near + 9.5 * (1 - near), (fz + 7.5) * near + (Z + TEE_Z + 8.5) * (1 - near));
      camLook.set(fx * near + X * (1 - near), 0.3, (fz - 6) * near + (Z + TEE_Z) * (1 - near));
      fov = 48;
    } else if (s.phase === 'done') {
      // Turn back to where the result card looks from, so the card's camera takes over without a jump.
      camPos.set(X + VIEW.pos[0], VIEW.pos[1], Z + VIEW.pos[2]); camLook.set(X + VIEW.look[0], VIEW.look[1], Z + VIEW.look[2]);
    } else {
      // Top-down over the house while the head is read.
      camPos.set(X, 15.5, Z + TEE_Z + 5.5); camLook.set(X, 0, Z + TEE_Z - 0.4); fov = 46;
    }
    // The look starts from wherever the card's camera was looking.
    if (!s.seeded) { s.seeded = true; camera.getWorldDirection(lookNow).multiplyScalar(camera.position.distanceTo(camLook)).add(camera.position); }
    const k = 1 - Math.exp(-dt * (s.phase === 'slide' || s.phase === 'done' ? 3.2 : 2.6));
    camera.position.lerp(camPos, k);
    lookNow.lerp(camLook, k);
    camera.lookAt(lookNow);
    const pc = camera as THREE.PerspectiveCamera;
    if (Math.abs(pc.fov - fov) > 0.05) { pc.fov += (fov - pc.fov) * k; pc.updateProjectionMatrix(); }
    s.shake = Math.max(0, s.shake - dt);
    if (s.shake > 0) { camera.rotateZ(Math.sin(T * 47) * s.shake * 0.025); camera.rotateX(Math.sin(T * 31) * s.shake * 0.012); }
  });

  if (import.meta.env.DEV) Object.assign(window, { __stones: { st: st.current, ui: ui.state, count: () => count(st.current.stones) } });
  // Start the first throw once mounted.
  useEffect(() => { st.current.phase = 'aim'; st.current.turn = YOU; st.current.first = YOU; drawPath(0, 1); ui.set({ phase: 'aim', turn: YOU }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <group>
      {Array.from({ length: PER * 2 }, (_, i) => <Stone key={i} team={i < PER ? YOU : HILD} setRef={(g) => { groups.current[i] = g; }} />)}
      {Array.from({ length: PER * 2 }, (_, i) => <mesh key={`r${i}`} ref={(m) => { rings.current[i] = m; }} geometry={ringGeo} material={ringMats[i]} visible={false} />)}
      <points ref={path} geometry={pathGeo} material={pathMat} frustumCulled={false} />
      <points ref={frost} geometry={frostGeo} material={frostMat} frustumCulled={false} />
    </group>
  );
}

// ---- The HUD: the scoreboard, the stones left, the head from above, and the weight meter.
// Memoised: the meter and the broom's bar redraw the HUD every frame, the map only when a stone has moved.
const HouseMap = memo(function HouseMap({ marks }: { marks: Mark[] }) {
  // Map the house and the guard zone in front of it: z from TEE_Z−5 to HOG_Z, x ±SIDE.
  const Z0 = BACK_Z - 0.6, Z1 = HOG_Z + 0.6, Wd = 2 * SIDE, H = Z1 - Z0, S = 150 / Wd;
  const px = (x: number) => (x + SIDE) * S, pz = (z: number) => (z - Z0) * S;
  return (
    <svg className="st-map" width={Wd * S} height={H * S} viewBox={`0 0 ${Wd * S} ${H * S}`}>
      <rect width={Wd * S} height={H * S} fill="rgba(214,232,244,0.88)" rx="4" />
      {[[HOUSE_R, '#6fa2c9'], [HOUSE_R * 2 / 3, '#eef4f8'], [HOUSE_R / 3, '#7f878f'], [0.62, '#f2f6f9']].map(([r, c]) => <circle key={c as string} cx={px(0)} cy={pz(TEE_Z)} r={(r as number) * S} fill={c as string} />)}
      <line x1={0} x2={Wd * S} y1={pz(HOG_Z)} y2={pz(HOG_Z)} stroke="#7a2f2f" strokeWidth="2" />
      <line x1={0} x2={Wd * S} y1={pz(BACK_Z)} y2={pz(BACK_Z)} stroke="#33414d" strokeWidth="1.2" />
      <line x1={0} x2={Wd * S} y1={pz(TEE_Z)} y2={pz(TEE_Z)} stroke="#33414d" strokeWidth="0.8" />
      {marks.filter((m) => m.z < Z1 + 1).map((m, i) => (
        <g key={i}>
          {m.shot && <circle cx={px(m.x)} cy={pz(Math.max(Z0, m.z))} r={R * S + 4} fill="none" stroke="#ffd23f" strokeWidth="2.2" />}
          <circle cx={px(m.x)} cy={pz(Math.max(Z0, m.z))} r={R * S} fill="#6d6f72" stroke={HANDLE[m.team]} strokeWidth="2.6" />
        </g>
      ))}
    </svg>
  );
});

function Hud() {
  const s = ui.use();
  return (
    <>
      <div className="st-board">
        <div className="st-end">{s.banner} <small>of {ENDS}</small></div>
        <div className="st-score">
          {[YOU, HILD].map((t) => (
            <div key={t} className={`st-side ${s.turn === t && s.phase !== 'count' ? 'up' : ''}`}>
              <span className="st-name" style={{ ['--h' as string]: HANDLE[t] }}>{NAMES[t]}</span>
              <b>{s.score[t]}</b>
              <span className="st-pips">{Array.from({ length: PER }, (_, i) => <i key={i} className={i < s.left[t] ? 'on' : ''} style={{ ['--h' as string]: HANDLE[t] }} />)}</span>
            </div>
          ))}
        </div>
      </div>
      <HouseMap marks={s.marks} />
      <div className="game-hud st-hud">
        {(s.phase === 'aim' || s.phase === 'charge') && (
          <div className="st-meter">
            {ZONES.map(([n, a, b]) => <span key={n} className={`z ${n}`} style={{ left: `${a * 100}%`, width: `${(b - a) * 100}%` }}><em>{n}</em></span>)}
            <i style={{ left: `${s.power * 100}%` }} />
          </div>
        )}
        {s.phase === 'slide' && s.turn === YOU && <div className="st-sweep"><span style={{ width: `${s.sweep * 100}%` }} /></div>}
        <div className="line">{s.line}</div>
        {s.phase === 'aim' && <div className="hint"><kbd>A</kbd><kbd>D</kbd> line · <kbd>W</kbd><kbd>S</kbd> curl {s.spin > 0 ? '↻ right' : '↺ left'} · hold <kbd>Space</kbd> for weight</div>}
        {s.phase === 'charge' && <div className="hint">the bar shows where it stops on clean ice · let go of <kbd>Space</kbd> to throw</div>}
        {s.phase === 'slide' && s.turn === YOU && <div className="hint">tap <kbd>Space</kbd> to sweep: further and straighter</div>}
        {s.phase === 'slide' && s.turn === HILD && <div className="hint"><kbd>E</kbd> hurry it along</div>}
        {s.phase === 'settle' && <div className="hint"><kbd>E</kbd> next stone</div>}
      </div>
    </>
  );
}

register({
  id: 'stones', name: 'Ice Stones',
  pitch: 'Curling on the frozen floor of High Marrow, against the house champion, Hild. Two ends, four stones each. The stones nearest the button score. Sweep to carry a stone further and straighter.',
  keys: [['A D or ← →', 'line'], ['W S or ↑ ↓', 'curl'], ['Space', 'hold for weight, tap to sweep'], ['E', 'hurry along'], ['Esc', 'leave']],
  entry: 500,
  Station, Play, Hud,
  view: () => VIEW,
});
