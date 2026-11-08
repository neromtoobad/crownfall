// Driving your own house's chariot in a race at the Hippodrome: taking the reins, the inputs, and what happens at the end.
import { HOUSES } from './layout.ts';
import { flags, note, ledger } from './ledger.ts';
import { STABLES } from './places.ts';
import { emitPlay, me, play } from './play.ts';
import { crack, live, setDriver, setWatch, standings, steer, type Race } from './race.ts';

const nth = (n: number) => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th');

function backToStables() {
  play.racing = false;
  me.x = STABLES[0]; me.z = STABLES[1] - 6; me.speed = 0;
  me.car.x = STABLES[0] + 10; me.car.z = STABLES[1] - 4; me.car.v = 0;
  if (live.watch) setWatch(false);
  emitPlay();
}

/** Take the reins of your house's team: this race if it is still parading, else the next one (watch this one meanwhile). */
export function startDrive() {
  const h = play.seat!.house;
  play.racing = true; play.driving = false;
  setDriver(h);
  if (live.race.driver !== h) setWatch(true);
  live.onEnd = (r: Race) => {
    const place = standings(r).findIndex((ru) => ru.house === h) + 1;
    const moves = r.moves.filter((m) => m.house === h).length, whips = r.whips.filter((w) => w.by === 'you').length;
    flags.race = { place, house: h, t: Date.now() };
    note(`You drove House ${HOUSES[h].name} to ${nth(place)} in ${r.cup.name} (race ${r.n}, ${moves} lane changes, ${whips} whips; seed ${r.seed}).`, h);
    live.onEnd = undefined;
    backToStables();
  };
  emitPlay();
}

export function leaveRace() {
  setDriver(undefined);
  live.onEnd = undefined;
  backToStables();
}

/** Keys while racing. Returns true if the key was used. */
export function raceKey(k: string) {
  const h = play.seat!.house;
  if (k === 'escape') { leaveRace(); return true; }
  if (live.race.driver !== h) return false;
  if (k === 'a' || k === 'arrowleft') { steer(-1); return true; }
  if (k === 'd' || k === 'arrowright') { steer(1); return true; }
  if (k === ' ' && crack()) {
    // Each whip burns 10 of your house coin from the practice purse, if you hold any.
    const burn = Math.min(10, ledger.held[h]);
    if (burn > 0) { ledger.held[h] -= burn; ledger.supply[h] -= burn; }
    emitPlay();
    return true;
  }
  return false;
}

if (import.meta.env.DEV) Object.assign(window, { __drive: { startDrive, leaveRace } });
