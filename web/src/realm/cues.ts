// Small sounds and voices that follow what you do, watched from one place so the scenes don't have to call them:
// a door when you step into or out of a hall, a page when a book opens, a click on any panel button, and the Mint
// clerk's word on the market when you walk up to the counter (at most once every few minutes).
import { play } from './play.ts';
import { chain } from '../chain/near.ts';
import { click, door, page } from './sound.ts';
import { hasEvent, playVoice } from './vo.ts';
import { bark } from './barks.ts';
import { HOUSES } from './layout.ts';

const CLERK: Record<string, string> = {
  'mint.calm': 'Fair prices today, my lord. Nobody’s rushing anything.',
  'mint.dear': 'Everyone’s buying today. Coin’s dear, my lord. Mind what you pay.',
  'mint.cheap': 'They’ve been selling all morning. Some coin’s going cheap.',
  'mint.shut': 'A house has shut its doors, my lord. A run, they say. Buy in and you reopen it.',
};
let clerkAt = -1e9, lastClerk = '';

/** What the clerk says, from the houses' markets on chain (or plain small talk off chain). */
function clerkLine() {
  const hs = chain.realm?.houses ?? [];
  const f = hs.map((h) => h.market?.factor ?? 10_000);
  if (hs.some((h) => h.market?.shut)) return 'mint.shut';
  if (f.length && Math.max(...f) >= 11_500) return 'mint.dear';
  if (f.length && Math.min(...f) <= 9_000) return 'mint.cheap';
  return 'mint.calm';
}

function clerk() {
  const now = performance.now() / 1000;
  if (now - clerkAt < 180) return;
  clerkAt = now;
  let id = clerkLine();
  // Calm twice running is dull: skip it the second time.
  if (id === 'mint.calm' && lastClerk === 'mint.calm') return;
  lastClerk = id;
  if (!hasEvent(id)) id = 'mint.calm';
  bark.text = CLERK[id]; bark.who = 'The Mint clerk'; bark.at = now;
  setTimeout(() => void playVoice(id, { gain: 0.8 }), 250);
}

let inside = play.inside, panel = '';
function watch() {
  if (play.inside !== inside) { if (play.mode === 'play') door(); inside = play.inside; }
  const p = play.panel?.panel ?? '';
  if (p !== panel) {
    if (p === 'seals' || p === 'library') page();
    if (p === 'mint') clerk();
    panel = p;
  }
}

if (typeof window !== 'undefined') {
  setInterval(watch, 120);
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement | null)?.closest?.('button');
    if (b && !b.disabled && b.closest('.panel, .pause, .seat-picker')) click();
  }, true);
}

