// "A week in a minute": the fast-forward at the Mint. Runs chain/week.ts (the contract's pricing rule against simulated
// traders) from the houses as they stand on chain, and draws each house's price as the week plays.
import { useEffect, useMemo, useRef, useState } from 'react';
import { HOUSES } from './realm/layout.ts';
import { Week, WEEK, when } from './chain/week.ts';
import { chain } from './chain/near.ts';

const W = 480, H = 190, MINUTE = 60_000;
/** One distinct line colour per house, each taken from its sigil (heron grey, boar red, ram gold, asp green, owl white,
 *  bull copper, lynx ice, hawk rose), bright enough for the dark panel. */
const ink = ['#9fb4c7', '#e0605a', '#e3b341', '#6cc070', '#f2efe6', '#d98a3a', '#8fd0f0', '#f07aa0'];

export function WeekPanel({ back }: { back: () => void }) {
  const [seed, setSeed] = useState(() => 1 + Math.floor(Math.random() * 1e6));
  const week = useMemo(() => new Week(chain.realm?.houses, seed), [seed]);
  const [running, setRunning] = useState(true);
  const [, tick] = useState(0);
  const [focus, setFocus] = useState<number | null>(null);
  const last = useRef(0);
  useEffect(() => {
    if (!running) return;
    let raf = 0, prev = performance.now();
    const loop = (now: number) => {
      week.advance(((now - prev) / MINUTE) * WEEK);
      prev = now;
      if (now - last.current > 50 || week.done) { last.current = now; tick((n) => n + 1); }
      if (week.done) { setRunning(false); return; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, week]);

  const all = [...week.fair.flat(), ...(focus === null ? [] : week.series[focus])];
  const lo = Math.min(0.8, ...all), hi = Math.max(1.3, ...all);
  const y = (v: number) => H - 8 - ((v - lo) / (hi - lo)) * (H - 16);
  const x = (t: number) => (t / WEEK) * W;
  const st = week.standing();
  const evs = week.events.slice(-5).reverse();
  return (
    <>
      <div className="eyebrow">The Warwick Mint · fast-forward</div>
      <h2>A week in a minute</h2>
      <p className="lede">The eight houses as they stand on NEAR now, a week on: the contract’s own pricing rule against simulated traders, whales and the four rivals. Each line is a coin’s value (its house’s purse per coin). Tap a house to see what the merchant asked, dashed. Nothing is sent.</p>
      <svg className="week-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Each house’s coin price over the week, relative to where it started">
        {[1, 2, 3, 4, 5, 6].map((d) => <line key={d} x1={x(d * 86400)} x2={x(d * 86400)} y1={0} y2={H} className="day" />)}
        <line x1={0} x2={W} y1={y(1)} y2={y(1)} className="par" />
        <text x={4} y={y(1) - 4} className="lab">value at the start</text>
        {week.fair.map((s, i) => (
          <polyline key={i} fill="none" stroke={ink[i]} strokeWidth={focus === i ? 2.4 : 1.6} opacity={focus === null || focus === i ? 0.95 : 0.15}
            points={s.map((v, k) => `${x(k * 3600).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} />
        ))}
        {focus !== null && <polyline fill="none" stroke={ink[focus]} strokeWidth={1.2} strokeDasharray="3 3" opacity={0.85}
          points={week.series[focus].map((v, k) => `${x(k * 3600).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} />}
        {week.events.filter((e) => e.kind === 'shut' || e.kind === 'reopen').map((e, k) => {
          const s = week.fair[e.house], v = s[Math.min(s.length - 1, Math.round(e.t / 3600))];
          return <circle key={k} cx={x(e.t)} cy={y(v)} r={3.2} className={e.kind} opacity={focus === null || focus === e.house ? 1 : 0.2} />;
        })}
        <line x1={x(week.t)} x2={x(week.t)} y1={0} y2={H} className="now" />
      </svg>
      <div className="week-clock"><b>{when(Math.min(week.t, WEEK - 60))}</b><span>{week.trades.toLocaleString()} trades<i className="dot shut" />a run shut the hall<i className="dot reopen" />reopened</span></div>
      <div className="week-houses">{st.map((s) => (
        <button key={s.i} className={`${focus === s.i ? 'on' : ''}${s.shut ? ' shut' : ''}`} title={s.shut ? `House ${HOUSES[s.i].name} is shut by a run` : undefined} onClick={() => setFocus(focus === s.i ? null : s.i)} style={{ ['--c' as string]: ink[s.i] }}>
          <b>${HOUSES[s.i].coin}</b><span className={s.fair >= 1 ? 'up' : 'down'}>×{s.fair.toFixed(2)}</span>{s.shut && <i className="dot shut" />}
        </button>
      ))}</div>
      <ul className="week-log">{evs.length ? evs.map((e, k) => <li key={k} className={e.kind}><time>{when(e.t)}</time> {e.text}.</li>) : <li>Trading has begun…</li>}</ul>
      <div className="actions">
        <button className="ghost" onClick={back}>Back to the Mint</button>
        {week.done
          ? <button className="go" onClick={() => { setSeed(seed + 1); setRunning(true); }}>Run another week</button>
          : <button className="go" onClick={() => setRunning(!running)}>{running ? 'Pause' : 'Play'}</button>}
      </div>
    </>
  );
}
