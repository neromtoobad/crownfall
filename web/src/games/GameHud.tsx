// The hall game's cards and HUD: the intro (name, rule, keys, entry burned), the round's own HUD, the result.
import { LIBRARY, hallHouse } from '../realm/rooms.ts';
import { SealGlyph } from '../StoryHud.tsx';
import { fmt, ledger } from '../realm/ledger.ts';
import { TOUCH, usePlay } from '../realm/play.ts';
import { beginRound, gameDef, libDoubles, quitGame, session } from './host.ts';
import { sigilURL } from '../realm/sigils.ts';
import { useMemo } from 'react';
import { buyCoin, held } from '../chain/game.ts';
import { onChain, useChain } from '../chain/near.ts';

export function GameHud() {
  const p = usePlay();
  const c = useChain();
  const room = session.room;
  const def = room && gameDef(room.game);
  const sig = useMemo(() => (room && room.house !== LIBRARY ? sigilURL(room.house, 120, hallHouse(room.house).colors[1]) : ''), [room]);
  if (!p.game || !room || !def) return null;
  const h = hallHouse(room.house), lib = room.house === LIBRARY;
  const live = onChain(), short = live && !lib && held(room.house) < def.entry;
  const style = { ['--c' as string]: h.colors[0], ['--c2' as string]: h.colors[1] };
  if (session.phase === 'play') return (
    <>
      {def.Hud && <def.Hud />}
      {!TOUCH && <div className="game-esc"><kbd>Esc</kbd> leave the table</div>}
      {session.leaving > performance.now() && (
        <div className="game-leave" style={style}>
          <b>Leave the table?</b>
          <span>{lib ? (session.staked > 0 ? `The round counts as lost and your ${session.staked} NEAR stake goes to the crown pool${live ? ', on NEAR' : ''}.` : 'The game counts as lost.') : `The round counts as lost. The ${fmt(def.entry)} $${h.coin} is already burned${live ? ' on NEAR' : ''}.`}</span>
          {TOUCH ? <span className="leave-keys">Tap Leave again to go · Keep playing to stay</span> : <span className="leave-keys"><kbd>Esc</kbd> again to leave · any other key to keep playing</span>}
        </div>
      )}
    </>
  );
  if (session.phase === 'intro') return (
    <div className="game-card" style={style}>
      {lib ? <div className="sig glyph"><SealGlyph seal="Library" size={64} /></div> : <img className="sig" src={sig} alt="" />}
      <small>{lib ? 'Qureshi’s Library · across the table from Haseeb Qureshi' : `The hall of House ${h.name}`}</small>
      <h2>{def.name}</h2>
      <p>{def.pitch}</p>
      <div className="keys">{def.keys.map(([k, v]) => <div key={k}><kbd>{k}</kbd><span>{v}</span></div>)}</div>
      <div className="entry">
        {live
          ? (lib
            ? <><b>Stake: 1 NEAR on the table, on NEAR.</b><span>Your wallet asks for it. {c.me?.halls_won.includes(LIBRARY) ? 'Win and it comes back to you' : 'Your first win here pays it back doubled (the extra comes from the crown pool, while it lasts); after that a win hands it back'}. Lose and it goes to the crown pool.</span></>
            : <><b>Entry: {fmt(def.entry)} ${h.coin}, burned on NEAR.</b><span>{short ? `You hold ${fmt(held(room.house))}: buy some first.` : `You hold ${fmt(held(room.house))}.`} The burn raises ${h.coin} for every holder and counts as favour with House {h.name}.</span></>)
          : lib
          ? (session.free ? <><b>Haseeb stands you the first game.</b><span>Win it and he pays you {def.entry} NEAR. After this the stake is {def.entry} NEAR: your first staked win pays it back doubled, later wins hand it back.</span></> : <><b>Stake: {def.entry} NEAR on the table.</b><span>{libDoubles() ? 'Your first win here pays it back doubled; after that a win hands it back.' : 'Win and it comes back to you.'} Lose and it goes to the crown pool.</span></>)
          : session.free
          ? <><b>The house stands you this round.</b><span>After this, a round burns {fmt(def.entry)} ${h.coin}.</span></>
          : <><b>Entry: {fmt(def.entry)} ${h.coin}, burned.</b><span>{ledger.held[room.house] >= def.entry ? `You hold ${fmt(ledger.held[room.house])}.` : 'Bought on the curve for you first.'} Every round played here raises ${h.coin} for its holders.</span></>}
      </div>
      {session.error && <div className="err">{session.error}</div>}
      {session.busy && <div className="err ok">{c.busy || 'Waiting for NEAR'}…</div>}
      {short && <div className="go"><button className="ghost" disabled={!!c.busy} onClick={() => void buyCoin(room.house, 0.05)}>Buy 0.05 NEAR of ${h.coin}</button></div>}
      <div className="go"><button disabled={session.busy || short} onClick={beginRound}><kbd>E</kbd> Play</button><button className="ghost" onClick={quitGame}><kbd>Esc</kbd> Not now</button></div>
    </div>
  );
  const r = session.result!;
  if (session.busy) return <div className="game-card result" style={style}><small>{def.name}</small><h2>One moment</h2><p>{c.busy || 'Waiting for NEAR'}…</p></div>;
  return (
    <div className={`game-card result ${r.won ? 'won' : 'lost'}`} style={style}>
      <small>{def.name}</small>
      <h2>{r.won ? 'Won' : 'Lost'}</h2>
      <p>{r.line}</p>
      {r.won && live && <div className="entry"><b>{lib ? (session.libBonus > 0 ? `Your stake comes back doubled: ${(session.staked + session.libBonus).toFixed(2)} NEAR` : 'Your stake comes back to you') : `Favour with House ${h.name}, recorded on NEAR`}</b><span>{lib ? 'Haseeb nods. That one he’ll remember.' : 'A won round counts your burn again, up to twice again for a perfect one. At the season’s end the house with the most favour is crowned and its players share the crown pool.'}</span></div>}
      {!r.won && live && <div className="entry"><b>{lib ? 'The stake goes to the crown pool' : `The ${h.coin} you burned still counts as favour`}</b><span>The round is closed on NEAR.</span></div>}
      {r.won && !live && <div className="entry"><b>+{session.payout} NEAR {lib ? 'from the Library’s table' : `from the treasury of House ${h.name}`}</b><span>{lib ? 'Haseeb nods. That one he’ll remember.' : `Favour with House ${h.name}: ${ledger.favour[room.house]}`}</span></div>}
      <div className="go"><button disabled={session.busy} onClick={beginRound}><kbd>E</kbd> Again ({lib ? `${def.entry} NEAR` : `${fmt(def.entry)} $${h.coin}`})</button><button className="ghost" onClick={quitGame}><kbd>Esc</kbd> Done</button></div>
    </div>
  );
}
