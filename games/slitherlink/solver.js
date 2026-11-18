// 数回求解器（纯逻辑，不依赖 DOM；只在离线出题脚本和测试中使用）
//   logicSolve：分层逻辑求解，用于评级。层级 0 = 数字规则 + 点规则（含提前闭合），层级 1 = 再加一步试探
//   countSolutions：回溯数解（每个节点先做一步试探），找到 limit 个解即停，用于复核唯一解
import { geometry, edgeBetween } from './board.js';

const UNK = -1;
const NO = 0;
const YES = 1;

function initState(clues, rows, cols) {
  const geo = geometry(rows, cols);
  const vUnk = new Uint8Array(geo.V);
  for (let v = 0; v < geo.V; v++) vUnk[v] = geo.vertEdges[v].length;
  return {
    geo,
    clues,
    es: new Int8Array(geo.E).fill(UNK),
    vLine: new Uint8Array(geo.V),
    vUnk,
    cLine: new Uint8Array(rows * cols),
    cUnk: new Uint8Array(rows * cols).fill(4),
    lines: 0,
    unknown: geo.E,
    closed: false,
  };
}

function clone(S) {
  return {
    geo: S.geo,
    clues: S.clues,
    es: S.es.slice(),
    vLine: S.vLine.slice(),
    vUnk: S.vUnk.slice(),
    cLine: S.cLine.slice(),
    cUnk: S.cUnk.slice(),
    lines: S.lines,
    unknown: S.unknown,
    closed: S.closed,
  };
}

// 从线数为 1 的点 a 沿线走到另一端，返回 [另一端, 经过的线数]
function walkEnd(S, a) {
  const { geo, es } = S;
  let v = a;
  let prev = -1;
  let len = 0;
  for (;;) {
    let next = -1;
    for (const e of geo.vertEdges[v]) {
      if (es[e] === YES && e !== prev) {
        next = e;
        break;
      }
    }
    if (next < 0) return [v, len];
    len++;
    prev = next;
    v = geo.edgeVerts[2 * next] === v ? geo.edgeVerts[2 * next + 1] : geo.edgeVerts[2 * next];
    if (S.vLine[v] !== 2) return [v, len];
  }
}

// 连上 e（两端分别是同一条路径的两头）能否构成合法的最终回路
function closeOk(S, e, pathLen) {
  if (S.lines !== pathLen) return false;
  const { geo, clues, cLine } = S;
  const c0 = geo.edgeCells[2 * e];
  const c1 = geo.edgeCells[2 * e + 1];
  for (let i = 0; i < clues.length; i++) {
    if (clues[i] < 0) continue;
    const n = cLine[i] + (i === c0 || i === c1 ? 1 : 0);
    if (n !== clues[i]) return false;
  }
  return true;
}

function assign(S, e, val, queue) {
  if (S.es[e] !== UNK) return S.es[e] === val;
  const { geo } = S;
  const a = geo.edgeVerts[2 * e];
  const b = geo.edgeVerts[2 * e + 1];
  if (val === YES) {
    if (S.closed) return false;
    if (S.vLine[a] === 1 && S.vLine[b] === 1) {
      const [end, len] = walkEnd(S, a);
      if (end === b) {
        if (!closeOk(S, e, len)) return false;
        S.closed = true;
      }
    }
  }
  S.es[e] = val;
  S.unknown--;
  S.vUnk[a]--;
  S.vUnk[b]--;
  if (val === YES) {
    S.vLine[a]++;
    S.vLine[b]++;
    S.lines++;
  }
  queue.push(a, b);
  for (const c of [geo.edgeCells[2 * e], geo.edgeCells[2 * e + 1]]) {
    if (c < 0) continue;
    S.cUnk[c]--;
    if (val === YES) S.cLine[c]++;
    queue.push(geo.V + c);
  }
  return true;
}

function setUnknown(S, list, val, queue) {
  for (const e of list) if (S.es[e] === UNK && !assign(S, e, val, queue)) return false;
  return true;
}

// 层级 0 推导，直到没有新结论；出现矛盾返回 false
function propagate(S, queue) {
  const { geo, clues } = S;
  while (queue.length) {
    if (S.closed) {
      for (let e = 0; e < geo.E; e++) if (S.es[e] === UNK && !assign(S, e, NO, queue)) return false;
      queue.length = 0;
      return true;
    }
    const x = queue.pop();
    if (x < geo.V) {
      const l = S.vLine[x];
      const u = S.vUnk[x];
      if (l > 2 || (l === 1 && u === 0)) return false;
      if (!u) continue;
      const list = geo.vertEdges[x];
      if (l === 2 || (l === 0 && u === 1)) {
        if (!setUnknown(S, list, NO, queue)) return false;
      } else if (l === 1 && u === 1) {
        if (!setUnknown(S, list, YES, queue)) return false;
      } else if (l === 1) {
        // 提前闭合：x 是一条路径的一头，另一头与 x 相邻且连上不能构成最终回路 → 打叉
        const [end, len] = walkEnd(S, x);
        const e = edgeBetween(geo, x, end);
        if (e >= 0 && S.es[e] === UNK && !closeOk(S, e, len)) {
          if (!assign(S, e, NO, queue)) return false;
        }
      }
    } else {
      const i = x - geo.V;
      const k = clues[i];
      if (k < 0) continue;
      const l = S.cLine[i];
      const u = S.cUnk[i];
      if (l > k || l + u < k) return false;
      if (!u) continue;
      const list = geo.cellEdges.subarray(4 * i, 4 * i + 4);
      if (l === k) {
        if (!setUnknown(S, list, NO, queue)) return false;
      } else if (l + u === k) {
        if (!setUnknown(S, list, YES, queue)) return false;
      }
    }
  }
  return true;
}

function start(clues, rows, cols) {
  const S = initState(clues, rows, cols);
  const queue = [];
  for (let v = 0; v < S.geo.V; v++) queue.push(v);
  for (let i = 0; i < clues.length; i++) queue.push(S.geo.V + i);
  return propagate(S, queue) ? S : null;
}

const toEdges = (S) => Uint8Array.from(S.es, (s) => (s === YES ? 1 : 0));

// 一步试探直到没有新结论：假设某条未定边为线（或叉），层级 0 推出矛盾就确定为相反状态。
// 返回 -1 = 矛盾，0 = 没有用到试探，1 = 用到了试探
function trialPass(S) {
  let used = 0;
  let progress = true;
  while (progress && !S.closed) {
    progress = false;
    for (let e = 0; e < S.geo.E && !S.closed; e++) {
      if (S.es[e] !== UNK) continue;
      for (const val of [YES, NO]) {
        const T = clone(S);
        const q = [];
        if (assign(T, e, val, q) && propagate(T, q)) continue;
        const q2 = [];
        if (!assign(S, e, 1 - val, q2) || !propagate(S, q2)) return -1;
        progress = true;
        used = 1;
        break;
      }
    }
  }
  return used;
}

// 返回 { solved, level, edges }：level 为实际用到的最高层级；edges 为解（1 = 线）
export function logicSolve(clues, rows, cols, maxLevel = 1) {
  const S = start(clues, rows, cols);
  if (!S) return { solved: false, level: -1 };
  const level = maxLevel >= 1 ? trialPass(S) : 0;
  if (level < 0) return { solved: false, level: -1 };
  return S.closed ? { solved: true, level, edges: toEdges(S) } : { solved: false, level };
}

// 回溯数解：返回 { count, edges }，count 达到 limit 即停；edges 为找到的第一个解。
// 每个节点先做一步试探（只排除推出矛盾的分支，不会漏解），再沿路径端点分支
export function countSolutions(clues, rows, cols, limit = 2) {
  const S0 = start(clues, rows, cols);
  if (!S0) return { count: 0 };
  let count = 0;
  let first = null;
  const search = (S) => {
    if (!S.closed && trialPass(S) < 0) return;
    if (S.closed) {
      count++;
      if (!first) first = toEdges(S);
      return;
    }
    const { geo } = S;
    // 优先延长路径：选一个线数为 1 的点上的未定边
    let pick = -1;
    for (let v = 0; v < geo.V && pick < 0; v++) {
      if (S.vLine[v] !== 1) continue;
      for (const e of geo.vertEdges[v]) {
        if (S.es[e] === UNK) {
          pick = e;
          break;
        }
      }
    }
    if (pick < 0) pick = S.es.indexOf(UNK);
    if (pick < 0) return;
    for (const val of [YES, NO]) {
      const T = clone(S);
      const q = [];
      if (assign(T, pick, val, q) && propagate(T, q)) search(T);
      if (count >= limit) return;
    }
  };
  search(S0);
  return { count, edges: first };
}
