// Phones play sideways. Held upright, the realm waits behind this card until the phone turns (or, where the browser
// allows it, a tap turns it for you: full screen, locked to landscape).
import { useSyncExternalStore } from 'react';
import { TOUCH, goLandscape } from './realm/play.ts';

const mq = typeof window !== 'undefined' ? matchMedia('(orientation: portrait)') : undefined;
const sub = (f: () => void) => { mq?.addEventListener('change', f); window.addEventListener('resize', f); return () => { mq?.removeEventListener('change', f); window.removeEventListener('resize', f); }; };
const canLock = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen && !!(screen.orientation as { lock?: unknown } | undefined)?.lock;

export function Rotate() {
  const portrait = useSyncExternalStore(sub, () => !!mq?.matches);
  if (!TOUCH || !portrait) return null;
  return (
    <div className="rotate" role="dialog" aria-label="Turn your phone sideways">
      <div className="rotate-phone"><i /></div>
      <b>Turn your phone sideways</b>
      <span>Crownfall plays in landscape: the joystick goes under your left thumb, the buttons under your right.</span>
      {canLock && <button onClick={goLandscape}>Go full screen</button>}
    </div>
  );
}
