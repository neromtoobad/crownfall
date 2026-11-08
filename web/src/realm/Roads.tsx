// Dirt roads draped over the ground, and the Lazzarin Bridge where the east road crosses the river.
import { useMemo } from 'react';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { walkY } from './bridges.ts';
import AVG from './texAvg.json';

// The dirt texture adds detail only: tint = the road colour we want / the texture's own mean colour.
const ROAD = new THREE.Color('#b09670');
const TINT = new THREE.Color().setRGB(ROAD.r / AVG.dirt[0], ROAD.g / AVG.dirt[1], ROAD.b / AVG.dirt[2]);
import { ROADS, roadCurve } from './layout.ts';

function ribbon(curve: THREE.Curve<THREE.Vector3>, width: number, lift: number) {
  const n = Math.max(20, Math.floor(curve.getLength() / 2.5));
  const pts = curve.getSpacedPoints(n);
  const pos: number[] = [], idx: number[] = [], uv: number[] = [];
  for (let i = 0; i <= n; i++) {
    const p = pts[i], q = pts[Math.min(n, i + 1)], r = pts[Math.max(0, i - 1)];
    const dx = q.x - r.x, dz = q.z - r.z, l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l, nz = dx / l;
    for (const s of [-1, 1]) {
      const x = p.x + nx * width * 0.5 * s, z = p.z + nz * width * 0.5 * s;
      pos.push(x, walkY(x, z) + lift, z);
      uv.push(s < 0 ? 0 : 0.7, (i * curve.getLength()) / n / 10); // one texture tile per 10 units
    }
    if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function Roads() {
  const geos = useMemo(() => ROADS.map((r) => ribbon(roadCurve(r), 7, 0.4)), []);
  const dirt = useTexture('/tex/dirt.jpg');
  useMemo(() => { dirt.wrapS = dirt.wrapT = THREE.MirroredRepeatWrapping; dirt.colorSpace = THREE.SRGBColorSpace; dirt.anisotropy = 8; dirt.needsUpdate = true; }, [dirt]);
  return (
    <group>
      {geos.map((g, i) => (
        <mesh key={i} geometry={g} receiveShadow>
          <meshStandardMaterial map={dirt} color={TINT} roughness={1} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-4} polygonOffsetUnits={-4} />
        </mesh>
      ))}
    </group>
  );
}
