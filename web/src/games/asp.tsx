// House Thorne's game, in the reed hall at Mirefort: the Asp's Basket. A wicker basket brim-full of gold with the
// house asp coiled on its rim. Hold Space (or E) to reach in and draw coins out, one by one, into your hand; let go
// to bank the handful on the table. The asp sways, and before it strikes it tells: it draws its head back and up,
// its tongue flickers, its eyes go red and it hisses. Be out of the basket when it lunges. A bite costs the handful
// and one of three lives. Its tells shorten as the sand runs, and from the second quarter it starts to feint.
// Bank thirty coins in sixty seconds to win.
import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { burst, voice } from '../realm/sound.ts';
import { FireLight, Flames, type FlameSpot } from '../realm/fire.tsx';
import type { Room } from '../realm/rooms.ts';
import { keys, usePlay } from '../realm/play.ts';
import { gameKeys, gameUi, register, session, type Result } from './host.ts';
import './asp.css';

const AT: [number, number] = [0, -10]; // the station, matches rooms.ts
const TOP = 1.55;                      // table height
const BR = 0.82, BH = 0.86;            // basket radius and height
const RIM = TOP + BH;
const TIME = 60, TARGET = 30, LIVES = 3;

// ---- Textures: wicker weave and the asp's scales, drawn once.
function wickerTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5a4127'; g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 16) for (let x = 0; x < 128; x += 16) {
    const up = ((x + y) / 16) % 2 === 0;
    const gr = up ? g.createLinearGradient(x, y, x, y + 16) : g.createLinearGradient(x, y, x + 16, y);
    gr.addColorStop(0, '#6e5232'); gr.addColorStop(0.5, '#c39a5e'); gr.addColorStop(1, '#6e5232');
    g.fillStyle = gr;
    if (up) g.fillRect(x + 2, y, 12, 16); else g.fillRect(x, y + 2, 16, 12);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 3); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function scaleTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  // v runs round the body: belly (pale) at the ends of v, back (dark diamonds) in the middle.
  const gr = g.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, '#9c9a4e'); gr.addColorStop(0.22, '#2e6a1e'); gr.addColorStop(0.5, '#173f10'); gr.addColorStop(0.78, '#2e6a1e'); gr.addColorStop(1, '#9c9a4e');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#081405';
  for (let x = 0; x < 256; x += 16) { g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 8, 18); g.lineTo(x + 16, 32); g.lineTo(x + 8, 46); g.closePath(); g.fill(); g.fillStyle = '#d8c25a'; g.fillRect(x + 7, 30, 2, 4); g.fillStyle = '#081405'; }
  g.globalAlpha = 0.25; g.strokeStyle = '#0b1408';
  for (let x = 0; x < 256; x += 4) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 2, 64); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A tube whose radius varies along it (TubeGeometry can't taper). Writes into `geo` if given, to rebuild cheaply. */
function taperTube(curve: THREE.Curve<THREE.Vector3>, segs: number, radial: number, radius: (t: number) => number, geo?: THREE.BufferGeometry, uRepeat = 6) {
  const frames = curve.computeFrenetFrames(segs, false);
  const n = (segs + 1) * (radial + 1);
  geo ??= (() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const uv = new Float32Array(n * 2), idx: number[] = [];
    for (let i = 0; i <= segs; i++) for (let j = 0; j <= radial; j++) uv.set([(i / segs) * uRepeat, j / radial], (i * (radial + 1) + j) * 2);
    for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
    return g;
  })();
  const pos = geo.attributes.position as THREE.BufferAttribute, nor = geo.attributes.normal as THREE.BufferAttribute;
  const p = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, r = radius(t);
    curve.getPointAt(t, p);
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2, s = Math.sin(a), c = -Math.cos(a);
      v.set(c * N.x + s * B.x, c * N.y + s * B.y, c * N.z + s * B.z);
      const k = i * (radial + 1) + j;
      pos.setXYZ(k, p.x + v.x * r, p.y + v.y * r, p.z + v.z * r);
      nor.setXYZ(k, v.x, v.y, v.z);
    }
  }
  pos.needsUpdate = true; nor.needsUpdate = true;
  geo.computeBoundingSphere();
  return geo;
}

// ---- The coil: one and a half turns round the rim, the tail tucked under, the neck rising at the back.
const NECK_A = -Math.PI / 2; // the neck leaves the rim at the back of the basket (−z, away from you)
const coilCurve = (() => {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40, a = NECK_A - Math.PI * 2 * 1.3 * (1 - t);
    const r = BR * (1.0 + 0.05 * Math.sin(t * 9)) - (1 - t) * 0.06;
    pts.push(new THREE.Vector3(Math.cos(a) * r, RIM + 0.06 + t * 0.1 + Math.sin(t * 14) * 0.015, Math.sin(a) * r));
  }
  return new THREE.CatmullRomCurve3(pts); // tail first, ending at the neck (back of the rim)
})();
const NECK_BASE = coilCurve.getPointAt(1);

/** Materials shared by the station and the round. */
function useMats() {
  return useMemo(() => {
    const scales = scaleTex();
    return {
      wicker: new THREE.MeshStandardMaterial({ map: wickerTex(), roughness: 0.92, side: THREE.DoubleSide }),
      rim: new THREE.MeshStandardMaterial({ color: '#7a5a34', roughness: 0.85 }),
      snake: new THREE.MeshStandardMaterial({ map: scales, roughness: 0.32, metalness: 0.1, color: '#9fbf8a' }),
      head: new THREE.MeshStandardMaterial({ color: '#1f4a17', roughness: 0.32, metalness: 0.1 }),
      eye: new THREE.MeshStandardMaterial({ color: '#e9d36a', emissive: new THREE.Color('#ff2a10'), emissiveIntensity: 0, roughness: 0.2 }),
      tongue: new THREE.MeshStandardMaterial({ color: '#7a1020', roughness: 0.5 }),
      coin: new THREE.MeshStandardMaterial({ color: '#f0c548', metalness: 0.9, roughness: 0.22, emissive: new THREE.Color('#5a3a00'), emissiveIntensity: 0.35 }),
      wood: new THREE.MeshStandardMaterial({ color: '#4a3a2a', roughness: 0.85 }),
      mat: new THREE.MeshStandardMaterial({ color: '#7d7a4a', roughness: 0.95 }),
      sleeve: new THREE.MeshStandardMaterial({ color: '#3d4a2e', roughness: 0.9 }),
      skin: new THREE.MeshStandardMaterial({ color: '#c99878', roughness: 0.7 }),
    };
  }, []);
}
type Mats = ReturnType<typeof useMats>;

const coinGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.016, 20);
const basketGeo = (() => {
  const pts = [[0.0, 0.0], [BR * 0.72, 0.0], [BR * 0.86, 0.08], [BR * 0.98, 0.32], [BR, 0.62], [BR * 0.97, BH]].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 40); g.computeVertexNormals(); return g;
})();

/** The heap of gold in the basket: instanced coins, densest in the middle. */
function Heap({ mats, fill }: { mats: Mats; fill?: { current: number } }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const N = 170;
  const mats4 = useMemo(() => {
    const out: THREE.Matrix4[] = [], q = new THREE.Quaternion(), e = new THREE.Euler();
    let s = 9; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < N; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * BR * 0.86;
      const y = TOP + BH * 0.62 + (1 - (d / BR) ** 2) * 0.24 + r() * 0.05;
      e.set((r() - 0.5) * 1.1, r() * 6, (r() - 0.5) * 1.1);
      out.push(new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * d, y, Math.sin(a) * d), q.setFromEuler(e), new THREE.Vector3(1, 1, 1)));
    }
    return out;
  }, []);
  useFrame(() => {
    const m = ref.current; if (!m) return;
    const n = Math.round(N * (0.55 + 0.45 * (fill?.current ?? 1)));
    if (m.count !== n) { for (let i = 0; i < n; i++) m.setMatrixAt(i, mats4[i]); m.count = n; m.instanceMatrix.needsUpdate = true; }
  });
  return <instancedMesh ref={ref} args={[coinGeo, mats.coin, N]} castShadow receiveShadow frustumCulled={false} />;
}

/** The table, mats, lanterns and the basket itself (no snake, no heap). */
function Furniture({ mats }: { mats: Mats }) {
  const flames = useMemo<FlameSpot[]>(() => [[-1.45, TOP + 0.42, -0.65, 0.18], [1.5, TOP + 0.42, -0.75, 0.18], [-3.1, 2.62, -1.4, 0.32], [3.1, 2.62, -1.4, 0.32]], []);
  return (
    <group>
      {/* A thick round driftwood top on a carved stump, a reed mat under all of it. */}
      <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2} receiveShadow><circleGeometry args={[3.4, 40]} /><primitive object={mats.mat} attach="material" /></mesh>
      <mesh position={[0, TOP - 0.1, 0]} castShadow receiveShadow material={mats.wood}><cylinderGeometry args={[1.8, 1.75, 0.2, 40]} /></mesh>
      <mesh position={[0, (TOP - 0.2) / 2, 0]} castShadow material={mats.wood}><cylinderGeometry args={[0.55, 0.85, TOP - 0.2, 10]} /></mesh>
      {[0, 1, 2, 3].map((i) => <mesh key={i} position={[Math.cos(i * 1.57 + 0.4) * 0.8, 0.18, Math.sin(i * 1.57 + 0.4) * 0.8]} rotation={[0, -i * 1.57, 0.5]} castShadow material={mats.wood}><cylinderGeometry args={[0.12, 0.2, 0.9, 6]} /></mesh>)}
      {/* The basket: woven sides, a bound rim, a lid leaning on the stump. */}
      <mesh geometry={basketGeo} material={mats.wicker} position={[0, TOP, 0]} castShadow receiveShadow />
      <mesh position={[0, RIM, 0]} rotation-x={Math.PI / 2} material={mats.rim} castShadow><torusGeometry args={[BR * 0.97, 0.045, 8, 48]} /></mesh>
      <mesh position={[0.2, 0.75, 1.3]} rotation={[-1.25, 0.3, 0]} material={mats.wicker} castShadow><cylinderGeometry args={[0.9, 0.9, 0.08, 32]} /></mesh>
      {/* Two candles on the table, and two marsh lanterns on poles either side. */}
      {[[-1.45, -0.65], [1.5, -0.75]].map(([x, z], i) => <mesh key={i} position={[x, TOP + 0.2, z]}><cylinderGeometry args={[0.06, 0.07, 0.4, 8]} /><meshStandardMaterial color="#e8dfc4" /></mesh>)}
      {[-3.1, 3.1].map((x) => (
        <group key={x} position={[x, 0, -1.4]}>
          <mesh position={[0, 1.15, 0]} castShadow material={mats.wood}><cylinderGeometry args={[0.07, 0.09, 2.3, 6]} /></mesh>
          <mesh position={[0, 2.55, 0]}><cylinderGeometry args={[0.24, 0.2, 0.55, 6, 1, true]} /><meshStandardMaterial color="#1e2416" metalness={0.5} roughness={0.5} side={THREE.DoubleSide} /></mesh>
        </group>
      ))}
      <Flames spots={flames} />
      <FireLight position={[0.4, TOP + 2.4, 1.2]} color="#ffc27a" intensity={38} distance={12} />
      <FireLight position={[-3.1, 2.8, -1.4]} color="#ffb060" intensity={22} distance={9} />
    </group>
  );
}

/** The asp at rest on its basket when nobody is playing: coiled, head up, swaying slowly. */
function Station() {
  const mats = useMats();
  const playing = usePlay().game && session.phase === 'play';
  return (
    <group position={[AT[0], 0, AT[1]]}>
      <Furniture mats={mats} />
      {!playing && <><Heap mats={mats} /><Asp mats={mats} drive={undefined} /></>}
    </group>
  );
}

// ---- The asp: a static coil plus a neck and head rebuilt every frame from a pose.
interface Pose { head: THREE.Vector3; look: THREE.Vector3; glow: number; tongue: number; jaw: number }
function Asp({ mats, drive }: { mats: Mats; drive: ((t: number, dt: number, p: Pose) => void) | undefined }) {
  const coil = useMemo(() => taperTube(coilCurve, 90, 10, (t) => 0.03 + 0.062 * Math.sqrt(t) * (1 - 0.1 * t), undefined, 22), []);
  const neck = useRef<THREE.Mesh>(null), head = useRef<THREE.Group>(null), tongue = useRef<THREE.Group>(null), jaw = useRef<THREE.Group>(null);
  const pose = useMemo<Pose>(() => ({ head: new THREE.Vector3(0, RIM + 0.75, -0.25), look: new THREE.Vector3(0, RIM + 0.6, 2), glow: 0, tongue: 0, jaw: 0 }), []);
  const curve = useMemo(() => new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]), []);
  const built = useRef(false);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    if (drive) drive(t, dt, pose);
    else {
      pose.head.set(Math.sin(t * 0.9) * 0.22, RIM + 0.72 + Math.sin(t * 1.3) * 0.04, -0.3);
      pose.look.set(Math.sin(t * 0.9 - 0.6) * 0.6, RIM + 0.5, 2);
      pose.glow = 0; pose.tongue = Math.max(0, Math.sin(t * 2.1) * 3 - 2.4); pose.jaw = 0;
    }
    // Neck: from the coil's end, out and up in an S, to just behind the head.
    const dir = new THREE.Vector3().subVectors(pose.look, pose.head).normalize();
    const back = pose.head.clone().addScaledVector(dir, -0.22);
    const p = curve.points;
    p[0].copy(NECK_BASE);
    p[1].set(NECK_BASE.x * 0.75 + back.x * 0.25, NECK_BASE.y + 0.12, NECK_BASE.z * 0.6 + back.z * 0.4 - 0.12);
    p[2].set(back.x * 0.8, (NECK_BASE.y + back.y) / 2 + 0.12, back.z - 0.18).lerp(back, 0.4);
    p[3].copy(back);
    curve.updateArcLengths();
    if (!built.current) { neck.current!.geometry = taperTube(curve, 28, 10, (u) => 0.088 - 0.03 * u, undefined, 4); built.current = true; }
    else taperTube(curve, 28, 10, (u) => 0.088 - 0.03 * u, neck.current!.geometry, 4);
    const h = head.current!;
    h.position.copy(pose.head);
    h.lookAt(pose.look);
    mats.eye.emissiveIntensity = pose.glow * 3.2;
    tongue.current!.scale.set(1, 1, Math.max(0.001, pose.tongue));
    tongue.current!.rotation.x = Math.sin(t * 40) * 0.25 * pose.tongue;
    jaw.current!.rotation.x = pose.jaw * 0.7;
  });
  return (
    <group>
      <mesh geometry={coil} material={mats.snake} castShadow />
      <mesh ref={neck} material={mats.snake} castShadow />
      <group ref={head}>
        {/* A wedge of a head: broad behind the eyes, a blunt snout, a lower jaw that drops to strike. */}
        <mesh material={mats.head} scale={[0.115, 0.07, 0.19]} position={[0, 0.01, 0.07]} castShadow><sphereGeometry args={[1, 16, 10]} /></mesh>
        <group ref={jaw} position={[0, -0.025, -0.03]}><mesh material={mats.head} position={[0, 0, 0.1]} scale={[0.09, 0.03, 0.15]}><sphereGeometry args={[1, 12, 8]} /></mesh></group>
        {[-1, 1].map((s) => <mesh key={s} material={mats.eye} position={[s * 0.075, 0.035, 0.11]}><sphereGeometry args={[0.024, 10, 8]} /></mesh>)}
        <group ref={tongue} position={[0, -0.01, 0.24]}>
          {[-1, 1].map((s) => <mesh key={s} material={mats.tongue} position={[s * 0.012, 0, 0.09]} rotation-y={s * 0.25} rotation-x={Math.PI / 2}><cylinderGeometry args={[0.006, 0.004, 0.18, 4]} /></mesh>)}
        </group>
      </group>
    </group>
  );
}

// ---- The round.
const ui = gameUi({ left: TIME, banked: 0, hand: 0, lives: LIVES, line: 'Reach in when it looks away.', flash: 0, danger: 0, bonus: '' });
type Mood = 'sway' | 'tell' | 'strike' | 'recoil' | 'settle';

function clink(pitch = 1, when = 0, loud = 1) { burst(3300 * pitch + Math.random() * 400, 16, 0.045 * loud, 0.32, when); burst(5100 * pitch, 22, 0.02 * loud, 0.22, when + 0.008); }
function hiss(dur: number) {
  burst(6200, 0.6, 0.035, dur, 0, 'highpass');
  // The rattle under it: dry clicks speeding up.
  let t = 0; for (let i = 0; t < dur; i++) { burst(2400 + Math.random() * 600, 3, 0.03, 0.03, t); t += Math.max(0.025, 0.09 - i * 0.008); }
}
function rustle() { burst(1900 + Math.random() * 500, 0.9, 0.035, 0.22); }

function Play({ room, end }: { room: Room; end: (r: Result) => void }) {
  const camera = useThree((s) => s.camera);
  const mats = useMats();
  const st = useRef({
    t: 0, left: TIME, banked: 0, hand: 0, lives: LIVES, reach: 0, held: false, stun: 0, coinT: 0,
    mood: 'sway' as Mood, moodT: 0, moodLen: 3.0, feint: false, shake: 0, over: false, overT: 0, struck: false, bitT: -9, needRelease: false,
  });
  const fill = useRef(1);
  useMemo(() => { ui.reset(); }, []);
  const arm = useRef<THREE.Group>(null), hand = useRef<THREE.Group>(null), fist = useRef<THREE.Group>(null);
  const flyers = useRef<(THREE.Mesh | null)[]>([]);
  const fly = useRef(Array.from({ length: 10 }, () => ({ on: false, t: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), spin: 0 })));
  const pile = useRef<THREE.InstancedMesh>(null);
  const bitFlash = useRef<THREE.PointLight>(null);
  const camPos = useMemo(() => new THREE.Vector3(), []), camLook = useMemo(() => new THREE.Vector3(), []);
  const handPos = useMemo(() => new THREE.Vector3(), []);
  const REST = useMemo(() => new THREE.Vector3(0.55, RIM + 0.28, 1.15), []);
  const DEEP = useMemo(() => new THREE.Vector3(0.05, TOP + BH * 0.68, 0.12), []);
  const SHOULDER = useMemo(() => new THREE.Vector3(0.75, RIM + 0.95, 2.6), []);

  const pickMood = (s: typeof st.current) => {
    // How hard: 0 at the start, 1 at the end.
    const k = Math.min(1, s.t / TIME);
    s.mood = 'sway'; s.moodT = 0; s.moodLen = THREE.MathUtils.lerp(1.9, 1.0, k) + Math.random() * THREE.MathUtils.lerp(1.8, 1.2, k);
  };
  const tellLen = (s: typeof st.current) => THREE.MathUtils.lerp(0.75, 0.28, Math.min(1, s.t / TIME)) * (0.9 + Math.random() * 0.2);

  const drive = (time: number, dt: number, p: Pose) => {
    const s = st.current;
    const sway = Math.sin(time * (1.1 + s.t / 40)) * 0.24;
    const target = s.reach > 0.3 ? handPos : REST;
    if (s.mood === 'sway') {
      p.head.lerp(new THREE.Vector3(sway, RIM + 0.68 + Math.sin(time * 1.7) * 0.04, -0.32), 1 - Math.exp(-dt * 5));
      p.look.lerp(new THREE.Vector3(sway * 1.6 + (s.reach > 0.3 ? handPos.x * 0.5 : 0), RIM + 0.45, 1.8), 1 - Math.exp(-dt * 4));
      p.glow += (0 - p.glow) * Math.min(1, dt * 4);
      p.tongue = Math.max(0, Math.sin(time * 2.3) * 3 - 2.3);
      p.jaw += (0 - p.jaw) * Math.min(1, dt * 8);
    } else if (s.mood === 'tell') {
      const u = Math.min(1, s.moodT / s.moodLen);
      // Draw back and up into an S, eyes on your hand, tongue going like a flag, eyes reddening.
      p.head.lerp(new THREE.Vector3(sway * 0.3, RIM + 0.95 + u * 0.15, -0.62 - u * 0.12), 1 - Math.exp(-dt * 9));
      p.look.lerp(target, 1 - Math.exp(-dt * 10));
      p.glow = Math.min(1, u * 1.4);
      p.tongue = 0.6 + 0.4 * Math.abs(Math.sin(time * 26));
      p.jaw = u * 0.3;
    } else if (s.mood === 'strike') {
      const u = Math.min(1, s.moodT / 0.1);
      const aim = s.feint ? new THREE.Vector3(0, RIM + 0.75, -0.2) : target.clone().add(new THREE.Vector3(0, 0.06, -0.12));
      p.head.lerp(aim, u * 0.85 + 0.1);
      p.look.copy(aim).add(new THREE.Vector3(0, -0.2, 1.2));
      p.jaw = 1; p.glow = 1; p.tongue = 0;
    } else if (s.mood === 'recoil' || s.mood === 'settle') {
      p.head.lerp(new THREE.Vector3(sway, RIM + 0.7, -0.32), 1 - Math.exp(-dt * 4));
      p.look.lerp(new THREE.Vector3(sway, RIM + 0.45, 1.8), 1 - Math.exp(-dt * 3));
      p.glow += (0 - p.glow) * Math.min(1, dt * 3);
      p.jaw += (0 - p.jaw) * Math.min(1, dt * 6);
      p.tongue = s.mood === 'settle' ? Math.max(0, Math.sin(time * 9) * 2 - 1) : 0;
    }
  };

  const bank = (s: typeof st.current) => {
    if (s.hand <= 0) return;
    let add = s.hand, bonus = '';
    if (s.hand >= 6) { add += 2; bonus = `Greedy hand! +2`; }
    for (let i = 0; i < Math.min(add, 8); i++) clink(0.9 + Math.random() * 0.25, i * 0.045, 0.9);
    s.banked += add; s.hand = 0;
    ui.set({ banked: s.banked, hand: 0, bonus, line: s.banked >= TARGET ? 'Thirty! Push your luck, or sit pretty.' : ['Safe.', 'Into the pile.', 'It saw that.', 'Again?'][Math.floor(Math.random() * 4)] });
  };

  useFrame(({ clock }, dt) => {
    const s = st.current;
    dt = Math.min(dt, 0.05);
    const ks = gameKeys();
    void ks;
    // ---- The end: let the last moment breathe, then report once.
    if (s.over) {
      s.overT += dt;
      s.held = false;
    } else {
      s.t += dt; s.left = Math.max(0, TIME - s.t);
      if (Math.ceil(s.left) !== Math.ceil(ui.state.left)) ui.set({ left: s.left });
    }
    s.stun = Math.max(0, s.stun - dt);
    const down = keys.has(' ') || keys.has('e');
    if (!down) s.needRelease = false;
    const want = !s.over && s.stun <= 0 && !s.needRelease && down;
    if (want && !s.held) rustle();
    if (!want && s.held) bank(s);
    s.held = want;
    // ---- Your arm: out to the basket and down into the gold, back to rest.
    const prev = s.reach;
    s.reach = THREE.MathUtils.clamp(s.reach + (s.held ? dt / 0.32 : -dt / 0.22), 0, 1);
    const e = s.reach < 0.5 ? 2 * s.reach * s.reach : 1 - Math.pow(-2 * s.reach + 2, 2) / 2;
    handPos.lerpVectors(REST, DEEP, e);
    handPos.y += Math.sin(e * Math.PI) * 0.35; // over the rim, then down
    if (s.reach >= 1 && prev < 1) rustle();
    // Coins come out while your hand is in the heap: one, then quicker.
    if (s.reach >= 1) {
      s.coinT += dt;
      const every = Math.max(0.3, 0.55 - s.hand * 0.025);
      if (s.coinT > every) {
        s.coinT = 0; s.hand++;
        clink(1 + s.hand * 0.04);
        fill.current = Math.max(0, fill.current - 0.006);
        const f = fly.current.find((x) => !x.on);
        if (f) { f.on = true; f.t = 0; f.from.set((Math.random() - 0.5) * 0.4, TOP + BH * 0.7, (Math.random() - 0.5) * 0.4); f.spin = Math.random() * 10; }
        ui.set({ hand: s.hand, bonus: '' });
      }
    } else s.coinT = 0;
    // ---- The asp's mind.
    s.moodT += dt;
    if (!s.over) {
      if (s.mood === 'sway' && s.moodT > s.moodLen) {
        s.mood = 'tell'; s.moodT = 0; s.moodLen = tellLen(s);
        // Feints come in after the first quarter, more often toward the end.
        s.feint = s.t > TIME * 0.25 && Math.random() < 0.18 + 0.22 * (s.t / TIME);
        hiss(s.moodLen + 0.1);
      } else if (s.mood === 'tell' && s.moodT > s.moodLen) {
        if (s.feint && Math.random() < 0.6) { s.mood = 'settle'; s.moodT = 0; ui.set({ line: 'A feint. It’s toying with you.' }); }
        else { s.mood = 'strike'; s.moodT = 0; s.struck = false; burst(900, 0.6, 0.12, 0.16); }
      } else if (s.mood === 'strike' && !s.struck && s.moodT > 0.08) {
        s.struck = true;
        if (s.reach > 0.35 && !s.feint) {
          // Bitten.
          s.lives--; s.hand = 0; s.stun = 1.1; s.needRelease = true; s.held = false; s.shake = 0.9; s.bitT = clock.elapsedTime;
          burst(160, 2, 0.4, 0.2); burst(2600, 1, 0.12, 0.08); voice('man', 7, 0, true);
          ui.set({ lives: s.lives, hand: 0, flash: performance.now(), line: s.lives > 0 ? ['Bitten! The handful’s gone.', 'Its fangs found you.', 'That one drew blood.'][LIVES - s.lives - 1] ?? 'Bitten!' : 'Bitten a third time. The asp keeps the rest.' });
          if (s.lives <= 0) s.over = true;
        } else {
          burst(420, 1, 0.06, 0.1); // its jaws close on nothing
          if (s.reach < 0.05 && !s.feint) ui.set({ line: ['Missed you!', 'Too slow, snake.', 'It snaps at the air.'][Math.floor(Math.random() * 3)] });
        }
      } else if (s.mood === 'strike' && s.moodT > 0.42) { s.mood = 'recoil'; s.moodT = 0; }
      else if ((s.mood === 'recoil' || s.mood === 'settle') && s.moodT > (s.mood === 'recoil' ? 0.7 : 0.4)) pickMood(s);
      if (s.left <= 0) { if (s.hand > 0) bank(s); s.over = true; ui.set({ line: 'The sand is out.' }); }
    }
    if (s.over && s.overT > 1.6) {
      const won = s.banked >= TARGET;
      s.overT = -1e9;
      end({ won, score: s.banked, grade: Math.min(1, (s.banked - TARGET) / 40 + 0.1), line: `${s.banked} coins banked${s.lives < LIVES ? `, bitten ${LIVES - s.lives} time${LIVES - s.lives > 1 ? 's' : ''}` : ', never bitten'}. ${won ? 'House Thorne pays its debts.' : `You needed ${TARGET}.`}` });
      return;
    }
    const danger = s.mood === 'tell' ? Math.min(1, s.moodT / s.moodLen) : s.mood === 'strike' ? 1 : 0;
    if (Math.abs(danger - ui.state.danger) > 0.08) ui.set({ danger });
    // ---- The arm: an upper arm from the shoulder to the elbow, a forearm to the hand; the hand closes as it fills.
    const a = arm.current!, hnd = hand.current!;
    const jolt = s.stun > 0 ? Math.sin(s.stun * 30) * 0.05 * s.stun : 0;
    hnd.position.copy(handPos).add(new THREE.Vector3(jolt, 0, Math.max(0, s.stun - 0.6) * 1.2));
    const elbow = new THREE.Vector3().lerpVectors(SHOULDER, hnd.position, 0.5).add(new THREE.Vector3(0.3, -0.25, 0));
    setLimb(a.children[0] as THREE.Mesh, SHOULDER, elbow);
    setLimb(a.children[1] as THREE.Mesh, elbow, hnd.position);
    hnd.lookAt(hnd.position.clone().add(new THREE.Vector3().subVectors(hnd.position, elbow)));
    fist.current!.scale.setScalar(1 + Math.min(s.hand, 10) * 0.025);
    // ---- Coins flying from the heap into your hand.
    fly.current.forEach((f, i) => {
      const m = flyers.current[i]; if (!m) return;
      if (!f.on) { m.visible = false; return; }
      f.t += dt / 0.22;
      f.to.copy(hnd.position);
      m.visible = true;
      m.position.lerpVectors(f.from, f.to, f.t); m.position.y += Math.sin(f.t * Math.PI) * 0.25;
      m.rotation.set(f.spin + f.t * 9, f.t * 5, 0);
      if (f.t >= 1) f.on = false;
    });
    // ---- Your pile on the table, growing coin by coin in little stacks.
    const pm = pile.current!;
    const n = Math.min(60, s.banked);
    if (pm.count !== n) {
      const o = new THREE.Object3D();
      for (let i = 0; i < n; i++) {
        const stack = Math.floor(i / 8), h = i % 8;
        const sx = 1.12 + (stack % 3) * 0.17, sz = 0.55 + Math.floor(stack / 3) * 0.17;
        o.position.set(sx + Math.sin(i * 7.1) * 0.012, TOP + 0.01 + h * 0.017, sz + Math.cos(i * 3.3) * 0.012); o.rotation.set(0, i, 0); o.updateMatrix();
        pm.setMatrixAt(i, o.matrix);
      }
      pm.count = n; pm.instanceMatrix.needsUpdate = true;
    }
    // A red flash on a bite.
    if (bitFlash.current) bitFlash.current.intensity = Math.max(0, 1 - (clock.elapsedTime - s.bitT) * 3) * 180;
    // ---- The camera: over your shoulder at the basket, leaning in while your hand is in; a jolt when bitten.
    camPos.set(room.x + AT[0] + 0.9 - e * 0.25, RIM + 2.0 - e * 0.35, room.z + AT[1] + 3.6 - e * 0.6);
    camLook.set(room.x + AT[0], RIM + 0.25, room.z + AT[1] - 0.1);
    camera.position.lerp(camPos, 1 - Math.exp(-dt * 5));
    camera.lookAt(camLook);
    s.shake = Math.max(0, s.shake - dt * 1.6);
    if (s.shake > 0) { const k = s.shake * s.shake; camera.rotateZ(Math.sin(clock.elapsedTime * 47) * k * 0.05); camera.rotateX(Math.sin(clock.elapsedTime * 31) * k * 0.035); }
    const pc = camera as THREE.PerspectiveCamera;
    const fov = 46 - danger * 4;
    if (Math.abs(pc.fov - fov) > 0.05) { pc.fov += (fov - pc.fov) * Math.min(1, dt * 6); pc.updateProjectionMatrix(); }
  });

  return (
    <group position={[AT[0], 0, AT[1]]}>
      <Heap mats={mats} fill={fill} />
      <Asp mats={mats} drive={drive} />
      <group ref={arm}>
        <mesh material={mats.sleeve} castShadow><cylinderGeometry args={[0.13, 0.11, 1, 10]} /></mesh>
        <mesh material={mats.sleeve} castShadow><cylinderGeometry args={[0.11, 0.085, 1, 10]} /></mesh>
      </group>
      <group ref={hand}>
        <group ref={fist}>
          <mesh material={mats.skin} scale={[0.09, 0.05, 0.11]} position={[0, 0, 0.05]} castShadow><sphereGeometry args={[1, 12, 8]} /></mesh>
          {[-0.05, -0.017, 0.017, 0.05].map((x) => <mesh key={x} material={mats.skin} position={[x, -0.02, 0.15]} rotation-x={0.9} castShadow><capsuleGeometry args={[0.016, 0.07, 3, 6]} /></mesh>)}
          <mesh material={mats.skin} position={[0.085, 0, 0.06]} rotation-z={0.8} castShadow><capsuleGeometry args={[0.018, 0.05, 3, 6]} /></mesh>
        </group>
      </group>
      {fly.current.map((_, i) => <mesh key={i} ref={(m) => { flyers.current[i] = m; }} geometry={coinGeo} material={mats.coin} visible={false} />)}
      <instancedMesh ref={pile} args={[coinGeo, mats.coin, 60]} castShadow receiveShadow frustumCulled={false} />
      <pointLight ref={bitFlash} position={[0, RIM + 0.6, 0.6]} color="#ff2a20" intensity={0} distance={8} decay={1.5} />
    </group>
  );
}

const up = new THREE.Vector3(0, 1, 0);
/** Stretch a unit cylinder between two points. */
function setLimb(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(up, d.normalize());
  m.scale.set(1, len, 1);
}

function Hud() {
  const s = ui.use();
  const fresh = performance.now() - s.flash < 500;
  return (
    <>
      <div className={`asp-vignette ${fresh ? 'bit' : ''}`} style={{ opacity: Math.max(fresh ? 1 : 0, s.danger * 0.75) }} />
      <div className="asp-top">
        <div className="asp-time"><b>{Math.ceil(s.left)}</b><small>seconds</small></div>
        <div className="asp-bank">
          <div className="bar"><i style={{ width: `${Math.min(100, (s.banked / TARGET) * 100)}%` }} className={s.banked >= TARGET ? 'full' : ''} /><span className="mark" /></div>
          <small><b>{s.banked}</b> banked · {TARGET} to win</small>
        </div>
        <div className="asp-lives">{Array.from({ length: LIVES }, (_, i) => <i key={i} className={i < s.lives ? '' : 'gone'} />)}</div>
      </div>
      <div className="game-hud">
        {s.hand > 0 && <div className="big asp-hand">{s.hand}<small>in hand</small></div>}
        {s.bonus && <div className="asp-bonus">{s.bonus}</div>}
        <div className="line">{s.line}</div>
        <div className="hint"><kbd>Space</kbd> hold to reach in · let go to bank</div>
      </div>
    </>
  );
}

register({
  id: 'asp', name: 'The Asp’s Basket',
  pitch: 'Hold to reach into the asp’s basket and draw out gold; let go to bank it. When it rears, hisses and its eyes go red, get your hand out. Bank 30 coins in 60 seconds. Three bites and you’re done.',
  keys: [['Space', 'hold to reach, release to bank'], ['Esc', 'leave']],
  entry: 400,
  Station, Play, Hud,
  view: () => ({ pos: [AT[0] + 1.2, RIM + 2.6, AT[1] + 4.6], look: [AT[0], RIM, AT[1]] }),
});
