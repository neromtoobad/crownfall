// People of the realm: travellers on the roads, armies on the march, ravens in the sky.
// Characters are rigged GLB models with their own animation clips, cloned per walker.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ground } from './heights.ts';
import { walkY } from './bridges.ts';
import { HOUSES, ROADS, roadCurve, routeBetween, yardOf } from './layout.ts';
import { PERSON_R, beastLists, crowd as solidCrowd, driven } from './collide.ts';
import { me, play } from './play.ts';
import { speakAs } from './barks.ts';

const UP = new THREE.Vector3(0, 1, 0), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion();
/** Folk notice you: within a few strides they turn their head to follow you, sometimes say something as you pass,
 * and comment if you stand there staring. Call after the figure's mixer has posed it this frame. */
export function notice(o: THREE.Object3D, now: number, dt: number) {
  const u = o.userData as { head?: THREE.Bone; headBase?: THREE.Quaternion; look?: number; greeted?: number; near?: number };
  const dx = me.x - o.position.x, dz = me.z - o.position.z, d = Math.hypot(dx, dz);
  const playing = play.mode === 'play' && !play.driving;
  // Head: up to ~60 degrees either way toward you when you are close and in front of them.
  let rel = Math.atan2(dx, dz) - o.rotation.y;
  rel = Math.atan2(Math.sin(rel), Math.cos(rel));
  const want = playing && d < 12 && Math.abs(rel) < 2.1 ? 1 : 0;
  u.look = (u.look ?? 0) + (want - (u.look ?? 0)) * Math.min(1, dt * 4);
  if (u.head && u.look > 0.01) {
    u.head.getWorldQuaternion(qa);
    u.head.parent!.getWorldQuaternion(qb);
    qc.setFromAxisAngle(UP, THREE.MathUtils.clamp(rel, -1.05, 1.05) * u.look);
    u.head.quaternion.copy(qb.invert().multiply(qc.multiply(qa)));
  }
  if (!playing) return;
  // A word as you pass close, once in a long while per person; a remark if you loiter right by them.
  if (d < 7 && now - (u.greeted ?? -999) > 75 && Math.abs(rel) < 1.6) { u.greeted = now; speakAs('greet', o as never); }
  u.near = d < 4.5 && me.speed < 0.3 ? (u.near ?? 0) + dt : 0;
  if (u.near > 5) { u.near = -30; speakAs('stare', o as never); }
}
/** Before the mixer runs: undo last frame's head turn (a clip that doesn't key the head would keep adding to it). */
export function unturn(o: THREE.Object3D) {
  const u = o.userData as { head?: THREE.Bone; headBase?: THREE.Quaternion };
  if (!u.head) return;
  if (u.headBase) u.head.quaternion.copy(u.headBase); else u.headBase = u.head.quaternion.clone();
}
export function rest(o: THREE.Object3D) {
  const u = o.userData as { head?: THREE.Bone; headBase?: THREE.Quaternion };
  if (u.head) (u.headBase ??= new THREE.Quaternion()).copy(u.head.quaternion);
}

/** Put a set of figures into the crowd you can't walk through, while they're on screen. */
export function useSolid(objs: THREE.Object3D[]) {
  useEffect(() => {
    for (const o of objs) solidCrowd.add(o);
    return () => { for (const o of objs) solidCrowd.delete(o); };
  }, [objs]);
}
/** The walk clip of one figure, and the two moments in it where the feet pass each other (where it comes to rest). */
interface Gait { action: THREE.AnimationAction; dur: number; rests: readonly [number, number] }
/** One rigged figure walking along a curve. `t` is the distance travelled, in units. `side` is where across the road
 * it likes to walk (its own right is positive), `lat` where across the road it is now, `v` its pace from 0 to 1. */
interface Walker {
  curve: THREE.Curve<THREE.Vector3>; len: number; t: number; speed: number; dir: 1 | -1; side: number; mixer: THREE.AnimationMixer; obj: THREE.Object3D;
  lat: number; v: number; tx: number; tz: number; wait: number; gait?: Gait;
}

const tmp = new THREE.Vector3(), tan = new THREE.Vector3();
const clampN = THREE.MathUtils.clamp;
// ?follow=N rides the camera behind traveller N (checks, demo recording).
const FOLLOW = Number(new URLSearchParams(location.search).get('follow') ?? NaN);
const camGoal = new THREE.Vector3(), lookGoal = new THREE.Vector3();

function place(w: Walker, offsetBack = 0, lateral = 0) {
  const d = clampN(w.t - offsetBack * w.dir, 0, w.len);
  const u = d / w.len;
  w.curve.getPointAt(u, tmp);
  w.curve.getTangentAt(u, tan).multiplyScalar(w.dir);
  w.tx = tan.x; w.tz = tan.z;
  const nx = -tan.z, nz = tan.x;
  const x = tmp.x + nx * (w.side + lateral), z = tmp.z + nz * (w.side + lateral);
  w.obj.position.set(x, walkY(x, z), z);
  w.obj.rotation.y = Math.atan2(tan.x, tan.z);
}

/** What folk on foot keep clear of: you, and every horse and chariot, standing or driven. Gathered once a frame. */
interface Hazard { x: number; z: number; r: number; you?: boolean }
const hazards: Hazard[] = [];
const you: Hazard = { x: 0, z: 0, r: 0.9, you: true };
let hazardStamp = -1;
function gather(stamp: number) {
  if (stamp === hazardStamp) return hazards;
  hazardStamp = stamp;
  hazards.length = 0;
  if (play.mode === 'play' && !play.driving && !play.racing && !play.game) { you.x = me.x; you.z = me.z; hazards.push(you); }
  for (const list of beastLists()) for (const b of list) hazards.push(b);
  for (const b of driven) hazards.push(b);
  return hazards;
}

/** Where across the road a figure should head, and how fast, given what is in its way. Writes `steered`. */
const steered = { want: 0, go: 1 };
function steer(w: Walker, hz: Hazard[], want: number, reach: number, since: number) {
  let go = 1;
  const px = w.obj.position.x, pz = w.obj.position.z, tx = w.tx, tz = w.tz;
  for (const h of hz) {
    const dx = h.x - px, dz = h.z - pz;
    if (Math.abs(dx) > 14 || Math.abs(dz) > 14) continue;
    const along = dx * tx + dz * tz, across = dz * tx - dx * tz, R = h.r + PERSON_R + 0.45;
    if (along < -R || along > 9) continue;
    // Step round it on the nearer side, if the road is wide enough there.
    const hl = w.lat + across;
    if (Math.abs(hl - want) < R) {
      const a = hl - R, b = hl + R, first = Math.abs(a - want) < Math.abs(b - want) ? a : b, other = first === a ? b : a;
      if (Math.abs(first) <= reach) want = first; else if (Math.abs(other) <= reach) want = other;
    }
    // Still straight ahead: slow, and stop short of it.
    if (along > 0.2 && Math.abs(across) < R - 0.1) go = Math.min(go, clampN((along - R) / 3.5, 0, 1));
    // Bumped by you: stand a moment, unless you came up from behind (then it just keeps walking).
    if (h.you && since < 1.2 && along > -0.4) go = 0;
  }
  steered.want = want; steered.go = go;
}

/** Everyone walking the roads, so a quicker walker can pass a slower one instead of walking through them. */
const roadFolk = new Set<Walker>();
/** Every army on the march, as the places its soldiers stand: road folk step off the road to let a column by. */
const columns = new Map<string, { x: number; z: number }[]>();

/**
 * Walk one figure a frame along its curve: round whatever stands in its way where there is room, slowing to a stop
 * short of it where there isn't, and never into it. One a chariot charged at leaps aside. Returns how fast it really
 * moved (1 = its own pace), which drives its walk clip.
 * 'road' folk walk up and down, turn at the ends, pass slower folk and make way for armies; 'loop' folk go round and
 * round; a 'file' soldier keeps its place in a column, `slot` being how far along the road that place has got to.
 */
function stride(w: Walker, hz: Hazard[], now: number, dt: number, reach: number, mode: 'road' | 'loop' | 'file', slot = 0) {
  const u = w.obj.userData as { bump?: number; dodge?: number };
  const since = now - (u.bump ?? -9);
  const leap = u.dodge && since < 3 ? u.dodge : 0;
  const px = w.obj.position.x, pz = w.obj.position.z;
  // A leap takes it to the edge of the road and no further (off a bridge, say).
  let want = leap ? clampN(w.side + leap, -5, 5) : w.side;
  if (mode === 'road') {
    // An army coming through: off to the side of the road, whichever side is nearer.
    let sum = 0, n = 0;
    for (const col of columns.values()) for (const p of col) {
      const dx = p.x - px, dz = p.z - pz;
      if (Math.abs(dx) > 18 || Math.abs(dz) > 18) continue;
      const along = dx * w.tx + dz * w.tz;
      if (along > -5 && along < 16) { sum += w.lat + dz * w.tx - dx * w.tz; n++; }
    }
    if (n) { const c = sum / n; want = clampN(c + (w.lat >= c ? 4.1 : -4.1), -reach, reach); }
    // Someone slower just ahead: pass them on the inside.
    else for (const o of roadFolk) {
      if (o === w || o.curve !== w.curve || o.dir !== w.dir || o.speed >= w.speed) continue;
      const ahead = (o.t - w.t) * w.dir;
      if (ahead > -2.5 && ahead < 5 && Math.abs(o.lat - want) < 1.5) want = o.lat - 1.6 >= -0.6 ? o.lat - 1.6 : o.lat + 1.6;
    }
  }
  // A soldier doesn't stop because you walked into him. One left far behind his rank stops for nothing at all.
  const lagging = mode === 'file' && slot - w.t > 7;
  steer(w, hz, want, reach, mode === 'file' ? 9 : since);
  want = steered.want;
  let go = lagging ? 1 : steered.go;
  if (mode !== 'file') {
    // Kept waiting a good while, or at the end of the road: turn round and go back.
    w.wait = go < 0.05 && w.v < 0.05 ? w.wait + dt : 0;
    let turn = w.wait > 5;
    if (mode === 'road' && !turn) { const next = w.t + w.speed * w.dir * dt; turn = next > w.len || next < 0; }
    if (turn) { w.dir = (w.dir * -1) as 1 | -1; w.lat = -w.lat; w.tx = -w.tx; w.tz = -w.tz; w.v = 0; w.wait = 0; go = 0; }
  }
  w.v += clampN(go - w.v, -dt * 5, dt * 2);
  const rate = leap ? 16 : 3;
  const lat = w.lat + clampN(want - w.lat, -rate * dt, rate * dt);
  let t = mode === 'file' ? w.t + clampN(slot - w.t, 0, w.speed * 1.5 * dt) * w.v : w.t + w.speed * w.dir * w.v * dt;
  t = mode === 'loop' ? ((t % w.len) + w.len) % w.len : clampN(t, 0, w.len);
  const k = t / w.len;
  w.curve.getPointAt(k, tmp);
  w.curve.getTangentAt(k, tan).multiplyScalar(w.dir);
  let x = tmp.x - tan.z * lat, z = tmp.z + tan.x * lat, held = false;
  // Never into anything: a step that would end inside a hazard, and nearer to it than before, isn't taken.
  if (!lagging) for (const h of hz) {
    const min = h.r + PERSON_R, ex = x - h.x, ez = z - h.z;
    if (Math.abs(ex) > min || Math.abs(ez) > min) continue;
    const d2 = ex * ex + ez * ez;
    if (d2 < min * min && d2 < (px - h.x) ** 2 + (pz - h.z) ** 2) { held = true; break; }
  }
  if (held) { x = px; z = pz; w.v = 0; } else { w.t = t; w.lat = lat; w.tx = tan.x; w.tz = tan.z; }
  const mx = x - px, mz = z - pz, lead = w.speed * dt * 0.4;
  w.obj.position.set(x, walkY(x, z), z);
  // Face the way it is going: down the road, turning into a sidestep.
  let dy = Math.atan2(mx + w.tx * lead, mz + w.tz * lead) - w.obj.rotation.y;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  w.obj.rotation.y += dy * Math.min(1, dt * 7);
  return dt > 0 ? Math.hypot(mx, mz) / (w.speed * dt) : 0;
}

/** Step the walk clip by how far the figure really moved. One that has stopped finishes its step and stands. */
function animate(w: Walker, rate: number, dt: number) {
  const g = w.gait;
  if (!g || rate > 0.12) { w.mixer.update(dt * Math.min(rate, 1.5)); return; }
  const half = g.dur / 2, ts = g.action.timeScale || 1;
  let rem = Infinity;
  for (const r of g.rests) { const d = (((r - g.action.time) % g.dur) + g.dur) % g.dur; if (d < rem) rem = d; }
  // Just past a rest counts as there; otherwise carry the step through to the next one.
  w.mixer.update(half - rem < 0.05 || rem < 1e-3 ? 0 : Math.min(rem, dt * 1.4 * ts) / ts);
}

const va = new THREE.Vector3(), vb = new THREE.Vector3();
/** Scan half the walk clip for the moment the feet pass each other; the other such moment is half a stride later. */
function findRests(obj: THREE.Object3D, mixer: THREE.AnimationMixer, action: THREE.AnimationAction, dur: number) {
  const lf = obj.getObjectByName('LeftFoot'), rf = obj.getObjectByName('RightFoot');
  if (!lf || !rf) return undefined;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < 24; i++) {
    const t = (i / 48) * dur;
    action.time = t; mixer.update(0); obj.updateMatrixWorld(true);
    lf.getWorldPosition(va); rf.getWorldPosition(vb);
    const d = Math.hypot(va.x - vb.x, va.z - vb.z);
    if (d < bestD) { bestD = d; best = t; }
  }
  return [best, best + dur / 2] as const;
}

/** Load a character and make `n` independent clones of it, each with its own mixer playing the walk clip. */
export function useCrowd(url: string, n: number, scale: number, speedUp = 1, kind = 'man', name?: string, theirs?: string) {
  const gltf = useGLTF(url);
  return useMemo(() => {
    const clip = gltf.animations[0];
    let rests: readonly [number, number] | undefined;
    return Array.from({ length: n }, (_, i) => {
      const obj = cloneSkinned(gltf.scene);
      obj.scale.setScalar(scale);
      obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.frustumCulled = false; } });
      Object.assign(obj.userData, { kind, name, theirs, head: obj.getObjectByName('Head') });
      const mixer = new THREE.AnimationMixer(obj);
      let gait: Gait | undefined;
      if (clip) {
        const a = mixer.clipAction(clip);
        a.play();
        if (i === 0) rests = findRests(obj, mixer, a, clip.duration);
        a.time = Math.random() * clip.duration; a.timeScale = speedUp;
        if (rests) gait = { action: a, dur: clip.duration, rests };
      }
      return { obj, mixer, gait };
    });
  }, [gltf, n, scale, speedUp, kind, name, theirs]);
}

/** Travellers going up and down every road, forever. */
export function Travellers({ url, count = 40, scale = 2.2, followable = false }: { url: string; count?: number; scale?: number; followable?: boolean }) {
  const kind = url.includes('soldier') ? 'soldier' : url.includes('-f') ? 'woman' : 'man';
  const crowd = useCrowd(url, count, scale, 1, kind);
  const walkers = useRef<Walker[]>([]);
  useEffect(() => {
    const curves = ROADS.map(roadCurve);
    const n = curves.length;
    const made = walkers.current = crowd.map(({ obj, mixer, gait }, i): Walker => {
      const curve = curves[i % n];
      const len = curve.getLength();
      // Half of each road's folk go each way; everyone keeps to their own right, so they pass instead of meeting.
      const dir = (i + (n % 2 ? 0 : Math.floor(i / n))) % 2 ? 1 : -1;
      return { curve, len, t: Math.random() * len, speed: 3.6 + Math.random() * 1.2, dir, side: 1.6, lat: 1.6, v: 1, tx: 0, tz: 1, wait: 0, mixer, obj, gait };
    });
    for (const w of made) { place(w); roadFolk.add(w); }
    if (import.meta.env.DEV && followable) (window as unknown as { __walkers: Walker[] }).__walkers = made;
    return () => { for (const w of made) roadFolk.delete(w); };
  }, [crowd]);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3 } | null;
  useFrame(({ camera, clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const f = followable ? walkers.current[FOLLOW] : undefined;
    if (f) {
      const yaw = f.obj.rotation.y;
      lookGoal.copy(f.obj.position).setY(f.obj.position.y + 2.2);
      camGoal.set(f.obj.position.x - Math.sin(yaw) * 14 + Math.cos(yaw) * 3, 0, f.obj.position.z - Math.cos(yaw) * 14 - Math.sin(yaw) * 3);
      camGoal.y = Math.max(ground(camGoal.x, camGoal.z) + 2, f.obj.position.y + 11);
      const k = camera.position.distanceTo(camGoal) > 60 ? 1 : 1 - Math.exp(-dt * 3);
      camera.position.lerp(camGoal, k);
      controls?.target.copy(lookGoal);
      camera.lookAt(lookGoal);
    }
    const now = clock.elapsedTime, hz = gather(now);
    for (const w of walkers.current) {
      const rate = stride(w, hz, now, dt, 4.2, 'road');
      // Only folk near you get the head-turn treatment (it costs a few matrix updates each).
      const close = (Math.abs(w.obj.position.x - me.x) < 14 && Math.abs(w.obj.position.z - me.z) < 14) || (w.obj.userData.look ?? 0) > 0.01;
      if (close) unturn(w.obj);
      animate(w, rate, dt);
      if (close) { rest(w.obj); notice(w.obj, now, dt); }
    }
  });
  useSolid(useMemo(() => crowd.map((c) => c.obj), [crowd]));
  return <group>{crowd.map((c, i) => <primitive key={i} object={c.obj} />)}</group>;
}

/** A lord or lady walking a slow loop in front of their own seat, facing the road to the capital. */
export function Promenade({ url, house, scale = 2.4 }: { url: string; house: number; scale?: number }) {
  const h = HOUSES[house];
  const [{ obj, mixer, gait }] = useCrowd(url, 1, scale, 0.8, 'lord', `The lord of House ${h.name}`, h.seat);
  const curve = useMemo(() => {
    const [cx, cz] = yardOf(HOUSES[house]);
    const pts = Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2;
      return new THREE.Vector3(cx + Math.cos(a) * 9, 0, cz + Math.sin(a) * 5);
    });
    return new THREE.CatmullRomCurve3(pts, true);
  }, [house]);
  const w = useMemo(() => {
    const made: Walker = { curve, len: curve.getLength(), t: Math.random() * 40, speed: 2.4, dir: 1, side: 0, lat: 0, v: 1, tx: 0, tz: 1, wait: 0, mixer, obj, gait };
    place(made);
    return made;
  }, [curve, mixer, obj, gait]);
  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.1), now = clock.elapsedTime;
    const rate = stride(w, gather(now), now, dt, 2.5, 'loop');
    const close = Math.hypot(obj.position.x - me.x, obj.position.z - me.z) < 14 || (obj.userData.look ?? 0) > 0.01;
    if (close) unturn(obj);
    animate(w, rate, dt);
    if (close) { rest(obj); notice(obj, now, dt); }
  });
  useSolid(useMemo(() => [obj], [obj]));
  return <primitive object={obj} />;
}

export interface MarchOrder { id: string; from: number; to: number; started: number }

/** A house army marching on a rival: a column in ranks of three behind a banner, along the roads. */
export function March({ url, order, ranks = 8, scale = 2.2, onArrive }: { url: string; order: MarchOrder; ranks?: number; scale?: number; onArrive?: () => void }) {
  const crowd = useCrowd(url, ranks * 3, scale, 1.15);
  const curve = useMemo(() => routeBetween(order.from, order.to)!, [order.from, order.to]);
  const len = useMemo(() => curve.getLength(), [curve]);
  const head = useRef(0);
  const done = useRef(false);
  const banner = useRef<THREE.Group>(null);
  const house = HOUSES[order.from];
  // How fast the column is going (0 to 1), how long it has stood halted, and how long it has been told to press on.
  const pace = useRef(1), halted = useRef(0), press = useRef(0);
  const walkers: Walker[] = useMemo(
    () => crowd.map(({ obj, mixer, gait }, i) => {
      const side = ((i % 3) - 1) * 2.2;
      obj.visible = false;
      return { curve, len, t: 0, speed: 6.5, dir: 1 as const, side, lat: side, v: 0, tx: 0, tz: 1, wait: 0, mixer, obj, gait };
    }),
    [crowd, curve, len],
  );
  useSolid(useMemo(() => walkers.map((w) => w.obj), [walkers]));
  useEffect(() => {
    columns.set(order.id, walkers.map((w) => w.obj.position));
    return () => { columns.delete(order.id); };
  }, [order.id, walkers]);
  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.1), now = clock.elapsedTime, hz = gather(now);
    head.current = Math.min(len, head.current + 6.5 * pace.current * dt);
    let go = 1;
    walkers.forEach((w, i) => {
      const slot = head.current - 6 - Math.floor(i / 3) * 3.2;
      // Not through the gate yet: out of sight, and out of everyone's way.
      if (slot <= 0) { w.obj.position.set(curve.getPointAt(0, tmp).x, -999, 99999); return; }
      if (!w.obj.visible) { w.obj.visible = true; w.t = 0; w.lat = w.side; place(w); }
      const rate = stride(w, hz, now, dt, 4.2, 'file', slot);
      go = Math.min(go, steered.go);
      animate(w, rate, dt);
    });
    // The column moves as one. It halts for what its men can't step round, but not for ever: after a few
    // seconds it presses on, so nobody can hold up a war by standing in the road.
    press.current = Math.max(0, press.current - dt);
    halted.current = pace.current < 0.1 && head.current < len ? halted.current + dt : 0;
    if (halted.current > 4) { halted.current = 0; press.current = 8; }
    if (press.current > 0) go = 1;
    pace.current += clampN(go - pace.current, -dt * 3, dt * 1.5);
    if (banner.current) {
      const u = head.current / len;
      curve.getPointAt(u, tmp);
      banner.current.position.set(tmp.x, walkY(tmp.x, tmp.z), tmp.z);
    }
    if (head.current >= len && !done.current) { done.current = true; onArrive?.(); }
  });
  return (
    <group>
      {crowd.map((c, i) => <primitive key={i} object={c.obj} />)}
      <group ref={banner}>
        <mesh position={[0, 6, 0]}><cylinderGeometry args={[0.12, 0.12, 12, 5]} /><meshStandardMaterial color="#3b2f25" /></mesh>
        <mesh position={[1.6, 10, 0]}><planeGeometry args={[3.2, 4]} /><meshStandardMaterial color={house.colors[0]} side={THREE.DoubleSide} /></mesh>
        <mesh position={[1.6, 10, 0.03]}><planeGeometry args={[1.4, 1.4]} /><meshStandardMaterial color={house.colors[1]} side={THREE.DoubleSide} /></mesh>
      </group>
    </group>
  );
}

export interface RavenFlight { id: string; from: number | 'capital'; to: number | 'capital'; started: number }

/** A raven crossing the sky between two seats: one per transaction between houses. */
export function Raven({ flight, onLand }: { flight: RavenFlight; onLand?: () => void }) {
  const g = useRef<THREE.Group>(null);
  const l = useRef<THREE.Mesh>(null), r = useRef<THREE.Mesh>(null);
  const [a, b] = useMemo(() => {
    const p = (k: number | 'capital') => (k === 'capital' ? [35, -40] : HOUSES[k].pos);
    return [p(flight.from), p(flight.to)];
  }, [flight]);
  const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const t = useRef(0), landed = useRef(false);
  const wing = useMemo(() => {
    const s = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(2.6, 0.4), new THREE.Vector2(0.4, 1.2)]);
    return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
  }, []);
  useFrame((_, dt) => {
    t.current = Math.min(1, t.current + (dt * 38) / dist);
    const u = t.current;
    const x = a[0] + (b[0] - a[0]) * u, z = a[1] + (b[1] - a[1]) * u;
    const y = Math.max(ground(x, z), 0) + 40 + Math.sin(u * Math.PI) * 70;
    g.current?.position.set(x, y, z);
    if (g.current) g.current.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]);
    const flap = Math.sin(performance.now() / 70) * 0.6;
    if (l.current) l.current.rotation.z = flap;
    if (r.current) r.current.rotation.z = -flap;
    if (u >= 1 && !landed.current) { landed.current = true; onLand?.(); }
  });
  return (
    <group ref={g} scale={1.6}>
      <mesh><capsuleGeometry args={[0.35, 1.6, 4, 6]} /><meshStandardMaterial color="#111" roughness={0.6} /></mesh>
      <mesh ref={l} geometry={wing} rotation-y={Math.PI / 2}><meshStandardMaterial color="#141414" side={THREE.DoubleSide} /></mesh>
      <mesh ref={r} geometry={wing} rotation-y={-Math.PI / 2} scale-x={-1}><meshStandardMaterial color="#141414" side={THREE.DoubleSide} /></mesh>
    </group>
  );
}
