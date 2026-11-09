// Sign in without a wallet: a Vercel function that gives a player a real NEAR testnet account.
//
//   GET  /api/lord                                   -> { google: <client id or null>, open: <can make new lords> }
//   POST /api/lord { via: 'google', credential }     -> { account, key, via, made }
//   POST /api/lord { via: 'name', name, publicKey, nonce } -> { account, via, made }
//
// Google: the ID token is checked with Google, then the player's key is derived from the Google account
// (HMAC of LORD_SECRET and the Google user id), so the same Google login finds the same NEAR account on any device.
// That makes this service a custodian of those keys, the way a hosted wallet is; it is testnet play money, and the
// README says so. The account is `<first name>-<4 chars>.vael.testnet`, made and funded by the parent account.
//
// Name: the browser makes its own key and sends only the public half, so the key never leaves the browser. The
// request carries a small proof of work so the parent's purse can't be drained by a script in a loop.
//
// Env: VAEL_ACCOUNT (parent, e.g. vael.testnet), VAEL_KEY (its full-access key), LORD_SECRET, GOOGLE_CLIENT_ID.
import { createHash, createHmac, createPrivateKey, createPublicKey } from 'node:crypto';

const RPCS = ['https://rpc.testnet.fastnear.com', 'https://test.rpc.fastnear.com'];
const FUND_GOOGLE = 500_000_000_000_000_000_000_000n; // 0.5 NEAR: enough to buy coin, bet and sit at the Library
const FUND_NAME = 400_000_000_000_000_000_000_000n; // 0.4 NEAR
const FLOOR = 500_000_000_000_000_000_000_000n; // keep 0.5 NEAR in the parent for gas
const POW = '0000'; // 16 bits: about a second in a browser

type Env = Record<string, string | undefined>;
export interface Reply { status: number; body: Record<string, unknown> }
const fail = (status: number, error: string): Reply => ({ status, body: { error } });

async function rpc<T>(method: string, params: unknown): Promise<T> {
  let last: unknown;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'lord', method, params }) });
      const j = await r.json() as { result?: T; error?: { cause?: { name?: string }; data?: string; message?: string } };
      if (j.error) { const e = new Error(j.error.data ?? j.error.message ?? 'rpc error') as Error & { cause?: string }; e.cause = j.error.cause?.name; throw e; }
      return j.result as T;
    } catch (e) { last = e; if ((e as { cause?: string }).cause) throw e; }
  }
  throw last;
}
async function balance(account: string): Promise<bigint | undefined> {
  try { return BigInt((await rpc<{ amount: string }>('query', { request_type: 'view_account', finality: 'final', account_id: account })).amount); }
  catch (e) { if ((e as { cause?: string }).cause === 'UNKNOWN_ACCOUNT') return undefined; throw e; }
}
async function hasKey(account: string, publicKey: string) {
  try { await rpc('query', { request_type: 'view_access_key', finality: 'final', account_id: account, public_key: publicKey }); return true; } catch { return false; }
}

// ---------- keys ----------

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes: Uint8Array) {
  let n = BigInt('0x' + (Buffer.from(bytes).toString('hex') || '0')), s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b) break; s = '1' + s; }
  return s;
}
/** An ed25519 key pair from a 32-byte seed, in NEAR's string forms. */
export function keyFromSeed(seed: Buffer) {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
  const pub = Buffer.from(createPublicKey(createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })).export({ format: 'jwk' }).x as string, 'base64url');
  return { secret: `ed25519:${base58(Buffer.concat([seed, pub]))}`, publicKey: `ed25519:${base58(pub)}` };
}

// ---------- the parent account signs account creations ----------

async function makeAccount(env: Env, account: string, publicKey: string, amount: bigint) {
  const { Account } = await import('near-api-js');
  const parent = new Account(env.VAEL_ACCOUNT!, RPCS[0], env.VAEL_KEY as `ed25519:${string}`);
  await parent.createAccount({ newAccountId: account, publicKey, nearToTransfer: amount });
}
async function purseOpen(env: Env) {
  if (!env.VAEL_ACCOUNT || !env.VAEL_KEY) return false;
  const b = await balance(env.VAEL_ACCOUNT).catch(() => undefined);
  return b !== undefined && b > FLOOR + FUND_GOOGLE;
}

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20).replace(/-+$/, '');

// ---------- Google ----------

async function google(env: Env, credential: unknown): Promise<Reply> {
  if (!env.GOOGLE_CLIENT_ID || !env.LORD_SECRET) return fail(503, 'Google sign-in is not set up on this server');
  if (typeof credential !== 'string' || credential.length > 4096) return fail(400, 'no Google credential');
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  const t = await r.json() as { aud?: string; sub?: string; email_verified?: string | boolean; given_name?: string; name?: string; exp?: string; iss?: string; error?: string };
  if (!r.ok || t.error) return fail(401, 'Google did not accept that sign-in');
  if (t.aud !== env.GOOGLE_CLIENT_ID || !t.sub || !/accounts\.google\.com$/.test(t.iss ?? '')) return fail(401, 'that sign-in was not for Crownfall');
  if (Number(t.exp ?? 0) * 1000 < Date.now()) return fail(401, 'that sign-in has expired, try again');
  const seed = createHmac('sha256', env.LORD_SECRET).update(`google:${t.sub}`).digest();
  const key = keyFromSeed(seed);
  const tag = createHmac('sha256', env.LORD_SECRET).update(`tag:${t.sub}`).digest('hex');
  const base = slug(t.given_name ?? t.name ?? '') || 'lord';
  // The same Google account always lands on the same name; on the rare clash with someone else's, take a longer tag.
  for (const n of [4, 8]) {
    const account = `${base}-${tag.slice(0, n)}.${env.VAEL_ACCOUNT}`;
    const have = await balance(account);
    if (have !== undefined) {
      if (await hasKey(account, key.publicKey)) return { status: 200, body: { account, key: key.secret, via: 'google', made: false } };
      continue;
    }
    if (!(await purseOpen(env))) return fail(503, "the realm's purse for new lords is empty, try a wallet");
    await makeAccount(env, account, key.publicKey, FUND_GOOGLE);
    return { status: 200, body: { account, key: key.secret, via: 'google', made: true } };
  }
  return fail(409, 'could not find a free name for this lord');
}

// ---------- a name, with the browser's own key ----------

export function powOk(account: string, publicKey: string, nonce: string) {
  return createHash('sha256').update(`vael|${account}|${publicKey}|${nonce}`).digest('hex').startsWith(POW);
}
async function byName(env: Env, b: { name?: unknown; publicKey?: unknown; nonce?: unknown }): Promise<Reply> {
  if (!env.VAEL_ACCOUNT || !env.VAEL_KEY) return fail(503, 'new lords are closed on this server');
  const name = typeof b.name === 'string' ? slug(b.name) : '';
  if (name.length < 2) return fail(400, 'pick a name of at least two letters');
  const pk = typeof b.publicKey === 'string' ? b.publicKey : '';
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{40,50}$/.test(pk)) return fail(400, 'bad public key');
  const account = `${name}.${env.VAEL_ACCOUNT}`;
  if (typeof b.nonce !== 'string' || b.nonce.length > 20 || !powOk(account, pk, b.nonce)) return fail(400, 'bad proof of work');
  if ((await balance(account)) !== undefined) return fail(409, `${account} is taken`);
  if (!(await purseOpen(env))) return fail(503, "the realm's purse for new lords is empty, try a wallet");
  await makeAccount(env, account, pk, FUND_NAME);
  return { status: 200, body: { account, via: 'name', made: true } };
}

export async function lord(method: string, body: unknown, env: Env): Promise<Reply> {
  try {
    if (method === 'GET') return { status: 200, body: { google: env.GOOGLE_CLIENT_ID ?? null, open: await purseOpen(env), parent: env.VAEL_ACCOUNT ?? null, pow: POW.length } };
    if (method !== 'POST') return fail(405, 'GET or POST');
    const b = (typeof body === 'string' ? JSON.parse(body || '{}') : body ?? {}) as Record<string, unknown>;
    if (b.via === 'google') return await google(env, b.credential);
    if (b.via === 'name') return await byName(env, b);
    return fail(400, 'via must be google or name');
  } catch (e) {
    console.error('[lord]', e);
    return fail(502, (e instanceof Error ? e.message : String(e)).slice(0, 160));
  }
}

// Vercel's Node handler.
export default async function handler(req: { method?: string; body?: unknown }, res: { status(n: number): { json(b: unknown): void }; setHeader(k: string, v: string): void }) {
  const r = await lord(req.method ?? 'GET', req.body, process.env);
  res.setHeader('cache-control', 'no-store');
  res.status(r.status).json(r.body);
}
