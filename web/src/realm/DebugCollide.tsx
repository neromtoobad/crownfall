// ?debug=collide draws every solid shape as a red outline on the ground, to check it against what you see.
import { useMemo } from 'react';
import * as THREE from 'three';
import { ALL } from './collide.ts';
import { walkY } from './bridges.ts';

export const DEBUG_COLLIDE = import.meta.env.DEV && new URLSearchParams(location.search).get('debug') === 'collide';

export function DebugCollide() {
  const geo = useMemo(() => {
    const pts: number[] = [];
    const seg = (ax: number, az: number, bx: number, bz: number) => pts.push(ax, walkY(ax, az) + 0.4, az, bx, walkY(bx, bz) + 0.4, bz);
    for (const s of ALL) {
      if (s.kind === 'circle') {
        if (s.soft) continue;
        for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, b = ((i + 1) / 16) * Math.PI * 2; seg(s.x + Math.cos(a) * s.r, s.z + Math.sin(a) * s.r, s.x + Math.cos(b) * s.r, s.z + Math.sin(b) * s.r); }
      } else {
        const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => { const lx = u * s.hx, lz = v * s.hz; return [s.x + lx * s.c + lz * s.s, s.z - lx * s.s + lz * s.c]; });
        for (let i = 0; i < 4; i++) seg(c[i][0], c[i][1], c[(i + 1) % 4][0], c[(i + 1) % 4][1]);
      }
    }
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }, []);
  return <lineSegments geometry={geo}><lineBasicMaterial color="#ff2a2a" depthTest={false} /></lineSegments>;
}
