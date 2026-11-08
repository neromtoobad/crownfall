// House Velmont's game, in the wine cellar under Vinehold: the Vintner's Cups. A gold ram coin goes under one of three
// cups; the vintner shuffles; you pick. Each round he shuffles more and faster, and from the fourth he starts
// feinting (cups that cross and come back). Clear three rounds to win; five is a perfect night.
// The reference hall game: Station (always in the hall) + Play (the round) + Hud, all in the hall's local frame.
import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { burst } from '../realm/sound.ts';
import { voice } from '../realm/sound.ts';
import { FireLight, Flames } from '../realm/fire.tsx';
import type { Room } from '../realm/rooms.ts';
import { keys, usePlay } from '../realm/play.ts';
import { gameKeys, gameUi, register, session, type Result } from './host.ts';

const TABLE: [number, number] = [0, -10]; // the station, matches rooms.ts
const TOP = 2.05;                          // table height (units)
const SPACING = 1.55;
const ROUNDS = 5, TO_WIN = 3;

// ---- Shared bits: the cup's shape, the coin, the table.
const cupGeo = (() => {
  // An upturned drinking cup: wide rim on the table, narrowing to a domed foot on top.
  const pts = [[0.0, 1.12], [0.16, 1.12], [0.22, 1.06], [0.2, 0.98], [0.26, 0.9], [0.38, 0.78], [0.45, 0.45], [0.5, 0.08], [0.56, 0.02], [0.56, 0], [0.5, 0]].reverse().map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 40);
  g.computeVertexNormals();
  return g;
})();
const coinGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.05, 32);
const cupMat = new THREE.MeshStandardMaterial({ color: '#c9a24a', metalness: 0.85, roughness: 0.28 });
const pick = new THREE.MeshStandardMaterial({ color: '#ffd76a', metalness: 0.8, roughness: 0.25, emissive: new THREE.Color('#5a3c00'), emissiveIntensity: 0.6 });
const coinMat = new THREE.MeshStandardMaterial({ color: '#f2c94c', metalness: 0.9, roughness: 0.2, emissive: new THREE.Color('#7a5200'), emissiveIntensity: 0.4 });

function Table() {
  const [x, z] = TABLE;
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, TOP - 0.08, 0]} castShadow receiveShadow><cylinderGeometry args={[2.9, 2.9, 0.16, 36]} /><meshStandardMaterial color="#5b3a24" roughness={0.7} /></mesh>
      <mesh position={[0, TOP - 0.005, 0]} receiveShadow><cylinderGeometry args={[2.5, 2.5, 0.02, 36]} /><meshStandardMaterial color="#2e1226" roughness={0.95} /></mesh>
      <mesh position={[0, (TOP - 0.16) / 2, 0]} castShadow><cylinderGeometry args={[0.35, 0.7, TOP - 0.16, 12]} /><meshStandardMaterial color="#3e2718" roughness={0.8} /></mesh>
      {/* A cask either side, and the vintner's jug. */}
      <mesh position={[1.9, TOP + 0.35, -1.1]} castShadow><cylinderGeometry args={[0.18, 0.26, 0.7, 14]} /><meshStandardMaterial color="#7a3b2a" roughness={0.6} /></mesh>
    </group>
  );
}

/** The cups at rest on the table when nobody is playing (a round brings its own). */
function Station() {
  const [x, z] = TABLE;
  const playing = usePlay().game && session.phase === 'play';
  const flames = useMemo(() => [[x - 2.2, TOP + 0.5, z - 1.6, 0.22], [x + 2.2, TOP + 0.5, z - 1.6, 0.22]] as [number, number, number, number][], [x, z]);
  return (
    <group>
      <Table />
      <group position={[x, TOP, z]} visible={!playing}>{[-1, 0, 1].map((i) => <mesh key={i} geometry={cupGeo} material={cupMat} position={[i * SPACING, 0, 0]} castShadow />)}</group>
      {[-1, 1].map((s) => <mesh key={s} position={[x + s * 2.2, TOP + 0.25, z - 1.6]}><cylinderGeometry args={[0.07, 0.07, 0.5, 6]} /><meshStandardMaterial color="#efe6cf" /></mesh>)}
      <Flames spots={flames} />
      <FireLight position={[x, TOP + 2.4, z - 1]} color="#ffbe73" intensity={260} distance={22} />
    </group>
  );
}

// ---- The round.
type Phase = 'show' | 'shuffle' | 'choose' | 'lift' | 'between';
interface Swap { a: number; b: number; t0: number; dur: number; feint: boolean }
const ui = gameUi({ round: 1, cleared: 0, phase: 'show' as Phase, line: 'Watch the ram.', sel: 1 });

function plan(round: number, start: number) {
  const n = 3 + round * 2, dur = Math.max(0.2, 0.62 - round * 0.08);
  const out: Swap[] = [];
  let t = start;
  for (let i = 0; i < n; i++) {
    const a = Math.floor(Math.random() * 3); let b = Math.floor(Math.random() * 2); if (b >= a) b++;
    const feint = round >= 4 && Math.random() < 0.28;
    out.push({ a, b, t0: t, dur: feint ? dur * 1.3 : dur, feint });
    t += (feint ? dur * 1.3 : dur) + 0.05;
  }
  return { swaps: out, end: t };
}
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function slide(loud = 1) { burst(700 + Math.random() * 400, 0.8, 0.05 * loud, 0.18, 0, 'bandpass'); }
function clink() { const a = burst; a(3400, 18, 0.06, 0.4); a(5200, 22, 0.03, 0.3, 0.01); }

function Play({ room, end }: { room: Room; end: (r: Result) => void }) {
  const camera = useThree((s) => s.camera);
  const cups = useRef<(THREE.Mesh | null)[]>([]);
  const coin = useRef<THREE.Mesh>(null);
  // slot[i] = which table position cup i sits in; the coin is under cup `ram`.
  const st = useRef({ slot: [0, 1, 2], ram: 1, round: 1, cleared: 0, phase: 'show' as Phase, t: 0, swaps: [] as Swap[], swapEnd: 0, lifted: -1, liftT: 0, sel: 1, shake: 0 });
  useMemo(() => { ui.reset(); }, []);
  const camPos = useMemo(() => new THREE.Vector3(), []), camLook = useMemo(() => new THREE.Vector3(), []);
  const slotX = (s: number) => (s - 1) * SPACING;

  useFrame(({ clock }, dt) => {
    const s = st.current;
    s.t += dt;
    const ks = gameKeys();
    // ---- Input in the choosing phase: A/D or arrows to move, 1-3 to jump, E/Space/Enter to lift.
    if (s.phase === 'choose') {
      for (const k of ks) {
        if (k === 'a' || k === 'arrowleft') { s.sel = Math.max(0, s.sel - 1); slide(0.4); }
        if (k === 'd' || k === 'arrowright') { s.sel = Math.min(2, s.sel + 1); slide(0.4); }
        if (k === '1' || k === '2' || k === '3') s.sel = Number(k) - 1;
        if (k === 'e' || k === ' ' || k === 'enter') { s.lifted = s.slot.indexOf(s.sel); s.phase = 'lift'; s.liftT = 0; clink(); }
      }
      if (ui.state.sel !== s.sel) ui.set({ sel: s.sel });
    }
    // ---- Phases.
    if (s.phase === 'show') {
      // The coin goes under the middle cup: the cup lifts, the coin glints, the cup comes down.
      const k = s.t;
      s.lifted = s.ram;
      s.liftT = k < 0.6 ? k / 0.6 : k < 1.6 ? 1 : Math.max(0, 1 - (k - 1.6) / 0.4);
      if (k > 2.1) {
        s.lifted = -1; s.phase = 'shuffle'; s.t = 0;
        const p = plan(s.round, 0.25); s.swaps = p.swaps; s.swapEnd = p.end;
        ui.set({ phase: 'shuffle', line: s.round >= 4 ? 'Faster now. And he cheats.' : 'He shuffles…' });
        voice('man', 18, 0.2, false);
      }
    } else if (s.phase === 'shuffle') {
      for (const w of s.swaps) if (!w.feint && s.t >= w.t0 + w.dur && (w as Swap & { done?: boolean }).done !== true) {
        (w as Swap & { done?: boolean }).done = true;
        const ca = s.slot.indexOf(w.a), cb = s.slot.indexOf(w.b);
        s.slot[ca] = w.b; s.slot[cb] = w.a;
      }
      for (const w of s.swaps) if (Math.abs(s.t - w.t0) < dt) slide(1);
      if (s.t > s.swapEnd + 0.3) { s.phase = 'choose'; s.sel = 1; ui.set({ phase: 'choose', line: 'Where is the ram?', sel: 1 }); }
    } else if (s.phase === 'lift') {
      s.liftT = Math.min(1, s.liftT + dt * 2.4);
      if (s.liftT >= 1 && s.t > 0) {
        const right = s.lifted === s.ram;
        s.phase = 'between'; s.t = 0;
        if (right) {
          s.cleared++; s.shake = 0.4;
          burst(1800, 3, 0.05, 0.5); voice('woman', 12, -0.4, true);
          ui.set({ phase: 'between', cleared: s.cleared, line: s.cleared >= ROUNDS ? 'Five for five. The cellar roars.' : ['Sharp eyes!', 'Again! He’s sweating.', 'The cellar is watching you now.', 'One more and they’ll sing of it.'][s.cleared - 1] });
        } else {
          voice('man', 10, 0.3, true);
          ui.set({ phase: 'between', line: 'Empty. The ram was elsewhere.' });
        }
      }
    } else if (s.phase === 'between') {
      // Show where the ram was (lift its cup too), then go on or finish.
      if (s.lifted !== s.ram && s.t > 0.5) { s.lifted = s.ram; s.liftT = 1; }
      if (s.t > 1.8) {
        const right = s.cleared >= s.round;
        if (!right || s.cleared >= ROUNDS) {
          const won = s.cleared >= TO_WIN;
          end({ won, score: s.cleared, grade: (s.cleared - TO_WIN + 1) / (ROUNDS - TO_WIN + 1), line: `${s.cleared} of ${ROUNDS} rounds. ${won ? s.cleared === ROUNDS ? 'A perfect night in the cellar.' : 'Enough to take the purse.' : `You needed ${TO_WIN}.`}` });
          s.phase = 'between'; s.t = -1e9;
          return;
        }
        s.round++; s.lifted = -1; s.liftT = 0; s.phase = 'show'; s.t = 0.6; // skip the first lift: the coin stays where it is
        s.lifted = s.ram; s.liftT = 1; s.t = 1.6;
        ui.set({ round: s.round, phase: 'show', line: `Round ${s.round}.` });
      }
    }
    // ---- Where every cup is this frame.
    for (let i = 0; i < 3; i++) {
      const m = cups.current[i]; if (!m) continue;
      let x = slotX(s.slot[i]), z = 0;
      if (s.phase === 'shuffle') for (const w of s.swaps) {
        if (s.t < w.t0 || s.t > w.t0 + w.dur || (w.a !== i && w.b !== i)) continue;
        const u = ease((s.t - w.t0) / w.dur), from = s.slot[i], to = w.a === i ? w.b : w.a;
        // Feints go halfway and come back; real swaps arc past each other, one in front, one behind.
        const k = w.feint ? Math.sin(u * Math.PI) * 0.5 : u;
        x = slotX(from) + (slotX(to) - slotX(from)) * k;
        z = Math.sin((w.feint ? u : k) * Math.PI) * (w.a === i ? 0.7 : -0.7);
      }
      const lift = s.lifted === i ? Math.sin(Math.min(1, s.liftT) * Math.PI / 2) * 1.25 : 0;
      m.position.set(TABLE[0] + x, TOP + lift, TABLE[1] + z);
      m.rotation.z = s.lifted === i ? -0.35 * Math.min(1, s.liftT) : 0;
      m.material = s.phase === 'choose' && s.slot[i] === s.sel ? pick : cupMat;
    }
    // The coin rides under its cup (hidden while cups move, so you can't cheat by peeking under a raised rim).
    const cm = coin.current!;
    const under = cups.current[s.ram]!;
    cm.position.set(under.position.x, TOP + 0.03, under.position.z);
    cm.rotation.y += dt * 2;
    cm.visible = s.lifted === s.ram && s.liftT > 0.2;
    // ---- The camera: over the table, a little lower and closer while he shuffles; a jolt on a win.
    const tight = s.phase === 'shuffle' ? 1 : 0;
    camPos.set(room.x + TABLE[0], TOP + 4.6 - tight * 0.6, room.z + TABLE[1] + 5.4 - tight * 0.8);
    camLook.set(room.x + TABLE[0], TOP + 0.3, room.z + TABLE[1] - 0.3);
    camera.position.lerp(camPos, 1 - Math.exp(-dt * 4));
    camera.lookAt(camLook);
    s.shake = Math.max(0, s.shake - dt);
    if (s.shake > 0) camera.rotateZ(Math.sin(clock.elapsedTime * 50) * s.shake * 0.02);
    void keys;
  });

  return (
    <group>
      {[0, 1, 2].map((i) => <mesh key={i} ref={(m) => { cups.current[i] = m; }} geometry={cupGeo} material={cupMat} castShadow />)}
      <mesh ref={coin} geometry={coinGeo} material={coinMat} castShadow />
    </group>
  );
}

function Hud() {
  const s = ui.use();
  return (
    <div className="game-hud">
      <div className="pips">{Array.from({ length: ROUNDS }, (_, i) => <i key={i} className={i < s.cleared ? 'on' : i === s.round - 1 ? 'now' : ''} />)}</div>
      <div className="line">{s.line}</div>
      {s.phase === 'choose' && <div className="hint"><kbd>A</kbd><kbd>D</kbd> pick a cup · <kbd>E</kbd> lift it</div>}
    </div>
  );
}

register({
  id: 'cups', name: 'The Vintner’s Cups',
  pitch: 'A gold ram goes under one of three cups. The vintner shuffles, faster every round, and from the fourth he feints. Clear three rounds to win.',
  keys: [['A D', 'choose a cup'], ['E', 'lift it'], ['Esc', 'leave']],
  entry: 400,
  Station, Play, Hud,
  view: () => ({ pos: [TABLE[0], TOP + 5.2, TABLE[1] + 7.5], look: [TABLE[0], TOP, TABLE[1]] }),
});
