// The game in the 3D scene: while a card is up the camera eases to the game's view; during a round the game's own
// Play component runs (and may move the camera itself). The DOM side is GameHud.
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { usePlay } from '../realm/play.ts';
import { endRound, gameDef, session, tickCards } from './host.ts';
import './index.ts';

const pos = new THREE.Vector3(), look = new THREE.Vector3(), lookNow = new THREE.Vector3();

export function GameStage() {
  const p = usePlay();
  const room = session.room;
  const def = room && gameDef(room.game);
  const started = useRef(false);
  useFrame(({ camera }, dt) => {
    if (!p.game || !room || !def) { started.current = false; return; }
    tickCards();
    if (session.phase === 'play') return;
    const v = def.view(room);
    pos.set(room.x + v.pos[0], v.pos[1], room.z + v.pos[2]);
    look.set(room.x + v.look[0], v.look[1], room.z + v.look[2]);
    if (!started.current) { lookNow.copy(look); started.current = true; }
    const k = 1 - Math.exp(-dt * 3);
    camera.position.lerp(pos, k);
    lookNow.lerp(look, k);
    camera.lookAt(lookNow);
    const pc = camera as THREE.PerspectiveCamera;
    if (Math.abs(pc.fov - 50) > 0.1) { pc.fov += (50 - pc.fov) * k; pc.updateProjectionMatrix(); }
  });
  if (!p.game || !room || !def || session.phase !== 'play') return null;
  return <group position={[room.x, 0, room.z]}><def.Play key={session.round} room={room} end={endRound} /></group>;
}
