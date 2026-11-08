// House Corrin's game, in the feast hall at Redfield Keep: Axe Throw. Five axes at the painted boar target at the end
// of the hall. Each throw is two beats of timing: lock the swinging aim, then stop the power needle in the sweet band
// (too soft and the axe drops low, too hard and it flies high; far off and it turns handle-first and bounces off).
// From the third axe the target slides on its rail, so you aim where it will be. Rings score 10 / 5 / 2; 25 wins.
import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { burst, voice } from '../realm/sound.ts';
import { FireLight, Flames, type FlameSpot } from '../realm/fire.tsx';
import type { Room } from '../realm/rooms.ts';
import { usePlay } from '../realm/play.ts';
import { drawSigil, sigilsReady } from '../realm/sigils.ts';
import { gameKeys, gameUi, register, session, type Result } from './host.ts';
import './axes.css';

// ---- The range, in the hall's frame. The station is [0, -6]; you throw from the chalk line toward −z.
const TZ = -18;          // the target's face
const TY = 2.7;          // height of the bull
const R = 1.15;          // target radius
const LINE = -4.6;       // the throwing line
const AXES = 5, TO_WIN = 25;
const SWEET: [number, number] = [0.66, 0.86];
const RINGS: [number, number][] = [[0.3, 10], [0.66, 5], [R * 0.97, 2]];

// ---- The axe: an ash handle and a bearded iron head, built round the head (it spins about there in flight).
const axeGeo = (() => {
  const handle = new THREE.CylinderGeometry(0.045, 0.055, 1.25, 8).translate(0, -0.56, 0);
  const s = new THREE.Shape();
  // In the head's plane: x forward (the bit), y up.
  s.moveTo(-0.12, 0.09); s.lineTo(0.06, 0.08); s.quadraticCurveTo(0.2, 0.12, 0.33, 0.24);
  s.quadraticCurveTo(0.4, 0.02, 0.33, -0.22); s.quadraticCurveTo(0.2, -0.12, 0.08, -0.12); s.lineTo(0.05, -0.05); s.lineTo(-0.12, -0.07); s.closePath();
  const head = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1 })
    .translate(0, 0, -0.035).rotateY(Math.PI / 2);
  return { handle, head };
})();
const ash = new THREE.MeshStandardMaterial({ color: '#9a7350', roughness: 0.7 });
const iron = new THREE.MeshStandardMaterial({ color: '#5e6266', metalness: 0.8, roughness: 0.38 });
const wrap = new THREE.MeshStandardMaterial({ color: '#3b2216', roughness: 0.9 });

function Axe({ refs }: { refs?: (g: THREE.Group | null) => void }) {
  return (
    <group ref={refs}>
      <mesh geometry={axeGeo.handle} material={ash} castShadow />
      <mesh geometry={axeGeo.head} material={iron} castShadow />
      <mesh position={[0, -1.02, 0]} material={wrap}><cylinderGeometry args={[0.062, 0.062, 0.32, 8]} /></mesh>
    </group>
  );
}

// ---- The target: a slab of oak trunk, the boar of Corrin painted over red and white rings.
let faceTex: THREE.CanvasTexture | undefined;
function paintTarget(c: HTMLCanvasElement) {
  const g = c.getContext('2d')!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // End grain.
  g.fillStyle = '#b48858'; g.fillRect(0, 0, 512, 512);
  for (let r = 4; r < 256; r += 5 + rnd() * 6) { g.strokeStyle = `rgba(90,55,25,${0.12 + rnd() * 0.18})`; g.lineWidth = 1 + rnd() * 2; g.beginPath(); g.arc(256 + rnd() * 4, 256 + rnd() * 4, r, 0, Math.PI * 2); g.stroke(); }
  for (let i = 0; i < 9; i++) { const a = rnd() * Math.PI * 2; g.strokeStyle = 'rgba(40,24,10,0.35)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(256 + Math.cos(a) * 30, 256 + Math.sin(a) * 30); g.lineTo(256 + Math.cos(a) * 250, 256 + Math.sin(a) * 250); g.stroke(); }
  // Painted rings, a little worn.
  const ring = (rr: number, col: string) => { g.fillStyle = col; g.beginPath(); g.arc(256, 256, rr, 0, Math.PI * 2); g.fill(); };
  g.globalAlpha = 0.88;
  ring(250, '#e9dfc8'); ring((0.66 / R) * 250, '#8c1c1c'); ring((0.3 / R) * 250, '#e2b23c');
  g.globalAlpha = 1;
  g.strokeStyle = '#1a1414'; g.lineWidth = 5;
  for (const rr of [250, (0.66 / R) * 250, (0.3 / R) * 250]) { g.beginPath(); g.arc(256, 256, rr - 2, 0, Math.PI * 2); g.stroke(); }
  // The boar of Corrin, painted across the red.
  drawSigil(g, 1, 256 - 66, 256 - 150, 132, 'rgba(26,18,14,0.6)');
  // Old cuts from a hundred feasts.
  for (let i = 0; i < 80; i++) { const a = rnd() * Math.PI * 2, d = rnd() * 240; g.strokeStyle = 'rgba(30,18,8,0.5)'; g.lineWidth = 2; const x = 256 + Math.cos(a) * d, y = 256 + Math.sin(a) * d, b = rnd() * Math.PI; g.beginPath(); g.moveTo(x - Math.cos(b) * 9, y - Math.sin(b) * 9); g.lineTo(x + Math.cos(b) * 9, y + Math.sin(b) * 9); g.stroke(); }
}
function targetTexture() {
  if (faceTex) return faceTex;
  const c = document.createElement('canvas'); c.width = c.height = 512;
  paintTarget(c);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  sigilsReady(() => { paintTarget(c); tex.needsUpdate = true; });
  return (faceTex = tex);
}

/** The round itself: the slab on its two legs, at its rest point (it slides on the rail in later throws). */
function Target({ refs }: { refs?: (g: THREE.Group | null) => void }) {
  const tex = useMemo(targetTexture, []);
  return (
    <group ref={refs} position={[0, TY, TZ]}>
      <mesh rotation-x={Math.PI / 2} castShadow receiveShadow><cylinderGeometry args={[R, R * 1.03, 0.5, 40]} /><meshStandardMaterial color="#6b4a2c" roughness={0.9} /></mesh>
      <mesh position={[0, 0, 0.252]}><circleGeometry args={[R, 48]} /><meshStandardMaterial map={tex} roughness={0.85} /></mesh>
      {/* The iron hoop round the slab and the hanging chain eyes. */}
      <mesh><torusGeometry args={[R * 1.03, 0.05, 6, 40]} /><meshStandardMaterial color="#2a2522" metalness={0.6} roughness={0.5} /></mesh>
      {[-0.6, 0.6].map((x) => <mesh key={x} position={[x, R * 0.95, -0.05]}><torusGeometry args={[0.1, 0.03, 6, 12]} /><meshStandardMaterial color="#2a2522" metalness={0.6} roughness={0.5} /></mesh>)}
    </group>
  );
}

/** Everything that stays at the end of the hall: the gallows frame with its rail, the plank backboard, straw, torches,
 * the chalk line and a rack with the five axes. */
function Range() {
  const flames = useMemo<FlameSpot[]>(() => [[-4.4, 5.9, TZ + 0.6, 0.85], [4.4, 5.9, TZ + 0.6, 0.85]], []);
  const wood = useMemo(() => new THREE.MeshStandardMaterial({ color: '#5a3c26', roughness: 0.85 }), []);
  const plank = useMemo(() => new THREE.MeshStandardMaterial({ color: '#6e4f33', roughness: 0.9 }), []);
  const straw = useMemo(() => new THREE.MeshStandardMaterial({ color: '#c9a65a', roughness: 1 }), []);
  return (
    <group>
      {/* Backboard: vertical planks behind the target, a little proud of each other. */}
      {Array.from({ length: 11 }, (_, i) => (
        <mesh key={i} material={plank} position={[-3.75 + i * 0.75, 2.85, TZ - 0.6 - (i % 2) * 0.05]} castShadow receiveShadow>
          <boxGeometry args={[0.72, 5.1, 0.18]} />
        </mesh>
      ))}
      {/* Gallows frame: two posts, a beam with the rail the target hangs from. */}
      {[-4, 4].map((x) => <mesh key={x} material={wood} position={[x, 3.4, TZ - 0.2]} castShadow><boxGeometry args={[0.42, 6.8, 0.42]} /></mesh>)}
      <mesh material={wood} position={[0, 6.6, TZ - 0.2]} castShadow><boxGeometry args={[8.8, 0.42, 0.5]} /></mesh>
      <mesh position={[0, 6.3, TZ]} castShadow><boxGeometry args={[7.6, 0.08, 0.08]} /><meshStandardMaterial color="#2a2522" metalness={0.6} roughness={0.5} /></mesh>
      {[-1, 1].map((s) => <mesh key={s} material={wood} position={[s * 4, 5.9, TZ + 0.5]} rotation-x={-0.5} castShadow><cylinderGeometry args={[0.12, 0.09, 1.1, 6]} /></mesh>)}
      <Flames spots={flames} />
      <FireLight position={[0, 6.2, TZ + 4.5]} color="#ffae63" intensity={70} distance={20} />
      {/* Straw bales stacked at the foot of the board to catch dropped axes. */}
      {[[-2.4, 0, 0], [0, 0, 0.1], [2.4, 0, -0.05]].map(([x, y, r], i) => (
        <mesh key={i} material={straw} position={[x, y + 0.42, TZ - 0.1]} rotation-y={r} castShadow receiveShadow><boxGeometry args={[2.3, 0.84, 1.1]} /></mesh>
      ))}
      {/* The chalk line. */}
      <mesh position={[0, 0.06, LINE]} rotation-x={-Math.PI / 2}><planeGeometry args={[4.4, 0.16]} /><meshStandardMaterial color="#efe9da" roughness={1} /></mesh>
      {/* The rack beside the line. */}
      <group position={[-3.4, 0, LINE + 0.4]}>
        {[-0.7, 0.7].map((x) => <mesh key={x} material={wood} position={[x, 0.75, 0]} castShadow><boxGeometry args={[0.16, 1.5, 0.5]} /></mesh>)}
        <mesh material={wood} position={[0, 1.42, 0]} castShadow><boxGeometry args={[1.7, 0.14, 0.5]} /></mesh>
      </group>
    </group>
  );
}

/** Axes waiting on the rack (how many are left this round). */
function Rack({ left }: { left: number }) {
  return (
    <group position={[-3.4, 1.5, LINE + 0.4]}>
      {Array.from({ length: left }, (_, i) => (
        <group key={i} position={[-0.56 + i * 0.28, 0.05, 0]} rotation={[0, Math.PI / 2, Math.PI]}><Axe /></group>
      ))}
    </group>
  );
}

function Station() {
  const playing = usePlay().game && session.phase === 'play';
  return (
    <group>
      <Range />
      {!playing && <Target />}
      {!playing && <Rack left={AXES} />}
    </group>
  );
}

// ---- The round.
type Phase = 'aim' | 'power' | 'flight' | 'after' | 'done';
const ui = gameUi({ axe: 1, score: 0, phase: 'power' as Phase, power: 0, line: 'Swing first: stop the needle in the gold.', last: '', hits: [] as number[] });

/** What became of each axe once it landed. */
interface Landed { kind: 'target' | 'board' | 'straw'; local: THREE.Vector3; at: number; tilt: number }
interface Flying { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; spin: number; bounce: boolean; obj: THREE.Group }

const CHIPS = 46;
function thunk(loud = 1) { burst(120, 1.3, 0.55 * loud, 0.18); burst(800, 2.2, 0.14 * loud, 0.07); burst(2800, 5, 0.05 * loud, 0.05, 0.008); }
function clang() { burst(2400, 25, 0.14, 0.45); burst(3700, 30, 0.08, 0.35, 0.01); burst(300, 2, 0.15, 0.1); burst(160, 1.5, 0.2, 0.12, 0.42); }
function whoosh(dur: number) { for (let i = 0; i < 5; i++) burst(500 + ((i * 7) % 5) * 260, 1.1, 0.06, 0.09, (dur / 5) * i); }
function cheer(big: boolean) {
  const n = big ? 6 : 3;
  for (let i = 0; i < n; i++) setTimeout(() => voice(i % 3 === 1 ? 'woman' : i % 3 === 2 ? 'soldier' : 'man', big ? 22 : 12, (i / n) * 1.6 - 0.8, true), i * 80);
  for (let i = 0; i < (big ? 34 : 10); i++) burst(1600 + Math.random() * 2600, 3, 0.035, 0.035, 0.15 + Math.random() * (big ? 1.4 : 0.6)); // table slaps and claps
  if (big) for (let i = 0; i < 6; i++) burst(95, 1.2, 0.3, 0.1, 0.25 + i * 0.22); // fists on the boards
}
function groan() { voice('man', 14, -0.5, false); setTimeout(() => voice('soldier', 10, 0.5, false), 120); }

function Play({ room, end }: { room: Room; end: (r: Result) => void }) {
  const camera = useThree((s) => s.camera);
  const target = useRef<THREE.Group | null>(null);
  const reticle = useRef<THREE.Group>(null);
  const held = useRef<THREE.Group | null>(null);
  const axes = useRef<(THREE.Group | null)[]>([]);
  const racked = useRef<(THREE.Group | null)[]>([]);
  const chips = useRef<THREE.Points>(null);
  const flash = useRef<THREE.PointLight>(null);
  const chip = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CHIPS * 3), 3));
    return { g, v: Array.from({ length: CHIPS }, () => new THREE.Vector3()), p: Array.from({ length: CHIPS }, () => new THREE.Vector3()), t: 9 };
  }, []);
  const st = useRef({
    phase: 'power' as Phase, t: 0, aimT: 0, clock: 0, axe: 0, score: 0, aim: new THREE.Vector3(0, TY, TZ + 0.3), power: 0,
    fly: undefined as Flying | undefined, landed: [] as (Landed | undefined)[], slow: 0, trauma: 0, push: 0, tx: 0, hits: [] as number[], hold: 0,
  });
  useMemo(() => { ui.reset(); ui.set({ hits: [] }); }, []);
  if (import.meta.env.DEV) Object.assign(window, { __axes: st.current });
  const camPos = useMemo(() => new THREE.Vector3(), []), look = useMemo(() => new THREE.Vector3(), []), tmp = useMemo(() => new THREE.Vector3(), []);
  const ox = room.x, oz = room.z;

  /** Where the boar's centre is (x), at a clock time, for this throw: still for two axes, then running on its rail. */
  const targetX = (clock: number, axe: number) => (axe < 2 ? 0 : axe < 4 ? Math.sin(clock * 1.25) * 1.7 : Math.sin(clock * 1.9) * 2.3);

  /** Put a landed axe where it belongs: riding the target, stuck in the boards, or lying in the straw. */
  const place = (a: THREE.Group, l: Landed, now: number) => {
    const q = Math.exp(-(now - l.at) * 5) * Math.sin((now - l.at) * 38) * 0.14; // the handle quivers, then settles
    if (l.kind === 'target') { a.position.set(st.current.tx + l.local.x, TY + l.local.y, TZ + 0.44); a.rotation.set(-0.42 + q, 0, l.tilt); }
    else if (l.kind === 'board') { a.position.set(l.local.x, l.local.y, TZ - 0.32); a.rotation.set(-0.5 + q, 0, l.tilt); }
    else { a.position.copy(l.local); a.rotation.set(Math.PI / 2 - 0.15, 0, l.tilt); }
  };

  useFrame(({ clock: c }, rawDt) => {
    const s = st.current;
    rawDt = Math.min(rawDt, 0.05);
    const dt = rawDt * (s.slow > 0 ? 0.25 : 1);
    s.slow = Math.max(0, s.slow - rawDt);
    s.t += dt; s.clock += dt;
    const ks = gameKeys();
    const pressed = ks.some((k) => k === ' ' || k === 'e' || k === 'enter');
    s.tx = targetX(s.clock, s.axe);
    if (target.current) target.current.position.x = s.tx;
    if (s.phase === 'power') {
      // First the swing: the needle sweeps up and down (quicker each throw); stop it in the gold.
      s.power = 0.5 - 0.5 * Math.cos(s.t * (2.6 + s.axe * 0.3));
      ui.set({ power: s.power });
      if (pressed) {
        s.phase = 'aim'; s.t = 0; s.aimT = Math.random() * 6;
        const good = s.power >= SWEET[0] && s.power <= SWEET[1];
        burst(good ? 1500 : 700, 9, 0.07, 0.08);
        ui.set({ phase: 'aim', line: good ? (s.axe < 2 ? 'Good swing. Now throw when the mark is on the boar.' : 'Good swing. Throw just before the boar runs under the mark.') : s.power < SWEET[0] ? 'Soft swing: it will drop low. Throw a touch high.' : 'Hard swing: it will fly high. Throw a touch low.' });
      }
    } else if (s.phase === 'aim') {
      // Then the mark: it drifts over the boar in a slow figure-of-eight (a smaller one once the boar runs, so the
      // boar does the moving and you lead it). Space throws, at once.
      s.aimT += dt;
      const sp = 1 + s.axe * 0.12, still = s.axe < 2;
      s.aim.set(Math.sin(s.aimT * (still ? 1.5 : 0.9) * sp) * (still ? 1.6 : 0.35), TY + Math.sin(s.aimT * (still ? 1.0 : 0.7) * sp + 1.3) * (still ? 1.05 : 0.3), TZ + 0.3);
      if (pressed) {
        const e = s.power - (SWEET[0] + SWEET[1]) / 2;
        const bounce = Math.abs(e) > 0.27;
        const dur = 0.5;
        // Soft drops low, hard flies high, plus a little shake of the hand.
        const to = s.aim.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.12, e * 2.7 + (Math.random() - 0.5) * 0.08, 0));
        const obj = axes.current[s.axe]!;
        obj.visible = true;
        const r = racked.current[s.axe]; if (r) r.visible = false;
        s.fly = { from: new THREE.Vector3(2.3, 4.6, LINE - 0.2), to, t: 0, dur, spin: Math.PI * 2 * (bounce ? 1.5 : 1), bounce, obj };
        s.phase = 'flight'; s.t = 0; s.push = 1;
        whoosh(dur); burst(200, 2, 0.14, 0.08);
        ui.set({ phase: 'flight', line: '' });
      }
    } else if (s.phase === 'flight') {
      const f = s.fly!;
      f.t += dt;
      const u = Math.min(1, f.t / f.dur);
      tmp.lerpVectors(f.from, f.to, u); tmp.y += Math.sin(u * Math.PI) * 0.6;
      f.obj.position.copy(tmp);
      f.obj.rotation.set(-0.42 + f.spin * (1 - u), 0, 0);
      if (u >= 1) {
        const lx = f.to.x - s.tx, ly = f.to.y - TY, r = Math.hypot(lx, ly);
        const onFace = r <= R * 0.97;
        const points = f.bounce || !onFace ? 0 : RINGS.find(([rr]) => r <= rr)![1];
        s.score += points; s.hits.push(points);
        let line = '';
        const now = c.elapsedTime;
        if (f.bounce) {
          clang(); s.trauma = 0.3; groan();
          line = s.power < SWEET[0] ? 'Too soft. Handle first, and it bounces off.' : 'Too hard. Over-spun, it clatters away.';
          s.landed[s.axe] = { kind: 'straw', local: new THREE.Vector3(f.to.x * 0.6 + (Math.random() - 0.5), 0.95 + Math.random() * 0.6, TZ + 0.9), at: now, tilt: Math.random() * 2 };
        } else if (!onFace) {
          thunk(0.7); s.trauma = 0.3; groan();
          line = 'Into the boards. Wide of the boar.';
          s.landed[s.axe] = { kind: 'board', local: f.to.clone(), at: now, tilt: (Math.random() - 0.5) * 0.8 };
        } else {
          thunk(1 + points / 8); s.trauma = 0.35 + points / 16;
          if (points === 10) { s.slow = 0.7; line = 'Through the boar’s eye! Ten!'; cheer(true); }
          else if (points === 5) { line = 'In the red. Five.'; cheer(false); }
          else line = 'Two. It sticks, at least.';
          s.landed[s.axe] = { kind: 'target', local: new THREE.Vector3(lx, ly, 0), at: now, tilt: (lx > 0 ? 1 : -1) * (0.35 + Math.random() * 0.35) };
        }
        if (!f.bounce) {
          chip.t = 0;
          for (let i = 0; i < CHIPS; i++) { chip.p[i].set(f.to.x, f.to.y, onFace ? TZ + 0.3 : TZ - 0.4); chip.v[i].set((Math.random() - 0.5) * 5, Math.random() * 4 + 1, Math.random() * 4 + 1.5); }
          if (flash.current) { flash.current.position.set(f.to.x, f.to.y, TZ + 1.4); flash.current.intensity = 80 + points * 22; }
        }
        s.phase = 'after'; s.t = 0;
        ui.set({ phase: 'after', score: s.score, line, last: points ? `+${points}` : '0', hits: [...s.hits] });
      }
    } else if (s.phase === 'after') {
      const f = s.fly!;
      const l = s.landed[s.axe]!;
      if (f.bounce && s.t < 0.9) {
        // Tumbles back off the face and drops into the straw.
        const k = s.t / 0.9;
        f.obj.position.set(THREE.MathUtils.lerp(f.to.x, l.local.x, k), Math.max(l.local.y, f.to.y + s.t * 2.6 - 7 * s.t * s.t), THREE.MathUtils.lerp(TZ + 0.5, l.local.z, k) + Math.sin(k * Math.PI) * 1.5);
        f.obj.rotation.x += dt * 14 * (1 - k);
      }
      if (s.t > 1.45) {
        s.axe++;
        if (s.axe >= AXES) {
          s.phase = 'done'; s.t = 0;
          const won = s.score >= TO_WIN;
          ui.set({ phase: 'done', line: won ? 'The hall bangs its cups for you.' : 'Not enough. The boar lives to mock you.' });
          if (won) cheer(true); else groan();
        } else {
          s.phase = 'power'; s.t = 0;
          ui.set({ phase: 'power', power: 0, axe: s.axe + 1, last: '', line: s.axe === 2 ? 'They’ve set the boar running! Swing, then lead it.' : s.axe === 4 ? 'Last axe. The boar runs faster now.' : `${Math.max(0, TO_WIN - s.score)} more to win. Swing.` });
        }
      }
    } else if (s.phase === 'done') {
      if (s.t > 1.6) {
        s.t = -1e9;
        const won = s.score >= TO_WIN;
        end({ won, score: s.score, grade: (s.score - TO_WIN) / (50 - TO_WIN), line: `${s.score} points from five axes (${s.hits.join(' · ')}). ${won ? (s.score >= 40 ? 'They’ll carve your name in the beam.' : 'Corrin pours you a horn of ale.') : `You needed ${TO_WIN}.`}` });
      }
    }
    // Landed axes stay where they fell (the stuck ones ride the running boar).
    for (let i = 0; i < AXES; i++) {
      const a = axes.current[i], l = s.landed[i];
      if (!a || !l) continue;
      if (i === s.axe && s.phase === 'after' && s.fly?.bounce && s.t < 0.9) continue;
      place(a, l, c.elapsedTime);
    }
    // The reticle: a ring of light on the target's plane; it pulses once locked.
    if (reticle.current) {
      reticle.current.visible = s.phase === 'aim';
      reticle.current.position.copy(s.aim);
      reticle.current.scale.setScalar(s.phase === 'aim' ? 1 + Math.sin(c.elapsedTime * 10) * 0.05 : 0.8);
    }
    // The axe in your hand, drawn back over the shoulder with the needle.
    const h = held.current;
    if (h) {
      h.visible = s.phase === 'aim' || s.phase === 'power';
      const w = s.power;
      const bob = Math.sin(c.elapsedTime * 2) * 0.02;
      h.position.set(2.45, 3.75 + w * 0.35 + bob, LINE - 0.6 + w * 0.5);
      h.rotation.set(0.25 + w * 1.1, 0.25, -0.25);
    }
    // Chips.
    chip.t += dt;
    const pos = chip.g.attributes.position as THREE.BufferAttribute;
    if (chip.t < 1.6) {
      for (let i = 0; i < CHIPS; i++) {
        const p = chip.p[i], v = chip.v[i];
        v.y -= 12 * dt; p.addScaledVector(v, dt);
        if (p.y < 0.05) { p.y = 0.05; v.set(0, 0, 0); }
        pos.setXYZ(i, p.x, p.y, p.z);
      }
      pos.needsUpdate = true;
    }
    if (chips.current) chips.current.visible = chip.t < 1.6;
    if (flash.current) flash.current.intensity *= Math.exp(-rawDt * 7);
    // Camera: behind your right shoulder at the line; it leans in with the throw, rides in on a ten, jolts on the bite.
    s.push = Math.max(0, s.push - rawDt * 1.3);
    const bull = s.slow > 0;
    if (bull) camPos.set(ox + s.tx * 0.5 + 0.6, TY + 0.6, oz + TZ + 6.5);
    else camPos.set(ox + 1.6, 4.3 - s.push * 0.3, oz + LINE + 3.4 - s.push * 1.6);
    const lookX = s.phase === 'aim' || s.phase === 'power' ? s.aim.x * 0.3 : s.fly ? s.fly.to.x * 0.5 : 0;
    look.set(ox + (bull ? s.tx : lookX), TY + (bull ? 0 : 0.2), oz + TZ);
    camera.position.lerp(camPos, 1 - Math.exp(-rawDt * (bull ? 5 : 4)));
    camera.lookAt(look);
    const pc = camera as THREE.PerspectiveCamera;
    const fov = bull ? 30 : 34;
    if (Math.abs(pc.fov - fov) > 0.05) { pc.fov += (fov - pc.fov) * (1 - Math.exp(-rawDt * 5)); pc.updateProjectionMatrix(); }
    s.trauma = Math.max(0, s.trauma - rawDt * 1.6);
    if (s.trauma > 0) { const t2 = s.trauma * s.trauma, tt = c.elapsedTime * 31; camera.rotateX(Math.sin(tt) * t2 * 0.035); camera.rotateZ(Math.sin(tt * 1.7 + 2) * t2 * 0.035); camera.rotateY(Math.sin(tt * 1.3 + 4) * t2 * 0.02); }
  });

  return (
    <group>
      <Target refs={(g) => { target.current = g; }} />
      <group position={[-3.4, 1.5, LINE + 0.4]}>
        {Array.from({ length: AXES }, (_, i) => (
          <group key={i} ref={(g) => { racked.current[i] = g; }} position={[-0.56 + i * 0.28, 0.05, 0]} rotation={[0, Math.PI / 2, Math.PI]}><Axe /></group>
        ))}
      </group>
      {Array.from({ length: AXES }, (_, i) => <group key={i} ref={(g) => { axes.current[i] = g; if (g && !g.userData.init) { g.userData.init = true; g.visible = false; } }}><Axe /></group>)}
      <group ref={(g) => { held.current = g; }}><Axe /></group>
      <group ref={reticle}>
        <mesh renderOrder={5}><ringGeometry args={[0.2, 0.27, 40]} /><meshBasicMaterial color="#ffe28a" transparent opacity={0.95} toneMapped={false} depthTest={false} /></mesh>
        <mesh renderOrder={5}><circleGeometry args={[0.05, 16]} /><meshBasicMaterial color="#ffe28a" toneMapped={false} transparent depthTest={false} /></mesh>
        {[0, 1, 2, 3].map((i) => <mesh key={i} renderOrder={5} rotation-z={(i * Math.PI) / 2} position={[Math.cos((i * Math.PI) / 2) * 0.42, Math.sin((i * Math.PI) / 2) * 0.42, 0]}><planeGeometry args={[0.18, 0.04]} /><meshBasicMaterial color="#ffe28a" toneMapped={false} transparent depthTest={false} /></mesh>)}
      </group>
      <points ref={chips} geometry={chip.g} frustumCulled={false}><pointsMaterial color="#e0b880" size={0.1} sizeAttenuation /></points>
      <pointLight ref={flash} color="#ffd27a" intensity={0} distance={10} decay={1.6} />
    </group>
  );
}

function Hud() {
  const s = ui.use();
  const sweet = { bottom: `${SWEET[0] * 100}%`, height: `${(SWEET[1] - SWEET[0]) * 100}%` };
  return (
    <>
      <div className="game-hud">
        <div className="pips">{Array.from({ length: AXES }, (_, i) => <i key={i} className={i < s.hits.length ? (s.hits[i] > 0 ? 'on' : '') : i === s.axe - 1 ? 'now' : ''} />)}</div>
        <div className="big">{s.score}<small className="axe-of"> / {TO_WIN} to win</small></div>
        {s.line && <div className="line">{s.line}</div>}
        {s.phase === 'power' && <div className="hint"><kbd>Space</kbd> stop the needle in the gold</div>}
        {s.phase === 'aim' && <div className="hint"><kbd>Space</kbd> throw</div>}
      </div>
      {s.last && <div key={s.hits.length} className={`axe-pop ${s.last === '+10' ? 'gold' : s.last === '0' || s.last === '+0' ? 'nil' : ''}`}>{s.last === '+0' ? '0' : s.last}</div>}
      {(s.phase === 'power' || s.phase === 'aim') && (
        <div className={`axe-meter ${s.phase === 'aim' ? 'set' : ''}`}>
          <div className="sweet" style={sweet} />
          <div className="needle" style={{ bottom: `${s.power * 100}%` }} />
          <small>power</small>
        </div>
      )}
    </>
  );
}

register({
  id: 'axes', name: 'Axe Throw',
  pitch: 'Five axes at the boar. First stop the swing needle in the gold (soft drops low, hard flies high, way off bounces), then throw when the drifting mark is on the boar. From the third axe the boar runs on its rail: lead it. 25 points wins.',
  keys: [['Space', 'stop the swing, then throw'], ['Esc', 'leave']],
  entry: 400,
  Station, Play, Hud,
  view: () => ({ pos: [4.5, 5.2, LINE + 7], look: [0, TY, TZ] }),
});
