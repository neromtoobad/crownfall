// Shared materials for procedural geometry that has no UVs.
import * as THREE from 'three';

/** Project a texture onto object-space position from three sides (no UVs needed) and let it add detail only. */
/** `breakup` mixes in a second, rotated and rescaled sample so mirrored tiling stops reading as ink blots. */
export function triplanar(tex: THREE.Texture, avg: number[], scale: number, color: string, breakup = false, amount = 1) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, color });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tTri = { value: tex };
    sh.uniforms.tAvg = { value: new THREE.Vector3(...avg) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOP;\nvarying vec3 vON;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvOP = position * ${scale.toFixed(3)}; vON = normal;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tTri;\nuniform vec3 tAvg;\nvarying vec3 vOP;\nvarying vec3 vON;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 b = pow(abs(normalize(vON)), vec3(4.0)); b /= (b.x + b.y + b.z);
          vec3 t = texture2D(tTri, vOP.zy).rgb * b.x + texture2D(tTri, vOP.xz).rgb * b.y + texture2D(tTri, vOP.xy).rgb * b.z;
${breakup ? `          mat2 rB = mat2(0.82, -0.57, 0.57, 0.82) * 0.41;
          vec3 t2 = texture2D(tTri, rB * vOP.zy + 0.31).rgb * b.x + texture2D(tTri, rB * vOP.xz + 0.53).rgb * b.y + texture2D(tTri, rB * vOP.xy + 0.17).rgb * b.z;
          t = mix(t, t2, 0.5) * (1.0 + 0.25 * (t2.g - t.g) / max(tAvg.g, 0.01));
` : ''}          diffuseColor.rgb *= mix(vec3(1.0), clamp(t / max(tAvg, vec3(0.01)), 0.0, 2.5), ${amount.toFixed(3)});
        }`);
  };
  // The scale is baked into the shader text, so each scale needs its own program.
  m.customProgramCacheKey = () => `triplanar-${scale}-${breakup}-${amount}`;
  return m;
}

// ---- Surfaces for the Blender props and the chariot. Each part carries a surface tag in uv.x saying what it is
// made of (1 wood, 0.75 stone, 0.5 cloth, 0 plain: iron, glaze, fruit), and the shader lays the realm's own bark and rock
// photographs over it in object space, so hand-made props get the same grain as the generated buildings.
import AVG from './texAvg.json';
let SURF: { wood: THREE.Texture; stone: THREE.Texture } | undefined;
function surfTextures() {
  if (!SURF) {
    const l = new THREE.TextureLoader();
    const load = (u: string) => { const t = l.load(u); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
    SURF = { wood: load('/tex/bark.jpg'), stone: load('/tex/rock.jpg') };
  }
  return SURF;
}
/** Patch a vertex-coloured Blender prop's material with wood, stone and cloth grain. The surface tag rides in
 * uv.x (glTF drops colour alpha); it is copied to a `surf` attribute here. `scale` is texture repeats per model
 * unit: props are modelled in metres, so pass 1.4 / M for geometry already scaled to world units. */
export function surfaced(m: THREE.MeshStandardMaterial, geo: THREE.BufferGeometry, scale = 1.4, amount = 1) {
  if (!geo.getAttribute('surf')) {
    const uv = geo.getAttribute('uv');
    if (!uv) return m;
    const a = new Float32Array(uv.count);
    for (let i = 0; i < uv.count; i++) a[i] = uv.getX(i);
    geo.setAttribute('surf', new THREE.BufferAttribute(a, 1));
  }
  const T = surfTextures(), wa = AVG.bark, sa = AVG.rock;
  m.vertexColors = true;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.tWood = { value: T.wood }; sh.uniforms.tStone = { value: T.stone };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float surf;\nvarying float vSurf;\nvarying vec3 vSP;\nvarying vec3 vSN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvSurf = surf; vSP = position * ${scale.toFixed(4)}; vSN = normal;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tWood;\nuniform sampler2D tStone;\nvarying float vSurf;\nvarying vec3 vSP;\nvarying vec3 vSN;\nfloat surfId;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          surfId = vSurf;
          vec3 b = pow(abs(normalize(vSN)), vec3(4.0)); b /= (b.x + b.y + b.z);
          vec3 mult = vec3(1.0);
          if (surfId > 0.87) {
            // wood: the bark photo stretched along the grain reads as planks and staves
            vec3 t = texture2D(tWood, vSP.zy * vec2(0.6, 0.18)).rgb * b.x + texture2D(tWood, vSP.xz * vec2(0.6, 0.18)).rgb * b.y + texture2D(tWood, vSP.xy * vec2(0.18, 0.6)).rgb * b.z;
            mult = mix(vec3(1.0), clamp(t / vec3(${wa.join(', ')}), 0.45, 1.7), ${(0.7 * amount).toFixed(3)});
          } else if (surfId > 0.62) {
            vec3 t = texture2D(tStone, vSP.zy * 0.5).rgb * b.x + texture2D(tStone, vSP.xz * 0.5).rgb * b.y + texture2D(tStone, vSP.xy * 0.5).rgb * b.z;
            mult = mix(vec3(1.0), clamp(t / vec3(${sa.join(', ')}), 0.4, 1.8), ${(0.85 * amount).toFixed(3)});
          } else if (surfId > 0.37) {
            // cloth and sacking: a fine, weak weave
            vec3 t = texture2D(tStone, vSP.zy * 3.0).rgb * b.x + texture2D(tStone, vSP.xz * 3.0).rgb * b.y + texture2D(tStone, vSP.xy * 3.0).rgb * b.z;
            mult = mix(vec3(1.0), clamp(t / vec3(${sa.join(', ')}), 0.6, 1.4), ${(0.3 * amount).toFixed(3)});
          }
          diffuseColor.rgb *= mult;
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = surfId < 0.2 ? roughnessFactor * 0.55 : max(roughnessFactor, 0.82);');
  };
  m.customProgramCacheKey = () => `surfaced-${scale}-${amount}`;
  return m;
}
