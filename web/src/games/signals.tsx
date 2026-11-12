// House Ashveil's game, from the signal tower over Greywater harbour at dusk: Lantern Signals. A ship stands off the
// Teeth (the reef) and flashes a sequence on its stern lantern; you answer on the tower's four lamps. Answer right and
// she turns for the harbour and moors where you can see her lantern for the rest of the night; a wrong lamp, or too
// long a pause, and she runs onto the rocks. Every ship's sequence is longer and faster. Six ships in to win; three
// wrecks and the harbourmaster takes the lamps off you.
// Also exports the dusk sky, the sea and a spark pool, which the Falconry game (falcon.tsx) shares.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { audio, burst, voice } from '../realm/sound.ts';
import { FireLight, Flames } from '../realm/fire.tsx';
import type { Room } from '../realm/rooms.ts';
import { usePlay } from '../realm/play.ts';
import { gameKeys, gameUi, register, session, type Result } from './host.ts';
import { TOO_SLOW, hallPlay, roundRng } from './seeded.ts';
import './signals.css';

export const SUN_DIR = new THREE.Vector3(-0.6, 0.42, 0.5).normalize(); // matches Realm.tsx

// ---- Sound: bells for the lamps, a muffled echo for the ship's lantern.
const NOTES = [329.6, 392, 493.9, 587.3];
export function bell(f: number, gain = 0.09, dur = 1.3, when = 0, muffle = 0) {
  const a = audio(); if (!a) return;
  const t = a.currentTime + when, out = a.createGain();
  let dest: AudioNode = a.destination;
  if (muffle) { const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400 - muffle * 900; lp.connect(a.destination); dest = lp; }
  out.connect(dest);
  for (const [k, g] of [[1, 1], [2.76, 0.35], [5.4, 0.12]] as const) {
    const o = a.createOscillator(), e = a.createGain();
    o.type = 'sine'; o.frequency.value = f * k;
    e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(gain * g, t + 0.01); e.gain.exponentialRampToValueAtTime(0.0001, t + dur / k ** 0.3);
    o.connect(e).connect(out); o.start(t); o.stop(t + dur + 0.05);
  }
}
function boom(loud = 1) { burst(70, 1, 0.5 * loud, 0.9, 0, 'lowpass'); burst(180, 0.8, 0.25 * loud, 0.5, 0.05, 'lowpass'); burst(900, 0.6, 0.08 * loud, 0.35, 0.02); }
function creak() { for (let i = 0; i < 4; i++) burst(260 + Math.random() * 200, 9, 0.05, 0.22, i * 0.13); }

// ---- The dusk sky: a dome with the low sun's glow, shared with Falconry.
export function DuskSky({ center = [0, 0, 0] as [number, number, number], radius = 1600 }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sun: { value: SUN_DIR }, top: { value: new THREE.Color('#2b3152') }, mid: { value: new THREE.Color('#8a6f8c') }, low: { value: new THREE.Color('#f0a466') }, glow: { value: new THREE.Color('#ffd796') } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 sun; uniform vec3 top; uniform vec3 mid; uniform vec3 low; uniform vec3 glow; varying vec3 vD;
      void main(){
        float y = vD.y, s = max(dot(vD, sun), 0.0);
        vec3 c = mix(low, mid, smoothstep(0.0, 0.22, y));
        c = mix(c, top, smoothstep(0.2, 0.75, y));
        c += glow * (pow(s, 6.0) * 0.55 + pow(s, 60.0) * 1.2) * smoothstep(-0.1, 0.05, y);
        c = mix(c, low * 0.55, smoothstep(0.0, -0.08, y));
        // A few thin bands of cloud across the low sky.
        float band = sin(vD.y * 90.0 + vD.x * 6.0) * sin(vD.z * 3.0 + vD.y * 40.0);
        c = mix(c, c * 1.25 + glow * 0.1 * s, smoothstep(0.55, 0.95, band) * smoothstep(0.02, 0.08, y) * smoothstep(0.3, 0.1, y));
        gl_FragColor = vec4(c, 1.0);
      }`,
  }), []);
  return <mesh material={mat} position={center} renderOrder={-10}><sphereGeometry args={[radius, 32, 16]} /></mesh>;
}

// ---- The sea: rippled normals, the sky in it, a road of glitter toward the sun, fading to the horizon.
export function Sea({ y = -1, size = 4000, center = [0, 0] as [number, number], deep = '#1d2b36', horizon = '#d99a6c', chop = 0.9, shine = 1 }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    fog: false,
    uniforms: { time: { value: 0 }, sun: { value: SUN_DIR }, deep: { value: new THREE.Color(deep) }, horizon: { value: new THREE.Color(horizon) }, sunCol: { value: new THREE.Color('#ffcf8a') }, chop: { value: chop }, shine: { value: shine } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float time; uniform vec3 sun; uniform vec3 deep; uniform vec3 horizon; uniform vec3 sunCol; uniform float chop; uniform float shine; varying vec3 vW;
      float wave(vec2 p){ return sin(p.x * 0.11 + time * 0.9) * 0.5 + sin(p.y * 0.07 - time * 0.7 + p.x * 0.03) * 0.5
        + sin((p.x + p.y) * 0.23 + time * 1.7) * 0.25 + sin((p.x * 0.6 - p.y) * 0.41 - time * 2.3) * 0.15 + sin((p.x * 1.3 + p.y * 0.4) * 0.9 + time * 3.1) * 0.06; }
      void main(){
        vec2 p = vW.xz; float e = 0.4;
        float hx = wave(p + vec2(e, 0.0)) - wave(p - vec2(e, 0.0)), hz = wave(p + vec2(0.0, e)) - wave(p - vec2(0.0, e));
        vec3 n = normalize(vec3(-hx * chop, 1.0, -hz * chop));
        vec3 v = normalize(vW - cameraPosition);
        vec3 r = reflect(v, n);
        float fres = pow(1.0 - max(dot(-v, n), 0.0), 3.0);
        float sd = max(dot(r, sun), 0.0);
        float glint = (pow(sd, 260.0) * 9.0 + pow(sd, 18.0) * 0.45) * shine;
        vec3 skyR = mix(horizon, vec3(0.22, 0.22, 0.34), clamp(r.y * 2.0, 0.0, 1.0));
        vec3 col = mix(deep, skyR, 0.12 + fres * 0.8) + sunCol * glint;
        float d = length(vW.xz - cameraPosition.xz);
        col = mix(col, horizon * 0.95, smoothstep(300.0, 1500.0, d));
        gl_FragColor = vec4(col, 1.0);
      }`,
  }), [deep, horizon, chop, shine]);
  useFrame(({ clock }) => { mat.uniforms.time.value = clock.elapsedTime; });
  return <mesh material={mat} position={[center[0], y, center[1]]} rotation-x={-Math.PI / 2}><planeGeometry args={[size, size, 1, 1]} /></mesh>;
}

// ---- Sparks and spray: a pool of points with velocities, gravity and fade.
export class Sparks {
  n: number; geo = new THREE.BufferGeometry(); pos: Float32Array; col: Float32Array; vel: Float32Array; life: Float32Array; max: Float32Array; size: Float32Array;
  points: THREE.Points; next = 0; gravity: number;
  constructor(n = 400, gravity = 18, blending: THREE.Blending = THREE.AdditiveBlending) {
    this.n = n; this.gravity = gravity;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n); this.max = new Float32Array(n).fill(1); this.size = new Float32Array(n);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending, vertexColors: true, fog: false,
      vertexShader: 'attribute float aLife; attribute float aSize; varying float vA; varying vec3 vC; void main(){ vC = color; vA = aLife; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * (300.0 / -mv.z) * (0.4 + 0.6 * aLife); }',
      fragmentShader: 'varying float vA; varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5); if (vA <= 0.0) discard; gl_FragColor = vec4(vC * vA, vA * smoothstep(0.5, 0.1, d)); }',
    });
    this.points = new THREE.Points(this.geo, mat); this.points.frustumCulled = false;
  }
  emit(at: THREE.Vector3, count: number, color: THREE.Color, speed: number, up = 0.5, size = 1, life = 1) {
    for (let k = 0; k < count; k++) {
      const i = this.next = (this.next + 1) % this.n;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(1 - Math.random() * (1 + up)), s = speed * (0.4 + Math.random() * 0.6);
      this.pos.set([at.x, at.y, at.z], i * 3);
      this.vel.set([Math.sin(ph) * Math.cos(th) * s, Math.cos(ph) * s, Math.sin(ph) * Math.sin(th) * s], i * 3);
      this.col.set([color.r, color.g, color.b], i * 3);
      this.max[i] = life * (0.6 + Math.random() * 0.6); this.life[i] = 1; this.size[i] = size * (0.6 + Math.random() * 0.8);
    }
  }
  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt / this.max[i];
      this.vel[i * 3 + 1] -= this.gravity * dt;
      for (let a = 0; a < 3; a++) { this.vel[i * 3 + a] *= 1 - dt * 0.6; this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt; }
    }
    for (const k of ['position', 'color', 'aLife', 'aSize']) (this.geo.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** A soft round glow for lanterns, as a texture for sprites. */
let haloTex: THREE.Texture | undefined;
export function halo() {
  if (haloTex) return haloTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return (haloTex = new THREE.CanvasTexture(c));
}

/** Override the hall's fog and background while a round is outdoors; restore them after. */
export function useOutdoorAir(color: string, near: number, far: number) {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const fog = scene.fog, bg = scene.background;
    scene.fog = new THREE.Fog(color, near, far);
    scene.background = new THREE.Color(color);
    return () => { scene.fog = fog; scene.background = bg; };
  }, [scene, color, near, far]);
}

// ---------------------------------------------------------------------------------------------------------------
const STATION: [number, number] = [0, -12]; // rooms.ts
const LAMP_COLORS = ['#ff4b3a', '#39f08a', '#4bb6ff', '#ffc23a'];
const LAMP_NAMES = ['red', 'green', 'blue', 'amber'];
const WIN = 6, MAX_SHIPS = 8, MAX_WRECKS = 3;
// Colours parsed once: the frame loop copies these instead of parsing a hex string several times a frame.
const LAMP_RGB = LAMP_COLORS.map((c) => new THREE.Color(c));
const LANTERN = new THREE.Color('#ffd38a'), DARK = new THREE.Color('#2a2018'), AFIRE = new THREE.Color('#ff6a3a');
const FOAM = new THREE.Color('#f4efe6'), FOAM_DIM = new THREE.Color('#e9e4dc');
const NAMES = ['the Grey Gull', 'the Heron’s Wing', 'the Salt Widow', 'the Lantern Maid', 'the Cold Tide', 'the Silver Eel', 'the Long Patience', 'the Fair Return', 'the Black Swan', 'the Old Debt', 'the Night Herring'];

// A brass lantern on an iron post: plinth, post, bracket, cage, coloured glass, cap. Built around its glass centre.
const brass = new THREE.MeshStandardMaterial({ color: '#b08a45', metalness: 0.8, roughness: 0.35 });
const iron = new THREE.MeshStandardMaterial({ color: '#232120', metalness: 0.6, roughness: 0.55 });
const stoneM = new THREE.MeshStandardMaterial({ color: '#77706a', roughness: 0.92 });
const stoneD = new THREE.MeshStandardMaterial({ color: '#5c5650', roughness: 0.95 });
function lampGlass(i: number) {
  return new THREE.MeshStandardMaterial({ color: LAMP_COLORS[i], emissive: new THREE.Color(LAMP_COLORS[i]), emissiveIntensity: 0.25, transparent: true, opacity: 0.88, roughness: 0.15, metalness: 0.1 });
}
function Lamp({ i, x, z, glass, post = 2.5, onPress }: { i: number; x: number; z: number; glass: THREE.Material; post?: number; onPress?: () => void }) {
  return (
    <group position={[x, 0, z]} onPointerDown={onPress ? (e) => { e.stopPropagation(); onPress(); } : undefined}>
      <mesh position={[0, 0.2, 0]} material={stoneD} castShadow receiveShadow><boxGeometry args={[0.9, 0.4, 0.9]} /></mesh>
      <mesh position={[0, 0.45, 0]} material={stoneM} castShadow><boxGeometry args={[0.7, 0.1, 0.7]} /></mesh>
      <mesh position={[0, 0.5 + post / 2, 0]} material={iron} castShadow><cylinderGeometry args={[0.07, 0.1, post, 8]} /></mesh>
      <group position={[0, 0.5 + post + 0.55, 0]}>
        <mesh position={[0, -0.6, 0]} material={brass}><cylinderGeometry args={[0.36, 0.26, 0.14, 12]} /></mesh>
        <mesh material={glass}><cylinderGeometry args={[0.34, 0.34, 1.0, 8, 1, true]} /></mesh>
        <mesh material={glass} scale={0.55}><sphereGeometry args={[0.32, 12, 8]} /></mesh>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((k) => { const a = (k / 8) * Math.PI * 2 + Math.PI / 8; return <mesh key={k} position={[Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35]} material={brass}><boxGeometry args={[0.045, 1.02, 0.045]} /></mesh>; })}
        <mesh position={[0, 0.56, 0]} material={brass}><cylinderGeometry args={[0.4, 0.4, 0.1, 12]} /></mesh>
        <mesh position={[0, 0.84, 0]} material={brass}><coneGeometry args={[0.38, 0.5, 12]} /></mesh>
        <mesh position={[0, 1.18, 0]} rotation-x={Math.PI / 2} material={iron}><torusGeometry args={[0.14, 0.03, 6, 14]} /></mesh>
        <mesh position={[0, -0.3, 0.42]} material={brass}><boxGeometry args={[0.24, 0.24, 0.05]} /></mesh>
        {/* The lamp's number, a brass plate on its post. */}
      </group>
      <mesh position={[0, 1.15, 0.12]} material={brass}><boxGeometry args={[0.26, 0.3, 0.04]} /></mesh>
      <mesh position={[0, 1.15, 0.145]}><planeGeometry args={[0.18, 0.22]} /><meshBasicMaterial map={numberTex(i)} transparent /></mesh>
    </group>
  );
}
const numTexs: THREE.Texture[] = [];
function numberTex(i: number) {
  if (numTexs[i]) return numTexs[i];
  const c = document.createElement('canvas'); c.width = 48; c.height = 60;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2a1d10'; g.font = '700 46px Cinzel, Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), 24, 32);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (numTexs[i] = t);
}

/** In the hall: the signal desk under the west windows — the four lamps, a brass glass on its tripod, a chart. */
function Station() {
  const [x, z] = STATION;
  const glasses = useMemo(() => [0, 1, 2, 3].map(lampGlass), []);
  const playing = usePlay().game && session.phase === 'play';
  const flames = useMemo(() => [[x - 5.2, 1.95, z + 1.4, 0.2], [x + 5.2, 1.95, z + 1.4, 0.2]] as [number, number, number, number][], [x, z]);
  return (
    <group>
      {/* A low stone dais the lamps stand on, with an oak rail along its front. */}
      <mesh position={[x, 0.2, z]} material={stoneD} castShadow receiveShadow><boxGeometry args={[12, 0.4, 4.2]} /></mesh>
      <mesh position={[x, 0.43, z]} material={stoneM} receiveShadow><boxGeometry args={[11.6, 0.06, 3.8]} /></mesh>
      {[-1, 1].map((s) => <mesh key={s} position={[x + s * 5.6, 0.4 + 0.7, z + 1.85]} castShadow><boxGeometry args={[0.22, 1.4, 0.22]} /><meshStandardMaterial color="#4a3020" roughness={0.8} /></mesh>)}
      <mesh position={[x, 1.85, z + 1.85]} castShadow><boxGeometry args={[11.6, 0.16, 0.3]} /><meshStandardMaterial color="#5a3a24" roughness={0.75} /></mesh>
      {[0, 1, 2, 3].map((i) => <group key={i} position={[0, 0.4, 0]} visible={!playing}><Lamp i={i} x={x + (i - 1.5) * 2.4} z={z - 0.4} glass={glasses[i]} /></group>)}
      {/* The harbourmaster's glass on a tripod. */}
      <group position={[x + 7.4, 0, z + 0.5]} rotation-y={-0.6}>
        {[0, 1, 2].map((k) => { const a = (k / 3) * Math.PI * 2; return <mesh key={k} position={[Math.cos(a) * 0.45, 1.2, Math.sin(a) * 0.45]} rotation={[Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35]} castShadow><cylinderGeometry args={[0.04, 0.05, 2.5, 6]} /><meshStandardMaterial color="#3a2618" /></mesh>; })}
        <mesh position={[0, 2.5, 0]} rotation={[0, 0, Math.PI / 2 - 0.12]} material={brass} castShadow><cylinderGeometry args={[0.1, 0.16, 1.9, 14]} /></mesh>
      </group>
      {/* A chart table with the harbour drawn on it. */}
      <group position={[x - 7.6, 0, z + 0.6]}>
        <mesh position={[0, 1.3, 0]} castShadow receiveShadow><boxGeometry args={[2.4, 0.12, 1.6]} /><meshStandardMaterial color="#5a3c26" roughness={0.75} /></mesh>
        {[-1, 1].map((sx) => [-1, 1].map((sz) => <mesh key={`${sx}${sz}`} position={[sx * 1.05, 0.62, sz * 0.65]} castShadow><boxGeometry args={[0.14, 1.24, 0.14]} /><meshStandardMaterial color="#3e2a1b" /></mesh>))}
        <mesh position={[0, 1.37, 0]} rotation-x={-Math.PI / 2}><planeGeometry args={[2.1, 1.35]} /><meshStandardMaterial map={chartTex()} roughness={0.95} /></mesh>
      </group>
      {[-1, 1].map((s) => <mesh key={s} position={[x + s * 5.2, 1.7, z + 1.4]}><cylinderGeometry args={[0.07, 0.07, 0.5, 6]} /><meshStandardMaterial color="#efe6cf" /></mesh>)}
      <Flames spots={flames} />
      <FireLight position={[x, 4, z + 2]} color="#ffbe73" intensity={160} distance={20} />
    </group>
  );
}
let chart: THREE.Texture | undefined;
function chartTex() {
  if (chart) return chart;
  const c = document.createElement('canvas'); c.width = 256; c.height = 164;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d9c9a2'; g.fillRect(0, 0, 256, 164);
  g.strokeStyle = '#6b5236'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(256, 20); g.bezierCurveTo(170, 40, 190, 90, 120, 100); g.bezierCurveTo(80, 108, 70, 150, 40, 164); g.stroke();
  g.fillStyle = '#7f6a4a'; for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(70 + i * 9, 60 + Math.sin(i) * 9, 3, 0, 7); g.fill(); }
  g.strokeStyle = 'rgba(80,60,40,0.4)'; g.lineWidth = 1; for (let i = 0; i < 12; i++) { g.beginPath(); g.moveTo(128, 82); g.lineTo(128 + Math.cos(i / 12 * 6.28) * 120, 82 + Math.sin(i / 12 * 6.28) * 120); g.stroke(); }
  g.fillStyle = '#5a2a1a'; g.font = 'italic 14px Georgia'; g.fillText('the Teeth', 52, 52);
  chart = new THREE.CanvasTexture(c); chart.colorSpace = THREE.SRGBColorSpace;
  return chart;
}

// ---- Ships: hull, deck, castle, mast and yard, a bellied sail, a stern lantern with a halo and its reflection.
interface Ship {
  g: THREE.Group; lantern: THREE.MeshBasicMaterial; halo: THREE.Sprite; streak: THREE.Mesh; wake: THREE.Mesh;
  state: 'idle' | 'in' | 'signal' | 'home' | 'moored' | 'wreck' | 'sunk';
  t: number; from: THREE.Vector3; to: THREE.Vector3; pos: THREE.Vector3; heading: number; roll: number; sink: number; seed: number; slot: number; name: string;
  /** The lantern halo's size now and the size it is easing to; the run home's length, and its route when it is not a straight line. */
  hs: number; hsT: number; dur: number; path?: THREE.CatmullRomCurve3;
}
function makeShip(seed: number, name: string): Ship {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: '#3b2a1e', roughness: 0.8 });
  const hull = new THREE.BoxGeometry(22, 3.6, 6.4, 10, 2, 2);
  const p = hull.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), u = x / 11;
    // Pointed bow, rounded stern, a narrower keel, the sheer rising at both ends.
    const beam = u > 0 ? 1 - u ** 2 * 0.95 : 1 - u ** 4 * 0.35;
    const keel = y < 0 ? 0.55 + 0.45 * (y + 1.8) / 1.8 : 1;
    p.setZ(i, z * beam * keel); p.setY(i, y + (y > 0 ? u ** 2 * 1.4 : 0));
  }
  hull.computeVertexNormals();
  const h = new THREE.Mesh(hull, hullMat); h.castShadow = true; g.add(h);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(19, 0.35, 6.5), new THREE.MeshStandardMaterial({ color: '#c9cdd4', roughness: 0.6 }));
  stripe.position.set(-0.5, 1.2, 0); stripe.scale.z = 0.94; g.add(stripe);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(17, 0.3, 4.8), new THREE.MeshStandardMaterial({ color: '#6b4c32', roughness: 0.8 }));
  deck.position.y = 1.6; g.add(deck);
  const castle = new THREE.Mesh(new THREE.BoxGeometry(5, 2.6, 5.2), hullMat); castle.position.set(-8, 3, 0); castle.castShadow = true; g.add(castle);
  const wood = new THREE.MeshStandardMaterial({ color: '#2f2117', roughness: 0.8 });
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 20, 8), wood); mast.position.set(1, 11.5, 0); g.add(mast);
  const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 11, 6), wood); yard.rotation.x = Math.PI / 2; yard.position.set(1.2, 19, 0); g.add(yard);
  const sailG = new THREE.PlaneGeometry(10, 11, 8, 8).rotateY(Math.PI / 2);
  const sp = sailG.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < sp.count; i++) { const z = sp.getZ(i), y = sp.getY(i); sp.setX(i, Math.cos((z / 5) * Math.PI / 2) * Math.cos((y / 5.5) * Math.PI / 2) * 1.6); }
  sailG.computeVertexNormals();
  const sail = new THREE.Mesh(sailG, new THREE.MeshStandardMaterial({ color: seed % 3 === 0 ? '#c9b48c' : '#d8ccb2', roughness: 0.9, side: THREE.DoubleSide }));
  sail.position.set(1.4, 13.3, 0); sail.castShadow = true; g.add(sail);
  const pennant = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.6).translate(1.3, 0, 0), new THREE.MeshStandardMaterial({ color: '#1d1f24', side: THREE.DoubleSide }));
  pennant.position.set(1, 21.7, 0); g.add(pennant);
  // The stern lantern on its pole.
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3, 6), wood); pole.position.set(-10.6, 5.6, 0); g.add(pole);
  const lantern = new THREE.MeshBasicMaterial({ color: '#ffd38a', toneMapped: false });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), lantern); lamp.position.set(-10.6, 7.3, 0); g.add(lamp);
  const haloS = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo(), color: '#ffd38a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, fog: false }));
  haloS.position.copy(lamp.position); haloS.scale.setScalar(9); g.add(haloS);
  // The lantern's road of light on the water, and a foam wake.
  const streak = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 16).translate(0, -8, 0), new THREE.MeshBasicMaterial({ color: '#ffd38a', map: halo(), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
  streak.rotation.x = -Math.PI / 2;
  const wake = new THREE.Mesh(new THREE.PlaneGeometry(26, 9), new THREE.MeshBasicMaterial({ color: '#fff4e2', map: halo(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  wake.rotation.x = -Math.PI / 2;
  // The streak and wake are mounted beside the ship, not inside it, so they must be hidden with it: until she sails
  // they sat lit on the hall floor at the room's origin.
  g.visible = streak.visible = wake.visible = false;
  return { g, lantern, halo: haloS, streak, wake, state: 'idle', t: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), pos: new THREE.Vector3(), heading: 0, roll: 0, sink: 0, seed, slot: -1, name, hs: 9, hsT: 9, dur: 5 };
}

// ---- The tower top: where the round is played (west of the hall, over the sea).
const TOP_Y = 14, LAMP_X = -68, TZ = -12;
const lampZ = (i: number) => TZ + (1.5 - i) * 3.2;
const CAM = new THREE.Vector3(-50, 23.5, TZ), LOOK = new THREE.Vector3(-150, 12, TZ);
const ROCKS: [number, number, number][] = [[-178, -52, 7], [-196, -38, 5], [-160, -66, 4], [-214, 22, 6], [-232, 34, 4.5], [-140, -88, 5]];
const LIGHTHOUSE = new THREE.Vector3(-360, 0, 135);

type Phase = 'sail' | 'watch' | 'answer' | 'home' | 'wreck' | 'done';
const ui = gameUi({ saved: 0, wrecks: 0, phase: 'sail' as Phase, line: 'A sail on the horizon…', len: 3, got: [] as number[], ship: '' });
// The answer timer's bar. The round writes its width straight to this element every frame, so the HUD does not have
// to re-render sixty times a second for one moving bar.
let timerEl: HTMLSpanElement | null = null;

function Tower() {
  const blocks = useMemo(() => {
    const out: { p: [number, number, number]; s: [number, number, number]; c: string }[] = [];
    // The tower body, in courses that step out a little near the top, then a corbel band and the parapet.
    for (let k = 0; k < 6; k++) out.push({ p: [-60, -4 + k * 3 + 1.5, TZ], s: [26 + (k % 2) * 0.3, 3.02, 28 + (k % 2) * 0.3], c: k % 2 ? '#6f6860' : '#77706a' });
    out.push({ p: [-60, TOP_Y - 0.6, TZ], s: [28.4, 1.2, 30.4], c: '#615a53' });
    for (let k = 0; k < 9; k++) {
      const z = TZ - 13 + k * 3.25;
      out.push({ p: [LAMP_X - 3.6, TOP_Y + 0.6, z], s: [1.4, 1.2, 3.25], c: '#6c655d' });
      if (k % 2 === 0) out.push({ p: [LAMP_X - 3.6, TOP_Y + 1.9, z], s: [1.4, 1.4, 1.8], c: '#6c655d' });
    }
    for (const s of [-1, 1]) out.push({ p: [-58, TOP_Y + 0.6, TZ + s * 14.4], s: [24, 1.2, 1.2], c: '#6c655d' });
    return out;
  }, []);
  return (
    <group>
      {blocks.map((b, i) => <mesh key={i} position={b.p} castShadow receiveShadow><boxGeometry args={b.s} /><meshStandardMaterial color={b.c} roughness={0.95} /></mesh>)}
      {/* Flagstones on the tower top. */}
      <mesh position={[-60, TOP_Y + 0.02, TZ]} rotation-x={-Math.PI / 2} receiveShadow><planeGeometry args={[27, 29]} /><meshStandardMaterial color="#7d766c" roughness={0.9} /></mesh>
      {/* Foam where the sea meets the tower. */}
      <mesh position={[-60, -0.85, TZ]} rotation-x={-Math.PI / 2}><ringGeometry args={[17, 24, 40]} /><meshBasicMaterial map={halo()} color="#fff1dc" transparent opacity={0.22} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} /></mesh>
    </group>
  );
}

function Rocks() {
  const geo = useMemo(() => {
    const g = new THREE.DodecahedronGeometry(1, 1), p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.75 + Math.abs(Math.sin(x * 12.99 + y * 78.23 + z * 37.71) * 43758.5453 % 1) * 0.5; p.setXYZ(i, x * k, y * k * 1.4, z * k); }
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <group>
      {ROCKS.map(([x, z, s], i) => (
        <group key={i} position={[x, -1, z]}>
          <mesh geometry={geo} scale={[s, s * 1.2, s * 0.9]} rotation-y={i * 1.7} castShadow><meshStandardMaterial color="#3c3734" roughness={1} flatShading /></mesh>
          <mesh geometry={geo} scale={[s * 0.6, s * 0.8, s * 0.7]} position={[s * 1.1, 0, s * 0.6]} rotation-y={i}><meshStandardMaterial color="#35302d" roughness={1} flatShading /></mesh>
          <mesh rotation-x={-Math.PI / 2} position-y={0.15}><ringGeometry args={[s * 0.9, s * 2.2, 24]} /><meshBasicMaterial map={halo()} color="#fff1dc" transparent opacity={0.3} depthWrite={false} blending={THREE.AdditiveBlending} fog={false} /></mesh>
        </group>
      ))}
    </group>
  );
}

/** Garg's Lighthouse on its headland, its beam sweeping the bay. */
function Lighthouse({ beam }: { beam: React.RefObject<THREE.Group> }) {
  const beamMat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { k: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float k; varying vec2 vUv; void main(){ float a = pow(vUv.y, 2.2) * 0.22 * k * smoothstep(0.0, 0.25, min(vUv.x, 1.0 - vUv.x) * 2.0); gl_FragColor = vec4(vec3(1.0, 0.86, 0.55) * a, a); }',
  }), []);
  return (
    <group position={LIGHTHOUSE}>
      <mesh position={[0, -2, 0]} scale={[1.7, 0.85, 1.3]}><sphereGeometry args={[30, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#5d574c" roughness={1} flatShading /></mesh>
      <mesh position={[0, 20, 0]} scale={[1, 0.5, 1]}><sphereGeometry args={[12, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#556b3e" roughness={1} flatShading /></mesh>
      {[0, 1, 2, 3, 4, 5].map((k) => <mesh key={k} position={[0, 26 + k * 7, 0]} castShadow><cylinderGeometry args={[5.2 - k * 0.45 - 0.45, 5.2 - k * 0.45, 7, 18]} /><meshStandardMaterial color={k % 2 ? '#a4352a' : '#e6ded0'} roughness={0.8} /></mesh>)}
      <mesh position={[0, 69.5, 0]}><cylinderGeometry args={[3.4, 3.4, 4, 12]} /><meshBasicMaterial color="#ffe3a6" toneMapped={false} /></mesh>
      <mesh position={[0, 72.6, 0]}><coneGeometry args={[4, 3.4, 12]} /><meshStandardMaterial color="#2b2622" /></mesh>
      <sprite position={[0, 69.5, 0]} scale={34}><spriteMaterial map={halo()} color="#ffd98a" blending={THREE.AdditiveBlending} depthWrite={false} transparent toneMapped={false} fog={false} /></sprite>
      <group ref={beam} position={[0, 69.5, 0]}>
        <mesh material={beamMat} rotation-z={Math.PI / 2} position={[-260, 0, 0]}><coneGeometry args={[34, 520, 24, 1, true]} /></mesh>
      </group>
    </group>
  );
}

function Play({ room, end }: { room: Room; end: (r: Result) => void }) {
  const camera = useThree((s) => s.camera);
  useOutdoorAir('#d99a6c', 260, 1500);
  const glasses = useMemo(() => [0, 1, 2, 3].map(lampGlass), []);
  const halos = useRef<(THREE.Sprite | null)[]>([]);
  const flash = useRef<THREE.PointLight>(null);
  const shipLight = useRef<THREE.PointLight>(null);
  const beam = useRef<THREE.Group>(null);
  const ships = useMemo(() => Array.from({ length: MAX_SHIPS + MAX_WRECKS }, (_, i) => makeShip(i, NAMES[(i + Math.floor(Math.random() * NAMES.length)) % NAMES.length])), []);
  const sparks = useMemo(() => new Sparks(500, 22), []);
  const spray = useMemo(() => new Sparks(400, 30, THREE.NormalBlending), []);
  const st = useRef({
    phase: 'sail' as Phase, t: 0, cur: -1, used: 0, saved: 0, wrecks: 0,
    seq: [] as number[], got: [] as number[], show: 0, idle: 0, lampT: [0, 0, 0, 0], lastLamp: 0, shake: 0, ended: false, fov: 48,
    look: LOOK.clone(), echo: -1, echoT: 0, placed: false, warn: 9, early: false, shipI: 160,
  });
  useMemo(() => { ui.reset(); }, []);
  // Every ship's sequence comes from the round's generator: on NEAR the contract's seed, so it can replay every lamp you
  // answered and judge the night itself (chain/src/halls.rs, `sig_ship`).
  const rng = useMemo(() => roundRng(), []);
  if (import.meta.env.DEV) Object.assign(window, { __sig: { st, press: (i: number) => press(i) } });
  const tmp = useMemo(() => new THREE.Vector3(), []), tmp2 = useMemo(() => new THREE.Vector3(), []);
  // A round builds eleven ships of its own; without this, every round played left their geometry and materials on the GPU.
  useEffect(() => () => {
    for (const x of ships) for (const o of [x.g, x.streak, x.wake]) o.traverse((m) => {
      const mesh = m as THREE.Mesh;
      if (!(m as THREE.Sprite).isSprite) mesh.geometry?.dispose(); // every sprite in the app shares one quad
      (mesh.material as THREE.Material | undefined)?.dispose();
    });
    for (const p of [sparks, spray]) { p.geo.dispose(); (p.points.material as THREE.Material).dispose(); }
    glasses.forEach((g) => g.dispose());
  }, [ships, sparks, spray, glasses]);
  const camPos = useMemo(() => new THREE.Vector3(), []), lookW = useMemo(() => new THREE.Vector3(), []);

  const len = (saved: number) => 3 + Math.floor(saved * 0.75);
  const flashOn = (s: number) => Math.max(0.3, 0.6 - s * 0.045);
  const answerWindow = (s: number) => Math.max(2.4, 4 - s * 0.2);

  function launch() {
    const s = st.current;
    const sh = ships[s.used++];
    s.cur = s.used - 1;
    sh.state = 'in'; sh.t = 0; sh.g.visible = sh.streak.visible = sh.wake.visible = true;
    sh.from.set(-520, 0, TZ - 70 + Math.random() * 120);
    sh.to.set(-140 + (Math.random() - 0.5) * 20, 0, TZ + (Math.random() - 0.5) * 44);
    sh.pos.copy(sh.from);
    s.seq = Array.from({ length: len(s.saved) }, () => rng.int(4));
    s.got = []; s.phase = 'sail'; s.t = 0; s.early = false;
    ui.set({ phase: 'sail', line: `${cap(sh.name)} stands in toward the Teeth…`, len: s.seq.length, got: [], ship: sh.name });
  }
  function openAnswer() {
    const s = st.current, sh = ships[s.cur];
    s.phase = 'answer'; s.idle = 0; s.warn = 9;
    sh.lantern.color.copy(LANTERN); (sh.halo.material as THREE.SpriteMaterial).color.copy(LANTERN); (sh.streak.material as THREE.MeshBasicMaterial).color.copy(LANTERN); sh.hsT = 9;
    ui.set({ phase: 'answer', line: 'Answer her. Repeat her colours in order.' });
  }
  function press(i: number) {
    const s = st.current;
    if (s.ended) return;
    if (s.phase === 'watch') {
      // Her last flash has gone dark: an answer begun in that gap counts. It used to ring the lamp and then be thrown
      // away, so the next press was judged as the first and wrecked her. While she is still signalling the lamp only
      // glows and sounds faintly, so it reads as "not yet" and does not drown her own bell.
      const on = flashOn(s.saved);
      if (s.t >= (s.seq.length - 1) * on * 1.45 + on) openAnswer();
      else {
        s.lampT[i] = Math.max(s.lampT[i], 0.3); s.lastLamp = i;
        bell(NOTES[i], 0.035, 0.5, 0, 0.7);
        if (!s.early) { s.early = true; ui.set({ line: 'Wait. She has not finished.' }); }
        return;
      }
    }
    s.lampT[i] = 1; s.lastLamp = i;
    bell(NOTES[i], 0.1);
    sparks.emit(tmp.set(LAMP_X, TOP_Y + 3.6, lampZ(i)), 14, LAMP_RGB[i], 6, 1.2, 1.1, 0.6);
    if (s.phase !== 'answer') return;
    const want = s.seq[s.got.length];
    hallPlay.moves.push(i); // every lamp answered, right or wrong: what the contract replays
    s.idle = 0; s.warn = 9;
    if (i !== want) { founder(`${cap(LAMP_NAMES[i])} was wrong: she wanted ${LAMP_NAMES[want]}.`); return; }
    s.got.push(i);
    s.echo = i; s.echoT = 0.35;
    ui.set({ got: [...s.got] });
    if (s.got.length === s.seq.length) {
      const sh = ships[s.cur];
      s.saved++; s.phase = 'home'; s.t = 0;
      sh.state = 'home'; sh.t = 0; sh.from.copy(sh.pos); sh.slot = s.saved - 1;
      sh.to.set(-172 - sh.slot * 17, 0, 44 + (sh.slot % 2) * 8);
      // A straight run in crossed the bow of the ship moored just before her, and past the fourth berth it went
      // through two of the Teeth. Every ship after the first rounds the back of the moored line instead and noses
      // in from the far side, at the same pace however far down the line her berth is.
      if (sh.slot >= 1) {
        sh.path = new THREE.CatmullRomCurve3([sh.from.clone(), new THREE.Vector3(-160, 0, 61), new THREE.Vector3(sh.to.x + 12, 0, 72), sh.to.clone()], false, 'centripetal');
        sh.dur = Math.max(5, sh.path.getLength() / 34);
      }
      [0, 2, 4, 7].forEach((k, n) => bell(NOTES[0] * 2 ** (k / 12) * 1.5, 0.07, 1.6, n * 0.09));
      voice('man', 20, -0.5, true); voice('woman', 14, 0.4, true);
      s.shake = 0.25;
      ui.set({ phase: 'home', saved: s.saved, line: `${cap(sh.name)} is in! ${s.saved >= WIN ? (s.saved === WIN ? 'Six ships: the harbour is yours.' : 'And still they come.') : `${WIN - s.saved} more.`}` });
    }
  }
  function founder(why: string) {
    const s = st.current, sh = ships[s.cur];
    s.wrecks++; s.phase = 'wreck'; s.t = 0;
    sh.state = 'wreck'; sh.t = 0; sh.from.copy(sh.pos);
    let best = ROCKS[0], bd = Infinity;
    for (const r of ROCKS) { const d = Math.hypot(r[0] - sh.pos.x, r[1] - sh.pos.z); if (d < bd) { bd = d; best = r; } }
    sh.to.set(best[0] + 6, 0, best[1] + 6);
    burst(220, 2, 0.08, 0.6); voice('man', 16, 0, true);
    s.shake = Math.max(s.shake, 0.3); // a jolt at the moment of the mistake; the big one comes when she strikes
    ui.set({ phase: 'wreck', wrecks: s.wrecks, line: `${why} ${cap(sh.name)} is running onto the Teeth!` });
  }

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05), now = clock.elapsedTime;
    const s = st.current;
    s.t += dt;
    for (const k of gameKeys()) {
      const i = k.length === 1 ? Math.max('1234'.indexOf(k), 'asdf'.indexOf(k)) : -1;
      if (i >= 0) press(i);
    }
    if (s.cur < 0 && !s.ended) launch();
    const sh = s.cur >= 0 ? ships[s.cur] : undefined;
    // ---- The round's beats.
    if (s.phase === 'sail' && sh) {
      if (sh.state === 'signal') { s.phase = 'watch'; s.t = -0.6; s.show = -1; ui.set({ phase: 'watch', line: `Watch her lantern. ${s.seq.length} flashes.` }); }
    } else if (s.phase === 'watch' && sh) {
      const on = flashOn(s.saved), off = on * 0.45, k = Math.floor(s.t / (on + off));
      const inOn = s.t >= 0 && s.t % (on + off) < on;
      if (s.t >= 0 && k < s.seq.length && inOn && s.show !== k) { s.show = k; bell(NOTES[s.seq[k]] / 2, 0.07, 1, 0, 0.6); }
      const lit = s.t >= 0 && k < s.seq.length && inOn, c = lit ? LAMP_RGB[s.seq[k]] : DARK;
      // The colour cuts on and off so each flash stays distinct; only the halo's size eases (in the ship loop below).
      sh.lantern.color.copy(c); (sh.halo.material as THREE.SpriteMaterial).color.copy(c); (sh.streak.material as THREE.MeshBasicMaterial).color.copy(c);
      sh.hsT = lit ? 24 : 4;
      if (k >= s.seq.length) openAnswer();
    } else if (s.phase === 'answer') {
      s.idle += dt;
      const w = answerWindow(s.saved), left = Math.max(0, 1 - s.idle / w);
      if (timerEl) timerEl.style.transform = `scaleX(${left.toFixed(3)})`;
      // Three quiet ticks as the last third of the time for this lamp runs out.
      const step = Math.ceil(left * 9);
      if (step !== s.warn) { if (step < s.warn && step >= 1 && step <= 3) burst(1500, 14, 0.035, 0.04); s.warn = step; }
      if (s.idle > w) { hallPlay.moves.push(TOO_SLOW); founder('Too slow on the lamps.'); }
    } else if ((s.phase === 'home' || s.phase === 'wreck') && s.t > 3.4) {
      if (s.saved >= MAX_SHIPS || s.wrecks >= MAX_WRECKS) {
        if (!s.ended) {
          s.ended = true; s.phase = 'done';
          const won = s.saved >= WIN;
          end({ won, score: s.saved, grade: (s.saved - WIN + 1) / (MAX_SHIPS - WIN + 1), line: `${s.saved} ship${s.saved === 1 ? '' : 's'} brought in, ${s.wrecks} on the rocks. ${won ? s.saved === MAX_SHIPS ? 'Not one lost after dark. Greywater will drink to you.' : 'Greywater sleeps easy tonight.' : `The harbour needed ${WIN}.`}` });
        }
      } else launch();
    }
    // Echo: the ship blinks back each lamp you get right.
    if (sh && s.echoT > 0) {
      s.echoT -= dt;
      const c = s.echoT > 0 ? LAMP_RGB[s.echo] : LANTERN;
      sh.lantern.color.copy(c); (sh.halo.material as THREE.SpriteMaterial).color.copy(c);
      sh.hsT = s.echoT > 0 ? 13 : 9;
    }
    // ---- Ships move.
    for (const x of ships) {
      if (!x.g.visible) continue;
      x.t += dt;
      let speed = 0;
      const prev = tmp.copy(x.pos);
      if (x.state === 'in') {
        const u = Math.min(1, x.t / 4.2), e = 1 - (1 - u) ** 3;
        x.pos.lerpVectors(x.from, x.to, e); speed = 1 - u;
        if (u >= 1) x.state = 'signal';
      } else if (x.state === 'home') {
        const u = Math.min(1, x.t / x.dur), e = u * u * (3 - 2 * u);
        if (x.path) x.path.getPointAt(e, x.pos); else x.pos.lerpVectors(x.from, x.to, e);
        speed = Math.sin(u * Math.PI);
        if (u >= 1) x.state = 'moored';
      } else if (x.state === 'wreck') {
        const u = Math.min(1, x.t / 1.8);
        if (u < 1) { x.pos.lerpVectors(x.from, x.to, u * u); speed = 1; x.roll = u * 0.3; }
        else {
          if (x.sink === 0) {
            boom(); creak(); s.shake = 1;
            spray.emit(tmp2.set(x.pos.x, 2, x.pos.z), 160, FOAM, 22, 0.4, 3.2, 1.6);
            x.lantern.color.copy(AFIRE);
          }
          x.sink = Math.min(1, x.sink + dt / 3.2);
          x.roll = 0.3 + x.sink * 1.1;
          if (Math.random() < dt * 12) spray.emit(tmp2.set(x.pos.x + (Math.random() - 0.5) * 14, 0, x.pos.z + (Math.random() - 0.5) * 6), 6, FOAM_DIM, 8, 0.6, 2.4, 1);
          if (x.sink >= 1) { x.state = 'sunk'; x.g.visible = false; }
        }
      }
      const dx = x.pos.x - prev.x, dz = x.pos.z - prev.z;
      if (Math.hypot(dx, dz) > 1e-4) {
        let want = Math.atan2(-dz, dx), d = want - x.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
        x.heading += d * (1 - Math.exp(-dt * 2.5)); want = 0; void want;
      } else if (x.state === 'signal' || x.state === 'moored') {
        // Lie broadside to the tower so her lantern shows.
        let d = (x.state === 'moored' ? Math.PI - 0.5 : Math.PI / 2 - 0.35) - x.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
        x.heading += d * (1 - Math.exp(-dt * 0.8));
      }
      const bob = Math.sin(now * 1.1 + x.seed) * 0.35;
      x.g.position.set(x.pos.x, -0.6 + bob - x.sink * 14, x.pos.z);
      x.g.rotation.set(Math.sin(now * 0.8 + x.seed) * 0.04 + x.roll, x.heading, Math.sin(now * 0.6 + x.seed * 2) * 0.03, 'YXZ');
      x.streak.position.set(x.g.position.x - Math.cos(x.heading) * 10.6, -0.85, x.g.position.z + Math.sin(x.heading) * 10.6);
      x.streak.visible = x.state !== 'wreck' && x.state !== 'sunk';
      (x.wake.material as THREE.MeshBasicMaterial).opacity = speed * 0.35;
      x.wake.position.set(x.g.position.x - Math.cos(x.heading) * 6, -0.8, x.g.position.z + Math.sin(x.heading) * 6);
      x.wake.rotation.z = x.heading;
      if (x.state === 'moored') { x.lantern.color.copy(LANTERN); x.hsT = 8 + Math.sin(now * 2 + x.seed) * 0.6; }
      x.hs += (x.hsT - x.hs) * (1 - Math.exp(-dt * 26));
      x.halo.scale.setScalar(x.hs);
    }
    // The current ship lights the water round her.
    if (shipLight.current) {
      const l = shipLight.current;
      if (sh && sh.g.visible && sh.state !== 'sunk') { l.visible = true; l.position.set(sh.g.position.x - Math.cos(sh.heading) * 10.6, 8, sh.g.position.z + Math.sin(sh.heading) * 10.6); l.color.copy(sh.lantern.color); s.shipI += ((s.phase === 'watch' ? 420 : 160) - s.shipI) * (1 - Math.exp(-dt * 6)); l.intensity = s.shipI; }
      else l.visible = false;
    }
    // ---- Lamps: a flare that fades, a light that jumps to the lamp you pressed; the next-wanted lamp is never hinted.
    for (let i = 0; i < 4; i++) {
      s.lampT[i] = Math.max(0, s.lampT[i] - dt * 2.6);
      const k = s.lampT[i];
      glasses[i].emissiveIntensity = 0.35 + k * 5;
      const hs = halos.current[i];
      if (hs) { hs.scale.setScalar(0.6 + k * 5.5); (hs.material as THREE.SpriteMaterial).opacity = 0.25 + k * 0.75; }
    }
    if (flash.current) {
      const k = s.lampT[s.lastLamp];
      flash.current.intensity = k * 220;
      flash.current.color.copy(LAMP_RGB[s.lastLamp]);
      flash.current.position.set(LAMP_X, TOP_Y + 4.2, lampZ(s.lastLamp));
    }
    if (beam.current) beam.current.rotation.y = now * 0.45;
    sparks.update(dt); spray.update(dt);
    // ---- Camera: on the tower behind the lamps; while she signals, it leans toward her and tightens.
    const watching = s.phase === 'watch' || s.phase === 'sail';
    const target = sh && watching ? tmp.set(sh.pos.x, 6, sh.pos.z) : LOOK;
    s.look.lerp(target, 1 - Math.exp(-dt * 1.6));
    lookW.set(room.x + THREE.MathUtils.lerp(LOOK.x, s.look.x, 0.55), THREE.MathUtils.lerp(LOOK.y, s.look.y, 0.55), room.z + THREE.MathUtils.lerp(LOOK.z, s.look.z, 0.55));
    const fov = s.phase === 'watch' ? 38 : 48;
    s.fov += (fov - s.fov) * (1 - Math.exp(-dt * 2));
    camPos.set(room.x + CAM.x + Math.sin(now * 0.3) * 0.15, CAM.y + Math.sin(now * 0.4) * 0.1, room.z + CAM.z);
    if (!s.placed) { s.placed = true; camera.position.copy(camPos); } else camera.position.lerp(camPos, 1 - Math.exp(-dt * 3));
    camera.lookAt(lookW);
    const pc = camera as THREE.PerspectiveCamera;
    if (Math.abs(pc.fov - s.fov) > 0.05) { pc.fov = s.fov; pc.updateProjectionMatrix(); }
    s.shake = Math.max(0, s.shake - dt * 1.3);
    if (s.shake > 0) { const t2 = s.shake * s.shake; camera.rotateX(Math.sin(now * 37) * t2 * 0.02); camera.rotateZ(Math.sin(now * 29 + 1) * t2 * 0.025); }
  });

  return (
    <group>
      <hemisphereLight args={['#e3c0b4', '#4a4552', 1.1]} />
      <directionalLight position={[200, 120, -60]} color="#d8b9c9" intensity={1.1} />
      <DuskSky center={[-200, 0, TZ]} />
      <Sea center={[-700, TZ]} size={2600} />
      <Tower />
      <Rocks />
      <Lighthouse beam={beam} />
      {ships.map((x, i) => <group key={i}><primitive object={x.g} /><primitive object={x.streak} /><primitive object={x.wake} /></group>)}
      {[0, 1, 2, 3].map((i) => (
        <group key={i} position={[0, TOP_Y, 0]}>
          <Lamp i={i} x={LAMP_X} z={lampZ(i)} glass={glasses[i]} post={2.3} onPress={() => press(i)} />
          <sprite ref={(m) => { halos.current[i] = m; }} position={[LAMP_X, 0.5 + 2.3 + 0.55, lampZ(i)]} scale={1}>
            <spriteMaterial map={halo()} color={LAMP_COLORS[i]} blending={THREE.AdditiveBlending} depthWrite={false} transparent toneMapped={false} fog={false} />
          </sprite>
        </group>
      ))}
      <pointLight ref={flash} distance={30} decay={1.5} intensity={0} />
      <pointLight ref={shipLight} distance={40} decay={1.4} intensity={160} />
      <primitive object={sparks.points} />
      <primitive object={spray.points} />
    </group>
  );
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function Hud() {
  const s = ui.use();
  return (
    <div className="game-hud sig-hud">
      <div className="sig-tally">
        <div className="pips">{Array.from({ length: MAX_SHIPS }, (_, i) => <i key={i} className={`${i < s.saved ? 'on' : ''} ${i === WIN - 1 ? 'mark' : ''}`} />)}</div>
        <div className="sig-wrecks">{Array.from({ length: MAX_WRECKS }, (_, i) => <b key={i} className={i < s.wrecks ? 'lost' : ''} />)}</div>
      </div>
      <div className="line">{s.line}</div>
      {(s.phase === 'answer' || s.phase === 'home') && (
        <div className="sig-seq">{Array.from({ length: s.len }, (_, i) => <i key={i} style={i < s.got.length ? { background: LAMP_COLORS[s.got[i]], boxShadow: `0 0 12px ${LAMP_COLORS[s.got[i]]}` } : undefined} />)}</div>
      )}
      {s.phase === 'answer' && <div className="sig-timer"><span ref={(el) => { timerEl = el; }} /></div>}
      <div className="hint sig-keys">{LAMP_COLORS.map((c, i) => <span key={i}><kbd>{i + 1}</kbd><em style={{ background: c }} /></span>)}<span className="or">or A S D F</span></div>
    </div>
  );
}

register({
  id: 'signals', name: 'Lantern Signals',
  pitch: 'Ships stand off the Teeth at dusk and flash a lantern sequence. Answer it on the tower’s four lamps to bring each one in. Every ship asks for more. Six home to win; three wrecks and you’re done.',
  keys: [['1 2 3 4', 'the lamps, left to right (A S D F or a click also work)'], ['Esc', 'leave']],
  entry: 400,
  Station, Play, Hud,
  view: () => ({ pos: [STATION[0], 6.4, STATION[1] + 9], look: [STATION[0], 2.6, STATION[1]] }),
});
