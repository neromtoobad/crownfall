// You, in the realm: a lord you walk with WASD, a camera over your shoulder, and your house's chariot to ride.
// The characters only have a walk clip, so idle and run are made from it: idle is the walk's feet-together frame,
// run is the walk played faster with the limbs swung wider and the body leaning in.
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { walkY } from './bridges.ts';
import { crowd, driven, free, leafy, moveBody, nearestFree, setBeasts, solid } from './collide.ts';
import { HOUSES } from './layout.ts';
import { HORSE_SCALE, WHEEL_X, chariotMats, horseDepth, horseMaterial, rigHorse, runnerWorld, useChariotGeo } from './Race.tsx';
import { M, live, setWatch } from './race.ts';
import { raceKey } from './drive.ts';
import { emitPlay, keys, me, openPanel, pause, play, stick, takePressed, usePlay, type Seat, hushed, isAction, TOUCH } from './play.ts';
import { nextLine, story } from './missions.ts';
import { mapOpen, openMap } from '../Radar.tsx';
import { crackWhip, hoof, step } from './sound.ts';
import { surfaceAt } from './ambience.ts';
import { speakAs } from './barks.ts';
import { findPlace } from './places.ts';
import { act } from './act.ts';



/** Close enough to step up into the chariot: within a few units of the car or the team. */
function nearCar() {
  const c = me.car, hx = Math.sin(c.yaw), hz = Math.cos(c.yaw);
  const t = Math.max(0, Math.min(7.6, (me.x - c.x) * hx + (me.z - c.z) * hz));
  return Math.hypot(me.x - c.x - hx * t, me.z - c.z - hz * t) < 5.5;
}

/** Which side of a mover (at x, z heading yaw) a person stands on, as the lateral sign along their own path. */
function side(p: { position: { x: number; z: number }; rotation?: { y: number } } & object, x: number, z: number, yaw: number) {
  const rx = Math.cos(yaw), rz = -Math.sin(yaw); // the mover's right
  const s = (p.position.x - x) * rx + (p.position.z - z) * rz >= 0 ? 1 : -1;
  // A walker's lateral offset is along its own left normal; flip if the walker faces the other way.
  const py = (p as { rotation?: { y: number } }).rotation?.y ?? yaw;
  return s * (Math.cos(py - yaw) >= 0 ? -1 : 1);
}
/** [distance ahead of the car, radius] for each round body of a chariot and its team. */
const CAR_BODY: [number, number][] = [[0, 2.3], [4, 2.1], [8, 1.7]];
const carBeasts: { x: number; z: number; r: number }[] = [];
/** The same three bodies while you drive, for people on foot to keep clear of. */
const drivenPool = CAR_BODY.map(([, r]) => ({ x: 0, z: 0, r }));

const WALK = 5.5, RUN = 13, CAR_MAX = 30;
const horseDummy = new THREE.Object3D();
const LIMBS = ['LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftFoot', 'RightFoot'];

export function PlayerWorld() {
  const p = usePlay();
  if (p.mode !== 'play' || !p.seat) return null;
  return <Suspense fallback={null}><Player seat={p.seat} /></Suspense>;
}

/** A rigged body with poses we can blend: neutral (feet together), the walk, and a wider run. */
function useBody(url: string) {
  const gltf = useGLTF(url);
  return useMemo(() => {
    const obj = cloneSkinned(gltf.scene);
    obj.scale.setScalar(2.2);
    obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    const mixer = new THREE.AnimationMixer(obj);
    const clip = gltf.animations[0];
    const action = mixer.clipAction(clip);
    action.play();
    const bones: THREE.Bone[] = [];
    obj.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone); });
    const byName = (n: string) => bones.find((b) => b.name === n);
    // Find the moment in the walk where the feet pass each other: that's the standing pose.
    const lf = byName('LeftFoot'), rf = byName('RightFoot');
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    let best = 0, bestD = Infinity;
    for (let i = 0; i < 48; i++) {
      const t = (i / 48) * clip.duration;
      action.time = t; mixer.update(0); obj.updateMatrixWorld(true);
      if (!lf || !rf) break;
      lf.getWorldPosition(a); rf.getWorldPosition(b);
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < bestD) { bestD = d; best = t; }
    }
    action.time = best; mixer.update(0);
    const neutral = new Map(bones.map((bn) => [bn, { q: bn.quaternion.clone(), p: bn.position.clone() }]));
    const limbs = LIMBS.map(byName).filter(Boolean) as THREE.Bone[];
    return { obj, mixer, action, bones, neutral, limbs, spine: byName('Spine01') ?? byName('Spine'), hips: byName('Hips') };
  }, [gltf]);
}

const tq = new THREE.Quaternion(), tv = new THREE.Vector3();
/** amp 0 = standing, 1 = the walk as drawn, above 1 = limbs swung wider (running). */
function pose(body: ReturnType<typeof useBody>, amp: number, lean: number, breathe: number) {
  const k = Math.min(1, amp);
  for (const bn of body.bones) {
    const n = body.neutral.get(bn)!;
    tq.copy(bn.quaternion); bn.quaternion.slerpQuaternions(n.q, tq, k);
    tv.copy(bn.position); bn.position.lerpVectors(n.p, tv, k);
  }
  if (amp > 1) for (const bn of body.limbs) { const n = body.neutral.get(bn)!; tq.copy(bn.quaternion); bn.quaternion.slerpQuaternions(n.q, tq, amp); }
  body.spine?.rotateX(lean + breathe);
}

function Player({ seat }: { seat: Seat }) {
  const body = useBody(`/models/${seat.body}.glb`);
  const house = HOUSES[seat.house];
  const { camera, gl } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3 } | null;
  const self = useRef<THREE.Group>(null);
  const car = useRef<THREE.Group>(null);
  const seatSlot = useRef<THREE.Group>(null);

  // Mouse look: pointer lock when you click the world, or drag if the browser won't lock.
  useEffect(() => {
    const el = gl.domElement;
    let drag = false;
    const down = (e: PointerEvent) => {
      if (play.panel || play.mode !== 'play') return;
      if (e.button === 0 && document.pointerLockElement !== el) el.requestPointerLock?.()?.catch?.(() => undefined);
      drag = true;
    };
    const up = () => { drag = false; };
    const move = (e: PointerEvent) => {
      if (document.pointerLockElement !== el && !drag) return;
      me.camYaw -= e.movementX * 0.0028;
      me.camPitch = THREE.MathUtils.clamp(me.camPitch + e.movementY * 0.002, -0.05, 1.25);
      me.lastLook = performance.now() / 1000;
    };
    const wheel = (e: WheelEvent) => { me.camDist = THREE.MathUtils.clamp(me.camDist + e.deltaY * 0.008, 4.5, 24); };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointermove', move);
    el.addEventListener('wheel', wheel, { passive: true });
    return () => { el.removeEventListener('pointerdown', down); window.removeEventListener('pointerup', up); window.removeEventListener('pointermove', move); el.removeEventListener('wheel', wheel); };
  }, [gl]);

  // The chariot: two horses (instanced, galloping in the shader), the car, two wheels.
  const gltf = useGLTF('/env/horse.glb');
  const chariot = useChariotGeo();
  const kit = useMemo(() => {
    let mesh: THREE.Mesh | undefined;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((ob) => { if ((ob as THREE.Mesh).isMesh && !mesh) mesh = ob as THREE.Mesh; });
    const geo = rigHorse(mesh!.geometry.clone().applyMatrix4(mesh!.matrixWorld));
    const cycle = new THREE.InstancedBufferAttribute(new Float32Array(2), 1), stride = new THREE.InstancedBufferAttribute(new Float32Array(2), 1);
    geo.setAttribute('aCycle', cycle); geo.setAttribute('aStride', stride);
    return { geo, mat: horseMaterial(mesh!.material as THREE.MeshStandardMaterial), depth: horseDepth(), cycle, stride, ...chariot };
  }, [gltf]);
  const carMats = useMemo(() => chariotMats(chariot, house.colors[0]), [chariot, house]);
  const horses = useRef<THREE.InstancedMesh>(null);
  const wheels = [useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null)];
  const look = useMemo(() => new THREE.Vector3(), []);
  const goalCam = useMemo(() => new THREE.Vector3(), []);
  const promptTick = useRef(0);
  const lean = useMemo(() => ({ roll: 0, pitch: 0, lastSpeed: 0 }), []);
  // Eased so nothing snaps: how wide the limbs swing, the ground under your feet, and the ground the camera stands on.
  const anim = useMemo(() => ({ amp: 0, y: NaN, camY: NaN }), []);
  const camDist = useRef(me.camDist);
  const shake = useRef(0);
  const rw = useMemo(() => ({ x: 0, y: 0, z: 0, yaw: 0 }), []);
  const lookNow = useMemo(() => new THREE.Vector3(), []);
  const rig = useMemo(() => ({
    target: { dist: 8.5, height: 3.05, side: 0.85, fov: 54, ahead: 0.3 },
    now: { distWant: me.camDist, height: 3.05, side: 0.85, fov: 54, ahead: 0.3 },
    lead: { x: 0, z: 0 },
    drive: 0,
  }), []);

  useEffect(() => {
    // Start beside your chariot, both on clear ground, looking at the Mint.
    const c = me.car, hx = Math.sin(c.yaw), hz = Math.cos(c.yaw);
    const [cx, cz] = nearestFree(c.x + hx * 3.8, c.z + hz * 3.8, 4.2);
    c.x = cx - hx * 3.8; c.z = cz - hz * 3.8;
    [me.x, me.z] = nearestFree(c.x + hz * 4.5, c.z - hx * 4.5, 1.2);
    me.camYaw = me.yaw + Math.PI - 0.5;
    camera.position.set(me.x, walkY(me.x, me.z) + 8, me.z + 14);
    return () => { play.driving = false; driven.length = 0; };
  }, [camera]);

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const now = clock.elapsedTime;
    const c = me.car;
    // One-shot keys.
    const racingNow = play.racing && live.race.driver === seat.house;
    // A hall game owns the keys (and the camera) while it runs.
    if (!play.game) for (const k of takePressed()) {
      if (story.talk) { if (isAction(k)) nextLine(); continue; }
      if (isAction(k) && hushed()) continue;
      if (k === 'j' && play.panel?.panel === 'seals') { openPanel(undefined); continue; }
      if (k === 'j' && !play.panel && !play.racing) { openPanel({ id: 'seals', verb: 'Read', what: 'the Seal Book', panel: 'seals' }); continue; }
      if (k === 'm' && !play.panel) { openMap(!mapOpen()); continue; }
      if (k === 'escape' && mapOpen()) { openMap(false); continue; }
      if (mapOpen()) continue;
      if (k === 'escape' && play.panel) { openPanel(undefined); continue; }
      if ((k === 'escape' || k === 'p') && !play.panel) { pause(!play.paused); continue; }
      if (play.paused) continue;
      if (play.racing) { raceKey(k); continue; }
      if (play.panel) continue;
      if (k === 'e') {
        if (play.driving) {
          play.driving = false;
          const sx = Math.cos(c.yaw) * 4.2, sz = -Math.sin(c.yaw) * 4.2;
          // Step down onto clear ground: not into a wall, and not onto anyone standing by.
          const r = moveBody(c.x, c.z, sx, sz, 0.9, true);
          [me.x, me.z] = nearestFree(r.x, r.z, 0.9, true);
          me.yaw = c.yaw; me.speed = 0;
          emitPlay();
        } else if (nearCar()) {
          play.driving = true; c.v = 0; emitPlay();
        } else if (play.prompt) act(play.prompt);
      }
      if (k === 'c' && !play.driving && play.inside < 0) {
        // Whistle for your chariot: it pulls up behind you.
        // Far enough back that the horses' heads stop short of you, and never on top of anyone.
        const bx = me.x - Math.sin(me.yaw) * 11.5, bz = me.z - Math.cos(me.yaw) * 11.5;
        const [wx, wz] = nearestFree(bx, bz, 3.5, true, 'car');
        if (free(wx, wz, 3.5, true, 'car')) { c.x = wx; c.z = wz; c.yaw = me.yaw; c.v = 0; }
      }
      if (k === ' ' && play.driving && c.cool <= 0) { c.boost = 1.6; c.cool = 3.2; shake.current = 0.5; crackWhip(); }
    }
    const busy = play.paused || !!play.panel || play.racing || !!story.talk || mapOpen() || !!play.game;
    // Keys, or the touch stick (x right, y forward), as two axes.
    const k = (a: string, b: string) => (keys.has(a) || keys.has(b) ? 1 : 0);
    const useStick = stick.active && Math.hypot(stick.x, stick.y) > 0.01;
    const ay = busy ? 0 : useStick ? stick.y : k('w', 'arrowup') - k('s', 'arrowdown');
    const ax = busy ? 0 : useStick ? stick.x : k('d', 'arrowright') - k('a', 'arrowleft');

    if (play.driving) {
      // The chariot: throttle, brake, steer. Space cracks the whip for a burst.
      c.boost = Math.max(0, c.boost - dt); c.cool = Math.max(0, c.cool - dt);
      const max = CAR_MAX * (c.boost > 0 ? 1.45 : 1);
      const target = ay > 0.12 ? max * Math.min(1, ay * 1.15) : ay < -0.3 ? -7 : 0;
      const rate = target === 0 ? 9 : Math.sign(target - c.v) !== Math.sign(c.v) && c.v !== 0 ? 32 : 13;
      c.v += THREE.MathUtils.clamp(target - c.v, -rate * dt, rate * dt);
      const steer = -ax * 1.15 * THREE.MathUtils.clamp(0.4 + Math.abs(c.v) / 9, 0, 1) * (c.v < 0 ? -1 : 1) / (1 + Math.abs(c.v) / 45);
      c.yaw += steer * dt;
      const hx = Math.sin(c.yaw), hz = Math.cos(c.yaw);
      // The team is three round bodies: the car, the horses' shoulders and their heads. Each is pushed out of walls;
      // the corrections add up, so no part of the chariot goes through anything.
      const mx = hx * c.v * dt, mz = hz * c.v * dt;
      let fx = mx, fz = mz, hitAny = false;
      for (const [off, rad] of CAR_BODY) {
        const px = c.x + hx * off, pz = c.z + hz * off;
        // People are as solid as walls to it: they leap aside (below), and whoever can't brings the team up short.
        const r = moveBody(px, pz, fx, fz, rad, true, 'car');
        if (r.hit || r.who) { hitAny = true; fx = r.x - px; fz = r.z - pz; }
      }
      // Scraping along a wall keeps the speed you actually make along it; driving into one stops you.
      if (hitAny && dt > 0) {
        if (Math.abs(c.v) > 12) shake.current = Math.min(1, Math.abs(c.v) / 30);
        const got = (fx * hx + fz * hz) / dt;
        c.v = c.v > 0 ? Math.max(0, Math.min(c.v, got)) : Math.min(0, Math.max(c.v, got));
      }
      c.x += fx; c.z += fz;
      // People leap out of the way of a chariot coming at them.
      driven.length = 0;
      CAR_BODY.forEach(([off], i) => { const b = drivenPool[i]; b.x = c.x + hx * off; b.z = c.z + hz * off; driven.push(b); });
      // People leap out of the way of a chariot coming at them: everyone in its path, further ahead the faster it comes.
      if (Math.abs(c.v) > 0.5) {
        const fwd = c.v >= 0 ? 1 : -1, reach = 11 + Math.abs(c.v) * 0.9;
        for (const p of crowd) {
          const dx = p.position.x - c.x, dz = p.position.z - c.z;
          if (Math.abs(dx) > 48 || Math.abs(dz) > 48) continue;
          const along = (dx * hx + dz * hz) * fwd, across = Math.abs(dx * hz - dz * hx);
          if (along < (fwd > 0 ? -2.5 : -11) || along > (fwd > 0 ? reach : reach - 8) || across > 3.9) continue;
          if (now - (p.userData.bump ?? -9) > 2) speakAs('dodged', p);
          p.userData.bump = now; p.userData.dodge = side(p as Parameters<typeof side>[0], c.x, c.z, c.yaw) * 5.5;
        }
      }
      me.x = c.x; me.z = c.z; me.yaw = c.yaw; me.speed = Math.abs(c.v);
    } else {
      // On foot, relative to where the camera looks.
      const ix = ax, iz = ay, mag = Math.min(1, Math.hypot(ix, iz));
      const run = keys.has('shift') || (useStick && mag > 0.92);
      const want = mag > 0.05 ? (run ? RUN : WALK * Math.max(0.45, mag)) : 0;
      // Up to speed in about a third of a second, stopped in about a fifth.
      me.speed += THREE.MathUtils.clamp(want - me.speed, -62 * dt, (run ? 38 : 30) * dt);
      const yaw0 = me.yaw;
      if (ix || iz) {
        const fx = -Math.sin(me.camYaw), fz = -Math.cos(me.camYaw); // away from the camera
        // Screen right is (-fz, fx): D / stick right walks right on screen.
        const dx = fx * iz - fz * ix, dz = fz * iz + fx * ix;
        const len = Math.hypot(dx, dz) || 1;
        const goal = Math.atan2(dx / len, dz / len);
        let d = goal - me.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
        // Turn fast at a walk, in a wide arc at a sprint; reverse at low speed with a quick pivot.
        const pivot = Math.abs(d) > 2.35 && me.speed < WALK + 1;
        if (pivot) me.speed *= Math.max(0, 1 - dt * 10);
        const maxTurn = pivot ? 16 : THREE.MathUtils.lerp(12.5, 5.2, Math.min(1, me.speed / RUN));
        me.yaw += THREE.MathUtils.clamp(d * Math.min(1, dt * 14), -maxTurn * dt, maxTurn * dt);
      }
      // Lean into the turn and with the push off.
      const yawRate = dt > 0 ? Math.atan2(Math.sin(me.yaw - yaw0), Math.cos(me.yaw - yaw0)) / dt : 0;
      const ease = 1 - Math.exp(-dt * 7);
      lean.roll += (THREE.MathUtils.clamp(-yawRate * me.speed * 0.006, -0.2, 0.2) - lean.roll) * ease;
      const acc = dt > 0 ? (me.speed - lean.lastSpeed) / dt : 0;
      lean.pitch += (THREE.MathUtils.clamp(acc * 0.004, -0.09, 0.1) - lean.pitch) * ease;
      lean.lastSpeed = me.speed;
      driven.length = 0;
      {
        // Every frame, even standing still: anyone or anything that has ended up against you pushes you clear.
        const go = me.speed * dt;
        const r = moveBody(me.x, me.z, Math.sin(me.yaw) * go, Math.cos(me.yaw) * go, 0.9, true);
        const got = Math.hypot(r.x - me.x, r.z - me.z);
        me.x = r.x; me.z = r.z;
        if (r.who && me.speed > 0.05) { if (now - (r.who.userData.bump ?? -9) > 2) speakAs('bumped', r.who); r.who.userData.bump = now; if (me.speed > 9) r.who.userData.dodge = side(r.who, me.x, me.z, me.yaw) * 2.5; }
        // Up against a wall or a person you only make the ground you really cover: no running on the spot.
        if ((r.hit || r.who) && go > 1e-4 && dt > 0) me.speed = Math.min(me.speed, Math.max(1.2, got / dt));
      }
      // An empty chariot rolls to a stop.
      c.v *= Math.max(0, 1 - dt * 3);
    }
    play.speed = me.speed;

    // Your body.
    const g = self.current!;
    const sp = play.driving ? 0 : me.speed;
    // Cadence follows speed at a walk; when running, longer strides carry the rest so the legs don't blur.
    body.action.timeScale = sp < 0.3 ? 0 : sp <= WALK ? sp / 4.6 : WALK / 4.6 + ((sp - WALK) / (RUN - WALK)) * 0.65;
    const bt0 = body.action.time;
    body.mixer.update(dt);
    // A footstep at each half of the walk cycle.
    const half = body.action.getClip().duration / 2;
    if (sp > 0.5 && Math.floor(body.action.time / half) !== Math.floor(bt0 / half)) step(surfaceAt(me.x, me.z), sp > WALK ? 1.5 : 1);
    const ampWant = play.driving ? 0 : sp < 0.3 ? 0 : sp <= WALK ? Math.min(1, sp / 2.5) : 1 + ((sp - WALK) / (RUN - WALK)) * 0.75;
    // The limbs settle into the stand and swing out into the run over a few frames, never in one.
    anim.amp = play.driving ? 0 : anim.amp + (ampWant - anim.amp) * (1 - Math.exp(-dt * (ampWant < anim.amp ? 11 : 16)));
    const amp = anim.amp < 0.004 ? 0 : anim.amp;
    pose(body, amp, sp > WALK ? 0.22 * Math.min(1, (sp - WALK) / 4) : 0, play.driving ? 0 : Math.sin(now * 1.6) * 0.012 * Math.max(0, 1 - amp * 3));
    if (racingNow) {
      // In the race: you stand in your house's chariot, wherever the sim has it this frame.
      if (body.obj.parent !== g) g.add(body.obj);
      runnerWorld(live.race.runners[seat.house], rw);
      g.position.set(rw.x, rw.y + 0.85 * M, rw.z);
      body.obj.rotation.set(0, rw.yaw, 0);
    } else if (play.driving && seatSlot.current) {
      if (body.obj.parent !== seatSlot.current) seatSlot.current.add(body.obj);
      body.obj.position.set(0, 0, 0); body.obj.rotation.set(0, 0, 0); lean.roll = lean.pitch = 0;
      g.position.set(c.x, walkY(c.x, c.z) + 1.6, c.z); // the nameplate rides along
    } else {
      if (body.obj.parent !== g) g.add(body.obj);
      // Your feet follow the ground a touch softly, so a kerb or the lip of a bridge is a step and not a jolt.
      const gy = walkY(me.x, me.z);
      anim.y = me.cut || !(Math.abs(gy - anim.y) < 2.5) ? gy : anim.y + (gy - anim.y) * (1 - Math.exp(-dt * 22));
      g.position.set(me.x, anim.y, me.z);
      body.obj.rotation.order = 'YXZ';
      body.obj.rotation.set(lean.pitch, me.yaw, lean.roll);
    }
    g.visible = (!play.racing || racingNow) && !play.game;

    // A parked or called chariot is solid to walk into: the car and both horses (never while you drive it).
    {
      const hx = Math.sin(c.yaw), hz = Math.cos(c.yaw);
      carBeasts.length = 0;
      if (!play.driving && !play.racing) for (const [off, rad] of CAR_BODY) carBeasts.push({ x: c.x + hx * off, z: c.z + hz * off, r: rad * 0.85 });
      setBeasts('car', carBeasts);
    }
    // The chariot and its horses.
    const cg = car.current!;
    cg.position.set(c.x, walkY(c.x + Math.sin(c.yaw) * 3, c.z + Math.cos(c.yaw) * 3), c.z);
    cg.rotation.y = c.yaw;
    cg.visible = !play.racing && play.inside < 0;
    const cs = Math.abs(c.v);
    const g0 = c.gait;
    c.gait += dt * (cs < 0.5 ? 0 : Math.min(2.5, 0.5 + cs / 12));
    // Four beats a stride (two horses, a beat each pair of legs).
    if (cs > 1 && Math.floor(c.gait * 4) !== Math.floor(g0 * 4)) hoof(play.driving ? 1 : 0.5);
    const strideAmt = THREE.MathUtils.clamp(cs / 20, 0, 1);
    const bob = Math.abs(Math.sin(c.gait * Math.PI * 2)) * 0.18 * M * strideAmt;
    const o = horseDummy;
    for (const j of [0, 1]) {
      o.position.set((j ? 0.5 : -0.5) * M, 0.836 * HORSE_SCALE + bob, 4.1 * M);
      o.rotation.set(Math.sin(c.gait * Math.PI * 2) * 0.04 * strideAmt, 0, 0);
      o.scale.setScalar(HORSE_SCALE); o.updateMatrix();
      horses.current!.setMatrixAt(j, o.matrix);
      kit.cycle.setX(j, c.gait + j * 0.06); kit.stride.setX(j, strideAmt);
    }
    horses.current!.instanceMatrix.needsUpdate = true; kit.cycle.needsUpdate = true; kit.stride.needsUpdate = true;
    for (const w of wheels) if (w.current) w.current.rotation.x += (c.v * dt) / (0.75 * M);

    // What can you do here?
    if (++promptTick.current % 6 === 0) {
      const near = !play.driving && play.inside < 0 && nearCar();
      const p = play.driving ? { id: 'car-out', verb: 'Step down', what: 'from your chariot' }
        : near ? { id: 'car-in', verb: 'Ride', what: `your chariot of House ${house.name}` }
          : findPlace(me.x, me.z, seat);
      if (p?.id !== play.prompt?.id) { play.prompt = p; emitPlay(); }
    }

    // The camera, over your shoulder (further back in the chariot), turning in behind you when you drive.
    if (racingNow) {
      if (live.watch) setWatch(false);
      const hx = Math.sin(rw.yaw), hz = Math.cos(rw.yaw);
      goalCam.set(rw.x - hx * 26, rw.y + 12, rw.z - hz * 26);
      look.set(rw.x + hx * 14, rw.y + 3, rw.z + hz * 14);
      camera.position.lerp(goalCam, 1 - Math.exp(-dt * 5));
      lookNow.lerp(look, 1 - Math.exp(-dt * 8));
      camera.lookAt(lookNow);
      return;
    }
    if (play.racing || live.watch || play.game) return;
    // ---- The follow camera: an orbit round a pivot at your shoulder (Nesky's model), every parameter eased so
    // walking, running and driving blend into each other instead of cutting.
    const driving = play.driving;
    const idle = now - me.lastLook;
    // Recenter behind you, only while moving and only once you've left the mouse alone for a while.
    if (driving && idle > 1.4 && cs > 3) {
      let d = c.yaw + Math.PI - me.camYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      me.camYaw += d * Math.min(1, dt * 2.2);
    } else if (!driving && idle > (TOUCH ? 0.9 : 2.2) && me.speed > WALK * (TOUCH ? 0.5 : 0.8)) {
      // On a phone the camera swings round sooner and harder, so the stick alone is enough to get about.
      let d = me.yaw + Math.PI - me.camYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      me.camYaw += d * Math.min(1, dt * (TOUCH ? 1.7 : 0.9) * Math.max(TOUCH ? 0.6 : 0, me.speed / RUN));
    }
    const spd = driving ? Math.min(1, cs / CAR_MAX) : Math.min(1, me.speed / RUN);
    // Targets for this frame. Distance and FOV are geared to pitch: look up and the camera comes in and widens.
    const gear = THREE.MathUtils.lerp(0.72, 1.18, THREE.MathUtils.smoothstep(me.camPitch, -0.05, 1.1));
    const worm = Math.max(0, 0.2 - me.camPitch) * 30;
    const T = rig.target;
    T.dist = (driving ? 21 + spd * 6 : me.camDist) * gear;
    T.height = driving ? 5.6 + spd * 2.2 : 3.05;          // pivot height: shoulder on foot, higher at speed in the car
    T.side = driving ? 0 : 0.85;                         // over the right shoulder on foot
    T.fov = (driving ? 58 + spd * 14 : 54 + (me.speed > WALK + 1 ? 4 : 0)) + worm;
    T.ahead = driving ? 0.45 : 0.3;                      // seconds of look-ahead
    const R = rig.now, ease = 1 - Math.exp(-dt * 5);
    R.height += (T.height - R.height) * ease; R.side += (T.side - R.side) * ease;
    R.fov += (T.fov - R.fov) * (1 - Math.exp(-dt * 3)); R.ahead += (T.ahead - R.ahead) * ease;
    R.distWant += (T.dist - R.distWant) * (1 - Math.exp(-dt * 4));
    // Look-ahead: lead where you're going, capped, heavily smoothed, flat.
    const hx2 = Math.sin(me.yaw), hz2 = Math.cos(me.yaw), sp2 = driving ? c.v : me.speed;
    const cap = driving ? 11 : 3.5;
    const lax = THREE.MathUtils.clamp(hx2 * sp2 * R.ahead, -cap, cap), laz = THREE.MathUtils.clamp(hz2 * sp2 * R.ahead, -cap, cap);
    rig.lead.x += (lax - rig.lead.x) * (1 - Math.exp(-dt * 2)); rig.lead.z += (laz - rig.lead.z) * (1 - Math.exp(-dt * 2));
    // Pivot: you, at shoulder height, shifted to the right so you stand left of centre and the way ahead shows.
    const rx = Math.cos(me.camYaw), rz = -Math.sin(me.camYaw); // the camera's right
    // In the chariot the pivot sits over the middle of the team, not the car, so the horses and you both frame.
    const mid = driving ? 3.2 * rig.drive : 0;
    rig.drive += ((driving ? 1 : 0) - rig.drive) * ease;
    const px = me.x + rx * R.side + rig.lead.x + Math.sin(me.yaw) * mid, pz = me.z + rz * R.side + rig.lead.z + Math.cos(me.yaw) * mid;
    // The camera rides the ground more softly still: bumps in the road don't shake the view.
    const cy = walkY(me.x, me.z);
    anim.camY = me.cut || !(Math.abs(cy - anim.camY) < 6) ? cy : anim.camY + (cy - anim.camY) * (1 - Math.exp(-dt * 9));
    const py = anim.camY + R.height;
    // Collision: march out from the pivot; snap in at once, ease back out over about a second.
    const ox = Math.sin(me.camYaw) * Math.cos(me.camPitch), oz = Math.cos(me.camYaw) * Math.cos(me.camPitch), oy = Math.sin(me.camPitch);
    let dist = R.distWant;
    for (let d = 1; d < dist; d += 0.75) {
      const sx = px + ox * d, sz = pz + oz * d;
      if (solid(sx, sz, 0.55) || leafy(sx, sz, py + oy * d - walkY(sx, sz))) { dist = Math.max(1.6, d - 0.8); break; }
    }
    camDist.current = dist < camDist.current ? dist : camDist.current + (dist - camDist.current) * (1 - Math.exp(-dt * 1.6));
    dist = camDist.current;
    // Hemmed in: lift and look down over the shoulder rather than sit in your back.
    const pitch = dist < 5.5 ? Math.max(me.camPitch, 0.35 + (5.5 - dist) * 0.12) : me.camPitch;
    look.set(px, py, pz);
    goalCam.set(px + Math.sin(me.camYaw) * Math.cos(pitch) * dist, py + Math.sin(pitch) * dist, pz + Math.cos(me.camYaw) * Math.cos(pitch) * dist);
    goalCam.y = Math.max(goalCam.y, walkY(goalCam.x, goalCam.z) + 1.4);
    if (me.cut) { camera.position.copy(goalCam); camDist.current = dist; me.cut = false; } else camera.position.lerp(goalCam, 1 - Math.exp(-dt * (driving ? 9 : 14)));
    const pc = camera as THREE.PerspectiveCamera;
    if (Math.abs(pc.fov - R.fov) > 0.02) { pc.fov = R.fov; pc.updateProjectionMatrix(); }
    camera.lookAt(look);
    // Shake (Eiserloh's trauma): rotational, from smooth noise, squared so small knocks stay small. A low rumble
    // under the wheels grows with speed.
    shake.current = Math.max(0, shake.current - dt * 1.4);
    const trauma = Math.min(1, shake.current + (driving ? 0.12 * spd : 0));
    if (trauma > 0.001) {
      const t2 = trauma * trauma, tt = now * 23;
      const n = (o: number) => Math.sin(tt * 1.0 + o) * 0.5 + Math.sin(tt * 2.31 + o * 1.7) * 0.3 + Math.sin(tt * 4.7 + o * 2.9) * 0.2;
      camera.rotateX(n(1.3) * t2 * 0.026); camera.rotateY(n(7.1) * t2 * 0.026); camera.rotateZ(n(3.7) * t2 * 0.03);
    }
    controls?.target.copy(look);
  });

  return (
    <group>
      <group ref={self}>
      </group>
      <group ref={car}>
        <instancedMesh ref={horses} args={[kit.geo, kit.mat, 2]} customDepthMaterial={kit.depth} castShadow frustumCulled={false} />
        <mesh geometry={kit.car.wood} material={carMats.wood} castShadow receiveShadow />
        <mesh geometry={kit.car.paint} material={carMats.paint} castShadow receiveShadow />
        {[-WHEEL_X, WHEEL_X].map((x, i) => (
          <mesh key={x} ref={wheels[i]} geometry={kit.wheel} position={[x * M, 0.75 * M, 0]} material={carMats.wheel} castShadow />
        ))}
        <group ref={seatSlot} position={[0, 0.85 * M, 0]} />
      </group>
    </group>
  );
}
