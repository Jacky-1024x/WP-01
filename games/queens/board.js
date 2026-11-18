// 皇后：盘面数据与规则判定（纯逻辑，不依赖 DOM，可在 Node 中测试）
// 盘面 marks[i]：EMPTY 空 / CROSS 玩家打的叉 / QUEEN 皇后。
// 规则按“每行、每列、每个区域恰好 k 个”参数化，k = 1 为皇后，k = 2 为星战。

export const EMPTY = 0;
export const CROSS = 1;
export const QUEEN = 2;

export const SIZES = [5, 6, 7, 8, 9, 10];
export const SAVE_VERSION = 1;

export const rowOf = (n, i) => Math.floor(i / n);
export const colOf = (n, i) => i % n;

export function neighbors8(n, i) {
  const r = rowOf(n, i);
  const c = colOf(n, i);
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (rr >= 0 && rr < n && cc >= 0 && cc < n) out.push(rr * n + cc);
    }
  }
  return out;
}

export function neighbors4(n, i) {
  const r = rowOf(n, i);
  const c = colOf(n, i);
  const out = [];
  if (r > 0) out.push(i - n);
  if (r < n - 1) out.push(i + n);
  if (c > 0) out.push(i - 1);
  if (c < n - 1) out.push(i + 1);
  return out;
}

export const isAdjacent = (n, a, b) =>
  a !== b && Math.abs(rowOf(n, a) - rowOf(n, b)) <= 1 && Math.abs(colOf(n, a) - colOf(n, b)) <= 1;

// 所有约束单元：行、列、区域，每个单元是格子下标数组
export function units(n, regions) {
  const rows = [];
  const cols = [];
  const regs = [];
  for (let k = 0; k < n; k++) {
    rows.push([]);
    cols.push([]);
    regs.push([]);
  }
  for (let i = 0; i < n * n; i++) {
    rows[rowOf(n, i)].push(i);
    cols[colOf(n, i)].push(i);
    regs[regions[i]].push(i);
  }
  return [
    ...rows.map((cells, idx) => ({ kind: 'row', idx, cells })),
    ...cols.map((cells, idx) => ({ kind: 'col', idx, cells })),
    ...regs.map((cells, idx) => ({ kind: 'region', idx, cells })),
  ];
}

// 两格是否“互相攻击”：同行、同列、同区域或相邻
export function attacks(n, regions, a, b) {
  if (a === b) return false;
  return rowOf(n, a) === rowOf(n, b) || colOf(n, a) === colOf(n, b) || regions[a] === regions[b] || isAdjacent(n, a, b);
}

export const queensOf = (marks) => marks.reduce((acc, m, i) => (m === QUEEN ? (acc.push(i), acc) : acc), []);

// 规则检查。返回冲突的皇后格（同单元超过 k 个，或相邻）与“已放不下”的单元
export function check(n, regions, marks, k = 1) {
  const queens = queensOf(marks);
  const bad = new Set();
  for (let x = 0; x < queens.length; x++) {
    for (let y = x + 1; y < queens.length; y++) {
      if (isAdjacent(n, queens[x], queens[y])) {
        bad.add(queens[x]);
        bad.add(queens[y]);
      }
    }
  }
  const avail = available(n, regions, marks, k);
  const dead = [];
  for (const u of units(n, regions)) {
    const qs = u.cells.filter((i) => marks[i] === QUEEN);
    if (qs.length > k) for (const q of qs) bad.add(q);
    // 单元还缺 need 个，但剩余可放的格子不够
    const need = k - qs.length;
    if (need > 0 && u.cells.filter((i) => avail[i]).length < need) dead.push(u);
  }
  return { bad, dead, queens: queens.length };
}

// 空格是否仍可放：没打叉、且不与任何已放皇后冲突（k = 1 时同单元也算冲突）
export function available(n, regions, marks, k = 1) {
  const queens = queensOf(marks);
  const out = new Array(n * n).fill(false);
  for (let i = 0; i < n * n; i++) {
    if (marks[i] !== EMPTY) continue;
    out[i] = !queens.some((q) => (k === 1 ? attacks(n, regions, q, i) : isAdjacent(n, q, i)));
  }
  if (k > 1) {
    // 已满 k 个的单元，其余格子不可放
    for (const u of units(n, regions)) {
      if (u.cells.filter((i) => marks[i] === QUEEN).length >= k) for (const i of u.cells) out[i] = false;
    }
  }
  return out;
}

// 被皇后攻击的空格（自动打叉显示用）
export function autoCrosses(n, regions, marks, k = 1) {
  const avail = available(n, regions, marks, k);
  const out = new Set();
  for (let i = 0; i < n * n; i++) if (marks[i] === EMPTY && !avail[i]) out.add(i);
  return out;
}

export function isSolved(n, regions, marks, k = 1) {
  const { bad, queens } = check(n, regions, marks, k);
  if (queens !== n * k || bad.size) return false;
  return units(n, regions).every((u) => u.cells.filter((i) => marks[i] === QUEEN).length === k);
}

// 区域合法：0..n-1 各至少一格，且每个区域四连通
export function regionsValid(n, regions) {
  if (regions.length !== n * n) return false;
  for (let r = 0; r < n; r++) {
    const cells = [];
    for (let i = 0; i < n * n; i++) if (regions[i] === r) cells.push(i);
    if (!cells.length) return false;
    const seen = new Set([cells[0]]);
    const stack = [cells[0]];
    while (stack.length) {
      const i = stack.pop();
      for (const j of neighbors4(n, i)) {
        if (regions[j] === r && !seen.has(j)) {
          seen.add(j);
          stack.push(j);
        }
      }
    }
    if (seen.size !== cells.length) return false;
  }
  return regions.every((r) => r >= 0 && r < n);
}

// ---------------------------------------------------------------- 对局与撤销
export function createGame(puzzle) {
  return {
    v: SAVE_VERSION,
    n: puzzle.n,
    regions: puzzle.regions.slice(),
    solution: puzzle.solution.slice(),
    marks: new Array(puzzle.n * puzzle.n).fill(EMPTY),
    undo: [],
    elapsed: 0,
    hints: 0,
    status: 'playing',
  };
}

// 一次操作 = 若干格的修改 [[i, 旧值, 新值], ...]；merge 为真时并入上一步（双击、拖动）
export function setMarks(game, list, merge = false) {
  const changes = [];
  for (const [i, v] of list) {
    if (game.marks[i] === v) continue;
    changes.push([i, game.marks[i], v]);
    game.marks[i] = v;
  }
  if (!changes.length) return changes;
  if (merge && game.undo.length) game.undo[game.undo.length - 1].push(...changes);
  else game.undo.push(changes);
  return changes;
}

export function undo(game) {
  const changes = game.undo.pop();
  if (!changes) return null;
  for (let x = changes.length - 1; x >= 0; x--) game.marks[changes[x][0]] = changes[x][1];
  return changes;
}

export const nextCycle = (m) => (m === EMPTY ? CROSS : m === CROSS ? QUEEN : EMPTY);

export function restoreGame(data) {
  try {
    if (!data || data.v !== SAVE_VERSION || !SIZES.includes(data.n)) return null;
    const { n } = data;
    if (!regionsValid(n, data.regions)) return null;
    if (!Array.isArray(data.marks) || data.marks.length !== n * n) return null;
    if (!data.marks.every((m) => m === EMPTY || m === CROSS || m === QUEEN)) return null;
    if (!Array.isArray(data.solution) || data.solution.length !== n) return null;
    if (!Array.isArray(data.undo)) return null;
    return {
      ...data,
      elapsed: Number(data.elapsed) || 0,
      hints: Number(data.hints) || 0,
      status: data.status === 'won' ? 'won' : 'playing',
    };
  } catch {
    return null;
  }
}
