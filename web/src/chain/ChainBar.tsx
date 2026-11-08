// Top left in play: play on NEAR testnet (connect), who you are, and what is being signed right now.
import { useEffect, useState } from 'react';
import { NearMark } from '../NearMark.tsx';
import { CONTRACT, EXPLORER, chain, connect, disconnect, onChain, refresh, restore, useChain } from './near.ts';
import { startRacePolling } from './races.ts';
import { wallet } from '../realm/play.ts';

let started = false;
/** Bring back a wallet signed in on an earlier visit, and start following the races. Safe to call more than once. */
export function startChain() {
  if (started) return;
  started = true;
  wallet.connected = onChain;
  void restore();
  startRacePolling();
}
export function ChainBar() {
  const c = useChain();
  const [, tick] = useState(0);
  useEffect(() => {
    startChain();
    const i = setInterval(() => { if (chain.account) void refresh(); tick((n) => n + 1); }, 12000);
    return () => clearInterval(i);
  }, []);
  const fresh = c.lastTx && Date.now() - c.lastTx.t < 7000;
  useEffect(() => { if (!fresh) return; const t = setTimeout(() => tick((n) => n + 1), 7200); return () => clearTimeout(t); }, [fresh]);
  return (
    <div className="chainbar">
      {c.account ? (
        <div className="who" title={`Signed in on NEAR testnet. Realm contract: ${CONTRACT}`}>
          <NearMark size={13} /><b>{c.account.length > 22 ? `${c.account.slice(0, 10)}…${c.account.slice(-9)}` : c.account}</b><span>testnet</span>
          <button onClick={() => void disconnect()} aria-label="Sign out">×</button>
        </div>
      ) : (
        <button className="connect practice" onClick={() => void connect()}><span className="tag">Practice</span><NearMark size={13} />Connect wallet to play on NEAR</button>
      )}
      {c.busy && <div className="busy"><i />{c.busy}…</div>}
      {!c.busy && c.error && <div className="err">{c.error}</div>}
      {!c.busy && !c.error && fresh && c.lastTx && (
        c.lastTx.hash
          ? <a className="done" href={`${EXPLORER}/txns/${c.lastTx.hash}`} target="_blank" rel="noreferrer">✓ {c.lastTx.what} · on NEAR</a>
          : <a className="done" href={`${EXPLORER}/address/${CONTRACT}`} target="_blank" rel="noreferrer">✓ {c.lastTx.what} · on NEAR</a>
      )}
    </div>
  );
}
