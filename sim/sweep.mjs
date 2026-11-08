// Runs 12 ages per variant and averages the results.   node sim/sweep.mjs
import { execFileSync } from 'node:child_process';
const V = {
  'old rules': ['--no-temples', '--no-loyalty', '--fade=0', '--alms=0'],
  'fade 1%, no alms': ['--alms=0'],
  'chosen: fade 1%, alms 25%': [],
  'fade 1%, alms 50%': ['--alms=0.5'],
};
for (const [name, flags] of Object.entries(V)) {
  const rows = Array.from({ length: 12 }, (_, i) => JSON.parse(execFileSync('node', ['sim/age.mjs', String(i + 1), '--quiet', ...flags], { encoding: 'utf8' }).trim().split('\n').pop()));
  const avg = (k) => +(rows.reduce((a, r) => a + (r[k] ?? 0), 0) / rows.length).toFixed(2);
  console.log(name.padEnd(38), JSON.stringify(Object.fromEntries(['survivors', 'pool', 'median', 'profitable', 'loyal', 'chaser', 'smiter', 'holder', 'templeLeft', 'templeSpent', 'works', 'bounties', 'schisms', 'burnToMint'].map((k) => [k, avg(k)]))));
}
