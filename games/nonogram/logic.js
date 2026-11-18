// 数织纯逻辑：提示数计算、行列逻辑求解器、唯一解计数、随机出题、玩家盘面操作、存档。
// 不依赖 DOM，可在 Node 中直接测试。
//
// 格子统一用一维数组，index = y * w + x。
// 求解器中的格子：-1 未知，0 空白，1 涂黑。
// 玩家盘面：EMPTY 未操作，FILL 涂黑，CROSS 打叉（标记空白）。

export const EMPTY = 0;
export const FILL = 1;
export const CROSS = 2;

export const SIZES = [5, 10, 15];

const SAVE_VERSION = 1;

// ---------------------------------------------------------------- 题目

// 一行（列）的提示数：连续涂黑段的长度。全空的行返回 []，界面显示为 0
export function cluesOf(line) {
  const out = [];
  let run = 0;
  for (const v of line) {
    if (v === 1) run++;
    else if (run) {
      out.push(run);
      run = 0;
    }
  }
  if (run) out.push(run);
  return out;
}

export function rowOf(grid, w, y) {
  return Array.from({ length: w }, (_, x) => grid[y * w + x]);
}

export function colOf(grid, w, h, x) {
  return Array.from({ length: h }, (_, y) => grid[y * w + x]);
}

// rows：字符画，'#' 涂黑，其他字符为空白
export function parseRows(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const sol = new Uint8Array(w * h);
  rows.forEach((row, y) => {
    if (row.length !== w) throw new Error(`第 ${y + 1} 行长度 ${row.length} ≠ ${w}`);
    for (let x = 0; x < w; x++) sol[y * w + x] = row[x] === '#' ? 1 : 0;
  });
  return { w, h, sol };
}

export function makePuzzle(rows, meta = {}) {
  const { w, h, sol } = parseRows(rows);
  return {
    ...meta,
    w,
    h,
    sol,
    rows: [...rows],
    rowClues: Array.from({ length: h }, (_, y) => cluesOf(rowOf(sol, w, y))),
    colClues: Array.from({ length: w }, (_, x) => cluesOf(colOf(sol, w, h, x))),
  };
}

// ---------------------------------------------------------------- 单行求解

// 在已知部分格子的前提下，枚举一行所有合法排法，得出每格是否必黑 / 必白。
// 返回新的一行（-1 / 0 / 1）；无合法排法时返回 null。
// 动态规划：can[k][i] = 从第 i 格开始能否放下第 k 段及之后的所有段。O(n × m)。
export function solveLine(clues, line) {
  const n = line.length;
  const m = clues.length;
  // whitePrefix[i]：前 i 格中已知为白的个数，用于 O(1) 判断一段区间能否全部涂黑
  const whitePrefix = new Int32Array(n + 1);
  const blackPrefix = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    whitePrefix[i + 1] = whitePrefix[i] + (line[i] === 0 ? 1 : 0);
    blackPrefix[i + 1] = blackPrefix[i] + (line[i] === 1 ? 1 : 0);
  }
  const canFillRange = (a, b) => b <= n && whitePrefix[b] - whitePrefix[a] === 0;

  // can[k * (n + 2) + i]
  const W = n + 2;
  const can = new Uint8Array((m + 1) * W);
  for (let k = m; k >= 0; k--) {
    for (let i = n; i >= 0; i--) {
      let ok = false;
      if (k === m) {
        ok = blackPrefix[n] - blackPrefix[i] === 0;
      } else if (i < n) {
        if (line[i] !== 1 && can[k * W + i + 1]) ok = true;
        const end = i + clues[k];
        if (!ok && canFillRange(i, end) && (end === n || line[end] !== 1)) {
          const next = end === n ? n : end + 1;
          if (can[(k + 1) * W + next]) ok = true;
        }
      }
      can[k * W + i] = ok ? 1 : 0;
    }
  }
  if (!can[0]) return null;

  const canBlack = new Uint8Array(n);
  const canWhite = new Uint8Array(n);
  const reach = new Uint8Array((m + 1) * W);
  reach[0] = 1;
  for (let i = 0; i <= n; i++) {
    for (let k = 0; k <= m; k++) {
      if (!reach[k * W + i] || !can[k * W + i]) continue;
      if (k === m) {
        for (let j = i; j < n; j++) canWhite[j] = 1;
        continue;
      }
      if (i >= n) continue;
      if (line[i] !== 1 && can[k * W + i + 1]) {
        canWhite[i] = 1;
        reach[k * W + i + 1] = 1;
      }
      const end = i + clues[k];
      if (canFillRange(i, end) && (end === n || line[end] !== 1)) {
        const next = end === n ? n : end + 1;
        if (can[(k + 1) * W + next]) {
          for (let j = i; j < end; j++) canBlack[j] = 1;
          if (end < n) canWhite[end] = 1;
          reach[(k + 1) * W + next] = 1;
        }
      }
    }
  }
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    if (canBlack[i] && canWhite[i]) out[i] = -1;
    else if (canBlack[i]) out[i] = 1;
    else if (canWhite[i]) out[i] = 0;
    else return null;
  }
  return out;
}

// ---------------------------------------------------------------- 整盘逻辑求解

// 只用“单行推理”反复处理每一行、每一列，直到不再有新进展。
// 返回 { status: 'solved' | 'stuck' | 'contradiction', grid, rounds }。
// rounds：扫描轮数（每轮把所有有变化的行列各处理一次），用作难度参考。
export function logicSolve(rowClues, colClues, start) {
  const h = rowClues.length;
  const w = colClues.length;
  const grid = start ? Int8Array.from(start) : new Int8Array(w * h).fill(-1);
  let dirtyRows = new Set(Array.from({ length: h }, (_, y) => y));
  let dirtyCols = new Set(Array.from({ length: w }, (_, x) => x));
  let rounds = 0;
  while (dirtyRows.size || dirtyCols.size) {
    rounds++;
    const nextRows = new Set();
    const nextCols = new Set();
    for (const y of dirtyRows) {
      const line = rowOf(grid, w, y);
      const res = solveLine(rowClues[y], line);
      if (!res) return { status: 'contradiction', grid, rounds };
      for (let x = 0; x < w; x++) {
        if (line[x] === -1 && res[x] !== -1) {
          grid[y * w + x] = res[x];
          nextCols.add(x);
        }
      }
    }
    for (const x of new Set([...dirtyCols, ...nextCols])) {
      const line = colOf(grid, w, h, x);
      const res = solveLine(colClues[x], line);
      if (!res) return { status: 'contradiction', grid, rounds };
      for (let y = 0; y < h; y++) {
        if (line[y] === -1 && res[y] !== -1) {
          grid[y * w + x] = res[y];
          nextRows.add(y);
        }
      }
    }
    dirtyRows = nextRows;
    dirtyCols = new Set();
  }
  const status = grid.includes(-1) ? 'stuck' : 'solved';
  return { status, grid, rounds };
}

// 题目是否“唯一解且可纯逻辑推出”：单行推理就能解完，并且结果与给定答案一致
export function isLogicSolvable(puzzle) {
  const res = logicSolve(puzzle.rowClues, puzzle.colClues);
  if (res.status !== 'solved') return false;
  return res.grid.every((v, i) => v === puzzle.sol[i]);
}

// 解的个数（最多数到 limit 个就停）：单行推理 + 在未知格上分支回溯。
// 与 logicSolve 互相独立地验证唯一性。
export function countSolutions(rowClues, colClues, limit = 2) {
  let count = 0;
  const walk = (start) => {
    if (count >= limit) return;
    const res = logicSolve(rowClues, colClues, start);
    if (res.status === 'contradiction') return;
    if (res.status === 'solved') {
      count++;
      return;
    }
    const i = res.grid.indexOf(-1);
    for (const v of [1, 0]) {
      const next = Int8Array.from(res.grid);
      next[i] = v;
      walk(next);
      if (count >= limit) return;
    }
  };
  walk(null);
  return count;
}

// ---------------------------------------------------------------- 随机出题

// 生成一张随机的、可纯逻辑推出（因而唯一解）的图。
// 做法：按左右对称随机铺格子（更像图案），再用逻辑求解器校验，不通过就重来。
// 返回字符画数组；超过 maxTries 次仍失败返回 null（由调用方改用题库）。
export function generateRandom(size, rng = Math.random, maxTries = 400) {
  const density = size <= 5 ? 0.6 : size <= 10 ? 0.58 : 0.56;
  for (let t = 0; t < maxTries; t++) {
    const symmetric = rng() < 0.6;
    const cells = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const mx = size - 1 - x;
        if (symmetric && mx < x) cells[y * size + x] = cells[y * size + mx];
        else cells[y * size + x] = rng() < density ? 1 : 0;
      }
    }
    const rows = Array.from({ length: size }, (_, y) =>
      Array.from({ length: size }, (_, x) => (cells[y * size + x] ? '#' : '.')).join(''),
    );
    const p = makePuzzle(rows);
    // 至少有一些格子，且每行每列都不能全空（全空行 / 列没有推理乐趣）
    if (p.rowClues.some((c) => !c.length) || p.colClues.some((c) => !c.length)) continue;
    if (isLogicSolvable(p)) return rows;
  }
  return null;
}

// ---------------------------------------------------------------- 玩家盘面

export function createGame(puzzle) {
  return {
    puzzle,
    cells: new Uint8Array(puzzle.w * puzzle.h),
    undo: [],
    elapsed: 0,
    status: 'playing',
  };
}

// 一笔操作：按下时决定“目标值”，拖过的格子都改成这个值。from 是允许被改写的原值。
// 起点格已经是这种标记 → 本笔为擦除（只擦同种标记）；
// 起点格未操作 → 本笔为标记（只改未操作的格子，不覆盖另一种标记）；
// 起点格是另一种标记 → 本笔为改写（未操作格和这种标记都改成当前笔）。
export function strokeAction(cells, startIdx, tool) {
  const mark = tool === 'cross' ? CROSS : FILL;
  const cur = cells[startIdx];
  if (cur === mark) return { from: [mark], to: EMPTY };
  if (cur === EMPTY) return { from: [EMPTY], to: mark };
  return { from: [EMPTY, cur], to: mark };
}

// 一笔 = 按下到松手。按下时确定动作，拖动时沿锁定的行 / 列延伸，往回拉时恢复超出范围的格子。
export function beginStroke(game, start, tool) {
  const stroke = { start, cur: start, axis: null, action: strokeAction(game.cells, start, tool), changed: new Map() };
  extendStroke(game, stroke, start);
  return stroke;
}

// 把这一笔延伸到 cur（会投影到锁定的行 / 列上）。返回本次状态有变化的格子
export function extendStroke(game, stroke, cur) {
  const { w } = game.puzzle;
  if (!stroke.axis && cur !== stroke.start) {
    const dx = Math.abs((cur % w) - (stroke.start % w));
    const dy = Math.abs(Math.floor(cur / w) - Math.floor(stroke.start / w));
    stroke.axis = dx >= dy ? 'row' : 'col';
  }
  const line = strokeLine(w, stroke.start, cur, stroke.axis);
  const keep = new Set(line);
  const touched = [];
  for (const [i, prev] of stroke.changed) {
    if (keep.has(i)) continue;
    game.cells[i] = prev;
    stroke.changed.delete(i);
    touched.push(i);
  }
  for (const i of line) {
    if (stroke.changed.has(i) || !stroke.action.from.includes(game.cells[i])) continue;
    stroke.changed.set(i, game.cells[i]);
    game.cells[i] = stroke.action.to;
    touched.push(i);
  }
  stroke.cur = cur;
  return touched;
}

// 松手：有改动时作为一步记入撤销栈。返回改动的格子数
export function endStroke(game, stroke) {
  const step = [...stroke.changed];
  if (step.length) game.undo.push(step);
  return step.length;
}

export function undo(game) {
  const step = game.undo.pop();
  if (!step) return null;
  for (const [i, prev] of step) game.cells[i] = prev;
  return step.map(([i]) => i);
}

export function resetGame(game) {
  game.cells.fill(EMPTY);
  game.undo = [];
  game.elapsed = 0;
  game.status = 'playing';
}

// 拖动时只沿起点所在的行或列延伸：按第一次离开起点格的方向锁定。
// 返回从起点到当前格（投影到锁定轴上）的所有格子。
export function strokeLine(w, start, cur, axis) {
  const sx = start % w;
  const sy = Math.floor(start / w);
  const cx = cur % w;
  const cy = Math.floor(cur / w);
  const out = [];
  if (axis === 'row') {
    const step = cx >= sx ? 1 : -1;
    for (let x = sx; x !== cx + step; x += step) out.push(sy * w + x);
  } else if (axis === 'col') {
    const step = cy >= sy ? 1 : -1;
    for (let y = sy; y !== cy + step; y += step) out.push(y * w + sx);
  } else {
    out.push(start);
  }
  return out;
}

// 玩家这一行的哪些提示数已经满足（用于置灰）。
// line：玩家盘面的一行（EMPTY / FILL / CROSS）。
// 1) 整行涂黑的段与提示完全一致 → 全部满足；
// 2) 否则从两端向内扫：只要中间没有“未操作”的格子，被打叉或边界封闭的完整段依次与提示对应。
export function clueDone(clues, line) {
  const n = clues.length;
  const done = new Array(n).fill(false);
  const runs = cluesOf(line.map((v) => (v === FILL ? 1 : 0)));
  if (runs.length === n && runs.every((r, k) => r === clues[k])) return done.fill(true);
  if (runs.length > n) return done;

  const scan = (cellsInOrder) => {
    const res = [];
    let run = 0;
    for (const v of cellsInOrder) {
      if (v === FILL) run++;
      else if (v === CROSS) {
        if (run) {
          res.push(run);
          run = 0;
        }
      } else {
        // 遇到未操作格：正在数的这一段没有封闭，不算
        return res;
      }
    }
    if (run) res.push(run);
    return res;
  };
  const left = scan(line);
  const right = scan([...line].reverse());
  // 扫到的段一旦与提示对不上（玩家出错），其后的段都不置灰
  let okLeft = 0;
  while (okLeft < left.length && okLeft < n && left[okLeft] === clues[okLeft]) okLeft++;
  for (let k = 0; k < okLeft; k++) done[k] = true;
  let okRight = 0;
  while (okRight < right.length && okRight < n && right[okRight] === clues[n - 1 - okRight]) okRight++;
  for (let k = 0; k < okRight; k++) done[n - 1 - k] = true;
  return done;
}

export function playerRow(game, y) {
  return rowOf(game.cells, game.puzzle.w, y);
}

export function playerCol(game, x) {
  return colOf(game.cells, game.puzzle.w, game.puzzle.h, x);
}

// 涂黑的格子与答案完全一致即完成（打叉不影响）
export function isWon(game) {
  const { sol } = game.puzzle;
  for (let i = 0; i < sol.length; i++) {
    if ((game.cells[i] === FILL ? 1 : 0) !== sol[i]) return false;
  }
  return true;
}

export function filledCount(game) {
  let n = 0;
  for (const v of game.cells) if (v === FILL) n++;
  return n;
}

// ---------------------------------------------------------------- 存档

export function serialize(game) {
  const p = game.puzzle;
  return {
    v: SAVE_VERSION,
    id: p.id ?? null,
    rows: p.rows,
    cells: Array.from(game.cells).join(''),
    undo: game.undo.slice(-200),
    elapsed: Math.round(game.elapsed),
  };
}

// lookup(id)：根据题号取题库中的题目元数据（名称、颜色等），随机题为 null
export function restoreGame(data, lookup = () => null) {
  try {
    if (!data || data.v !== SAVE_VERSION || !Array.isArray(data.rows)) return null;
    const size = data.rows.length;
    if (!SIZES.includes(size) || data.rows.some((r) => typeof r !== 'string' || r.length !== size)) return null;
    const meta = (data.id && lookup(data.id)) || {};
    if (data.id && !meta.rows) return null;
    if (meta.rows && meta.rows.join() !== data.rows.join()) return null;
    const rest = { ...meta };
    delete rest.rows;
    const puzzle = makePuzzle(data.rows, { ...rest, id: data.id ?? null });
    if (typeof data.cells !== 'string' || data.cells.length !== size * size || /[^012]/.test(data.cells)) return null;
    const game = createGame(puzzle);
    for (let i = 0; i < game.cells.length; i++) game.cells[i] = Number(data.cells[i]);
    const N = size * size;
    const validStep = (s) =>
      Array.isArray(s) &&
      s.every((c) => Array.isArray(c) && Number.isInteger(c[0]) && c[0] >= 0 && c[0] < N && [0, 1, 2].includes(c[1]));
    game.undo = Array.isArray(data.undo) && data.undo.every(validStep) ? data.undo : [];
    game.elapsed = Number.isFinite(data.elapsed) && data.elapsed >= 0 ? data.elapsed : 0;
    if (isWon(game)) return null;
    return game;
  } catch {
    return null;
  }
}
