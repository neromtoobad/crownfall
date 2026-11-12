// The judge's seat: open the realm with ?judge and it makes a funded testnet account by itself (the same name flow as
// the sign-in dialog), then keeps a short checklist on screen. Each line is a claim from the README, the button that
// tests it, and what should happen; it ticks itself from the contract's own view of your account, and every line
// links to the account on the explorer, where each transaction it made is listed.
import { useEffect, useState } from 'react';
import { openPanel, play, usePlay } from './realm/play.ts';
import { HOUSES } from './realm/layout.ts';
import { STABLES } from './realm/places.ts';
import { doorOf } from './realm/rooms.ts';
import { MISSIONS } from './realm/missions.ts';
import { waypoint } from './Radar.tsx';
import { buyCoin, burned } from './chain/game.ts';
import { CONTRACT, EXPLORER, chain, units, useChain } from './chain/near.ts';
import { lordByName } from './chain/SignIn.tsx';

export const JUDGE = typeof window !== 'undefined' && new URLSearchParams(location.search).has('judge');

let started = false;
async function seatJudge(set: (s: string) => void) {
  if (started || chain.account) return;
  started = true;
  const tag = Math.random().toString(36).slice(2, 6);
  try {
    await lordByName(`judge-${tag}`, set);
    set('');
  } catch (e) { started = false; set(`Could not make the judge account: ${(e as Error).message}`); }
}

const route = (at: [number, number]) => { waypoint.at = at; openPanel(); };

export function JudgeCard() {
  const p = usePlay();
  const c = useChain();
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(true);
  const [burnAt, setBurnAt] = useState<number>();
  useEffect(() => { void seatJudge(setBusy); }, []);

  const house = p.seat?.house ?? 0, h = HOUSES[house];
  const me = c.me, acct = c.account;
  const coins = units(me?.houses[house]?.coins);
  // The hall line ticks when your plays go up AND the house's burned total rose while you watched.
  useEffect(() => { if (burnAt === undefined && c.realm) setBurnAt(burned(house)); }, [c.realm, house, burnAt]);
  const gate = MISSIONS.find((m) => m.seal === 'Gate')!.giver.at;

  const lines: { claim: string; how: string; expect: string; done: boolean; act?: [string, () => void] }[] = [
    {
      claim: 'Every house is a coin you can buy',
      how: `Buys 0.05 NEAR of House ${h.name} at the Mint`,
      expect: `${h.coin} lands in your purse; the house's NEAR reserve rises; 2% goes to the crown pool`,
      done: coins > 0,
      act: ['Buy now', () => { void buyCoin(house, 0.05).catch(() => {}); }],
    },
    {
      claim: 'Playing a hall game burns that house’s coin',
      how: `With some of its coin, walk into your hall at ${h.seat} and play one round`,
      expect: 'the entry is burned on chain: the house’s burned total goes up and its price per coin with it',
      done: (me?.plays ?? 0) > 0 && burnAt !== undefined && burned(house) > burnAt,
      act: ['Route to the hall', () => route([doorOf(h).x, doorOf(h).z])],
    },
    {
      claim: 'Races are run and settled by the contract',
      how: 'At the Hippodrome, bet on a house (or drive)',
      expect: 'your NEAR goes into the pool; after the race the contract runs the same race you watched and pays the winners',
      done: !!me?.raced,
      act: ['Route to the Hippodrome', () => route([STABLES[0], STABLES[1]])],
    },
    {
      claim: 'Seals are kept on chain',
      how: 'Meet Stepan Gershuni at the Gate and drive the reins course',
      expect: 'the Gate seal is written to your account (a 0.01 NEAR toll goes to the crown pool)',
      done: (me?.seals?.length ?? 0) > 0,
      act: ['Route to the Gate', () => route(gate)],
    },
  ];
  const n = lines.filter((l) => l.done).length;
  if (p.mode !== 'play' || p.game || p.racing) return null;

  return (
    <aside className={`judge${open ? '' : ' shut'}`} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <button className="judge-head" onClick={() => setOpen(!open)}>
        <b>Judge’s checklist</b><span>{n}/{lines.length}</span><i>{open ? '–' : '+'}</i>
      </button>
      {open && (
        <>
          <p className="judge-acct">
            {acct
              ? <>Signed in as <a href={`${EXPLORER}/address/${acct}`} target="_blank" rel="noreferrer">{acct}</a>, made just now with testnet NEAR in it. Every transaction is listed there.</>
              : busy || 'Making your judge account on NEAR…'}
          </p>
          <ol>{lines.map((l) => (
            <li key={l.claim} className={l.done ? 'done' : ''}>
              <b>{l.done ? '✓ ' : ''}{l.claim}</b>
              <span>{l.how}. <em>Expect:</em> {l.expect}.</span>
              {l.act && acct && !l.done && <button onClick={l.act[1]} disabled={!!c.busy}>{l.act[0]}</button>}
            </li>
          ))}</ol>
          <p className="judge-foot">Contract <a href={`${EXPLORER}/address/${CONTRACT}`} target="_blank" rel="noreferrer">{CONTRACT}</a> · a route button draws a purple line on the radar</p>
        </>
      )}
    </aside>
  );
}
