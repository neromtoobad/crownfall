// One age of Pantheon: 8 valleys, 40 players, 288 seasons (a day at 5 minutes a season).
// Tribe-level world, the same rules the contract will run, now with temples (each congregation's DAO
// treasury), elders, bounties, works and schisms.
//   node sim/age.mjs [seed] [--quiet] [--no-temples] [--no-loyalty]
const seed = Number(process.argv[2] ?? 7);
const quiet = process.argv.includes('--quiet');
const TEMPLES = !process.argv.includes('--no-temples');
const LOYALTY = !process.argv.includes('--no-loyalty');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split('=')[1]) : d; };

let s = seed >>> 0;
const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// The rules (what the contract fixes at launch).
const P = {
  seasons: 288,
  mintPerBeliever: 0.06,   // FAITH minted per believer per season, paid to this age's devotees by devotion, never to holders
  tradeFee: 0.05,          // of every buy and sell: 3 points to the god's reserve, 1 to its temple, 1 to the offering pool
  feeToTemple: 0.01,
  feeToPool: 0.01,
  fadeBelow: 5,            // a tribe under 5 people is gone, and its god fades
  deadToPool: 0.5,         // a dead god's NEAR: half to the offering pool, half to whoever took its people
  founding: 1,             // NEAR a founder puts in; the first FAITH is 100 per NEAR
  loyalty: 2,              // devotion counts double when cast for a god that isn't leading
  elders: 7,               // seats, re-ranked by devotion every season
  schismShare: 1 / 3,      // share of the elders' devotion needed to split
  works: { granary: 0.4, walls: 0.6, shrine: 0.8 }, // NEAR from the temple
  idleAfter: 24,           // seasons without casting for a god before its faith in your hands starts to fade
  idleFade: arg('fade', 0.01), // share of idle faith that fades each season; its NEAR moves to the temple, so the price doesn't move
  burnToTemple: arg('burn', 0), // share of the NEAR behind burned faith that moves from the reserve to the temple
  bounty: 0.03,
  alms: arg('alms', 0.25),  // every 24 seasons the elders give this share of a temple over 1 NEAR to devotees, by devotion            // NEAR per smite on the named rival, paid by the temple
};
const M = { // miracles: FAITH cost (rises 25% each time the same god casts it in a season)
  rain: { cost: 2, own: true }, harvest: { cost: 5, own: true }, heal: { cost: 4, own: true },
  festival: { cost: 3, own: true }, prophet: { cost: 8, own: true }, titan: { cost: 60, own: true },
  lightning: { cost: 6, own: false }, plague: { cost: 15, own: false },
};

const names = ['Reed', 'Ember', 'Tide', 'Ash', 'Moth', 'Stone', 'Gale', 'Thorn'];
const newGod = (name, v, o = {}) => ({
  name, v, R: P.founding, S: 100, pop: 60 + Math.floor(rnd() * 30), food: 40, morale: 0.7, devotion: 0.8,
  army: 0, titan: 0, land: 250 + Math.floor(rnd() * 100), alive: true, minted: 0, burned: 0, taken: {}, casts: {}, weather: 1,
  temple: 0, works: {}, bountyOn: null, ...o,
});
const gods = names.map((n, v) => newGod(n, v));
const valley = gods.map((g) => g);            // valley index -> god living there (dead gods stay until a schism takes the valley)
const live = () => gods.filter((g) => g.alive);
const near = (g) => [valley[(g.v + 1) % 8], valley[(g.v + 7) % 8]].filter((x) => x && x.alive);
const price = (g) => g.R / g.S;
const believers = (g) => g.pop * g.devotion;
let pool = 0;
const stats = { alms: 0, faded: 0, schisms: [], works: 0, bounties: 0, bountyPaid: 0, templeSpent: 0 };

// Players: loyal (one god), chasers (buy what's rising), smiters (hostile) and holders (buy the leader, never cast). 10 NEAR each.
const players = Array.from({ length: 40 }, (_, k) => ({
  k, near: 10, start: 10, kind: k < 18 ? 'loyal' : k < 32 ? 'chaser' : k < 36 ? 'smiter' : 'holder',
  bag: {}, devotion: {}, last: {}, home: names[k % 8], active: 0.25 + rnd() * 0.6,
}));
const bag = (p, g) => p.bag[g.name] ?? 0;
const dev = (p, g) => p.devotion[g.name] ?? 0;

function buy(p, g, nearIn) {
  nearIn = Math.min(nearIn, p.near); if (nearIn <= 0 || !g.alive) return;
  const fee = nearIn * P.tradeFee; const net = nearIn - fee;
  const got = net / price(g);
  p.near -= nearIn; g.R += net + fee - fee * (P.feeToPool + P.feeToTemple) / P.tradeFee;
  pool += fee * P.feeToPool / P.tradeFee; g.temple += TEMPLES ? fee * P.feeToTemple / P.tradeFee : 0; if (!TEMPLES) g.R += fee * P.feeToTemple / P.tradeFee;
  g.S += got; p.bag[g.name] = bag(p, g) + got;
}
function sell(p, g, amt) {
  amt = Math.min(amt, bag(p, g)); if (amt <= 0 || !g.alive) return;
  const gross = amt * price(g); const fee = gross * P.tradeFee;
  p.bag[g.name] -= amt; g.S -= amt; g.R -= gross - fee + fee * (P.feeToPool + P.feeToTemple) / P.tradeFee;
  pool += fee * P.feeToPool / P.tradeFee; g.temple += TEMPLES ? fee * P.feeToTemple / P.tradeFee : 0; if (!TEMPLES) g.R += fee * P.feeToTemple / P.tradeFee;
  p.near += gross - fee;
}
let leader = null; let T = 0;
function cast(p, g, target, m) {
  const n = g.casts[m] ?? 0; const cost = M[m].cost * 1.25 ** n;
  if (bag(p, g) < cost || !target.alive) return false;
  const backing = cost * price(g) * P.burnToTemple; g.R -= backing; g.temple += backing;
  p.bag[g.name] -= cost; g.S -= cost; g.burned += cost; g.casts[m] = n + 1; p.last[g.name] = T;
  p.devotion[g.name] = dev(p, g) + cost * (LOYALTY && g !== leader ? P.loyalty : 1);
  if (m === 'rain') target.weather = Math.max(target.weather, 1.15);
  if (m === 'harvest') target.food += target.pop * 0.4;
  if (m === 'heal') target.pop += 2;
  if (m === 'festival') target.morale = Math.min(1, target.morale + 0.06);
  if (m === 'prophet') target.devotion = Math.min(1, target.devotion + 0.05);
  if (m === 'titan') target.titan = 12;
  if (m === 'lightning') target.food = Math.max(0, target.food - target.pop * 0.3);
  if (m === 'plague') { target.pop = Math.max(0, target.pop * 0.9 - 2); target.morale -= 0.05; }
  if (!M[m].own && g.bountyOn === target && g.temple >= P.bounty) { g.temple -= P.bounty; p.near += P.bounty; stats.bounties++; stats.bountyPaid += P.bounty; stats.templeSpent += P.bounty; }
  return true;
}
const elders = (g) => players.filter((p) => dev(p, g) > 0).sort((a, b) => dev(b, g) - dev(a, g)).slice(0, P.elders);

// The elders' simple policy for temple money (players vote; this is what a sensible council does).
function templeVotes(g) {
  g.bountyOn = null;
  const ns = near(g);
  const threat = ns.sort((a, b) => b.army - a.army)[0];
  const build = (w) => { if (!g.works[w] && g.temple >= P.works[w]) { g.temple -= P.works[w]; g.works[w] = true; stats.works++; stats.templeSpent += P.works[w]; return true; } return false; };
  if (P.alms && T % 24 === 0 && g.temple > 1) {
    const gift = (g.temple - 1) * P.alms; const tot = players.reduce((a, p) => a + dev(p, g), 0);
    if (tot > 0) { for (const p of players) p.near += gift * dev(p, g) / tot; g.temple -= gift; stats.alms += gift; stats.templeSpent += gift; }
  }
  if (g.food >= g.pop * 1.9 && build('granary')) return;
  if (threat && threat.army > g.army * 1.2 && build('walls')) return;
  if (g.devotion < 0.6 && build('shrine')) return;
  const big = ns.sort((a, b) => b.pop - a.pop)[0];
  if (big && big.pop > g.pop * 1.25 && g.temple >= 0.3) g.bountyOn = big;
}

// Schism: when a big, unhappy tribe's lower elders hold a third of the elders' devotion and a valley is empty.
function schism(g, t) {
  const empty = valley.findIndex((x) => !x || !x.alive); if (empty < 0) return;
  const el = elders(g); if (el.length < 4) return;
  const split = el.slice(3); // the four junior elders
  const d = split.reduce((a, p) => a + dev(p, g), 0) / el.reduce((a, p) => a + dev(p, g), 0);
  if (d < P.schismShare) return;
  // The schismatics take the NEAR behind their own coins (so the price for those who stay doesn't move),
  // and a share of the people and the temple equal to their share of the elders' devotion.
  const faith = split.reduce((a, p) => a + bag(p, g), 0); if (faith <= 0) return;
  const R = faith * price(g);
  const ng = newGod(`${g.name}·${t}`, empty, { R, S: faith, pop: g.pop * d, food: g.food * d, land: 220, morale: 0.8, devotion: g.devotion, temple: g.temple * d });
  g.R -= R; g.S -= faith; g.pop -= ng.pop; g.food -= ng.food; g.temple -= ng.temple;
  for (const p of split) { p.bag[ng.name] = bag(p, g); p.bag[g.name] = 0; p.devotion[ng.name] = dev(p, g); p.devotion[g.name] = 0; p.home = ng.name; }
  gods.push(ng); valley[empty] = ng;
  stats.schisms.push({ t, from: g.name, share: +d.toFixed(2), people: Math.round(ng.pop) });
  if (!quiet) console.log(`  season ${t}: schism in ${g.name}, ${Math.round(ng.pop)} people follow ${ng.name}`);
}

function season(t) {
  T = t;
  // Idle faith fades: faith held by anyone who hasn't cast for that god lately loses a share each season.
  for (const g of live()) for (const p of players) {
    const b = bag(p, g); if (b <= 0 || t - (p.last[g.name] ?? -99) <= P.idleAfter) continue;
    const f = b * P.idleFade; const backing = f * price(g); p.bag[g.name] -= f; g.S -= f; g.R -= backing; g.temple += backing; stats.faded += f;
  }
  for (const g of gods) { g.casts = {}; g.weather = 0.85 + rnd() * 0.3; }
  leader = [...live()].sort((a, b) => believers(b) - believers(a))[0];
  if (TEMPLES) for (const g of live()) templeVotes(g);
  // Players act.
  for (const p of players) {
    if (rnd() > p.active) continue;
    const L = live(); if (!L.length) return;
    if (p.kind === 'holder') { if (t % 24 === 1) { const best = [...L].sort((a, b) => believers(b) - believers(a))[0]; for (const g of L) if (g !== best) sell(p, g, bag(p, g)); buy(p, best, p.near); } continue; }
    let mine = gods.find((g) => g.name === p.home);
    if (p.kind === 'loyal' && !mine.alive) { mine = L[Math.floor(rnd() * L.length)]; p.home = mine.name; }
    if (p.kind === 'chaser' && t % 12 === 0) {
      // Move money towards the god with the most believers, away from the weakest it holds.
      const best = [...L].sort((a, b) => believers(b) - believers(a))[0];
      for (const g of L) if (g !== best && bag(p, g) > 0 && g.pop < best.pop * 0.6) sell(p, g, bag(p, g));
      buy(p, best, p.near * 0.5); p.home = best.name; mine = best;
    }
    if (!mine.alive) { mine = L[Math.floor(rnd() * L.length)]; p.home = mine.name; }
    if (bag(p, mine) < 5 && p.near > 0.5) buy(p, mine, Math.min(bag(p, mine) === 0 ? 2 : 0.5, p.near * 0.3));
    // Answer prayers: what the tribe needs most.
    const need = mine.food < mine.pop * 0.3 ? (rnd() < 0.5 ? 'harvest' : 'rain') : mine.morale < 0.55 ? 'festival'
      : mine.devotion < 0.7 ? 'prophet' : rnd() < 0.3 ? 'heal' : 'rain';
    cast(p, mine, mine, need);
    const rival = mine.bountyOn ?? near(mine).sort((a, b) => b.pop - a.pop)[0];
    const smite = p.kind === 'smiter' ? 0.6 : mine.bountyOn ? 0.3 : 0.1;
    if (rival && rnd() < smite) cast(p, mine, rival, rnd() < 0.25 ? 'plague' : 'lightning');
    if (rival && mine.pop < rival.pop * 0.8 && rnd() < 0.05) cast(p, mine, mine, 'titan');
  }
  // The world moves (contract's season()).
  for (const g of live()) {
    g.food += Math.min(g.pop, g.land) * 1.02 * g.weather - g.pop;
    if (g.food < 0) { g.pop += g.food * 0.4; g.food = 0; g.morale -= 0.04; } else g.morale += 0.01;
    g.food = Math.min(g.food, g.pop * (g.works.granary ? 3 : 2));
    g.pop += g.pop * 0.018 * g.morale * (g.food > g.pop * 0.3 ? 1 : 0.2) - g.pop * 0.008;
    g.morale = Math.max(0, Math.min(1, g.morale)); g.devotion = Math.max(0.2, g.devotion - (g.works.shrine ? 0.002 : 0.004));
    g.army = g.pop * 0.2 * (g.titan > 0 ? 3 : 1); if (g.titan) g.titan--;
  }
  // Missionaries: the happier, more devout tribe converts its neighbours' unhappy people.
  for (const g of live()) for (const n of near(g)) {
    const pull = (g.morale * g.devotion - n.morale * n.devotion);
    if (pull > 0.05) { const c = n.pop * 0.03 * pull; n.pop -= c; g.pop += c; g.taken[n.name] = (g.taken[n.name] ?? 0) + c; }
  }
  // Wars: a chief attacks a weaker neighbour when it is clearly stronger (walls make a defender count 1.5x).
  const def = (x) => x.army * (x.works.walls ? 1.5 : 1);
  for (const g of live()) {
    const n = near(g).sort((a, b) => def(a) - def(b))[0];
    if (!n || g.army < def(n) * 1.4 || rnd() > 0.15) continue;
    const win = rnd() < g.army / (g.army + def(n));
    const [w, l] = win ? [g, n] : [n, g];
    const lost = l.pop * 0.12; l.pop -= lost; w.pop += lost * 0.5; const ground = l.land * 0.08; l.land -= ground; w.land += ground; w.taken[l.name] = (w.taken[l.name] ?? 0) + lost;
    l.morale -= 0.1; w.morale = Math.min(1, w.morale + 0.05);
  }
  // Mint to devotees, by devotion.
  for (const g of live()) {
    const mint = believers(g) * P.mintPerBeliever; const tot = players.reduce((a, p) => a + dev(p, g), 0);
    if (tot > 0) { for (const p of players) p.bag[g.name] = bag(p, g) + mint * dev(p, g) / tot; g.S += mint; g.minted += mint; }
  }
  // Schisms, then fades.
  if (TEMPLES) for (const g of live()) if (g.pop > 90 && g.morale < 0.7 && rnd() < 0.05) schism(g, t);
  for (const g of live().filter((g) => g.pop < P.fadeBelow)) {
    g.alive = false; pool += g.R * P.deadToPool;
    const heirs = live().filter((x) => x.taken[g.name]); const sum = heirs.reduce((a, x) => a + x.taken[g.name], 0);
    for (const x of heirs) x.R += g.R * (1 - P.deadToPool) * x.taken[g.name] / sum;
    if (!heirs.length) pool += g.R * (1 - P.deadToPool);
    if (!quiet) console.log(`  season ${t}: ${g.name} fades (${g.R.toFixed(2)} NEAR released, temple keeps ${g.temple.toFixed(2)})`);
    g.R = 0;
  }
}

for (let t = 1; t <= P.seasons; t++) season(t);

// Crowning: the god with the most believers. Its devotees split the offering pool by devotion.
const L = live().sort((a, b) => believers(b) - believers(a));
const crown = L[0];
const devTot = players.reduce((a, p) => a + dev(p, crown), 0);
for (const p of players) p.near += pool * dev(p, crown) / devTot;
const worth = (p) => p.near + gods.reduce((a, g) => a + (g.alive ? bag(p, g) * price(g) * (1 - P.tradeFee) : 0), 0);
const pnl = players.map((p) => worth(p) - p.start).sort((a, b) => a - b);
const byKind = (k) => { const x = players.filter((p) => p.kind === k).map((p) => worth(p) - p.start); return +(x.reduce((a, b) => a + b, 0) / x.length).toFixed(2); };
const temples = gods.reduce((a, g) => a + g.temple, 0);

const out = {
  seed, survivors: L.map((g) => g.name), crowned: crown?.name, pool: +pool.toFixed(2),
  temples: { left: +temples.toFixed(2), spent: +stats.templeSpent.toFixed(2), works: stats.works, bounties: stats.bounties },
  schisms: stats.schisms,
  gods: gods.map((g) => ({ god: g.name, alive: g.alive, pop: Math.round(g.pop), price: g.alive ? +(price(g) / 0.01).toFixed(2) : 0, temple: +g.temple.toFixed(2), works: Object.keys(g.works) })),
  players: { median: +pnl[20].toFixed(2), profitable: pnl.filter((x) => x > 0).length, loyal: byKind('loyal'), chaser: byKind('chaser'), smiter: byKind('smiter'), holder: byKind('holder') },
};
if (quiet) console.log(JSON.stringify({ seed, survivors: L.length, crowned: out.crowned, pool: out.pool, median: out.players.median, profitable: out.players.profitable, loyal: out.players.loyal, chaser: out.players.chaser, smiter: out.players.smiter, holder: out.players.holder, templeLeft: out.temples.left, templeSpent: out.temples.spent, works: out.temples.works, bounties: out.temples.bounties, schisms: stats.schisms.length, burnToMint: +(gods.reduce((a, g) => a + g.burned, 0) / gods.reduce((a, g) => a + g.minted, 0)).toFixed(2) }));
else console.log(JSON.stringify(out, null, 1));
