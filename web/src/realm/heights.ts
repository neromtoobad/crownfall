// The shape of the land, as a pure function of (x, z), so terrain, trees, roads and walkers all agree on it.
import { createNoise2D } from 'simplex-noise';
import { CAPITAL, HIPPODROME, HOUSES, RIVER, SIZE } from './layout.ts';

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const n1 = createNoise2D(mulberry32(7));
const n2 = createNoise2D(mulberry32(11));
const n3 = createNoise2D(mulberry32(23));
export const noise = (x: number, z: number) => n3(x, z);

const fbm = (x: number, z: number, oct = 4) => {
  let a = 0, f = 1, amp = 1, sum = 0;
  for (let i = 0; i < oct; i++) { a += n1(x * f, z * f) * amp; sum += amp; f *= 2.03; amp *= 0.5; }
  return a / sum;
};
const ridged = (x: number, z: number) => {
  let a = 0, f = 1, amp = 1, sum = 0;
  for (let i = 0; i < 5; i++) { const v = 1 - Math.abs(n2(x * f, z * f)); a += v * v * amp; sum += amp; f *= 2.1; amp *= 0.5; }
  return a / sum;
};
const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

// The river as a dense polyline, for distance checks.
const riverPts = RIVER.getSpacedPoints(500).map((p) => [p.x, p.z] as [number, number]);
export function riverDist(x: number, z: number) {
  let best = 1e9;
  for (let i = 0; i < riverPts.length - 1; i++) {
    const [ax, az] = riverPts[i], [bx, bz] = riverPts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const ex = ax + dx * t - x, ez = az + dz * t - z;
    const d = ex * ex + ez * ez;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** How much of this point is land rather than sea, 0..1. */
export function landness(x: number, z: number) {
  const wob = fbm(x / 340, z / 340, 3) * 0.12;
  const r = Math.max(Math.abs(x) / (x > 0 ? 690 : 720), z > 0 ? z / 545 : -z / 2000) + wob;
  return 1 - smooth(0.86, 1.0, r);
}

function raw(x: number, z: number) {
  const land = landness(x, z);
  let h = 6 + (fbm(x / 300, z / 300) * 0.5 + 0.5) * 26 + fbm(x / 70, z / 70, 3) * 2.5;
  // Mountains rise to the north.
  const north = smooth(-230, -620, z);
  h += north * (ridged(x / 240, z / 240) * 175 + fbm(x / 120, z / 120) * 25 + 35);
  // The quarry hills of Draven.
  const qd = Math.hypot(x - 420, z + 300);
  h += Math.max(0, 1 - qd / 220) ** 1.5 * (ridged(x / 130, z / 130) * 55);
  // The marsh at the delta sits low.
  const md = Math.hypot(x + 60, z - 470);
  h = mix(h, 1.6, smooth(170, 40, md));
  // Cliffs on the east coast at Gullcrest.
  const cd = Math.hypot(x - 560, z - 120);
  h += Math.max(0, 1 - cd / 140) * 30;
  // The river cuts its valley.
  const rd = riverDist(x, z);
  h *= mix(0.45, 1, smooth(20, 160, rd)) ** (north > 0.1 ? 1 : 0.3);
  h = mix(h, -2.5, smooth(26, 7, rd));
  // Into the sea.
  return mix(-26, h, land);
}

/** Flat ground where the seats, the capital and the arena stand. */
const FLATS: { x: number; z: number; r: number; h: number }[] = [
  ...HOUSES.map((hs) => ({ x: hs.pos[0], z: hs.pos[1], r: 62, h: 0 })),
  { x: CAPITAL.pos[0] + 25, z: CAPITAL.pos[1], r: 110, h: 0 },
  { x: HIPPODROME.pos[0], z: HIPPODROME.pos[1], r: 142, h: 0 },
];
for (const f of FLATS) f.h = Math.max(4, raw(f.x, f.z));
// The capital sits on both banks, so it is flattened just above the water.
FLATS[8].h = 6;
FLATS[9].h = 6;

export function height(x: number, z: number) {
  let h = raw(x, z);
  for (const f of FLATS) {
    const d = Math.hypot(x - f.x, z - f.z);
    if (d < f.r * 1.6) h = mix(h, f.h, smooth(f.r * 1.6, f.r * 0.9, d));
  }
  // Keep the river channel through the flats.
  const rd = riverDist(x, z);
  if (rd < 22) h = Math.min(h, mix(-2.5, h, smooth(7, 22, rd)));
  return h;
}

/** Ground height clamped to dry land (for walkers on bridges). */
export const groundY = (x: number, z: number) => Math.max(0.6, height(x, z));

// ---------- A cached grid, so the terrain mesh and everything placed on it read the same numbers ----------
export const GRID = 360; // cells per side
let grid: Float32Array | undefined;
export function heightGrid() {
  if (!grid) {
    grid = new Float32Array((GRID + 1) * (GRID + 1));
    for (let j = 0; j <= GRID; j++)
      for (let i = 0; i <= GRID; i++) grid[j * (GRID + 1) + i] = height((i / GRID - 0.5) * SIZE, (j / GRID - 0.5) * SIZE);
  }
  return grid;
}
/** Bilinear read of the cached grid: cheap enough to call every frame for every walker. */
export function sampleH(x: number, z: number) {
  const g = heightGrid();
  const fx = Math.min(GRID - 1e-4, Math.max(0, (x / SIZE + 0.5) * GRID)), fz = Math.min(GRID - 1e-4, Math.max(0, (z / SIZE + 0.5) * GRID));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, W = GRID + 1;
  const a = g[j * W + i], b = g[j * W + i + 1], c = g[(j + 1) * W + i], d = g[(j + 1) * W + i + 1];
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
export const ground = (x: number, z: number) => Math.max(0.5, sampleH(x, z));
