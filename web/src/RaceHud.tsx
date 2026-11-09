// The race card: what is running at the Hippodrome, the standings, odds, your bet and your whips.
// On NEAR the race on the track is the contract's: bets are real (testnet) NEAR, whips burn house coin, and the
// result is the one the contract computes by running the same race this screen draws.
import { useEffect, useState } from 'react';
import { HOUSES } from './realm/layout.ts';
import { NearMark } from './NearMark.tsx';
import { M, back, betsOpen, crack, laneLen, laneR, live as liveRace, odds, setWatch, standings, toOff, useRace } from './realm/race.ts';
import { CONTRACT, EXPLORER, onChain, useChain } from './chain/near.ts';
import { WHIP_COINS, WHIP_SECS, bet, callRace, collect, whip, winnings } from './chain/races.ts';
import { held } from './chain/game.ts';
import { rivalOf, useRivals, type Feed } from './chain/rivals.ts';
import { fmt } from './realm/ledger.ts';

const nth = (n: number) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th');
const STAKES = [0.1, 0.5, 1];

export function RaceHud() {
  const live = useRace();
  const c = useChain();
  const [stake, setStake] = useState(0.1);
  const feed = useRivals();
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(i); }, []);
  const r = live.race;
  const cv = r.chain ? live.chain : undefined;
  const order = standings(r);
  const leader = HOUSES[order[0].house];
  const lap = Math.min(r.cup.laps, Math.floor(order[0].p) + 1);
  const off = Math.ceil(toOff(r));
  const status = r.phase === 'parade'
    ? (cv ? (betsOpen() ? `Betting closes in ${off >= 60 ? `${Math.floor(off / 60)}:${String(off % 60).padStart(2, '0')}` : `${off}s`}` : 'Betting closed · the seed is drawn on NEAR at the start') : `Under starter's orders · ${off}s`)
    : r.phase === 'run' ? `Lap ${lap} of ${r.cup.laps}`
    : cv ? (cv.settled ? 'Settled on NEAR' : 'Over the line · settling on NEAR') : 'Result';

  if (!live.watch) {
    return (
      <button className="race-ticker" onClick={() => setWatch(true)}>
        <span className="eyebrow">Mumtaz Hippodrome · race {r.n}{cv ? ' · on NEAR' : ''}</span>
        <b>{r.cup.name}</b>
        <span className="row">{status}{r.phase !== 'parade' && <> · <i style={{ background: leader.colors[0] }} />{leader.name} leads</>}</span>
        <span className="cta">Watch the race →<span className="on-near"><NearMark size={11} /> {cv ? 'bets and result on NEAR' : onChain() ? 'practice heat' : 'connect to bet on NEAR'}</span></span>
      </button>
    );
  }

  // ---- Practice (no wallet, or a heat you are driving) ----
  if (!cv) {
    const backed = r.backed;
    const won = r.phase === 'done' ? order[0] : undefined;
    return (
      <aside className="race-card">
        <div className="eyebrow">Mumtaz Hippodrome · race {r.n} · {r.cup.laps} {r.cup.laps > 1 ? 'laps' : 'lap'} · practice</div>
        <h2>{r.cup.name}</h2>
        <div className="race-status">{status}</div>
        {won && <div className="winner" style={{ ['--c' as string]: HOUSES[won.house].colors[0] }}>{r.cup.name} goes to <b>House {HOUSES[won.house].name}</b></div>}
        <Standings order={order} backed={backed} odds={(ru) => `${odds(r, ru).toFixed(1)}×`} action={r.phase === 'parade' ? (h) => <button className="back" onClick={() => back(h)}>{backed === h ? 'Backed' : 'Back'}</button> : undefined} />
        {backed !== undefined && r.phase === 'run' && (
          <button className="whip" onClick={crack} disabled={r.yourWhips <= 0 || r.runners[backed].finish !== undefined}>
            Crack the whip for {HOUSES[backed].name} <small>{r.yourWhips} left</small>
          </button>
        )}
        {won && backed !== undefined && (
          <div className="slip">{won.house === backed ? `Your practice slip on ${HOUSES[backed].name} pays ${odds(r, won).toFixed(2)}×.` : `${HOUSES[backed].name} finished ${nth(order.findIndex((x) => x.house === backed) + 1)}. Next race soon.`}</div>
        )}
        <Rivals feed={feed} onNear />
        <div className="foot">
          <span className="mono">seed {r.seed.toString(16).padStart(8, '0')}</span>
          <span className="on-near"><NearMark size={12} /> {onChain() ? 'A practice heat. The races on NEAR come back on the track after it.' : 'Practice slips. Connect a wallet (top left) to bet on NEAR testnet.'}</span>
        </div>
        <button className="ghost leave" onClick={() => setWatch(false)}>Leave the stands</button>
      </aside>
    );
  }

  // ---- On NEAR ----
  const total = cv.pools.reduce((a, b) => a + b, 0);
  const mine = cv.ticket?.bets ?? [];
  const myBet = mine.reduce((a, b) => a + b, 0);
  const backedH = mine.length ? mine.indexOf(Math.max(...mine)) : -1;
  // The contract only lets a ticket holder whip: back a team first.
  const whipHouse = backedH >= 0 && mine[backedH] > 0 ? backedH : undefined;
  const whipOpen = r.phase !== 'parade' && cv.startMs !== undefined && Date.now() < cv.startMs + WHIP_SECS * 1000;
  const open = betsOpen();
  const whipsLeft = 3 - (cv.ticket?.whips ?? 0);
  const win = cv.settled ? cv.order[0] : undefined;
  const pays = winnings(cv);
  const busy = !!c.busy;
  return (
    <aside className="race-card">
      <div className="eyebrow">Mumtaz Hippodrome · race {cv.n} · {cv.laps} {cv.laps > 1 ? 'laps' : 'lap'} · <span className="near-word"><NearMark size={11} /> on NEAR</span></div>
      <h2>{r.cup.name}</h2>
      <div className="race-status">{status}</div>
      {win !== undefined && <div className="winner" style={{ ['--c' as string]: HOUSES[win].colors[0] }}>The contract ran it: <b>House {HOUSES[win].name}</b> wins</div>}
      {open && (
        <div className="stakes">Stake {STAKES.map((s) => <button key={s} className={s === stake ? 'on' : ''} onClick={() => setStake(s)}>{s} NEAR</button>)}<small>Your first bet in a race pays 0.0025 NEAR for its ticket.</small></div>
      )}
      <Standings
        order={order}
        backed={backedH >= 0 && mine[backedH] > 0 ? backedH : undefined}
        odds={(ru) => (cv.pools[ru.house] > 0 ? `${((total * 0.95) / cv.pools[ru.house]).toFixed(1)}×` : '—')}
        sub={(h) => (cv.pools[h] > 0 ? `${cv.pools[h].toFixed(2)} N` : '')}
        action={open ? (h) => <button className="back" disabled={busy} onClick={() => void bet(h, stake).catch(() => {})}>{mine[h] > 0 ? `+${stake}` : 'Back'}</button> : undefined}
      />
      {myBet > 0 && <div className="slip">Your bets: {mine.map((b, h) => (b > 0 ? `${b} NEAR on ${HOUSES[h].name}` : '')).filter(Boolean).join(', ')}.</div>}
      {whipOpen && whipHouse !== undefined && (
        <button className="whip" disabled={busy || whipsLeft <= 0 || held(whipHouse) < WHIP_COINS} onClick={() => void whip(whipHouse).catch(() => {})}>
          Crack the whip for {HOUSES[whipHouse].name}
          <small>{whipsLeft} left · burns {WHIP_COINS} ${HOUSES[whipHouse].coin}{held(whipHouse) < WHIP_COINS ? ` · you hold ${fmt(held(whipHouse))}, buy at the Mint` : ''}</small>
        </button>
      )}
      {whipOpen && whipHouse === undefined && <div className="slip">Back a team to crack the whip for it. A whip burns {WHIP_COINS} of that house’s coin.</div>}
      {cv.settled && pays > 0 && !cv.ticket?.claimed && <button className="whip" disabled={busy} onClick={() => void collect().catch(() => {})}>Collect {pays.toFixed(3)} NEAR</button>}
      {cv.settled && cv.ticket?.claimed && <div className="slip">Collected. The winnings are in your wallet.</div>}
      {cv.settled && myBet > 0 && pays === 0 && win !== undefined && <div className="slip">{HOUSES[win].name} won; your teams didn’t. Your stake stays in the pot for the winners.</div>}
      {cv.settled && <button className="ghost" disabled={busy} onClick={() => void callRace().catch(() => {})}>Call the next race</button>}
      <Rivals feed={feed} race={cv.n} />
      <div className="foot">
        <span className="mono">{cv.startMs !== undefined ? `seed ${cv.seed.toString(16).padStart(8, '0')}` : 'seed not drawn yet'} · {cv.whips.length} whips</span>
        <span className="on-near"><NearMark size={12} /> Seeded by the block that starts it, after betting closes, so no bettor could know the result. The contract runs this same race to settle it. <a href={`${EXPLORER}/address/${CONTRACT}`} target="_blank" rel="noreferrer">contract</a></span>
      </div>
      <button className="ghost leave" onClick={() => setWatch(false)}>Leave the stands</button>
    </aside>
  );
}

/** The rival agents' moves in this race (or, from a practice heat, in the latest race on NEAR), with their reasons. */
function Rivals({ feed, race, onNear }: { feed?: Feed; race?: number; onNear?: boolean }) {
  if (!feed?.events.length) return null;
  const last = race ?? Math.max(...feed.events.map((e) => e.race ?? -1));
  const moves = feed.events.filter((e) => e.race === last && (e.kind === 'bet' || e.kind === 'sit' || e.kind === 'whip' || e.kind === 'claim')).slice(-8);
  if (!moves.length) return null;
  return (
    <div className="rivals">
      <div className="eyebrow">{onNear ? `Meanwhile on NEAR, race ${last}: the rivals` : 'The rivals in this race'} · <span title={feed.model ? `Their bets are decided by ${feed.model} on NEAR AI Cloud` : 'Their bets follow fixed rules'}>agents with their own wallets</span></div>
      <ul>
        {moves.map((e) => {
          const who = rivalOf(feed, e.who);
          const what = e.kind === 'bet' ? `${e.near} NEAR on ${HOUSES[e.house ?? 0].name}` : e.kind === 'whip' ? `whips ${HOUSES[e.house ?? 0].name}` : e.kind === 'claim' ? `collects ${e.near} NEAR` : 'sits this one out';
          return (
            <li key={`${e.t}-${e.who}-${e.kind}`}>
              <i style={{ background: HOUSES[who?.house ?? 0].colors[0] }} />
              <span><b>{who?.name ?? e.who}</b> {e.tx && e.tx !== 'dry' ? <a href={`${EXPLORER}/txns/${e.tx}`} target="_blank" rel="noreferrer">{what}</a> : what}
                {e.why && <small>“{e.why}”</small>}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type RunnerLike = ReturnType<typeof standings>[number];
function Standings({ order, backed, odds: oddsOf, sub, action }: { order: RunnerLike[]; backed?: number; odds: (ru: RunnerLike) => string; sub?: (h: number) => string; action?: (h: number) => JSX.Element }) {
  return (
    <ol className="standings">
      {order.map((ru, i) => {
        const h = HOUSES[ru.house];
        const metres = Math.round(((order[0].p - ru.p) * laneLen(laneR(3.5))) / M);
        const gap = i === 0 ? '' : ru.finish !== undefined && order[0].finish !== undefined ? `+${(ru.finish - order[0].finish).toFixed(2)}s` : metres > 0 ? `−${metres} m` : 'level';
        return (
          <li key={ru.house} className={backed === ru.house ? 'mine' : ''}>
            <span className="pos">{i + 1}</span>
            <i style={{ background: `linear-gradient(${h.colors[0]} 60%, ${h.colors[1]} 60%)` }} />
            <span className="name">{h.name}<small>${h.coin}{sub?.(ru.house) ? ` · ${sub(ru.house)}` : ''}</small></span>
            <span className="odds">{oddsOf(ru)}</span>
            {action ? action(ru.house) : <span className="gap mono">{gap}</span>}
          </li>
        );
      })}
    </ol>
  );
}
