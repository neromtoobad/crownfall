// Hearth smoke from the houses of Vael: soft puffs that rise, swell, pale and bend downwind with the realm's
// one wind (wind.ts). All of it is one instanced quad mesh moved entirely in the shader; nothing runs per puff
// in JS. The big columns over forges and bakehouses show where the towns are from far off.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CHIMNEYS } from './Buildings.tsx';
import { wind } from './wind.ts';

const PUFFS = 12;

/** A soft lumpy blob, drawn once on a canvas. */
function puffTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  let seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 14; i++) {
    const x = 64 + (rnd() - 0.5) * 50, y = 64 + (rnd() - 0.5) * 50, r = 18 + rnd() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // Fade the square's edge so no puff shows a corner.
  g.globalCompositeOperation = 'destination-in';
  const edge = g.createRadialGradient(64, 64, 30, 64, 64, 64);
  edge.addColorStop(0, 'rgba(0,0,0,1)'); edge.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = edge; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function smokeMaterial() {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { tPuff: { value: null } }]);
  uniforms.tPuff.value = puffTexture();
  Object.assign(uniforms, { wTime: wind.time, wGust: wind.gust, wDir: wind.dir });
  return new THREE.ShaderMaterial({
    uniforms, fog: true, transparent: true, depthWrite: false,
    vertexShader: `
      uniform float wTime; uniform float wGust; uniform vec2 wDir;
      attribute vec3 aPuff; // phase 0..1, size, seed
      varying vec2 vUv; varying float vAlpha; varying float vAge;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vec3 base = instanceMatrix[3].xyz;
        float big = aPuff.y, life = 8.0 + big * 3.0;
        float age = fract(wTime / life + aPuff.x);
        float rise = age * 17.0 * big;
        float drift = age * age * (5.0 + 20.0 * wGust) * big;
        vec3 c = base + vec3(wDir.x * drift, rise, wDir.y * drift);
        c.x += sin(wTime * 0.7 + aPuff.z * 6.0 + age * 4.0) * 0.9 * age * big;
        c.z += cos(wTime * 0.5 + aPuff.z * 4.0 + age * 3.0) * 0.9 * age * big;
        float size = (1.8 + age * 7.5) * big;
        vec4 mvPosition = viewMatrix * vec4(c, 1.0);
        float r = aPuff.z * 6.283 + age * 0.9;
        mvPosition.xy += mat2(cos(r), -sin(r), sin(r), cos(r)) * position.xy * size;
        gl_Position = projectionMatrix * mvPosition;
        vUv = uv; vAge = age;
        vAlpha = smoothstep(0.0, 0.06, age) * (1.0 - age) * (1.0 - age) * 1.35;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform sampler2D tPuff;
      varying vec2 vUv; varying float vAlpha; varying float vAge;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        float a = texture2D(tPuff, vUv).a * vAlpha;
        if (a < 0.004) discard;
        // Dark and warm as it leaves the fire, pale and cool as it thins.
        vec3 col = mix(vec3(0.30, 0.28, 0.27), vec3(0.62, 0.61, 0.60), smoothstep(0.0, 0.7, vAge));
        gl_FragColor = vec4(col, a);
        #include <fog_fragment>
      }`,
  });
}

export function Smoke() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const built = useRef(0);
  const MAX = 400 * PUFFS;
  const { geo, mat, puff } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1), puff = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    geo.setAttribute('aPuff', puff);
    return { geo, mat: smokeMaterial(), puff };
  }, [MAX]);

  // Fill once the buildings have published their chimneys.
  useFrame(() => {
    const m = ref.current;
    if (!m || built.current === CHIMNEYS.length || CHIMNEYS.length === 0) return;
    const o = new THREE.Matrix4();
    let n = 0;
    for (const [x, y, z, big] of CHIMNEYS.slice(0, 400)) for (let k = 0; k < PUFFS; k++, n++) {
      m.setMatrixAt(n, o.makeTranslation(x, y, z));
      puff.setXYZ(n, k / PUFFS + ((x * 0.37 + z * 0.11) % 1), big, ((x * 12.9898 + z * 78.233 + k * 3.1) % 1 + 1) % 1);
    }
    m.count = n; m.instanceMatrix.needsUpdate = true; puff.needsUpdate = true;
    built.current = CHIMNEYS.length;
  });
  return <instancedMesh ref={ref} args={[geo, mat, MAX]} count={0} frustumCulled={false} renderOrder={2} />;
}
