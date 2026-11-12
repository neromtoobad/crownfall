// The radar (bottom-left, turns with the camera, zooms out when you drive) and the full map (M).
// Both draw one pre-rendered picture of the realm, then the blips and the GPS line on top.
import { useEffect, useRef, useState } from 'react';
import { HIPPODROME, HOUSES, LANDMARKS, ROADS, SIZE, roadCurve } from './realm/layout.ts';
import { ground, landness } from './realm/heights.ts';
import { ALL } from './realm/collide.ts';
import { me, play, usePlay, emitPlay } from './realm/play.ts';
import { GIVERS, available, current, story, target } from './realm/missions.ts';
import { PLACES, STABLES } from './realm/places.ts';
import { route } from './realm/gps.ts';
import { MARKER } from './realm/Story.tsx';
import { live as liveRace, toOff, useRace } from './realm/race.ts';

const PX = 900; // the realm picture is PX × PX for SIZE × SIZE units
const U = PX / SIZE;
let base: HTMLCanvasElement | undefined;

/** Paint the realm once: land by height with hill shading, water, roads, every building's footprint. */
function realmPicture() {
  if (base) return base;
  const c = Object.assign(document.createElement('canvas'), { width: PX, height: PX });
  const g = c.getContext('2d')!;
  const img = g.createImageData(PX, PX);
  const toW = (p: number) => (p + 0.5) / U - SIZE / 2;
  for (let j = 0; j < PX; j++) for (let i = 0; i < PX; i++) {
    const x = toW(i), z = toW(j);
    const h = ground(x, z), wet = h < 0.9 || landness(x, z) < 0.5;
    let r: number, gg: number, b: number;
    if (wet) { r = 58; gg = 104; b = 128; }
    else if (h > 125) { r = 228; gg = 230; b = 232; }
    else if (h > 70) { const k = (h - 70) / 55; r = 138 + k * 40; gg = 132 + k * 40; b = 112 + k * 50; }
    else { const k = Math.min(1, h / 70); r = 104 + k * 34; gg = 128 - k * 2; b = 70 + k * 40; }
    if (!wet) { const s = (ground(x - 2, z - 2) - h) * 0.9; r += s * 6; gg += s * 6; b += s * 6; } // light from the north-west
    const o = (j * PX + i) * 4;
    img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const at = (x: number, z: number) => [(x + SIZE / 2) * U, (z + SIZE / 2) * U] as const;
  // Roads.
  g.strokeStyle = '#e2cc95'; g.lineWidth = 2.4; g.lineCap = 'round'; g.lineJoin = 'round';
  for (const r of ROADS) { const pts = roadCurve(r).getSpacedPoints(80); g.beginPath(); pts.forEach((p, k) => { const [a, b] = at(p.x, p.z); if (k) g.lineTo(a, b); else g.moveTo(a, b); }); g.stroke(); }
  // Buildings and walls.
  g.fillStyle = '#4a3d31';
  for (const s of ALL) {
    if (s.kind === 'circle') { if (s.soft) continue; const [a, b] = at(s.x, s.z); g.beginPath(); g.arc(a, b, Math.max(0.8, s.r * U), 0, Math.PI * 2); g.fill(); continue; }
    g.beginPath();
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([u, v], k) => {
      const lx = u * s.hx, lz = v * s.hz, [a, b] = at(s.x + lx * s.c + lz * s.s, s.z - lx * s.s + lz * s.c);
      if (k) g.lineTo(a, b); else g.moveTo(a, b);
    });
    g.fill();
  }
  // The Hippodrome's sand.
  { const [a, b] = at(...HIPPODROME.pos); g.save(); g.translate(a, b); g.rotate(-HIPPODROME.rot); g.fillStyle = '#d8c08e'; g.beginPath(); g.ellipse(0, 0, (60 + 50) * U, 50 * U, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
  if (ALL.length > 200) base = c; // only keep it once the buildings are in
  return c;
}

interface Blip { x: number; z: number; kind: 'giver' | 'target' | 'seat' | 'place' | 'car' | 'waypoint'; label?: string; color?: string }
function blips(): Blip[] {
  const out: Blip[] = [];
  const open = new Set(available().map((m) => m.giver.id));
  if (!story.run) for (const g of GIVERS) if (open.has(g.id)) out.push({ x: g.at[0], z: g.at[1], kind: 'giver', label: g.letter });
  for (const h of HOUSES) out.push({ x: h.pos[0], z: h.pos[1], kind: 'seat', color: h.colors[0], label: h.name[0] });
  const icon: Record<string, string> = { mint: '$', library: 'L', council: '♛', rookery: 'R', gate: 'G', stables: 'H' };
  // The Hippodrome is open to everyone from the start, so its pin is gold, not the dark of the other places.
  for (const p of PLACES) if (icon[p.id]) out.push({ x: p.x, z: p.z, kind: 'place', label: icon[p.id], color: p.id === 'stables' ? '#e8b53a' : undefined });
  if (!play.driving) out.push({ x: me.car.x, z: me.car.z, kind: 'car' });
  if (waypoint.at) out.push({ x: waypoint.at[0], z: waypoint.at[1], kind: 'waypoint' });
  const t = target();
  if (t) out.push({ x: t[0], z: t[1], kind: 'target' });
  return out;
}
/** A spot you picked (on the full map, or the race ticker): the GPS takes you there ahead of the mission's target,
 *  and forgets it once you arrive. */
export const waypoint = { at: undefined as [number, number] | undefined };

let gps = { key: '', pts: [] as [number, number][], t: 0 };
function gpsLine(): [number, number][] {
  if (waypoint.at && Math.hypot(waypoint.at[0] - me.x, waypoint.at[1] - me.z) < 16) waypoint.at = undefined;
  const t = waypoint.at ?? target();
  if (!t) return [];
  const key = `${t[0].toFixed(0)},${t[1].toFixed(0)}`, now = performance.now();
  if (key !== gps.key || now - gps.t > 900) gps = { key, pts: route(me.x, me.z, t[0], t[1]), t: now };
  return gps.pts;
}

function drawBlip(g: CanvasRenderingContext2D, b: Blip, x: number, y: number, s = 1) {
  g.save(); g.translate(x, y); g.scale(s, s);
  g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,0.75)';
  if (b.kind === 'target') { g.fillStyle = MARKER; g.fillRect(-6, -6, 12, 12); g.strokeRect(-6, -6, 12, 12); }
  else if (b.kind === 'waypoint') { g.fillStyle = '#c86bff'; g.beginPath(); g.moveTo(0, -8); g.lineTo(7, 0); g.lineTo(0, 8); g.lineTo(-7, 0); g.closePath(); g.fill(); g.stroke(); }
  else if (b.kind === 'car') { g.fillStyle = '#f4ead6'; g.beginPath(); g.arc(0, 0, 4, 0, Math.PI * 2); g.fill(); g.stroke(); }
  else {
    const fill = b.kind === 'giver' ? MARKER : b.color ?? '#2a2119';
    g.fillStyle = fill; g.beginPath(); g.arc(0, 0, b.kind === 'place' ? 7 : 8.5, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = b.kind === 'giver' ? '#1a130c' : b.kind === 'seat' ? '#fff' : b.color ? '#1a130c' : '#f2d48f';
    g.font = `700 ${b.kind === 'place' ? 9 : 10}px Inter, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(b.label ?? '', 0, 0.5);
  }
  g.restore();
}

/** The radar, bottom-left. */
export function Radar({ size = 210 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const zoom = useRef(1);
  useEffect(() => {
    let raf = 0, last = 0;
    const R = size / 2, dpr = Math.min(2, devicePixelRatio || 1);
    const c = ref.current!; c.width = size * dpr; c.height = size * dpr;
    const g = c.getContext('2d')!;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (t - last < 33) return;
      last = t;
      const pic = realmPicture();
      // Units per pixel: tighter on foot, wider in a chariot (and wider still at speed).
      const want = play.driving ? 1.9 + Math.min(1, Math.abs(me.car.v) / 30) * 0.8 : 1.0;
      zoom.current += (want - zoom.current) * 0.08;
      const upp = zoom.current, a = me.camYaw;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, size, size);
      g.save();
      g.beginPath(); g.arc(R, R, R - 3, 0, Math.PI * 2); g.clip();
      g.fillStyle = '#3a6880'; g.fillRect(0, 0, size, size);
      // World → radar: centred on you, turned so the camera's forward is up.
      g.translate(R, R); g.rotate(a); g.scale(1 / upp, 1 / upp); g.translate(-me.x, -me.z);
      g.imageSmoothingEnabled = true;
      g.drawImage(pic, -SIZE / 2, -SIZE / 2, SIZE, SIZE);
      const line = gpsLine();
      if (line.length > 1) {
        g.strokeStyle = waypoint.at ? '#c86bff' : MARKER; g.lineWidth = 4.5 * upp; g.lineCap = 'round'; g.lineJoin = 'round';
        g.beginPath(); line.forEach(([x, z], k) => (k ? g.lineTo(x, z) : g.moveTo(x, z))); g.stroke();
      }
      g.restore();
      // Blips, clamped to the rim when they're off the radar.
      const ca = Math.cos(a), sa = Math.sin(a);
      for (const b of blips()) {
        const dx = (b.x - me.x) / upp, dz = (b.z - me.z) / upp;
        let x = dx * ca - dz * sa, y = dx * sa + dz * ca;
        const d = Math.hypot(x, y), max = R - 12;
        if (d > max) { if (b.kind === 'place' || b.kind === 'car') continue; x *= max / d; y *= max / d; }
        drawBlip(g, b, R + x, R + y, d > max ? 0.85 : 1);
      }
      // You: an arrow pointing the way you face.
      g.save(); g.translate(R, R); g.rotate(a - me.yaw + Math.PI);
      g.fillStyle = '#fff'; g.strokeStyle = '#1a130c'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(0, -9); g.lineTo(6.5, 7); g.lineTo(0, 3.5); g.lineTo(-6.5, 7); g.closePath(); g.fill(); g.stroke();
      g.restore();
      // North on the rim.
      const north = { x: Math.sin(a), y: -Math.cos(a) }; // where world −z ends up
      g.save(); g.translate(R + north.x * (R - 11), R + north.y * (R - 11));
      g.fillStyle = '#1a130c'; g.beginPath(); g.arc(0, 0, 8, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f2d48f'; g.font = '700 10px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', 0, 0.5);
      g.restore();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size]);
  return (
    <div className="radar" style={{ width: size, height: size }} onClick={() => openMap(true)} title="Open the map (M)">
      <canvas ref={ref} style={{ width: size, height: size }} />
    </div>
  );
}

const mapState = { open: false };
export function openMap(on: boolean) { mapState.open = on; if (on) document.exitPointerLock?.(); emitPlay(); }
export const mapOpen = () => mapState.open;

/** The full map: the whole realm, every blip, the route, and a click to set a waypoint. */
export function FullMap() {
  usePlay();
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<string>();
  useEffect(() => {
    if (!mapState.open) return;
    const c = ref.current!, dpr = Math.min(2, devicePixelRatio || 1);
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
      const g = c.getContext('2d')!;
      const S = Math.min(w, h) / SIZE * 0.98, ox = w / 2, oy = h / 2;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#2d5468'; g.fillRect(0, 0, w, h);
      g.save(); g.translate(ox, oy); g.scale(S, S);
      g.drawImage(realmPicture(), -SIZE / 2, -SIZE / 2, SIZE, SIZE);
      const line = gpsLine();
      if (line.length > 1) { g.strokeStyle = target() ? MARKER : '#c86bff'; g.lineWidth = 4 / S; g.beginPath(); line.forEach(([x, z], k) => (k ? g.lineTo(x, z) : g.moveTo(x, z))); g.stroke(); }
      g.restore();
      for (const b of blips()) drawBlip(g, b, ox + b.x * S, oy + b.z * S, 1.15);
      // Names of the seats and landmarks.
      g.font = '600 12px Cinzel, Georgia, serif'; g.textAlign = 'center'; g.fillStyle = '#fff3d6'; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 3;
      for (const hh of HOUSES) { g.strokeText(hh.seat, ox + hh.pos[0] * S, oy + hh.pos[1] * S + 22); g.fillText(hh.seat, ox + hh.pos[0] * S, oy + hh.pos[1] * S + 22); }
      for (const l of [LANDMARKS[0], LANDMARKS[2], LANDMARKS[3]]) { g.strokeText(l.name, ox + l.pos[0] * S, oy + l.pos[1] * S - 14); g.fillText(l.name, ox + l.pos[0] * S, oy + l.pos[1] * S - 14); }
      g.strokeText('Emberfall', ox + 20 * S, oy - 120 * S); g.fillText('Emberfall', ox + 20 * S, oy - 120 * S);
      // You.
      g.save(); g.translate(ox + me.x * S, oy + me.z * S); g.rotate(-me.yaw + Math.PI);
      g.fillStyle = '#fff'; g.strokeStyle = '#1a130c'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 8); g.lineTo(0, 4); g.lineTo(-8, 8); g.closePath(); g.fill(); g.stroke();
      g.restore();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [mapState.open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!mapState.open) return null;
  const toWorld = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget, r = c.getBoundingClientRect(), S = Math.min(r.width, r.height) / SIZE * 0.98;
    return [(e.clientX - r.left - r.width / 2) / S, (e.clientY - r.top - r.height / 2) / S] as [number, number];
  };
  const c = current();
  return (
    <div className="fullmap">
      <canvas ref={ref} onClick={(e) => { waypoint.at = toWorld(e); gps.key = ''; emitPlay(); }}
        onMouseMove={(e) => { const [x, z] = toWorld(e); const h = HOUSES.find((hh) => Math.hypot(hh.pos[0] - x, hh.pos[1] - z) < 40); setHover(h ? `House ${h.name} · ${h.seat} · $${h.coin}` : undefined); }} />
      <div className="fullmap-side">
        <div className="eyebrow">The realm of Vael</div>
        <h2>Map</h2>
        {c ? <p className="obj">{c.mission.title}: {c.step.text().replace(/\*\*/g, '')}</p> : <p className="obj">No mission. Yellow letters are people with work for you.</p>}
        <ul className="legend">
          <li><i className="sq" />Objective</li><li><i className="ltr">O</i>Mission giver</li><li><i className="dia" />Your waypoint (click the map)</li>
          <li><i className="dot" />Your chariot</li><li><i className="pl">$</i>Mint · <b>R</b> Rookery · <b>L</b> Library</li><li><i className="pl race">H</i>Hippodrome: race or bet, any time</li>
        </ul>
        {hover && <p className="hover">{hover}</p>}
        <div className="actions">
          {waypoint.at && <button className="ghost" onClick={() => { waypoint.at = undefined; emitPlay(); }}>Clear waypoint</button>}
          <button className="go" onClick={() => openMap(false)}>Back to the realm (M)</button>
        </div>
      </div>
    </div>
  );
}

export const STABLES_AT = STABLES;

/** Above the radar: when the next race goes off at the Hippodrome. The races are open from the start, whatever the
 *  story says; a click sets the route there. Hidden once you're at the Hippodrome. */
export function RaceTicker() {
  usePlay();
  const r = useRace().race;
  const far = Math.hypot(me.x - HIPPODROME.pos[0], me.z - HIPPODROME.pos[1]) > 150;
  if (!far) return null;
  const left = Math.ceil(toOff(r));
  const when = r.phase === 'parade' ? (left > 0 ? `Next race in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Under starter’s orders') : 'A race is running now';
  const set = !!waypoint.at && Math.hypot(waypoint.at[0] - STABLES[0], waypoint.at[1] - STABLES[1]) < 1;
  return (
    <button className={`race-soon${set ? ' set' : ''}`} onClick={(e) => { e.stopPropagation(); waypoint.at = set ? undefined : [STABLES[0], STABLES[1]]; gps.key = ''; emitPlay(); }}
      title={set ? 'Clear the route to the Hippodrome' : 'Set the route to the Hippodrome'}>
      <i>H</i><span><b>{when}</b><em>{set ? 'Route set · follow the purple line' : `${liveRace.chain ? 'Bet on NEAR' : 'Race or bet'} at the Hippodrome · click for the route`}</em></span>
    </button>
  );
}
