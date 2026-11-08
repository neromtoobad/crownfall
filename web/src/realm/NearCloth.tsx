// NEAR banners and flags, instanced: one draw call per kind wherever they hang in the realm.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { bannerTexture, clothMaterial, flagTexture } from './near.ts';

/** Where a piece of cloth hangs: the top-centre of a banner or the top of a flag's pole, its facing, and its size. */
export interface Cloth { x: number; y: number; z: number; ry: number; w: number; h: number }

/** The wind blows the same way over the whole realm, so every flag streams the same way. */
export const WIND = 0.7;

const bannerGeo = new THREE.PlaneGeometry(1, 1, 6, 14).translate(0, -0.5, 0);
const flagGeo = new THREE.PlaneGeometry(1, 1, 16, 4).translate(0.5, -0.5, 0);
const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 1, 6).translate(0, -0.5, 0);
const o = new THREE.Object3D();

function useInstances(ref: React.RefObject<THREE.InstancedMesh>, items: Cloth[], set: (c: Cloth, o: THREE.Object3D) => void) {
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    items.forEach((c, i) => { o.position.set(c.x, c.y, c.z); o.rotation.set(0, c.ry, 0); o.scale.set(1, 1, 1); set(c, o); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function NearBanners({ items }: { items: Cloth[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const mat = useMemo(() => clothMaterial(bannerTexture(), 'banner'), []);
  useInstances(ref, items, (c, ob) => ob.scale.set(c.w, c.h, c.w));
  useFrame(({ clock }) => { mat.userData.u.time.value = clock.elapsedTime; });
  return <instancedMesh ref={ref} args={[bannerGeo, mat, items.length]} castShadow receiveShadow />;
}

/** Flags on poles. `h` is the flag's height; the pole rises `h * 2` above (x, y, z). Pass ry = minus the parent's turn. */
export function NearFlags({ items }: { items: Cloth[] }) {
  const flags = useRef<THREE.InstancedMesh>(null), poles = useRef<THREE.InstancedMesh>(null);
  const mat = useMemo(() => clothMaterial(flagTexture(), 'flag'), []);
  useInstances(flags, items, (c, ob) => { ob.position.y += c.h * 2; ob.rotation.y = WIND + c.ry; ob.scale.set(c.w, c.h, c.w); });
  useInstances(poles, items, (c, ob) => { ob.position.y += c.h * 2 + 0.3; ob.scale.set(1.4, c.h * 2 + 0.3, 1.4); });
  useFrame(({ clock }) => { mat.userData.u.time.value = clock.elapsedTime; });
  return (
    <group>
      <instancedMesh ref={flags} args={[flagGeo, mat, items.length]} castShadow />
      <instancedMesh ref={poles} args={[poleGeo, undefined, items.length]} castShadow><meshStandardMaterial color="#3b2f25" roughness={0.8} /></instancedMesh>
    </group>
  );
}
