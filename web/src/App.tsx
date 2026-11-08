import { Suspense, useState } from 'react';
import { Realm, type Focus } from './realm/Realm.tsx';
import { March, Promenade, Travellers, type MarchOrder } from './realm/People.tsx';
import { EnvViewer, Viewer } from './Viewer.tsx';
import { Arena } from './realm/Race.tsx';
import { RaceHud } from './RaceHud.tsx';
import { useRace } from './realm/race.ts';
import { NearMark, NearPill } from './NearMark.tsx';
import { CAPITAL, HOUSES } from './realm/layout.ts';
import { PlayerWorld } from './realm/Player.tsx';
import { Outdoors } from './realm/Realm.tsx';
import { StoryWorld } from './realm/Story.tsx';
import { PlayHud } from './PlayHud.tsx';
import { setMode, usePlay } from './realm/play.ts';
import { ledger } from './realm/ledger.ts';

const DEMO_MARCH: MarchOrder = { id: 'demo', from: 1, to: 2, started: 0 };

export function App() {
  // The model viewers (?view=, ?env=) are tools for building the game, not part of it.
  const q = new URLSearchParams(location.search), view = import.meta.env.DEV && q.get('view'), env = import.meta.env.DEV && q.get('env');
  if (env) return <div className="app"><Suspense fallback={null}><EnvViewer name={env} /></Suspense></div>;
  if (view) return <div className="app"><Viewer name={view} /></div>;
  return <Game />;
}

function Game() {
  const [focus, setFocus] = useState<Focus>();
  const [picked, setPicked] = useState<number | 'capital'>();
  const pick = (k: number | 'capital') => {
    setPicked(k);
    const [x, z] = k === 'capital' ? CAPITAL.pos : HOUSES[k].pos;
    setFocus({ x: x + (k === 'capital' ? 30 : 0), z, dist: k === 'capital' ? 260 : 150 });
  };
  const watching = useRace().watch;
  const mode = usePlay().mode;
  const h = typeof picked === 'number' && !watching && mode === 'map' ? HOUSES[picked] : undefined;
  return (
    <div className="app">
      <Realm focus={focus} onPick={pick}>
        <Outdoors>
        <Travellers url="/models/peasant-m.glb" count={22} followable />
        <Travellers url="/models/peasant-f.glb" count={18} />
        <Travellers url="/models/soldier.glb" count={8} />
        {HOUSES.map((h) => <Promenade key={h.id} house={h.id} url={`/models/${h.lord}.glb`} />)}
        <March url="/models/soldier.glb" order={DEMO_MARCH} ranks={8} />
        {ledger.marches.map((m) => <March key={m.id} url="/models/soldier.glb" order={m} ranks={6} />)}
        <Arena />
        </Outdoors>
        <PlayerWorld />
        <StoryWorld />
      </Realm>
      {mode === 'map' && <RaceHud />}
      <PlayHud />
      {mode !== 'play' && <header className="top">
        <div className="mark">Crownfall</div>
        <div className="sub">The realm of Vael · eight houses · one Ashen Throne</div>
        <NearPill />
        <div className="top-actions">
          {mode === 'map' && <button className="ghost" onClick={() => { setPicked(undefined); setFocus({ x: 0, z: 60, dist: 980 }); }}>The whole realm</button>}
          <button className="seat-btn" onClick={() => setMode('play')}>Take your seat</button>
        </div>
      </header>}
      {h && (
        <aside className="card" style={{ ['--c' as string]: h.colors[0], ['--c2' as string]: h.colors[1] }}>
          <div className="eyebrow">{h.seat} · {h.land}</div>
          <h1>House {h.name}</h1>
          <p className="sigil">{h.sigil} · <span className="coin"><NearMark size={12} />${h.coin}</span></p>
        </aside>
      )}
    </div>
  );
}
