// Proof that the realm is alive, readable without playing: a plain HTML page at /proof and JSON at /proof.json.
// Everything is read live from NEAR testnet (the contract and the rival agents' accounts), the rivals' own feed and
// the fastnear transaction index, and cached for 30 s at the edge.
//
//   GET /api/proof               -> HTML
//   GET /api/proof?format=json   -> JSON
const CONTRACT = 'crownfall-vael.testnet';
const RPCS = ['https://rpc.testnet.fastnear.com', 'https://test.rpc.fastnear.com'];
const FEED = 'https://crownfall-rivals-production.up.railway.app/feed';
const TX_INDEX = 'https://tx.test.fastnear.com/v0/account';
const EXPLORER = 'https://testnet.nearblocks.io';
const REPRO_HASH = 'DEq9f3kLGrTQuiWAjMbk8oyfPtxHo3173bhvV4GGFA4b'; // JUDGE.md §3: the reproducible build at 0daf80b
const YOCTO = 1e24;

async function rpc<T>(method: string, params: unknown): Promise<T> {
  let last: unknown;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(8000) });
      const j = (await r.json()) as { result?: T; error?: unknown };
      if (j.result !== undefined) return j.result;
      last = j.error;
    } catch (e) { last = e; }
  }
  throw new Error(`rpc ${method}: ${JSON.stringify(last)?.slice(0, 120)}`);
}
async function view<T>(method: string, args: unknown = {}): Promise<T> {
  const r = await rpc<{ result: number[] }>('query', { request_type: 'call_function', finality: 'optimistic', account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
  return JSON.parse(Buffer.from(r.result).toString()) as T;
}
const account = (id: string) => rpc<{ amount: string; code_hash: string }>('query', { request_type: 'view_account', finality: 'optimistic', account_id: id });
const keys = (id: string) => rpc<{ keys: { access_key: { permission: unknown } }[] }>('query', { request_type: 'view_access_key_list', finality: 'optimistic', account_id: id });
const near = (y: string | number) => Number(y) / YOCTO;
const coins = (y: string) => Number(BigInt(y) / 10n ** 24n);

interface House { name: string; coin: string; game: string; reserve: string; supply: string; burned: string; rounds: number; wins: number; favour: string; market: { shut: boolean } }
interface Realm { version: string; season: number; season_ends_ns: string; pool: string; races: number; houses: House[] }
interface Race { n: number; laps: number; settled: boolean; started: boolean; off_ns: string; order: number[]; pools: string[]; whips: unknown[] }
interface FeedEvent { t: number; who: string; kind: string; race?: number; house?: number; near?: number; why?: string; tx?: string }
interface Feed { model?: string; rivals: { id: string; account: string; name: string; house: number; style: string; purse: number; races: number; won: number; net: number }[]; events: FeedEvent[] }

export async function proof() {
  const [realm, code, keyList, feed, txs] = await Promise.all([
    view<Realm>('get_realm'),
    account(CONTRACT),
    keys(CONTRACT),
    fetch(FEED, { signal: AbortSignal.timeout(6000) }).then((r) => (r.ok ? (r.json() as Promise<Feed>) : undefined)).catch(() => undefined),
    fetch(TX_INDEX, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account_id: CONTRACT }), signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? (r.json() as Promise<{ txs_count: number }>) : undefined)).catch(() => undefined),
  ]);
  const last = realm.races > 0 ? await view<Race>('get_race', { race: realm.races - 1 }) : undefined;
  const prev = realm.races > 1 ? await view<Race>('get_race', { race: realm.races - 2 }) : undefined;
  const settled = last?.settled ? last : prev;
  const full = keyList.keys.filter((k) => k.access_key.permission === 'FullAccess').length;
  const H = realm.houses;
  return {
    contract: CONTRACT,
    read_at: new Date().toISOString(),
    network: 'testnet',
    code_hash: code.code_hash,
    code_matches_reproducible_build: code.code_hash === REPRO_HASH,
    access_keys: { total: keyList.keys.length, full_access: full },
    transactions_on_contract: txs?.txs_count ?? null,
    season: { n: realm.season, ends: new Date(Number(BigInt(realm.season_ends_ns) / 1_000_000n)).toISOString(), crown_pool_near: near(realm.pool) },
    races: {
      run_on_chain: realm.races,
      latest: last && { n: last.n, laps: last.laps, betting_open: !last.started && Date.now() < Number(BigInt(last.off_ns) / 1_000_000n), running: last.started && !last.settled, settled: last.settled },
      last_settled: settled && { n: settled.n, winner: H[settled.order[0]]?.name, pool_near: settled.pools.reduce((a, p) => a + near(p), 0), whips: settled.whips.length },
    },
    houses: H.map((h) => ({ house: h.name, coin: `$${h.coin}`, hall_game: h.game, judged_on_chain: h.game === 'cups' || h.game === 'signals', reserve_near: near(h.reserve), supply: coins(h.supply), burned: coins(h.burned), rounds_played: h.rounds, favour: coins(h.favour), hall_shut: h.market.shut })),
    agents: {
      decided_by: feed?.model ? `${feed.model} on NEAR AI Cloud` : null,
      rivals: (feed?.rivals ?? []).map((r) => ({ name: r.name, account: r.account, house: H[r.house]?.name, plays_as: r.style, purse_near: r.purse, races_bet: r.races, races_won: r.won, net_near: r.net })),
      latest_moves: (feed?.events ?? []).slice(-10).reverse().map((e) => ({ at: new Date(e.t).toISOString(), who: feed?.rivals.find((r) => r.id === e.who)?.name ?? e.who, kind: e.kind, race: e.race, house: e.house !== undefined ? H[e.house]?.name : undefined, near: e.near, why: e.why, tx: e.tx && e.tx !== 'dry' ? `${EXPLORER}/txns/${e.tx}` : undefined })),
    },
  };
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const n2 = (x: number) => x.toLocaleString('en-GB', { maximumFractionDigits: 2 });

function html(p: Awaited<ReturnType<typeof proof>>) {
  const a = (href: string, t: string) => `<a href="${esc(href)}">${esc(t)}</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Crownfall, live on NEAR</title><meta name="description" content="Live state of the Crownfall contract on NEAR testnet: races, house coins, and the rival agents with their own wallets.">
<style>
:root{--bg:#f6f3ec;--ink:#1d1a14;--mute:#6b6457;--line:#ddd5c4;--gold:#9a6b12;--ok:#2f7a4a}
@media (prefers-color-scheme:dark){:root{--bg:#14120e;--ink:#ece6d8;--mute:#a59d8c;--line:#332e25;--gold:#e0b45a;--ok:#6cc790}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:28px max(16px,env(safe-area-inset-left)) 48px}
h1{font:700 28px/1.2 Georgia,serif;margin:0 0 4px}h2{font:700 18px/1.3 Georgia,serif;margin:28px 0 8px}
p{margin:6px 0}small,.mute{color:var(--mute)}a{color:var(--gold)}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:16px 0}
.facts div{border:1px solid var(--line);border-radius:8px;padding:10px 12px}.facts b{display:block;font-size:22px;font-variant-numeric:tabular-nums}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;min-width:620px;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{font-weight:600;color:var(--mute);font-size:13px}
.ok{color:var(--ok);font-weight:600}code{font-size:13px}
</style></head><body><main>
<h1>Crownfall, live on NEAR</h1>
<p class="mute">Read from <code>${esc(p.contract)}</code> on NEAR testnet at ${esc(p.read_at)}. Nothing on this page is typed in by hand. JSON: ${a('/proof.json', '/proof.json')}. Play: ${a('/', 'crownfall.nerom.site')} (${a('/?judge', '?judge')} for a checklist).</p>
<div class="facts">
<div><b>${p.transactions_on_contract !== null ? n2(p.transactions_on_contract) : 'n/a'}</b>transactions on the contract</div>
<div><b>${n2(p.races.run_on_chain)}</b>races run on chain, each settled by the contract</div>
<div><b>${n2(p.houses.reduce((s, h) => s + h.rounds_played, 0))}</b>hall rounds played, each one burning house coin</div>
<div><b>${p.agents.rivals.length}</b>rival agents with their own NEAR wallets</div>
</div>
<p>${p.code_matches_reproducible_build ? `<span class="ok">✓ The deployed code matches the reproducible build</span> (hash <code>${esc(p.code_hash)}</code>, see ${a('https://github.com/neromtoobad/crownfall/blob/main/JUDGE.md#3-the-deployed-code-is-this-repo', 'JUDGE.md')}).` : `Deployed code hash <code>${esc(p.code_hash)}</code>.`} Access keys on the contract: ${p.access_keys.total} (${p.access_keys.full_access} full access).</p>

<h2>The rival agents: NPCs with wallets</h2>
<p>Four lords play against you from their own testnet accounts. ${p.agents.decided_by ? `Their bets are decided by ${esc(p.agents.decided_by)}; ` : ''}every move is an ordinary transaction they sign, with the reason they gave. One of them also keeps the track running: it calls each race, starts it at the off and settles it. Anyone may.</p>
<div class="wrap"><table><tr><th>Rival</th><th>Account</th><th>House</th><th>Purse</th><th>Races bet</th><th>Won</th><th>Net</th></tr>
${p.agents.rivals.map((r) => `<tr><td><b>${esc(r.name)}</b><br><small>${esc(r.plays_as.split(':')[0])}</small></td><td>${a(`${EXPLORER}/address/${r.account}`, r.account)}</td><td>${esc(r.house)}</td><td>${n2(r.purse_near)} N</td><td>${r.races_bet}</td><td>${r.races_won}</td><td>${n2(r.net_near)} N</td></tr>`).join('')}
</table></div>
<h2>Their latest moves</h2>
<div class="wrap"><table><tr><th>When (UTC)</th><th>Who</th><th>What</th><th>Why</th></tr>
${p.agents.latest_moves.map((e) => `<tr><td>${esc(e.at.slice(11, 19))}</td><td>${esc(e.who)}</td><td>${e.tx ? a(e.tx, `${e.kind}${e.race !== undefined ? ` race ${e.race}` : ''}${e.house ? ` · ${e.house}` : ''}${e.near ? ` · ${e.near} N` : ''}`) : esc(e.kind)}</td><td><small>${esc(e.why)}</small></td></tr>`).join('')}
</table></div>

<h2>The Hippodrome</h2>
<p>${p.races.latest ? `Race ${p.races.latest.n} (${p.races.latest.laps} ${p.races.latest.laps > 1 ? 'laps' : 'lap'}): ${p.races.latest.betting_open ? 'betting is open now' : p.races.latest.running ? 'running now' : 'settled'}.` : ''} ${p.races.last_settled ? `Last settled: race ${p.races.last_settled.n}, won by House ${esc(p.races.last_settled.winner)}, ${n2(p.races.last_settled.pool_near)} NEAR in the pools, ${p.races.last_settled.whips} whips. The seed is drawn from the block that starts the race, after betting closes, and <code>settle</code> re-runs the race inside the contract.` : ''}</p>

<h2>The eight houses: a player-owned market</h2>
<p>Each house is a NEP-245 coin that players buy and sell at the Warwick Mint; trades move its price, and a run on a house shuts its hall until buyers come back. Entering a hall burns that house's coin, and the burn is the house's favour for the season's crown. A win pays nothing: it counts toward the Wardens' seals. In two halls the contract judges the win itself, replaying your moves against a seed it rolled when you entered; in the rest it takes the player's word, which is why a win there moves no NEAR and no favour.</p>
<div class="wrap"><table><tr><th>House</th><th>Coin</th><th>Hall game</th><th>Reserve</th><th>Supply</th><th>Burned</th><th>Rounds</th><th>Favour</th></tr>
${p.houses.map((h) => `<tr><td>${esc(h.house)}</td><td>${esc(h.coin)}</td><td>${esc(h.hall_game)}${h.judged_on_chain ? ' <span class="ok">· judged on chain</span>' : ''}${h.hall_shut ? ' · <b>shut (a run)</b>' : ''}</td><td>${n2(h.reserve_near)} N</td><td>${n2(h.supply)}</td><td>${n2(h.burned)}</td><td>${h.rounds_played}</td><td>${n2(h.favour)}</td></tr>`).join('')}
</table></div>
<h2>Season ${p.season.n}</h2>
<p>Ends ${esc(p.season.ends)}. Crown pool: ${n2(p.season.crown_pool_near)} NEAR, shared by the players of the house with the most favour.</p>
</main></body></html>`;
}

// Vercel's Node handler.
export default async function handler(req: { query?: Record<string, string | string[] | undefined> }, res: { status(n: number): { send(b: string): void; json(b: unknown): void }; setHeader(k: string, v: string): void }) {
  const json = req.query?.format === 'json';
  try {
    const p = await proof();
    res.setHeader('cache-control', 'public, s-maxage=30, stale-while-revalidate=120');
    if (json) { res.setHeader('content-type', 'application/json; charset=utf-8'); res.status(200).json(p); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.status(200).send(html(p));
  } catch (e) {
    res.setHeader('cache-control', 'no-store');
    res.status(502).json({ error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
  }
}
