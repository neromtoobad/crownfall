// The Ashen Throne: the empty seat every house in Vael is fighting for, on its eight-sided dais before the throne
// hall in Emberfall. Modelled in code in Blender (design/blender/throne.py -> public/env/throne.glb, Draco).
import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { ground } from './heights.ts';
import { CAPITAL } from './layout.ts';
import { FireLight, Flames, type FlameSpot } from './fire.tsx';

/** Where it stands (the dais centre) and the dais's reach, for collisions and the town's layout. */
export const THRONE = { x: CAPITAL.pos[0] + 35, z: CAPITAL.pos[1] - 14.5, r: 11, scale: 1.35 };
const BRAZIERS: [number, number][] = [[-3.3, 2.9], [3.3, 2.9]]; // x, z in the model; coals at y 4.8

export function Throne() {
  const gltf = useGLTF('/env/throne.glb', '/draco/');
  // Sit the dais on the lowest ground under it, so no corner floats.
  const y = useMemo(() => {
    let lo = Infinity;
    for (let a = 0; a < 16; a++) for (const r of [0, 5, 10.5]) lo = Math.min(lo, ground(THRONE.x + Math.sin(a / 16 * Math.PI * 2) * r, THRONE.z + Math.cos(a / 16 * Math.PI * 2) * r));
    return lo - 0.05;
  }, []);
  const scene = useMemo(() => {
    const s = gltf.scene.clone(true);
    s.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = m.receiveShadow = true;
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      // The realm's sky light is faint (environmentIntensity 0.3): metal needs more of it to read as metal.
      if (/gold/.test(m.name)) mat.envMapIntensity = 3.2;
      else if (/iron|ash/.test(m.name)) mat.envMapIntensity = 2.0;
      m.material = mat;
    });
    return s;
  }, [gltf]);
  // The flame shader places each flame in world space (it ignores the parent's transform), so these are world spots.
  const flames: FlameSpot[] = useMemo(() => {
    const k = THRONE.scale, at = (x: number, z: number, s: number): FlameSpot => [THRONE.x + x * k, y + 4.8 * k, THRONE.z + z * k, s * k];
    return BRAZIERS.flatMap(([x, z]) => [at(x, z, 0.85), at(x + 0.2, z - 0.12, 0.55), at(x - 0.2, z + 0.1, 0.6)]);
  }, [y]);
  return (
    <group>
    <Flames spots={flames} />
    <group position={[THRONE.x, y, THRONE.z]} scale={THRONE.scale}>
      <primitive object={scene} />
      <FireLight position={[0, 6.5, 4.5]} intensity={260} distance={22} />
    </group>
    </group>
  );
}
useGLTF.preload('/env/throne.glb', '/draco/');
