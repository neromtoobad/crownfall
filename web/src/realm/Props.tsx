// Generated models (public/env/*.glb) placed many times as one instanced mesh each.
// Every placement is a box: the model is stretched to fill it, base on the ground, centred on x/z.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { surfaced } from './materials.ts';

export interface Place { x: number; y: number; z: number; ry: number; sx: number; sy: number; sz: number }

export function Props({ name, items, shadows = true }: { name: string; items: Place[]; shadows?: boolean }) {
  const gltf = useGLTF(`/env/${name}.glb`);
  const { geo, mat, size, centre } = useMemo(() => {
    let mesh: THREE.Mesh | undefined;
    gltf.scene.traverse((o) => { if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh; });
    const geo = mesh!.geometry.clone();
    gltf.scene.updateMatrixWorld(true);
    geo.applyMatrix4(mesh!.matrixWorld);
    geo.computeBoundingBox();
    const b = geo.boundingBox!, size = b.getSize(new THREE.Vector3()), centre = b.getCenter(new THREE.Vector3());
    const mat = (mesh!.material as THREE.MeshStandardMaterial).clone();
    mat.roughness = Math.max(mat.roughness, 0.85);
    mat.metalness = 0;
    // Blender props (design/blender) carry a surface tag: give them the realm's wood and stone grain.
    if (name.startsWith('props/')) surfaced(mat, geo);
    return { geo, mat, size, centre };
  }, [gltf, name]);
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const norm = new THREE.Matrix4().makeTranslation(-centre.x, -(centre.y - size.y / 2), -centre.z);
    const t = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    items.forEach((p, i) => {
      t.compose(new THREE.Vector3(p.x, p.y, p.z), q.setFromAxisAngle(up, p.ry), new THREE.Vector3(p.sx / size.x, p.sy / size.y, p.sz / size.z));
      m.setMatrixAt(i, t.multiply(norm));
    });
    m.count = items.length;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items, centre, size]);
  return <instancedMesh ref={ref} args={[geo, mat, Math.max(1, items.length)]} castShadow={shadows} receiveShadow frustumCulled={false} />;
}
