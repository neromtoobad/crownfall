// House Halloway's game, down the long range in the hunting lodge at Pinewatch: five arrows at three straw butts.
// Hold to draw (a full draw takes a moment; hold too long and your arm starts to shake), aim with the mouse or the
// arrow keys, let go to loose. Arrows drop with distance and drift with the realm's wind, so on the far butts you
// hold over and into the wind; the pennant and the wind vane tell you how hard it's blowing. The last butt swings
// on its ropes. Rings 10 / 8 / 6 / 4 / 2; 30 wins. A gold rides the arrow in, slowed down.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { burst, voice } from '../realm/sound.ts';
import { FireLight, Flames, type FlameSpot } from '../realm/fire.tsx';
import type { Room } from '../realm/rooms.ts';
import { keys, usePlay } from '../realm/play.ts';
import { drawSigil, sigilsReady } from '../realm/sigils.ts';
import { wind } from '../realm/wind.ts';
import { gameKeys, gameUi, register, session, type Result } from './host.ts';
import './archery.css';

// ---- The range, in the lodge's frame (x right, z toward the door). You shoot from the line at z 27 toward −z.
const LINE = 27;
const EYE = new THREE.Vector3(0.75, 3.35, LINE + 2.2);
const R = 1.15;                       // the painted face's radius
const BUTT_Y = 3.0;
const FAR_PIVOT = new THREE.Vector3(0, 8.7, -22), FAR_L = 5.7;
const BACKSTOP = -26.6;
const ARROWS = 5, TO_WIN = 30;
const G = 7.2, WIND_K = 11;
const RING_PTS = [10, 8, 6, 4, 2];
const RING_NAME = ['gold', 'red', 'blue', 'black', 'white'];

type Butt = { name: string; paces: number; z: number };
const BUTTS: Butt[] = [
  { name: 'the near butt', paces: 20, z: 10 },
  { name: 'the middle butt', paces: 35, z: -6 },
  { name: 'the swinging butt', paces: 50, z: -22 },
];
/** Which butt each arrow is called for. */
const CALL = [0, 0, 1, 1, 2];

/** A butt's face centre at a game-clock time (the far one swings on its ropes). */
function buttAt(i: number, t: number, out: THREE.Vector3, swinging: boolean) {
  if (i === 0) return out.set(-4, BUTT_Y, BUTTS[0].z);
  if (i === 1) return out.set(3.5, BUTT_Y, BUTTS[1].z);
  const th = swinging ? Math.sin(t * 1.25) * 0.4 : 0;
  return out.set(FAR_PIVOT.x + Math.sin(th) * FAR_L, FAR_PIVOT.y - Math.cos(th) * FAR_L, FAR_PIVOT.z);
}
const swingAngle = (t: number, swinging: boolean) => (swinging ? Math.sin(t * 1.25) * 0.4 : 0);

// ---- The painted face: five rings on a canvas cloth, Halloway's stag in the gold's shadow.
let faceTex: THREE.CanvasTexture | undefined;
function paintFace(c: HTMLCanvasElement) {
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 512, 512);
  const cols = ['#e2b23c', '#a8241d', '#2c5a8c', '#1b1714', '#ece2c8'];
  for (let i = 4; i >= 0; i--) { g.fillStyle = cols[i]; g.beginPath(); g.arc(256, 256, ((i + 1) / 5) * 252, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 3;
  for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(256, 256, ((i + 1) / 5) * 252 - 1.5, 0, Math.PI * 2); g.stroke(); }
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2;
  g.beginPath(); g.arc(256, 256, (3 / 5) * 252 + 1.5, 0, Math.PI * 2); g.stroke();
  // Weave and weather.
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '255,240,210' : '40,25,10'},${0.04 + rnd() * 0.06})`; g.fillRect(rnd() * 512, rnd() * 512, 1 + rnd() * 3, 1 + rnd() * 3); }
  drawSigil(g, 4, 256 - 34, 256 - 34, 68, 'rgba(60,30,8,0.45)');
  // Old arrow holes.
  for (let i = 0; i < 40; i++) { const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 240; g.fillStyle = 'rgba(20,12,6,0.7)'; g.beginPath(); g.arc(256 + Math.cos(a) * d, 256 + Math.sin(a) * d, 2.2, 0, Math.PI * 2); g.fill(); }
}
function faceTexture() {
  if (faceTex) return faceTex;
  const c = document.createElement('canvas'); c.width = c.height = 512;
  paintFace(c);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  sigilsReady(() => { paintFace(c); tex.needsUpdate = true; });
  return (faceTex = tex);
}
let strawTex: THREE.CanvasTexture | undefined;
function strawTexture() {
  if (strawTex) return strawTex;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b8964f'; g.fillRect(0, 0, 256, 256);
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1400; i++) { const x = rnd() * 256, y = rnd() * 256, a = (rnd() - 0.5) * 0.7; g.strokeStyle = `rgba(${rnd() < 0.5 ? '240,215,140' : '110,80,30'},${0.3 + rnd() * 0.4})`; g.lineWidth = 1 + rnd(); g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 18, y + Math.sin(a) * 18); g.stroke(); }
  strawTex = new THREE.CanvasTexture(c); strawTex.colorSpace = THREE.SRGBColorSpace; strawTex.wrapS = strawTex.wrapT = THREE.RepeatWrapping;
  return strawTex;
}

const timber = new THREE.MeshStandardMaterial({ color: '#5b4129', roughness: 0.85 });
const dark = new THREE.MeshStandardMaterial({ color: '#2c2219', roughness: 0.9 });
const rope = new THREE.MeshStandardMaterial({ color: '#a38a5c', roughness: 1 });

/** One butt: a round straw boss bound with cord, the painted face pinned on the front. Centred on the face. */
function ButtMesh() {
  const face = useMemo(faceTexture, []), straw = useMemo(strawTexture, []);
  return (
    <group>
      <mesh rotation-x={Math.PI / 2} position={[0, 0, -0.35]} castShadow receiveShadow>
        <cylinderGeometry args={[R * 1.12, R * 1.12, 0.7, 28]} /><meshStandardMaterial map={straw} roughness={1} />
      </mesh>
      {[-0.2, -0.5].map((z) => <mesh key={z} position={[0, 0, z]}><torusGeometry args={[R * 1.13, 0.03, 5, 28]} /><meshStandardMaterial color="#6a4f2c" roughness={1} /></mesh>)}
      <mesh position={[0, 0, 0.005]}><circleGeometry args={[R, 48]} /><meshStandardMaterial map={face} roughness={0.95} /></mesh>
    </group>
  );
}

/** An easel stand: the butt leans on two front legs and a back prop. */
function Easel() {
  return (
    <group>
      {[-0.75, 0.75].map((x) => <mesh key={x} material={timber} position={[x, 1.25, 0.15]} rotation-x={-0.12} castShadow><boxGeometry args={[0.16, 2.6, 0.16]} /></mesh>)}
      <mesh material={timber} position={[0, 1.15, -1.0]} rotation-x={0.45} castShadow><boxGeometry args={[0.16, 2.6, 0.16]} /></mesh>
      <mesh material={timber} position={[0, 1.75, 0.05]} castShadow><boxGeometry args={[1.8, 0.14, 0.2]} /></mesh>
    </group>
  );
}

/** The pennant: a long tongue of Halloway green on a pole beside the range, streaming with the wind. */
function Pennant({ at }: { at: [number, number, number] }) {
  const cloth = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => new THREE.PlaneGeometry(3.2, 0.7, 16, 2).translate(1.6, 0, 0), []);
  const base = useMemo(() => Float32Array.from(geo.attributes.position.array as Float32Array), [geo]);
  useFrame(({ clock }) => {
    const m = cloth.current; if (!m) return;
    const g = wind.gust.value, t = clock.elapsedTime;
    // Point the way the wind blows (in the hall's frame, same as the world's), droop when it's slack.
    m.rotation.y = Math.atan2(-wind.dir.value.y, wind.dir.value.x);
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1], k = x / 3.2;
      const taper = 1 - k * 0.75;
      const droop = (1 - g) * 1.6 * k * k;
      p.setXYZ(i, x * (0.75 + g * 0.25), y * taper - droop, Math.sin(x * 2.4 - t * (5 + g * 7)) * 0.18 * k * (0.4 + g));
    }
    p.needsUpdate = true; geo.computeVertexNormals();
  });
  return (
    <group position={at}>
      <mesh material={dark} position={[0, 4.5, 0]} castShadow><cylinderGeometry args={[0.07, 0.1, 9, 8]} /></mesh>
      <mesh position={[0, 9.05, 0]}><sphereGeometry args={[0.13, 10, 8]} /><meshStandardMaterial color="#c9a24a" metalness={0.7} roughness={0.35} /></mesh>
      <mesh ref={cloth} geometry={geo} position={[0, 8.5, 0]}><meshStandardMaterial color="#2f6a3a" side={THREE.DoubleSide} roughness={0.9} /></mesh>
    </group>
  );
}

/** Everything that always stands: the shooting line, the bow rack, the hay wall at the end, the swinging gallows,
 * braziers by each butt and the pennants. */
function Range() {
  const straw = useMemo(strawTexture, []);
  const bale = useMemo(() => new THREE.MeshStandardMaterial({ map: straw, roughness: 1, color: '#d8c290' }), [straw]);
  const flames = useMemo<FlameSpot[]>(() => [[-6.6, 2.15, BUTTS[0].z + 1, 0.7], [6.1, 2.15, BUTTS[1].z + 1, 0.7], [-4.6, 2.15, BUTTS[2].z + 1.5, 0.8], [4.6, 2.15, BUTTS[2].z + 1.5, 0.8]], []);
  return (
    <group>
      {/* The line: a rope pegged across the floor, and a strip of sawdust. */}
      <mesh position={[0, 0.03, LINE]} rotation-x={-Math.PI / 2}><planeGeometry args={[7, 1.2]} /><meshStandardMaterial color="#cdb68a" roughness={1} /></mesh>
      <mesh material={rope} position={[0, 0.08, LINE - 0.6]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.04, 0.04, 7, 6]} /></mesh>
      {[-3.5, 3.5].map((x) => <mesh key={x} material={timber} position={[x, 0.3, LINE - 0.6]}><cylinderGeometry args={[0.08, 0.05, 0.6, 6]} /></mesh>)}
      {/* Bow rack by the line. */}
      <group position={[-4.5, 0, LINE + 0.5]}>
        {[-0.8, 0.8].map((x) => <mesh key={x} material={timber} position={[x, 1.3, 0]} castShadow><boxGeometry args={[0.18, 2.6, 0.3]} /></mesh>)}
        {[0.8, 2.0].map((y) => <mesh key={y} material={timber} position={[0, y, 0.1]} castShadow><boxGeometry args={[1.9, 0.12, 0.3]} /></mesh>)}
        {[-0.45, 0, 0.45].map((x) => <mesh key={x} position={[x, 1.6, 0.2]} rotation-z={0.06}><torusGeometry args={[1.1, 0.04, 5, 20, Math.PI * 0.8]} /><meshStandardMaterial color="#7a5430" roughness={0.6} /></mesh>)}
        {/* A quiver barrel. */}
        <mesh material={dark} position={[1.6, 0.55, 0]} castShadow><cylinderGeometry args={[0.32, 0.28, 1.1, 12]} /></mesh>
        {Array.from({ length: 9 }, (_, i) => <mesh key={i} position={[1.6 + Math.cos(i * 2.4) * 0.16, 1.35, Math.sin(i * 2.4) * 0.16]} rotation={[Math.sin(i) * 0.12, 0, Math.cos(i) * 0.12]}><cylinderGeometry args={[0.015, 0.015, 1.4, 4]} /><meshStandardMaterial color="#c9b48a" /></mesh>)}
      </group>
      {/* The hay wall at the end of the range. */}
      {Array.from({ length: 24 }, (_, i) => {
        const row = Math.floor(i / 6), col = i % 6;
        return <mesh key={i} material={bale} position={[-7.5 + col * 3 + (row % 2) * 1.5 - 0.75, 0.55 + row * 1.1, BACKSTOP - 0.6 - (i % 3) * 0.06]} castShadow receiveShadow><boxGeometry args={[2.9, 1.08, 1.3]} /></mesh>;
      })}
      {/* The near and middle easels. */}
      <group position={[-4, 0, BUTTS[0].z - 0.2]}><Easel /></group>
      <group position={[3.5, 0, BUTTS[1].z - 0.2]}><Easel /></group>
      {/* The gallows the far butt swings from. */}
      {[-3.6, 3.6].map((x) => <mesh key={x} material={timber} position={[x, 4.6, FAR_PIVOT.z - 0.4]} castShadow><boxGeometry args={[0.36, 9.2, 0.36]} /></mesh>)}
      <mesh material={timber} position={[0, FAR_PIVOT.y + 0.2, FAR_PIVOT.z - 0.4]} castShadow><boxGeometry args={[8, 0.4, 0.5]} /></mesh>
      {[-1, 1].map((s) => <mesh key={s} material={timber} position={[s * 3.0, 0.15, FAR_PIVOT.z - 0.4]} castShadow><boxGeometry args={[1.6, 0.3, 1.6]} /></mesh>)}
      {/* Braziers on iron tripods beside the butts. */}
      {flames.map(([x, y, z], i) => (
        <group key={i} position={[x, 0, z]}>
          {[0, 1, 2].map((k) => <mesh key={k} position={[Math.cos(k * 2.1) * 0.25, 1, Math.sin(k * 2.1) * 0.25]} rotation={[Math.sin(k * 2.1) * 0.2, 0, -Math.cos(k * 2.1) * 0.2]}><cylinderGeometry args={[0.03, 0.03, 2.1, 4]} /><meshStandardMaterial color="#1f1a17" metalness={0.5} /></mesh>)}
          <mesh position={[0, y - 0.05, 0]}><cylinderGeometry args={[0.45, 0.25, 0.35, 10, 1, true]} /><meshStandardMaterial color="#2a2420" metalness={0.5} side={THREE.DoubleSide} /></mesh>
        </group>
      ))}
      <Flames spots={flames} />
      <FireLight position={[-7, 4, BUTTS[0].z + 4]} color="#ffae63" intensity={45} distance={14} />
      <FireLight position={[6.5, 4, BUTTS[1].z + 4]} color="#ffae63" intensity={45} distance={14} />
      <FireLight position={[0, 6, BUTTS[2].z + 6]} color="#ffae63" intensity={70} distance={18} />
      <Pennant at={[9, 0, 6]} />
      <Pennant at={[-9, 0, -14]} />
    </group>
  );
}

/** The far butt on its two ropes, hung from the pivot; `swing` is the angle. */
function FarButt({ refs }: { refs?: (g: THREE.Group | null) => void }) {
  return (
    <group ref={refs} position={FAR_PIVOT.toArray()}>
      {[-0.7, 0.7].map((x) => <mesh key={x} material={rope} position={[x * 0.9, -FAR_L / 2 + 0.35, -0.3]}><cylinderGeometry args={[0.035, 0.035, FAR_L - 0.7, 5]} /></mesh>)}
      <group position={[0, -FAR_L, 0]}><ButtMesh /></group>
    </group>
  );
}

function Station() {
  const playing = usePlay().game && session.phase === 'play';
  return (
    <group>
      <Range />
      {!playing && (
        <>
          <group position={[-4, BUTT_Y, BUTTS[0].z]}><ButtMesh /></group>
          <group position={[3.5, BUTT_Y, BUTTS[1].z]}><ButtMesh /></group>
          <FarButt />
        </>
      )}
    </group>
  );
}

// ---- The arrow and the bow.
const arrowGeo = (() => {
  const shaft = new THREE.CylinderGeometry(0.018, 0.018, 1.45, 5).rotateX(Math.PI / 2).translate(0, 0, 0.72); // tip at z=0, nock at +1.45
  const head = new THREE.ConeGeometry(0.045, 0.16, 4).rotateX(-Math.PI / 2).translate(0, 0, -0.06);
  const fl = new THREE.PlaneGeometry(0.07, 0.24).translate(0.035, 0, 0).rotateY(Math.PI / 2);
  const fletch = [0, 1, 2].map((i) => fl.clone().rotateY(-Math.PI / 2).rotateZ((i * Math.PI * 2) / 3).translate(0, 0, 1.25));
  return { shaft, head, fletch };
})();
const shaftMat = new THREE.MeshStandardMaterial({ color: '#c9a56e', roughness: 0.6 });
const headMat = new THREE.MeshStandardMaterial({ color: '#4a4c4f', metalness: 0.8, roughness: 0.35 });
const fletchMat = [new THREE.MeshStandardMaterial({ color: '#2f6a3a', side: THREE.DoubleSide }), new THREE.MeshStandardMaterial({ color: '#efe6cf', side: THREE.DoubleSide })];

/** An arrow pointing down −z, its tip at the origin. */
function Arrow({ refs }: { refs?: (g: THREE.Group | null) => void }) {
  return (
    <group ref={refs}>
      <mesh geometry={arrowGeo.shaft} material={shaftMat} />
      <mesh geometry={arrowGeo.head} material={headMat} />
      {arrowGeo.fletch.map((g, i) => <mesh key={i} geometry={g} material={fletchMat[i === 0 ? 1 : 0]} />)}
    </group>
  );
}

const BOW_H = 1.45;
const limbGeo = (() => {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 20; i++) { const y = -BOW_H + (i / 20) * BOW_H * 2, k = y / BOW_H; pts.push(new THREE.Vector3(0, y, 0.32 * k * k)); }
  const curve = new THREE.CatmullRomCurve3(pts);
  return new THREE.TubeGeometry(curve, 40, 0.035, 6, false);
})();
const yew = new THREE.MeshStandardMaterial({ color: '#8a5a2e', roughness: 0.5 });
const strMat = new THREE.MeshBasicMaterial({ color: '#e8e0cc' });

// ---- The round.
type Phase = 'ready' | 'flight' | 'look' | 'done';
const ui = gameUi({
  arrow: 1, score: 0, phase: 'ready' as Phase, draw: 0, shake: 0, line: '', last: '', ring: '', hits: [] as number[],
  butt: 0, gust: 0.5, windDeg: 0, cam: false,
});

interface Shot { path: THREE.Vector3[]; dt: number; T: number; hit: number; pts: number; local: THREE.Vector3; end: THREE.Vector3; dir: THREE.Vector3; gold: boolean; at: number }
interface Stuck { butt: number; local: THREE.Vector3; end: THREE.Vector3; dir: THREE.Vector3; at: number }

function twang(p: number) { burst(150 + p * 60, 7, 0.25 + p * 0.2, 0.22); burst(900, 4, 0.08, 0.06); burst(3200, 2, 0.04, 0.05); }
function creak() { burst(220 + Math.random() * 120, 14, 0.035, 0.07); }
function strawThunk(loud = 1) { burst(170, 1.2, 0.4 * loud, 0.14); burst(2100, 1.5, 0.08 * loud, 0.08); }
function woodThunk() { burst(240, 4, 0.3, 0.12); burst(1300, 5, 0.08, 0.06); }
function cheer(big: boolean) {
  const n = big ? 5 : 2;
  for (let i = 0; i < n; i++) setTimeout(() => voice(i % 2 ? 'soldier' : 'man', big ? 20 : 10, (i / n) * 1.4 - 0.7, true), i * 90);
  for (let i = 0; i < (big ? 30 : 8); i++) burst(1700 + Math.random() * 2400, 3, 0.03, 0.035, 0.2 + Math.random() * (big ? 1.3 : 0.5));
}

function Play({ room, end }: { room: Room; end: (r: Result) => void }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const far = useRef<THREE.Group | null>(null);
  const rig = useRef<THREE.Group>(null);
  const limb = useRef<THREE.Group>(null);
  const bend = useRef<THREE.Group>(null);
  const strings = useRef<(THREE.Mesh | null)[]>([]);
  const nocked = useRef<THREE.Group | null>(null);
  const arrows = useRef<(THREE.Group | null)[]>([]);
  const flash = useRef<THREE.PointLight>(null);
  const puff = useRef<THREE.Points>(null);
  const PUFF = 30;
  const dust = useMemo(() => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PUFF * 3), 3));
    return { g, p: Array.from({ length: PUFF }, () => new THREE.Vector3()), v: Array.from({ length: PUFF }, () => new THREE.Vector3()), t: 9 };
  }, []);
  const st = useRef({
    phase: 'ready' as Phase, t: 0, clock: 0, arrow: 0, score: 0, hits: [] as number[],
    yaw: 0, pitch: -0.07, draw: 0, full: 0, sway: new THREE.Vector2(), mouse: false, creakT: 0,
    shot: undefined as Shot | undefined, stuck: [] as (Stuck | undefined)[], slow: false, trauma: 0, endAt: 0, recoil: 0,
  });
  useMemo(() => { ui.reset(); ui.set({ hits: [], line: `Arrow one: ${BUTTS[0].name}, ${BUTTS[0].paces} paces. Hold to draw.` }); }, []);
  const v1 = useMemo(() => new THREE.Vector3(), []), v2 = useMemo(() => new THREE.Vector3(), []), v3 = useMemo(() => new THREE.Vector3(), []);
  const camPos = useMemo(() => new THREE.Vector3(), []), look = useMemo(() => new THREE.Vector3(), []);
  const ox = room.x, oz = room.z;

  // Mouse: hold the left button to draw; move to aim (pointer lock gives movement, so does a plain move).
  useEffect(() => {
    const el = gl.domElement;
    const down = (e: PointerEvent) => { if (e.button === 0) st.current.mouse = true; };
    const up = (e: PointerEvent) => { if (e.button === 0) st.current.mouse = false; };
    const move = (e: PointerEvent) => {
      const s = st.current; if (s.phase !== 'ready') return;
      const k = s.draw > 0.05 ? 0.0009 : 0.0016;
      s.yaw = THREE.MathUtils.clamp(s.yaw + e.movementX * k, -0.4, 0.4);
      s.pitch = THREE.MathUtils.clamp(s.pitch - e.movementY * k, -0.12, 0.2);
    };
    el.addEventListener('pointerdown', down); window.addEventListener('pointerup', up); window.addEventListener('pointermove', move);
    return () => { el.removeEventListener('pointerdown', down); window.removeEventListener('pointerup', up); window.removeEventListener('pointermove', move); };
  }, [gl]);

  /** Fly an arrow from `from` along `dir` at `speed`, through gravity and today's wind, against the three butts,
   * the hay wall, the floor and the walls. `t0` is the game clock at release (the far butt is swinging). */
  const simulate = (from: THREE.Vector3, dir: THREE.Vector3, speed: number, t0: number, called: number): Shot => {
    const dt = 1 / 240, gust = wind.gust.value;
    const acc = new THREE.Vector3(wind.dir.value.x * gust * WIND_K, -G, wind.dir.value.y * gust * WIND_K);
    const p = from.clone(), v = dir.clone().multiplyScalar(speed), prev = new THREE.Vector3();
    const path: THREE.Vector3[] = [p.clone()];
    const c = new THREE.Vector3();
    for (let i = 1; i < 240 * 3; i++) {
      prev.copy(p); v.addScaledVector(acc, dt); p.addScaledVector(v, dt); path.push(p.clone());
      const t = i * dt;
      for (let b = 0; b < 3; b++) {
        const z = BUTTS[b].z;
        if (prev.z > z && p.z <= z) {
          const u = (prev.z - z) / (prev.z - p.z), x = prev.x + (p.x - prev.x) * u, y = prev.y + (p.y - prev.y) * u;
          buttAt(b, t0 + t, c, true);
          const dx = x - c.x, dy = y - c.y, r = Math.hypot(dx, dy);
          if (r <= R * 1.1) {
            const ring = Math.min(4, Math.floor((r / R) * 5));
            const pts = r <= R && b === called ? RING_PTS[ring] : 0;
            const end = new THREE.Vector3(x, y, z);
            path[path.length - 1].copy(end);
            return { path, dt, T: t, hit: b, pts, local: new THREE.Vector3(dx, dy, 0), end, dir: v.clone().normalize(), gold: pts === 10, at: t0 + t };
          }
        }
      }
      if (p.z <= BACKSTOP || p.y <= 0.05 || Math.abs(p.x) > 18 || p.y > 16) {
        const end = p.clone(); end.z = Math.max(end.z, BACKSTOP); end.y = Math.max(end.y, 0.05);
        path[path.length - 1].copy(end);
        return { path, dt, T: t, hit: -1, pts: 0, local: new THREE.Vector3(), end, dir: v.clone().normalize(), gold: false, at: t0 + t };
      }
    }
    return { path, dt, T: 3, hit: -1, pts: 0, local: new THREE.Vector3(), end: p.clone(), dir: v.clone().normalize(), gold: false, at: t0 + 3 };
  };

  if (import.meta.env.DEV) Object.assign(window, { __arc: st.current, __arcSim: simulate, __arcEye: EYE });

  useFrame(({ clock: c }, rawDt) => {
    const s = st.current;
    rawDt = Math.min(rawDt, 0.05);
    const dt = rawDt * (s.slow ? 0.28 : 1);
    s.t += dt; s.clock += dt;
    const now = c.elapsedTime;
    gameKeys(); // Esc; the rest is read held
    const held = keys.has(' ') || s.mouse;
    // The far butt swings.
    if (far.current) far.current.rotation.z = swingAngle(s.clock, true);
    if (s.phase === 'ready') {
      // Aim with the keys (finer once drawn).
      const k = (s.draw > 0.05 ? 0.16 : 0.42) * rawDt;
      if (keys.has('arrowleft') || keys.has('a')) s.yaw -= k;
      if (keys.has('arrowright') || keys.has('d')) s.yaw += k;
      if (keys.has('arrowup') || keys.has('w')) s.pitch += k;
      if (keys.has('arrowdown') || keys.has('s')) s.pitch -= k;
      s.yaw = THREE.MathUtils.clamp(s.yaw, -0.4, 0.4); s.pitch = THREE.MathUtils.clamp(s.pitch, -0.12, 0.2);
      if (held) {
        const was = s.draw;
        s.draw = Math.min(1, s.draw + rawDt / 0.85);
        if (s.draw >= 1) { if (was < 1) burst(600, 12, 0.05, 0.05); s.full += rawDt; }
        s.creakT -= rawDt;
        if (s.draw < 1 && s.creakT <= 0) { creak(); s.creakT = 0.09; }
      } else if (s.draw > 0.08) {
        // Loose.
        const p = s.draw;
        const dir = v1.set(Math.sin(s.yaw + s.sway.x) * Math.cos(s.pitch + s.sway.y), Math.sin(s.pitch + s.sway.y), -Math.cos(s.yaw + s.sway.x) * Math.cos(s.pitch + s.sway.y)).normalize();
        const from = v2.copy(EYE).addScaledVector(dir, 1.6).add(v3.set(-0.12, -0.12, 0));
        const speed = 26 + 54 * Math.pow(p, 1.5);
        s.shot = simulate(from, dir, speed, s.clock, CALL[s.arrow]);
        s.slow = s.shot.gold;
        s.phase = 'flight'; s.t = 0; s.draw = 0; s.full = 0; s.recoil = 1;
        twang(p);
        const a = arrows.current[s.arrow]; if (a) a.visible = true;
        ui.set({ phase: 'flight', draw: 0, shake: 0, cam: s.slow, line: s.slow ? '' : ui.state.line });
      } else s.draw = Math.max(0, s.draw - rawDt * 3);
      // Sway: a breath always; once at full draw, the longer you hold, the more the bow wanders and shakes.
      const amp = 0.0022 + Math.min(0.02, Math.max(0, s.full - 1.4) * 0.0065);
      const tr = Math.max(0, s.full - 3.2);
      s.sway.set(amp * (Math.sin(now * 1.9) + 0.6 * Math.sin(now * 4.7 + 1)) + tr * 0.002 * Math.sin(now * 37),
        amp * (Math.cos(now * 1.4) * 0.8 + 0.5 * Math.sin(now * 3.9 + 2)) + 0.0015 * Math.sin(now * 1.2) + tr * 0.002 * Math.sin(now * 41 + 1));
      ui.set({ draw: s.draw, shake: Math.min(1, Math.max(0, s.full - 1.4) / 3) });
    } else if (s.phase === 'flight') {
      const sh = s.shot!;
      const a = arrows.current[s.arrow];
      const i = Math.min(sh.path.length - 1, Math.floor(s.t / sh.dt));
      const p = sh.path[i], pn = sh.path[Math.min(sh.path.length - 1, i + 1)];
      if (a) {
        a.position.copy(p);
        v1.subVectors(pn, p); if (v1.lengthSq() > 1e-8) a.quaternion.setFromUnitVectors(v3.set(0, 0, -1), v1.normalize());
      }
      if (s.slow && i % 6 === 0) burst(1800 + i * 3, 6, 0.012, 0.03); // the whistle as it rides
      if (s.t >= sh.T) {
        // Impact.
        s.stuck[s.arrow] = { butt: sh.hit, local: sh.local, end: sh.end.clone(), dir: sh.dir.clone(), at: now };
        s.score += sh.pts; s.hits.push(sh.pts);
        let line = '';
        const called = CALL[s.arrow];
        if (sh.hit >= 0) {
          strawThunk(1 + sh.pts / 10);
          const ring = Math.min(4, Math.floor((sh.local.length() / R) * 5));
          if (sh.hit !== called) line = `That’s ${BUTTS[sh.hit].name}. It was ${BUTTS[called].name} you were called for.`;
          else if (sh.local.length() > R) line = 'In the straw, off the cloth. Nothing.';
          else if (sh.pts === 10) { line = 'Gold! Right through the stag.'; cheer(true); }
          else if (sh.pts === 8) { line = 'The red. Eight.'; cheer(false); }
          else line = `${RING_NAME[ring][0].toUpperCase()}${RING_NAME[ring].slice(1)} ring. ${sh.pts}.`;
          s.trauma = 0.2 + sh.pts / 30;
          dust.t = 0;
          for (let k = 0; k < PUFF; k++) { dust.p[k].copy(sh.end); dust.v[k].set((Math.random() - 0.5) * 2.2, Math.random() * 2, Math.random() * 1.8 + 0.4); }
          if (flash.current) { flash.current.position.copy(sh.end).add(v3.set(0, 0, 1.2)); flash.current.intensity = 8 + sh.pts * 4; }
        } else {
          if (sh.end.z <= BACKSTOP + 0.01) { strawThunk(0.6); line = 'Over and into the hay.'; }
          else if (sh.end.y <= 0.06) { woodThunk(); line = 'Short. It skids into the boards.'; }
          else { woodThunk(); line = 'Wide, into the timber.'; }
          voice('man', 10, 0.3, false);
        }
        s.phase = 'look'; s.t = 0;
        ui.set({ phase: 'look', score: s.score, hits: [...s.hits], last: sh.pts ? `+${sh.pts}` : '0', ring: sh.pts === 10 ? 'gold' : '', line, cam: s.slow });
      }
    } else if (s.phase === 'look') {
      if (s.t > (s.slow ? 0.45 : 1.5)) {
        s.slow = false;
        s.arrow++;
        if (s.arrow >= ARROWS) {
          s.phase = 'done'; s.t = 0;
          const won = s.score >= TO_WIN;
          ui.set({ phase: 'done', cam: false, line: won ? 'The lodge drums its tankards for you.' : 'Not enough. The foresters go back to their ale.' });
          if (won) cheer(true); else voice('man', 16, 0, false);
        } else {
          const b = BUTTS[CALL[s.arrow]];
          s.phase = 'ready'; s.t = 0; s.pitch = -0.07; s.yaw *= 0.3;
          const tip = CALL[s.arrow] === 1 ? ' Further now: aim a hand high.' : CALL[s.arrow] === 2 ? ' It swings. Hold high and into the wind, and lead it.' : '';
          ui.set({ phase: 'ready', arrow: s.arrow + 1, butt: CALL[s.arrow], last: '', ring: '', cam: false, line: `Arrow ${['one', 'two', 'three', 'four', 'five'][s.arrow]}: ${b.name}, ${b.paces} paces.${tip}` });
        }
      }
    } else if (s.phase === 'done') {
      if (s.t > 1.8) {
        s.t = -1e9;
        const won = s.score >= TO_WIN;
        end({ won, score: s.score, grade: (s.score - TO_WIN) / (50 - TO_WIN), line: `${s.score} from five arrows (${s.hits.join(' · ')}). ${won ? (s.score >= 42 ? 'Halloway would take you for a forester.' : 'A fair day on the range.') : `You needed ${TO_WIN}.`}` });
      }
    }
    // Arrows that have landed stay put; the ones in the far butt swing with it, and each quivers when it bites.
    for (let i = 0; i < ARROWS; i++) {
      const a = arrows.current[i], l = s.stuck[i];
      if (!a || !l) continue;
      if (l.butt === 2) { buttAt(2, s.clock, v1, true); a.position.copy(v1).add(l.local); a.position.z = BUTTS[2].z; }
      else a.position.copy(l.end);
      const w = Math.exp(-(now - l.at) * 6) * Math.sin((now - l.at) * 45) * 0.05;
      a.quaternion.setFromUnitVectors(v3.set(0, 0, -1), l.dir);
      a.rotateX(w); a.rotateY(w * 0.6);
      a.translateZ(-0.35); // bury the head
    }
    // Wind for the HUD: the vane's angle as you face down the range (up the screen is downrange).
    ui.set({ gust: wind.gust.value, windDeg: (Math.atan2(wind.dir.value.x, -wind.dir.value.y) * 180) / Math.PI });
    // Dust off the straw.
    dust.t += dt;
    if (dust.t < 1.4) {
      const pos = dust.g.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < PUFF; k++) { dust.v[k].y -= 3 * dt; dust.v[k].multiplyScalar(1 - dt * 1.5); dust.p[k].addScaledVector(dust.v[k], dt); pos.setXYZ(k, dust.p[k].x, dust.p[k].y, dust.p[k].z); }
      pos.needsUpdate = true;
    }
    if (puff.current) puff.current.visible = dust.t < 1.4;
    if (flash.current) flash.current.intensity *= Math.exp(-rawDt * 6);
    // ---- Camera.
    const sh = s.shot;
    const ride = s.slow && sh && (s.phase === 'flight' || s.phase === 'look');
    if (ride) {
      // Arrow-cam: just behind and above the shaft, all the way in.
      const a = arrows.current[s.arrow]!;
      const d = s.phase === 'flight' ? v1.set(0, 0, -1).applyQuaternion(a.quaternion) : v1.copy(sh!.dir);
      const at = s.phase === 'flight' ? a.position : sh!.end;
      camPos.copy(at).addScaledVector(d, s.phase === 'flight' ? -2.4 : -3.6).add(v2.set(0.3, 0.42, 0)).add(v3.set(ox, 0, oz));
      look.copy(at).addScaledVector(d, 4).add(v3.set(ox, 0, oz));
      camera.position.lerp(camPos, 1 - Math.exp(-rawDt * 14));
      camera.lookAt(look);
    } else if (s.phase === 'look' && sh) {
      // The spotter's view: walk the eye down to where it struck.
      const tgt = sh.hit >= 0 ? buttAt(sh.hit, s.clock, v1, true) : v1.copy(sh.end);
      camPos.set(tgt.x + 1.6, tgt.y + 0.7, tgt.z + 6.5).add(v3.set(ox, 0, oz));
      look.copy(tgt).add(v3.set(ox, 0, oz));
      camera.position.lerp(camPos, 1 - Math.exp(-rawDt * 3.2));
      camera.lookAt(look);
    } else {
      const sx = s.yaw + s.sway.x, sy = s.pitch + s.sway.y;
      s.recoil = Math.max(0, s.recoil - rawDt * 3);
      camPos.copy(EYE).add(v3.set(ox, 0, oz)).add(v2.set(0, 0, s.draw * 0.25 - s.recoil * 0.15));
      look.set(camPos.x + Math.sin(sx) * 30, camPos.y + Math.sin(sy) * 30, camPos.z - Math.cos(sx) * 30);
      const back = s.phase === 'flight' ? 6 : s.t < 0.6 && s.arrow > 0 ? 7 : 40;
      camera.position.lerp(camPos, 1 - Math.exp(-rawDt * back));
      camera.lookAt(look);
    }
    const pc = camera as THREE.PerspectiveCamera;
    const fov = ride ? 50 : s.phase === 'ready' ? 40 - s.draw * 6 : 40;
    if (Math.abs(pc.fov - fov) > 0.05) { pc.fov += (fov - pc.fov) * (1 - Math.exp(-rawDt * 6)); pc.updateProjectionMatrix(); }
    s.trauma = Math.max(0, s.trauma - rawDt * 1.8);
    if (s.trauma > 0) { const t2 = s.trauma * s.trauma, tt = now * 29; camera.rotateX(Math.sin(tt) * t2 * 0.02); camera.rotateZ(Math.sin(tt * 1.6 + 2) * t2 * 0.025); }
    // ---- The bow rides with the camera at the line: grip low-left, string drawn back toward you.
    const r = rig.current;
    if (r) {
      r.visible = s.phase === 'ready' || (s.phase === 'flight' && !s.slow);
      r.position.copy(camera.position).sub(v3.set(ox, 0, oz));
      r.quaternion.copy(camera.quaternion);
      const d = s.draw;
      if (bend.current) bend.current.scale.z = 1 + d * 1.6;
      if (limb.current) { limb.current.position.set(-0.78, -0.12 + s.recoil * 0.05, -2.5); limb.current.rotation.z = 0.12; }
      // String: from each tip down/up to the nock, pulled back with the draw.
      const tipZ = 0.32 * (1 + d * 1.6), nockZ = 0.12 + d * 0.95 + tipZ * 0.15;
      for (let k = 0; k < 2; k++) {
        const m = strings.current[k]; if (!m) continue;
        const tip = v1.set(0, k ? -BOW_H : BOW_H, tipZ), nock = v2.set(0.0, 0, nockZ);
        const mid = v3.addVectors(tip, nock).multiplyScalar(0.5);
        m.position.copy(mid);
        const len = tip.distanceTo(nock);
        m.scale.set(1, len, 1);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tip.clone().sub(nock).normalize());
      }
      const nk = nocked.current;
      if (nk) { nk.visible = s.phase === 'ready' && s.draw > 0.02; nk.position.set(0.04, 0, nockZ - 1.45); }
    }
  });

  return (
    <group>
      <group position={[-4, BUTT_Y, BUTTS[0].z]}><ButtMesh /></group>
      <group position={[3.5, BUTT_Y, BUTTS[1].z]}><ButtMesh /></group>
      <FarButt refs={(g) => { far.current = g; }} />
      {Array.from({ length: ARROWS }, (_, i) => <Arrow key={i} refs={(g) => { arrows.current[i] = g; if (g && !g.userData.init) { g.userData.init = true; g.visible = false; } }} />)}
      <group ref={rig}>
        <group ref={limb}>
          <group ref={bend}><mesh geometry={limbGeo} material={yew} /></group>
          <mesh><cylinderGeometry args={[0.06, 0.06, 0.34, 8]} /><meshStandardMaterial color="#3b2416" roughness={0.9} /></mesh>
          {[0, 1].map((k) => <mesh key={k} ref={(m) => { strings.current[k] = m; }} material={strMat}><cylinderGeometry args={[0.006, 0.006, 1, 4]} /></mesh>)}
          <Arrow refs={(g) => { nocked.current = g; }} />
        </group>
      </group>
      <points ref={puff} geometry={dust.g} frustumCulled={false}><pointsMaterial color="#e2c98a" size={0.07} sizeAttenuation transparent opacity={0.85} /></points>
      <pointLight ref={flash} color="#ffe1a0" intensity={0} distance={9} decay={1.6} />
    </group>
  );
}

function Hud() {
  const s = ui.use();
  const deg = s.draw * 360;
  return (
    <>
      {s.phase === 'ready' && (
        <div className={`arc-sight ${s.draw >= 1 ? 'full' : ''}`} style={{ ['--shake' as string]: s.shake }}>
          <div className="ring" style={{ background: `conic-gradient(${s.draw >= 1 ? (s.shake > 0.5 ? '#ff8a5c' : '#ffd23f') : '#fff3d6'} ${deg}deg, rgba(255,255,255,0.12) ${deg}deg)` }} />
          <i className="dot" />
        </div>
      )}
      <div className="arc-wind">
        <div className="vane" style={{ transform: `rotate(${s.windDeg}deg)` }}><i /></div>
        <div className="meta"><small>wind</small><div className="bar"><i style={{ width: `${Math.round(s.gust * 100)}%` }} /></div><small className="v">{s.gust < 0.35 ? 'light' : s.gust < 0.6 ? 'steady' : s.gust < 0.8 ? 'fresh' : 'gusting'}</small></div>
      </div>
      {s.last && <div key={s.hits.length} className={`arc-pop ${s.ring === 'gold' ? 'gold' : s.last === '0' ? 'nil' : ''}`}>{s.last}</div>}
      {s.cam && <div className="arc-cam" />}
      <div className="game-hud">
        <div className="pips">{Array.from({ length: ARROWS }, (_, i) => <i key={i} className={i < s.hits.length ? (s.hits[i] > 0 ? 'on' : '') : i === s.arrow - 1 ? 'now' : ''} />)}</div>
        <div className="big">{s.score}<small className="arc-of"> / {TO_WIN} to win</small></div>
        {s.line && <div className="line">{s.line}</div>}
        {s.phase === 'ready' && (
          <div className="hint">{s.draw < 0.05
            ? <><kbd>Space</kbd> or <kbd>click</kbd> hold to draw · <kbd>mouse</kbd> / <kbd>←↑↓→</kbd> aim</>
            : s.draw < 1 ? <>drawing…</> : s.shake > 0.5 ? <>your arm’s shaking: <b>let go</b></> : <>full draw: let go to loose</>}</div>
        )}
      </div>
    </>
  );
}

register({
  id: 'archery', name: 'Pinewatch Archery',
  pitch: 'Five arrows down the long range: two at the near butt, two at the middle, one at the butt swinging on its ropes. Arrows drop and the wind carries them, so hold high and into it. 30 points wins.',
  keys: [['Space / click', 'hold to draw, let go to loose'], ['Mouse / arrows', 'aim'], ['Esc', 'leave']],
  entry: 400,
  Station, Play, Hud,
  view: () => ({ pos: [6, 6, LINE + 9], look: [0, 3, -4] }),
});
