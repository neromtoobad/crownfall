// Trees: pines in the north and on the hills, broadleaf in the south. Two instanced meshes, a few thousand trees.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { me, play } from './play.ts';
import { useTexture } from '@react-three/drei';
import AVG from './texAvg.json';
import { triplanar } from './materials.ts';
import { swaying } from './wind.ts';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { landness, noise, riverDist, sampleH } from './heights.ts';
import { addCircle } from './collide.ts';
import { CAPITAL, HIPPODROME, HOUSES, nearRoad } from './layout.ts';

function tinted(g: THREE.BufferGeometry, hex: string, shade = 0) {
  // Vertex colour, darker toward the bottom of each part by `shade`, so crowns read as volume.
  g = g.index ? g.toNonIndexed() : g;
  g.computeBoundingBox();
  const { min, max } = g.boundingBox!;
  const c = new THREE.Color(hex), pos = g.attributes.position;
  const a = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - min.y) / Math.max(0.001, max.y - min.y);
    const k = 1 - shade * (1 - t);
    a[i * 3] = c.r * k; a[i * 3 + 1] = c.g * k; a[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

/** Push every vertex in or out along its direction from `centre` by smooth noise: lumpy, leafy outlines. */
function lumpy(g: THREE.BufferGeometry, amp: number, freq: number, seed: number) {
  const pos = g.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3();
  g.computeBoundingBox(); g.boundingBox!.getCenter(c);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const d = v.clone().sub(c);
    const n = noise(v.x * freq + seed, v.z * freq + v.y * freq * 0.7 - seed);
    d.multiplyScalar(1 + n * amp);
    pos.setXYZ(i, c.x + d.x, c.y + d.y, c.z + d.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Ragged pine tier: a cone whose bottom rim is pulled down and in and out at random, like drooping branches. */
function tier(r: number, h: number, y: number, seed: number) {
  const g = new THREE.ConeGeometry(r, h, 11, 2, true).translate(0, y, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const py = pos.getY(i);
    if (py < y - h / 2 + 0.01) {
      const a = Math.atan2(pos.getZ(i), pos.getX(i));
      const j = Math.sin(a * 11 + seed) * 0.5 + 0.5;
      pos.setY(i, py - j * 0.9);
      pos.setX(i, pos.getX(i) * (0.85 + j * 0.3));
      pos.setZ(i, pos.getZ(i) * (0.85 + j * 0.3));
    }
  }
  g.computeVertexNormals();
  return g;
}

const trunk = (r = 0.35, h = 3) => tinted(new THREE.CylinderGeometry(r * 0.7, r, h, 7).translate(0, h / 2, 0), '#ffffff');

/** Two groups per tree: 0 = trunk (bark), 1 = crown (leaves). */
function grouped(trunkG: THREE.BufferGeometry, crown: THREE.BufferGeometry[]) {
  return mergeGeometries([trunkG, mergeGeometries(crown)!], true)!;
}
const pineGeo = () =>
  grouped(trunk(0.32, 3.4), [
    tinted(tier(2.9, 4.6, 4.1, 1), '#2c4a31', 0.45),
    tinted(tier(2.3, 4.0, 6.3, 2), '#31523a', 0.4),
    tinted(tier(1.6, 3.4, 8.3, 3), '#386040', 0.35),
    tinted(tier(0.9, 2.4, 10.0, 4), '#3f6a46', 0.25),
  ]);
/** The oak's crown as lumps (centre, radius, vertical squash): a dark core each, and leaf cards over them. */
const OAK_LUMPS: [number, number, number, number, number][] = [
  [0, 5.4, 0, 2.7, 0.8], [1.6, 6.3, 0.7, 1.9, 1], [-1.5, 6.0, -0.9, 1.8, 1], [0.2, 7.2, -1.2, 1.5, 1], [-0.6, 4.6, 1.7, 1.4, 1],
];

/** A sprig of leaves on a transparent ground, drawn once: dense in the middle, ragged at the edge. */
function leafAtlas() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 170; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 100, x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d * 0.9;
    const len = 14 + rnd() * 12, w = len * (0.38 + rnd() * 0.12), rot = a + (rnd() - 0.5) * 1.2;
    const l = 30 + rnd() * 18 - d * 0.06, h = 78 + rnd() * 26, sat = 32 + rnd() * 22;
    g.save(); g.translate(x, y); g.rotate(rot);
    g.fillStyle = `hsl(${h}, ${sat}%, ${l}%)`;
    g.beginPath(); g.ellipse(0, 0, len / 2, w / 2, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = `hsla(${h}, ${sat}%, ${l + 14}%, 0.6)`; g.lineWidth = 1; g.beginPath(); g.moveTo(-len / 2, 0); g.lineTo(len / 2, 0); g.stroke();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** Leaf cards scattered over each lump, facing out with a random twist, normals pointing out of the crown so the
 * whole tree lights as one soft volume. Darker low and inside, each card a slightly different green. */
function leafCards(lumps: typeof OAK_LUMPS) {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  let seed = 5;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const top = Math.max(...lumps.map((l) => l[1] + l[3])), bottom = Math.min(...lumps.map((l) => l[1] - l[3]));
  const n = new THREE.Vector3(), t = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const [cx, cy, cz, r, sq] of lumps) {
    const count = Math.round(r * r * 5.5);
    for (let i = 0; i < count; i++) {
      // Fibonacci points over the lump, jittered.
      const y = 1 - ((i + 0.5) / count) * 2, rad = Math.sqrt(1 - y * y), ph = i * 2.39996 + rnd() * 0.5;
      n.set(Math.cos(ph) * rad, y * sq, Math.sin(ph) * rad).normalize();
      c.set(cx, cy, cz).addScaledVector(n, r * (0.7 + rnd() * 0.25));
      t.crossVectors(Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : up, n).normalize();
      b.crossVectors(n, t);
      const twist = rnd() * Math.PI * 2, s = r * (0.85 + rnd() * 0.35);
      const tx = t.clone().multiplyScalar(Math.cos(twist)).addScaledVector(b, Math.sin(twist)), bx = n.clone().cross(tx);
      // Tilt the card part-way toward the side view, so it reads from the ground too.
      tx.addScaledVector(n, (rnd() - 0.5) * 0.8).normalize();
      const base = pos.length / 3;
      const k = 0.55 + 0.45 * ((c.y - bottom) / (top - bottom)) * (0.75 + 0.25 * Math.max(0, n.y)), tint = 0.9 + rnd() * 0.2;
      const outN = n.clone().lerp(up, 0.25).normalize();
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        pos.push(c.x + (tx.x * u + bx.x * v) * s * 0.5, c.y + (tx.y * u + bx.y * v) * s * 0.5, c.z + (tx.z * u + bx.z * v) * s * 0.5);
        nor.push(outN.x, outN.y, outN.z);
        uv.push((u + 1) / 2, (v + 1) / 2);
        col.push(k * tint, k * tint, k * tint * 0.95);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g.toNonIndexed();
}

/** Groups: 0 trunk, 1 a dark low-poly core (the crown's silhouette), and near trees only, 2 the leaf cards.
 * Far oaks are the same tree minus the cards, with a fuller core (they sit in the haze). */
const oakGeo = (near: boolean) => {
  const core = OAK_LUMPS.map(([x, y, z, r, sq], i) =>
    tinted(lumpy(new THREE.IcosahedronGeometry(r * (near ? 0.78 : 0.95), near ? 0 : 1).scale(1, sq, 1).translate(x, y, z), 0.18, 1, i + 1), near ? '#3f5a2a' : '#58753a', 0.5));
  const t = trunk(0.45, 4);
  // mergeGeometries needs the same attributes everywhere: give the trunk and core a dummy uv.
  for (const g of [t, ...core]) if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  const coreG = mergeGeometries(core)!;
  return mergeGeometries(near ? [t, coreG, leafCards(OAK_LUMPS)] : [t, coreG], true)!;
};
/** Oaks within this distance of you get leaf cards; the rest are cores. Re-sorted every NEAR_STEP you move. */
const NEAR_R = 170, NEAR_STEP = 30;

/** Places trees must stay away from. */
const CLEAR: { x: number; z: number; r: number }[] = [
  ...HOUSES.map((h) => ({ x: h.pos[0], z: h.pos[1], r: 95 })),
  { x: CAPITAL.pos[0], z: CAPITAL.pos[1], r: 150 },
  { x: HIPPODROME.pos[0], z: HIPPODROME.pos[1], r: 160 },
];

export function Forest() {
  const pine = useRef<THREE.InstancedMesh>(null);
  const oak = useRef<THREE.InstancedMesh>(null);
  const spots = useMemo(() => {
    const p: [number, number, number, number][] = [], o: [number, number, number, number][] = [];
    let seed = 1;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let k = 0; k < 60000 && p.length + o.length < 9000; k++) {
      const x = (rnd() - 0.5) * 1700, z = (rnd() - 0.5) * 1700;
      const h = sampleH(x, z);
      if (h < 3 || h > 150 || landness(x, z) < 0.99) continue;
      const north = z < -120 || (x < -250 && z < 40);
      const dense = noise(x / 160, z / 160) + (x < -300 && z < -100 ? 0.55 : 0) + (z < -250 ? 0.2 : 0);
      if (dense < 0.25) continue;
      if (CLEAR.some((c) => Math.hypot(x - c.x, z - c.z) < c.r)) continue;
      if (riverDist(x, z) < 26) continue;
      if (nearRoad(x, z, 10)) continue;
      const s = 0.75 + rnd() * 0.7;
      (north || h > 60 ? p : o).push([x, h - 0.3, z, s]);
    }
    // Trunks are solid to walkers and chariots (the camera sees past them).
    for (const [x, , z, sc] of [...p, ...o]) addCircle(x, z, 0.9 * sc, true);
    return { p, o };
  }, []);

  const fill = (mesh: THREE.InstancedMesh | null, list: [number, number, number, number][]) => {
    if (!mesh) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), tint = new THREE.Color();
    list.forEach(([x, y, z, s], i) => {
      q.setFromEuler(e.set(0, (x * 13.7 + z) % 6.28, 0));
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s * (0.9 + ((x * 7) % 1 + 1) % 1 * 0.3), s));
      mesh.setMatrixAt(i, m);
      const v = 0.82 + (((x * 3.1 + z * 1.7) % 1) + 1) % 1 * 0.36; // each tree a little lighter or darker
      mesh.setColorAt(i, tint.setRGB(v, v * (0.96 + (((z * 2.3) % 1) + 1) % 1 * 0.08), v * 0.95));
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.count = list.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  };
  useLayoutEffect(() => { fill(pine.current, spots.p); }, [spots]); // eslint-disable-line react-hooks/exhaustive-deps

  // Oaks near you (in play) are the full leafy tree; the rest are the cheap far tree.
  const oakNear = useRef<THREE.InstancedMesh>(null), sortedAt = useRef<[number, number] | null>(null);
  useFrame(() => {
    const playing = play.mode === 'play';
    const at: [number, number] = playing ? [me.x, me.z] : [1e6, 1e6];
    const last = sortedAt.current;
    if (last && Math.hypot(at[0] - last[0], at[1] - last[1]) < NEAR_STEP) return;
    sortedAt.current = at;
    const near: typeof spots.o = [], far: typeof spots.o = [];
    for (const t of spots.o) (Math.hypot(t[0] - at[0], t[2] - at[1]) < NEAR_R ? near : far).push(t);
    fill(oakNear.current, near);
    fill(oak.current, far);
  });

  const pg = useMemo(pineGeo, []), og = useMemo(() => oakGeo(false), []), ogNear = useMemo(() => oakGeo(true), []);
  const [leaf, needle, bark] = useTexture(['/tex/leaves.jpg', '/tex/needles.jpg', '/tex/bark.jpg']);
  const mats = useMemo(() => {
    for (const t of [leaf, needle, bark]) { t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; }
    const A = AVG as Record<string, number[]>;
    // Every part bends with the shared wind, so a trunk and its crown move as one tree.
    const barkM = swaying(triplanar(bark, A.bark, 0.6, '#3a2d22'), 10, 0);
    const needles = swaying(triplanar(needle, A.needles, 0.45, '#ffffff', true), 10, 0.5);
    needles.side = THREE.DoubleSide; // the tiers are open cones
    // Oaks: a dark leafy core for the silhouette from afar, and alpha leaf cards for the ragged edge up close.
    const core = swaying(triplanar(leaf, A.leaves, 0.35, '#c9d4b0', true), 8, 0.6);
    const cards = swaying(new THREE.MeshStandardMaterial({ map: leafAtlas(), alphaTest: 0.42, side: THREE.DoubleSide, vertexColors: true, roughness: 0.82 }), 8, 1.2);
    return { pine: [barkM, needles], oak: [barkM, core], oakNear: [barkM, core, cards] };
  }, [leaf, needle, bark]);
  return (
    <>
      <instancedMesh ref={pine} args={[pg, mats.pine, spots.p.length]} castShadow receiveShadow />
      <instancedMesh ref={oak} args={[og, mats.oak, spots.o.length]} castShadow receiveShadow />
      <instancedMesh ref={oakNear} args={[ogNear, mats.oakNear, spots.o.length]} count={0} castShadow receiveShadow />
    </>
  );
}
