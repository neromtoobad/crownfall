// Bridges: wherever a road runs into water, a stone deck carries it across. Found from the roads themselves,
// so moving a road or the river never leaves travellers wading. The capital's west road gets the Lazzarin Bridge.
import * as THREE from 'three';
import { ground } from './heights.ts';
import { LANDMARKS, ROADS, roadCurve } from './layout.ts';

export interface Bridge { a: THREE.Vector2; b: THREE.Vector2; y: number; road: number }

const WET = 1.2; // ground below this is river, marsh or sea
const HALF_WIDTH = 6;

export const BRIDGES: Bridge[] = [];
ROADS.forEach((r, road) => {
  const c = roadCurve(r);
  const n = Math.ceil(c.getLength() / 2);
  const pts = c.getSpacedPoints(n);
  let start = -1;
  for (let k = 0; k <= n; k++) {
    const wet = ground(pts[k].x, pts[k].z) < WET;
    if (wet && start < 0) start = k;
    if (!wet && start > 0) {
      const a = pts[Math.max(0, start - 3)], b = pts[Math.min(n, k + 2)];
      const mid = new THREE.Vector2((a.x + b.x) / 2, (a.z + b.z) / 2);
      const shared = BRIDGES.some((o) => o.a.clone().add(o.b).multiplyScalar(0.5).distanceTo(mid) < 15); // roads sharing one crossing
      if (a.distanceTo(b) < 90 && !shared) {
        const y = Math.max(ground(a.x, a.z), ground(b.x, b.z), 2) + 0.6;
        BRIDGES.push({ a: new THREE.Vector2(a.x, a.z), b: new THREE.Vector2(b.x, b.z), y, road });
      }
    }
    if (!wet) start = -1;
  }
});

// The Lazzarin Bridge is the longest crossing out of the capital.
const lazzarin = BRIDGES.filter((b) => ROADS[b.road].from === 'capital').sort((p, q) => q.a.distanceTo(q.b) - p.a.distanceTo(p.b))[0];
if (lazzarin) {
  const m = lazzarin.a.clone().add(lazzarin.b).multiplyScalar(0.5);
  LANDMARKS[1].pos = [m.x, m.y];
}

const tmp = new THREE.Vector2(), seg = new THREE.Vector2();
/** Deck height if (x, z) is on a bridge, else undefined. */
export function bridgeY(x: number, z: number) {
  for (const br of BRIDGES) {
    seg.subVectors(br.b, br.a);
    const t = THREE.MathUtils.clamp(tmp.set(x, z).sub(br.a).dot(seg) / seg.lengthSq(), 0, 1);
    if (tmp.set(x, z).distanceTo(seg.multiplyScalar(t).add(br.a)) < HALF_WIDTH) return br.y;
  }
  return undefined;
}

/** Where feet go: the ground, or the bridge deck when crossing water. */
export function walkY(x: number, z: number) {
  if (x > 1500) return 0; // indoors (rooms.ts): every hall floor is at 0
  return Math.max(ground(x, z), bridgeY(x, z) ?? -Infinity);
}

/** Stone decks, parapets and piers, as boxes for Buildings to merge. */
export function bridgeGeometry(): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, ry: number) => new THREE.BoxGeometry(w, h, d).rotateY(ry).translate(x, y + h / 2, z);
  for (const br of BRIDGES) {
    const dir = br.b.clone().sub(br.a), len = dir.length();
    dir.normalize();
    const ry = Math.atan2(-dir.y, dir.x), nx = -dir.y, nz = dir.x;
    const mx = (br.a.x + br.b.x) / 2, mz = (br.a.y + br.b.y) / 2;
    out.push(box(len + 4, 1.6, HALF_WIDTH * 2 - 1, mx, br.y - 1.6, mz, ry));
    for (const s of [-1, 1]) out.push(box(len + 4, 1.1, 0.7, mx + nx * s * (HALF_WIDTH - 0.6), br.y, mz + nz * s * (HALF_WIDTH - 0.6), ry));
    for (let d = -len / 2 + 8; d < len / 2 - 4; d += 12) out.push(box(2.6, br.y + 2, HALF_WIDTH * 2 - 2, mx + dir.x * d, -2.4, mz + dir.y * d, ry));
  }
  return out;
}
