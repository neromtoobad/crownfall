// ?view=<model> shows one character up close, walking on the spot, for checking models.
import { Suspense, useEffect, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Bounds, ContactShadows, Environment, OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';

function Figure({ url }: { url: string }) {
  const gltf = useGLTF(url);
  const mixer = useMemo(() => new THREE.AnimationMixer(gltf.scene), [gltf]);
  useEffect(() => {
    gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    if (gltf.animations[0]) mixer.clipAction(gltf.animations[0]).play();
  }, [gltf, mixer]);
  useFrame((_, dt) => mixer.update(dt));
  return <primitive object={gltf.scene} />;
}

export function Viewer({ name }: { name: string }) {
  const url = `/models/${name}.glb`;
  return (
    <Canvas shadows camera={{ position: [2.2, 1.6, 3.2], fov: 35 }} gl={{ toneMapping: THREE.ACESFilmicToneMapping }}>
      <color attach="background" args={['#2a241e']} />
      <hemisphereLight args={['#f3dcc0', '#2a2a2a', 0.7]} />
      <directionalLight position={[3, 5, 2]} intensity={2.4} castShadow />
      <Suspense fallback={null}>
        <Environment preset="sunset" />
        <Figure url={url} />
        <ContactShadows opacity={0.6} scale={6} blur={2} far={3} />
      </Suspense>
      <OrbitControls target={[0, 0.95, 0]} />
    </Canvas>
  );
}

/** ?env=<name> shows one environment model (public/env/<name>.glb), framed to fit, for checking. */
export function EnvViewer({ name }: { name: string }) {
  const gltf = useGLTF(`/env/${name}.glb`);
  return (
    <Canvas shadows camera={{ position: [2.6, 1.8, 2.6], fov: 35 }} gl={{ toneMapping: THREE.ACESFilmicToneMapping }}>
      <color attach="background" args={['#2a241e']} />
      <hemisphereLight args={['#f3dcc0', '#2a2a2a', 0.7]} />
      <directionalLight position={[3, 5, 2]} intensity={2.4} castShadow />
      <Suspense fallback={null}>
        <Environment preset="sunset" />
        <Bounds fit observe margin={1.15}><primitive object={gltf.scene} /></Bounds>
      </Suspense>
      <OrbitControls makeDefault />
    </Canvas>
  );
}
