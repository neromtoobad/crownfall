// Castles, towns, the capital, the Hippodrome and the landmarks. Built from simple solids and merged per material,
// so the whole realm is a few dozen draw calls. Generated models replace the hero pieces later.
import { THRONE, Throne } from './Throne.tsx';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ground } from './heights.ts';
import { Props, type Place } from './Props.tsx';
import { ROOKERY } from './Market.tsx';
import { triplanar } from './materials.ts';
import { useTexture } from '@react-three/drei';
import AVG from './texAvg.json';
import { bridgeGeometry } from './bridges.ts';
import { NearBanners, NearFlags, type Cloth } from './NearCloth.tsx';
import { coinTexture } from './near.ts';
import { addBox, addCircle } from './collide.ts';
import { CAPITAL, HOUSES, LANDMARKS, yardOf, nearRoad, type House } from './layout.ts';

type G = THREE.BufferGeometry;
/** Where each generated model goes; filled while the procedural geometry is built. */
interface Kit { cottage: Place[]; townhouse: Place[]; wall: Place[]; tower: Place[]; keep: Place[]; hall: Place[] }
const box = (w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) =>
  new THREE.BoxGeometry(w, h, d).rotateY(ry).translate(x, y + h / 2, z);
const cyl = (r: number, h: number, x: number, y: number, z: number, seg = 10) => new THREE.CylinderGeometry(r, r * 1.05, h, seg).translate(x, y + h / 2, z);
const cone = (r: number, h: number, x: number, y: number, z: number, seg = 10) => new THREE.ConeGeometry(r, h, seg).translate(x, y + h / 2, z);
const roof = (w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) => {
  const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
  return new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2).rotateY(ry).translate(x, y, z);
};
const merge = (list: G[]) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => { g.deleteAttribute('uv'); return g; }))!;

/** A ring of wall with towers at the corners and a gate. */
function walls(cx: number, cz: number, y: number, r: number, sides: number, wallH: number, stone: G[], kit: Kit) {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    const x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r, x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
    const len = Math.hypot(x1 - x0, z1 - z0), ang = -Math.atan2(z1 - z0, x1 - x0);
    // A gate wherever a road passes through this stretch of wall.
    let gateT = -1;
    for (let t = 0.12; t <= 0.88; t += 0.04) if (nearRoad(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, 5)) { gateT = t; break; }
    const piece = (t0: number, t1: number) => {
      const l = len * (t1 - t0), t = (t0 + t1) / 2;
      if (l > 1.5) kit.wall.push({ x: x0 + (x1 - x0) * t, y, z: z0 + (z1 - z0) * t, ry: ang, sx: l + 1, sy: wallH + 1.6, sz: 3.2 });
    };
    if (gateT < 0) piece(0, 1);
    else {
      const half = (r > 60 ? 8.5 : 6) / len; // a 17-unit opening in a city wall (room for a chariot), 12 in a castle's
      const g0 = Math.max(0, gateT - half), g1 = Math.min(1, gateT + half);
      piece(0, g0);
      piece(g1, 1);
      const gx = x0 + (x1 - x0) * gateT, gz = z0 + (z1 - z0) * gateT;
      stone.push(box(len * (g1 - g0) + 1, wallH * 0.3, 3.4, gx, y + wallH * 0.75, gz, ang)); // the arch over the gate
      for (const e of [g0, g1]) kit.tower.push({ x: x0 + (x1 - x0) * e, y: y - 0.5, z: z0 + (z1 - z0) * e, ry: a0, sx: 6, sy: wallH + 6, sz: 6 }); // gatehouse towers
    }
    const tr = r > 60 ? 5 : 3.6;
    if (!nearRoad(x0, z0, tr + 4)) kit.tower.push({ x: x0, y: y - 0.5, z: z0, ry: a0, sx: tr * 2, sy: wallH + 9 + tr * 2, sz: tr * 2 });
  }
}

function castle(h: House, stone: G[], kit: Kit, poles: { x: number; y: number; z: number; h: House }[]) {
  const [cx, cz] = h.pos;
  const y = ground(cx, cz) - 0.5;
  walls(cx, cz, y, 30, 8, 9, stone, kit);
  // The keep faces the capital.
  const face = Math.atan2(-cx, -cz);
  kit.keep.push({ x: cx, y, z: cz, ry: face, sx: 30, sy: 37, sz: 30 });
  poles.push({ x: cx, y: y + 35, z: cz, h }); // on the keep's roof
}

function town(cx: number, cz: number, rMin: number, rMax: number, n: number, seed: number, kit: Kit, yard?: [number, number], avoid: number[][] = []) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, r = rMin + Math.sqrt(rnd()) * (rMax - rMin);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const g = ground(x, z);
    if (g < 2.4) continue; // dry land only
    if (yard && Math.hypot(x - yard[0], z - yard[1]) < 19) continue;
    if (avoid.some(([ax, az, ar]) => Math.hypot(x - ax, z - az) < ar)) continue;
    if (nearRoad(x, z, 9)) continue; // keep the roads open: travellers walk them
    const s = 3.6 + rnd() * 1.4, ry = a + Math.PI / 2 + (rnd() - 0.5) * 0.5;
    if (rnd() < 0.55) kit.cottage.push({ x, y: g - 0.4, z, ry, sx: s * 1.9, sy: s * 1.7, sz: s * 1.47 });
    else kit.townhouse.push({ x, y: g - 0.4, z, ry, sx: s * 1.6, sy: s * 1.75, sz: s * 1.55 });
  }
}

/** The Warwick Mint: a stone counting-house with pilasters, a slate hip roof, furnace chimneys, a gilded cupola and a portico. */
function mint(stone: G[], slate: G[], gold: G[], dark: G[]) {
  const [x, z] = LANDMARKS[4].pos, y = ground(x, z) - 0.4;
  const at = (g: G) => g.rotateY(MINT_RY).translate(x, y, z);
  stone.push(at(box(29, 1.4, 19, 0, 0, 0)), at(box(26, 11, 16, 0, 1.4, 0)), at(box(27, 1, 17, 0, 12.4, 0)));
  for (let i = 0; i < 7; i++) {
    const px = -12 + i * 4;
    for (const pz of [-8.2, 8.2]) stone.push(at(box(1.1, 11, 0.6, px, 1.4, pz)));
    if (i < 6) for (const pz of [-8.05, 8.05]) dark.push(at(box(1.7, 3.6, 0.4, px + 2, 5.4, pz)));
  }
  slate.push(at(new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4).scale(27.5 / Math.SQRT2, 7, 17.5 / Math.SQRT2).translate(0, 16.9, 0)));
  for (const cx of [-10, 10]) { stone.push(at(cyl(1.3, 20, cx, 1.4, -4.5, 8))); gold.push(at(cyl(1.6, 0.8, cx, 21.4, -4.5, 8))); }
  gold.push(at(cyl(2, 3, 0, 19.5, 0, 10)), at(cone(2.6, 3.4, 0, 22.5, 0, 10)));
  // The portico: four columns, an entablature and a pediment over the door.
  for (const cx of [-4.5, -1.5, 1.5, 4.5]) stone.push(at(cyl(0.6, 9, cx, 1.4, 11.5, 10)));
  stone.push(at(box(11, 1.4, 4, 0, 10.4, 10.5)));
  stone.push(at(roof(11.5, 3, 4.4, 0, 11.8, 10.5, 0)));
  dark.push(at(box(3, 5.5, 0.4, 0, 1.4, 8.05)));
}
export const MINT_RY = 0.2;

/** The great coin outside the Mint: it turns slowly, a crown struck on both faces. */
function MintCoin() {
  const ref = useRef<THREE.Group>(null);
  const [x, z] = LANDMARKS[4].pos;
  const geo = useMemo(() => merge([new THREE.CylinderGeometry(3.4, 3.4, 0.5, 40).rotateX(Math.PI / 2), new THREE.TorusGeometry(3.4, 0.28, 8, 40)]), []);
  const face = useMemo(() => new THREE.CircleGeometry(3.25, 48), []);
  const faceMat = useMemo(() => new THREE.MeshStandardMaterial({ map: coinTexture(), metalness: 0.75, roughness: 0.32 }), []);
  useFrame((_, dt) => { if (ref.current) ref.current.rotation.y += dt * 0.4; });
  const p = new THREE.Vector3(0, 0, 18).applyAxisAngle(new THREE.Vector3(0, 1, 0), MINT_RY);
  const y = ground(x, z) - 0.4;
  return (
    <group position={[x + p.x, y, z + p.z]}>
      <mesh position={[0, 1, 0]} castShadow receiveShadow><boxGeometry args={[4.5, 2, 4.5]} /><meshStandardMaterial color="#b9ab94" roughness={0.9} /></mesh>
      <group ref={ref} position={[0, 5.6, 0]}>
        <mesh geometry={geo} castShadow><meshStandardMaterial color="#d2a845" metalness={0.85} roughness={0.28} /></mesh>
        <mesh geometry={face} material={faceMat} position-z={0.26} />
        <mesh geometry={face} material={faceMat} position-z={-0.26} rotation-y={Math.PI} />
      </group>
    </group>
  );
}

/** Qureshi's Library: a domed rotunda inside a ring of columns. */
function library(stone: G[], dome: G[]) {
  const [x, z] = LANDMARKS[5].pos, y = ground(x, z) - 0.4;
  stone.push(cyl(13.5, 1.4, x, y, z, 32)); // the steps
  stone.push(cyl(9, 13, x, y + 1.4, z, 24)); // the drum
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    stone.push(cyl(0.65, 10, x + Math.cos(a) * 12, y + 1.4, z + Math.sin(a) * 12, 8));
  }
  stone.push(new THREE.CylinderGeometry(13, 13, 1.4, 32, 1, true).translate(x, y + 12.1, z)); // the ring over the columns
  stone.push(new THREE.RingGeometry(9, 13, 32).rotateX(-Math.PI / 2).translate(x, y + 12.8, z));
  dome.push(new THREE.SphereGeometry(9.4, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, y + 14.4, z));
  dome.push(cyl(1.4, 3, x, y + 23.4, z, 10), cone(1.8, 2.6, x, y + 26.4, z, 10));
}

/** Where smoke rises: the ridge of one house in five (x, y, z, size). A few are big (forges, bakehouses) so a
 * town shows on the skyline before you can see it. Filled when the buildings are laid out. */
export const CHIMNEYS: [number, number, number, number][] = [];

export function Buildings({ fallen = [] as number[] }) {
  const { stone, roofs, gold, dome, slate, dark, poles, kit, nearFlags, nearBanners } = useMemo(() => {
    const stone: G[] = [], roofs: G[] = [], gold: G[] = [], dome: G[] = [], slate: G[] = [], dark: G[] = [];
    const kit: Kit = { cottage: [], townhouse: [], wall: [], tower: [], keep: [], hall: [] };
    const poles: { x: number; y: number; z: number; h: House }[] = [];
    for (const h of HOUSES) {
      castle(h, stone, kit, poles);
      town(h.pos[0], h.pos[1] + 8, 38, 72, 46, 100 + h.id * 7, kit, yardOf(h));
    }
    // Emberfall: walls on both banks, the throne hall, the town.
    const [cx, cz] = CAPITAL.pos;
    const y = ground(cx + 30, cz) - 0.4;
    walls(cx + 20, cz, y, 100, 16, 12, stone, kit);
    kit.hall.push({ x: cx + 35, y, z: cz - 40, ry: 0, sx: 66, sy: 47, sz: 23 }); // the Ashen Throne's hall
    town(cx + 20, cz + 10, 22, 92, 300, 5, kit, undefined, [[...LANDMARKS[4].pos, 36], [...LANDMARKS[5].pos, 19], [...ROOKERY, 13], [THRONE.x, THRONE.z + 2, 15]]);
    stone.push(...bridgeGeometry()); // the Lazzarin Bridge and every other river crossing
    // NEAR colours over Emberfall: a flag on every tower of the city wall, a banner down every stretch of it,
    // and two great banners on the throne hall.
    const ring = (p: Place) => Math.abs(Math.hypot(p.x - (cx + 20), p.z - cz) - 100) < 9;
    const nearFlags: Cloth[] = kit.tower.filter(ring).map((p) => ({ x: p.x, y: p.y + p.sy - 0.5, z: p.z, ry: 0, w: 7, h: 4.4 }));
    const nearBanners: Cloth[] = kit.wall.filter((p) => ring(p) && p.sx > 14).map((p) => {
      const nx = p.x - (cx + 20), nz = p.z - cz, d = Math.hypot(nx, nz);
      return { x: p.x + (nx / d) * (p.sz / 2 + 0.25), y: p.y + p.sy - 1.4, z: p.z + (nz / d) * (p.sz / 2 + 0.25), ry: Math.atan2(nx, nz), w: 4.6, h: 11 };
    });
    for (const dx of [-22, 22]) nearBanners.push({ x: cx + 35 + dx, y: y + 34, z: cz - 40 + 12.3, ry: 0, w: 6.5, h: 18 });
    mint(stone, slate, gold, dark);
    library(stone, dome);
    // Garg's Lighthouse.
    const [lx, lz] = LANDMARKS[3].pos;
    stone.push(cyl(3.2, 26, lx, ground(lx, lz) - 0.5, lz, 12));
    roofs.push(cone(4, 5, lx, ground(lx, lz) + 28, lz, 12));
    CHIMNEYS.length = 0;
    [...kit.cottage, ...kit.townhouse].forEach((p, i) => {
      if (i % 5 !== 2) return;
      CHIMNEYS.push([p.x + Math.sin(p.ry) * p.sz * 0.12, p.y + p.sy * 0.9, p.z + Math.cos(p.ry) * p.sz * 0.12, i % 45 === 2 ? 2.6 : 1]);
    });
    // Everything a walker or a chariot can't go through.
    for (const list of [kit.cottage, kit.townhouse, kit.wall, kit.keep, kit.hall]) for (const p of list) addBox(p.x, p.z, p.sx * 0.92, p.sz * 0.92, p.ry);
    for (const p of kit.tower) addCircle(p.x, p.z, p.sx * 0.46);
    {
      const [mx, mz] = LANDMARKS[4].pos, c = Math.cos(MINT_RY), sn = Math.sin(MINT_RY);
      addBox(mx, mz, 29, 19, MINT_RY);
      addBox(mx + 10.5 * sn, mz + 10.5 * c, 12, 4.5, MINT_RY); // the portico
      addCircle(mx + 18 * sn, mz + 18 * c, 2.6); // the coin's plinth
      addCircle(...LANDMARKS[5].pos, 13.6);
      addCircle(...LANDMARKS[3].pos, 3.6);
      addCircle(THRONE.x, THRONE.z, THRONE.r); // the Ashen Throne's dais
    }
    return { stone: merge(stone), roofs: merge(roofs), gold: merge(gold), dome: merge(dome), slate: merge(slate), dark: merge(dark), poles, kit, nearFlags, nearBanners };
  }, []);

  const rock = useTexture('/tex/rock.jpg');
  const mats = useMemo(() => {
    rock.wrapS = rock.wrapT = THREE.MirroredRepeatWrapping; rock.colorSpace = THREE.SRGBColorSpace; rock.needsUpdate = true;
    const stoneM = triplanar(rock, (AVG as Record<string, number[]>).rock, 0.12, '#b3a792', true);
    stoneM.vertexColors = false;
    return { stone: stoneM };
  }, [rock]);
  return (
    <group>
      <mesh geometry={stone} material={mats.stone} castShadow receiveShadow />
      <mesh geometry={roofs} castShadow receiveShadow><meshStandardMaterial color="#6b3a2c" roughness={0.85} flatShading /></mesh>
      <Props name="cottage" items={kit.cottage} />
      <Props name="townhouse" items={kit.townhouse} />
      <Props name="wall" items={kit.wall} />
      <Props name="tower" items={kit.tower} />
      <Props name="keep" items={kit.keep} />
      <Props name="throne-hall" items={kit.hall} />
      <Throne />
      <mesh geometry={gold} castShadow><meshStandardMaterial color="#c9a24a" metalness={0.75} roughness={0.32} /></mesh>
      <mesh geometry={slate} castShadow receiveShadow><meshStandardMaterial color="#4a4d55" roughness={0.75} flatShading /></mesh>
      <mesh geometry={dark}><meshStandardMaterial color="#2a221c" roughness={0.9} /></mesh>
      <MintCoin />
      <NearFlags items={nearFlags} />
      <NearBanners items={nearBanners} />
      <mesh geometry={dome} castShadow receiveShadow><meshStandardMaterial color="#5f8a7a" metalness={0.35} roughness={0.55} /></mesh>
      {poles.map((p) => <Banner key={p.h.id} {...p} down={fallen.includes(p.h.id)} />)}
      <Beacon />
    </group>
  );
}

/** A house banner on its keep, waving. */
function Banner({ x, y, z, h, down }: { x: number; y: number; z: number; h: House; down: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => new THREE.PlaneGeometry(7, 4.2, 12, 4).translate(3.5, -2.1, 0), []);
  const base = useMemo(() => Float32Array.from(geo.attributes.position.array), [geo]);
  useFrame(({ clock }) => {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const t = clock.elapsedTime;
    for (let i = 0; i < pos.count; i++) {
      const bx = base[i * 3];
      pos.setZ(i, Math.sin(bx * 0.9 - t * 4 + h.id) * bx * 0.12);
    }
    pos.needsUpdate = true;
  });
  if (down) return null;
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, -3, 0]}><cylinderGeometry args={[0.15, 0.15, 7, 5]} /><meshStandardMaterial color="#3b2f25" /></mesh>
      <mesh ref={ref} geometry={geo} position={[0.1, 0, 0]} castShadow>
        <meshStandardMaterial color={h.colors[0]} side={THREE.DoubleSide} roughness={0.8} />
      </mesh>
      <mesh position={[3.5, -2.1, 0.05]}><planeGeometry args={[2.2, 2.2]} /><meshStandardMaterial color={h.colors[1]} side={THREE.DoubleSide} /></mesh>
    </group>
  );
}

/** The light at the top of Garg's Lighthouse. */
function Beacon() {
  const ref = useRef<THREE.PointLight>(null);
  const [lx, lz] = LANDMARKS[3].pos;
  useFrame(({ clock }) => { if (ref.current) ref.current.intensity = 1800 + Math.sin(clock.elapsedTime * 2) * 600; });
  return (
    <group position={[lx, ground(lx, lz) + 27, lz]}>
      <pointLight ref={ref} color="#ffcf7a" distance={160} decay={2} />
      <mesh><sphereGeometry args={[1.6, 12, 8]} /><meshBasicMaterial color="#ffe2a0" /></mesh>
    </group>
  );
}
