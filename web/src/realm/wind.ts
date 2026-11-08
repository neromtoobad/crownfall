// One wind for the whole realm (the Ghost of Tsushima rule): trees, grass, flags, smoke and the sound of it all
// read the same direction and the same gusts, so the world moves together instead of each thing on its own clock.
import * as THREE from 'three';
// Same heading as NearCloth's WIND (flags turn by it); kept here as a literal so this module imports nothing.
const WIND = 0.7;

/** Shared shader uniforms. `dir` is where the wind blows TO in world xz (flags stream that way). */
export const wind = {
  time: { value: 0 },
  gust: { value: 0.5 },
  dir: { value: new THREE.Vector2(Math.cos(WIND), -Math.sin(WIND)) },
  /** The player's feet (xz): grass leans away from them. */
  me: { value: new THREE.Vector2(1e5, 1e5) },
};

/** Gust strength 0..1 at time t: slow swells with sudden puffs, from sines whose periods never line up. */
export function gustAt(t: number) {
  const swell = 0.42 + 0.2 * Math.sin(t * 0.13) + 0.14 * Math.sin(t * 0.31 + 2);
  const puff = Math.max(0, Math.sin(t * 0.071 + 1) * Math.sin(t * 0.53)) ** 2;
  return THREE.MathUtils.clamp(swell + puff * 0.5, 0, 1);
}

export function tickWind(t: number, x: number, z: number) {
  wind.time.value = t;
  wind.gust.value = gustAt(t);
  wind.me.value.set(x, z);
}

const HEAD = 'uniform float wTime;\nuniform float wGust;\nuniform vec2 wDir;\nuniform vec2 wMe;\n';
function bind(sh: THREE.WebGLProgramParametersWithUniforms) {
  sh.uniforms.wTime = wind.time; sh.uniforms.wGust = wind.gust; sh.uniforms.wDir = wind.dir; sh.uniforms.wMe = wind.me;
}

/** GLSL: the instance's root in world space and the wind turned into the instance's own frame. */
const FRAME = `
  #ifdef USE_INSTANCING
    vec2 wRoot = instanceMatrix[3].xz;
    vec3 wLocal = normalize(transpose(mat3(instanceMatrix)) * vec3(wDir.x, 0.0, wDir.y));
  #else
    vec2 wRoot = vec2(0.0);
    vec3 wLocal = vec3(wDir.x, 0.0, wDir.y);
  #endif
  float wPhase = dot(wRoot, vec2(0.031, 0.027));
  // A gust front rolls across the land along the wind: places downwind feel it a moment later.
  float wFront = 0.5 + 0.5 * sin(dot(wRoot, wDir) * 0.045 - wTime * 1.3);
  float wPush = wGust * (0.55 + 0.45 * wFront);
`;

/** Trees: the whole tree bends from the ground up (more at the top), leaves shiver. Chains onto any
 * existing onBeforeCompile (the triplanar bark and leaves). `height` is the tree's height in model units. */
export function swaying<T extends THREE.Material>(m: T, height = 10, flutter = 1) {
  const prev = m.onBeforeCompile.bind(m), key = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    bind(sh);
    sh.vertexShader = HEAD + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        ${FRAME}
        float hh = max(position.y - 1.0, 0.0) / ${height.toFixed(1)};
        float bend = hh * hh;
        float sway = (sin(wTime * 1.05 + wPhase) * 0.6 + sin(wTime * 2.3 + wPhase * 1.7) * 0.25) * (0.25 + wPush) + wPush * 0.9;
        transformed.xz += wLocal.xz * sway * bend * 0.55;
        transformed += normal * sin(wTime * 7.0 + position.x * 3.1 + position.z * 2.3 + wPhase * 5.0) * 0.05 * hh * (0.3 + wPush) * ${flutter.toFixed(2)};
      }`);
  };
  m.customProgramCacheKey = () => key() + `-sway${height}-${flutter}`;
  return m;
}

/** Grass blades: tips bend downwind with the rolling gust front and lean away from your feet. */
export function grassy<T extends THREE.Material>(m: T, radius: number) {
  const prev = m.onBeforeCompile.bind(m);
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    bind(sh);
    sh.vertexShader = HEAD + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        ${FRAME}
        float tip = position.y; // blades are modelled 1 unit tall
        // Fade out toward the edge of the patch so it never shows a hard border.
        float fade = smoothstep(${radius.toFixed(1)}, ${(radius * 0.62).toFixed(1)}, distance(wRoot, wMe));
        transformed.y *= fade;
        float wave = sin(wTime * 2.1 + wPhase * 9.0 + position.x * 4.0) * 0.12;
        float lean = (0.08 + wPush * 0.45 + wave * (0.5 + wPush)) * tip * tip;
        transformed.xz += wLocal.xz * lean;
        transformed.y -= lean * lean * 0.35;
        vec2 away = wRoot - wMe;
        float near = 1.0 - smoothstep(0.3, 2.2, length(away));
        #ifdef USE_INSTANCING
          vec3 awayL = transpose(mat3(instanceMatrix)) * vec3(away.x, 0.0, away.y);
        #else
          vec3 awayL = vec3(away.x, 0.0, away.y);
        #endif
        transformed.xz += normalize(awayL.xz + 1e-4) * near * 0.55 * tip;
        transformed.y -= near * 0.3 * tip;
      }`);
    // Both faces take the ground's up normal straight from world up (three flips it on back faces, and a
    // flattened clump's normal matrix is singular: either turns blades black).
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);');
  };
  m.customProgramCacheKey = () => `grass-${radius}`;
  return m;
}
