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
import { crowd as solidCrowd } from './collide.ts';
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
/** A figure someone bumped stops for a moment; one a chariot charged at leaps aside and comes back slowly. Returns the lateral offset. */
function react(o: THREE.Object3D, now: number, dt: number) {
  const u = o.userData as { bump?: number; dodge?: number; off?: number };
  const target = u.dodge && now - (u.bump ?? 0) < 3 ? u.dodge : 0;
  u.off = (u.off ?? 0) + (target - (u.off ?? 0)) * Math.min(1, dt * (target ? 9 : 0.8));
  return { stopped: now - (u.bump ?? -9) < 1.2, off: u.off };
}

/** One rigged figure walking along a curve. `t` is the distance travelled, in units. */
interface Walker { curve: THREE.Curve<THREE.Vector3>; len: number; t: number; speed: number; dir: 1 | -1; side: number; mixer: THREE.AnimationMixer; obj: THREE.Object3D }

const tmp = new THREE.Vector3(), tan = new THREE.Vector3();
// ?follow=N rides the camera behind traveller N (checks, demo recording).
const FOLLOW = Number(new URLSearchParams(location.search).get('follow') ?? NaN);
const camGoal = new THREE.Vector3(), lookGoal = new THREE.Vector3();

function place(w: Walker, offsetBack = 0, lateral = 0) {
  const d = THREE.MathUtils.clamp(w.t - offsetBack * w.dir, 0, w.len);
  const u = d / w.len;
  w.curve.getPointAt(u, tmp);
  w.curve.getTangentAt(u, tan).multiplyScalar(w.dir);
  const nx = -tan.z, nz = tan.x;
  const x = tmp.x + nx * (w.side + lateral), z = tmp.z + nz * (w.side + lateral);
  w.obj.position.set(x, walkY(x, z), z);
  w.obj.rotation.y = Math.atan2(tan.x, tan.z);
}

/** Load a character and make `n` independent clones of it, each with its own mixer playing the walk clip. */
export function useCrowd(url: string, n: number, scale: number, speedUp = 1, kind = 'man', name?: string, theirs?: string) {
  const gltf = useGLTF(url);
  return useMemo(() => {
    const clip = gltf.animations[0];
    return Array.from({ length: n }, () => {
      const obj = cloneSkinned(gltf.scene);
      obj.scale.setScalar(scale);
      obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.frustumCulled = false; } });
      Object.assign(obj.userData, { kind, name, theirs, head: obj.getObjectByName('Head') });
      const mixer = new THREE.AnimationMixer(obj);
      if (clip) { const a = mixer.clipAction(clip); a.play(); a.time = Math.random() * clip.duration; a.timeScale = speedUp; }
      return { obj, mixer };
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
    walkers.current = crowd.map(({ obj, mixer }, i) => {
      const curve = curves[i % curves.length];
      const len = curve.getLength();
      const dir: 1 | -1 = i % 2 ? 1 : -1;
      return { curve, len, t: Math.random() * len, speed: 3.6 + Math.random() * 1.2, dir, side: dir * 1.6, mixer, obj };
    });
    walkers.current.forEach((w) => place(w));
    if (import.meta.env.DEV && followable) (window as unknown as { __walkers: Walker[] }).__walkers = walkers.current;
  }, [crowd]);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3 } | null;
  useFrame(({ camera }, dt) => {
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
    const now = performance.now() / 1000;
    for (const w of walkers.current) {
      const { stopped, off } = react(w.obj, now, dt);
      if (!stopped) w.t += w.speed * w.dir * dt;
      if (w.t > w.len || w.t < 0) { w.dir = (w.dir * -1) as 1 | -1; w.side = w.dir * 1.6; w.t = THREE.MathUtils.clamp(w.t, 0, w.len); }
      place(w, 0, off);
      // Only folk near you get the head-turn treatment (it costs a few matrix updates each).
      const close = (Math.abs(w.obj.position.x - me.x) < 14 && Math.abs(w.obj.position.z - me.z) < 14) || (w.obj.userData.look ?? 0) > 0.01;
      if (close) unturn(w.obj);
      w.mixer.update(stopped ? 0 : dt);
      if (close) { rest(w.obj); notice(w.obj, now, dt); }
    }
  });
  useSolid(useMemo(() => crowd.map((c) => c.obj), [crowd]));
  return <group>{crowd.map((c, i) => <primitive key={i} object={c.obj} />)}</group>;
}

/** A lord or lady walking a slow loop in front of their own seat, facing the road to the capital. */
export function Promenade({ url, house, scale = 2.4 }: { url: string; house: number; scale?: number }) {
  const h = HOUSES[house];
  const [{ obj, mixer }] = useCrowd(url, 1, scale, 0.8, 'lord', `The lord of House ${h.name}`, h.seat);
  const curve = useMemo(() => {
    const [cx, cz] = yardOf(HOUSES[house]);
    const pts = Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2;
      return new THREE.Vector3(cx + Math.cos(a) * 9, 0, cz + Math.sin(a) * 5);
    });
    return new THREE.CatmullRomCurve3(pts, true);
  }, [house]);
  const w = useMemo<Walker>(() => ({ curve, len: curve.getLength(), t: Math.random() * 40, speed: 2.4, dir: 1, side: 0, mixer, obj }), [curve, mixer, obj]);
  useFrame((_, dt) => {
    const { stopped, off } = react(obj, performance.now() / 1000, dt);
    if (!stopped) w.t = (w.t + w.speed * dt) % w.len;
    place(w, 0, off);
    const now = performance.now() / 1000, close = Math.hypot(obj.position.x - me.x, obj.position.z - me.z) < 14 || (obj.userData.look ?? 0) > 0.01;
    if (close) unturn(obj);
    mixer.update(stopped ? 0 : dt);
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
  const walkers: Walker[] = useMemo(
    () => crowd.map(({ obj, mixer }) => ({ curve, len, t: 0, speed: 0, dir: 1 as const, side: 0, mixer, obj })),
    [crowd, curve, len],
  );
  useSolid(useMemo(() => walkers.map((w) => w.obj), [walkers]));
  useFrame((_, dt) => {
    head.current = Math.min(len, head.current + 6.5 * dt);
    walkers.forEach((w, i) => {
      const rank = Math.floor(i / 3), file = (i % 3) - 1;
      w.t = Math.max(0, head.current - 6 - rank * 3.2);
      place(w, 0, file * 2.2 + react(w.obj, performance.now() / 1000, dt).off);
      w.mixer.update(head.current >= len ? 0 : dt);
    });
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
