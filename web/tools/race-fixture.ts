// Writes chain/tests/race-fixture.json: races run by the browser's sim (raceSim.ts), which the contract's tests
// replay with sim.rs and must match to the bit. Run: node tools/race-fixture.ts
import { writeFileSync } from 'node:fs';
import { newRace, standings, tick } from '../src/realm/raceSim.ts';

const cases: { seed: number; laps: number; whips: [number, number][] }[] = [];
let x = 12345;
const next = () => (x = (Math.imul(x, 1103515245) + 12345) >>> 0);
for (let i = 0; i < 40; i++) {
  const whips: [number, number][] = [];
  const k = i % 4 === 0 ? 0 : next() % 9;
  for (let j = 0; j < k; j++) whips.push([1 + (next() % 400), next() % 8]);
  cases.push({ seed: next(), laps: [1, 2, 3][i % 3], whips });
}
const out = cases.map((c) => {
  const r = newRace(0, c.seed, c.laps);
  for (const [t, h] of c.whips) r.whips.push({ tick: t, house: h, by: 'you' });
  while (r.phase !== 'done' && r.tick < 1800) tick(r);
  return { ...c, ticks: r.tick, order: standings(r).map((ru) => ru.house), lanes: r.runners.map((ru) => ru.lane), finish: r.runners.map((ru) => ru.finish ?? null) };
});
writeFileSync(new URL('../../chain/tests/race-fixture.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(`${out.length} races; first: order ${out[0].order.join(',')} in ${out[0].ticks} ticks`);
