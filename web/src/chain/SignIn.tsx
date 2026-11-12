// Sign in to play on NEAR: Google, just a name, or a NEAR wallet. The first two make a real testnet account under
// vael.testnet (see api/lord.ts) and keep its key in this browser, so nothing in the game ever asks a wallet.
import { useEffect, useRef, useState } from 'react';
import type { KeyPairString } from 'near-api-js';
import { NearMark } from '../NearMark.tsx';
import { closeSignIn, connect, continueAs, knownLords, signInLord, useChain } from './near.ts';

interface Cfg { google: string | null; open: boolean; parent: string | null; pow: number }
let cfgP: Promise<Cfg> | undefined;
const config = () => (cfgP ??= fetch('/api/lord').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`login service ${r.status}`)))).catch((e) => { cfgP = undefined; throw e; }));

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20).replace(/-+$/, '');

async function post(body: Record<string, unknown>) {
  const r = await fetch('/api/lord', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: `login service ${r.status}` }));
  if (!r.ok) throw new Error(j.error ?? `login service ${r.status}`);
  return j as { account: string; key?: KeyPairString; made: boolean };
}

/** A small proof of work: about a second here, and it keeps a script from emptying the purse for new lords. */
async function work(account: string, publicKey: string, zeros: number) {
  const want = '0'.repeat(zeros), enc = new TextEncoder();
  for (let n = 0; ; n += 256) {
    const batch = await Promise.all(Array.from({ length: 256 }, (_, i) => crypto.subtle.digest('SHA-256', enc.encode(`vael|${account}|${publicKey}|${n + i}`))));
    const i = batch.findIndex((d) => [...new Uint8Array(d).slice(0, Math.ceil(zeros / 2))].map((b) => b.toString(16).padStart(2, '0')).join('').startsWith(want));
    if (i >= 0) return String(n + i);
  }
}

declare global { interface Window { google?: { accounts: { id: { initialize(o: object): void; renderButton(el: HTMLElement, o: object): void } } } } }
let gsi: Promise<void> | undefined;
const loadGsi = () => (gsi ??= new Promise<void>((ok, no) => {
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
  s.onload = () => ok(); s.onerror = () => { gsi = undefined; no(new Error('could not load Google sign-in')); };
  document.head.appendChild(s);
}));

/** Make a lord from a name, with a key made in this browser: the name flow below, and the judge seat (JudgeCard.tsx). */
export async function lordByName(name: string, onBusy: (s: string) => void = () => {}) {
  const cfg = await config();
  if (!cfg.parent) throw new Error('the sign-in service has no parent account');
  if (cfg.open === false) throw new Error('the purse for new lords is empty right now');
  const account = `${slug(name)}.${cfg.parent}`;
  const { KeyPair } = await import('near-api-js');
  const kp = KeyPair.fromRandom('ed25519');
  const pk = kp.getPublicKey().toString();
  onBusy('Sealing your name…');
  const nonce = await work(account, pk, cfg.pow);
  onBusy('Making your lord on NEAR…');
  const out = await post({ via: 'name', name: slug(name), publicKey: pk, nonce });
  await signInLord(out.account, kp.toString() as KeyPairString, 'name');
  return out.account;
}

export function SignIn({ suggest = '' }: { suggest?: string }) {
  const c = useChain();
  const [cfg, setCfg] = useState<Cfg>();
  const [name, setName] = useState(() => (/^a nameless lord$/i.test(suggest.trim()) ? '' : slug(suggest.replace(/^(ser|lady|lord|dame)\s+/i, '').split(/\s+of\s+/i)[0] ?? '')));
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const gRef = useRef<HTMLDivElement>(null);
  const lords = knownLords();

  useEffect(() => { config().then(setCfg, (e: Error) => setErr(e.message)); }, []);
  // Google's own button: it opens Google's account chooser and hands back a signed ID token.
  useEffect(() => {
    if (!cfg?.google || !gRef.current) return;
    const el = gRef.current;
    loadGsi().then(() => {
      window.google!.accounts.id.initialize({
        client_id: cfg.google, ux_mode: 'popup', auto_select: false, itp_support: true,
        callback: async (r: { credential: string }) => {
          setErr(''); setBusy('Making your lord on NEAR…');
          try {
            const out = await post({ via: 'google', credential: r.credential });
            await signInLord(out.account, out.key!, 'google');
          } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
        },
      });
      window.google!.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: 300 });
    }, (e: Error) => setErr(e.message));
  }, [cfg?.google]);

  const account = cfg?.parent && slug(name).length >= 2 ? `${slug(name)}.${cfg.parent}` : '';
  const byName = async () => {
    if (!account || !cfg) return;
    setErr('');
    try {
      await lordByName(name, setBusy);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const wallet = () => { closeSignIn(); void connect(); };

  return (
    <div className="scrim signin-scrim" onClick={closeSignIn}>
      <div className="panel signin" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Sign in to play on NEAR">
        <button className="x" onClick={closeSignIn} aria-label="Close">×</button>
        <div className="eyebrow">Play on NEAR testnet</div>
        <h2>Sign in to the realm</h2>
        <p className="lede">Sign in and Crownfall makes you a real NEAR account with a little testnet NEAR in it. Coins, hall rounds, seals and bets all sign right here, with no wallet and no popups.</p>

        {lords.length > 0 && (
          <div className="again">{lords.map((l) => (
            <button key={l.account} onClick={() => void continueAs(l)}>
              <NearMark size={13} />Continue as <b>{l.account}</b>
            </button>
          ))}</div>
        )}

        {cfg?.google ? <div className="gbtn" ref={gRef} /> : cfg && <p className="note">Google sign-in isn't switched on here yet. Use a name below.</p>}

        <div className="or"><span>or just pick a name</span></div>
        <form className="byname" onSubmit={(e) => { e.preventDefault(); void byName(); }}>
          <input value={name} maxLength={20} placeholder="ada" onChange={(e) => setName(e.target.value)} aria-label="Your account name" autoComplete="off" spellCheck={false} />
          <button type="submit" className="go" disabled={!account || !!busy || cfg?.open === false}>Make my lord</button>
        </form>
        <p className="acct">{account ? <>Your account: <b>{account}</b>. Its key stays in this browser.</> : 'Letters and numbers, two or more.'}</p>

        {busy && <p className="busy"><i />{busy}</p>}
        {!busy && (err || c.error) && <p className="err">{err || c.error}</p>}
        {cfg?.open === false && <p className="err">The purse for new lords is empty right now. A NEAR wallet still works.</p>}

        <div className="or"><span>have a wallet?</span></div>
        <button className="wallet" onClick={wallet}><NearMark size={14} />Connect a NEAR wallet</button>
      </div>
    </div>
  );
}
