import { LIBRARY, ROOMS, fade } from './realm/rooms.ts';
// GTA-style HUD pieces: the objective line, subtitles under letterbox bars, the MISSION PASSED card,
// the area name when you ride into somewhere new, tips in the corner, and your purse with renown.
import { useEffect, useRef, useState } from 'react';
import { HOUSES, HIPPODROME, LANDMARKS } from './realm/layout.ts';
import { riverDist } from './realm/heights.ts';
import { fmt, lastPay, ledger } from './realm/ledger.ts';
import { held } from './chain/game.ts';
import { chain, onChain, useChain } from './chain/near.ts';
import { SEALS, abandon, current, nextHint, nextLine, story, timeLeft } from './realm/missions.ts';
import { TOUCH, me, play, usePlay, press } from './realm/play.ts';
import { MARKER } from './realm/Story.tsx';
import { NearMark } from './NearMark.tsx';
import { bark } from './realm/barks.ts';

/** "Buy some **$RAM** at the **Mint counter**" → the bold words in the marker's yellow. */
function Rich({ text }: { text: string }) {
  return <>{text.split('**').map((s, i) => (i % 2 ? <b key={i} style={{ color: MARKER }}>{s}</b> : <span key={i}>{s}</span>))}</>;
}

export function Objective() {
  usePlay();
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 250); return () => clearInterval(i); }, []);
  const c = current();
  if (story.talk) return null;
  if (!c) {
    if (play.inside >= 0) return null;
    return <div className="objective idle"><span className="txt"><Rich text={nextHint().text} /></span><span className="meta book"><kbd>J</kbd> Seal Book</span></div>;
  }
  const left = timeLeft();
  const gates = c.step.gates?.();
  return (
    <div className="objective">
      <span className="txt"><Rich text={c.step.text()} /></span>
      {gates && <span className="meta">{story.run!.gate} / {gates.length}</span>}
      {left !== undefined && <span className={`meta clock ${left < 10 ? 'low' : ''}`}>{Math.max(0, Math.floor(left / 60))}:{String(Math.max(0, Math.floor(left % 60))).padStart(2, '0')}</span>}
      <button className="quit" onClick={abandon} title="Give up this mission">Give up</button>
    </div>
  );
}

export function Talk() {
  const p = usePlay();
  const t = p.game ? undefined : story.talk;
  useEffect(() => {
    if (!t) return;
    // Lines move on by themselves after a while; E, Space or a click moves them on sooner.
    const line = t.lines[t.i], wait = 2200 + line.text.length * 38;
    const id = setTimeout(nextLine, wait);
    return () => clearTimeout(id);
  }, [t, t?.i]);
  return (
    <>
      <div className={`letterbox lb-top ${t ? 'on' : ''}`} />
      <div className={`letterbox lb-bottom ${t ? 'on' : ''}`} onClick={nextLine} />
      {t && <div className="subtitle" onClick={nextLine}><b>{t.lines[t.i].who}</b>{t.lines[t.i].text}<small>{TOUCH ? 'Tap to continue' : 'E to continue'}</small></div>}
    </>
  );
}

/** What someone near you just said: a quiet subtitle that comes and goes. */
export function Bark() {
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 200); return () => clearInterval(i); }, []);
  const age = performance.now() / 1000 - bark.at;
  if (age > 4 || story.talk) return null;
  return <div className={`bark ${age > 3.3 ? 'out' : ''}`} key={bark.at}><b>{bark.who}</b>{bark.text}</div>;
}

export function Card() {
  usePlay();
  const [, tick] = useState(0);
  const c = story.card;
  useEffect(() => {
    if (!c) return;
    sting(c.kind === 'passed');
    const id = setTimeout(() => { if (story.card === c) { story.card = undefined; tick((n) => n + 1); } }, 4600);
    return () => clearTimeout(id);
  }, [c]);
  if (!c) return null;
  return <div className={`mcard ${c.kind}`}><h1>{c.title}</h1><p>{c.sub}</p></div>;
}

/** A short brass chord when a mission ends (made in WebAudio: no sound files). */
function sting(good: boolean) {
  try {
    const ctx = new AudioContext();
    const notes = good ? [261.6, 329.6, 392, 523.3] : [261.6, 311.1, 370, 233.1];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = f;
      const t0 = ctx.currentTime + (good ? i * 0.09 : i * 0.14);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.06, t0 + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
      o.connect(lp).connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + 1.7);
    });
    setTimeout(() => ctx.close(), 2500);
  } catch { /* no audio */ }
}

/** Where you are, as the realm names it. */
function zoneAt(x: number, z: number): [string, string] {
  const d = (p: readonly [number, number]) => Math.hypot(x - p[0], z - p[1]);
  if (d(HIPPODROME.pos) < 95) return ['Mumtaz Hippodrome', 'the chariot arena'];
  if (d(LANDMARKS[4].pos) < 34) return ['Mint Square', 'Emberfall'];
  if (d(LANDMARKS[5].pos) < 26) return ["Qureshi's Library", 'Emberfall'];
  if (d([35, -40]) < 42) return ['The Ashen Throne', 'Emberfall'];
  if (d([20, 0]) < 104) return ['Emberfall', 'the capital'];
  for (const h of HOUSES) if (d(h.pos) < 120) return [h.seat, `House ${h.name} · ${h.land}`];
  if (d(LANDMARKS[3].pos) < 60) return ["Garg's Lighthouse", 'the Greywater coast'];
  if (riverDist(x, z) < 24) return ['The Ember River', 'Vael'];
  if (z < -200) return ["Polosukhin's Reach", 'the northern pines'];
  return ['The open country', 'Vael'];
}
export function AreaName() {
  const [zone, setZone] = useState<[string, string]>();
  const [show, setShow] = useState(false);
  const last = useRef('');
  useEffect(() => {
    let hide = 0;
    const i = setInterval(() => {
      const z: [string, string] = play.inside === LIBRARY ? ['Qureshi’s Library', 'Liar’s Dice under the dome'] : play.inside >= 0 ? [`The hall of House ${HOUSES[play.inside].name}`, ROOMS[play.inside].gameName + ' is played here'] : zoneAt(me.x, me.z);
      if (z[0] !== last.current) {
        last.current = z[0]; setZone(z); setShow(true);
        clearTimeout(hide); hide = window.setTimeout(() => setShow(false), 3100);
      }
    }, 400);
    return () => { clearInterval(i); clearTimeout(hide); };
  }, []);
  if (!zone) return null;
  return <div className={`area ${show ? 'on' : ''}`}><b>{zone[0]}</b><small>{zone[1]}</small></div>;
}

interface Tip { title: string; rows: [string[], string][]; note: string }
// Keys in caps; a row whose "keys" are words (touch) shows them in italics.
const TIPS: Record<string, Tip> = TOUCH ? {
  start: { title: 'On foot', rows: [[['left thumb'], 'drag to walk, to the edge to run'], [['right thumb'], 'drag to look about'], [['radar'], 'tap for the map of Vael']], note: 'Yellow letters on the radar are folk with work for you.' },
  drive: { title: 'At the reins', rows: [[['stick'], 'up to drive, down to rein in, sideways to steer'], [['whip'], 'for speed'], [['steps'], 'to climb down']], note: 'The radar draws back while you drive.' },
} : {
  start: { title: 'On foot', rows: [[['W', 'A', 'S', 'D'], 'walk'], [['Shift'], 'run'], [['Mouse'], 'look about (click to hold it)'], [['M'], 'the map of Vael'], [['Esc'], 'pause']], note: 'Yellow letters on the radar are folk with work for you.' },
  drive: { title: 'At the reins', rows: [[['W'], 'drive on'], [['S'], 'rein in'], [['A', 'D'], 'steer'], [['Space'], 'crack the whip'], [['E'], 'step down']], note: 'The radar draws back while you drive.' },
};
export function Tips() {
  usePlay();
  const [tip, setTip] = useState<Tip>();
  const seen = useRef<Set<string>>(new Set((() => { try { const v = JSON.parse(localStorage.getItem('crownfall.tips') ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } })()));
  const want = play.driving ? 'drive' : 'start';
  // Wait for whoever is talking to finish: a tip over a cutscene is just noise.
  const talking = !!story.talk;
  useEffect(() => {
    if (talking || seen.current.has(want)) return;
    seen.current.add(want);
    try { localStorage.setItem('crownfall.tips', JSON.stringify([...seen.current])); } catch { /* private window */ }
    setTip(TIPS[want]);
    const id = setTimeout(() => setTip(undefined), 11000);
    return () => clearTimeout(id);
  }, [want, talking]);
  if (!tip || talking) return null;
  return (
    <div className="tip" onClick={() => setTip(undefined)}>
      <h4>{tip.title}</h4>
      <ul>{tip.rows.map(([keys, what]) => (
        <li key={what} style={{ display: 'contents' }}>
          <span className="keys">{keys.map((k) => (k.length > 5 && k === k.toLowerCase() ? <i key={k}>{k}</i> : <kbd key={k}>{k}</kbd>))}</span>
          <span>{what}</span>
        </li>
      ))}</ul>
      <p>{tip.note}</p>
    </div>
  );
}

/** Top right: your purse, your renown as crowns, and the reward ticking in. */
export function Status() {
  usePlay();
  useChain();
  const purse = onChain() ? chain.balance : ledger.near;
  const h = HOUSES[play.seat!.house];
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 300); return () => clearInterval(i); }, []);
  const paid = Date.now() - lastPay.t < 3500;
  const crowns = Math.min(5, Math.floor(story.saved.renown / 2));
  // Show the purse when something in it changes, for a moment after you arrive, when you stand still a while,
  // and whenever you pause, trade or finish a mission. Otherwise the screen is the world's.
  const sig = `${purse.toFixed(2)}|${held(h.id)}|${story.saved.renown}`, seen = useRef({ sig, at: Date.now(), still: Date.now() });
  const now = Date.now();
  if (seen.current.sig !== sig) { seen.current.sig = sig; seen.current.at = now; }
  if (Math.abs(me.speed) > 0.3 || play.driving) seen.current.still = now;
  const show = now - seen.current.at < 6000 || now - seen.current.still > 2500 || play.paused || !!play.panel || !!story.card;
  return (
    <div className={`status ${show ? '' : 'quiet'}`} style={{ ['--c' as string]: h.colors[0] }}>
      <div className="money"><NearMark size={16} />{purse.toFixed(2)}{paid && <em>+{lastPay.amount}</em>}</div>
      <div className="coinrow">{fmt(held(h.id))} ${h.coin}{onChain() && <small className="live"> · testnet</small>}</div>
      <div className="crowns" title={`Renown ${story.saved.renown}`}>{Array.from({ length: 5 }, (_, i) => <i key={i} className={i < crowns ? 'on' : ''}>♛</i>)}</div>
    </div>
  );
}

/** The black between outside and in (rooms.ts starts it; the move happens at its darkest). */
export function Fade() {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = (performance.now() - fade.at) / fade.dur;
      if (el.current) el.current.style.opacity = t < 0 || t > 1 ? '0' : String(Math.sin(Math.min(1, t) * Math.PI) ** 0.6);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <div ref={el} className="fade" />;
}

/** Little wax-seal glyphs, one per Warden (24×24, stroked). */
export const SEAL_ICON: Record<string, string> = {
  Gate: 'M5 21V10a7 7 0 0 1 14 0v11M9 21v-8a3 3 0 0 1 6 0v8M3 21h18',
  Mint: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7v10M9.5 9.5h4a1.6 1.6 0 0 1 0 3.2h-3a1.6 1.6 0 0 0 0 3.2h4',
  Bridge: 'M2 15h20M3 15a9 7 0 0 1 18 0M7 15v4M17 15v4M12 8v7',
  Lighthouse: 'M9 21l1.4-12h3.2L15 21M8.5 9h7M10 9V6h4v3M12 3v3M4 5l3 2M20 5l-3 2M7 21h10',
  Library: 'M4 5c3-1 6-1 8 1c2-2 5-2 8-1v14c-3-1-6-1-8 1c-2-2-5-2-8-1zM12 6v14',
  Hippodrome: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16M12 4v16M4 12h16M6.3 6.3l11.4 11.4M17.7 6.3L6.3 17.7',
  Throne: 'M4 18h16M5 18l-1-10l5 4l3-7l3 7l5-4l-1 10',
};
export function SealGlyph({ seal, size = 22 }: { seal: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d={SEAL_ICON[seal]} /></svg>;
}

/** Top middle: the seven seals, filled in as you earn them. */
export function SealBar() {
  const p = usePlay();
  if (p.racing || p.game || story.talk) return null;
  const have = story.saved.seals;
  return (
    <div className="sealbar" title="Press J for the Seal Book" onPointerDown={TOUCH ? (e) => { e.stopPropagation(); press('j'); } : undefined}>
      {SEALS.map((s) => <i key={s} className={have.includes(s) ? 'on' : ''} title={`Seal of the ${s}`}><SealGlyph seal={s} size={18} /></i>)}
      <span>{have.length} / 7 seals · <kbd>J</kbd></span>
    </div>
  );
}
