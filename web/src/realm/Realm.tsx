// The whole realm in one canvas: sky, light, land, water, forests, roads, castles, labels and the camera.
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, MapControls, PerformanceMonitor, Sky, useGLTF, useTexture } from '@react-three/drei';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import * as THREE from 'three';
import type { MapControls as MapControlsImpl } from 'three-stdlib';
import { Terrain, Water } from './Terrain.tsx';
import { Forest } from './Forest.tsx';
import { Roads } from './Roads.tsx';
import { Buildings } from './Buildings.tsx';
import { ground } from './heights.ts';
import './bridges.ts'; // places the Lazzarin Bridge label
import { CAPITAL, HOUSES, LANDMARKS } from './layout.ts';
import { Market } from './Market.tsx';
import { Grass } from './Grass.tsx';
import { Birds } from './Birds.tsx';
import { Smoke } from './Smoke.tsx';
import { tickWind } from './wind.ts';
import { tickAmbience } from './ambience.ts';
import { LOW, markReady, me, play, usePlay } from './play.ts';

// Models are Draco-compressed; the decoder is served from this site (public/draco), not a CDN.
useGLTF.setDecoderPath('/draco/');
// Phones get the characters with 512 px textures (public/models/lo), desktops the sharper 1024 px set. One switch here
// rather than at every place a character loads.
if (LOW) THREE.DefaultLoadingManager.setURLModifier((u) => (u.startsWith('/models/') && !u.startsWith('/models/lo/') ? '/models/lo/' + u.slice(8) : u));
// The land, all requested at once: otherwise each part only asks for its files once the part before it has loaded.
['grass', 'dirt', 'rock', 'wheat', 'sand', 'marsh'].forEach((n) => useTexture.preload(`/tex/${n}.jpg`));
['keep', 'throne-hall', 'tower', 'wall', 'townhouse', 'cottage'].forEach((n) => useGLTF.preload(`/env/${n}.glb`));

// The post effects (and their library) load only where they're used: not on phones.
const PostFX = lazy(() => import('./PostFX.tsx'));

/** Mounts once the land's boundary has resolved: the loading screen can lift. */
function Ready() { useEffect(() => { markReady(); }, []); return null; }
import { DEBUG_COLLIDE, DebugCollide } from './DebugCollide.tsx';
import { HallWorld } from './Hall.tsx';
import { KeepDoors } from './KeepDoors.tsx';
import { GameStage } from '../games/Stage.tsx';

// ?cam=x,y,z,tx,ty,tz starts the camera anywhere (y values are heights above the ground), for checks and recording.
const camQ = new URLSearchParams(location.search).get('cam')?.split(',').map(Number);
const START = camQ?.length === 6
  ? { pos: [camQ[0], ground(camQ[0], camQ[2]) + camQ[1], camQ[2]] as [number, number, number], target: [camQ[3], ground(camQ[3], camQ[5]) + camQ[4], camQ[5]] as [number, number, number] }
  : { pos: [380, 520, 760] as [number, number, number], target: [0, 0, 60] as [number, number, number] };

const SUN = new THREE.Vector3(-0.6, 0.42, 0.5).normalize();
const focusAt = new THREE.Vector3();

export interface Focus { x: number; z: number; dist: number }

export function Realm({ focus, onPick, children }: { focus?: Focus; onPick: (house: number | 'capital') => void; children?: React.ReactNode }) {
  // Phones start sharp and give up resolution when frames fall behind (and take it back when they recover).
  const [dpr, setDpr] = useState(1.5);
  return (
    <Canvas shadows dpr={LOW ? Math.min(dpr, devicePixelRatio) : [1, 1.5]} camera={{ fov: 42, near: 1, far: 6000, position: START.pos }} gl={{ antialias: LOW, stencil: false, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}>
      <color attach="background" args={['#c9b79a']} />
      {LOW && <PerformanceMonitor bounds={() => [42, 58]} flipflops={4} onDecline={() => setDpr((d) => Math.max(0.85, +(d - 0.25).toFixed(2)))} onIncline={() => setDpr((d) => Math.min(1.5, +(d + 0.25).toFixed(2)))} />}
      <Haze />
      <Outdoors><Sky sunPosition={SUN.clone().multiplyScalar(1000)} turbidity={4.5} rayleigh={2.2} mieCoefficient={0.004} mieDirectionalG={0.86} /></Outdoors>
      {/* Warm sun, cool sky fill, warm ground bounce: shadows go blue, never black. Indoors the fill drops away and the
          hall is lit by its fires and the sun through its windows. */}
      <SkyFill />
      <Sunlight />
      <WindClock />
      <SoftFill />
      <Suspense fallback={null}><HallWorld /><GameStage /><KeepDoors /></Suspense>
      {/* Each part of the land arrives on its own, so the realm shows as soon as the ground and keeps are in. */}
      <Outdoors>
        <Suspense fallback={null}><Terrain /><Water /><Roads /><Buildings /><Ready /></Suspense>
        <Suspense fallback={null}><Forest /></Suspense>
        <Suspense fallback={null}><Market /></Suspense>
        <Suspense fallback={null}><Grass /><Birds /><Smoke /></Suspense>
        {DEBUG_COLLIDE && <DebugCollide />}
      </Outdoors>
      <Suspense fallback={null}>{children}</Suspense>
      <Labels onPick={onPick} />
      <Camera focus={focus} />
      {!LOW && <Suspense fallback={null}><PostFX /></Suspense>}
    </Canvas>
  );
}

/** Everything outside the halls: hidden (not unmounted) while you are inside one. */
export function Outdoors({ children }: { children: React.ReactNode }) {
  const inside = usePlay().inside >= 0;
  return <group visible={!inside}>{children}</group>;
}

function SkyFill() {
  const inside = usePlay().inside >= 0;
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    scene.environmentIntensity = inside ? 0.06 : 0.3;
    scene.background = new THREE.Color(inside ? '#120d0a' : '#c9b79a');
  }, [inside, scene]);
  return <hemisphereLight args={inside ? ['#7d7468', '#22180f', 0.12] : ['#b8c8dc', '#6b5a3e', 0.85]} />;
}

/** A low golden sun whose shadow box follows the camera's target, so shadows stay sharp up close. */
function Sunlight() {
  const light = useRef<THREE.DirectionalLight>(null);
  const controls = useThree((s) => s.controls) as unknown as MapControlsImpl | null;
  const frame = useRef(0);
  useFrame(({ camera, gl }) => {
    const l = light.current;
    if (!l) return;
    // In play the shadow box rides with you and stays tight, so every fence post and face gets a crisp shadow.
    // Far out on the map, only tiny figures move: redraw the shadow map every third frame.
    const playing = play.mode === 'play';
    const t = playing ? focusAt.set(me.x, 0, me.z) : controls?.target ?? focusAt.set(0, 0, 0);
    const far = !playing && camera.position.distanceTo(t) > 450;
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = !far || frame.current++ % 3 === 0;
    const span = playing ? (play.driving ? 150 : 95) : THREE.MathUtils.clamp(camera.position.distanceTo(t) * 0.9, 120, 1100);
    l.position.copy(t).addScaledVector(SUN, 1200);
    l.target.position.copy(t);
    l.target.updateMatrixWorld();
    const cam = l.shadow.camera;
    if (Math.abs(cam.right - span) > 5) { cam.left = -span; cam.right = span; cam.top = span; cam.bottom = -span; cam.updateProjectionMatrix(); }
  });
  return <directionalLight ref={light} color="#ffd29a" intensity={3.3} castShadow shadow-mapSize={LOW ? [1536, 1536] : [4096, 4096]} shadow-bias={-0.0004} shadow-normalBias={0.6} shadow-camera-far={3000} />;
}

/** The realm's one wind (wind.ts) and the sound of where you stand (ambience.ts), wound on with the frame clock. */
function WindClock() {
  useFrame(({ clock }) => {
    tickWind(clock.elapsedTime, me.x, me.z);
    tickAmbience(clock.elapsedTime, me.x, me.z, play.driving ? Math.abs(me.car.v) : 0, play.mode === 'play');
  });
  return null;
}

/** A dim studio environment so PBR characters keep readable faces when they walk into the sun. */
function SoftFill() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.3;
    if (import.meta.env.DEV) Object.assign(window, { __gl: gl, __scene: scene });
    return () => { scene.environment = null; env.dispose(); pm.dispose(); };
  }, [gl, scene]);
  return null;
}

/** Fly the camera to a seat when one is picked. */
function Camera({ focus }: { focus?: Focus }) {
  const controls = useRef<MapControlsImpl>(null);
  const goal = useRef<{ target: THREE.Vector3; pos: THREE.Vector3 } | null>(null);
  const { camera } = useThree();
  useEffect(() => {
    if (!focus) return;
    const target = new THREE.Vector3(focus.x, ground(focus.x, focus.z), focus.z);
    const dir = new THREE.Vector3(0.45, 0.62, 0.9).normalize();
    goal.current = { target, pos: target.clone().addScaledVector(dir, focus.dist) };
  }, [focus?.x, focus?.z, focus?.dist]);
  useFrame((_, dt) => {
    const c = controls.current, g = goal.current;
    if (!c || !g) return;
    const k = 1 - Math.exp(-dt * 2.2);
    c.target.lerp(g.target, k);
    camera.position.lerp(g.pos, k);
    if (camera.position.distanceTo(g.pos) < 0.5) goal.current = null;
    c.update();
  });
  // In play mode the camera is yours (Player.tsx); the map controls come back where you left off.
  const mode = usePlay().mode;
  const last = useRef<[number, number, number]>(START.target);
  if (mode === 'play') {
    last.current = [me.x, ground(me.x, me.z), me.z];
    return null;
  }
  return (
    <MapControls ref={controls} makeDefault target={last.current} minDistance={18} maxDistance={1500} maxPolarAngle={1.32} enableDamping dampingFactor={0.08} screenSpacePanning={false}
      onStart={() => { goal.current = null; }} />
  );
}

/** A map label that keeps a readable size: it shrinks a little with distance and fades out beyond `far`. */
function Tag({ position, far, z, children }: { position: [number, number, number]; far: number; z: number; children: React.ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  const at = new THREE.Vector3(...position);
  useFrame(({ camera }) => {
    const d = camera.position.distanceTo(at), e = el.current;
    if (!e) return;
    const s = THREE.MathUtils.clamp(520 / d, 0.62, 1);
    const o = THREE.MathUtils.clamp((far - d) / (far * 0.25), 0, 1);
    e.style.transform = `scale(${s.toFixed(3)})`;
    e.style.opacity = o.toFixed(2);
    e.style.visibility = o < 0.02 ? 'hidden' : 'visible';
  });
  return <Html position={position} center zIndexRange={[z, 0]}><div ref={el} className="tag">{children}</div></Html>;
}

function Labels({ onPick }: { onPick: (house: number | 'capital') => void }) {
  // In play the world speaks for itself: the radar, the markers and the area name do this job.
  const { mode, inside } = usePlay();
  if (mode === 'play' || inside >= 0) return null;
  return (
    <group>
      {HOUSES.map((h) => (
        <Tag key={h.id} position={[h.pos[0], ground(h.pos[0], h.pos[1]) + 54, h.pos[1]]} far={2400} z={20}>
          <button className="seat" onClick={() => onPick(h.id)} style={{ ['--c' as string]: h.colors[0], ['--c2' as string]: h.colors[1] }}>
            <i />
            <span><b>House {h.name}</b><small>{h.seat}</small></span>
          </button>
        </Tag>
      ))}
      <Tag position={[CAPITAL.pos[0] + 35, 70, CAPITAL.pos[1] - 40]} far={2400} z={20}>
        <button className="seat capital" onClick={() => onPick('capital')}><span><b>Emberfall</b><small>the Ashen Throne</small></span></button>
      </Tag>
      {LANDMARKS.map((l) => (
        <Tag key={l.name} position={[l.pos[0], ground(l.pos[0], l.pos[1]) + 14, l.pos[1]]} far={700} z={10}>
          <div className="landmark"><b>{l.name}</b><small>{l.note}</small></div>
        </Tag>
      ))}
    </group>
  );
}

/** Air between you and the hills. On the map it only softens the far edge; on foot it starts close, so the
 * distance goes warm and pale and the near ground stays rich: the oldest trick for depth. */
function Haze() {
  const scene = useThree((s) => s.scene);
  const { mode, inside } = usePlay();
  useEffect(() => {
    scene.fog = inside >= 0 ? new THREE.Fog('#1a130e', 45, 240) : mode === 'play' ? new THREE.Fog('#d8c6a6', 90, 1150) : new THREE.Fog('#c9b49a', 700, 2600);
  }, [scene, mode, inside]);
  return null;
}

