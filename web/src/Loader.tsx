// The loading screen: the title and a bar while the land comes in. It lifts as soon as the ground and the keeps are
// ready; people and props keep arriving behind it, so nobody waits for the last peasant.
import { useEffect, useState } from 'react';
import { useProgress } from '@react-three/drei';
import { useBoot } from './realm/play.ts';

const LINES = ['Raising the keeps', 'Filling the river', 'Planting the forests', 'Saddling the horses', 'Lighting the halls'];

export function Loader() {
  const ready = useBoot();
  const { loaded, total } = useProgress();
  const [gone, setGone] = useState(false);
  const [line, setLine] = useState(0);
  useEffect(() => { if (!ready) return; const t = setTimeout(() => setGone(true), 700); return () => clearTimeout(t); }, [ready]);
  useEffect(() => { const i = setInterval(() => setLine((n) => (n + 1) % LINES.length), 1600); return () => clearInterval(i); }, []);
  if (gone) return null;
  // The bar never runs backwards while new files join the queue.
  const pct = ready ? 100 : total ? Math.min(96, Math.round((loaded / total) * 100)) : 4;
  return (
    <div className={`loader ${ready ? 'out' : ''}`} role="status" aria-live="polite">
      <div className="loader-in">
        <div className="loader-mark">Crownfall</div>
        <div className="loader-sub">The realm of Vael</div>
        <div className="loader-bar"><i style={{ width: `${Math.max(pct, Loader.last = Math.max(Loader.last, pct))}%` }} /></div>
        <div className="loader-line">{ready ? 'Enter' : `${LINES[line]}…`}</div>
      </div>
    </div>
  );
}
Loader.last = 0;
