// The race caller at the Mumtaz Hippodrome: a voice over the crowd that follows the race actually being run (the
// practice race, or the contract's when one is on the track). Riders to the line as the off nears, the off, the whips,
// the last lap, and the house that takes the cup. Only within earshot: at the Hippodrome, driving in it, or watching.
import { live, toOff } from './race.ts';
import { me, play } from './play.ts';
import { HIPPODROME } from './layout.ts';
import { hasEvent, playVoice } from './vo.ts';
import { crowd } from './sound.ts';
import { bark, town } from './barks.ts';

const said = new Set<string>();
let raceKey = '', wonKey = '';

function call(id: string, text: string, opts: { roar?: number } = {}) {
  if (said.has(id)) return;
  said.add(id);
  if (opts.roar) crowd(opts.roar, 1);
  bark.text = text; bark.who = 'The race caller'; bark.at = performance.now() / 1000;
  if (hasEvent(id.split('#')[0])) void playVoice(id.split('#')[0], { gain: 0.85 });
}

function tick() {
  const r = live.race;
  // The town hears who won whether or not you were there.
  const fin = r.runners.filter((x) => x.finish !== undefined).sort((a, b) => a.finish! - b.finish!);
  if (fin.length && wonKey !== `${r.n}:${r.seed}`) { wonKey = `${r.n}:${r.seed}`; town.lastWin = fin[0].house; town.lastWinAt = performance.now() / 1000; }
  const near = play.mode === 'play' && Math.hypot(me.x - HIPPODROME.pos[0], me.z - HIPPODROME.pos[1]) < 150;
  if (!(near || play.racing || live.watch) || play.game) return;
  const key = `${r.n}:${r.seed}`;
  if (key !== raceKey) {
    raceKey = key; said.clear();
    // Walking in on a race already under way: don't call what has already happened.
    if (r.phase !== 'parade') { said.add('race.line'); said.add('race.off'); if (r.t > 7) said.add('race.whips'); }
    if (r.runners.some((x) => x.finish !== undefined)) { said.add('race.last'); said.add('win'); }
  }
  const laps = r.cup.laps;
  if (r.phase === 'parade') {
    const left = toOff(r);
    if (left < 10 && left > 1) call('race.line', `Riders, to the line! Eight houses, one cup: ${r.cup.name}.`);
    return;
  }
  if (r.phase === 'run' || r.phase === 'done') {
    call('race.off', 'And they’re off!', { roar: 3 });
    if (r.t > 7) call('race.whips', 'Whips out! Here comes the rush!');
    const lead = Math.max(...r.runners.map((x) => x.p));
    if (laps > 1 && lead >= laps - 1 && lead < laps) call('race.last', 'Last lap! Hold nothing back!', { roar: 2 });
    const done = r.runners.filter((x) => x.finish !== undefined).sort((a, b) => a.finish! - b.finish!);
    if (done.length && !said.has('win')) {
      said.add('win');
      const win = done[0], close = done.length > 1 && done[1].finish! - win.finish! < 0.35;
      const name = ['Ashveil', 'Corrin', 'Velmont', 'Thorne', 'Halloway', 'Draven', 'Marrow', 'Sorrel'][win.house];
      crowd(4, 1.2);
      if (close) {
        call('race.close', 'At the line, and it’s close!');
        setTimeout(() => call(`race.win.${win.house}`, `House ${name} takes the cup!`), 1600);
      } else call(`race.win.${win.house}`, `House ${name} takes the cup!`);
    }
  }
}

if (typeof window !== 'undefined') setInterval(tick, 200);
