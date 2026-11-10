// Liar's Dice with Haseeb Qureshi, at the round table under the Library's dome. Five dice each under a leather cup;
// you see only your own. Take turns bidding on how many of one face lie under BOTH cups ("three fives"): each bid
// must be higher (more dice, or as many of a higher face). Or call the last bid a lie: both cups come up, and whoever
// was wrong loses a die. First to lose all five loses. No wilds. Haseeb plays the odds, and bluffs a little.
//
// On NEAR the table is one wager the contract settles itself, so a win can't be reported by the browser: your five
// dice are rolled on chain in the block that takes your stake, you make one bid, and Haseeb's five are rolled from the
// block that takes it. If both cups show at least that many of the face, the contract pays fair odds less 5% from the
// Library's bank; if not, the stake goes to the bank.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { burst, voice } from '../realm/sound.ts';
import type { Room } from '../realm/rooms.ts';
import { usePlay } from '../realm/play.ts';
import { gameKeys, gameUi, register, session, type Result } from './host.ts';
import { LIB_STAKE, bidLibrary, libChance, libPays, library } from '../chain/game.ts';
import { units } from '../chain/near.ts';

const TOP = 1.95;      // table height
const START = 5;       // dice each
const DIE = 0.27;
const SIDE = { you: 1, him: -1 } as const;
const CUP_Z = 0.95;
// Where the cards look from and at (the hall's frame); the round's camera hands back to this look at the end.
const VIEW = { pos: [0, TOP + 3.2, 4.6] as [number, number, number], look: [0, TOP, -0.4] as [number, number, number] };
const smooth = (x: number) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };

// ---- The pieces.
const cupGeo = (() => {
  // A leather dice cup, open end down: straight sides, a rolled lip and a stitched band.
  const pts = [[0, 0.86], [0.34, 0.86], [0.37, 0.83], [0.38, 0.7], [0.42, 0.12], [0.47, 0.05], [0.47, 0], [0.42, 0]].reverse().map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, 36); g.computeVertexNormals(); return g;
})();
const cupMat = new THREE.MeshStandardMaterial({ color: '#4a2a18', roughness: 0.72 });
const bandMat = new THREE.MeshStandardMaterial({ color: '#c9a24a', roughness: 0.35, metalness: 0.8 });
/** Faces in BoxGeometry order (+x, −x, +y, −y, +z, −z); opposite faces add to 7. */
const FACE_ORDER = [3, 4, 1, 6, 2, 5];
function faceTexture(n: number, hot: boolean) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 20, 64, 64, 92);
  grd.addColorStop(0, hot ? '#fff3c4' : '#efe6d2'); grd.addColorStop(1, hot ? '#e2b84a' : '#c9bca0');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(60, 40, 20, 0.35)'; g.lineWidth = 6; g.strokeRect(3, 3, 122, 122);
  const P: Record<number, [number, number][]> = {
    1: [[64, 64]], 2: [[36, 36], [92, 92]], 3: [[34, 34], [64, 64], [94, 94]], 4: [[36, 36], [92, 36], [36, 92], [92, 92]],
    5: [[34, 34], [94, 34], [64, 64], [34, 94], [94, 94]], 6: [[36, 30], [92, 30], [36, 64], [92, 64], [36, 98], [92, 98]],
  };
  g.fillStyle = n === 1 ? '#8f1d17' : '#1d140c';
  for (const [x, y] of P[n]) { g.beginPath(); g.arc(x, y, n === 1 ? 15 : 11, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const dieGeo = new THREE.BoxGeometry(DIE, DIE, DIE);
const dieMats = FACE_ORDER.map((n) => new THREE.MeshStandardMaterial({ map: faceTexture(n, false), roughness: 0.45 }));
const hotMats = FACE_ORDER.map((n) => new THREE.MeshStandardMaterial({ map: faceTexture(n, true), roughness: 0.35, emissive: new THREE.Color('#6a4a00'), emissiveIntensity: 0.55 }));
/** The rotation that puts face n on top. */
const UP: Record<number, [number, number, number]> = { 1: [0, 0, 0], 6: [Math.PI, 0, 0], 2: [-Math.PI / 2, 0, 0], 5: [Math.PI / 2, 0, 0], 3: [0, 0, Math.PI / 2], 4: [0, 0, -Math.PI / 2] };
/** Where the five dice sit under a cup. */
const SPOTS: [number, number][] = [[0, 0], [0.19, 0.12], [-0.18, 0.15], [0.1, -0.2], [-0.15, -0.17]];

function Table() {
  return (
    <group>
      <mesh position={[0, TOP - 0.09, 0]} castShadow receiveShadow><cylinderGeometry args={[2.05, 2.05, 0.18, 48]} /><meshStandardMaterial color="#4e3020" roughness={0.6} /></mesh>
      <mesh position={[0, TOP - 0.004, 0]} receiveShadow><cylinderGeometry args={[1.82, 1.82, 0.02, 48]} /><meshStandardMaterial color="#1f3a2c" roughness={0.95} /></mesh>
      <mesh position={[0, TOP - 0.05, 0]} rotation-x={Math.PI / 2}><torusGeometry args={[1.86, 0.05, 6, 64]} /><meshStandardMaterial color="#c9a24a" metalness={0.8} roughness={0.35} /></mesh>
      <mesh position={[0, (TOP - 0.18) / 2, 0]} castShadow><cylinderGeometry args={[0.3, 0.75, TOP - 0.18, 14]} /><meshStandardMaterial color="#35221a" roughness={0.8} /></mesh>
      {/* A stack of books at Haseeb's elbow, and a ledger of who has won here. */}
      {[0, 1, 2].map((i) => <mesh key={i} position={[1.25, TOP + 0.07 + i * 0.13, -0.95]} rotation-y={0.3 + i * 0.25} castShadow><boxGeometry args={[0.62, 0.12, 0.45]} /><meshStandardMaterial color={['#5a3a5e', '#7a1f1f', '#283c5a'][i]} roughness={0.85} /></mesh>)}
    </group>
  );
}
function Cup({ z }: { z: number }) {
  return (
    <group position={[0, TOP, z]}>
      <mesh geometry={cupGeo} material={cupMat} castShadow />
      <mesh position-y={0.62} rotation-x={Math.PI / 2} material={bandMat}><torusGeometry args={[0.39, 0.022, 6, 36]} /></mesh>
    </group>
  );
}
function Station() {
  const playing = usePlay().game && session.phase === 'play';
  return (
    <group>
      <Table />
      <group visible={!playing}><Cup z={CUP_Z} /><Cup z={-CUP_Z} /></group>
    </group>
  );
}

// ---- The rules.
type Who = 'you' | 'him';
interface Bid { q: number; f: number; who: Who }
const FACE_NAME = ['', 'ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
export const bidText = (b: { q: number; f: number }) => `${NUM[b.q] ?? b.q} ${b.q === 1 ? FACE_NAME[b.f].replace(/s$/, '').replace('sixe', 'six') : FACE_NAME[b.f]}`;
const higher = (a: { q: number; f: number }, b?: { q: number; f: number }) => !b || a.q > b.q || (a.q === b.q && a.f > b.f);
const count = (dice: number[], f: number) => dice.filter((d) => d === f).length;
const roll = (n: number) => Array.from({ length: n }, () => 1 + Math.floor(Math.random() * 6));
const C = (n: number, k: number) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
/** The chance that at least k of n unseen dice show a given face. */
function atLeast(n: number, k: number) {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let s = 0;
  for (let i = k; i <= n; i++) s += C(n, i) * (1 / 6) ** i * (5 / 6) ** (n - i);
  return s;
}

const LINES = {
  open: ['Let’s see what you’re made of.', 'Five dice, one truth.', 'Sit. The table is fair, even if I’m not.'],
  raise: ['Mm.', 'I’ll go higher.', 'You’re not sure, are you?', 'Fine.', 'I like my cup.', 'Your move.'],
  call: ['Liar.', 'No. I don’t believe you.', 'Show me.', 'Lift it.'],
  heLoses: ['Hm. Well read.', 'You got me there.', 'Interesting.', 'I’ll remember that.'],
  heWins: ['The table doesn’t lie.', 'Every lord bluffs. Few do it well.', 'Again?', 'Close.'],
};
const any = (a: string[]) => a[Math.floor(Math.random() * a.length)];

type Phase = 'roll' | 'peek' | 'bid' | 'wait' | 'reveal' | 'over';
/** A bid on chain, as the HUD shows it: how many more Haseeb's cup must show, the chance, what it pays. */
interface Quote { have: number; need: number; chance: number; pays: number; cover: boolean }
const ui = gameUi({
  phase: 'roll' as Phase, turn: 'you' as Who, you: START, him: START, yours: [] as number[],
  wager: false, quote: undefined as Quote | undefined, bank: 0,
  bid: undefined as Bid | undefined, pick: { q: 1, f: 2 }, line: 'Haseeb rattles his cup.', who: '', reveal: undefined as undefined | { n: number; ok: boolean; loser: Who },
});

interface S {
  phase: Phase; t: number; turn: Who; starter: Who;
  yours: number[]; his: number[]; you: number; him: number;
  bid?: Bid; think: number; reveal?: { n: number; ok: boolean; loser: Who }; nextRattle: number; done: boolean;
  /** On NEAR: what the contract paid for the bid. */
  paid: number;
  /** Per cup (yours, his), eased every frame so no phase change can snap a cup: how far it is lifted aside (0..1),
   *  how hard it rattles, and a short hop when its owner bids. */
  lift: [number, number]; rattle: [number, number]; knock: [number, number];
  /** The reveal is done and the cups are coming back down over the dice, before the next deal. */
  cover: boolean;
  lean: number; seeded: boolean;
}

function Play({ room, end }: { room: Room; end: (r: Result) => void }) {
  const camera = useThree((st) => st.camera);
  const s = useRef<S>({ phase: 'roll', t: 0, turn: 'you', starter: Math.random() < 0.5 ? 'you' : 'him', yours: [], his: [], you: START, him: START, think: 0, nextRattle: 0, done: false, paid: 0, lift: [0, 0], rattle: [0, 0], knock: [0, 0], cover: false, lean: 0, seeded: false }).current;
  const cups = useRef<(THREE.Group | null)[]>([]);
  const dice = useRef<(THREE.Group | null)[]>([]);
  const faces = useRef<(THREE.Mesh | null)[]>([]);
  const yaws = useMemo(() => Array.from({ length: START * 2 }, () => Math.random() * Math.PI * 2), []);
  const camPos = useMemo(() => new THREE.Vector3(), []), camLook = useMemo(() => new THREE.Vector3(), []), look = useMemo(() => new THREE.Vector3(), []);
  // A bid on NEAR can come back after you have walked out: it must not write to a table that is gone.
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const say = (line: string) => { ui.set({ line, who: 'Haseeb Qureshi' }); voice('lord', line.length, 0); };
  const tell = (line: string) => ui.set({ line, who: '' });
  const deal = () => {
    s.yours = roll(s.you); s.his = roll(s.him); s.bid = undefined; s.reveal = undefined; s.cover = false;
    s.phase = 'roll'; s.t = 0; s.turn = s.starter;
    ui.set({ phase: 'roll', you: s.you, him: s.him, yours: [...s.yours].sort(), bid: undefined, reveal: undefined, turn: s.turn });
    tell('Both cups rattle.');
  };
  // ---- On NEAR: one bid against Haseeb's cup, settled by the contract.
  const wager = session.live;
  const bank = () => units(session.lib?.bank);
  const quote = (q: number, f: number): Quote | undefined => {
    const lib = session.lib; if (!lib) return undefined;
    const have = count(s.yours, f), need = q - have, pays = libPays(lib, LIB_STAKE, need);
    return { have, need, chance: libChance(lib, need), pays, cover: need >= 1 && need <= 5 && pays - LIB_STAKE <= bank() / 2 };
  };
  const wagerPick = () => {
    const f = [1, 2, 3, 4, 5, 6].sort((a, b) => count(s.yours, b) - count(s.yours, a) || b - a)[0];
    return { q: count(s.yours, f) + 1, f };
  };
  const sitDown = () => {
    s.yours = session.lib?.cup?.mine ?? []; s.his = []; s.bid = undefined; s.reveal = undefined;
    s.phase = 'roll'; s.t = 0; s.turn = 'you';
    const pick = wagerPick();
    ui.set({ phase: 'roll', wager: true, you: START, him: START, yours: [...s.yours].sort(), bid: undefined, reveal: undefined, turn: 'you', pick, quote: quote(pick.q, pick.f), bank: bank() });
    tell('Both cups rattle. Yours was rolled on NEAR when you staked.');
  };
  const bidOnChain = (q: number, f: number) => {
    const round = session.chainRound;
    if (round === undefined) return;
    // The bid closes the round: walking out now mustn't close it a second time.
    session.chainRound = undefined;
    s.bid = { q, f, who: 'you' }; s.phase = 'wait'; s.t = 0;
    ui.set({ phase: 'wait', bid: s.bid });
    tell(`You bid ${bidText({ q, f })}. Haseeb’s dice are rolled from the block that takes it…`);
    bidLibrary(round, q, f).then((r) => {
      if (s.done || !alive.current) return;
      s.his = r.his ?? [];
      const n = r.shown ?? count(s.yours, f) + count(s.his, f);
      s.reveal = { n, ok: r.won, loser: r.won ? 'him' : 'you' };
      s.paid = units(r.paid);
      s.phase = 'reveal'; s.t = 0;
      ui.set({ phase: 'reveal', reveal: s.reveal });
    }).catch((e: Error) => {
      if (s.done || !alive.current) return;
      session.chainRound = round;
      s.bid = undefined; s.phase = 'bid'; s.t = 0;
      ui.set({ phase: 'bid', bid: undefined });
      tell(/later block/.test(e.message) ? 'Too quick: Haseeb rolls in a later block than yours. Bid again.' : /can't cover/.test(e.message) ? 'The Library’s bank can’t cover that bid. Bid lower.' : `The bid didn’t go through: ${e.message}`);
    });
  };

  useMemo(() => {
    ui.reset();
    if (!wager) { deal(); return; }
    sitDown();
    // If the dice couldn't be read back at the stake, read them now.
    if (!session.lib?.cup && session.chainRound !== undefined) void library(session.chainRound).then((l) => { if (!alive.current) return; session.lib = l; sitDown(); }).catch(() => alive.current && tell('Couldn’t read your cup from NEAR. Esc to leave (the stake goes to the Library).'));
    /* eslint-disable-line react-hooks/exhaustive-deps */
  }, []);

  const defaultPick = () => {
    if (!s.bid) { const best = [1, 2, 3, 4, 5, 6].sort((a, b) => count(s.yours, b) - count(s.yours, a) || b - a)[0]; return { q: Math.max(1, count(s.yours, best)), f: best }; }
    return s.bid.f < 6 ? { q: s.bid.q, f: s.bid.f + 1 } : { q: s.bid.q + 1, f: s.bid.f };
  };
  const place = (b: Bid) => {
    s.bid = b; s.turn = b.who === 'you' ? 'him' : 'you'; s.think = 1.1 + Math.random() * 1.1;
    burst(2400, 2, 0.03, 0.08); burst(320, 1.6, 0.05, 0.07);
    s.knock[b.who === 'you' ? 0 : 1] = 1;
    ui.set({ bid: b, turn: s.turn, pick: s.turn === 'you' ? defaultPick() : ui.state.pick });
  };
  const call = (who: Who) => {
    const b = s.bid!, n = count(s.yours, b.f) + count(s.his, b.f), ok = n >= b.q;
    // A true bid: the caller loses a die. A lie: the bidder does.
    const loser: Who = ok ? who : b.who;
    s.reveal = { n, ok, loser }; s.phase = 'reveal'; s.t = 0;
    ui.set({ phase: 'reveal', reveal: s.reveal, turn: who });
    if (who === 'him') say(any(LINES.call)); else tell('You call it: “Liar!”');
  };

  /** Haseeb's turn: call the bid if it's unlikely given what he can see; otherwise raise to his likeliest bid. */
  const hisTurn = () => {
    const total = s.you + s.him;
    const p = (q: number, f: number) => atLeast(s.you, q - count(s.his, f));
    if (s.bid) {
      const pb = p(s.bid.q, s.bid.f);
      if (s.bid.q > total || pb < 0.3 + Math.random() * 0.14) return call('him');
    }
    const cands: { q: number; f: number; score: number; pr: number }[] = [];
    for (let f = 1; f <= 6; f++) {
      const q0 = !s.bid ? 1 : f > s.bid.f ? s.bid.q : s.bid.q + 1;
      for (let q = q0; q <= Math.min(total, q0 + 2); q++) {
        const pr = p(q, f);
        cands.push({ q, f, pr, score: (pr >= 0.5 ? 1 + q * 0.25 : pr) + Math.random() * 0.15 });
      }
    }
    if (!cands.length) return call('him');
    let pick = cands.sort((a, b) => b.score - a.score)[0];
    // Now and then a bluff: a face he barely holds, at the lowest bid that's still believable.
    if (Math.random() < 0.15) {
      const bluff = cands.filter((c) => count(s.his, c.f) <= 1 && c.pr >= 0.25).sort((a, b) => a.q - b.q)[0];
      if (bluff) pick = bluff;
    }
    if (s.bid && pick.pr < 0.22) return call('him');
    place({ q: pick.q, f: pick.f, who: 'him' });
    say(`${Math.random() < 0.45 ? any(!s.bid ? LINES.open : LINES.raise) + ' ' : ''}${bidText(pick).replace(/^./, (c) => c.toUpperCase())}.`);
  };

  useFrame(({ clock }, raw) => {
    const dt = Math.min(raw, 0.05);
    s.t += dt;
    const ks = gameKeys();
    if (s.done) return;

    if (s.phase === 'roll') {
      if (clock.elapsedTime > s.nextRattle && s.t < 1.1) { burst(2200 + Math.random() * 1600, 1.4, 0.06, 0.05); s.nextRattle = clock.elapsedTime + 0.06 + Math.random() * 0.05; }
      if (s.t > 1.35) { s.phase = 'peek'; s.t = 0; ui.set({ phase: 'peek' }); tell('You tip your cup and look.'); }
    } else if (s.phase === 'peek') {
      if (s.t > 0.9) {
        s.phase = 'bid'; s.t = 0; s.think = 1.2;
        if (wager) {
          const pick = wagerPick();
          ui.set({ phase: 'bid', pick, quote: quote(pick.q, pick.f) });
          tell('One bid: how many of one face lie under both cups?');
        } else {
          ui.set({ phase: 'bid', pick: defaultPick() });
          if (s.turn === 'you') tell('You open the bidding. Choose how many and which face, then bid.'); else tell('Haseeb opens.');
        }
      }
    } else if (s.phase === 'bid' && wager) {
      let { q, f } = ui.state.pick;
      for (const k of ks) {
        if (k === 'w' || k === 'arrowup') q = Math.min(START * 2, q + 1);
        else if (k === 's' || k === 'arrowdown') q = Math.max(1, q - 1);
        else if (k === 'd' || k === 'arrowright') f = f % 6 + 1;
        else if (k === 'a' || k === 'arrowleft') f = ((f + 4) % 6) + 1;
        else if (k === 'e' || k === 'enter') {
          const qt = quote(q, f);
          if (!qt) { tell('Your cup hasn’t come back from NEAR yet.'); continue; }
          if (qt.need < 1) { tell(`You hold ${NUM[qt.have]} yourself: bid more than that.`); continue; }
          if (qt.need > 5) { tell('Haseeb only has five dice.'); continue; }
          if (!qt.cover) { tell('The Library’s bank can’t cover that bid. Bid lower.'); continue; }
          bidOnChain(q, f); break;
        }
      }
      if (s.phase === 'bid' && (q !== ui.state.pick.q || f !== ui.state.pick.f)) { ui.set({ pick: { q, f }, quote: quote(q, f), line: 'One bid: how many of one face lie under both cups?', who: '' }); burst(1500, 3, 0.02, 0.04); }
    } else if (s.phase === 'wait') {
      if (clock.elapsedTime > s.nextRattle) { burst(2200 + Math.random() * 1600, 1.4, 0.04, 0.05); s.nextRattle = clock.elapsedTime + 0.08 + Math.random() * 0.08; }
    } else if (s.phase === 'reveal' && wager) {
      const r = s.reveal!, b = s.bid!;
      if (s.t > 0.75 && s.t - dt <= 0.75) {
        burst(900, 1, 0.06, 0.3);
        tell(`${NUM[r.n] ?? r.n} ${r.n === 1 ? FACE_NAME[b.f].replace(/s$/, '').replace('sixe', 'six') : FACE_NAME[b.f]} on the table. ${r.ok ? `Your bid was true: the contract pays ${s.paid.toFixed(3)} NEAR.` : 'Your bid was short: the stake goes to the Library’s bank.'}`);
      }
      if (s.t > 2.6 && s.t - dt <= 2.6) say(any(r.ok ? LINES.heLoses : LINES.heWins));
      if (s.t > 4.2) { s.phase = 'over'; s.t = 0; ui.set({ phase: 'over' }); if (r.ok) burst(1800, 3, 0.05, 0.5); }
    } else if (s.phase === 'over' && wager) {
      if (s.t > 2.4) {
        s.done = true;
        const r = s.reveal!, b = s.bid!;
        end({ won: r.ok, score: r.n, grade: 1, paid: s.paid, line: r.ok ? `You bid ${bidText(b)} and the cups showed ${NUM[r.n] ?? r.n}. The contract paid ${s.paid.toFixed(3)} NEAR.` : `You bid ${bidText(b)}; the cups showed ${NUM[r.n] ?? r.n}. Haseeb keeps the ${LIB_STAKE} NEAR for the Library.` });
        return;
      }
    } else if (s.phase === 'bid') {
      if (s.turn === 'him') {
        s.think -= dt;
        if (s.think <= 0) hisTurn();
      } else {
        const total = s.you + s.him;
        let { q, f } = ui.state.pick;
        for (const k of ks) {
          if (k === 'w' || k === 'arrowup') q = Math.min(total, q + 1);
          else if (k === 's' || k === 'arrowdown') q = Math.max(1, q - 1);
          else if (k === 'd' || k === 'arrowright') f = f % 6 + 1;
          else if (k === 'a' || k === 'arrowleft') f = ((f + 4) % 6) + 1;
          else if (k === 'e' || k === 'enter') {
            // A bid or a call ends your turn: stop reading keys, so one frame can't act twice.
            if (higher({ q, f }, s.bid)) { place({ q, f, who: 'you' }); tell(`You bid ${bidText({ q, f })}.`); break; }
            tell(`Bid higher than ${bidText(s.bid!)}: more dice, or as many of a higher face.`); burst(220, 1.4, 0.06, 0.1);
          } else if (k === ' ' || k === 'l') {
            if (s.bid && s.bid.who === 'him') { call('you'); break; }
            tell('Nothing to call yet. Make the first bid.'); burst(220, 1.4, 0.06, 0.1);
          }
        }
        if (q !== ui.state.pick.q || f !== ui.state.pick.f) { ui.set({ pick: { q, f } }); burst(1500, 3, 0.02, 0.04); }
      }
    } else if (s.phase === 'reveal') {
      const r = s.reveal!;
      if (s.t > 0.75 && s.t - dt <= 0.75) {
        burst(900, 1, 0.06, 0.3);
        tell(`${NUM[r.n] ?? r.n} ${r.n === 1 ? FACE_NAME[s.bid!.f].replace(/s$/, '').replace('sixe', 'six') : FACE_NAME[s.bid!.f]} on the table. ${r.ok ? 'The bid was true.' : 'It was a lie.'} ${r.loser === 'you' ? 'You lose a die.' : 'Haseeb loses a die.'}`);
      }
      if (s.t > 3.0 && s.t - dt <= 3.0) burst(180, 1.2, 0.12, 0.25);
      if (s.t > 3.4 && s.t - dt <= 3.4) {
        if (r.loser === 'you') s.you--; else s.him--;
        ui.set({ you: s.you, him: s.him });
        if (r.loser === 'him') say(any(LINES.heLoses)); else if (s.you > 0) say(any(LINES.heWins));
      }
      if (s.t > 4.6 && !s.cover) {
        if (s.you === 0 || s.him === 0) {
          s.phase = 'over'; s.t = 0; ui.set({ phase: 'over' });
          if (s.him === 0) { say('Well played. I’ll be thinking about that last call for a week.'); burst(1800, 3, 0.05, 0.5); }
          else say('The Library keeps your stake. Come back when you’ve read the table.');
        } else s.cover = true;
      }
      // Both cups come back down over the dice first; only then are they rolled again, so no die changes in plain sight.
      if (s.cover && s.t > 5.15) { s.starter = r.loser; deal(); }
    } else if (s.phase === 'over' && s.t > 2.4) {
      s.done = true;
      const won = s.him === 0;
      end({ won, score: s.you, grade: s.you / START, line: won ? `You beat Haseeb Qureshi with ${NUM[s.you]} ${s.you === 1 ? 'die' : 'dice'} left.` : `Haseeb Qureshi took the table with ${NUM[s.him]} ${s.him === 1 ? 'die' : 'dice'} left.` });
      return;
    }

    // ---- The cups: rattling, your peek, both lifted at the reveal. Lift and rattle are eased toward what the phase
    // wants (never read off the phase clock), so a cup that is already open stays open from bid to reveal to the end,
    // and comes back over the dice before a new deal.
    const reveal = s.phase === 'reveal' || s.phase === 'over';
    const T = clock.elapsedTime;
    for (const who of ['you', 'him'] as const) {
      const c = who === 'you' ? 0 : 1, side = SIDE[who];
      const peek = who === 'you' && (s.phase === 'peek' || s.phase === 'bid' || s.phase === 'wait');
      s.lift[c] += (((reveal || peek) && !s.cover ? 1 : 0) - s.lift[c]) * (1 - Math.exp(-dt * 7));
      const shaking = s.phase === 'roll' ? (s.t < 1.1 ? 1 : 0) : s.phase === 'wait' && who === 'him' ? 0.75 : 0;
      s.rattle[c] += (shaking - s.rattle[c]) * (1 - Math.exp(-dt * 14));
      s.knock[c] = Math.max(0, s.knock[c] - dt * 4);
      const g = cups.current[c]; if (!g) continue;
      const lift = s.lift[c], r = s.rattle[c];
      let y = TOP + (0.12 + Math.abs(Math.sin(T * 38 + side)) * 0.08) * r + Math.sin(s.knock[c] * Math.PI) * 0.07;
      let x = Math.sin(T * 31 + side) * 0.06 * r, z = side * CUP_Z;
      const rx = Math.sin(T * 27) * 0.1 * r;
      // Lifted and set down on its side next to the dice, so nothing hides them from you.
      const up = Math.sin(lift * Math.PI) * 0.6;
      x += side * lift * 0.95; y += up + lift * 0.42; z -= side * lift * 0.15;
      g.position.set(x, y, z); g.rotation.set(rx, 0, -side * lift * (Math.PI / 2));
    }
    // ---- The dice, with the matching ones lit gold at the reveal (and kept lit to the end of it).
    const showYours = s.phase !== 'roll';
    const counted = s.phase === 'over' || s.t > 0.75;
    for (let i = 0; i < START * 2; i++) {
      const g = dice.current[i], m = faces.current[i]; if (!g || !m) continue;
      const mine = i < START, k = mine ? i : i - START, list = mine ? s.yours : s.his;
      const vis = k < list.length && (mine ? showYours : reveal);
      g.visible = vis;
      if (!vis) continue;
      const [ox, oz] = SPOTS[k], side = mine ? 1 : -1;
      const hot = reveal && !!s.bid && list[k] === s.bid.f && counted;
      // A counted die hops once as it lights.
      const hop = hot && s.phase === 'reveal' ? Math.sin(Math.min(1, (s.t - 0.75) / 0.3) * Math.PI) * 0.07 : 0;
      g.position.set(ox, TOP + DIE / 2 + hop, side * CUP_Z + oz);
      g.rotation.set(0, yaws[i], 0);
      const up = UP[list[k]]; m.rotation.set(up[0], up[1], up[2]);
      m.material = hot ? hotMats : dieMats;
      // The die that's lost shrinks away, and stays gone until the next deal (or the end of the game). On NEAR there
      // is one bid and nobody loses a die.
      const lost = !wager && reveal && !!s.reveal && ((s.reveal.loser === 'you') === mine) && k === list.length - 1;
      g.scale.setScalar(!lost ? 1 : s.phase === 'over' ? 0.001 : Math.max(0.001, 1 - smooth((s.t - 3.0) / 0.4)));
    }

    // ---- The camera: your side of the table, leaning in at the reveal. Where it sits, where it looks and the lean
    // are all eased, and the look starts from wherever the card's camera was looking and ends on the card's own look.
    s.lean += ((reveal ? 1 : 0) - s.lean) * (1 - Math.exp(-dt * 3));
    camPos.set(room.x, TOP + 3.0 - s.lean * 0.4, room.z + 3.2 - s.lean * 0.6);
    if (s.phase === 'over' && s.t > 1.6) camLook.set(room.x + VIEW.look[0], VIEW.look[1], room.z + VIEW.look[2]);
    else camLook.set(room.x, TOP + 0.1, room.z - 0.1 - s.lean * 0.15);
    if (!s.seeded) { s.seeded = true; camera.getWorldDirection(look).multiplyScalar(camera.position.distanceTo(camLook)).add(camera.position); }
    const ck = 1 - Math.exp(-dt * 4);
    camera.position.lerp(camPos, ck);
    look.lerp(camLook, ck);
    camera.lookAt(look);
    const pc = camera as THREE.PerspectiveCamera;
    if (Math.abs(pc.fov - 50) > 0.1) { pc.fov += (50 - pc.fov) * ck; pc.updateProjectionMatrix(); }
  });

  return (
    <group>
      {[0, 1].map((i) => (
        <group key={i} ref={(g) => { cups.current[i] = g; }} position={[0, TOP, (i === 0 ? 1 : -1) * CUP_Z]}>
          <mesh geometry={cupGeo} material={cupMat} castShadow />
          <mesh position-y={0.62} rotation-x={Math.PI / 2} material={bandMat}><torusGeometry args={[0.39, 0.022, 6, 36]} /></mesh>
        </group>
      ))}
      {Array.from({ length: START * 2 }, (_, i) => (
        <group key={i} ref={(g) => { dice.current[i] = g; }} visible={false}>
          <mesh ref={(m) => { faces.current[i] = m; }} geometry={dieGeo} material={dieMats} castShadow />
        </group>
      ))}
    </group>
  );
}

const PIPS = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
function WagerHud() {
  const s = ui.use();
  const q = s.quote, mine = s.phase === 'bid';
  return (
    <div className="game-hud dice">
      {s.phase !== 'roll' && <div className="mine">Your cup, rolled on NEAR: {s.yours.map((d, i) => <b key={i} className={(s.bid ?? s.pick) && d === (s.bid ?? s.pick).f ? 'hit' : ''}>{PIPS[d]}</b>)}</div>}
      {s.bid && <div className="big">You bid: {bidText(s.bid)}</div>}
      <div className="line">{s.who && <b>{s.who}: </b>}{s.line}</div>
      {mine && (
        <div className="picker">
          <span><kbd>W</kbd><kbd>S</kbd> {s.pick.q}</span><span>×</span><span><kbd>A</kbd><kbd>D</kbd> <b>{PIPS[s.pick.f]}</b> {FACE_NAME[s.pick.f]}</span>
        </div>
      )}
      {mine && q && (
        <div className="hint">
          {q.need < 1 ? `You hold ${NUM[q.have]} yourself: bid higher.` : q.need > 5 ? 'Haseeb only has five dice.' : <>
            Haseeb’s cup must show {NUM[q.need]} more · {(q.chance * 100).toFixed(1)}% · pays {q.pays.toFixed(3)} NEAR
            {!q.cover && ' · more than the bank can cover'}
          </>}
        </div>
      )}
      {mine && <div className="hint"><kbd>E</kbd> bid {bidText(s.pick)} for {LIB_STAKE} NEAR · fair odds less 5%, from the Library’s bank ({s.bank.toFixed(2)} NEAR)</div>}
      {s.phase === 'wait' && <div className="hint">The contract is rolling Haseeb’s cup…</div>}
    </div>
  );
}

function Hud() {
  const s = ui.use();
  if (s.wager) return <WagerHud />;
  const myTurn = s.phase === 'bid' && s.turn === 'you';
  return (
    <div className="game-hud dice">
      <div className="tally">
        <span>You {Array.from({ length: START }, (_, i) => <i key={i} className={i < s.you ? 'on' : ''} />)}</span>
        <span>Haseeb {Array.from({ length: START }, (_, i) => <i key={i} className={i < s.him ? 'on' : ''} />)}</span>
      </div>
      {s.phase !== 'roll' && <div className="mine">Your cup: {s.yours.map((d, i) => <b key={i} className={s.bid && d === s.bid.f ? 'hit' : ''}>{PIPS[d]}</b>)}</div>}
      {s.bid && <div className="big">{s.bid.who === 'you' ? 'You bid' : 'Haseeb bids'}: {bidText(s.bid)}</div>}
      <div className="line">{s.who && <b>{s.who}: </b>}{s.line}</div>
      {myTurn && (
        <div className="picker">
          <span><kbd>W</kbd><kbd>S</kbd> {s.pick.q}</span><span>×</span><span><kbd>A</kbd><kbd>D</kbd> <b>{PIPS[s.pick.f]}</b> {FACE_NAME[s.pick.f]}</span>
        </div>
      )}
      {myTurn && <div className="hint"><kbd>E</kbd> bid {bidText(s.pick)}{s.bid?.who === 'him' && <> · <kbd>Space</kbd> call “Liar!”</>}</div>}
      {s.phase === 'bid' && s.turn === 'him' && <div className="hint">Haseeb is thinking…</div>}
    </div>
  );
}

register({
  id: 'dice', name: 'Liar’s Dice',
  pitch: 'Five dice each under a cup; you only see yours. Bid on how many of a face lie under both cups, each bid higher than the last, or call Haseeb’s bid a lie. Whoever is wrong loses a die. No wilds. On NEAR it’s one bid, settled by the contract.',
  keys: [['W S', 'how many'], ['A D', 'which face'], ['E', 'bid'], ['Space', 'call “Liar!”'], ['Esc', 'leave']],
  entry: 1,
  Station, Play, Hud,
  view: () => VIEW,
});
