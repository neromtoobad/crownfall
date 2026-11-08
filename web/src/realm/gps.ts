// The GPS line: the shortest way along the realm's roads from where you are to where you're going.
import { ROADS, roadCurve } from './layout.ts';

interface Node { x: number; z: number; nb: { to: number; d: number }[] }
let nodes: Node[] | undefined;

function graph() {
  if (nodes) return nodes;
  nodes = [];
  const STEP = 6;
  const roadNodes: number[][] = [];
  for (const r of ROADS) {
    const c = roadCurve(r), n = Math.max(2, Math.ceil(c.getLength() / STEP));
    const ids: number[] = [];
    for (const p of c.getSpacedPoints(n)) {
      const id = nodes.length;
      nodes.push({ x: p.x, z: p.z, nb: [] });
      if (ids.length) { const a = nodes[ids[ids.length - 1]], d = Math.hypot(a.x - p.x, a.z - p.z); a.nb.push({ to: id, d }); nodes[id].nb.push({ to: ids[ids.length - 1], d }); }
      ids.push(id);
    }
    roadNodes.push(ids);
  }
  // Junctions: where two roads come within a few units of each other, you can switch.
  for (let i = 0; i < roadNodes.length; i++) for (let j = i + 1; j < roadNodes.length; j++)
    for (const a of roadNodes[i]) for (const b of roadNodes[j]) {
      const A = nodes[a], B = nodes[b], d = Math.hypot(A.x - B.x, A.z - B.z);
      if (d < 9) { A.nb.push({ to: b, d }); B.nb.push({ to: a, d }); }
    }
  return nodes;
}

function nearest(x: number, z: number) {
  const g = graph();
  let best = 0, bd = Infinity;
  for (let i = 0; i < g.length; i++) { const d = (g[i].x - x) ** 2 + (g[i].z - z) ** 2; if (d < bd) { bd = d; best = i; } }
  return { id: best, d: Math.sqrt(bd) };
}

/** A list of points from (x0, z0) to (x1, z1): straight if it's close or roads don't help, else along the roads. */
export function route(x0: number, z0: number, x1: number, z1: number): [number, number][] {
  const direct = Math.hypot(x1 - x0, z1 - z0);
  if (direct < 90) return [[x0, z0], [x1, z1]];
  const g = graph(), a = nearest(x0, z0), b = nearest(x1, z1);
  if (a.d + b.d > direct * 0.8) return [[x0, z0], [x1, z1]];
  // Dijkstra (the graph is a few thousand nodes; a plain array scan per pop is quick enough at this size).
  const dist = new Float64Array(g.length).fill(Infinity), prev = new Int32Array(g.length).fill(-1), done = new Uint8Array(g.length);
  dist[a.id] = 0;
  const open = new Set([a.id]);
  while (open.size) {
    let u = -1, du = Infinity;
    for (const i of open) if (dist[i] < du) { du = dist[i]; u = i; }
    open.delete(u);
    if (u === b.id) break;
    done[u] = 1;
    for (const { to, d } of g[u].nb) if (!done[to] && du + d < dist[to]) { dist[to] = du + d; prev[to] = u; open.add(to); }
  }
  if (!isFinite(dist[b.id])) return [[x0, z0], [x1, z1]];
  const path: [number, number][] = [[x1, z1]];
  for (let i = b.id; i !== -1; i = prev[i]) path.push([g[i].x, g[i].z]);
  path.push([x0, z0]);
  return path.reverse();
}
