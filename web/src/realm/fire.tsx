// Fire for the halls: hearths, torches, braziers and candles. Every flame is one billboard in a single instanced
// mesh, shaped and flickered in the shader (no textures), additive so it glows through the bloom pass.
// Each instance carries [size, seed]; a hearth is a cluster of big flames, a candle one small one.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export type FlameSpot = [number, number, number, number]; // x, y (base), z, size

const flameMat = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { time: { value: 0 } },
  vertexShader: `
    uniform float time;
    attribute vec2 aFlame; // size, seed
    varying vec2 vUv; varying float vSeed;
    void main() {
      vec3 base = instanceMatrix[3].xyz;
      float s = aFlame.x;
      vec4 mv = viewMatrix * vec4(base, 1.0);
      // Lick upward, a little sway at the tip.
      float sway = sin(time * 7.0 + aFlame.y * 30.0) * 0.08 * uv.y;
      mv.xy += vec2((position.x + sway) * s, (position.y + 0.5) * s * 1.7);
      gl_Position = projectionMatrix * mv;
      vUv = uv; vSeed = aFlame.y;
    }`,
  fragmentShader: `
    uniform float time;
    varying vec2 vUv; varying float vSeed;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
      return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
    void main() {
      vec2 p = vUv - vec2(0.5, 0.0);
      float t = time * (2.2 + vSeed);
      // A teardrop narrowing to the tip, eaten away by rising noise.
      float w = 0.42 * (1.0 - vUv.y) * (0.65 + 0.35 * sqrt(vUv.y + 0.05));
      float body = smoothstep(w, w * 0.25, abs(p.x + (n(vec2(vUv.y * 3.0 - t, vSeed * 9.0)) - 0.5) * 0.18 * vUv.y));
      float lick = n(vec2(p.x * 6.0 + vSeed * 13.0, vUv.y * 4.0 - t * 1.6));
      float a = body * smoothstep(0.98, 0.35, vUv.y + lick * 0.35) * smoothstep(0.0, 0.08, vUv.y);
      vec3 hot = vec3(1.0, 0.92, 0.62), mid = vec3(1.0, 0.55, 0.16), cool = vec3(0.75, 0.18, 0.04);
      vec3 col = mix(hot, mid, smoothstep(0.05, 0.45, vUv.y + abs(p.x)));
      col = mix(col, cool, smoothstep(0.45, 0.95, vUv.y));
      gl_FragColor = vec4(col * a * 1.6, a);
    }`,
});

/** All the flames in a hall, one draw call. */
export function Flames({ spots }: { spots: FlameSpot[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { geo, mat } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute('aFlame', new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, spots.length) * 2), 2));
    return { geo, mat: flameMat() };
  }, [spots.length]);
  useLayoutEffect(() => {
    const m = ref.current!, a = geo.getAttribute('aFlame') as THREE.InstancedBufferAttribute, o = new THREE.Matrix4();
    spots.forEach(([x, y, z, s], i) => { m.setMatrixAt(i, o.makeTranslation(x, y, z)); a.setXY(i, s, (i * 0.618) % 1); });
    m.count = spots.length; m.instanceMatrix.needsUpdate = true; a.needsUpdate = true;
  }, [spots, geo]);
  useFrame(({ clock }) => { mat.uniforms.time.value = clock.elapsedTime; });
  return <instancedMesh ref={ref} args={[geo, mat, Math.max(1, spots.length)]} frustumCulled={false} renderOrder={3} />;
}

/** A point light that breathes like a fire: two slow waves and a fast flutter. */
export function FireLight({ position, color = '#ff9a4a', intensity = 900, distance = 60 }: { position: [number, number, number]; color?: string; intensity?: number; distance?: number }) {
  const ref = useRef<THREE.PointLight>(null);
  const seed = useMemo(() => Math.random() * 100, []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime + seed, l = ref.current;
    if (l) l.intensity = intensity * (0.82 + Math.sin(t * 2.3) * 0.07 + Math.sin(t * 5.7) * 0.06 + Math.sin(t * 17.3) * 0.04);
  });
  return <pointLight ref={ref} position={position} color={color} intensity={intensity} distance={distance} decay={1.6} />;
}

/** Sparks rising off a hearth: points that drift up, wander and wink out. */
export function Embers({ position, count = 40, spread = 2.2, height = 9 }: { position: [number, number, number]; count?: number; spread?: number; height?: number }) {
  const { geo, mat } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const seed = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) seed.set([Math.random(), Math.random(), Math.random()], i * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { time: { value: 0 }, spread: { value: spread }, height: { value: height } },
      vertexShader: `
        uniform float time; uniform float spread; uniform float height; attribute vec3 aSeed; varying float vA;
        void main() {
          float life = fract(time * (0.22 + aSeed.x * 0.25) + aSeed.y);
          vec3 p = vec3((aSeed.z - 0.5) * spread + sin(time * 2.0 + aSeed.y * 40.0) * 0.4 * life, life * height, (aSeed.x - 0.5) * spread * 0.6 + cos(time * 1.7 + aSeed.z * 30.0) * 0.4 * life);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (1.5 + aSeed.z * 2.5) * (300.0 / -mv.z);
          vA = (1.0 - life) * step(0.3, fract(time * 3.0 + aSeed.x * 7.0) + 0.3);
        }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(1.0, 0.6, 0.2) * vA, vA * smoothstep(0.5, 0.0, d)); }`,
    });
    return { geo, mat };
  }, [count, spread, height]);
  useFrame(({ clock }) => { mat.uniforms.time.value = clock.elapsedTime; });
  return <points geometry={geo} material={mat} position={position} frustumCulled={false} />;
}
