// 推箱子求解器：只用于关卡生成脚本和测试，游戏运行时不加载。
// 状态 = 箱子位置（升序）+ 玩家可达区域里 index 最小的格子（同一区域内的玩家位置等价）。
// solve：从开局正向 BFS，每层推一次箱子，求最少推动。
// pullSearch：从“箱子全在目标点上”反向 BFS（只能拉箱子），层数就是正向的最少推动，用来找最难的开局。
import { parseLevel, computeDead, FLOOR } from './engine.js';

function makeSpace(w, tiles) {
  const n = tiles.length;
  const S = [-w, 1, w, -1];
  const occ = new Uint8Array(n);
  const mark = new Int32Array(n);
  const stack = new Int32Array(n);
  let stamp = 0;
  // 标记玩家从 p 出发能走到的格子（mark === 当前 stamp），返回区域里最小的 index
  function explore(boxes, p) {
    for (const b of boxes) occ[b] = 1;
    stamp++;
    let top = 0;
    let min = p;
    stack[top++] = p;
    mark[p] = stamp;
    while (top) {
      const i = stack[--top];
      if (i < min) min = i;
      for (let d = 0; d < 4; d++) {
        const j = i + S[d];
        if (tiles[j] === FLOOR && !occ[j] && mark[j] !== stamp) {
          mark[j] = stamp;
          stack[top++] = j;
        }
      }
    }
    return min;
  }
  const reached = (i) => mark[i] === stamp;
  const clear = (boxes) => {
    for (const b of boxes) occ[b] = 0;
  };
  const key = (boxes, p) => {
    let k = 0;
    for (const b of boxes) k = k * n + b;
    return k * n + p;
  };
  return { n, S, occ, explore, reached, clear, key };
}

function moveBox(boxes, k, to) {
  const next = boxes.slice();
  next[k] = to;
  return next.sort((a, b) => a - b);
}

// 返回 { pushes, solution: [{ box, dir }], states }；无解或超出状态上限返回 null
export function solve(rows, { maxStates = 2_000_000 } = {}) {
  const lv = parseLevel(rows);
  if (!lv) return null;
  const { w, tiles, target } = lv;
  const dead = computeDead(lv);
  const sp = makeSpace(w, tiles);
  const startBoxes = [];
  for (let i = 0; i < tiles.length; i++) if (lv.box[i]) startBoxes.push(i);
  const solved = (boxes) => boxes.every((b) => target[b]);

  const states = [];
  const seen = new Set();
  const p0 = sp.explore(startBoxes, lv.player);
  sp.clear(startBoxes);
  states.push({ boxes: startBoxes, p: p0, parent: -1, box: -1, dir: -1 });
  seen.add(sp.key(startBoxes, p0));
  let goal = solved(startBoxes) ? 0 : -1;
  for (let head = 0; head < states.length && goal < 0; head++) {
    const cur = states[head];
    sp.explore(cur.boxes, cur.p);
    const succ = [];
    cur.boxes.forEach((b, k) => {
      for (let d = 0; d < 4; d++) {
        const to = b + sp.S[d];
        if (!sp.reached(b - sp.S[d]) || tiles[to] !== FLOOR || sp.occ[to] || dead[to]) continue;
        succ.push([moveBox(cur.boxes, k, to), b, d]);
      }
    });
    sp.clear(cur.boxes);
    for (const [boxes, from, dir] of succ) {
      const p = sp.explore(boxes, from);
      sp.clear(boxes);
      const k = sp.key(boxes, p);
      if (seen.has(k)) continue;
      seen.add(k);
      states.push({ boxes, p, parent: head, box: from, dir });
      if (solved(boxes)) {
        goal = states.length - 1;
        break;
      }
      if (states.length > maxStates) return null;
    }
  }
  if (goal < 0) return null;
  const solution = [];
  for (let s = goal; states[s].parent >= 0; s = states[s].parent) solution.push({ box: states[s].box, dir: states[s].dir });
  solution.reverse();
  return { pushes: solution.length, solution, states: states.length };
}

// level：{ w, tiles, targets: [index] }。返回所有箱子都不在目标点上（maxOnTarget 放宽为最多几个在）、拉得最远的局面：
// { boxes, player, pushes, states }；超出状态上限返回 null。
// partial：超出上限时改为返回最后一个完整搜完的层里的局面（层数仍是精确的最少推动，只是不一定最远）
export function pullSearch({ w, tiles, targets }, { maxStates = 600_000, partial = false, maxOnTarget = 0 } = {}) {
  const sp = makeSpace(w, tiles);
  const isTarget = new Uint8Array(tiles.length);
  for (const t of targets) isTarget[t] = 1;
  const goalBoxes = [...targets].sort((a, b) => a - b);

  let frontier = [];
  const seen = new Set();
  const covered = new Uint8Array(tiles.length);
  for (const b of goalBoxes) covered[b] = 1;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== FLOOR || covered[i]) continue;
    const p = sp.explore(goalBoxes, i);
    for (let j = 0; j < tiles.length; j++) if (sp.reached(j)) covered[j] = 1;
    sp.clear(goalBoxes);
    seen.add(sp.key(goalBoxes, p));
    frontier.push({ boxes: goalBoxes, p });
  }

  let best = null;
  let depth = 0;
  while (frontier.length) {
    const next = [];
    for (const cur of frontier) {
      sp.explore(cur.boxes, cur.p);
      const succ = [];
      cur.boxes.forEach((b, k) => {
        for (let d = 0; d < 4; d++) {
          const stand = b + sp.S[d];
          const back = stand + sp.S[d];
          if (!sp.reached(stand) || tiles[back] !== FLOOR || sp.occ[back]) continue;
          succ.push([moveBox(cur.boxes, k, stand), back]);
        }
      });
      sp.clear(cur.boxes);
      for (const [boxes, from] of succ) {
        const p = sp.explore(boxes, from);
        sp.clear(boxes);
        const k = sp.key(boxes, p);
        if (seen.has(k)) continue;
        seen.add(k);
        next.push({ boxes, p });
        if (seen.size > maxStates) return partial ? best && { ...best, states: seen.size } : null;
      }
    }
    if (!next.length) break;
    depth++;
    frontier = next;
    const off = frontier.find((s) => s.boxes.reduce((n, b) => n + isTarget[b], 0) <= maxOnTarget);
    if (off) best = { boxes: off.boxes, player: off.p, pushes: depth };
  }
  return best && { ...best, states: seen.size };
}
