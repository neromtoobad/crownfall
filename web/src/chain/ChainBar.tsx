// Top left in play: play on NEAR testnet (connect), who you are, and what is being signed right now.
import { useEffect, useState } from 'react';
import { NearMark } from '../NearMark.tsx';
import { CONTRACT, EXPLORER, chain, connect, disconnect, refresh, restore, useChain } from './near.ts';
import { startRacePolling } from './races.ts';

let started = false;
export function ChainBar() {
  const c = useChain();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!started) { started = true; void restore(); startRacePolling(); }
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
        <button className="connect" onClick={() => void connect()}><NearMark size={13} />Play on NEAR testnet</button>
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
