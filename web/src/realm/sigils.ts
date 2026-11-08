// House sigils for banners, the HUD and the hall games. The art is one sheet, public/sigils.png: four across, two
// down, in house order, white on transparent. Until it loads (or if it's missing) a shield with the house initial
// stands in. Textures redraw themselves when the sheet arrives.
import * as THREE from 'three';
import { HOUSES } from './layout.ts';

let sheet: HTMLImageElement | undefined;
const waiting: (() => void)[] = [];
if (typeof window !== 'undefined') {
  const img = new Image();
  img.onload = () => { sheet = img; waiting.splice(0).forEach((f) => f()); };
  img.src = '/sigils.png';
}

/** Draw house h's sigil into a box, tinted. */
export function drawSigil(g: CanvasRenderingContext2D, h: number, x: number, y: number, size: number, tint: string) {
  if (sheet) {
    const cw = sheet.width / 4, ch = sheet.height / 2;
    const tmp = document.createElement('canvas'); tmp.width = tmp.height = Math.ceil(size);
    const t = tmp.getContext('2d')!;
    t.drawImage(sheet, (h % 4) * cw, Math.floor(h / 4) * ch, cw, ch, 0, 0, size, size);
    t.globalCompositeOperation = 'source-in'; t.fillStyle = tint; t.fillRect(0, 0, size, size);
    g.drawImage(tmp, x, y);
    return;
  }
  g.save();
  g.fillStyle = tint; g.strokeStyle = tint; g.lineWidth = size * 0.04;
  g.beginPath();
  g.moveTo(x + size * 0.2, y + size * 0.18); g.lineTo(x + size * 0.8, y + size * 0.18); g.lineTo(x + size * 0.8, y + size * 0.55);
  g.quadraticCurveTo(x + size * 0.8, y + size * 0.82, x + size * 0.5, y + size * 0.92);
  g.quadraticCurveTo(x + size * 0.2, y + size * 0.82, x + size * 0.2, y + size * 0.55); g.closePath(); g.stroke();
  g.font = `600 ${size * 0.42}px Cinzel, Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(HOUSES[h].name[0], x + size * 0.5, y + size * 0.52);
  g.restore();
}

const cache = new Map<string, THREE.CanvasTexture>();
/** A banner: the house's field colour, a border and swallowtail notch in its second colour, the sigil in the middle. */
export function sigilTexture(h: number, kind: 'banner' | 'flat' = 'banner') {
  const key = `${h}-${kind}`;
  if (cache.has(key)) return cache.get(key)!;
  const c = document.createElement('canvas'); c.width = 256; c.height = 560;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const draw = () => {
    const g = c.getContext('2d')!, [a, b] = HOUSES[h].colors;
    g.clearRect(0, 0, 256, 560);
    g.fillStyle = a;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(256, 0); g.lineTo(256, 560); if (kind === 'banner') g.lineTo(128, 470); g.lineTo(0, 560); g.closePath(); g.fill();
    g.strokeStyle = b; g.lineWidth = 12;
    g.beginPath(); g.moveTo(14, 0); g.lineTo(14, 530); if (kind === 'banner') g.lineTo(128, 448); g.lineTo(242, 530); g.lineTo(242, 0); g.stroke();
    g.fillStyle = b; g.fillRect(0, 24, 256, 10);
    drawSigil(g, h, 38, 110, 180, b);
    // A woven texture so the cloth doesn't look printed.
    g.globalAlpha = 0.07; g.fillStyle = '#000';
    for (let y = 0; y < 560; y += 3) g.fillRect(0, y, 256, 1);
    g.globalAlpha = 1;
    tex.needsUpdate = true;
  };
  draw();
  if (!sheet) waiting.push(draw);
  cache.set(key, tex);
  return tex;
}

/** The sigil alone as a data URL, for the DOM HUD. */
export function sigilURL(h: number, size = 96, tint = '#fff') {
  const c = document.createElement('canvas'); c.width = c.height = size;
  drawSigil(c.getContext('2d')!, h, 0, 0, size, tint);
  return c.toDataURL();
}
export const sigilsReady = (f: () => void) => (sheet ? f() : waiting.push(f));
