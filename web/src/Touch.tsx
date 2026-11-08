// Touch controls. In the realm: a joystick that always sits under your left thumb (it follows wherever the thumb
// lands on the left side), drag on the right to look, and a thumb arc of buttons (use, run or whip, chariot, map).
// At a hall table: each game's own buttons, which act exactly like its keys, plus a Leave button.
import { useEffect, useReducer, useRef, useState } from 'react';
import { keys, me, play, press, stick, usePlay } from './realm/play.ts';
import { openMap } from './Radar.tsx';
import { story, nextLine, skipTalk } from './realm/missions.ts';
import { quitGame, session } from './games/host.ts';

const R = 56;

export function Touch() {
  const p = usePlay();
  if (p.mode !== 'play' || p.picking) return null;
  if (p.game) return session.phase === 'play' ? <GameTouch id={p.game.id} /> : null;
  if (p.panel) return null;
  return <WorldTouch />;
}

/** A button that behaves like a key: down when the thumb lands, up when it lifts or slides off. */
function keyBtn(k: string) {
  const up = () => keys.delete(k);
  return {
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); e.stopPropagation(); try { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); } catch { /* not a live pointer */ } keys.add(k); press(k); },
    onPointerUp: up, onPointerCancel: up, onLostPointerCapture: up,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };
}

/** A one-shot button: acts on the click, so whatever it opens (a panel, the next screen) can't catch the same tap. */
function tap(k: string) {
  return {
    onPointerDown: (e: React.PointerEvent) => { e.stopPropagation(); },
    onClick: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); press(k); },
  };
}

function WorldTouch() {
  const p = usePlay();
  const [base, setBase] = useState<{ x: number; y: number }>();
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const ids = useRef<{ stick?: number; look?: number; lx: number; ly: number }>({ lx: 0, ly: 0 });
  // A thumb still down when a line starts or a panel opens never sends its "up": let the stick go, or you'd walk off on
  // your own once it closes.
  const talking = !!story.talk;
  useEffect(() => {
    const free = () => { ids.current.stick = ids.current.look = undefined; setBase(undefined); setKnob({ x: 0, y: 0 }); stick.active = false; stick.x = stick.y = 0; };
    if (talking) free();
    return free;
  }, [talking]);
  const down = (e: React.PointerEvent) => {
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* not a live pointer */ }
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
  // Someone is talking: the stick and buttons wait. Tap anywhere (or Continue) for the next line, or skip it all.
  if (story.talk) return (
    <>
      <div className="touch-pad" onPointerDown={(e) => { e.preventDefault(); nextLine(); }} />
      <div className="talk-btns">
        <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); skipTalk(); }}>Skip</button>
        <button className="big" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); nextLine(); }}>Continue</button>
      </div>
    </>
  );
  const D = (R + 8) * 2;
  // Where the stick rests when no thumb is on it: bottom left inside the safe area, so you can see where to put your thumb.
  const pos = base ? { left: base.x - R - 8, top: base.y - R - 8 } : { left: 'calc(var(--sl, 10px) + 14px)', top: `calc(100% - var(--sb, 8px) - ${D + 14}px)` };
  return (
    <>
      <div className="touch-pad" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      <div className={`stick ${base ? 'on' : 'rest'}`} style={{ ...pos, width: D, height: D }}>
        <i style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
        {!base && <span>Move</span>}
      </div>
      <button className="touch-pause" aria-label="Pause" {...tap('p')}><i /><i /></button>
      <div className="touch-btns">
        <button className="big" {...tap('e')}>{p.driving ? 'Step down' : p.prompt ? p.prompt.verb : 'Use'}</button>
        {p.driving || p.racing ? <button {...keyBtn(' ')}>Whip</button> : <button {...keyBtn('shift')}>Run</button>}
        {p.racing ? <><button {...keyBtn('a')}>◀ Lane</button><button {...keyBtn('d')}>Lane ▶</button></> : !p.driving && <button {...tap('c')}>Chariot</button>}
        <button onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); openMap(true); }}>Map</button>
      </div>
    </>
  );
}

// ---------- Hall games ----------

interface Btn { k: string; label: string; big?: boolean; color?: string }
const ARROWS = { l: '◀', r: '▶', u: '▲', d: '▼' };
/** Each game's buttons: left hand and right hand. They press the same keys the game's own hints name. */
const PADS: Record<string, { left?: Btn[]; right: Btn[]; dpad?: boolean }> = {
  archery: { dpad: true, left: [{ k: 'w', label: ARROWS.u }, { k: 'a', label: ARROWS.l }, { k: 'd', label: ARROWS.r }, { k: 's', label: ARROWS.d }], right: [{ k: ' ', label: 'Hold to draw', big: true }] },
  asp: { right: [{ k: ' ', label: 'Hold to reach in', big: true }] },
  axes: { right: [{ k: ' ', label: 'Throw', big: true }] },
  cups: { left: [{ k: 'a', label: ARROWS.l }, { k: 'd', label: ARROWS.r }], right: [{ k: 'e', label: 'Lift', big: true }] },
  dice: { left: [{ k: 's', label: 'Fewer' }, { k: 'w', label: 'More' }, { k: 'a', label: `${ARROWS.l} Face` }, { k: 'd', label: `Face ${ARROWS.r}` }], right: [{ k: 'e', label: 'Bid', big: true }, { k: ' ', label: 'Liar!' }] },
  falcon: { left: [{ k: 'a', label: `${ARROWS.l} Bank` }, { k: 'd', label: `Bank ${ARROWS.r}` }], right: [{ k: 'w', label: 'Stoop', big: true }, { k: 's', label: 'Climb' }] },
  forge: { right: [{ k: ' ', label: 'Strike', big: true }] },
  signals: { right: ['#ff4b3a', '#39f08a', '#4bb6ff', '#ffc23a'].map((c, i) => ({ k: String(i + 1), label: String(i + 1), color: c })) },
  stones: { left: [{ k: 'a', label: ARROWS.l }, { k: 'd', label: ARROWS.r }, { k: 's', label: '↺ Curl' }, { k: 'w', label: 'Curl ↻' }], right: [{ k: ' ', label: 'Hold: weight · tap: sweep', big: true }, { k: 'e', label: 'Hurry' }] },
};

function GameTouch({ id }: { id: string }) {
  usePlay();
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const pad = PADS[id];
  const leaving = session.leaving > performance.now();
  // The "tap again" offer runs out on its own: redraw when it does.
  useEffect(() => { if (!leaving) return; const t = setTimeout(redraw, session.leaving - performance.now() + 50); return () => clearTimeout(t); }, [leaving]);
  // Leave asks once, like Esc: the first tap offers, a second within four seconds walks out.
  const leave = () => {
    if (session.leaving > performance.now()) { quitGame(); return; }
    session.leaving = performance.now() + 4000; redraw();
  };
  const stay = () => { session.leaving = 0; redraw(); };
  const once = (f: () => void) => ({ onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onClick: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); f(); } });
  return (
    <>
      <button className="game-leave-btn" {...once(leave)}>{leaving ? 'Tap again to leave' : '✕ Leave'}</button>
      {leaving && <button className="game-stay-btn" {...once(stay)}>Keep playing</button>}
      {pad?.left && <div className={`gpad left ${pad.dpad ? 'dpad' : 'pairs'}`}>{pad.left.map((b) => <button key={b.k} className={b.big ? 'big' : ''} {...keyBtn(b.k)}>{b.label}</button>)}</div>}
      {pad && <div className={`gpad right ${id === 'signals' ? 'lamps' : ''}`}>{pad.right.map((b) => (
        <button key={b.k} className={b.big ? 'big' : ''} style={b.color ? { background: b.color, borderColor: b.color } : undefined} {...keyBtn(b.k)}>{b.label}</button>
      ))}</div>}
    </>
  );
}
void play;
