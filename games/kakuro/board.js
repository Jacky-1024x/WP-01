// 数和对局状态（纯逻辑，无 DOM）：填数、笔记、擦除、撤销/重做、冲突与和的检查、组合栏、提示选择、存档校验。
import { DIFFICULTIES } from './levels.js';
import { buildStructure, validLayout, parseGrid, combosFor, findStep, simpleCandidates, transpose, bit } from './solver.js';

export const HINTS_PER_GAME = 3;

// 盘面结构由答案字符串决定，按字符串缓存，避免反复计算
const cache = new Map();
export function structureOf(g) {
  let st = cache.get(g.grid);
  if (!st) {
    st = buildStructure(g.size, g.solution);
    if (cache.size > 20) cache.clear();
    cache.set(g.grid, st);
  }
  return st;
}

/** grid：n × n 答案字符串（'.' 黑格）；id：题库编号；flip：是否沿对角线翻转过（只做记录） */
export function createGame({ difficulty, grid, id = -1, flip = false }) {
  const size = DIFFICULTIES[difficulty].size;
  const solution = parseGrid(grid, size);
  return {
    difficulty,
    id,
    flip: !!flip,
    size,
    grid,
    solution,
    values: new Array(size * size).fill(0),
    notes: new Array(size * size).fill(0), // 位掩码，第 d 位 = 笔记里有 d
    undo: [],
    redo: [],
    errors: 0,
    hintsLeft: HINTS_PER_GAME,
    hintsUsed: 0,
    autoNotesUsed: false,
    elapsed: 0,
    moves: 0,
    status: 'playing',
  };
}

export const isWhite = (g, i) => g.solution[i] > 0;
export const valueAt = (g, i) => g.values[i];
export const whiteCount = (g) => g.solution.reduce((n, v) => n + (v ? 1 : 0), 0);
export const filledCount = (g) => g.values.reduce((n, v) => n + (v ? 1 : 0), 0);
export const isSolved = (g) => g.solution.every((v, i) => g.values[i] === v);
export const isWrong = (g, i) => !!g.values[i] && g.values[i] !== g.solution[i];
export const hasProgress = (g) => g.moves > 0;
export const wrongCells = (g) => g.values.flatMap((v, i) => (isWrong(g, i) ? [i] : []));

/** 与格子 i 同段（横段或竖段）的其他白格 */
export function peersOf(g, i) {
  const st = structureOf(g);
  const out = new Set();
  for (const k of [st.across[i], st.down[i]]) if (k >= 0) for (const j of st.runs[k].cells) if (j !== i) out.add(j);
  return [...out];
}

// ---------------------------------------------------------------- 修改（每次操作是一条撤销记录）
const change = (g, i, v1, n1) => ({ i, v0: g.values[i], n0: g.notes[i], v1, n1 });

function commit(g, changes) {
  const real = changes.filter((c) => c.v0 !== c.v1 || c.n0 !== c.n1);
  if (!real.length) return null;
  for (const c of real) {
    g.values[c.i] = c.v1;
    g.notes[c.i] = c.n1;
  }
  g.undo.push(real);
  g.redo = [];
  g.moves++;
  return real;
}

function finish(g) {
  if (isSolved(g)) g.status = 'won';
}

/**
 * 在白格 i 填入 d。与格内现有数字相同则视为擦除。
 * autoClear：同段笔记中的 d 自动去掉；countErrors：填错时错误次数 +1
 */
export function setValue(g, i, d, { autoClear = true, countErrors = true } = {}) {
  if (g.status !== 'playing' || !isWhite(g, i) || d < 1 || d > 9) return null;
  if (g.values[i] === d) return erase(g, i);
  const b = bit(d);
  const changes = [change(g, i, d, g.notes[i])];
  if (autoClear) {
    for (const p of peersOf(g, i)) if (!g.values[p] && g.notes[p] & b) changes.push(change(g, p, 0, g.notes[p] & ~b));
  }
  if (!commit(g, changes)) return null;
  const wrong = d !== g.solution[i];
  if (wrong && countErrors) g.errors++;
  finish(g);
  return { type: 'set', cell: i, digit: d, wrong, cleared: changes.slice(1).map((c) => c.i) };
}

/** 擦除：有数字先清数字（笔记随之恢复显示），否则清空笔记 */
export function erase(g, i) {
  if (g.status !== 'playing' || !isWhite(g, i)) return null;
  const c = g.values[i] ? change(g, i, 0, g.notes[i]) : change(g, i, 0, 0);
  return commit(g, [c]) ? { type: 'erase', cell: i } : null;
}

export function toggleNote(g, i, d) {
  if (g.status !== 'playing' || !isWhite(g, i) || g.values[i]) return null;
  return commit(g, [change(g, i, 0, g.notes[i] ^ bit(d))]) ? { type: 'note', cell: i, digit: d } : null;
}

/** 自动笔记：所有空格写入“只看所在两段”时的候选数（覆盖原有笔记），作为一步可撤销 */
export function autoNotes(g) {
  if (g.status !== 'playing') return null;
  const st = structureOf(g);
  const changes = [];
  for (let i = 0; i < g.values.length; i++) {
    if (isWhite(g, i) && !g.values[i]) changes.push(change(g, i, 0, simpleCandidates(st, g.values, i)));
  }
  if (!commit(g, changes)) return null;
  g.autoNotesUsed = true;
  return { type: 'autoNotes' };
}

export const hasNotes = (g) => g.notes.some((n, i) => n && !g.values[i]);

export function undo(g) {
  if (g.status !== 'playing' || !g.undo.length) return null;
  const changes = g.undo.pop();
  for (const c of changes) {
    g.values[c.i] = c.v0;
    g.notes[c.i] = c.n0;
  }
  g.redo.push(changes);
  return changes;
}

export function redo(g) {
  if (g.status !== 'playing' || !g.redo.length) return null;
  const changes = g.redo.pop();
  for (const c of changes) {
    g.values[c.i] = c.v1;
    g.notes[c.i] = c.n1;
  }
  g.undo.push(changes);
  finish(g);
  return changes;
}

/** 清空所有填入和笔记，从头再做（计时、提示、错误都重置） */
export function resetGame(g) {
  return createGame(g);
}

// ---------------------------------------------------------------- 规则检查
/**
 * 按规则（不看答案）检查当前盘面：
 * cells：同段内数字重复的格子；runs：和不符的段（已填之和超过提示数，或填满后不相等）
 */
export function conflicts(g) {
  const st = structureOf(g);
  const cells = new Set();
  const runs = new Set();
  st.runs.forEach((run, k) => {
    const seen = {};
    let sum = 0;
    let filled = 0;
    for (const j of run.cells) {
      const v = g.values[j];
      if (!v) continue;
      (seen[v] ||= []).push(j);
      sum += v;
      filled++;
    }
    for (const list of Object.values(seen)) if (list.length > 1) list.forEach((j) => cells.add(j));
    if (sum > run.sum || (filled === run.cells.length && sum !== run.sum)) runs.add(k);
  });
  return { cells, runs };
}

/** 某段是否已完成：strict 时要求全部与答案一致，否则要求填满、不重复、和正确 */
export function runDone(g, k, strict) {
  const run = structureOf(g).runs[k];
  let m = 0;
  let sum = 0;
  for (const j of run.cells) {
    const v = g.values[j];
    if (!v || (strict && v !== g.solution[j]) || m & bit(v)) return false;
    m |= bit(v);
    sum += v;
  }
  return sum === run.sum;
}

/**
 * 组合栏数据：某段的和、格数、与已填数字相容的组合。
 * 返回 { sum, len, placed（已填数字掩码）, dup（已填数字有重复）, combos（掩码数组） }
 */
export function runCombos(g, k) {
  const run = structureOf(g).runs[k];
  let placed = 0;
  let dup = false;
  for (const j of run.cells) {
    const v = g.values[j];
    if (!v) continue;
    if (placed & bit(v)) dup = true;
    placed |= bit(v);
  }
  const combos = dup ? [] : combosFor(run.sum, run.cells.length, placed);
  return { sum: run.sum, len: run.cells.length, placed, dup, combos };
}

// ---------------------------------------------------------------- 提示
/**
 * 决定提示内容（不消耗次数）：
 * 1. 有填错的格子 → 指出错误；2. 笔记漏掉正确答案 → 指出该格；3. 求解器找最早能确定的空格；4. 兜底直接给一格答案
 */
export function pickHint(g, rng = Math.random) {
  const wrong = wrongCells(g);
  if (wrong.length) return { kind: 'wrong', cell: wrong[0] };
  for (let i = 0; i < g.values.length; i++) {
    if (isWhite(g, i) && !g.values[i] && g.notes[i] && !(g.notes[i] & bit(g.solution[i]))) return { kind: 'note', cell: i };
  }
  const st = structureOf(g);
  const step = findStep(st, g.values);
  if (step && step.digit === g.solution[step.cell]) return { kind: 'step', ...step };
  const empty = [];
  for (let i = 0; i < g.values.length; i++) if (isWhite(g, i) && !g.values[i]) empty.push(i);
  if (!empty.length) return null;
  const cell = empty[Math.floor(rng() * empty.length)];
  return { kind: 'fallback', cell, digit: g.solution[cell] };
}

export function useHint(g) {
  if (g.status !== 'playing' || g.hintsLeft <= 0) return false;
  g.hintsLeft--;
  g.hintsUsed++;
  return true;
}

// ---------------------------------------------------------------- 存档
function validStack(stack, N) {
  return (
    Array.isArray(stack) &&
    stack.every(
      (changes) =>
        Array.isArray(changes) &&
        changes.every(
          (c) =>
            c &&
            Number.isInteger(c.i) && c.i >= 0 && c.i < N &&
            [c.v0, c.v1].every((v) => Number.isInteger(v) && v >= 0 && v <= 9) &&
            [c.n0, c.n1].every((n) => Number.isInteger(n) && n >= 0 && n <= 0x3fe),
        ),
    )
  );
}

/** 校验并还原存档；任何不一致都返回 null */
export function restoreGame(s) {
  if (!s || typeof s !== 'object' || !DIFFICULTIES[s.difficulty]) return null;
  const size = DIFFICULTIES[s.difficulty].size;
  const N = size * size;
  const solution = parseGrid(s.grid, size);
  if (!solution) return null;
  const st = buildStructure(size, solution);
  if (!st.white.some(Boolean) || !validLayout(st, solution)) return null;
  for (let i = 0; i < size; i++) if (solution[i] || solution[i * size]) return null;
  const okArr = (a, max) => Array.isArray(a) && a.length === N && a.every((v) => Number.isInteger(v) && v >= 0 && v <= max);
  if (!okArr(s.values, 9) || !okArr(s.notes, 0x3fe)) return null;
  if (s.values.some((v, i) => (v || s.notes[i]) && !solution[i])) return null;
  const nums = ['errors', 'hintsLeft', 'hintsUsed', 'elapsed', 'moves'];
  if (!nums.every((k) => Number.isFinite(s[k]) && s[k] >= 0)) return null;
  if (s.hintsLeft > HINTS_PER_GAME) return null;
  const g = createGame({ difficulty: s.difficulty, grid: s.grid, id: Number.isInteger(s.id) ? s.id : -1, flip: s.flip });
  g.values = s.values.slice();
  g.notes = s.notes.slice();
  for (const k of nums) g[k] = s[k];
  g.autoNotesUsed = !!s.autoNotesUsed;
  if (validStack(s.undo, N) && validStack(s.redo, N)) {
    g.undo = s.undo;
    g.redo = s.redo;
  }
  finish(g);
  return g;
}

// ---------------------------------------------------------------- 题库取题
/**
 * 从题库取一道题：优先没玩过的（seen 为已玩过的编号列表），随机决定是否翻转。
 * 返回 { id, grid, flip, seen（更新后的已玩列表） }
 */
export function pickFromBank(list, size, seen = [], rng = Math.random) {
  if (!Array.isArray(seen)) seen = [];
  let pool = list.map((_, k) => k).filter((k) => !seen.includes(k));
  if (!pool.length) {
    seen = [];
    pool = list.map((_, k) => k);
  }
  const id = pool[Math.floor(rng() * pool.length)];
  const flip = rng() < 0.5;
  const grid = flip ? transpose(list[id], size) : list[id];
  return { id, grid, flip, seen: [...seen, id] };
}
