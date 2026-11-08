// The story in the world: mission givers standing by their yellow markers, the checkpoint pillars of a timed run,
// and a beam of light over wherever the current objective is. Also steps the story every frame.
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { walkY } from './bridges.ts';
import { crowd } from './collide.ts';
import { GIVERS, available, current, story, target, tickStory, type Giver } from './missions.ts';
import { me, play, usePlay } from './play.ts';

export const MARKER = '#ffd23f';

/** A glowing open cylinder that fades upward: the marker you walk into. */
function beamMaterial(color: string, strength = 1) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { c: { value: new THREE.Color(color) }, time: { value: 0 }, k: { value: strength } },
    vertexShader: 'varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform vec3 c; uniform float time; uniform float k; varying float vY; void main(){ float a = (1.-vY) * (0.55 + 0.25*sin(time*3.)) * k; a += smoothstep(0.08,0.,vY)*0.5*k; gl_FragColor = vec4(c*a, a); }',
  });
}
const cyl = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true).translate(0, 0.5, 0);
const ring = new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2);

export function StoryWorld() {
  const p = usePlay();
  if (p.mode !== 'play' || !p.seat) return null;
  return <Suspense fallback={null}><Story /></Suspense>;
}

function Story() {
  usePlay();
  const mats = useMemo(() => ({ corona: beamMaterial(MARKER), gate: beamMaterial(MARKER, 0.9), next: beamMaterial(MARKER, 0.35), pillar: beamMaterial(MARKER, 0.5) }), []);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: MARKER, transparent: true, opacity: 0.85, depthWrite: false }), []);
  const pillar = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    for (const m of Object.values(mats)) m.uniforms.time.value = clock.elapsedTime;
    tickStory();
    const t = target(), pl = pillar.current;
    const c = current();
    if (pl) {
      pl.visible = !!t && !c?.step.gates;
      if (t) pl.position.set(t[0], walkY(t[0], t[1]), t[1]);
    }
  });
  const open = new Set(available().map((m) => m.giver.id));
  const c = current();
  const gates = c?.step.gates?.() ?? [];
  const gi = story.run?.gate ?? 0;
  return (
    <group>
      {GIVERS.map((g) => <GiverFigure key={g.id} giver={g} open={!story.run && open.has(g.id)} mats={mats} ringMat={ringMat} />)}
      {gates.map(([x, z], i) => i >= gi && i <= gi + 1 && (
        <group key={i} position={[x, walkY(x, z), z]}>
          <mesh geometry={cyl} material={i === gi ? mats.gate : mats.next} scale={[6, 26, 6]} />
          <mesh geometry={ring} material={ringMat} scale={6} position-y={0.3} />
        </group>
      ))}
      <group ref={pillar}>
        <mesh geometry={cyl} material={mats.pillar} scale={[2.2, 160, 2.2]} />
        <mesh geometry={ring} material={ringMat} scale={4} position-y={0.3} />
      </group>
    </group>
  );
}

function GiverFigure({ giver, open, mats, ringMat }: { giver: Giver; open: boolean; mats: Record<string, THREE.ShaderMaterial>; ringMat: THREE.Material }) {
  const gltf = useGLTF(`/models/${giver.body}.glb`);
  const [cx, cz] = giver.at;
  const fx = cx - Math.sin(giver.face) * 3.6, fz = cz - Math.cos(giver.face) * 3.6;
  const obj = useMemo(() => {
    const o = cloneSkinned(gltf.scene);
    o.scale.setScalar(2.2);
    o.traverse((x) => { if ((x as THREE.Mesh).isMesh) { x.castShadow = true; x.frustumCulled = false; } });
    const clip = gltf.animations[0];
    if (clip) { const mx = new THREE.AnimationMixer(o); const a = mx.clipAction(clip); a.play(); a.time = clip.duration * 0.02; mx.update(0); }
    o.position.set(fx, walkY(fx, fz), fz);
    o.rotation.y = giver.face;
    // A Warden's colours, so two who share a figure don't look alike.
    if (giver.tint) {
      const t = new THREE.Color(giver.tint);
      o.traverse((x) => {
        const m = x as THREE.Mesh;
        if (!m.isMesh) return;
        m.material = (Array.isArray(m.material) ? m.material : [m.material]).map((mt) => {
          const c = (mt as THREE.MeshStandardMaterial).clone();
          if (c.color) c.color.lerp(t, 0.42);
          return c;
        }) as unknown as THREE.Material;
        if ((m.material as unknown as THREE.Material[]).length === 1) m.material = (m.material as unknown as THREE.Material[])[0];
      });
    }
    return o;
  }, [gltf, fx, fz, giver.face, giver.tint]);
  const plate = useMemo(() => nameplate(giver), [giver]);
  const plateRef = useRef<THREE.Sprite>(null);
  useEffect(() => { crowd.add(obj); return () => { crowd.delete(obj); }; }, [obj]);
  const breathe = useRef(0);
  useFrame((_, dt) => {
    breathe.current += dt; obj.scale.y = 2.2 * (1 + Math.sin(breathe.current * 1.7) * 0.006);
    // The nameplate shows when you're close enough to talk.
    const p = plateRef.current;
    if (p) { const d = Math.hypot(me.x - fx, me.z - fz); p.visible = d < 60 && play.inside < 0; (p.material as THREE.SpriteMaterial).opacity = Math.min(1, (60 - d) / 15); }
  });
  return (
    <group>
      <primitive object={obj} />
      <sprite ref={plateRef} material={plate} position={[fx, walkY(fx, fz) + 5.3, fz]} scale={[giver.title ? 7.2 : 5.4, giver.title ? 1.8 : 1.1, 1]} renderOrder={5} />
      {open && (
        <group position={[cx, walkY(cx, cz), cz]}>
          <mesh geometry={cyl} material={mats.corona} scale={[1.7, 3.2, 1.7]} />
          <mesh geometry={ring} material={ringMat} scale={1.7} position-y={0.12} />
        </group>
      )}
    </group>
  );
}

/** "Stepan Gershuni / Warden of the Gate" on a little parchment ribbon over their head. */
function nameplate(g: Giver) {
  const c = document.createElement('canvas');
  const W = 512, H = g.title ? 128 : 78;
  c.width = W; c.height = H;
  const x = c.getContext('2d')!;
  x.textAlign = 'center';
  x.shadowColor = 'rgba(0,0,0,0.95)'; x.shadowBlur = 8;
  x.font = '700 40px "Cinzel", Georgia, serif';
  x.fillStyle = '#fff3d6';
  x.fillText(g.name, W / 2, 48);
  if (g.title) {
    x.font = 'italic 30px Georgia, serif';
    x.fillStyle = '#ffd23f';
    x.fillText(g.title, W / 2, 96);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false });
}

export { story };
