// House Velmont's game, in the wine cellar under Vinehold: the Vintner's Cups. A gold ram coin goes under one of three
// cups; the vintner shuffles; you pick. Each round he shuffles more and faster, and from the fourth he starts
// feinting (cups that cross and come back). Clear three rounds to win; five is a perfect night.
// The reference hall game: Station (always in the hall) + Play (the round) + Hud, all in the hall's local frame.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { burst, voice } from '../realm/sound.ts';
import { FireLight, Flames } from '../realm/fire.tsx';
import type { Room } from '../realm/rooms.ts';
import { usePlay } from '../realm/play.ts';
import { gameKeys, gameUi, register, session, type Result } from './host.ts';

const TABLE: [number, number] = [0, -10]; // the station, matches rooms.ts
const TOP = 2.05;                          // table height (units)
const SPACING = 1.55;
const ROUNDS = 5, TO_WIN = 3;
// Where the cards look from and at (the hall's frame). The round's camera starts from here and hands back to it.
const VIEW = { pos: [TABLE[0], TOP + 5.2, TABLE[1] + 7.5] as [number, number, number], look: [TABLE[0], TOP, TABLE[1]] as [number, number, number] };

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
// The cup you are pointing at warms toward this colour (each round cup has its own material, so the glow can glide).
const cupCol = new THREE.Color('#c9a24a'), pickCol = new THREE.Color('#ffd76a'), pickGlow = new THREE.Color('#5a3c00');
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
// 'close' is the last half second or so: every cup comes back down before the result card, so the round's cups hand over to
// the station's resting ones without a pop.
type Phase = 'show' | 'shuffle' | 'choose' | 'lift' | 'between' | 'close';
interface Swap { a: number; b: number; t0: number; dur: number; feint: boolean; started: boolean; done: boolean }
const ui = gameUi({ round: 1, cleared: 0, phase: 'show' as Phase, line: 'Watch the ram.', sel: 1 });

function plan(round: number, start: number) {
  const n = 3 + round * 2, dur = Math.max(0.2, 0.62 - round * 0.08);
  const out: Swap[] = [];
  let t = start;
  for (let i = 0; i < n; i++) {
    const a = Math.floor(Math.random() * 3); let b = Math.floor(Math.random() * 2); if (b >= a) b++;
    const feint = round >= 4 && Math.random() < 0.28;
    out.push({ a, b, t0: t, dur: feint ? dur * 1.3 : dur, feint, started: false, done: false });
    t += (feint ? dur * 1.3 : dur) + 0.05;
  }
  return { swaps: out, end: t };
}
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function slide(loud = 1) { burst(700 + Math.random() * 400, 0.8, 0.05 * loud, 0.18, 0, 'bandpass'); }
function clink() { const a = burst; a(3400, 18, 0.06, 0.4); a(5200, 22, 0.03, 0.3, 0.01); }
function setDown() { burst(260 + Math.random() * 60, 1.6, 0.07, 0.07); burst(2600, 6, 0.015, 0.05); }

function Play({ room, end }: { room: Room; end: (r: Result) => void }) {
  const camera = useThree((s) => s.camera);
  const cups = useRef<(THREE.Mesh | null)[]>([]);
  const coin = useRef<THREE.Mesh>(null);
  // slot[i] = which table position cup i sits in; the coin is under cup `ram`.
  // up[i] says whether cup i should be raised; lift[i] (0 on the cloth, 1 raised) springs after it, so cups rise and
  // come down on their own time and two can be in the air at once (your wrong cup and the ram's).
  const st = useRef({
    slot: [0, 1, 2], ram: 1, round: 1, cleared: 0, phase: 'show' as Phase, t: 0, swaps: [] as Swap[], swapEnd: 0,
    up: [false, false, false], lift: [0, 0, 0], liftV: [0, 0, 0], glow: [0, 0, 0],
    chosen: -1, sel: 1, shake: 0, hop: 0, tight: 0, seeded: false, done: false,
  });
  useMemo(() => { ui.reset(); }, []);
  const mats = useMemo(() => [0, 1, 2].map(() => { const m = cupMat.clone(); m.emissive.copy(pickGlow); m.emissiveIntensity = 0; return m; }), []);
  useEffect(() => () => { for (const m of mats) m.dispose(); }, [mats]);
  const camPos = useMemo(() => new THREE.Vector3(), []), camLook = useMemo(() => new THREE.Vector3(), []), look = useMemo(() => new THREE.Vector3(), []);
  const slotX = (s: number) => (s - 1) * SPACING;

  useFrame(({ clock }, raw) => {
    const s = st.current;
    // A tab switch hands back one huge frame: never let it skip a swap or throw a cup through the table.
    const dt = Math.min(raw, 0.05);
    s.t += dt;
    const ks = s.done ? [] : gameKeys();
    // ---- Input in the choosing phase: A/D or arrows to move, 1-3 to jump, E/Space/Enter to lift.
    if (s.phase === 'choose') {
      for (const k of ks) {
        const was = s.sel;
        if (k === 'a' || k === 'arrowleft') s.sel = Math.max(0, s.sel - 1);
        if (k === 'd' || k === 'arrowright') s.sel = Math.min(2, s.sel + 1);
        if (k === '1' || k === '2' || k === '3') s.sel = Number(k) - 1;
        if (s.sel !== was) slide(0.4);
        if (k === 'e' || k === ' ' || k === 'enter') {
          s.chosen = s.slot.indexOf(s.sel); s.up[s.chosen] = true; s.phase = 'lift'; s.t = 0; clink();
          ui.set({ phase: 'lift', sel: s.sel });
          break; // one lift per round: a second key in the same frame must not move the pointer after it
        }
      }
      if (ui.state.sel !== s.sel) ui.set({ sel: s.sel });
    }
    // ---- Phases.
    if (s.phase === 'show') {
      // The coin is under the ram's cup: the cup lifts, the coin glints, the cup comes down. (Later rounds arrive here
      // at 1.6 with the cup already up from the reveal, so it only comes down.)
      for (let i = 0; i < 3; i++) s.up[i] = i === s.ram && s.t < 1.6;
      if (s.t > 2.1) {
        s.phase = 'shuffle'; s.t = 0;
        const p = plan(s.round, 0.25); s.swaps = p.swaps; s.swapEnd = p.end;
        ui.set({ phase: 'shuffle', line: s.round >= 4 ? 'Faster now. And he cheats.' : 'He shuffles. Keep your eye on it.' });
        voice('man', 18, 0.2, false);
      }
    } else if (s.phase === 'shuffle') {
      // Each swap starts once (its sound) and lands once (the cups trade places), in order, whatever the frame rate.
      for (const w of s.swaps) {
        if (!w.started && s.t >= w.t0) { w.started = true; slide(1); }
        if (!w.done && s.t >= w.t0 + w.dur) {
          w.done = true;
          if (!w.feint) { const ca = s.slot.indexOf(w.a), cb = s.slot.indexOf(w.b); s.slot[ca] = w.b; s.slot[cb] = w.a; }
        }
      }
      if (s.t > s.swapEnd + 0.3) { s.phase = 'choose'; s.sel = 1; ui.set({ phase: 'choose', line: 'Where is the ram? Pick a cup and lift it.', sel: 1 }); }
    } else if (s.phase === 'lift') {
      if (s.t > 0.45) {
        const right = s.chosen === s.ram;
        s.phase = 'between'; s.t = 0;
        if (right) {
          s.cleared++; s.shake = 0.4; s.hop = 1;
          burst(1800, 3, 0.05, 0.5); burst(2700, 4, 0.03, 0.4, 0.09); voice('woman', 12, -0.4, true);
          ui.set({ phase: 'between', cleared: s.cleared, line: s.cleared >= ROUNDS ? 'Five for five. The cellar roars.' : ['Sharp eyes!', 'Again! He’s sweating.', 'The cellar is watching you now.', 'One more and they’ll sing of it.'][s.cleared - 1] });
        } else {
          burst(150, 1.4, 0.2, 0.22); voice('man', 10, 0.3, true);
          ui.set({ phase: 'between', line: 'Empty. The ram was elsewhere.' });
        }
      }
    } else if (s.phase === 'between') {
      // On a miss, show where the ram was: its cup rises too, beside your empty one. Then go on or finish.
      if (s.chosen !== s.ram && s.t > 0.5 && !s.up[s.ram]) { s.up[s.ram] = true; clink(); }
      if (s.t > 1.8) {
        const right = s.cleared >= s.round;
        if (!right || s.cleared >= ROUNDS) { s.phase = 'close'; s.t = 0; s.up[0] = s.up[1] = s.up[2] = false; }
        else {
          // The next round starts at the moment the shown cup comes down: the coin stays where it is.
          s.round++; s.chosen = -1; s.phase = 'show'; s.t = 1.6;
          ui.set({ round: s.round, phase: 'show', line: `Round ${s.round}. Watch the ram.` });
        }
      }
    } else if (s.phase === 'close' && s.t > 0.6 && !s.done) {
      s.done = true;
      const won = s.cleared >= TO_WIN;
      end({ won, score: s.cleared, grade: (s.cleared - TO_WIN + 1) / (ROUNDS - TO_WIN + 1), line: `${s.cleared} of ${ROUNDS} rounds. ${won ? s.cleared === ROUNDS ? 'A perfect night in the cellar.' : 'Enough to take the purse.' : `You needed ${TO_WIN}.`}` });
    }
    // ---- Where every cup is this frame.
    const pointing = s.phase === 'choose' || s.phase === 'lift';
    for (let i = 0; i < 3; i++) {
      // The lift: a spring a little short of critical, so a cup tops out with a small overshoot and clacks once on the
      // cloth coming down.
      s.liftV[i] += (((s.up[i] ? 1 : 0) - s.lift[i]) * 90 - s.liftV[i] * 12) * dt;
      s.lift[i] += s.liftV[i] * dt;
      if (s.lift[i] < 0) { if (s.liftV[i] < -0.6) setDown(); s.lift[i] = 0; s.liftV[i] *= -0.35; }
      s.glow[i] += ((pointing && s.slot[i] === s.sel ? 1 : 0) - s.glow[i]) * (1 - Math.exp(-dt * 14));
      const m = cups.current[i]; if (!m) continue;
      let x = slotX(s.slot[i]), z = 0;
      if (s.phase === 'shuffle') for (const w of s.swaps) {
        // Only a swap in flight moves a cup: once it has landed the slots already say where the cup is.
        if (!w.started || w.done || (w.a !== i && w.b !== i)) continue;
        const u = ease(Math.min(1, (s.t - w.t0) / w.dur)), from = s.slot[i], to = w.a === i ? w.b : w.a;
        // Feints go halfway and come back; real swaps arc past each other, one in front, one behind.
        const k = w.feint ? Math.sin(u * Math.PI) * 0.5 : u;
        x = slotX(from) + (slotX(to) - slotX(from)) * k;
        z = Math.sin((w.feint ? u : k) * Math.PI) * (w.a === i ? 0.7 : -0.7);
      }
      // The cup you point at stands a touch taller and warmer. (The coin is hidden until a cup is well clear of the
      // cloth, so this never shows what is under it.)
      const g = s.glow[i];
      m.position.set(TABLE[0] + x, TOP + s.lift[i] * 1.25 + g * 0.05, TABLE[1] + z);
      m.rotation.z = -0.35 * Math.min(1.1, s.lift[i]);
      m.scale.setScalar(1 + g * 0.04);
      mats[i].color.lerpColors(cupCol, pickCol, g);
      mats[i].emissiveIntensity = g * 0.6;
    }
    // The coin rides under its cup, hidden until that cup is clear of the cloth; it hops when you find it.
    const cm = coin.current, under = cups.current[s.ram];
    if (cm && under) {
      s.hop = Math.max(0, s.hop - dt * 2.4);
      cm.position.set(under.position.x, TOP + 0.03 + Math.sin(s.hop * Math.PI) * 0.3, under.position.z);
      cm.rotation.y += dt * (2 + s.hop * 10);
      cm.visible = s.lift[s.ram] > 0.16;
    }
    // ---- The camera: over the table, a little lower and closer while he shuffles, leaning toward the cup you point
    // at; a jolt on a win. Both where it sits and where it looks are eased, and the look starts from wherever the
    // card's camera was looking, so the round never opens (or closes) on a snap.
    s.tight += ((s.phase === 'shuffle' ? 1 : 0) - s.tight) * (1 - Math.exp(-dt * 3));
    camPos.set(room.x + TABLE[0], TOP + 4.6 - s.tight * 0.6, room.z + TABLE[1] + 5.4 - s.tight * 0.8);
    if (s.phase === 'close') camLook.set(room.x + VIEW.look[0], VIEW.look[1], room.z + VIEW.look[2]);
    else camLook.set(room.x + TABLE[0] + (pointing || s.phase === 'between' ? slotX(s.sel) * 0.14 : 0), TOP + 0.3, room.z + TABLE[1] - 0.3);
    if (!s.seeded) { s.seeded = true; camera.getWorldDirection(look).multiplyScalar(camera.position.distanceTo(camLook)).add(camera.position); }
    const k = 1 - Math.exp(-dt * 4);
    camera.position.lerp(camPos, k);
    look.lerp(camLook, k);
    camera.lookAt(look);
    s.shake = Math.max(0, s.shake - dt);
    if (s.shake > 0) camera.rotateZ(Math.sin(clock.elapsedTime * 50) * s.shake * 0.02);
    const pc = camera as THREE.PerspectiveCamera;
    if (Math.abs(pc.fov - 50) > 0.1) { pc.fov += (50 - pc.fov) * k; pc.updateProjectionMatrix(); }
  });

  return (
    <group>
      {[0, 1, 2].map((i) => <mesh key={i} ref={(m) => { cups.current[i] = m; }} geometry={cupGeo} material={mats[i]} position={[TABLE[0] + slotX(i), TOP, TABLE[1]]} castShadow />)}
      <mesh ref={coin} geometry={coinGeo} material={coinMat} visible={false} castShadow />
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
      {(s.phase === 'show' || s.phase === 'shuffle') && <div className="hint">Watch the cup with the ram. You pick when he stops.</div>}
    </div>
  );
}

register({
  id: 'cups', name: 'The Vintner’s Cups',
  pitch: 'A gold ram goes under one of three cups. The vintner shuffles, faster every round, and from the fourth he feints. Clear three rounds to win.',
  keys: [['A D or ← →', 'choose a cup'], ['E or Space', 'lift it'], ['Esc', 'leave']],
  entry: 400,
  Station, Play, Hud,
  view: () => VIEW,
});
