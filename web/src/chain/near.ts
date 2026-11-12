// Crownfall on NEAR testnet: the realm contract (chain/), a wallet to sign in with, and a game key.
//
// Two ways to sign in:
// - A lord account (Google, or just a name): /api/lord makes a real NEAR testnet account, `<name>.vael.testnet`, whose
//   key lives in this browser. Every call, payable or not, is signed here: no wallet, no popups.
// - A NEAR wallet. Then payable calls (buying coin, staking in the Library, betting on a race) go through the wallet,
//   which asks. Everything else (entering a hall round, finishing it, taking a seal, whipping, settling a race) is
//   signed here with a game key: a function-call key the wallet adds once, limited to this contract and to those
//   methods, with a 0.5 NEAR gas allowance. It can't move the player's NEAR anywhere except back to them (`sell`).
import type { NearConnector } from '@hot-labs/near-connect';
import type { KeyPairString } from 'near-api-js';
// The wallet libraries are big; they load on first use (a connect, a restore, a signed call), not with the realm.
const nearApi = () => import('near-api-js');
import { useSyncExternalStore } from 'react';

export const CONTRACT = (import.meta.env.VITE_CONTRACT as string | undefined) ?? 'crownfall-vael.testnet';
export const NETWORK = 'testnet' as const;
const RPCS = ['https://rpc.testnet.fastnear.com', 'https://rpc.testnet.near.org'];
export const EXPLORER = 'https://testnet.nearblocks.io';
const KEY_METHODS = ['enter', 'finish', 'seal', 'whip', 'call_race', 'start_race', 'settle', 'claim_race', 'claim_crown', 'end_season', 'sell'];
const GAS = '30000000000000';
const ONE = 10n ** 24n;

export interface ChainHouse { id: number; name: string; coin: string; reserve: string; supply: string; burned: string; rounds: number; entry: string; favour: string; market?: import('./market.ts').Market }
export interface ChainRealm { season: number; season_ends_ns: string; pool: string; races: number; houses: ChainHouse[] }
export interface ChainMe { seals: string[]; halls_won: number[]; plays: number; wins: number; bought: boolean; raced?: boolean; houses: { coins: string; favour: string }[] }
export interface ChainRace { n: number; seed: number; laps: number; called_ns: string; off_ns: string; started?: boolean; started_ns?: string; claimed?: string; pools: string[]; whips: [number, number][]; settled: boolean; order: number[]; finish_ms: number[]; payout: string }

export type Via = 'wallet' | 'google' | 'name' | 'dev';
export const chain = {
  account: undefined as string | undefined,
  /** How this player signed in: a NEAR wallet, or a lord account whose key is in this browser. */
  via: undefined as Via | undefined,
  /** The sign-in dialog is open, and the name to suggest in it. */
  signingIn: false,
  signInHint: '',
  /** The game key is on the account and stored here. */
  keyed: false,
  realm: undefined as ChainRealm | undefined,
  me: undefined as ChainMe | undefined,
  /** The account's own NEAR, available to spend. */
  balance: 0,
  /** What is being signed or sent right now, for the HUD. */
  busy: '',
  error: '',
  /** The last transaction, for a link to the explorer. */
  lastTx: undefined as { what: string; hash?: string; t: number } | undefined,
  version: 0,
};
const subs = new Set<() => void>();
export function emitChain() { chain.version++; subs.forEach((f) => f()); }
export function useChain() {
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => chain.version);
  return chain;
}
/** On chain: signed in. Otherwise the game runs on the practice purse. */
export const onChain = () => !!chain.account;
/** Open the sign-in dialog (Google, a name, or a wallet). */
export function openSignIn(hint = '') { chain.error = ''; chain.signingIn = true; chain.signInHint = hint; emitChain(); }
export function closeSignIn() { chain.signingIn = false; emitChain(); }

// ---------- Reading ----------

async function rpc<T>(method: string, params: unknown): Promise<T> {
  let last: unknown;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'cf', method, params }) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.data ?? j.error.message ?? 'rpc error');
      return j.result as T;
    } catch (e) { last = e; }
  }
  throw last;
}
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
export async function view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await rpc<{ result: number[] }>('query', { request_type: 'call_function', finality: 'optimistic', account_id: CONTRACT, method_name: method, args_base64: b64(JSON.stringify(args)) });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result))) as T;
}

/** yocto (24 decimals) → a JS number, for display and the curve maths. */
export const units = (s: string | bigint | undefined) => (s === undefined ? 0 : Number(BigInt(s) / 10n ** 18n) / 1e6);
export const yocto = (n: number) => (BigInt(Math.round(n * 1e6)) * ONE) / 1_000_000n;
export const priceOf = (h: ChainHouse) => units(h.reserve) / units(h.supply);

let refreshing: Promise<void> | undefined;
export function refresh() {
  refreshing ??= (async () => {
    try {
      const a = chain.account;
      const [realm, me, acct] = await Promise.all([
        view<ChainRealm>('get_realm'),
        a ? view<ChainMe>('get_account', { account: a }) : Promise.resolve(undefined),
        a ? rpc<{ amount: string; locked: string }>('query', { request_type: 'view_account', finality: 'optimistic', account_id: a }) : Promise.resolve(undefined),
      ]);
      chain.realm = realm; chain.me = me;
      if (acct) chain.balance = units(acct.amount);
    } catch (e) { console.warn('[chain] refresh', e); }
    refreshing = undefined;
    emitChain();
  })();
  return refreshing;
}

// ---------- The wallet ----------

let connector: NearConnector | undefined;
async function getConnector() {
  if (connector) return connector;
  const { NearConnector } = await import('@hot-labs/near-connect');
  if (connector) return connector;
  connector = new NearConnector({ network: NETWORK, features: { signAndSendTransaction: true, testnet: true }, providers: { testnet: RPCS } });
  connector.on('wallet:signIn', (t) => { void signedIn(t.accounts[0]?.accountId); });
  connector.on('wallet:signOut', () => { if (chain.via !== 'wallet') return; chain.account = undefined; chain.via = undefined; chain.keyed = false; chain.me = undefined; emitChain(); });
  return connector;
}
async function signedIn(account: string | undefined) {
  if (!account || account === chain.account) return;
  forgetLord();
  chain.account = account; chain.via = 'wallet'; chain.signingIn = false;
  chain.keyed = !!storedKey(account);
  emitChain();
  await refresh();
}
/** Pick a wallet and sign in. */
export async function connect() {
  chain.error = '';
  try { await (await getConnector()).connect(); } catch (e) { chain.error = message(e); emitChain(); }
}
export async function disconnect() {
  if (chain.via === 'wallet') { try { await (await getConnector()).disconnect(); } catch { /* already out */ } }
  forgetLord(); lordKey = undefined;
  chain.account = undefined; chain.via = undefined; chain.keyed = false; chain.me = undefined; emitChain();
}
/** Whoever signed in on an earlier visit (a lord account or a wallet) comes back on its own. */
export async function restore() {
  void refresh();
  const l = activeLord();
  if (l && storedKey(l.account)) { await signInLord(l.account, storedKey(l.account)!, l.via); return; }
  try {
    const { accounts } = await (await getConnector()).getConnectedWallet();
    await signedIn(accounts[0]?.accountId);
  } catch { /* nobody signed in */ }
}

function message(e: unknown) {
  const s = e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e);
  const m = /panicked: (.*?)(?:"|\\"|$)/.exec(s) ?? /Smart contract panicked: ([^"]*)/.exec(s);
  return (m ? m[1] : s).slice(0, 160);
}
function parseOutcome(o: unknown): unknown {
  const status = (o as { status?: { SuccessValue?: string; Failure?: unknown } })?.status;
  if (status?.Failure) throw new Error(JSON.stringify(status.Failure));
  const v = status?.SuccessValue;
  if (!v) return undefined;
  try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(v), (c) => c.charCodeAt(0)))); } catch { return undefined; }
}

// ---------- Lord accounts: the key is in this browser ----------

const LORD = `crownfall.lord.${NETWORK}`, LORDS = `crownfall.lords.${NETWORK}`;
export interface Lord { account: string; via: Via }
function activeLord(): Lord | undefined { try { return JSON.parse(localStorage.getItem(LORD) ?? 'null') ?? undefined; } catch { return undefined; } }
function forgetLord() { try { localStorage.removeItem(LORD); } catch { /* private window */ } }
/** Lord accounts made in this browser whose keys are still here, to come back to after signing out. */
export function knownLords(): Lord[] {
  try { return (JSON.parse(localStorage.getItem(LORDS) ?? '[]') as Lord[]).filter((l) => storedKey(l.account)); } catch { return []; }
}
/** Sign in as a lord account whose full-access key we hold: every call is signed here, with no wallet. */
export async function signInLord(account: string, key: KeyPairString, via: Via) {
  if (chain.via === 'wallet') { try { await (await getConnector()).disconnect(); } catch { /* fine */ } }
  try {
    localStorage.setItem(keyName(account), key);
    localStorage.setItem(LORD, JSON.stringify({ account, via }));
    if (via !== 'dev') localStorage.setItem(LORDS, JSON.stringify([{ account, via }, ...knownLords().filter((l) => l.account !== account)].slice(0, 6)));
  } catch { /* private window: works until the tab closes */ }
  lordKey = key;
  chain.account = account; chain.via = via; chain.keyed = true; chain.signingIn = false; chain.error = '';
  emitChain();
  await refresh();
}
/** Back in as a lord account made earlier in this browser. */
export const continueAs = (l: Lord) => signInLord(l.account, storedKey(l.account)!, l.via);
let lordKey: KeyPairString | undefined;
const localKey = () => (chain.via && chain.via !== 'wallet' ? lordKey ?? (chain.account ? storedKey(chain.account) ?? undefined : undefined) : undefined);
/** True when every call signs here, with no wallet popup. */
export const signsHere = () => !!localKey();

/** A payable call, through the wallet. `near` is attached. */
export async function walletCall<T>(what: string, method: string, args: Record<string, unknown>, near: number): Promise<T> {
  if (!chain.account) throw new Error('connect a wallet first');
  chain.busy = what; chain.error = ''; emitChain();
  try {
    const lk = localKey();
    if (lk) {
      const { Account } = await nearApi();
      const v = await new Account(chain.account, RPCS[0], lk).callFunction<T & object>({ contractId: CONTRACT, methodName: method, args, gas: BigInt(GAS), deposit: yocto(near) });
      chain.lastTx = { what, t: Date.now() };
      void refresh();
      return v as T;
    }
    const wallet = await (await getConnector()).wallet();
    const out = await wallet.signAndSendTransaction({
      receiverId: CONTRACT,
      actions: [{ type: 'FunctionCall', params: { methodName: method, args, gas: GAS, deposit: yocto(near).toString() } }],
    });
    chain.lastTx = { what, hash: (out as { transaction?: { hash?: string } })?.transaction?.hash, t: Date.now() };
    const v = parseOutcome(out) as T;
    void refresh();
    return v;
  } catch (e) { chain.error = message(e); throw new Error(chain.error); } finally { chain.busy = ''; emitChain(); }
}

// ---------- The game key ----------

const keyName = (a: string) => `crownfall.key.${NETWORK}.${a}`;
function storedKey(a: string) { try { return localStorage.getItem(keyName(a)) as KeyPairString | null; } catch { return null; } }

/** Make sure the game key is on the account: one wallet approval, the first time. */
export async function ensureKey() {
  const a = chain.account;
  if (!a) throw new Error('connect a wallet first');
  if (localKey()) { chain.keyed = true; return; }
  const have = storedKey(a);
  if (have) {
    const { KeyPair } = await nearApi();
    const kp = KeyPair.fromString(have);
    try {
      await rpc('query', { request_type: 'view_access_key', finality: 'optimistic', account_id: a, public_key: kp.getPublicKey().toString() });
      chain.keyed = true; emitChain();
      return;
    } catch { /* the key was removed: make a new one */ }
  }
  const { KeyPair } = await nearApi();
  const kp = KeyPair.fromRandom('ed25519');
  chain.busy = 'Approve the game key in your wallet (once)'; emitChain();
  try {
    const wallet = await (await getConnector()).wallet();
    await wallet.signAndSendTransaction({
      receiverId: a,
      actions: [{ type: 'AddKey', params: { publicKey: kp.getPublicKey().toString(), accessKey: { permission: { receiverId: CONTRACT, allowance: yocto(0.5).toString(), methodNames: KEY_METHODS } } } }],
    });
    localStorage.setItem(keyName(a), kp.toString());
    chain.keyed = true;
  } catch (e) { chain.error = message(e); throw new Error(chain.error); } finally { chain.busy = ''; emitChain(); }
}

/** A non-payable call, signed with the game key: no wallet popup. */
export async function keyCall<T>(what: string, method: string, args: Record<string, unknown>, quiet = false): Promise<T> {
  if (!chain.keyed) await ensureKey();
  const a = chain.account!, sk = (localKey() ?? storedKey(a))!;
  if (!quiet) { chain.busy = what; chain.error = ''; emitChain(); }
  try {
    const { Account } = await nearApi();
    const acct = new Account(a, RPCS[0], sk);
    const v = await acct.callFunction<T & object>({ contractId: CONTRACT, methodName: method, args, gas: BigInt(GAS) });
    chain.lastTx = { what, t: Date.now() };
    void refresh();
    return v as T;
  } catch (e) { chain.error = message(e); throw new Error(chain.error); } finally { if (!quiet) chain.busy = ''; emitChain(); }
}

if (import.meta.env.DEV) {
  const devLogin = (account: string, sk: KeyPairString) => signInLord(account, sk, 'dev');
  Object.assign(window, { __chain: { chain, view, refresh, connect, keyCall, walletCall, devLogin } });
}
