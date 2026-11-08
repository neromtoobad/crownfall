// The Mumtaz Hippodrome: stands, sand, the spina, a crowd, and eight chariots in house colours.
// One generated horse (no rig): the gallop is done in its vertex shader — legs, tail and head swing about fixed pivots.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { setBeasts } from './collide.ts';
import { ground } from './heights.ts';
import { HIPPODROME, HOUSES } from './layout.ts';
import { surfaced, triplanar } from './materials.ts';
import { NearBanners, NearFlags, type Cloth } from './NearCloth.tsx';
import { NEAR_GREEN, clothMaterial, stripTexture } from './near.ts';
import AVG from './texAvg.json';
import { ARENA, M, MID, advance, drawAt, laneLen, lanePoint, live, setWatch, standings, type Runner } from './race.ts';

const [AX, AZ] = HIPPODROME.pos;
export const ARENA_Y = ground(AX, AZ);
const { L, R } = ARENA;
export const HORSE_SCALE = 1.4 * M;
const teamBeasts: { x: number; z: number; r: number }[] = [];

type G = THREE.BufferGeometry;
const merge = (list: G[]) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => { g.deleteAttribute('uv'); return g; }))!;
function stadium(rr: number, half = L / 2) {
  const s = new THREE.Shape();
  s.moveTo(-half, -rr);
  s.lineTo(half, -rr);
  s.absarc(half, 0, rr, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(-half, rr);
  s.absarc(-half, 0, rr, Math.PI / 2, Math.PI * 1.5, false);
  return s;
}
/** A flat ring between two stadium outlines, raised to `h`. */
function tier(r0: number, r1: number, y: number, h: number) {
  const s = stadium(r1);
  s.holes.push(new THREE.Path(stadium(r0).getPoints(64)));
  return new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 32 }).rotateX(-Math.PI / 2).translate(0, y, 0);
}

/** Seats for the crowd: tiers k = 0..3, one spectator every ~1.5 units, skipping the gate gaps. */
function seats() {
  const out: [number, number, number][] = [];
  for (let k = 0; k < 4; k++) {
    const r = R + 2.6 + k * 3.4, y = 1.6 + k * 2.2;
    const P = laneLen(r);
    const p = { x: 0, z: 0, yaw: 0 };
    for (let s = 0; s < P; s += 1.45 + (k % 2) * 0.1) {
      lanePoint(r, s, p);
      if (Math.abs(p.x) < 5 && p.z < 0) continue; // the far gate
      out.push([p.x + (Math.sin(s * 7.1) * 0.25), y, p.z]);
    }
  }
  return out;
}

export function Arena() {
  const { stone, sand, posts } = useMemo(() => {
    const st: G[] = [];
    // Four tiers of seating and a tall outer wall.
    for (let k = 0; k < 4; k++) st.push(tier(R + 1 + k * 3.4, R + 1 + (k + 1) * 3.4, 0, 1.6 + k * 2.2));
    st.push(tier(R + 14.6, R + 16, 0, 12));
    st.push(tier(R, R + 1, 0, 1.4)); // the parapet in front of the crowd
    // The spina: a long low wall with an obelisk, and the turning posts at both ends.
    st.push(new THREE.BoxGeometry(L - 4, 1.8, 5.5).translate(0, 0.9, 0));
    st.push(new THREE.BoxGeometry(3, 2, 3).translate(0, 1.6, 0), new THREE.ConeGeometry(1.3, 16, 4).translate(0, 10.6, 0));
    for (const x of [-L / 2 + 6, L / 2 - 6]) st.push(new THREE.CylinderGeometry(2.4, 2.6, 1.6, 12).translate(x, 0.8, 0));
    // The great gate in the far stand.
    for (const x of [-5.5, 5.5]) st.push(new THREE.BoxGeometry(3, 16, 18).translate(x, 8, -R - 8));
    st.push(new THREE.BoxGeometry(14, 4, 18).translate(0, 16, -R - 8));
    const sandG = new THREE.ShapeGeometry(stadium(R + 1, L / 2), 32).rotateX(-Math.PI / 2).translate(0, 0.35, 0);
    const postsG = merge([-L / 2 + 6, L / 2 - 6].flatMap((x) => [-1, 0, 1].map((k) => new THREE.ConeGeometry(0.7, 6, 8).translate(x + k * 1.2, 4.6, k * 0.6))));
    return { stone: merge(st), sand: sandG, posts: postsG };
  }, []);
  const [rock, sandT] = useTexture(['/tex/rock.jpg', '/tex/sand.jpg']);
  const mats = useMemo(() => {
    for (const t of [rock, sandT]) { t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; }
    const A = AVG as Record<string, number[]>;
    const s = triplanar(rock, A.rock, 0.12, '#bfb19a', true); s.vertexColors = false;
    const d = triplanar(sandT, A.sand, 0.1, '#cdb183'); d.vertexColors = false;
    return { stone: s, sand: d };
  }, [rock, sandT]);
  return (
    <group position={[AX, ARENA_Y, AZ]} rotation-y={HIPPODROME.rot}>
      <mesh geometry={stone} material={mats.stone} castShadow receiveShadow />
      <mesh geometry={sand} material={mats.sand} receiveShadow />
      <mesh geometry={posts}><meshStandardMaterial color="#c9a24a" metalness={0.7} roughness={0.35} /></mesh>
      <FinishLine />
      <NearDressing />
      <Crowd />
      <Teams />
      <RaceCamera />
    </group>
  );
}

function FinishLine() {
  return (
    <group>
      <mesh position={[0, 0.4, (R + 5) / 2]} rotation-x={-Math.PI / 2}><planeGeometry args={[1, R - 5]} /><meshStandardMaterial color="#f3ecdc" roughness={0.9} /></mesh>
      {/* the judges' box over the line */}
      <mesh position={[0, 12, R + 9]} castShadow><boxGeometry args={[12, 4, 7]} /><meshStandardMaterial color="#7a2a22" roughness={0.8} /></mesh>
      <mesh position={[0, 15, R + 9]} castShadow><coneGeometry args={[7.5, 3, 4]} /><meshStandardMaterial color="#c9a24a" metalness={0.6} roughness={0.4} /></mesh>
    </group>
  );
}

/** NEAR colours round the arena: flags along the top of the wall, banners down its outside, and a gantry over the line. */
function NearDressing() {
  const { flags, banners } = useMemo(() => {
    const flags: Cloth[] = [], banners: Cloth[] = [];
    const p = { x: 0, z: 0, yaw: 0 };
    for (let s = 0, P = laneLen(R + 15.3); s < P; s += 26) {
      lanePoint(R + 15.3, s, p);
      flags.push({ x: p.x, y: 12, z: p.z, ry: -HIPPODROME.rot, w: 5, h: 3.2 });
    }
    for (let s = 13, P = laneLen(R + 16.3); s < P; s += 32) {
      lanePoint(R + 16.3, s, p);
      const nx = -Math.cos(p.yaw), nz = Math.sin(p.yaw); // outward
      banners.push({ x: p.x, y: 11.4, z: p.z, ry: Math.atan2(nx, nz), w: 4, h: 9.5 });
    }
    return { flags, banners };
  }, []);
  const strip = useMemo(() => {
    const t = stripTexture().clone();
    t.repeat.set(9, 1);
    t.needsUpdate = true;
    return clothMaterial(t, 'strip');
  }, []);
  const span = R - 1.5, mid = (R + 2.5) / 2;
  return (
    <group>
      <NearFlags items={flags} />
      <NearBanners items={banners} />
      {/* the gantry over the finish line, NEAR across it both ways */}
      {[2.5, R + 0.5].map((z) => (
        <mesh key={z} position={[0, 6.5, z]} castShadow><boxGeometry args={[1.2, 13, 1.2]} /><meshStandardMaterial color="#141414" roughness={0.6} /></mesh>
      ))}
      <mesh position={[0, 12.6, mid]} castShadow><boxGeometry args={[1.4, 0.9, span + 1]} /><meshStandardMaterial color="#141414" roughness={0.6} /></mesh>
      <mesh position={[0.08, 10.4, mid]} rotation-y={Math.PI / 2} material={strip}><planeGeometry args={[span, 3.4]} /></mesh>
      <mesh position={[-0.08, 10.4, mid]} rotation-y={-Math.PI / 2} material={strip}><planeGeometry args={[span, 3.4]} /></mesh>
      <mesh position={[0, 13.12, mid]}><boxGeometry args={[1.5, 0.12, span + 1]} /><meshBasicMaterial color={NEAR_GREEN} /></mesh>
    </group>
  );
}

/** The crowd: simple figures in house colours that jump while a race is on. */
function Crowd() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const spots = useMemo(seats, []);
  const geo = useMemo(() => merge([
    new THREE.CylinderGeometry(0.32, 0.4, 1.1, 6).translate(0, 0.55, 0),
    new THREE.SphereGeometry(0.26, 6, 4).translate(0, 1.36, 0),
  ]), []);
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const u = { time: { value: 0 }, cheer: { value: 0 } };
    m.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, u);
      s.vertexShader = 'uniform float time; uniform float cheer;\n' + s.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n float hid = float(gl_InstanceID);\n transformed.y += cheer * max(0., sin(time * (7. + mod(hid, 5.)) + hid * 1.7)) * 0.45;');
    };
    m.userData.u = u;
    return m;
  }, []);
  useEffect(() => {
    const m = ref.current!, o = new THREE.Object3D(), c = new THREE.Color();
    const cloth = ['#6d5a45', '#8a7a62', '#4e5a4a', '#7a4a3a', '#5a5f6a', '#9a8a6a'];
    spots.forEach(([x, y, z], i) => {
      o.position.set(x, y, z); o.rotation.y = Math.atan2(-x, -z); o.scale.setScalar(0.9 + ((i * 37) % 10) / 40); o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      // About half wear their house's colours, one in six came in NEAR green, the rest wear plain cloth.
      const h = HOUSES[(i * 7 + (i >> 4)) % 8];
      c.set(i % 6 === 3 ? NEAR_GREEN : i % 2 ? h.colors[0] : cloth[i % cloth.length]);
      m.setColorAt(i, c);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [spots]);
  useFrame(({ clock }, dt) => {
    const u = mat.userData.u;
    u.time.value = clock.elapsedTime;
    const target = live.race.phase === 'run' ? 1 : live.race.phase === 'done' ? 0.7 : 0.15;
    u.cheer.value += (target - u.cheer.value) * Math.min(1, dt * 2);
  });
  return <instancedMesh ref={ref} args={[geo, mat, spots.length]} castShadow={false} receiveShadow frustumCulled={false} />;
}

/** Split the horse into legs, tail and head once, and add the attributes the gallop shader reads. */
export function rigHorse(src: THREE.BufferGeometry) {
  const g = src.clone();
  const p = g.attributes.position;
  const n = p.count, leg = new Float32Array(n), w = new Float32Array(n), k = new Float32Array(n);
  const ss = (a: number, b: number, x: number) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  for (let i = 0; i < n; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (z < -0.8 && y < 0.32) { leg[i] = 5; w[i] = ss(0.3, 0.02, y); }
    else if (z > 0.08 && z < 0.5 && y < 0.02) { leg[i] = x > 0 ? 3 : 4; w[i] = ss(-0.02, -0.22, y); k[i] = ss(-0.42, -0.52, y); }
    else if (z > -0.8 && z < -0.42 && y < 0.06) { leg[i] = x > 0 ? 1 : 2; w[i] = ss(0.04, -0.2, y); k[i] = ss(-0.4, -0.52, y); }
    else if (z > 0.42 && y > -0.05) { leg[i] = 6; w[i] = ss(0.42, 0.62, z); }
  }
  g.setAttribute('aLeg', new THREE.BufferAttribute(leg, 1));
  g.setAttribute('aW', new THREE.BufferAttribute(w, 1));
  g.setAttribute('aK', new THREE.BufferAttribute(k, 1));
  return g;
}

const GALLOP = /* glsl */ `
attribute float aLeg; attribute float aW; attribute float aK; attribute float aCycle; attribute float aStride;
mat3 rx(float a) { float c = cos(a), s = sin(a); return mat3(1., 0., 0., 0., c, s, 0., -s, c); }
mat3 rz(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0., -s, c, 0., 0., 0., 1.); }
void gallop(inout vec3 p, inout vec3 n) {
  if (aLeg < 0.5) return;
  float TAU = 6.2831853, ph = TAU * aCycle;
  if (aLeg > 5.5) { // head and neck nod twice a stride
    vec3 pv = vec3(0., 0.22, 0.42);
    mat3 m = rx(0.09 * sin(ph * 2. + 1.2) * aStride * aW);
    p = pv + m * (p - pv); n = m * n; return;
  }
  if (aLeg > 4.5) { // the tail streams out behind and swishes
    vec3 pv = vec3(0., 0.3, -0.84);
    mat3 m = rz(0.18 * sin(ph * 0.5) * aStride * aW) * rx((0.55 + 0.12 * sin(ph)) * aStride * aW);
    p = pv + m * (p - pv); n = m * n; return;
  }
  bool fore = aLeg > 2.5;
  float off = aLeg < 1.5 ? 0. : aLeg < 2.5 ? 0.11 : aLeg < 3.5 ? 0.42 : 0.53;
  float q = TAU * (aCycle + off);
  vec3 hip = fore ? vec3(0., -0.08, 0.29) : vec3(0., -0.02, -0.64);
  vec3 knee = fore ? vec3(0., -0.47, 0.29) : vec3(0., -0.46, -0.66);
  float fold = max(0., -cos(q)); // the lower leg folds while it swings forward
  mat3 mk = rx((fore ? 1.25 : -0.85) * fold * aStride * aK);
  p = knee + mk * (p - knee); n = mk * n;
  mat3 mh = rx((fore ? 0.62 : 0.55) * sin(q) * aStride * aW);
  p = hip + mh * (p - hip); n = mh * n;
}
`;

export function horseDepth() {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (s) => {
    s.vertexShader = GALLOP + s.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = position; vec3 gn = vec3(0., 1., 0.); gallop(transformed, gn);');
  };
  return m;
}

export function horseMaterial(src: THREE.MeshStandardMaterial) {
  const m = src.clone();
  m.roughness = Math.max(0.55, m.roughness);
  m.metalness = 0;
  m.onBeforeCompile = (s) => {
    s.vertexShader = GALLOP + s.vertexShader
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n vec3 gp = position; gallop(gp, objectNormal);')
      .replace('#include <begin_vertex>', 'vec3 transformed = gp;');
  };
  return m;
}

/** The chariot modelled in Blender (design/blender/chariot.py): "wood" (wood, bronze, iron by vertex colour),
 * "paint" (pale, tinted with the house colour) and "wheel" (axle along x). Local frame faces +z, sized in metres. */
export function useChariotGeo() {
  const gltf = useGLTF('/env/props/chariot.glb');
  return useMemo(() => {
    const get = (name: string) => {
      let g: THREE.BufferGeometry | undefined;
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o.name === name || o.parent?.name === name)) g ??= (o as THREE.Mesh).geometry.clone().applyMatrix4(o.matrixWorld); });
      return g!.scale(M, M, M);
    };
    return { car: { wood: get('wood'), paint: get('paint') }, wheel: get('wheel') };
  }, [gltf]);
}
export const WHEEL_X = 0.95;
/** The chariot's materials: vertex colours with real wood grain and stone over them (see `surfaced`). `tint`
 * colours the paint for one house; teams leave it white and tint by instance colour. */
export function chariotMats(g: ReturnType<typeof useChariotGeo>, tint = '#ffffff') {
  const s = 1.4 / M, std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
  return {
    wood: surfaced(std({ roughness: 0.72 }), g.car.wood, s),
    paint: surfaced(std({ roughness: 0.5, side: THREE.DoubleSide, color: tint }), g.car.paint, s, 0.28),
    wheel: surfaced(std({ roughness: 0.75 }), g.wheel, s),
  };
}

const TEAM = 8;
const pt = { x: 0, z: 0, yaw: 0 };
const o = new THREE.Object3D();
const at = { r: 0, s: 0, roll: 0 };

/** Where a team's chariot is in the world this frame, and which way it faces (for the player's camera and body). */
export function runnerWorld(ru: Runner, out: { x: number; y: number; z: number; yaw: number }) {
  const d = drawAt(ru, { r: 0, s: 0, roll: 0 });
  lanePoint(d.r, d.s, pt);
  const c = Math.cos(HIPPODROME.rot), sn = Math.sin(HIPPODROME.rot);
  out.x = AX + pt.x * c + pt.z * sn; out.z = AZ - pt.x * sn + pt.z * c; out.y = ARENA_Y; out.yaw = pt.yaw + HIPPODROME.rot;
  return out;
}

function Teams() {
  const gltf = useGLTF('/env/horse.glb');
  const { horseGeo, horseMat, horseDepthMat } = useMemo(() => {
    let mesh: THREE.Mesh | undefined;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((ob) => { if ((ob as THREE.Mesh).isMesh && !mesh) mesh = ob as THREE.Mesh; });
    const g = mesh!.geometry.clone().applyMatrix4(mesh!.matrixWorld);
    return { horseGeo: rigHorse(g), horseMat: horseMaterial(mesh!.material as THREE.MeshStandardMaterial), horseDepthMat: horseDepth() };
  }, [gltf]);
  const cycle = useMemo(() => new THREE.InstancedBufferAttribute(new Float32Array(TEAM * 2), 1), []);
  const stride = useMemo(() => new THREE.InstancedBufferAttribute(new Float32Array(TEAM * 2), 1), []);
  useEffect(() => { horseGeo.setAttribute('aCycle', cycle); horseGeo.setAttribute('aStride', stride); }, [horseGeo, cycle, stride]);
  const { car, wheel } = useChariotGeo();
  const carMats = useMemo(() => chariotMats({ car, wheel }), [car, wheel]);
  const cloth = useMemo(() => new THREE.CylinderGeometry(0.3, 0.3, 0.75, 12, 1, true, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2), []); // a cloth over each horse's back

  const horses = useRef<THREE.InstancedMesh>(null), cloths = useRef<THREE.InstancedMesh>(null);
  const woods = useRef<THREE.InstancedMesh>(null), paints = useRef<THREE.InstancedMesh>(null), wheels = useRef<THREE.InstancedMesh>(null);

  // Each house's lord drives their own chariot.
  // One call per lord (a fixed eight), so each shares the cache with the lord walking at their seat.
  const lords = HOUSES.map((h) => useGLTF(`/models/${h.lord}.glb`)) as unknown as { scene: THREE.Object3D; animations: THREE.AnimationClip[] }[]; // eslint-disable-line react-hooks/rules-of-hooks
  const drivers = useMemo(() => lords.map((g) => {
    const ob = cloneSkinned(g.scene);
    ob.scale.setScalar(2.1);
    ob.traverse((x) => { if ((x as THREE.Mesh).isMesh) { x.castShadow = true; x.frustumCulled = false; } });
    const mixer = new THREE.AnimationMixer(ob);
    const clip = g.animations[0];
    if (clip) { const a = mixer.clipAction(clip); a.play(); a.time = clip.duration * 0.25; mixer.update(0); }
    return { ob, mixer };
  }), [lords[0], lords[7]]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = new THREE.Color();
    HOUSES.forEach((h, i) => {
      c.set(h.colors[0]);
      paints.current!.setColorAt(i, c);
      for (const j of [0, 1]) cloths.current!.setColorAt(i * 2 + j, c.set(h.colors[i % 2 ? 0 : 1]));
      // dark or light horses for some houses, the bay coat for the rest
      const coat = ['#ffffff', '#ffffff', '#6e5a50', '#ffffff', '#c8c0b8', '#5a4a44', '#ffffff', '#8a7464'][i];
      for (const j of [0, 1]) horses.current!.setColorAt(i * 2 + j, c.set(coat));
    });
    for (const m of [paints, cloths, horses]) if (m.current!.instanceColor) m.current!.instanceColor.needsUpdate = true;
  }, []);

  const gait = useRef(new Float32Array(TEAM));
  useFrame((_, dt) => {
    advance(dt);
    const r = live.race;
    for (const ru of r.runners) {
      const i = ru.house;
      const { r: lr, s, roll } = drawAt(ru, at); // lane radius and distance along it from the line, between ticks
      const speed = ru.v * MID;
      const parade = r.phase === 'parade';
      gait.current[i] += dt * (parade ? 0 : Math.min(2.5, 0.4 + speed / 12));
      const strideAmt = parade ? 0 : THREE.MathUtils.clamp(speed / 20, 0, 1);
      const bob = Math.abs(Math.sin(gait.current[i] * Math.PI * 2)) * 0.18 * M * strideAmt;
      // Horses, side by side, ahead of the chariot.
      lanePoint(lr, s + 4.1 * M, pt);
      const hx = pt.x, hz = pt.z, hyaw = pt.yaw;
      for (const j of [0, 1]) {
        const side = (j ? 0.5 : -0.5) * M;
        o.position.set(hx + Math.cos(hyaw) * side, 0.836 * HORSE_SCALE + bob, hz - Math.sin(hyaw) * side);
        o.rotation.set(Math.sin(gait.current[i] * Math.PI * 2) * 0.04 * strideAmt, hyaw, 0);
        o.scale.setScalar(HORSE_SCALE);
        o.updateMatrix();
        horses.current!.setMatrixAt(i * 2 + j, o.matrix);
        cycle.setX(i * 2 + j, gait.current[i] + j * 0.06);
        stride.setX(i * 2 + j, strideAmt);
        // the house cloth over the back
        o.position.y += 0.06 * M;
        o.translateZ(-0.12);
        o.updateMatrix();
        cloths.current!.setMatrixAt(i * 2 + j, o.matrix);
      }
      // Each horse is solid: you can't walk through a team, standing or galloping.
      for (const j of [0, 1]) { const side = (j ? 0.5 : -0.5) * M; teamBeasts.push({ x: hx + Math.cos(hyaw) * side, z: hz - Math.sin(hyaw) * side, r: 0.55 * M }); }
      teamBeasts.push({ x: hx - Math.sin(hyaw) * 1.6 * M, z: hz - Math.cos(hyaw) * 1.6 * M, r: 0.6 * M }); // the horses' haunches
      // The chariot.
      lanePoint(lr, s, pt);
      teamBeasts.push({ x: pt.x, z: pt.z, r: 1.0 * M });
      o.position.set(pt.x, 0, pt.z); o.rotation.set(0, pt.yaw, 0); o.scale.setScalar(1);
      o.updateMatrix();
      woods.current!.setMatrixAt(i, o.matrix);
      paints.current!.setMatrixAt(i, o.matrix);
      const d = drivers[i];
      d.ob.position.set(pt.x, 0.85 * M + bob * 0.3, pt.z); d.ob.rotation.y = pt.yaw;
      d.ob.visible = r.driver !== i; // when you drive, you stand in the chariot instead of the lord
      for (const j of [0, 1]) {
        const side = (j ? WHEEL_X : -WHEEL_X) * M;
        o.position.set(pt.x + Math.cos(pt.yaw) * side, 0.75 * M, pt.z - Math.sin(pt.yaw) * side);
        o.rotation.set(roll / (0.75 * M), pt.yaw, 0, 'YXZ');
        o.updateMatrix();
        wheels.current!.setMatrixAt(i * 2 + j, o.matrix);
      }
    }
    for (const m of [horses, cloths, woods, paints, wheels]) m.current!.instanceMatrix.needsUpdate = true;
    setBeasts('race', teamBeasts.splice(0));
    cycle.needsUpdate = true;
    stride.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={horses} args={[horseGeo, horseMat, TEAM * 2]} customDepthMaterial={horseDepthMat} castShadow frustumCulled={false} />
      <instancedMesh ref={cloths} args={[cloth, undefined, TEAM * 2]} castShadow frustumCulled={false}><meshStandardMaterial roughness={0.85} side={THREE.DoubleSide} /></instancedMesh>
      <instancedMesh ref={woods} args={[car.wood, carMats.wood, TEAM]} castShadow frustumCulled={false} />
      <instancedMesh ref={paints} args={[car.paint, carMats.paint, TEAM]} castShadow frustumCulled={false} />
      <instancedMesh ref={wheels} args={[wheel, carMats.wheel, TEAM * 2]} castShadow frustumCulled={false} />
      {drivers.map((d, i) => <primitive key={i} object={d.ob} />)}
    </group>
  );
}

/** "Watch the race": a broadcast camera that cuts between a chase shot on the leader and a wide shot from the stands. */
function RaceCamera() {
  const controls = useThree((s) => s.controls) as unknown as (THREE.EventDispatcher & { target: THREE.Vector3; addEventListener: (e: string, f: () => void) => void; removeEventListener: (e: string, f: () => void) => void }) | null;
  const group = useRef<THREE.Group>(null);
  useEffect(() => {
    if (!controls) return;
    const stop = () => { if (live.watch) setWatch(false); };
    controls.addEventListener('start', stop);
    return () => controls.removeEventListener('start', stop);
  }, [controls]);
  const goal = useMemo(() => ({ cam: new THREE.Vector3(), look: new THREE.Vector3(), lookNow: new THREE.Vector3(), t: 0, snapped: false, shot: '', subject: 0 }), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }, dt) => {
    const g = group.current;
    if (!live.watch || !g) { goal.snapped = false; return; }
    const r = live.race;
    goal.t += dt;
    const shot = r.phase === 'parade' ? 'wide' : `${Math.floor(goal.t / 8) % 2 ? 'stand' : 'chase'}${Math.floor(goal.t / 8)}`;
    // A new shot is a clean cut, and it keeps the team that led when it started: no swinging between lanes mid-shot.
    if (shot !== goal.shot) { goal.shot = shot; goal.subject = standings(r)[0].house; goal.snapped = false; }
    const lead = r.runners[goal.subject];
    const da = drawAt(lead, at);
    lanePoint(da.r, da.s + 2, pt);
    const lx = pt.x, lz = pt.z, yaw = pt.yaw;
    if (shot.startsWith('chase')) {
      goal.cam.set(lx - Math.sin(yaw) * 26 - Math.cos(yaw) * 12, 13, lz - Math.cos(yaw) * 26 + Math.sin(yaw) * 12);
      goal.look.set(lx + Math.sin(yaw) * 10, 2.5, lz + Math.cos(yaw) * 10);
    } else if (shot.startsWith('stand')) {
      goal.cam.set(lx * 0.6, 24, R + 13);
      goal.look.set(lx, 1.5, lz);
    } else {
      goal.cam.set(-34, 26, R + 12);
      goal.look.set(0, 2, R * 0.55);
    }
    // goal is in arena space: move it to the world.
    g.updateMatrixWorld();
    const camW = v.copy(goal.cam).applyMatrix4(g.matrixWorld);
    const lookW = goal.look.clone().applyMatrix4(g.matrixWorld);
    const k = goal.snapped ? 1 - Math.exp(-dt * 2.2) : 1;
    goal.snapped = true;
    camera.position.lerp(camW, k);
    goal.lookNow.lerp(lookW, k === 1 ? 1 : 1 - Math.exp(-dt * 4));
    controls?.target.copy(goal.lookNow);
    camera.lookAt(goal.lookNow);
  });
  return <group ref={group} />;
}

useGLTF.preload('/env/horse.glb');
