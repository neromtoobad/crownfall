// The way into every keep: a great timber door in a stone arch on the face toward the capital, torches burning
// either side and a warm glow on the step, so from the green you can tell a hall is open to you.
import { useMemo } from 'react';
import * as THREE from 'three';
import { ground } from './heights.ts';
import { HOUSES } from './layout.ts';
import { doorOf, libDoor } from './rooms.ts';
import { Flames, type FlameSpot } from './fire.tsx';
import { usePlay } from './play.ts';
import { sigilTexture } from './sigils.ts';

export function KeepDoors() {
  const p = usePlay();
  const doors = useMemo(() => HOUSES.map((h) => ({ h, ...doorOf(h), y: ground(...h.pos) - 0.5 })), []);
  const lib = useMemo(libDoor, []);
  const flames = useMemo(() => [...doors.map((d) => ({ ...d, k: 1 })), { ...lib, k: 0.55 }].flatMap(({ x, z, face, y, k }) => [-1, 1].map((s): FlameSpot => {
    const rx = Math.cos(face), rz = -Math.sin(face);
    return [x + rx * s * 4.6 * k + Math.sin(face) * 0.9 * k, y + 7.3 * k, z + rz * s * 4.6 * k + Math.cos(face) * 0.9 * k, 0.9 * k];
  })), [doors, lib]);
  if (p.mode !== 'play' || p.inside >= 0) return null;
  return (
    <group>
      {doors.map(({ h, x, z, face, y }) => (
        <group key={h.id} position={[x, y, z]} rotation-y={face}>
          {/* The arch: two jambs and a lintel, proud of the keep's face. */}
          {[-1, 1].map((s) => <mesh key={s} position={[s * 3.9, 4.6, 0.3]} castShadow receiveShadow><boxGeometry args={[1.4, 9.2, 1.6]} /><meshStandardMaterial color="#8a8073" roughness={0.9} /></mesh>)}
          <mesh position={[0, 9.6, 0.3]} castShadow><boxGeometry args={[9.2, 1.4, 1.7]} /><meshStandardMaterial color="#8a8073" roughness={0.9} /></mesh>
          {/* Two oak leaves, iron-banded. */}
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 1.6, 4.45, -0.1]}>
              <mesh castShadow><boxGeometry args={[3.2, 8.9, 0.45]} /><meshStandardMaterial color="#4a3020" roughness={0.85} /></mesh>
              {[-2.8, 0, 2.8].map((yy) => <mesh key={yy} position={[0, yy, 0.25]}><boxGeometry args={[3.1, 0.28, 0.08]} /><meshStandardMaterial color="#1f1c1a" metalness={0.6} roughness={0.5} /></mesh>)}
              <mesh position={[-s * 1.1, -0.4, 0.33]} rotation-x={Math.PI / 2}><torusGeometry args={[0.32, 0.06, 6, 16]} /><meshStandardMaterial color="#1f1c1a" metalness={0.6} roughness={0.5} /></mesh>
            </group>
          ))}
          {/* The house banner over the door. */}
          <mesh position={[0, 15.5, 0.5]}><planeGeometry args={[3.6, 7.8]} /><meshStandardMaterial map={sigilTexture(h.id)} side={THREE.DoubleSide} roughness={0.9} /></mesh>
          {/* Torch brackets. */}
          {[-1, 1].map((s) => <mesh key={s} position={[s * 4.6, 6.6, 0.9]} castShadow><cylinderGeometry args={[0.16, 0.1, 1.3, 6]} /><meshStandardMaterial color="#3a2a1c" /></mesh>)}
          <pointLight position={[0, 6, 3]} color="#ffa25a" intensity={420} distance={26} decay={1.6} />
          {/* A warm ring on the step: walk into it. */}
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.62, 3]}><ringGeometry args={[2.6, 3, 40]} /><meshBasicMaterial color="#ffd23f" transparent opacity={0.6} depthWrite={false} /></mesh>
        </group>
      ))}
      {/* The Library's door: smaller, bronze-bound, set into the drum between two columns. */}
      <group position={[lib.x, lib.y, lib.z]} rotation-y={lib.face} scale={0.55}>
        {[-1, 1].map((s) => <mesh key={s} position={[s * 3.9, 4.6, 0.3]} castShadow><boxGeometry args={[1.4, 9.2, 1.6]} /><meshStandardMaterial color="#a39580" roughness={0.9} /></mesh>)}
        <mesh position={[0, 9.6, 0.3]} castShadow><boxGeometry args={[9.2, 1.4, 1.7]} /><meshStandardMaterial color="#a39580" roughness={0.9} /></mesh>
        {[-1, 1].map((s) => (
          <group key={s} position={[s * 1.6, 4.45, -0.1]}>
            <mesh castShadow><boxGeometry args={[3.2, 8.9, 0.45]} /><meshStandardMaterial color="#3a2418" roughness={0.8} /></mesh>
            {[-2.8, 0, 2.8].map((yy) => <mesh key={yy} position={[0, yy, 0.25]}><boxGeometry args={[3.1, 0.28, 0.08]} /><meshStandardMaterial color="#b08a3e" metalness={0.8} roughness={0.35} /></mesh>)}
          </group>
        ))}
        {[-1, 1].map((s) => <mesh key={s} position={[s * 4.6, 6.6, 0.9]}><cylinderGeometry args={[0.16, 0.1, 1.3, 6]} /><meshStandardMaterial color="#3a2a1c" /></mesh>)}
        <pointLight position={[0, 6, 5]} color="#ffb070" intensity={140} distance={22} decay={1.6} />
      </group>
      <mesh rotation-x={-Math.PI / 2} position={[lib.out[0], lib.y + 0.06, lib.out[1]]}><ringGeometry args={[1.8, 2.15, 40]} /><meshBasicMaterial color="#ffd23f" transparent opacity={0.6} depthWrite={false} /></mesh>
      <Flames spots={flames} />
    </group>
  );
}
