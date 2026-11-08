// What pressing E does at a place: walk through a door, start a hall game, or open the place's panel.
import { openPanel, type Prompt } from './play.ts';
import { enterRoom, leaveRoom } from './rooms.ts';
import { startGame } from '../games/host.ts';
import { say, scribes } from './missions.ts';

export function act(p: Prompt) {
  if (p.panel === 'enter') return enterRoom(p.house!);
  if (p.panel === 'leave') return leaveRoom();
  if (p.panel === 'game') return startGame(p.house!);
  if (p.panel === 'scribes') return say(scribes());
  openPanel(p);
}
