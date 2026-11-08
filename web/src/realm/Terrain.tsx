// The ground of Vael, coloured by what grows on it: sand, grass, wheat, vines, marsh, rock and snow.
import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';
import AVG from './texAvg.json';
import { GRID, heightGrid, landness, noise, riverDist } from './heights.ts';
import { HOUSES, SIZE } from './layout.ts';

const C = (h: string) => new THREE.Color(h);
const SAND = C('#cdb88a'), GRASS_A = C('#5d7432'), GRASS_B = C('#86884a'), DARK = C('#3f5428'), ROCK = C('#7a746a'),
  ROCK_D = C('#57524b'), SNOW = C('#eef1f4'), WHEAT = C('#b89a4e'), PLOUGH = C('#6f5a3e'), VINE = C('#4f6a2c'),
  MARSH = C('#56603c'), MUD = C('#4a4433'), SEABED = C('#4b5a52'), PALE = C('#9aa05c');

// Farmland sits around the seats in the lowlands.
const FARMS = HOUSES.filter((h) => ![4, 6].includes(h.id)).map((h) => ({ x: h.pos[0], z: h.pos[1], r: h.id === 1 ? 230 : 150, kind: h.id === 2 ? 'vine' : h.id === 1 ? 'wheat' : 'mixed' }));

function hash(i: number, j: number) {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** What the ground is at a point, read from the same per-vertex numbers the terrain mesh is painted with:
 * how much of it is grass (0..1) and its colour. For grass blades and footsteps. */
let SPLAT: { grass: Float32Array; dirt: Float32Array; col: Float32Array } | undefined;
export function groundAt(x: number, z: number, out = { grass: 0, dirt: 0, col: new THREE.Color() }) {
  if (!SPLAT) { out.grass = 0; out.dirt = 0; return out; }
  const W = GRID + 1, fx = Math.min(GRID - 1e-4, Math.max(0, (x / SIZE + 0.5) * GRID)), fz = Math.min(GRID - 1e-4, Math.max(0, (z / SIZE + 0.5) * GRID));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const k = [j * W + i, j * W + i + 1, (j + 1) * W + i, (j + 1) * W + i + 1], w = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v];
  let g = 0, d = 0, r = 0, gg = 0, b = 0;
  for (let n = 0; n < 4; n++) { g += SPLAT.grass[k[n]] * w[n]; d += SPLAT.dirt[k[n]] * w[n]; r += SPLAT.col[k[n] * 3] * w[n]; gg += SPLAT.col[k[n] * 3 + 1] * w[n]; b += SPLAT.col[k[n] * 3 + 2] * w[n]; }
  out.grass = g; out.dirt = d; out.col.setRGB(r, gg, b);
  return out;
}

export function Terrain() {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(SIZE, SIZE, GRID, GRID);
    g.rotateX(-Math.PI / 2);
    const hs = heightGrid();
    const pos = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    // Splat weights for the detail textures, in SURFACES order. They follow the colour lerps exactly.
    const w0 = new Float32Array(pos.count * 3), w1 = new Float32Array(pos.count * 3);
    const w = [0, 0, 0, 0, 0, 0];
    const set = (i: number) => { w.fill(0); w[i] = 1; };
    const mixW = (i: number, t: number) => { for (let n = 0; n < 6; n++) w[n] *= 1 - t; w[i] += t; };
    const col = new THREE.Color();
    const W = GRID + 1, cell = SIZE / GRID;
    for (let k = 0; k < pos.count; k++) {
      const i = k % W, j = Math.floor(k / W);
      const x = pos.getX(k), z = pos.getZ(k);
      const h = hs[j * W + i];
      pos.setY(k, h);
      const hx = hs[j * W + Math.min(GRID, i + 1)] - hs[j * W + Math.max(0, i - 1)];
      const hz = hs[Math.min(GRID, j + 1) * W + i] - hs[Math.max(0, j - 1) * W + i];
      const slope = Math.hypot(hx, hz) / (2 * cell);
      const nz = noise(x / 60, z / 60);

      if (h < -0.5) { col.copy(SEABED).lerp(SAND, Math.max(0, (h + 8) / 8)); set(SAND_T); }
      else if (h < 2.2 && (landness(x, z) < 0.995 || riverDist(x, z) < 30)) { col.copy(SAND).lerp(MUD, riverDist(x, z) < 30 ? 0.5 : 0); set(SAND_T); if (riverDist(x, z) < 30) mixW(MARSH_T, 0.5); }
      else {
        col.copy(GRASS_A).lerp(GRASS_B, 0.5 + nz * 0.5);
        set(GRASS_T);
        // Marsh at the delta.
        const md = Math.hypot(x + 60, z - 470);
        if (md < 180) { col.lerp(MARSH, 0.8).lerp(MUD, Math.max(0, noise(x / 14, z / 14)) * 0.6); mixW(MARSH_T, 0.85); }
        // Fields: a patchwork of strips near each seat.
        for (const f of FARMS) {
          const d = Math.hypot(x - f.x, z - f.z);
          if (d > 55 && d < f.r && slope < 0.35) {
            const a = 0.5, u = x * Math.cos(a) - z * Math.sin(a), v = x * Math.sin(a) + z * Math.cos(a);
            const ci = Math.floor(u / 22), cj = Math.floor(v / (f.kind === 'vine' ? 6 : 13));
            const r = hash(ci, cj);
            const edge = 1 - Math.min(1, (f.r - d) / 60);
            if (r > 0.25 + edge * 0.6) {
              const c = f.kind === 'wheat' ? (r > 0.55 ? WHEAT : r > 0.4 ? PLOUGH : PALE) : f.kind === 'vine' ? (cj % 2 ? VINE : PLOUGH) : r > 0.7 ? WHEAT : r > 0.5 ? PALE : PLOUGH;
              const t = 0.55 + hash(cj, ci) * 0.25;
              col.lerp(c, t);
              mixW(c === WHEAT || c === PALE ? WHEAT_T : c === PLOUGH ? DIRT_T : GRASS_T, t);
            }
          }
        }
        // Darker ground under the forests of the north west.
        if (x < -250 && z < -80) col.lerp(DARK, 0.5 + nz * 0.3);
        // Rock on steep slopes and high ground, snow on the peaks.
        const rock = Math.min(1, Math.max(slope - 0.55, (h - 70) / 60, 0) * 1.6);
        col.lerp(nz > 0 ? ROCK : ROCK_D, rock);
        mixW(ROCK_T, rock);
        const snow = Math.min(1, Math.max(0, (h - 165 - nz * 25) / 25) + Math.max(0, (h - 120) / 60) * (slope < 0.6 ? 0.4 : 0));
        col.lerp(SNOW, Math.min(1, snow));
        mixW(ROCK_T, Math.min(1, snow) * 0.7);
      }
      w0[k * 3] = w[0]; w0[k * 3 + 1] = w[1]; w0[k * 3 + 2] = w[2];
      w1[k * 3] = w[3]; w1[k * 3 + 1] = w[4]; w1[k * 3 + 2] = w[5];
      colors[k * 3] = col.r; colors[k * 3 + 1] = col.g; colors[k * 3 + 2] = col.b;
    }
    SPLAT = { grass: new Float32Array(pos.count), dirt: new Float32Array(pos.count), col: colors };
    for (let k = 0; k < pos.count; k++) { SPLAT.grass[k] = w0[k * 3]; SPLAT.dirt[k] = w0[k * 3 + 1]; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('splatA', new THREE.BufferAttribute(w0, 3));
    g.setAttribute('splatB', new THREE.BufferAttribute(w1, 3));
    g.computeVertexNormals();
    return g;
  }, []);
  const mat = useGroundMaterial();
  return <mesh geometry={geo} material={mat} receiveShadow castShadow={false} />;
}

// Detail textures, in splat order: splatA = grass, dirt, rock; splatB = wheat, sand, marsh.
const SURFACES = ['grass', 'dirt', 'rock', 'wheat', 'sand', 'marsh'] as const;
const [GRASS_T, DIRT_T, ROCK_T, WHEAT_T, SAND_T, MARSH_T] = [0, 1, 2, 3, 4, 5];

/** Loads a tiling ground texture (mirrored, so seams never line up). */
export function useGroundTextures() {
  const maps = useTexture(SURFACES.map((n) => `/tex/${n}.jpg`));
  return useMemo(() => {
    for (const t of maps) {
      t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      t.needsUpdate = true;
    }
    return maps;
  }, [maps]);
}

/**
 * The painted map colours stay; each texture only adds its own detail, divided by its mean colour.
 * Two scales are blended so the tiling never shows, and from far away the mips average back to the plain map.
 */
function useGroundMaterial() {
  const maps = useGroundTextures();
  return useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    m.onBeforeCompile = (sh) => {
      SURFACES.forEach((n, i) => {
        sh.uniforms[`tx${i}`] = { value: maps[i] };
        sh.uniforms[`av${i}`] = { value: new THREE.Vector3(...((AVG as Record<string, number[]>)[n] ?? [0.5, 0.5, 0.5])) };
      });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 splatA;\nattribute vec3 splatB;\nvarying vec3 vSA;\nvarying vec3 vSB;\nvarying vec2 vXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSA = splatA; vSB = splatB; vXZ = (modelMatrix * vec4(position, 1.0)).xz;');
      const decl = SURFACES.map((_, i) => `uniform sampler2D tx${i}; uniform vec3 av${i};`).join('\n');
      const sample = SURFACES.map((_, i) => `det += ${i < 3 ? 'vSA' : 'vSB'}.${'xyz'[i % 3]} * (texture2D(tx${i}, uA).rgb + texture2D(tx${i}, uB).rgb) * 0.5 / max(av${i}, vec3(0.01));`).join('\n');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vSA;\nvarying vec3 vSB;\nvarying vec2 vXZ;\n${decl}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec2 uA = vXZ / 7.0, uB = vXZ / 29.0 + vec2(0.37, 0.11);
            vec3 det = vec3(0.0);
            ${sample}
            float ws = dot(vSA, vec3(1.0)) + dot(vSB, vec3(1.0));
            det = det / max(ws, 0.001);
            diffuseColor.rgb *= clamp(mix(vec3(1.0), det, 0.9), 0.0, 2.5);
          }`);
    };
    return m;
  }, [maps]);
}

/** A tiling ripple normal map drawn once on a canvas: a few crossing sine swells, no image download. */
function rippleNormals(n = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  const waves = [[3, 1, 0.9], [-2, 3, 0.7], [5, -4, 0.35], [-7, -2, 0.25], [9, 6, 0.15]] as const;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let dx = 0, dy = 0;
    for (const [kx, ky, a] of waves) {
      const ph = ((i * kx + j * ky) / n) * Math.PI * 2;
      dx += Math.cos(ph) * kx * a; dy += Math.cos(ph) * ky * a;
    }
    const v = new THREE.Vector3(-dx * 0.08, -dy * 0.08, 1).normalize();
    const k = (j * n + i) * 4;
    img.data[k] = (v.x * 0.5 + 0.5) * 255; img.data[k + 1] = (v.y * 0.5 + 0.5) * 255; img.data[k + 2] = (v.z * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function Water() {
  const a = useMemo(() => { const t = rippleNormals(); t.repeat.set(480, 480); return t; }, []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    a.offset.set(t * 0.012, t * 0.007);
  });
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0} receiveShadow>
      <planeGeometry args={[SIZE * 3, SIZE * 3]} />
      <meshPhysicalMaterial color="#24505e" roughness={0.22} metalness={0.05} transparent opacity={0.86} clearcoat={0.8} clearcoatRoughness={0.08}
        normalMap={a} normalScale={new THREE.Vector2(0.2, 0.2)} />
    </mesh>
  );
}
