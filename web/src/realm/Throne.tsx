// The Ashen Throne: the empty seat every house in Vael is fighting for, on its eight-sided dais. It stands at the far
// end of the throne hall in Emberfall (ThroneRoom.tsx). Modelled in code in Blender
// (design/blender/throne.py -> public/env/throne.glb, Draco). Model frame: dais centre on the floor, facing +z.
import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { FireLight, Flames, type FlameSpot } from './fire.tsx';

/** The braziers on the dais's top tier (x, z in the model; their coals are at y 4.8). */
const BRAZIERS: [number, number][] = [[-3.3, 2.9], [3.3, 2.9]];
/** The model's size: the dais's reach from its centre, the stair's front, the top of the shards. */
export const THRONE_SIZE = { r: 8, front: 9.8, top: 19.7 };

/** `glow` lifts the metal's reflections indoors, where the realm's sky light is almost nothing. */
export function ThroneModel({ scale = 1, glow = 1 }: { scale?: number; glow?: number }) {
  const gltf = useGLTF('/env/throne.glb', '/draco/');
  const scene = useMemo(() => {
    const s = gltf.scene.clone(true);
    s.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = m.receiveShadow = true;
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      if (/gold/.test(m.name)) mat.envMapIntensity = 3.2 * glow;
      else if (/iron|ash/.test(m.name)) mat.envMapIntensity = 2.0 * glow;
      m.material = mat;
    });
    return s;
  }, [gltf, glow]);
  // A flame's size is in world units (the shader doesn't scale it), so it takes the model's scale by hand.
  const flames: FlameSpot[] = useMemo(() => BRAZIERS.flatMap(([x, z]) => [[x, 4.8, z, 0.85 * scale], [x + 0.2, 4.8, z - 0.12, 0.55 * scale], [x - 0.2, 4.8, z + 0.1, 0.6 * scale]] as FlameSpot[]), [scale]);
  return (
    <group scale={scale}>
      <primitive object={scene} />
      <Flames spots={flames} />
      {BRAZIERS.map(([x, z], i) => <FireLight key={i} position={[x, 6, z]} intensity={220} distance={30} />)}
    </group>
  );
}
useGLTF.preload('/env/throne.glb', '/draco/');
