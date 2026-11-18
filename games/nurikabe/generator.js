// 数墙出题（纯逻辑，不依赖 DOM）：只用于离线出题脚本 scripts/gen-nurikabe-bank.mjs。
import { solve } from './solver.js';

function neighbors(i, w, h) {
  const x = i % w;
  const y = (i / w) | 0;
  const list = [];
  if (y > 0) list.push(i - w);
  if (x > 0) list.push(i - 1);
  if (x < w - 1) list.push(i + 1);
  if (y < h - 1) list.push(i + w);
  return list;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 白格连通块编号：label[i] = 岛编号（黑格为 -1），sizes[岛编号] = 格数
function islands(black, w, h) {
  const N = w * h;
  const label = new Int32Array(N).fill(-1);
  const sizes = [];
  for (let s = 0; s < N; s++) {
    if (black[s] || label[s] >= 0) continue;
    const id = sizes.length;
    const stack = [s];
    label[s] = id;
    let n = 0;
    while (stack.length) {
      const v = stack.pop();
      n++;
      for (const u of neighbors(v, w, h)) {
        if (!black[u] && label[u] < 0) {
          label[u] = id;
          stack.push(u);
        }
      }
    }
    sizes.push(n);
  }
  return { label, sizes };
}

function wallConnected(black, w, h) {
  const N = w * h;
  let start = -1;
  let total = 0;
  for (let i = 0; i < N; i++) {
    if (black[i]) {
      total++;
      if (start < 0) start = i;
    }
  }
  if (total <= 1) return true;
  const seen = new Uint8Array(N);
  const stack = [start];
  seen[start] = 1;
  let got = 0;
  while (stack.length) {
    const v = stack.pop();
    got++;
    for (const u of neighbors(v, w, h)) {
      if (black[u] && !seen[u]) {
        seen[u] = 1;
        stack.push(u);
      }
    }
  }
  return got === total;
}

// 把 i 改白后的岛屿大小；超过 maxIsland 或墙断开则返回 0
function tryWhiten(black, i, w, h, maxIsland) {
  const { label, sizes } = islands(black, w, h);
  const ids = new Set();
  for (const u of neighbors(i, w, h)) if (!black[u]) ids.add(label[u]);
  let size = 1;
  for (const id of ids) size += sizes[id];
  if (size > maxIsland) return 0;
  black[i] = 0;
  if (!wallConnected(black, w, h)) {
    black[i] = 1;
    return 0;
  }
  return size;
}

function blackWindows(black, w, h) {
  const list = [];
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const a = y * w + x;
      if (black[a] && black[a + 1] && black[a + w] && black[a + w + 1]) list.push([a, a + 1, a + w, a + w + 1]);
    }
  }
  return list;
}

/** 随机生成满足规则的答案盘面（Uint8Array，1 = 黑格）；失败返回 null */
export function randomSolution(w, h, { maxIsland, grow = 0, prefer = 0 }, rng = Math.random) {
  const black = new Uint8Array(w * h).fill(1);
  for (;;) {
    const wins = shuffle(blackWindows(black, w, h), rng);
    if (!wins.length) break;
    let done = false;
    for (const win of wins) {
      // 按 prefer 的概率优先让已有的岛长大，减少大小为 1 的岛
      const order = shuffle(win.slice(), rng);
      if (rng() < prefer) {
        const grows = (i) => neighbors(i, w, h).some((u) => !black[u]);
        order.sort((a, b) => grows(b) - grows(a));
      }
      for (const i of order) {
        if (tryWhiten(black, i, w, h, maxIsland)) {
          done = true;
          break;
        }
      }
      if (done) break;
    }
    if (!done) return null;
  }
  // 额外长大一些岛，让岛屿大小更有变化
  for (let k = 0; k < grow; k++) {
    const i = Math.floor(rng() * w * h);
    if (black[i] && neighbors(i, w, h).some((u) => !black[u])) tryWhiten(black, i, w, h, maxIsland);
  }
  return black;
}

/** 在每个岛里随机放一个数字，返回 clues 数组（0 = 无数字） */
export function placeClues(black, w, h, rng = Math.random) {
  const { label, sizes } = islands(black, w, h);
  const members = sizes.map(() => []);
  for (let i = 0; i < w * h; i++) if (label[i] >= 0) members[label[i]].push(i);
  const clues = new Array(w * h).fill(0);
  members.forEach((cells, id) => {
    clues[cells[Math.floor(rng() * cells.length)]] = sizes[id];
  });
  return clues;
}

/**
 * 生成一道唯一解的题；tries 次内失败返回 null。
 * 返回 { clues, solution }，solution 为 Uint8Array（1 = 黑格）。
 */
export function makePuzzle(w, h, opts, rng = Math.random, tries = 50) {
  for (let t = 0; t < tries; t++) {
    const black = randomSolution(w, h, opts, rng);
    if (!black) continue;
    for (let c = 0; c < (opts.clueTries ?? 4); c++) {
      const clues = placeClues(black, w, h, rng);
      const res = solve(w, h, clues, { limit: 2, maxShapes: opts.maxShapes ?? 60000, maxNodes: opts.maxNodes ?? 20000 });
      if (res.count === 1) return { clues, solution: res.solution };
    }
  }
  return null;
}
