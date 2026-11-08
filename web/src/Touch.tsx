// Touch controls: a floating joystick wherever your left thumb lands, drag on the right to look,
// and a thumb arc of buttons (use, run or whip, chariot, map).
import { useRef, useState } from 'react';
import { keys, me, play, press, stick, usePlay } from './realm/play.ts';
import { openMap } from './Radar.tsx';
import { story, nextLine } from './realm/missions.ts';

const R = 56;

export function Touch() {
  const p = usePlay();
  const [base, setBase] = useState<{ x: number; y: number }>();
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const ids = useRef<{ stick?: number; look?: number; lx: number; ly: number }>({ lx: 0, ly: 0 });
  const down = (e: React.PointerEvent) => {
    if (story.talk) { nextLine(); return; }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (e.clientX < innerWidth * 0.45 && ids.current.stick === undefined) {
      ids.current.stick = e.pointerId; setBase({ x: e.clientX, y: e.clientY }); setKnob({ x: 0, y: 0 }); stick.active = true;
    } else if (ids.current.look === undefined) { ids.current.look = e.pointerId; ids.current.lx = e.clientX; ids.current.ly = e.clientY; }
  };
  const move = (e: React.PointerEvent) => {
    if (e.pointerId === ids.current.stick && base) {
      let dx = e.clientX - base.x, dy = e.clientY - base.y;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      setKnob({ x: dx, y: dy });
      const m = Math.min(1, d / R), dead = 0.14, k = m < dead ? 0 : (m - dead) / (1 - dead);
      stick.x = d ? (dx / Math.max(d, 1e-6)) * k : 0; stick.y = d ? (-dy / Math.max(d, 1e-6)) * k : 0;
    } else if (e.pointerId === ids.current.look) {
      me.camYaw -= (e.clientX - ids.current.lx) * 0.006;
      me.camPitch = Math.max(-0.05, Math.min(1.25, me.camPitch + (e.clientY - ids.current.ly) * 0.004));
      me.lastLook = performance.now() / 1000;
      ids.current.lx = e.clientX; ids.current.ly = e.clientY;
    }
  };
  const up = (e: React.PointerEvent) => {
    if (e.pointerId === ids.current.stick) { ids.current.stick = undefined; setBase(undefined); stick.active = false; stick.x = stick.y = 0; }
    if (e.pointerId === ids.current.look) ids.current.look = undefined;
  };
  if (p.mode !== 'play' || p.panel || p.picking) return null;
  const hold = (k: string) => ({
    onPointerDown: (e: React.PointerEvent) => { e.stopPropagation(); keys.add(k); },
    onPointerUp: () => keys.delete(k), onPointerCancel: () => keys.delete(k), onPointerLeave: () => keys.delete(k),
  });
  const tap = (k: string) => ({ onPointerDown: (e: React.PointerEvent) => { e.stopPropagation(); press(k); } });
  return (
    <>
      <div className="touch-pad" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      {base && <div className="stick" style={{ left: base.x - R, top: base.y - R, width: R * 2, height: R * 2 }}><i style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} /></div>}
      <button className="touch-pause" aria-label="Pause" {...tap('p')}><i /><i /></button>
      <div className="touch-btns">
        <button className="big" {...tap(story.talk ? 'e' : 'e')}>{p.driving ? 'Step down' : p.prompt ? p.prompt.verb : 'Use'}</button>
        {p.driving || p.racing ? <button {...tap(' ')}>Whip</button> : <button {...hold('shift')}>Run</button>}
        {p.racing ? <><button {...tap('a')}>◀ Lane</button><button {...tap('d')}>Lane ▶</button></> : !p.driving && <button {...tap('c')}>Chariot</button>}
        <button onPointerDown={(e) => { e.stopPropagation(); openMap(true); }}>Map</button>
      </div>
    </>
  );
}
void play;
