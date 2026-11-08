// NEAR's mark and colours, and the cloth textures the realm hangs them on (drawn once on a canvas, no image files).
import * as THREE from 'three';
import { wind } from './wind.ts';

export const NEAR_GREEN = '#00ec97';
/** The NEAR logomark on a 90×90 box. */
export const NEAR_MARK =
  'M72.2 4.6L53.4 32.5c-1.3 1.9 1.2 4.2 3 2.6L74.9 19c.5-.4 1.2-.1 1.2.6v50.3c0 .7-.9 1-1.3.5l-56-67C17 1.2 14.4 0 11.5 0h-2C4.3 0 0 4.3 0 9.6v70.8C0 85.7 4.3 90 9.6 90c3.3 0 6.4-1.7 8.2-4.6l18.8-27.9c1.3-1.9-1.2-4.2-3-2.6L15.1 70.9c-.5.4-1.2.1-1.2-.6V20.1c0-.7.9-1 1.3-.5l56 67c1.8 2.2 4.5 3.4 7.3 3.4h2c5.3 0 9.6-4.3 9.6-9.6V9.6c0-5.3-4.3-9.6-9.6-9.6-3.4 0-6.5 1.7-8.3 4.6z';

function mark(g: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string) {
  g.save();
  g.translate(cx - size / 2, cy - size / 2);
  g.scale(size / 90, size / 90);
  g.fillStyle = color;
  g.fill(new Path2D(NEAR_MARK));
  g.restore();
}
function word(g: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, color: string, spacing = 0.12) {
  g.save();
  g.font = `800 ${px}px Inter, 'Helvetica Neue', Arial, sans-serif`;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${px * spacing}px`;
  g.fillText(text, x + (px * spacing) / 2, y);
  g.restore();
}
function texture(c: HTMLCanvasElement, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = THREE.RepeatWrapping;
  return t;
}
const cache = new Map<string, THREE.Texture>();
const once = (k: string, f: () => THREE.Texture) => cache.get(k) ?? cache.set(k, f()).get(k)!;

/** A tall hanging banner with a swallowtail: black cloth, green edges, the mark and the word. */
export const bannerTexture = () => once('banner', () => {
  const W = 256, H = 640, c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = c.getContext('2d')!;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(W, H); g.lineTo(W / 2, H - 92); g.lineTo(0, H); g.closePath(); g.clip();
  g.fillStyle = '#0b0b0b'; g.fillRect(0, 0, W, H);
  g.fillStyle = NEAR_GREEN; g.fillRect(0, 0, W, 30); g.fillRect(0, 0, 14, H); g.fillRect(W - 14, 0, 14, H);
  mark(g, W / 2, 200, 148, '#ffffff');
  word(g, 'NEAR', W / 2, 372, 66, '#ffffff');
  g.fillStyle = NEAR_GREEN; g.fillRect(W / 2 - 40, 430, 80, 6);
  return texture(c);
});

/** A flag for a pole: green at the hoist, the mark on black. */
export const flagTexture = () => once('flag', () => {
  const W = 384, H = 256, c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b0b0b'; g.fillRect(0, 0, W, H);
  g.fillStyle = NEAR_GREEN; g.fillRect(0, 0, 54, H);
  mark(g, 54 + (W - 54) / 2, H / 2, 150, '#ffffff');
  return texture(c);
});

/** A long strip (finish-line gantry, stand fronts): the mark and the word, repeated. */
export const stripTexture = () => once('strip', () => {
  const W = 512, H = 96, c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b0b0b'; g.fillRect(0, 0, W, H);
  g.fillStyle = NEAR_GREEN; g.fillRect(0, 0, W, 7); g.fillRect(0, H - 7, W, 7);
  mark(g, 150, H / 2, 54, NEAR_GREEN);
  word(g, 'NEAR', 290, H / 2 + 2, 48, '#ffffff');
  return texture(c, true);
});

/** The face of the Mint's great coin: gold, the mark struck in the middle, the legend round the rim. */
export const coinTexture = () => once('coin', () => {
  const S = 512, c = Object.assign(document.createElement('canvas'), { width: S, height: S });
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(S * 0.4, S * 0.35, 20, S / 2, S / 2, S / 2);
  grd.addColorStop(0, '#f6dc8a'); grd.addColorStop(0.7, '#d2a845'); grd.addColorStop(1, '#9c7424');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  g.strokeStyle = '#8a6420'; g.lineWidth = 10; g.beginPath(); g.arc(S / 2, S / 2, S * 0.36, 0, Math.PI * 2); g.stroke();
  mark(g, S / 2 + 4, S / 2 + 5, 190, 'rgba(90, 60, 15, 0.55)'); // the struck shadow
  mark(g, S / 2, S / 2, 190, '#7a561a');
  g.save();
  g.font = `700 34px Cinzel, Georgia, serif`; g.fillStyle = '#6e4e16'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const legend = 'THE WARWICK MINT  ·  STRUCK ON NEAR  ·  ';
  for (let i = 0; i < legend.length; i++) {
    const a = (i / legend.length) * Math.PI * 2 - Math.PI / 2;
    g.save(); g.translate(S / 2 + Math.cos(a) * S * 0.43, S / 2 + Math.sin(a) * S * 0.43); g.rotate(a + Math.PI / 2); g.fillText(legend[i], 0, 0); g.restore();
  }
  g.restore();
  return texture(c);
});

/** Waving cloth: hanging banners sway from the top edge, flags ripple out from the pole. */
export function clothMaterial(map: THREE.Texture, kind: 'banner' | 'flag' | 'strip') {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.85, side: kind === 'strip' ? THREE.FrontSide : THREE.DoubleSide, alphaTest: 0.5 });
  const u = { time: { value: 0 } };
  m.onBeforeCompile = (s) => {
    s.uniforms.time = u.time;
    const wave = kind === 'flag'
      ? 'float ph = float(gl_InstanceID) * 1.3; float k = position.x; transformed.z += sin(k * 7. - time * 5. + ph) * k * 0.12 + sin(k * 13. - time * 7.3 + ph) * k * 0.03; transformed.y -= k * k * 0.04;'
      : kind === 'banner'
        ? 'float ph = float(gl_InstanceID) * 1.7; float d = -position.y; transformed.z += sin(time * 1.4 + ph + d * 2.) * d * d * 0.05; transformed.x += sin(time * 0.9 + ph) * d * 0.02;'
        : '';
    // Cloth flaps harder in a gust: the same gust as the trees and grass (wind.ts).
    s.uniforms.wGust = wind.gust;
    s.vertexShader = 'uniform float time;\nuniform float wGust;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\nvec3 calm = transformed;\n${wave}\ntransformed = calm + (transformed - calm) * (0.45 + wGust * 1.1);`);
  };
  m.userData.u = u;
  return m;
}
