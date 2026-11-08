// House Draven's game, in the forge hall at Ironhold: the Forge. A billet of steel, three heats, a blade at the end.
// Each heat: pump the bellows (tap Space) until the steel is white-hot, then it goes to the anvil and you strike in
// rhythm. A ring closes on the spot to hit and the steel flares on the beat: strike (Space or click) as it closes.
// Perfect and good strikes draw the blade out; a miss cracks it. The steel cools and dims through each heat, the
// rhythm quickens heat by heat and the third is syncopated. Then the quench, and the blade is judged:
// quality 60% or better wins.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { audio, burst, voice } from '../realm/sound.ts';
import { Embers, FireLight, Flames, type FlameSpot } from '../realm/fire.tsx';
import type { Room } from '../realm/rooms.ts';
import { usePlay } from '../realm/play.ts';
import { gameKeys, gameUi, register, session, type Result } from './host.ts';
import './forge.css';

const AT: [number, number] = [0, -10];
const TOP = 1.53;                         // anvil face
const F = new THREE.Vector3(-4.4, 0, -1.1); // the forge hearth, relative to the anvil
const FH = 1.42;                          // coal bed height
const TR = new THREE.Vector3(3.7, 0, -0.5); // the quench trough
const HEATS = 3, PER = 14, TOTAL = HEATS * PER;
const IV = [0.92, 0.76, 0.7];             // beat interval per heat
const PATTERN = [[1], [1], [1, 1, 0.5, 0.5, 1, 0.5, 0.5, 1]]; // the third heat swings

// ---- Sounds.
function ring(loud = 1, len = 1, f0 = 880 + Math.random() * 40) {
  const a = audio(); if (!a) return;
  const t = a.currentTime, out = a.createGain();
  out.gain.value = 0.16 * loud; out.connect(a.destination);
  for (const [m, g, d] of [[1, 1, 1.5], [2.76, 0.55, 0.9], [5.4, 0.3, 0.45], [8.93, 0.15, 0.25]]) {
    const o = a.createOscillator(), gn = a.createGain();
    o.type = 'sine'; o.frequency.value = f0 * m;
    gn.gain.setValueAtTime(g, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + d * len);
    o.connect(gn).connect(out); o.start(t); o.stop(t + d * len + 0.05);
  }
  burst(3800, 1.2, 0.18 * loud, 0.05);
}
const clank = () => { burst(520, 2, 0.3, 0.14); burst(170, 1.4, 0.35, 0.18); ring(0.3, 0.25, 430); };
const tick = (loud = 1) => burst(4300, 9, 0.05 * loud, 0.05);
const whoosh = () => { burst(420, 0.6, 0.2, 0.45); burst(1200, 0.5, 0.05, 0.3, 0.05); };
const hissQ = () => { burst(5200, 0.5, 0.28, 1.8, 0, 'highpass'); burst(1700, 0.4, 0.16, 1.3); burst(240, 1, 0.3, 0.25); };

// ---- Heat colour: black → dull red → cherry → orange → yellow → white.
const STOPS: [number, THREE.Color][] = [[0, '#000000'], [0.25, '#3a0600'], [0.45, '#a01a00'], [0.65, '#ff4a06'], [0.85, '#ff9a1a'], [1.0, '#ffd870'], [1.2, '#ffe9b0']].map(([t, c]) => [t as number, new THREE.Color(c as string)]);
function heatColor(T: number, out: THREE.Color) {
  T = THREE.MathUtils.clamp(T, 0, 1.2);
  for (let i = 1; i < STOPS.length; i++) if (T <= STOPS[i][0]) { const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i]; return out.copy(ca).lerp(cb, (T - a) / (b - a)); }
  return out.copy(STOPS[STOPS.length - 1][1]);
}

// ---- Textures.
function coalTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#100604'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * 128, y = Math.random() * 128, r = 2 + Math.random() * 7;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const hot = Math.random();
    gr.addColorStop(0, hot > 0.6 ? '#ffd27a' : hot > 0.25 ? '#ff6a10' : '#7a1a04'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function grainTex(base: string, line: string) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = base; g.fillRect(0, 0, 64, 256);
  g.strokeStyle = line; g.globalAlpha = 0.35;
  for (let i = 0; i < 22; i++) { const x = Math.random() * 64; g.lineWidth = 0.5 + Math.random() * 1.5; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 6, 80, x - 6, 170, x + 2, 256); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

function useMats() {
  return useMemo(() => ({
    iron: new THREE.MeshStandardMaterial({ color: '#2b2c30', metalness: 0.85, roughness: 0.45 }),
    face: new THREE.MeshStandardMaterial({ color: '#8a8e96', metalness: 0.95, roughness: 0.22 }),
    wood: new THREE.MeshStandardMaterial({ map: grainTex('#5a4128', '#2a1c10'), roughness: 0.85 }),
    darkWood: new THREE.MeshStandardMaterial({ map: grainTex('#3a2a1c', '#1a120a'), roughness: 0.9 }),
    stone: new THREE.MeshStandardMaterial({ color: '#6d655c', roughness: 0.95 }),
    soot: new THREE.MeshStandardMaterial({ color: '#2a2522', roughness: 0.95 }),
    coal: new THREE.MeshStandardMaterial({ color: '#140a06', emissiveMap: coalTex(), emissive: new THREE.Color('#ffffff'), emissiveIntensity: 1.4, roughness: 1 }),
    lump: new THREE.MeshStandardMaterial({ color: '#1a1412', roughness: 0.9, emissive: new THREE.Color('#ff4a10'), emissiveIntensity: 0.25 }),
    leather: new THREE.MeshStandardMaterial({ color: '#4a2c1a', roughness: 0.8 }),
    water: new THREE.MeshStandardMaterial({ color: '#16242a', metalness: 0.4, roughness: 0.08 }),
    steel: new THREE.MeshStandardMaterial({ color: '#2a2624', metalness: 0.6, roughness: 0.55, emissive: new THREE.Color('#000000') }),
    sleeve: new THREE.MeshStandardMaterial({ color: '#2e2a26', roughness: 0.95 }),
    glove: new THREE.MeshStandardMaterial({ color: '#6a4a2c', roughness: 0.75 }),
    crack: new THREE.MeshBasicMaterial({ color: '#0a0402' }),
  }), []);
}
type Mats = ReturnType<typeof useMats>;

/** The anvil on its stump: feet, waist, body, a bright face, the horn and the heel. */
function Anvil({ m }: { m: Mats }) {
  return (
    <group>
      <mesh position={[0, 0.48, 0]} material={m.darkWood} castShadow receiveShadow><cylinderGeometry args={[0.52, 0.62, 0.96, 14]} /></mesh>
      <mesh position={[0, 0.97, 0]} rotation-x={-Math.PI / 2}><ringGeometry args={[0.18, 0.2, 20]} /><meshStandardMaterial color="#2a1c10" /></mesh>
      <mesh position={[0, 1.02, 0]} material={m.iron} castShadow><boxGeometry args={[0.8, 0.12, 0.56]} /></mesh>
      <mesh position={[0, 1.2, 0]} material={m.iron} castShadow><boxGeometry args={[0.42, 0.26, 0.32]} /></mesh>
      <mesh position={[-0.05, 1.42, 0]} material={m.iron} castShadow receiveShadow><boxGeometry args={[1.3, 0.2, 0.42]} /></mesh>
      <mesh position={[-0.05, TOP - 0.006, 0]} material={m.face} receiveShadow><boxGeometry args={[1.28, 0.014, 0.4]} /></mesh>
      <mesh position={[0.92, 1.44, 0]} rotation-z={-Math.PI / 2} material={m.iron} castShadow><cylinderGeometry args={[0.015, 0.17, 0.66, 14]} /></mesh>
      <mesh position={[-0.8, 1.45, 0]} material={m.iron} castShadow><boxGeometry args={[0.22, 0.14, 0.3]} /></mesh>
      <mesh position={[-0.55, TOP + 0.001, 0]}><boxGeometry args={[0.07, 0.004, 0.07]} /><meshBasicMaterial color="#050505" /></mesh>
      {/* Iron staples holding it to the stump. */}
      {[-1, 1].map((s) => <mesh key={s} position={[s * 0.42, 0.98, 0]} material={m.iron}><boxGeometry args={[0.05, 0.22, 0.1]} /></mesh>)}
    </group>
  );
}

/** The hearth: a stone box with a glowing coal bed, a hood and chimney, the bellows on its left. */
function Hearth({ m, pump }: { m: Mats; pump?: { current: number } }) {
  const flames = useMemo<FlameSpot[]>(() => [[F.x - 0.35, FH + 0.05, F.z - 0.2, 0.55], [F.x + 0.3, FH + 0.05, F.z + 0.15, 0.45], [F.x, FH + 0.05, F.z - 0.45, 0.4]], []);
  const blocks = useMemo(() => {
    const out: { p: [number, number, number]; s: [number, number, number]; c: string }[] = [];
    let k = 3; const r = () => { k = (k * 16807) % 2147483647; return k / 2147483647; };
    for (let row = 0; row < 4; row++) for (let i = 0; i < 4; i++) {
      const y = 0.18 + row * 0.34, off = row % 2 ? 0.33 : 0;
      const x = -1.15 + off + i * 0.66;
      if (x > 1.2) continue;
      out.push({ p: [x, y, 1.0], s: [0.62, 0.31, 0.12], c: `hsl(30, ${6 + r() * 6}%, ${30 + r() * 10}%)` });
    }
    return out;
  }, []);
  const bel = useRef<THREE.Group>(null), coalRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const p = pump?.current ?? 0;
    if (bel.current) bel.current.rotation.z = -0.05 - 0.22 * (1 - p) + Math.sin(clock.elapsedTime * 0.7) * 0.01;
    m.coal.emissiveIntensity = 1.2 + p * 1.6 + Math.sin(clock.elapsedTime * 7) * 0.08;
    void coalRef;
  });
  const lumps = useMemo(() => Array.from({ length: 26 }, (_, i) => [Math.sin(i * 12.9) * 0.7, Math.cos(i * 7.3) * 0.5, 0.06 + (i % 4) * 0.02] as const), []);
  return (
    <group position={F}>
      {/* The hearth body, its faced stones, and an iron rim round the coal pan. */}
      <mesh position={[0, 0.7, 0]} material={m.stone} castShadow receiveShadow><boxGeometry args={[2.6, 1.4, 2.0]} /></mesh>
      {blocks.map((b, i) => <mesh key={i} position={b.p} castShadow><boxGeometry args={b.s} /><meshStandardMaterial color={b.c} roughness={0.95} /></mesh>)}
      <mesh ref={coalRef} position={[0, FH - 0.005, 0]} rotation-x={-Math.PI / 2} material={m.coal}><planeGeometry args={[1.7, 1.3]} /></mesh>
      {lumps.map(([x, z, s], i) => <mesh key={i} position={[x, FH + 0.02, z]} rotation={[i, i * 2, 0]} material={m.lump}><dodecahedronGeometry args={[s, 0]} /></mesh>)}
      {[[0, 0.68, 2.2, 0.1], [0, -0.68, 2.2, 0.1], [1.06, 0, 0.1, 1.46], [-1.06, 0, 0.1, 1.46]].map(([x, z, w, d], i) => <mesh key={i} position={[x, FH + 0.04, z]} material={m.iron}><boxGeometry args={[w, 0.1, d]} /></mesh>)}
      {/* Hood and chimney. */}
      <mesh position={[0, 3.25, -0.1]} rotation-y={Math.PI / 4} material={m.soot} castShadow><cylinderGeometry args={[0.55, 1.75, 1.3, 4, 1, true]} /></mesh>
      <mesh position={[0, 11.9, -0.1]} material={m.soot}><boxGeometry args={[0.8, 16, 0.8]} /></mesh>
      {/* A quench bucket and a coal shovel against the hearth. */}
      <mesh position={[1.55, 0.3, 0.7]} material={m.darkWood} castShadow><cylinderGeometry args={[0.24, 0.2, 0.6, 12]} /></mesh>
      <mesh position={[1.45, 0.75, -0.6]} rotation-z={0.25} material={m.iron}><cylinderGeometry args={[0.025, 0.025, 1.5, 6]} /></mesh>
      {/* Bellows on a trestle: two boards, the leather between, a nozzle into the fire and the pump pole. */}
      <group position={[-2.15, 0, 0]}>
        {[-0.45, 0.45].map((z) => <mesh key={z} position={[0, 0.5, z]} material={m.darkWood} castShadow><boxGeometry args={[0.08, 1.0, 0.08]} /></mesh>)}
        <mesh position={[0, 1.02, 0]} material={m.darkWood} castShadow><boxGeometry args={[1.3, 0.07, 0.9]} /></mesh>
        <mesh position={[0, 1.12, 0]} material={m.leather} scale={[0.6, 0.12, 0.42]}><sphereGeometry args={[1, 16, 8]} /></mesh>
        <group ref={bel} position={[0.62, 1.1, 0]}>
          <mesh position={[-0.62, 0.05, 0]} material={m.darkWood} castShadow><boxGeometry args={[1.25, 0.06, 0.86]} /></mesh>
          <mesh position={[-1.35, 0.28, 0]} rotation-z={0.9} material={m.darkWood}><cylinderGeometry args={[0.04, 0.04, 0.7, 6]} /></mesh>
        </group>
        <mesh position={[0.9, 1.08, 0]} rotation-z={-Math.PI / 2} material={m.iron}><cylinderGeometry args={[0.05, 0.08, 0.5, 8]} /></mesh>
      </group>
      <Flames spots={flames.map(([x, y, z, s]) => [x - F.x, y, z - F.z, s] as FlameSpot)} />
      <FireLight position={[0, FH + 0.8, 0.3]} color="#ff7a2a" intensity={70} distance={13} />
      <Embers position={[0, FH + 0.3, 0]} count={30} spread={0.8} height={5} />
    </group>
  );
}

/** Trough, tool rack and a barrel of finished blades. */
function Dressing({ m }: { m: Mats }) {
  return (
    <group>
      <group position={TR}>
        <mesh position={[0, 0.05, 0]} material={m.darkWood} castShadow><boxGeometry args={[2.0, 0.1, 0.8]} /></mesh>
        {[[0, 0.4, 0.4, 2.0, 0.08], [0, 0.4, -0.4, 2.0, 0.08], [0.98, 0.4, 0, 0.08, 0.86], [-0.98, 0.4, 0, 0.08, 0.86]].map(([x, y, z, w, d], i) => <mesh key={i} position={[x, y, z]} material={m.darkWood} castShadow><boxGeometry args={[w, 0.8, d]} /></mesh>)}
        {[-0.6, 0.6].map((x) => <mesh key={x} position={[x, 0.55, 0]} material={m.iron}><boxGeometry args={[0.05, 0.06, 0.9]} /></mesh>)}
        <mesh position={[0, 0.68, 0]} rotation-x={-Math.PI / 2} material={m.water}><planeGeometry args={[1.88, 0.74]} /></mesh>
      </group>
      <group position={[0.3, 0, -2.6]}>
        {[-1.4, 1.4].map((x) => <mesh key={x} position={[x, 1.25, 0]} material={m.darkWood} castShadow><boxGeometry args={[0.14, 2.5, 0.14]} /></mesh>)}
        <mesh position={[0, 2.3, 0]} material={m.darkWood} castShadow><boxGeometry args={[3.0, 0.12, 0.14]} /></mesh>
        {[-1.0, -0.6, -0.2, 0.25, 0.65, 1.05].map((x, i) => (
          <group key={x} position={[x, 2.22, 0.1]} rotation-z={(i % 2 ? 1 : -1) * 0.04}>
            {i % 2 === 0 ? (
              <>{/* Tongs */}
                <mesh position={[-0.03, -0.45, 0]} rotation-z={0.04} material={m.iron}><boxGeometry args={[0.03, 0.9, 0.03]} /></mesh>
                <mesh position={[0.03, -0.45, 0]} rotation-z={-0.04} material={m.iron}><boxGeometry args={[0.03, 0.9, 0.03]} /></mesh>
              </>
            ) : (
              <>{/* Hammer */}
                <mesh position={[0, -0.32, 0]} material={m.wood}><cylinderGeometry args={[0.025, 0.03, 0.64, 6]} /></mesh>
                <mesh position={[0, -0.68, 0]} material={m.iron}><boxGeometry args={[0.22, 0.09, 0.09]} /></mesh>
              </>
            )}
          </group>
        ))}
      </group>
      <group position={[2.4, 0, -1.9]}>
        <mesh position={[0, 0.45, 0]} material={m.darkWood} castShadow><cylinderGeometry args={[0.36, 0.32, 0.9, 14]} /></mesh>
        {[0.15, 0.75].map((y) => <mesh key={y} position={[0, y, 0]} rotation-x={Math.PI / 2} material={m.iron}><torusGeometry args={[0.35, 0.02, 6, 20]} /></mesh>)}
        {[[-0.1, 0.12, 0.08], [0.12, -0.06, -0.1], [0.0, 0.0, 0.18]].map(([x, z, r], i) => (
          <group key={i} position={[x, 0.9, z]} rotation={[r, i, -r]}>
            <mesh position={[0, 0.6, 0]} material={m.face}><boxGeometry args={[0.08, 1.2, 0.012]} /></mesh>
            <mesh position={[0, 0.0, 0]} material={m.iron}><boxGeometry args={[0.3, 0.04, 0.05]} /></mesh>
            <mesh position={[0, -0.12, 0]} material={m.leather}><cylinderGeometry args={[0.025, 0.025, 0.22, 6]} /></mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

function Station() {
  const m = useMats();
  const playing = usePlay().game && session.phase === 'play';
  return (
    <group position={[AT[0], 0, AT[1]]}>
      <Anvil m={m} />
      <Hearth m={m} />
      <Dressing m={m} />
      {!playing && <>
        {/* A cold billet and a hammer waiting on the anvil. */}
        <mesh position={[-0.1, TOP + 0.05, 0.02]} material={m.steel} castShadow><boxGeometry args={[0.7, 0.1, 0.2]} /></mesh>
        <group position={[0.35, TOP + 0.05, 0.12]} rotation-y={0.5}>
          <mesh position={[0, 0, 0.35]} rotation-x={Math.PI / 2} material={m.wood}><cylinderGeometry args={[0.03, 0.035, 0.8, 6]} /></mesh>
          <mesh material={m.iron}><boxGeometry args={[0.28, 0.1, 0.1]} /></mesh>
        </group>
      </>}
    </group>
  );
}

// ---- The blade: a profile that grows from a stubby billet to a pointed sword with a tang, extruded and bevelled.
function bladeGeo(p: number) {
  const L = 0.7 + 1.9 * p, hw = 0.11 - 0.035 * p, tang = 0.06 + 0.32 * p, tw = 0.04, pt = 0.03 + 0.42 * Math.pow(p, 1.4);
  const th = 0.12 - 0.075 * p;
  const s = new THREE.Shape();
  s.moveTo(-tang, -tw); s.lineTo(0, -tw); s.lineTo(0, -hw); s.lineTo(L - pt, -hw); s.lineTo(L, -hw * (1 - p) * 0.9); s.lineTo(L, hw * (1 - p) * 0.9); s.lineTo(L - pt, hw); s.lineTo(0, hw); s.lineTo(0, tw); s.lineTo(-tang, tw); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: th, bevelEnabled: true, bevelSize: 0.012 + 0.03 * p, bevelThickness: 0.01 + 0.012 * p, bevelSegments: 2, curveSegments: 1 });
  g.translate(0, 0, -th / 2); g.rotateX(-Math.PI / 2);
  g.translate(-(L - tang) / 2, 0, 0); // centred on its length
  g.computeVertexNormals();
  return { g, L, hw, tang, th };
}

const ARM_DIR = new THREE.Vector3(0.38, 0.62, 0.95).normalize();
const ARM_Q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), ARM_DIR);
const ARM_MID = ARM_DIR.clone().multiplyScalar(0.24), SLEEVE_MID = ARM_DIR.clone().multiplyScalar(0.72);
const track = { on: false, now: 0, beats: [] as number[], done: [] as boolean[] };
const ui = gameUi({ heat: 0, quality: 1, landed: 0, cracks: 0, judge: '', judgeT: 0, combo: 0, line: 'Pump the bellows: tap Space until the steel runs white.', phase: 'heat' as Phase, temp: 0 });
type Phase = 'heat' | 'carry' | 'strike' | 'back' | 'quench' | 'reveal' | 'over';
type Judge = 'perfect' | 'good' | 'miss';
const CREDIT: Record<Judge, number> = { perfect: 1, good: 0.62, miss: 0 };
const GROW: Record<Judge, number> = { perfect: 1, good: 0.8, miss: 0.3 };

function Play({ room, end }: { room: Room; end: (r: Result) => void }) {
  const camera = useThree((s) => s.camera);
  const m = useMats();
  useMemo(() => { ui.reset(); track.on = false; }, []);
  const st = useRef({
    phase: 'heat' as Phase, pt: 0, heat: 0, T: 0.12, pump: 0, score: 0, grow: 0, judged: 0, perfects: 0, combo: 0,
    beats: [] as number[], done: [] as boolean[], spots: [] as number[], swing: 9, swingFrom: 0, angle: -0.4, shake: 0, flash: 0, squash: 0,
    cracks: [] as { u: number; v: number; a: number }[], shown: -1, L: 0.7, hw: 0.11, tang: 0.06, th: 0.12, quench: 0, ended: false, clicks: 0,
  });
  const pumpRef = useRef(0);
  const billet = useRef<THREE.Group>(null), blade = useRef<THREE.Mesh>(null), hammer = useRef<THREE.Group>(null), hammerAt = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null), target = useRef<THREE.Mesh>(null), glow = useRef<THREE.PointLight>(null), flash = useRef<THREE.PointLight>(null);
  const crackRefs = useRef<(THREE.Group | null)[]>([]);
  const camPos = useMemo(() => new THREE.Vector3(), []), camLook = useMemo(() => new THREE.Vector3(), []);
  const lookNow = useRef(new THREE.Vector3(room.x + F.x, FH, room.z + AT[1] + F.z));
  const tmpC = useMemo(() => new THREE.Color(), []);
  // Sparks: one pool of points, each with a velocity and a life.
  const N = 420;
  const sparks = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3).fill(-100), col = new Float32Array(N * 3);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 0.075, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    return { g, mat, vel: new Float32Array(N * 3), life: new Float32Array(N), max: new Float32Array(N).fill(1), next: 0 };
  }, []);
  const steam = useRef(Array.from({ length: 14 }, () => ({ t: 9, x: 0, z: 0, s: 1 })));
  const steamRefs = useRef<(THREE.Sprite | null)[]>([]);
  const steamMats = useMemo(() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!, gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(240,236,228,0.9)'); gr.addColorStop(0.5, 'rgba(230,226,220,0.35)'); gr.addColorStop(1, 'rgba(230,226,220,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    return Array.from({ length: 14 }, () => new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
  }, []);

  // Clicks strike too.
  useEffect(() => {
    const down = (e: PointerEvent) => { if (e.button === 0) st.current.clicks++; };
    window.addEventListener('pointerdown', down);
    return () => window.removeEventListener('pointerdown', down);
  }, []);

  const spray = (at: THREE.Vector3, n: number, power: number) => {
    const pos = sparks.g.attributes.position.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const k = sparks.next = (sparks.next + 1) % N;
      pos[k * 3] = at.x; pos[k * 3 + 1] = at.y; pos[k * 3 + 2] = at.z;
      const a = Math.random() * Math.PI * 2, sp = (0.8 + Math.random() * 2.6) * power;
      sparks.vel[k * 3] = Math.cos(a) * sp; sparks.vel[k * 3 + 1] = (1 + Math.random() * 3.2) * power; sparks.vel[k * 3 + 2] = Math.sin(a) * sp;
      sparks.life[k] = sparks.max[k] = 0.35 + Math.random() * 0.6;
    }
  };

  const schedule = (s: typeof st.current) => {
    const iv = IV[s.heat], pat = PATTERN[s.heat];
    s.beats = []; s.done = []; s.spots = [];
    let t = iv * 2.2; // a two-beat count-in
    for (let i = 0; i < PER; i++) { s.beats.push(t); s.done.push(false); s.spots.push([0.3, 0.6, 0.45, 0.75, 0.2, 0.55][(i + s.heat * 2) % 6]); t += iv * pat[i % pat.length]; }
    track.beats = s.beats; track.done = s.done; track.on = true;
  };

  const judge = (s: typeof st.current, i: number, j: Judge, spot: THREE.Vector3) => {
    s.done[i] = true; s.judged++;
    s.score += CREDIT[j]; s.grow += GROW[j];
    if (j === 'perfect') s.perfects++;
    s.combo = j === 'miss' ? 0 : s.combo + 1;
    if (j === 'miss') {
      s.cracks.push({ u: 0.15 + Math.random() * 0.7, v: (Math.random() - 0.5) * 1.2, a: (Math.random() - 0.5) * 1.2 });
      ui.set({ cracks: s.cracks.length });
    } else {
      ring(j === 'perfect' ? 1 : 0.65, j === 'perfect' ? 1.2 : 0.7);
      spray(spot, j === 'perfect' ? 70 : 32, j === 'perfect' ? 1.2 : 0.8);
      s.shake = j === 'perfect' ? 0.55 : 0.32; s.flash = j === 'perfect' ? 1 : 0.55; s.squash = 1;
      if (s.combo > 0 && s.combo % 8 === 0) voice('man', 3, 0.3);
    }
    const lines: Record<Judge, string[]> = {
      perfect: ['The steel sings.', 'Clean.', 'Right on the beat.', 'Draven would nod.'],
      good: ['Close.', 'Good blow.', 'A touch off.'],
      miss: ['It cracks!', 'Off the beat. A crack runs.', 'The steel splits.'],
    };
    ui.set({ judge: j, judgeT: performance.now(), combo: s.combo, landed: s.judged, quality: s.score / Math.max(1, s.judged), line: lines[j][Math.floor(Math.random() * lines[j].length)] });
  };

  useFrame(({ clock }, rawDt) => {
    const s = st.current;
    const dt = Math.min(rawDt, 0.05);
    const ks = gameKeys();
    const taps = ks.filter((k) => k === ' ' || k === 'e' || k === 'f').length + s.clicks;
    s.clicks = 0;
    s.pt += dt;
    // ---- Where things are, in the station's frame.
    const anvilAt = new THREE.Vector3(0, TOP + s.th / 2 + 0.01, 0);
    const forgeAt = new THREE.Vector3(F.x + 0.25, FH + 0.07, F.z + 0.1);
    const troughAt = new THREE.Vector3(TR.x, 0.45, TR.z);
    const b = billet.current!;
    let spot = new THREE.Vector3();
    const spotOf = (u: number) => new THREE.Vector3(THREE.MathUtils.clamp(-(s.L - s.tang) / 2 + u * s.L, -0.62, 0.62), TOP + s.th + 0.012, 0);

    if (s.phase === 'heat') {
      // Pump: each tap blows the coals bright and the steel climbs; it creeps up on its own too.
      if (taps > 0) { s.pump = 1; whoosh(); s.T += 0.065 * taps; burst(900 + Math.random() * 300, 1, 0.05, 0.12, 0.08); }
      s.T += dt * 0.07;
      s.pump = Math.max(0, s.pump - dt * 2.4);
      b.position.lerp(forgeAt, 1 - Math.exp(-dt * 6));
      b.rotation.y = Math.PI;
      if (Math.random() < dt * 6) burst(2600 + Math.random() * 2000, 2, 0.02, 0.03);
      if (s.T >= 1.12) { s.T = 1.15; s.phase = 'carry'; s.pt = 0; burst(300, 0.8, 0.12, 0.3); ui.set({ phase: 'carry', line: 'White-hot. To the anvil.' }); }
    } else if (s.phase === 'carry' || s.phase === 'back' || s.phase === 'quench') {
      const from = s.phase === 'carry' ? forgeAt : anvilAt, to = s.phase === 'back' ? forgeAt : s.phase === 'carry' ? anvilAt : troughAt;
      const dur = s.phase === 'quench' ? 1.1 : 0.9;
      const u = Math.min(1, s.pt / dur), e = u * u * (3 - 2 * u);
      b.position.lerpVectors(from, to, e); b.position.y += Math.sin(e * Math.PI) * 0.7;
      b.rotation.y = s.phase === 'carry' ? Math.PI * (1 - e) : s.phase === 'back' ? Math.PI * e : 0;
      s.T -= dt * 0.05;
      if (s.phase === 'quench' && u >= 1) {
        // Into the water.
        if (s.quench === 0) { hissQ(); steam.current.forEach((p, i) => { p.t = -i * 0.06; p.x = (Math.random() - 0.5) * 1.4; p.z = (Math.random() - 0.5) * 0.5; p.s = 0.5 + Math.random() * 0.5; }); s.shake = 0.3; }
        s.quench += dt;
        b.position.y = troughAt.y + 0.25 - Math.min(1, s.quench / 0.25) * 0.42 + Math.max(0, s.quench - 1.0) * 1.2;
        s.T = Math.max(0, s.T - dt * 2.2);
        if (s.quench > 1.6) { s.phase = 'reveal'; s.pt = 0; const q = s.score / TOTAL; ui.set({ phase: 'reveal', line: q >= 0.6 ? 'Out of the water, grey and true.' : s.cracks.length > 8 ? 'Out of the water. The cracks show.' : 'Out of the water. Not quite enough.' }); }
      } else if (u >= 1 && s.phase === 'carry') { s.phase = 'strike'; s.pt = 0; schedule(s); ui.set({ phase: 'strike', heat: s.heat, line: s.heat === 0 ? 'Strike as the ring closes and the steel flares.' : s.heat === 1 ? 'Faster now. The steel won’t wait.' : 'The last heat. Mind the swing in it.' }); }
      else if (u >= 1 && s.phase === 'back') { s.phase = 'heat'; s.pt = 0; s.heat++; ui.set({ phase: 'heat', heat: s.heat, line: 'Back in the fire. Pump!' }); }
    } else if (s.phase === 'strike') {
      b.position.lerp(anvilAt, 1 - Math.exp(-dt * 12)); b.rotation.y = 0;
      const last = s.beats[s.beats.length - 1];
      // Steel cools across the heat.
      s.T = THREE.MathUtils.lerp(1.15, 0.42, Math.min(1, s.pt / (last + 0.3)));
      // Count-in taps, and in the first two heats a quiet tick on every beat.
      const iv = IV[s.heat];
      for (const c of [0, iv * 1.1]) if (s.pt - dt < c && s.pt >= c) { ring(0.22, 0.25, 1500); }
      if (s.heat < 2) for (const bt of s.beats) if (s.pt - dt < bt && s.pt >= bt) tick(s.heat === 0 ? 1 : 0.5);
      // The strike.
      for (let k = 0; k < taps; k++) {
        if (s.swing < 0.12) break; // the hammer is still coming down
        s.swing = 0; s.swingFrom = s.angle;
        let best = -1, err = 9;
        s.beats.forEach((bt, i) => { if (!s.done[i] && Math.abs(s.pt - bt) < Math.abs(err)) { err = s.pt - bt; best = i; } });
        const sp = spotOf(best >= 0 ? s.spots[best] : 0.5);
        if (best >= 0 && Math.abs(err) < 0.3) judge(s, best, Math.abs(err) < 0.07 ? 'perfect' : Math.abs(err) < 0.155 ? 'good' : 'miss', sp);
        else { burst(700, 2, 0.12, 0.08); ui.set({ line: 'Wait for the ring.' }); }
        if (best >= 0 && Math.abs(err) < 0.3 && Math.abs(err) >= 0.155) { clank(); s.shake = 0.25; spray(sp, 8, 0.4); }
      }
      // A beat let go by.
      s.beats.forEach((bt, i) => { if (!s.done[i] && s.pt > bt + 0.2) { judge(s, i, 'miss', spotOf(s.spots[i])); clank(); ui.set({ line: 'Too slow! A crack runs.' }); } });
      if (s.done.every(Boolean) && s.pt > last + 0.55) {
        track.on = false;
        if (s.heat < HEATS - 1) { s.phase = 'back'; s.pt = 0; ui.set({ phase: 'back', line: 'It’s cooling. Back to the fire.' }); }
        else { s.phase = 'quench'; s.pt = 0; s.quench = 0; ui.set({ phase: 'quench', line: 'Into the trough.' }); }
      }
    } else if (s.phase === 'reveal') {
      // Lifted out, turned to the light.
      const u = Math.min(1, s.pt / 1.2), e = u * u * (3 - 2 * u);
      b.position.lerpVectors(new THREE.Vector3(troughAt.x, troughAt.y + 0.5, troughAt.z), new THREE.Vector3(1.6, 2.6, 1.1), e);
      b.rotation.set(e * 0.5, -e * 0.6, e * 0.9);
      if (s.pt > 3.2 && !s.ended) {
        s.ended = true; s.phase = 'over';
        const q = s.score / TOTAL, won = q >= 0.6;
        const name = q >= 0.9 ? 'A lord’s blade' : q >= 0.75 ? 'A knight’s sword' : q >= 0.6 ? 'A soldier’s blade' : q >= 0.4 ? 'A cracked practice blade' : 'Scrap iron';
        if (won) voice('lord', 6, 0); else voice('soldier', 4, 0);
        end({ won, score: Math.round(q * 100), grade: Math.max(0, (q - 0.6) / 0.4), line: `${name}: quality ${Math.round(q * 100)}%, ${s.perfects} perfect strikes, ${s.cracks.length} crack${s.cracks.length === 1 ? '' : 's'}. ${won ? 'House Draven will hang it in the hall.' : 'Draven needs 60%.'}` });
      }
    }
    // ---- Next beat (for the ring, the hammer's wind-up and the flare).
    let nextI = -1;
    if (s.phase === 'strike') nextI = s.done.findIndex((d) => !d);
    const toBeat = nextI >= 0 ? s.beats[nextI] - s.pt : 9;
    if (nextI >= 0) spot = spotOf(s.spots[nextI]); else spot = spotOf(0.5);
    track.now = s.pt;
    // ---- The blade grows smoothly toward what you've earned.
    const p = Math.min(1, s.grow / TOTAL);
    if (Math.abs(p - s.shown) > 0.003) {
      s.shown += (p - s.shown) * Math.min(1, dt * 10); if (s.shown < 0) s.shown = p;
      const r = bladeGeo(Math.max(0, s.shown));
      blade.current!.geometry.dispose(); blade.current!.geometry = r.g;
      s.L = r.L; s.hw = r.hw; s.tang = r.tang; s.th = r.th;
    }
    // Squash on a blow.
    s.squash = Math.max(0, s.squash - dt * 7);
    b.scale.set(1 + s.squash * 0.04, 1 - s.squash * 0.18, 1);
    // ---- Heat and the flare on the beat.
    const flare = s.phase === 'strike' ? Math.exp(-((toBeat / 0.1) ** 2)) : 0;
    heatColor(s.T + flare * 0.12, tmpC);
    m.steel.emissive.copy(tmpC);
    m.steel.emissiveIntensity = (s.T > 0.12 ? 0.8 : 0) + flare * 0.9;
    if (s.phase === 'reveal' || s.phase === 'over' || (s.phase === 'quench' && s.quench > 0.3)) {
      m.steel.color.set('#a3a8b0'); m.steel.metalness = 0.95; m.steel.roughness = 0.26;
    }
    pumpRef.current = s.pump;
    if (glow.current) { glow.current.position.copy(b.position).add(new THREE.Vector3(0, 0.5, 0.3)); glow.current.color.copy(tmpC); glow.current.intensity = Math.max(0, s.T - 0.2) * 16 + flare * 14; }
    s.flash = Math.max(0, s.flash - dt * 5);
    if (flash.current) { flash.current.position.copy(spot).add(new THREE.Vector3(0, 0.3, 0.2)); flash.current.intensity = s.flash * 70; }
    // ---- The approach ring.
    const rr = ringRef.current!, tg = target.current!;
    const appr = IV[s.heat] * 1.25;
    const showRing = s.phase === 'strike' && nextI >= 0 && toBeat < appr && toBeat > -0.2;
    rr.visible = showRing; tg.visible = s.phase === 'strike' && nextI >= 0;
    if (showRing) {
      const k = Math.max(0, toBeat / appr);
      rr.position.copy(spot); rr.scale.setScalar(1 + k * 5);
      (rr.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.65 * (1 - k);
      (rr.material as THREE.MeshBasicMaterial).color.set(Math.abs(toBeat) < 0.07 ? '#ffffff' : '#ffc04a');
    }
    if (tg.visible) { tg.position.copy(spot); (tg.material as THREE.MeshBasicMaterial).opacity = 0.35 + flare * 0.6; }
    // ---- The hammer: held up at rest, winding up as the beat comes, a fast blow, a bounce.
    s.swing += dt;
    const raise = s.phase === 'strike' ? -0.35 - 0.85 * THREE.MathUtils.clamp(1 - toBeat / (IV[s.heat] * 0.8), 0, 1) : -0.9;
    if (s.swing < 0.06) s.angle = THREE.MathUtils.lerp(s.swingFrom, 0.0, s.swing / 0.06);
    else if (s.swing < 0.22) s.angle = THREE.MathUtils.lerp(0.0, -0.45, (s.swing - 0.06) / 0.16);
    else s.angle += (raise - s.angle) * Math.min(1, dt * 9);
    const hm = hammer.current!, ha = hammerAt.current!;
    const hx = s.phase === 'strike' ? spot.x : 0.2;
    ha.position.lerp(new THREE.Vector3(hx + 0.95, TOP + s.th + 0.17, 0.22), 1 - Math.exp(-dt * 14));
    hm.rotation.z = s.angle;
    ha.visible = s.phase === 'strike';
    // ---- Cracks on the steel.
    crackRefs.current.forEach((c, i) => {
      if (!c) return;
      const k = s.cracks[i];
      c.visible = !!k;
      if (k) { c.position.set(-(s.L - s.tang) / 2 + k.u * s.L, s.th / 2 + 0.014, k.v * s.hw); c.rotation.y = k.a; }
    });
    // ---- Sparks.
    {
      const pos = sparks.g.attributes.position.array as Float32Array, col = sparks.g.attributes.color.array as Float32Array;
      for (let i = 0; i < N; i++) {
        if (sparks.life[i] <= 0) { if (pos[i * 3 + 1] > -50) pos[i * 3 + 1] = -100; continue; }
        sparks.life[i] -= dt;
        sparks.vel[i * 3 + 1] -= 9.5 * dt;
        pos[i * 3] += sparks.vel[i * 3] * dt; pos[i * 3 + 1] += sparks.vel[i * 3 + 1] * dt; pos[i * 3 + 2] += sparks.vel[i * 3 + 2] * dt;
        if (pos[i * 3 + 1] < 0.02) { pos[i * 3 + 1] = 0.02; sparks.vel[i * 3 + 1] *= -0.3; sparks.vel[i * 3] *= 0.5; sparks.vel[i * 3 + 2] *= 0.5; }
        const l = sparks.life[i] / sparks.max[i];
        col[i * 3] = 1; col[i * 3 + 1] = 0.35 + 0.6 * l; col[i * 3 + 2] = 0.1 + 0.6 * l * l;
      }
      sparks.g.attributes.position.needsUpdate = true; sparks.g.attributes.color.needsUpdate = true;
    }
    // ---- Steam.
    steam.current.forEach((p, i) => {
      const mm = steamRefs.current[i]; if (!mm) return;
      p.t += dt;
      mm.visible = p.t > 0 && p.t < 2.2;
      if (mm.visible) { mm.position.set(TR.x + p.x * (1 + p.t * 0.3), 0.75 + p.t * 1.1, TR.z + p.z); mm.scale.setScalar(p.s * (0.8 + p.t * 1.3)); steamMats[i].opacity = 0.55 * Math.min(1, p.t * 5) * (1 - p.t / 2.2); }
    });
    // ---- The camera: on the forge while it heats, over the anvil while you strike, on the trough, then the blade.
    const look = new THREE.Vector3(), pos = new THREE.Vector3();
    if (s.phase === 'heat' || s.phase === 'back') { pos.set(F.x + 2.7, 3.4, F.z + 3.6); look.set(F.x, FH + 0.1, F.z); }
    else if (s.phase === 'strike' || s.phase === 'carry') { pos.set(0.55, TOP + 2.05, 2.95); look.set(0, TOP, -0.15); }
    else if (s.phase === 'quench') { pos.set(TR.x - 1.4, 2.6, TR.z + 3.2); look.set(TR.x, 0.8, TR.z); }
    else { pos.set(0.6, 2.9, 4.0); look.copy(b.position); }
    camPos.set(room.x + AT[0] + pos.x, pos.y, room.z + AT[1] + pos.z);
    camLook.set(room.x + AT[0] + look.x, look.y, room.z + AT[1] + look.z);
    camera.position.lerp(camPos, 1 - Math.exp(-dt * 3.2));
    lookNow.current.lerp(camLook, 1 - Math.exp(-dt * 4));
    camera.lookAt(lookNow.current);
    s.shake = Math.max(0, s.shake - dt * 2.2);
    if (s.shake > 0) { const k = s.shake * s.shake; camera.rotateZ(Math.sin(clock.elapsedTime * 53) * k * 0.04); camera.rotateX(Math.sin(clock.elapsedTime * 37) * k * 0.05); }
    // HUD temperature, throttled.
    if (Math.abs(ui.state.temp - s.T) > 0.03) ui.set({ temp: s.T });
  });

  const init = useMemo(() => bladeGeo(0).g, []);
  return (
    <group position={[AT[0], 0, AT[1]]}>
      <Hearth m={m} pump={pumpRef} />
      <group ref={billet} position={[F.x, FH + 0.07, F.z]}>
        <mesh ref={blade} geometry={init} material={m.steel} castShadow />
        {/* Tongs gripping the tang, running off toward you. */}
        <group position={[-0.62, 0, 0.02]} rotation-y={-0.5}>
          {[-0.025, 0.025].map((y) => <mesh key={y} position={[-0.55, y, 0]} rotation-z={Math.PI / 2} material={m.iron}><cylinderGeometry args={[0.018, 0.018, 1.2, 6]} /></mesh>)}
          <mesh position={[0.02, 0, 0]} material={m.iron}><boxGeometry args={[0.1, 0.07, 0.06]} /></mesh>
        </group>
        {Array.from({ length: 16 }, (_, i) => (
          <group key={i} ref={(g) => { crackRefs.current[i] = g; }} visible={false}>
            <mesh material={m.crack} position={[0, 0, 0]} rotation-y={0.4}><boxGeometry args={[0.012, 0.004, 0.07]} /></mesh>
            <mesh material={m.crack} position={[0.022, 0, 0.055]} rotation-y={-0.5}><boxGeometry args={[0.01, 0.004, 0.06]} /></mesh>
            <mesh material={m.crack} position={[-0.015, 0, -0.05]} rotation-y={-0.2}><boxGeometry args={[0.009, 0.004, 0.05]} /></mesh>
          </group>
        ))}
      </group>
      {/* Your hammer, in a gloved fist, the sleeve running back toward you. */}
      <group ref={hammerAt} position={[1.1, TOP + 0.3, 0.22]}>
        <group ref={hammer}>
          <mesh position={[-0.45, 0, 0]} rotation-z={Math.PI / 2} material={m.wood} castShadow><cylinderGeometry args={[0.028, 0.034, 0.95, 8]} /></mesh>
          <mesh position={[-0.9, -0.02, 0]} material={m.iron} castShadow><boxGeometry args={[0.13, 0.3, 0.13]} /></mesh>
          <mesh position={[-0.9, -0.17, 0]} material={m.face}><boxGeometry args={[0.12, 0.012, 0.12]} /></mesh>
          <mesh position={[-0.03, 0, 0]} material={m.glove} scale={[0.1, 0.075, 0.085]} castShadow><sphereGeometry args={[1, 12, 8]} /></mesh>
        </group>
        {/* Forearm and sleeve, from the fist back toward your shoulder. */}
        <mesh position={ARM_MID} quaternion={ARM_Q} material={m.glove} castShadow><cylinderGeometry args={[0.07, 0.065, 0.42, 10]} /></mesh>
        <mesh position={SLEEVE_MID} quaternion={ARM_Q} material={m.sleeve} castShadow><cylinderGeometry args={[0.12, 0.1, 0.7, 10]} /></mesh>
      </group>
      <mesh ref={ringRef} rotation-x={-Math.PI / 2} visible={false}><ringGeometry args={[0.11, 0.135, 40]} /><meshBasicMaterial color="#ffc04a" transparent opacity={0.8} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} /></mesh>
      <mesh ref={target} rotation-x={-Math.PI / 2} visible={false}><ringGeometry args={[0.1, 0.112, 40]} /><meshBasicMaterial color="#fff3d6" transparent opacity={0.4} depthWrite={false} side={THREE.DoubleSide} /></mesh>
      <points geometry={sparks.g} material={sparks.mat} frustumCulled={false} />
      {steam.current.map((_, i) => <sprite key={i} ref={(mm) => { steamRefs.current[i] = mm; }} material={steamMats[i]} visible={false} />)}
      <pointLight ref={glow} intensity={0} distance={4.5} decay={1.8} />
      <pointLight ref={flash} color="#ffd9a0" intensity={0} distance={6} decay={1.5} />
    </group>
  );
}

// ---- HUD.
function Track() {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const el = box.current; if (!el) return;
      el.style.opacity = track.on ? '1' : '0';
      const marks = el.querySelectorAll<HTMLElement>('i');
      let k = 0;
      track.beats.forEach((bt, i) => {
        const dt = bt - track.now;
        if (track.done[i] || dt < -0.25 || dt > 2.2 || k >= marks.length) return;
        const mk = marks[k++];
        mk.style.display = 'block';
        mk.style.left = `${50 + (dt / 2.2) * 48}%`;
        mk.className = Math.abs(dt) < 0.07 ? 'hot' : '';
      });
      for (; k < marks.length; k++) marks[k].style.display = 'none';
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <div ref={box} className="frg-track"><b />{Array.from({ length: 8 }, (_, i) => <i key={i} />)}</div>;
}

function Hud() {
  const s = ui.use();
  const age = performance.now() - s.judgeT;
  const pct = Math.round(s.quality * 100);
  const words: Record<string, string> = { perfect: 'Perfect', good: 'Good', miss: 'Miss' };
  return (
    <>
      <div className="frg-top">
        <div className="frg-heats">{Array.from({ length: HEATS }, (_, i) => <i key={i} className={i < s.heat ? 'done' : i === s.heat ? 'now' : ''} />)}<small>heat {s.heat + 1} of {HEATS}</small></div>
        <div className="frg-q">
          <div className="bar"><i style={{ width: `${s.landed ? pct : 0}%` }} className={pct >= 60 ? 'ok' : 'low'} /><span className="mark" /></div>
          <small>quality <b>{s.landed ? `${pct}%` : '—'}</b> · 60% to win · {s.landed}/{TOTAL} strikes</small>
        </div>
        <div className="frg-cracks"><b>{s.cracks}</b><small>{s.cracks === 1 ? 'crack' : 'cracks'}</small></div>
      </div>
      {s.phase === 'heat' && (
        <div className="frg-temp"><div className="bar"><i style={{ width: `${Math.min(100, (s.temp / 1.12) * 100)}%` }} /></div><small>heat the steel</small></div>
      )}
      <div className="game-hud">
        {s.judge && age < 700 && <div key={s.judgeT} className={`big frg-judge ${s.judge}`}>{words[s.judge]}{s.combo >= 3 && s.judge !== 'miss' && <small> ×{s.combo}</small>}</div>}
        <div className="line">{s.line}</div>
        <Track />
        <div className="hint">{s.phase === 'heat' ? <><kbd>Space</kbd> tap to pump the bellows</> : <><kbd>Space</kbd> or click to strike as the ring closes</>}</div>
      </div>
    </>
  );
}

register({
  id: 'forge', name: 'The Forge',
  pitch: 'Three heats to make a blade. Pump the bellows till the steel runs white, then strike on the beat as the ring closes. Good blows draw the blade out; misses crack it. Finish with 60% quality to win.',
  keys: [['Space', 'pump the bellows / strike'], ['Click', 'strike'], ['Esc', 'leave']],
  entry: 400,
  Station, Play, Hud,
  view: () => ({ pos: [AT[0] + 1.6, 4.4, AT[1] + 6.4], look: [AT[0] - 1.6, 1.5, AT[1] - 0.8] }),
});
