// The HUD for play mode: taking a seat, the "E" prompt, the controls, your purse, and the panel behind each place.
import { useEffect, useState } from 'react';
import { BODIES, openPanel, pause, play, practise, setMode, takeSeat, usePlay, type Prompt } from './realm/play.ts';
import { HOUSES } from './realm/layout.ts';
import { DECREES, buy, decree, fmt, ledger, muster, priceAt, raven, sell } from './realm/ledger.ts';
import { live, setWatch, useRace, laneLen, laneR, M, MID, standings } from './realm/race.ts';
import { RaceHud } from './RaceHud.tsx';
import { startDrive } from './realm/drive.ts';
import { NearMark } from './NearMark.tsx';
import { FullMap, Radar, openMap } from './Radar.tsx';
import { NearPill } from './NearMark.tsx';
import { Bark, AreaName, Card, Objective, Status, Talk, Tips } from './StoryHud.tsx';
import { Touch } from './Touch.tsx';
import { TOUCH } from './realm/play.ts';
import { GameHud } from './games/GameHud.tsx';
import { Fade, SealBar, SealGlyph } from './StoryHud.tsx';
import { MISSIONS, WARDENS, nextHint, story } from './realm/missions.ts';
import { ROOMS } from './realm/rooms.ts';
import { ChainBar } from './chain/ChainBar.tsx';
import { buyCoin, burned, claimCrown, crownOf, endSeason, favour, held, price, sellCoin, supply, type Crown } from './chain/game.ts';
import { CONTRACT, EXPLORER, ensureKey, onChain, openSignIn, signsHere, units, useChain } from './chain/near.ts';
import { SignIn } from './chain/SignIn.tsx';

export function PlayHud() {
  const p = usePlay();
  const watching = useRace().watch && !p.racing && !p.game;
  const c = useChain();
  return (
    <>
      {p.picking && <SeatPicker />}
      {c.signingIn && <SignIn suggest={c.signInHint || play.seat?.name} />}
      {p.mode === 'play' && p.seat && !p.picking && (
        <>
          {p.racing && <DriveHud />}
          {!p.racing && !p.game && p.inside < 0 && <Radar size={TOUCH ? 108 : 210} />}
          <Status />
          {!p.game && !p.racing && <ChainBar />}
          <AreaName />
          <SealBar />
          {watching && <RaceHud />}
          {!p.panel && !p.racing && !p.game && !watching && <Objective />}
          {p.prompt && !p.driving && !p.panel && !p.racing && !p.game && !story.talk && !watching && <div className="prompt"><kbd>E</kbd><b>{p.prompt.verb}</b> {p.prompt.what}</div>}
          {p.racing && !TOUCH && <Help />}
          {!p.game && <Tips />}
          <Talk />
          <Bark />
          <Card />
          {TOUCH && <Touch />}
          <FullMap />
          {p.panel && <Panel prompt={p.panel} />}
          {p.paused && <Pause />}
          <GameHud />
          <Fade />
        </>
      )}
    </>
  );
}

const nth = (n: number) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th');

/** Your place, lap, lane and whips while you drive. */
function DriveHud() {
  const race = useRace().race;
  const h = play.seat!.house, x = HOUSES[h];
  if (race.driver !== h) {
    return <div className="drive-hud wait" style={{ ['--c' as string]: x.colors[0] }}><b>At the stables</b><span>You take the reins of House {x.name} in the next race. Watching {race.cup.name} until then.</span></div>;
  }
  const order = standings(race), you = race.runners[h], place = order.indexOf(you) + 1;
  const lap = Math.min(race.cup.laps, Math.floor(you.p) + 1);
  const ahead = order[place - 2];
  const gap = ahead ? Math.round(((ahead.p - you.p) * MID) / M) : 0;
  return (
    <div className="drive-hud" style={{ ['--c' as string]: x.colors[0] }}>
      <div className="big">{race.phase === 'parade' ? `${Math.max(0, Math.ceil(9 - race.t))}` : nth(place)}<small>{race.phase === 'parade' ? 'to the off' : `of ${order.length}`}</small></div>
      <div className="rows">
        <b>{race.cup.name}</b>
        <span>{race.phase === 'parade' ? `Lane ${you.lane + 1} · under starter's orders` : you.finish !== undefined ? `Finished in ${you.finish.toFixed(1)}s` : `Lap ${lap} of ${race.cup.laps} · lane ${Math.round(you.tl) + 1}${ahead ? ` · ${gap} m behind ${HOUSES[ahead.house].name}` : ' · leading'}`}</span>
        <span className="whips">{Array.from({ length: 3 }, (_, i) => <i key={i} className={i < race.yourWhips ? 'on' : ''} />)} whips{you.want ? <em className="wait">Waiting for the lane to clear…</em> : you.blocked ? <em>Boxed in, change lane</em> : null}</span>
      </div>
    </div>
  );
}

function Help() {
  const p = usePlay();
  const rows = p.racing
    ? [['A D', 'change lane'], ['Space', 'whip'], ['Esc', 'leave the race']]
    : p.driving
      ? [['W S', 'drive and brake'], ['A D', 'steer'], ['Space', 'crack the whip'], ['E', 'step down']]
      : [['W A S D', 'walk'], ['Shift', 'run'], ['Mouse', 'look (click to lock)'], ['E', 'use or ride'], ['C', 'call your chariot']];
  return <div className="help">{rows.map(([k, v]) => <div key={k}><kbd>{k}</kbd>{v}</div>)}</div>;
}

function SeatPicker() {
  const [body, setBody] = useState(play.seat?.body ?? 'lord-ram');
  const [house, setHouse] = useState(play.seat?.house ?? 2);
  const [name, setName] = useState(play.seat?.name ?? '');
  const [motto, setMotto] = useState(play.seat?.motto ?? '');
  const [entering, setEntering] = useState(false);
  const c = useChain();
  const h = HOUSES[house];
  const seat = () => ({ body, house, name: name.trim() || 'A nameless lord', motto: motto.trim() });
  // With a wallet: approve the game key now, once, so the first hall round doesn't stop for a popup. If it's
  // declined you still go in, and the key is asked for again at your first round.
  const enter = async () => {
    if (!c.account) { openSignIn(name); return; }
    setEntering(true);
    try { await ensureKey(); } catch { /* asked again later */ }
    setEntering(false);
    takeSeat(seat());
  };
  const short = (a: string) => (a.length > 26 ? `${a.slice(0, 12)}…${a.slice(-10)}` : a);
  return (
    <div className="scrim">
      <form className="picker" style={{ ['--c' as string]: h.colors[0], ['--c2' as string]: h.colors[1] }}
        onSubmit={(e) => { e.preventDefault(); void enter(); }}>
        <div className="eyebrow">The realm of Vael</div>
        <h1>Take your seat</h1>
        <div className={`wallet-step ${c.account ? 'on' : ''}`}>
          <NearMark size={22} />
          {c.account ? (
            <div><b>{short(c.account)}</b><span>{signsHere()
              ? 'Your NEAR testnet account. Coins, hall rounds, seals and bets all sign in this browser, with no popups.'
              : `Connected on NEAR testnet. ${c.keyed ? 'Game key ready: hall rounds, seals and whips sign without a popup.' : 'On the way in your wallet asks once for a game key, so hall rounds and seals sign without a popup.'}`}</span></div>
          ) : (
            <div><b>Sign in to play on NEAR</b><span>With Google or just a name, and the realm makes you a NEAR testnet account with a little NEAR in it. No wallet needed. Your coin, rounds, seals and bets live in the realm contract.</span></div>
          )}
          {!c.account && <button type="button" className="near-btn" onClick={() => openSignIn(name)} disabled={!!c.busy}>Sign in</button>}
          {c.error && !c.busy && <p className="err">{c.error}</p>}
        </div>
        <label>Who walks for you</label>
        <div className="chips">{BODIES.map((b) => <button type="button" key={b.id} className={b.id === body ? 'on' : ''} onClick={() => setBody(b.id)}>{b.name}</button>)}</div>
        <label>Your house</label>
        <div className="houses">{HOUSES.map((x) => (
          <button type="button" key={x.id} className={x.id === house ? 'on' : ''} style={{ ['--c' as string]: x.colors[0], ['--c2' as string]: x.colors[1] }} onClick={() => setHouse(x.id)}>
            <i /><span><b>{x.name}</b><small>{x.sigil} · ${x.coin}</small></span>
          </button>
        ))}</div>
        <div className="row2">
          <div><label htmlFor="nm">Your name</label><input id="nm" value={name} maxLength={28} placeholder="Ser Ada of Vinehold" onChange={(e) => setName(e.target.value)} /></div>
          <div><label htmlFor="mo">Your words</label><input id="mo" value={motto} maxLength={40} placeholder="We do not kneel" onChange={(e) => setMotto(e.target.value)} /></div>
        </div>
        <div className="actions">
          <button type="button" className="ghost" onClick={() => { play.picking = false; setMode('map'); }}>Not now</button>
          {!c.account && <button type="button" className="link practise" onClick={() => { practise(); takeSeat(seat()); }}>Practice without signing in</button>}
          <button type="submit" className="go" disabled={entering}>{entering ? 'Approve the game key in your wallet…' : c.account ? `Enter the realm as House ${h.name}` : 'Sign in to enter'}</button>
        </div>
      </form>
    </div>
  );
}

const LORD_LINES: Record<number, string[]> = {
  0: ['Greywater remembers every debt. Do you?', 'The tide brings ships, and ships bring coin. Come back with either.'],
  1: ['Redfield feeds this realm. Remember that when you count your bread.', 'Boars do not bargain. We charge.'],
  2: ['Vinehold pours for friends and poisons for the rest. Which are you?', 'A golden ram climbs where others fall.'],
  3: ['The marsh swallows armies. Ask Corrin.', 'Speak softly. The asp hears everything.'],
  4: ['Pinewatch sees your march before you take a step.', 'Wisdom is patience with a long memory.'],
  5: ['Stonedeep has iron enough for every sword in Vael. For a price.', 'The bull does not move. The bull is moved for.'],
  6: ['Snow keeps High Marrow, and so does the queen.', 'The lynx waits on the ridge until you tire.'],
  7: ['From Gullcrest you can see every sail. Even yours.', 'The hawk strikes once.'],
};

function Panel({ prompt }: { prompt: Prompt }) {
  const close = () => openPanel(undefined);
  const seat = play.seat!;
  const mine = HOUSES[seat.house];
  const h = prompt.house !== undefined ? HOUSES[prompt.house] : mine;
  return (
    <div className="scrim" onClick={close}>
      <div className={`panel ${prompt.panel === 'seals' ? 'book' : ''}`} style={{ ['--c' as string]: h.colors[0] }} onClick={(e) => e.stopPropagation()}>
        <button className="x" onClick={close} aria-label="Close">Esc</button>
        {prompt.panel === 'mint' && <MintPanel />}
        {prompt.panel === 'war' && <WarPanel house={seat.house} />}
        {prompt.panel === 'gate-of' && <GateOf house={h.id} />}
        {prompt.panel === 'lord' && <LordPanel house={h.id} />}
        {prompt.panel === 'council' && <Council />}
        {prompt.panel === 'raven' && <Raven />}
        {prompt.panel === 'library' && <Library />}
        {prompt.panel === 'march' && <March />}
        {prompt.panel === 'race' && <RacePanel onGo={close} />}
        {prompt.panel === 'seals' && <SealBook />}
      </div>
    </div>
  );
}

function MintPanel() {
  usePlay();
  const c = useChain();
  const [h, setH] = useState(play.seat!.house);
  const [amt, setAmt] = useState(onChain() ? '0.1' : '1');
  const x = HOUSES[h];
  const n = Number(amt) || 0;
  const live = onChain();
  const purse = live ? c.balance : ledger.near;
  return (
    <>
      <div className="eyebrow">The Warwick Mint · {live ? 'on NEAR testnet' : 'practice purse'}</div>
      <h2>Buy and sell house coin</h2>
      <p className="lede">A house coin is worth its house’s NEAR reserve divided by its supply. Every round played in a hall burns coin, so the price only climbs while people play. A 5% fee on each trade: 3 points stay in the reserve, 2 go to the crown pool.</p>
      <div className="chips">{HOUSES.map((y) => <button key={y.id} className={y.id === h ? 'on' : ''} onClick={() => setH(y.id)}>${y.coin}</button>)}</div>
      <dl className="stats">
        <div><dt>Price</dt><dd>{price(h).toPrecision(3)} NEAR</dd></div>
        <div><dt>Supply</dt><dd>{fmt(supply(h))}</dd></div>
        {live && <div><dt>Burned</dt><dd>{fmt(burned(h))}</dd></div>}
        <div><dt>You hold</dt><dd>{fmt(held(h))} ${x.coin}</dd></div>
      </dl>
      <div className="trade">
        <input value={amt} inputMode="decimal" onChange={(e) => setAmt(e.target.value)} aria-label="NEAR to spend" />
        <button className="go" disabled={n <= 0 || n > purse || !!c.busy} onClick={() => void buyCoin(h, n)}>Buy with {n || 0} NEAR</button>
        <button className="ghost" disabled={held(h) <= 0 || !!c.busy} onClick={() => void sellCoin(h, held(h) / 2)}>Sell half</button>
      </div>
      {live
        ? <p className="honest">Live on NEAR testnet: <a href={`${EXPLORER}/address/${CONTRACT}`} target="_blank" rel="noreferrer">{CONTRACT}</a>. {signsHere() ? 'Buying, selling and hall rounds all sign in this browser.' : 'Buying asks your wallet; selling and hall rounds use the game key.'}</p>
        : <p className="honest">Practice purse in this browser. <button className="link" onClick={() => openSignIn()}>Play on NEAR testnet</button> to trade the real coins.</p>}
    </>
  );
}

function WarPanel({ house }: { house: number }) {
  usePlay();
  const x = HOUSES[house];
  const [msg, setMsg] = useState('');
  return (
    <>
      <div className="eyebrow">{x.seat} · the war table</div>
      <h2>Decrees of House {x.name}</h2>
      <p className="lede">Decrees burn ${x.coin}. Burned coin is gone for good, so every holder's share grows.</p>
      <div className="list">{DECREES.map((d) => (
        <button key={d.id} className="item" disabled={ledger.held[house] < d.burn} onClick={() => setMsg(decree(house, d.id) ? `${d.name}: done.` : '')}>
          <b>{d.name}</b><small>{d.note}</small><span>{d.burn.toLocaleString()} ${x.coin}</span>
        </button>
      ))}</div>
      <dl className="stats"><div><dt>People</dt><dd>{ledger.people[house]}</dd></div><div><dt>You hold</dt><dd>{fmt(ledger.held[house])} ${x.coin}</dd></div></dl>
      {msg ? <p className="slip">{msg}</p> : ledger.held[house] < 1200 && <p className="honest">You need ${x.coin} to decree. Buy some at the Warwick Mint in Emberfall.</p>}
    </>
  );
}

function GateOf({ house }: { house: number }) {
  const x = HOUSES[house];
  return (
    <>
      <div className="eyebrow">{x.seat} · {x.land}</div>
      <h2>The gate of House {x.name}</h2>
      <p className="lede">The guards will not let a lord of another house in. Talk to their lord on the green, send a raven, or muster a march at the Gershuni Gate.</p>
      <dl className="stats"><div><dt>People</dt><dd>{ledger.people[house]}</dd></div><div><dt>${x.coin}</dt><dd>{priceAt(ledger.supply[house]).toFixed(5)} NEAR</dd></div></dl>
    </>
  );
}

function LordPanel({ house }: { house: number }) {
  const x = HOUSES[house];
  const own = house === play.seat!.house;
  const [i, setI] = useState(0);
  const lines = own ? ['My lord. The war table is ready, and the Mint is open in Emberfall.', 'Our banners stand. Say the word and we march.'] : LORD_LINES[house];
  return (
    <>
      <div className="eyebrow">{x.seat} · the village green</div>
      <h2>{own ? 'Your steward' : `The lord of House ${x.name}`}</h2>
      <blockquote>{lines[i % lines.length]}</blockquote>
      <div className="actions"><button className="ghost" onClick={() => setI(i + 1)}>Ask another thing</button></div>
      <p className="honest">Set lines for now. The lords will speak for themselves through NEAR AI.</p>
    </>
  );
}

function Council() {
  const c = useChain();
  const live = onChain() && !!c.realm;
  const realm = c.realm;
  const [past, setPast] = useState<Crown | null>();
  const [busy, setBusy] = useState(false);
  const season = realm?.season ?? 1;
  // Last season's result and your share of it, read fresh each time the hall opens (and after crowning or claiming).
  const load = () => { if (live && c.account && season > 1) void crownOf(season - 1, c.account).then(setPast).catch(() => setPast(null)); };
  useEffect(load, [live, c.account, season]); // eslint-disable-line react-hooks/exhaustive-deps
  const endsMs = realm ? Number(BigInt(realm.season_ends_ns) / 1_000_000n) : 0;
  const left = endsMs - Date.now();
  const fav = (h: number) => (live ? units(realm!.houses[h].favour) : favour(h));
  const order = HOUSES.map((x) => x.id).sort((a, b) => fav(b) - fav(a));
  const top = Math.max(1e-9, fav(order[0]));
  const clock = left > 0 ? `${Math.floor(left / 3_600_000)} h ${Math.floor((left % 3_600_000) / 60_000)} min left` : 'over: the throne is waiting for a crowning';
  const act = async (f: () => Promise<unknown>) => { setBusy(true); try { await f(); } catch { /* the chain bar shows why */ } setBusy(false); load(); };
  const share = past ? units(past.share) : 0;
  return (
    <>
      <div className="eyebrow">Emberfall · the hall of the Ashen Throne{live ? ' · on NEAR testnet' : ''}</div>
      <h2>Season {season} of the Ashen Throne</h2>
      <p className="lede">When a season ends, the house with the most favour takes the throne, and the crown pool goes to the players who won it that favour, each by their own share. Favour comes from rounds played in the halls, and more from rounds won.</p>
      {live ? (
        <dl className="stats">
          <div><dt>Season</dt><dd>{clock}</dd></div>
          <div><dt>Crown pool</dt><dd>{units(realm!.pool).toFixed(4)} NEAR</dd></div>
        </dl>
      ) : null}
      {live && left <= 0 && (
        <div className="go-row"><button className="go" disabled={busy || !!c.busy} onClick={() => void act(endSeason)}>Crown the house with the most favour</button></div>
      )}
      {live && past && (
        <div className="throne-past">
          <b>Season {past.season}: {past.crowned === null ? 'nobody earned favour, so nobody was crowned.' : `House ${HOUSES[past.crowned].name} took the throne, with a pool of ${units(past.pool).toFixed(4)} NEAR.`}</b>
          {past.crowned !== null && (past.claimed
            ? <span>You took your share: {share.toFixed(4)} NEAR.</span>
            : share > 0
              ? <button className="go" disabled={busy || !!c.busy} onClick={() => void act(() => claimCrown(past.season, share))}>Take your share: {share.toFixed(4)} NEAR</button>
              : <span>You earned no favour with House {HOUSES[past.crowned].name} that season, so there is no share for you.</span>)}
        </div>
      )}
      <div className="list throne-list">{order.map((h) => {
        const x = HOUSES[h], mine = live ? units(c.me?.houses[h]?.favour) : 0;
        return (
          <div key={h} className="item flat throne-row" style={{ ['--c' as string]: x.colors[0] }}>
            <b>House {x.name}</b><small>{fmt(fav(h))} favour{mine > 0 ? ` · ${fmt(mine)} of it yours` : ''}</small>
            <i style={{ width: `${(fav(h) / top) * 100}%` }} />
          </div>
        );
      })}</div>
      {live
        ? <p className="honest">Read from <a href={`${EXPLORER}/address/${CONTRACT}`} target="_blank" rel="noreferrer">{CONTRACT}</a>. Anyone can crown the house once the season is over (<code>end_season</code>); each player takes their own share (<code>claim_crown</code>).</p>
        : <p className="honest">This is your practice favour, kept in this browser. <button className="link" onClick={() => openSignIn()}>Play on NEAR testnet</button> to see the real season and its crown pool.</p>}
    </>
  );
}

function Raven() {
  const mine = play.seat!.house;
  const [to, setTo] = useState((mine + 1) % 8);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  return (
    <>
      <div className="eyebrow">Emberfall · the rookery</div>
      <h2>Send a raven</h2>
      <div className="chips">{HOUSES.filter((x) => x.id !== mine).map((x) => <button key={x.id} className={x.id === to ? 'on' : ''} onClick={() => setTo(x.id)}>{x.name}</button>)}</div>
      <textarea value={text} maxLength={140} rows={3} placeholder={`To the lord of House ${HOUSES[to].name}…`} onChange={(e) => { setText(e.target.value); setSent(false); }} />
      <div className="actions"><button className="go" disabled={!text.trim()} onClick={() => { raven(mine, to, text.trim()); setText(''); setSent(true); }}>Send it</button></div>
      {sent && <p className="slip">The raven is away. It goes into the chronicle.</p>}
    </>
  );
}

function Library() {
  usePlay();
  return (
    <>
      <div className="eyebrow">Qureshi's Library · the Book of Ages</div>
      <h2>The chronicle</h2>
      <ol className="chron">{ledger.chronicle.slice(0, 18).map((e, i) => (
        <li key={i} style={{ ['--c' as string]: e.house !== undefined ? HOUSES[e.house].colors[0] : 'var(--gold)' }}>
          <time>{new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>{e.text}
        </li>
      ))}</ol>
    </>
  );
}

function March() {
  const mine = play.seat!.house;
  const [to, setTo] = useState((mine + 3) % 8);
  const [done, setDone] = useState(false);
  return (
    <>
      <div className="eyebrow">Emberfall · the Gershuni Gate</div>
      <h2>Muster a march</h2>
      <p className="lede">Your house's soldiers leave {HOUSES[mine].seat} and take the roads to a rival seat. You can watch them go.</p>
      <div className="chips">{HOUSES.filter((x) => x.id !== mine).map((x) => <button key={x.id} className={x.id === to ? 'on' : ''} onClick={() => { setTo(x.id); setDone(false); }}>{x.name}</button>)}</div>
      <div className="actions"><button className="go" disabled={done} onClick={() => { muster(mine, to); setDone(true); }}>March on House {HOUSES[to].name}</button></div>
      {done && <p className="slip">The column is on the road.</p>}
    </>
  );
}

function RacePanel({ onGo }: { onGo: () => void }) {
  const race = useRace().race;
  const mine = HOUSES[play.seat!.house];
  const lane = race.runners.find((r) => r.house === mine.id)?.lane ?? 0;
  const run = race.phase !== 'parade';
  return (
    <>
      <div className="eyebrow">The Mumtaz Hippodrome · the stables</div>
      <h2>{run ? 'The next race' : race.cup.name}</h2>
      {run ? <p className="lede">{race.cup.name} is running now. Take the reins and you drive House {mine.name}'s chariot in the race after it; you watch this one from the stands meanwhile. The inside lanes are shorter but crowded; a chariot in your way blocks you.</p> : <p className="lede">{race.cup.laps} {race.cup.laps === 1 ? 'lap' : 'laps'} of {Math.round(laneLen(laneR(3.5)) / M)} m. You drive House {mine.name}'s chariot from lane {lane + 1}. The inside lanes are shorter but crowded; a chariot in your way blocks you.</p>}
      <ul className="keys"><li><kbd>A</kbd><kbd>D</kbd> change lane</li><li><kbd>Space</kbd> whip (three cracks, each burns 10 ${mine.coin})</li></ul>
      <div className="actions">
        <button className="go" onClick={() => { startDrive(); onGo(); }}>{race.chain ? 'Drive in a practice heat' : run ? 'Take the reins in the next race' : 'Take the reins'}</button>
        <button className="ghost" onClick={() => { setWatch(true); onGo(); }}>{onChain() ? 'Watch and bet on NEAR' : 'Watch from the stands'}</button>
      </div>
      {onChain() && <p className="honest">The races on NEAR are run by the contract: you bet real testnet NEAR and crack whips that burn house coin, but you can’t drive them. Driving is a practice heat.</p>}
      <p className="honest">Each move is logged with its tick, so the contract can replay the race and check the result.</p>
      {live.race.backed !== undefined && <p className="slip">You have backed House {HOUSES[live.race.backed].name} in this race.</p>}
    </>
  );
}

/** Esc or P: the pause menu. Where the desktop buttons used to sit over the game. */
function Pause() {
  const h = HOUSES[play.seat!.house];
  return (
    <div className="pause" onClick={(e) => { if (e.target === e.currentTarget) pause(false); }}>
      <nav>
        <div className="pause-mark">Crownfall</div>
        <div className="pause-sub">{play.seat!.name} · House {h.name} · {h.seat}</div>
        <button onClick={() => pause(false)}>Resume</button>
        <button onClick={() => { pause(false); openMap(true); }}>Map of Vael</button>
        <button onClick={() => setMode('map')}>Leave for the realm view</button>
        <dl>
          <dt>{TOUCH ? 'Left thumb' : 'W A S D'}</dt><dd>walk · {TOUCH ? 'push to the edge' : 'Shift'} to run</dd>
          <dt>{TOUCH ? 'Use' : 'E'}</dt><dd>talk, trade, take the reins, step down</dd>
          <dt>{TOUCH ? 'Chariot' : 'C'}</dt><dd>whistle for your chariot</dd>
          <dt>{TOUCH ? 'Whip' : 'Space'}</dt><dd>crack the whip while driving</dd>
          <dt>{TOUCH ? 'Map' : 'M'}</dt><dd>the map · click it to set a waypoint</dd>
        </dl>
        <footer><NearPill /><span>{onChain() ? `Playing on NEAR testnet · ${CONTRACT}` : 'Practice purse. Sign in (top left) to play on NEAR testnet.'}</span></footer>
      </nav>
    </div>
  );
}

/** J: the whole story on one page. Who the Wardens are, what each asks, where the halls are, what to do next. */
function SealBook() {
  usePlay();
  const c = useChain();
  const seals = story.saved.seals, mine = play.seat!.house;
  const sealedOnChain = (s?: string) => !!s && !!c.me?.seals.includes(s);
  const next = nextHint();
  return (
    <>
      <div className="eyebrow">The Seal Book · House {HOUSES[mine].name}</div>
      <h2>Seven seals for the Ashen Throne</h2>
      <p className="lede">The king of Vael is dead. By the old law the throne goes to whoever earns the seals of the Seven Wardens this season. Every house strikes its own coin, and every game played in a house's hall burns some of it.</p>
      <div className="next"><b style={{ color: '#ffd23f' }}>Next · </b>{next.text.split('**').map((t, i) => (i % 2 ? <b key={i} style={{ color: '#ffd23f' }}>{t}</b> : <span key={i}>{t}</span>))}</div>
      <ul className="wardens">{WARDENS.map((g) => {
        const m = MISSIONS.find((x) => x.giver.id === g.id)!;
        const done = !!m.seal && seals.includes(m.seal), open = !done && (!m.needs || m.needs());
        return (
          <li key={g.id} className={done ? 'done' : open ? 'open' : 'locked'}>
            <span className="wax"><SealGlyph seal={m.seal!} /></span>
            <div><b>{g.name}</b><em>{g.title}</em><p>{m.brief()}</p></div>
            <span className="state">{done ? (sealedOnChain(m.seal) ? 'Sealed · on NEAR' : 'Sealed') : open ? (story.run?.id === m.id ? 'Under way' : 'Open') : m.seal === 'Throne' ? 'Needs six seals' : 'After the Mint'}</span>
          </li>
        );
      })}</ul>
      <h3>The halls · walk in at any keep's lit door</h3>
      <div className="halls">{ROOMS.map((r) => (
        <div key={r.house} className={r.house === mine ? 'mine' : ''} style={{ ['--c' as string]: HOUSES[r.house].colors[0] }}>
          <b>{r.gameName}</b>{HOUSES[r.house].seat} · House {HOUSES[r.house].name}<br />{c.me ? <>Favour {fmt(favour(r.house))} · {c.me.halls_won.includes(r.house) ? 'won' : 'not won yet'}</> : <>Favour {ledger.favour[r.house] ?? 0}</>}
        </div>
      ))}</div>
      <p className="honest">The Wardens are named for the NEAR HACKATHON judges, with roles drawn from their work. Names and roles only: the figures are our own.</p>
    </>
  );
}
