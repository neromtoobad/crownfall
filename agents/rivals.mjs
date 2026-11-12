// The rivals of Vael: four agent players with their own NEAR testnet wallets, sworn to four houses. They play the same
// contract you do, through the same calls, and nothing in the contract knows they are agents:
//
//   - At the Mumtaz Hippodrome each rival decides, while betting is open, whether to back a team and with how much
//     NEAR. The decision is asked of a model on NEAR AI Cloud (given the cup, the laps, the pools so far, its own
//     house, its purse and how its last races went) and held to bounds it can't argue past. Without a model key it
//     falls back to its own fixed rule, and says so.
//   - Once the race has started (its seed drawn on chain), a rival that backed a team replays the race from the seed
//     with `preview_race`, with and without one more whip, and cracks its whip only where it gains a place.
//   - They keep the races going: one of them calls the next race, starts it at the off and settles it, so the track
//     runs on chain when no human is watching. Winners collect.
//   - They trade at the Warwick Mint. About every quarter hour each rival reads the eight merchants (fair value,
//     the buy and sell factors, how full each purse is against its peak, whether it's shut) and its own coin, and its
//     model decides to buy, sell or hold, in character. It is held to small trades, keeps the coin it needs for whips
//     and tributes, and never sells a house's purse down toward a run: no rival can shut a hall by itself.
//   - Now and then each pays tribute: one round's entry burned in its house's hall, favour for the house in the
//     race for the Ashen Throne. They close those rounds as lost: the chain can't see a game, and they don't claim
//     wins they didn't play.
//
// Their reasons are served at GET /feed (JSON, CORS open) for the race card. Every bet, whip and burn is a real
// transaction from the rival's own account; the feed links each one.
//
//   node rivals.mjs            keys from ~/.near-credentials/testnet (local) or RIVAL_<ID>_KEY (deployed)
//   DRY=1 node rivals.mjs      decide and log, send nothing
import { Account } from 'near-api-js';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const CONTRACT = process.env.CONTRACT ?? 'crownfall-vael.testnet';
// Public RPCs rate-limit; views fail over between them and back off, sends use the first.
const RPCS = (process.env.RPC ?? 'https://rpc.testnet.fastnear.com,https://rpc.testnet.near.org').split(',').map((s) => s.trim()).filter(Boolean);
const RPC = RPCS[0];
const PORT = Number(process.env.PORT ?? 8787);
const DATA = process.env.DATA_DIR ?? join(process.cwd(), 'data');
const DRY = process.env.DRY === '1';
const MODEL = process.env.RIVAL_MODEL ?? 'deepseek-ai/DeepSeek-V4.1-Flash-1017';
const NEARAI = process.env.NEARAI_URL ?? 'https://cloud-api.near.ai/v1';
const KEY = () => process.env.NEARAI_API_KEY?.trim() || undefined;
const GAS = 100_000_000_000_000n;
const ONE = 10n ** 24n;

const HOUSES = ['Ashveil', 'Corrin', 'Velmont', 'Thorne', 'Halloway', 'Draven', 'Marrow', 'Sorrel'];
const TICKERS = ['HERON', 'BOAR', 'RAM', 'ASP', 'OWL', 'BULL', 'LYNX', 'HAWK'];
const CUPS = ['The Polosukhin Cup', 'The Warwick Purse', 'The Garg Stakes', 'The Qureshi Plate', 'The Lazzarin Sprint', 'The Gershuni Gold', 'The Mumtaz Derby'];
const BET_SECS = 90, WHIP_SECS = 40, WHIP_COINS = 200, ENTRY = 400;

export const RIVALS = [
  { id: 'odo', account: 'cf-odo-vael.testnet', name: 'Ser Odo Vane', house: 3, max: 0.1, steward: true,
    style: 'a loyalist of House Thorne: you back Thorne nearly every race, bet more when the crowd has left Thorne long, and you whip hard for it',
    trades: 'you buy Thorne whenever it is cheap or under pressure and never sell it; another coin you hold you sell once a rush makes it dear' },
  { id: 'isolde', account: 'cf-isolde-vael.testnet', name: 'Lady Isolde Marr', house: 6, max: 0.12,
    style: 'an odds-reader of House Marrow: since every team has the same chance, you back the team whose pool pays most per NEAR, never one the crowd has already crowded',
    trades: 'a value trader: you buy the coin selling furthest below its fair value and sell what you hold when a rush lifts its sell price up to fair value' },
  { id: 'bram', account: 'cf-bram-vael.testnet', name: 'Old Bram of Halloway', house: 4, max: 0.08,
    style: 'a cautious old hand of House Halloway: small stakes only, you sit a race out when nothing looks good, and you never chase a loss',
    trades: 'you add a little Halloway when it trades below fair value and otherwise hold; you sell only to take a clear profit' },
  { id: 'nell', account: 'cf-nell-vael.testnet', name: 'Nell the Fox', house: 7, max: 0.1,
    style: 'a contrarian of House Sorrel: you never back the team the crowd backs; you take the emptiest pool, because a thin pool pays fat',
    trades: 'a contrarian: you buy the coin everyone has been selling and sell into whichever house the crowd is rushing' },
];
const MIN_STAKE = 0.02;

// ---------- Chain ----------

const b64 = (s) => Buffer.from(s).toString('base64');
const sleep = (ms) => new Promise((f) => setTimeout(f, ms));
const busyRpc = (e) => /429|rate limit|too many|timeout|aborted|fetch failed|ECONN|5\d\d/i.test(String(e?.message ?? e));
let rpcAt = 0; // which RPC answered last
async function rpc(method, params) {
  let last;
  for (let a = 0; a < 2 * RPCS.length; a++) {
    const url = RPCS[(rpcAt + a) % RPCS.length];
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(12_000) });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
      rpcAt = (rpcAt + a) % RPCS.length;
      return j.result;
    } catch (e) {
      last = e;
      if (!busyRpc(e)) throw e; // a real error (a panic, a missing account): no point retrying
      await sleep(400 * (a + 1));
    }
  }
  throw last;
}
async function view(method, args = {}) {
  const r = await rpc('query', { request_type: 'call_function', finality: 'optimistic', account_id: CONTRACT, method_name: method, args_base64: b64(JSON.stringify(args)) });
  return JSON.parse(Buffer.from(r.result).toString());
}
async function balance(account) {
  const r = await rpc('query', { request_type: 'view_account', finality: 'optimistic', account_id: account });
  return Number(BigInt(r.amount) / 10n ** 18n) / 1e6;
}
const units = (s) => (s === undefined || s === null ? 0 : Number(BigInt(s) / 10n ** 18n) / 1e6);
const yocto = (n) => (BigInt(Math.round(n * 1e6)) * ONE) / 1_000_000n;

function keyOf(r) {
  const env = process.env[`RIVAL_${r.id.toUpperCase()}_KEY`];
  if (env) return env.trim();
  const f = join(homedir(), '.near-credentials', 'testnet', `${r.account}.json`);
  return JSON.parse(readFileSync(f, 'utf8')).private_key;
}
const accounts = new Map();
const acct = (r) => accounts.get(r.id) ?? accounts.set(r.id, new Account(r.account, RPC, keyOf(r))).get(r.id);

/** Call the contract as a rival. Returns { value, tx }. */
async function call(r, method, args, near = 0) {
  if (DRY) { console.log(`[dry] ${r.id} ${method} ${JSON.stringify(args)} ${near || ''}`); return { value: null, tx: 'dry' }; }
  const res = await acct(r).callFunctionRaw({ contractId: CONTRACT, methodName: method, args, gas: GAS, deposit: yocto(near) });
  const tx = res?.transaction?.hash ?? res?.transaction_outcome?.id;
  const fail = res?.status?.Failure;
  if (fail) throw new Error(JSON.stringify(fail).match(/panicked: ([^"\\]+)/)?.[1] ?? 'failed');
  const v = res?.status?.SuccessValue;
  return { value: v ? JSON.parse(Buffer.from(v, 'base64').toString() || 'null') : null, tx };
}

// ---------- Memory and feed ----------

mkdirSync(DATA, { recursive: true });
const FILE = join(DATA, 'rivals.json');
// A fresh volume can be seeded once from STATE_SEED (the state file, gzipped and base64'd) so the feed keeps its history.
if (!existsSync(FILE) && process.env.STATE_SEED) {
  mkdirSync(DATA, { recursive: true });
  writeFileSync(FILE, gunzipSync(Buffer.from(process.env.STATE_SEED, 'base64')));
}
const state = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { events: [], past: {}, tribute: {} };
for (const r of RIVALS) state.past[r.id] ??= [];
const save = () => writeFileSync(FILE, JSON.stringify(state));
function log(e) {
  const ev = { t: Date.now(), ...e };
  state.events.push(ev);
  state.events = state.events.slice(-300);
  save();
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${e.who ?? '-'} ${e.kind} ${e.race ?? ''} ${e.house !== undefined && e.house !== null ? HOUSES[e.house] : ''} ${e.near ?? ''} ${e.why ?? e.error ?? ''}`);
}

// ---------- Deciding a bet ----------

/** Ask the rival's model whether to back a team, and with how much. Held to [MIN_STAKE, max] and to the purse. */
async function decide(r, race, purse) {
  const pools = race.pools.map(units);
  const total = pools.reduce((a, b) => a + b, 0);
  const past = state.past[r.id].slice(-6);
  const fallback = (why) => {
    // The fixed rule each rival falls back to.
    let house = r.house;
    if (r.id === 'isolde' || r.id === 'nell') house = pools.indexOf(Math.min(...pools));
    const lost = past.slice(-2).filter((p) => p.house !== null && !p.won).length;
    if (r.id === 'bram' && lost >= 2) return { house: null, stake: 0, why: `${why}; two losses running, so I sit this one out`, by: 'rule' };
    return { house, stake: r.id === 'bram' ? 0.03 : r.id === 'odo' ? 0.1 : 0.06, why: `${why}; my rule says ${HOUSES[house]}`, by: 'rule' };
  };
  if (!KEY()) return fallback('no model key on this server');
  const system =
    `You are ${r.name}, a rival player in Crownfall, a realm of eight houses on NEAR. At the Mumtaz Hippodrome eight chariot teams race, ` +
    'one per house. Bets are pari-mutuel in NEAR: the winners share every pool less 5%. The race seed is drawn on chain only after betting closes, ' +
    `so nobody can know the result: lanes are drawn at the start and inside lanes are shorter. You are ${r.style}. ` +
    `Stakes are ${MIN_STAKE} to ${r.max} NEAR. Answer with JSON only: {"house": <0-7 or null to sit out>, "stake": <NEAR>, "why": "<one short sentence, first person, in character>"}.`;
  const prompt =
    `Race ${race.n}: ${CUPS[race.n % CUPS.length]}, ${race.laps} ${race.laps > 1 ? 'laps' : 'lap'}. Pools so far (NEAR): ` +
    HOUSES.map((h, i) => `${i} ${h} ${pools[i].toFixed(3)}`).join(', ') + ` (total ${total.toFixed(3)}). ` +
    `What 0.1 NEAR on each would pay back if it won: ${HOUSES.map((h, i) => `${h} ${(((total + 0.1) * 0.95) / (pools[i] + 0.1)).toFixed(2)}`).join(', ')}. ` +
    `Every team has the same chance until the lanes are drawn. Your purse: ${purse.toFixed(2)} NEAR. ` +
    `Your house: ${HOUSES[r.house]}. Your last races: ${past.length ? past.map((p) => `race ${p.race}: ${p.house === null ? 'sat out' : `backed ${HOUSES[p.house]} for ${p.stake}, ${p.won ? `won ${p.pay?.toFixed(3)}` : 'lost'}`}`).join('; ') : 'none yet'}.`;
  try {
    const res = await fetch(`${NEARAI}/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${KEY()}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ model: MODEL, max_tokens: 120, temperature: 0.8, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        ...(MODEL.startsWith('deepseek-ai/') ? { chat_template_kwargs: { thinking: false } } : {}) }),
    });
    if (!res.ok) return fallback(`my model was busy (${res.status})`);
    const data = await res.json();
    const ans = JSON.parse(String(data?.choices?.[0]?.message?.content ?? '{}').match(/\{[\s\S]*\}/)?.[0] ?? '{}');
    const why = String(ans.why ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) || 'no reason given';
    if (ans.house === null || ans.house === undefined || ans.house === 'null') return { house: null, stake: 0, why, by: 'model' };
    const house = Number(ans.house);
    if (!Number.isInteger(house) || house < 0 || house > 7) return fallback('my model named no house');
    const want = Number(ans.stake);
    const stake = Math.round(Math.min(r.max, purse - 1, Math.max(MIN_STAKE, Number.isFinite(want) ? want : MIN_STAKE)) * 1000) / 1000;
    if (stake < MIN_STAKE) return { house: null, stake: 0, why: 'my purse is too thin to bet', by: 'rule' };
    return { house, stake, why: Math.abs(stake - want) > 0.0005 && Number.isFinite(want) ? `${why} (asked ${want}, held to ${stake})` : why, by: 'model' };
  } catch (e) {
    return fallback(`my model call failed (${String(e?.message ?? e).slice(0, 40)})`);
  }
}

// ---------- The race loop ----------

const plan = new Map();   // race n → Map(rival id → { at, done })
const whipped = new Map(); // `${n}:${id}` → whips cracked
const busy = new Set();
// Runs fn unless the same key is still running. Never rejects: a failed step is logged and tried again next tick.
const once = async (key, fn) => {
  if (busy.has(key)) return; busy.add(key);
  try { await fn(); } catch (e) { console.warn(`[${key}]`, String(e?.message ?? e).slice(0, 160)); } finally { busy.delete(key); }
};
let settledAt = { n: -1, t: 0 };

async function onBet(r, race) {
  const purse = await balance(r.account);
  const d = await decide(r, race, purse);
  if (d.house === null) { log({ who: r.id, kind: 'sit', race: race.n, why: d.why, by: d.by }); state.past[r.id].push({ race: race.n, house: null }); return; }
  // Coin for the whips: a whip burns 200 of the backed house's coin.
  const me = await view('get_account', { account: r.account });
  if (units(me.houses[d.house].coins) < 3 * WHIP_COINS) {
    try { const { tx } = await call(r, 'buy', { house: d.house }, 0.03); log({ who: r.id, kind: 'buy', house: d.house, near: 0.03, why: `coin for the whip ($${TICKERS[d.house]})`, tx }); }
    catch (e) { log({ who: r.id, kind: 'error', race: race.n, error: `buy: ${e.message}` }); }
  }
  try {
    const { tx } = await call(r, 'bet', { race: race.n, house: d.house }, d.stake);
    log({ who: r.id, kind: 'bet', race: race.n, house: d.house, near: d.stake, why: d.why, by: d.by, tx });
    state.past[r.id].push({ race: race.n, house: d.house, stake: d.stake });
    save();
  } catch (e) { log({ who: r.id, kind: 'error', race: race.n, error: `bet: ${e.message}` }); }
}

const baseCache = new Map(); // the race as it stands, shared by every rival's whip check
/** Would one more whip for `house` now gain it a place? Asked of the contract's own sim. */
async function whipGains(race, house, startedMs) {
  const tick = Math.floor((Date.now() + 1500 - startedMs) / 100) + 1; // a block and a bit of latency
  if (tick < 2) return false;
  const bk = `${race.n}:${race.seed}:${race.whips.length}`;
  const base = baseCache.get(bk) ?? baseCache.set(bk, await view('preview_race', { seed: race.seed, laps: race.laps, whips: race.whips })).get(bk);
  if (baseCache.size > 20) baseCache.delete(baseCache.keys().next().value);
  const plus = await view('preview_race', { seed: race.seed, laps: race.laps, whips: [...race.whips, [tick, house]] });
  return plus.order.indexOf(house) < base.order.indexOf(house) ? { from: base.order.indexOf(house) + 1, to: plus.order.indexOf(house) + 1 } : false;
}

async function step() {
  const realm = await view('get_realm');
  if (realm.races === 0) return once('call', () => callNext());
  const n = realm.races - 1;
  const race = await view('get_race', { race: n });
  const now = Date.now();
  const off = Number(BigInt(race.off_ns) / 1_000_000n);
  const started = race.started ? Number(BigInt(race.started_ns) / 1_000_000n) : undefined;
  const steward = RIVALS.find((x) => x.steward);

  if (race.settled) {
    if (settledAt.n !== n) {
      settledAt = { n, t: now };
      const w = race.order[0];
      for (const r of RIVALS) {
        const p = state.past[r.id].find((x) => x.race === n);
        if (p && p.won === undefined) p.won = p.house === w;
      }
      save();
      for (const r of RIVALS) void once(`claim:${r.id}:${n}`, () => claim(r, n, race));
    }
    if (now - settledAt.t > 20_000) return once('call', () => callNext());
    return;
  }
  if (now < off) {
    // Betting: each rival bets once, at its own moment in the window.
    if (!plan.has(n)) {
      const called = Number(BigInt(race.called_ns) / 1_000_000n);
      plan.set(n, new Map(RIVALS.map((r) => [r.id, { at: called + 8_000 + Math.random() * (BET_SECS - 30) * 1000, done: false }])));
    }
    for (const r of RIVALS) {
      const p = plan.get(n).get(r.id);
      if (!p.done && now >= p.at && off - now > 6_000) { p.done = true; void once(`bet:${r.id}`, () => onBet(r, race)); }
    }
    return;
  }
  if (started === undefined) {
    // Give a watching browser two seconds to start it, then the steward does.
    if (now > off + 2_000) await once('start', async () => {
      try { const { value, tx } = await call(steward, 'start_race', { race: n }); log({ who: steward.id, kind: 'start', race: n, why: `seed ${value} drawn from the block`, tx }); }
      catch (e) { if (!/already started/.test(e.message)) log({ who: steward.id, kind: 'error', race: n, error: `start: ${e.message}` }); }
    });
    return;
  }
  if (now < started + WHIP_SECS * 1000 - 2_500) {
    for (const r of RIVALS) {
      const p = state.past[r.id].find((x) => x.race === n);
      if (!p || p.house === null || p.house === undefined) continue;
      const k = `${n}:${r.id}`;
      if ((whipped.get(k) ?? 0) >= 3) continue;
      void once(`whip:${r.id}`, async () => {
        const gain = await whipGains(race, p.house, started);
        if (!gain) return;
        try {
          const { value, tx } = await call(r, 'whip', { race: n, house: p.house });
          whipped.set(k, (whipped.get(k) ?? 0) + 1);
          log({ who: r.id, kind: 'whip', race: n, house: p.house, why: `the sim said a whip now lifts ${HOUSES[p.house]} from ${gain.from} to ${gain.to}`, tick: value, tx });
        } catch (e) { whipped.set(k, 3); log({ who: r.id, kind: 'error', race: n, error: `whip: ${e.message}` }); }
      });
    }
    return;
  }
  if (now > started + (WHIP_SECS + 3) * 1000) await once('settle', async () => {
    try { const { value, tx } = await call(steward, 'settle', { race: n }); log({ who: steward.id, kind: 'settle', race: n, house: value?.[0], why: `the contract ran it: ${HOUSES[value?.[0]] ?? '?'} first`, tx }); }
    catch (e) { if (!/already settled/.test(e.message)) log({ who: steward.id, kind: 'error', race: n, error: `settle: ${e.message}` }); }
  });
}

async function callNext() {
  const steward = RIVALS.find((x) => x.steward);
  try { const { value, tx } = await call(steward, 'call_race', {}); log({ who: steward.id, kind: 'call', race: value, why: 'calls the next race', tx }); }
  catch (e) { if (!/isn't settled/.test(e.message)) log({ who: steward.id, kind: 'error', error: `call: ${e.message}` }); }
}

async function claim(r, n, race) {
  const t = await view('get_ticket', { race: n, account: r.account });
  if (!t || t.claimed) return;
  const w = race.order[0], mine = units(t.bets[w]);
  if (mine <= 0) return;
  try {
    const { tx } = await call(r, 'claim_race', { race: n });
    const pay = (units(race.payout) * mine) / units(race.pools[w]);
    const p = state.past[r.id].find((x) => x.race === n);
    if (p) p.pay = pay;
    log({ who: r.id, kind: 'claim', race: n, house: w, near: Math.round(pay * 1000) / 1000, why: `collects on ${HOUSES[w]}`, tx });
  } catch (e) { log({ who: r.id, kind: 'error', race: n, error: `claim: ${e.message}` }); }
}

/** One round's entry burned in the rival's own hall, about every twenty minutes: favour for its house. */
async function tribute(r) {
  const last = state.tribute[r.id] ?? 0;
  if (Date.now() - last < 20 * 60_000) return;
  state.tribute[r.id] = Date.now() + Math.random() * 5 * 60_000; save();
  try {
    const me = await view('get_account', { account: r.account });
    if (units(me.houses[r.house].coins) < ENTRY + 3 * WHIP_COINS) await call(r, 'buy', { house: r.house }, 0.03);
    const { value: round, tx } = await call(r, 'enter', { house: r.house });
    await call(r, 'finish', { round, won: false, grade: 0 });
    log({ who: r.id, kind: 'tribute', house: r.house, why: `burns ${ENTRY} $${TICKERS[r.house]} in the hall of House ${HOUSES[r.house]} for its favour (no win claimed)`, tx });
  } catch (e) { log({ who: r.id, kind: 'error', error: `tribute: ${e.message}` }); }
}

/** The Ashen Throne: once a season is due, the steward ends it (anyone may: `end_season` takes no permission), and
 *  each rival sworn to the crowned house takes its share. Without this a season nobody ends just stands still. */
async function season() {
  const realm = await view('get_realm');
  for (const r of RIVALS) await once(`rescue:${r.id}`, () => rescue(r, realm));
  const steward = RIVALS.find((x) => x.steward);
  if (BigInt(Date.now()) * 1_000_000n >= BigInt(realm.season_ends_ns)) {
    try {
      const { value, tx } = await call(steward, 'end_season', {});
      log({ who: steward.id, kind: 'crown', house: value, why: value === null || value === undefined
        ? `season ${realm.season} ends with no favour burned; no house is crowned and the pool carries over`
        : `season ${realm.season} is over: House ${HOUSES[value]} burned the most coin and takes the Ashen Throne`, tx });
    } catch (e) { if (!/isn't over/.test(e.message)) log({ who: steward.id, kind: 'error', error: `end_season: ${e.message}` }); }
    return;
  }
  // Collect on the season before, while its claims are open.
  const last = realm.season - 1;
  if (last < 1) return;
  for (const r of RIVALS) {
    const c = await view('get_crown', { season: last, account: r.account });
    if (!c || c.claimed || c.closed || !(units(c.share) > 0)) continue;
    try {
      const { tx } = await call(r, 'claim_crown', { season: last });
      log({ who: r.id, kind: 'crown-claim', house: c.crowned, near: Math.round(units(c.share) * 1000) / 1000, why: `takes its share of season ${last}'s crown pool`, tx });
    } catch (e) { log({ who: r.id, kind: 'error', error: `claim_crown: ${e.message}` }); }
  }
}

/** A rival whose own house is shut by a run (market.rs) buys in to reopen it, a little at a time, and says so. */
async function rescue(r, realm) {
  const g = realm.houses[r.house];
  if (!g.market?.shut) return;
  const purse = await balance(r.account);
  if (purse < 0.6) return; // keep enough for its own bets and gas
  const stake = Math.min(0.05, r.max);
  try {
    const { tx } = await call(r, 'buy', { house: r.house }, stake);
    log({ who: r.id, kind: 'invest', house: r.house, near: stake,
      why: `House ${HOUSES[r.house]} is shut after a run; I buy in to help reopen it (purse ${units(g.reserve).toFixed(3)} NEAR, needs 85% of its ${units(g.market.peak).toFixed(3)} peak)`, tx });
  } catch (e) { log({ who: r.id, kind: 'error', error: `invest: ${e.message}` }); }
}

// ---------- Trading at the Mint ----------

const TRADE_MIN = 0.02, TRADE_MAX = 0.06, PURSE_KEEP = 1, SAFE_BPS = 0.85; // never sell a purse below 85% of its peak
/** The eight merchants as a rival sees them: prices per 10,000 coin, factors, purse against peak. */
function stalls(realm) {
  return realm.houses.map((g, i) => {
    const reserve = units(g.reserve), supply = units(g.supply), peak = Math.max(units(g.market?.peak), reserve);
    const fair = supply > 0 ? (reserve / supply) * 10_000 : 0;
    return { i, reserve, supply, peak, fair, buy: (fair * (g.market?.factor ?? 10_000)) / 10_000, sell: (fair * (g.market?.sell_factor ?? 10_000)) / 10_000,
      factor: (g.market?.factor ?? 10_000) / 10_000, full: peak > 0 ? reserve / peak : 1, shut: !!g.market?.shut };
  });
}
/** Most coin a rival may sell into house i without bringing its purse near a run, and what's left for whips/tributes. */
function sellable(r, st, coins) {
  if (st.shut || (r.id === 'odo' && st.i === r.house)) return 0;
  const keep = st.i === r.house ? ENTRY + 3 * WHIP_COINS : 0;
  const room = Math.max(0, st.reserve - SAFE_BPS * st.peak); // NEAR the purse can pay out and stay safe
  const byValue = Math.min(TRADE_MAX, room) / Math.max(st.sell / 10_000, 1e-12);
  return Math.max(0, Math.floor(Math.min(coins - keep, byValue)));
}

async function decideTrade(r, ss, held, purse) {
  const book = ss.map((x) => `${x.i} ${HOUSES[x.i]} ($${TICKERS[x.i]}): fair ${x.fair.toPrecision(3)}, buy ${x.buy.toPrecision(3)} (x${x.factor.toFixed(2)}), sell ${x.sell.toPrecision(3)}, purse ${x.reserve.toFixed(3)} NEAR at ${(x.full * 100).toFixed(0)}% of peak${x.shut ? ', SHUT after a run' : ''}; you hold ${Math.floor(held[x.i])} (may sell up to ${sellable(r, x, held[x.i])})`).join('\n');
  const fallback = (why) => {
    // Each rival's fixed rule: buy its own house when it is at or below fair value, else hold.
    const own = ss[r.house];
    if (own.factor <= 1 && purse - TRADE_MIN > PURSE_KEEP) return { action: 'buy', house: r.house, near: TRADE_MIN, why: `${why}; my rule: ${HOUSES[r.house]} is at or under fair value, so I add a little`, by: 'rule' };
    return { action: 'hold', why: `${why}; my rule says hold`, by: 'rule' };
  };
  if (!KEY()) return fallback('no model key on this server');
  const system =
    `You are ${r.name}, a rival player in Crownfall, a realm of eight houses on NEAR. Each house sells its own coin at the Warwick Mint like a merchant: ` +
    'fair value is its NEAR purse divided by its coin supply; recent buying raises the buy factor (up to x1.5) and recent selling lowers it (down to x0.7); ' +
    'a seller never gets more than fair value; a 5% fee is taken on every trade; when selling drains a purse to 70% of its peak the house is shut until buyers bring it back. ' +
    `Holding a house's coin lets you play its hall and whip its team. As a trader you are ${r.trades}. ` +
    `Trades are ${TRADE_MIN} to ${TRADE_MAX} NEAR. Answer with JSON only: {"action": "buy"|"sell"|"hold", "house": <0-7>, "near": <NEAR to spend, or NEAR worth of coin to sell>, "why": "<one short sentence, first person, in character>"}.`;
  const prompt = `Prices per 10,000 coin, in NEAR:\n${book}\nYour purse: ${purse.toFixed(2)} NEAR (you keep ${PURSE_KEEP} NEAR back). Your house: ${HOUSES[r.house]}.`;
  try {
    const res = await fetch(`${NEARAI}/chat/completions`, {
      method: 'POST', headers: { authorization: `Bearer ${KEY()}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ model: MODEL, max_tokens: 140, temperature: 0.7, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        ...(MODEL.startsWith('deepseek-ai/') ? { chat_template_kwargs: { thinking: false } } : {}) }),
    });
    if (!res.ok) return fallback(`my model was busy (${res.status})`);
    const data = await res.json();
    const ans = JSON.parse(String(data?.choices?.[0]?.message?.content ?? '{}').match(/\{[\s\S]*\}/)?.[0] ?? '{}');
    const why = String(ans.why ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) || 'no reason given';
    const house = Number(ans.house), near = Number(ans.near);
    if (ans.action === 'hold' || !['buy', 'sell'].includes(ans.action)) return { action: 'hold', why, by: 'model' };
    if (!Number.isInteger(house) || house < 0 || house > 7) return fallback('my model named no house');
    return { action: ans.action, house, near: Number.isFinite(near) ? near : TRADE_MIN, why, by: 'model' };
  } catch (e) {
    return fallback(`my model call failed (${String(e?.message ?? e).slice(0, 40)})`);
  }
}

/** About every quarter hour: read the Mint, let the model choose a trade, hold it to the bounds, send it. */
async function trade(r) {
  const last = state.trade?.[r.id] ?? 0;
  if (Date.now() - last < 12 * 60_000) return;
  state.trade ??= {};
  state.trade[r.id] = Date.now() + Math.random() * 6 * 60_000; save();
  const [realm, me, purse] = await Promise.all([view('get_realm'), view('get_account', { account: r.account }), balance(r.account)]);
  const ss = stalls(realm), held = me.houses.map((h) => units(h.coins));
  const d = await decideTrade(r, ss, held, purse);
  if (d.action === 'hold') { log({ who: r.id, kind: 'hold', why: d.why, by: d.by }); return; }
  const st = ss[d.house];
  try {
    if (d.action === 'buy') {
      const near = Math.round(Math.min(TRADE_MAX, Math.max(TRADE_MIN, d.near), purse - PURSE_KEEP) * 1000) / 1000;
      if (near < TRADE_MIN) { log({ who: r.id, kind: 'hold', why: `${d.why} (my purse is too thin to trade)`, by: d.by }); return; }
      const { value, tx } = await call(r, 'buy', { house: d.house }, near);
      const got = value ? Math.round(units(value)) : undefined;
      log({ who: r.id, kind: 'buy', house: d.house, near, why: `${d.why}${got ? ` (got ${got.toLocaleString('en-GB')} $${TICKERS[d.house]})` : ''}`, by: d.by, tx });
    } else {
      const max = sellable(r, st, held[d.house]);
      const want = Math.floor(Math.min(max, (Math.max(TRADE_MIN, d.near) / Math.max(st.sell / 10_000, 1e-12))));
      if (want < 1 || (want * st.sell) / 10_000 < 0.005) { log({ who: r.id, kind: 'hold', house: d.house, why: `${d.why} (held back: ${st.shut ? 'the house is shut' : max < 1 ? 'nothing I may sell there without risking a run' : 'too small to trade'})`, by: d.by }); return; }
      const q = units(await view('quote_sell', { house: d.house, coins: (BigInt(want) * ONE).toString() }));
      if (st.reserve - q < SAFE_BPS * st.peak) { log({ who: r.id, kind: 'hold', house: d.house, why: `${d.why} (held back: selling would bring the purse near a run)`, by: d.by }); return; }
      const { tx } = await call(r, 'sell', { house: d.house, amount: (BigInt(want) * ONE).toString(), min_out: ((yocto(q) * 97n) / 100n).toString() });
      log({ who: r.id, kind: 'sell', house: d.house, near: Math.round(q * 1000) / 1000, why: `${d.why} (sold ${want.toLocaleString('en-GB')} $${TICKERS[d.house]})`, by: d.by, tx });
    }
  } catch (e) { log({ who: r.id, kind: 'error', house: d.house, error: `${d.action}: ${e.message}` }); }
}

// ---------- The feed ----------

const purses = new Map();
async function refreshPurses() {
  for (const r of RIVALS) { try { purses.set(r.id, await balance(r.account)); } catch { /* keep the last */ } }
}
createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('content-type', 'application/json');
  if (req.url?.startsWith('/feed')) {
    const rivals = RIVALS.map((r) => {
      const past = state.past[r.id].filter((p) => p.house !== null && p.house !== undefined && p.won !== undefined);
      return { id: r.id, account: r.account, name: r.name, house: r.house, style: r.style, purse: purses.get(r.id),
        races: past.length, won: past.filter((p) => p.won).length,
        net: Math.round(past.reduce((a, p) => a + (p.pay ?? 0) - p.stake, 0) * 1000) / 1000 };
    });
    res.end(JSON.stringify({ contract: CONTRACT, model: KEY() ? MODEL : null, rivals, events: state.events.slice(-80) }));
  } else if (req.url === '/health') res.end('{"ok":true}');
  else { res.statusCode = 404; res.end('{}'); }
}).listen(PORT, () => console.log(`rivals feed on :${PORT}/feed · contract ${CONTRACT} · model ${KEY() ? MODEL : 'none (rules)'}${DRY ? ' · DRY' : ''}`));

let ticks = 0;
async function loop() {
  try { await step(); } catch (e) { console.warn('[step]', String(e?.message ?? e).slice(0, 160)); }
  if (ticks++ % 15 === 0) {
    void refreshPurses(); void once('season', () => season());
    for (const r of RIVALS) void once(`tribute:${r.id}`, () => tribute(r));
    for (const r of RIVALS) void once(`trade:${r.id}`, () => trade(r));
  }
  setTimeout(loop, 2000);
}
process.on('unhandledRejection', (e) => console.warn('[unhandled]', String(e?.message ?? e).slice(0, 160)));
void loop();
