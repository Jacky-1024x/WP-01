// 数独对局状态（纯逻辑，无 DOM）：填数、笔记、擦除、撤销/重做、冲突检测、提示选择、存档校验。
import { PEERS, UNITS, candidatesOf, findHint } from './solver.js';
import { DIFFICULTIES } from './generator.js';

export const HINTS_PER_GAME = 3;

export function createGame({ difficulty, puzzle, solution }) {
  return {
    difficulty,
    puzzle: puzzle.slice(),
    solution: solution.slice(),
    values: new Array(81).fill(0),
    notes: new Array(81).fill(0), // 位掩码，第 d 位 = 笔记里有 d
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

export const isGiven = (g, i) => g.puzzle[i] !== 0;
export const valueAt = (g, i) => g.puzzle[i] || g.values[i];
export const currentGrid = (g) => g.puzzle.map((v, i) => v || g.values[i]);
export const filledCount = (g) => g.puzzle.reduce((n, v, i) => n + (v || g.values[i] ? 1 : 0), 0);
export const isSolved = (g) => g.solution.every((v, i) => valueAt(g, i) === v);
export const isWrong = (g, i) => !!g.values[i] && g.values[i] !== g.solution[i];
export const hasProgress = (g) => g.moves > 0;

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
 * 在格子 i 填入 d。与格内现有数字相同则视为擦除。
 * autoClear：同行、同列、同宫笔记中的 d 自动去掉；countErrors：填错时错误次数 +1
 */
export function setValue(g, i, d, { autoClear = true, countErrors = true } = {}) {
  if (g.status !== 'playing' || isGiven(g, i)) return null;
  if (g.values[i] === d) return erase(g, i);
  const bit = 1 << d;
  const changes = [change(g, i, d, g.notes[i])];
  if (autoClear) {
    for (const p of PEERS[i]) if (g.notes[p] & bit) changes.push(change(g, p, g.values[p], g.notes[p] & ~bit));
  }
  if (!commit(g, changes)) return null;
  const wrong = d !== g.solution[i];
  if (wrong && countErrors) g.errors++;
  finish(g);
  return { type: 'set', cell: i, digit: d, wrong, cleared: changes.slice(1).map((c) => c.i) };
}

/** 擦除：有数字先清数字（笔记随之恢复显示），否则清空笔记 */
export function erase(g, i) {
  if (g.status !== 'playing' || isGiven(g, i)) return null;
  const c = g.values[i] ? change(g, i, 0, g.notes[i]) : change(g, i, 0, 0);
  return commit(g, [c]) ? { type: 'erase', cell: i } : null;
}

export function toggleNote(g, i, d) {
  if (g.status !== 'playing' || valueAt(g, i)) return null;
  return commit(g, [change(g, i, 0, g.notes[i] ^ (1 << d))]) ? { type: 'note', cell: i, digit: d } : null;
}

/** 自动笔记：所有空格写入当前合法的候选数（覆盖原有笔记），作为一步可撤销 */
export function autoNotes(g) {
  if (g.status !== 'playing') return null;
  const grid = currentGrid(g);
  const changes = [];
  for (let i = 0; i < 81; i++) if (!grid[i]) changes.push(change(g, i, 0, candidatesOf(grid, i)));
  if (!commit(g, changes)) return null;
  g.autoNotesUsed = true;
  return { type: 'autoNotes' };
}

export const hasNotes = (g) => g.notes.some((n, i) => n && !valueAt(g, i));

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

// ---------------------------------------------------------------- 查询
/** 违反规则的格子：同一区域内重复出现的数字，所在格全部返回 */
export function conflicts(g) {
  const out = new Set();
  for (const unit of UNITS) {
    const seen = {};
    for (const i of unit) {
      const v = valueAt(g, i);
      if (v) (seen[v] ||= []).push(i);
    }
    for (const cells of Object.values(seen)) if (cells.length > 1) cells.forEach((i) => out.add(i));
  }
  return out;
}

export const wrongCells = (g) => g.values.flatMap((v, i) => (isWrong(g, i) ? [i] : []));

/** 某数字已放好的个数：strict 时只算正确的，否则只要不冲突就算 */
export function placedCount(g, d, strict, conflictSet = conflicts(g)) {
  let n = 0;
  for (let i = 0; i < 81; i++) {
    if (valueAt(g, i) !== d) continue;
    if (strict ? g.puzzle[i] || g.values[i] === g.solution[i] : !conflictSet.has(i)) n++;
  }
  return n;
}

/** 区域是否已完成：strict 时要求全部正确，否则要求填满且不重复 */
export function unitDone(g, u, strict) {
  const seen = new Set();
  for (const i of UNITS[u]) {
    const v = valueAt(g, i);
    if (!v || (strict && v !== g.solution[i])) return false;
    seen.add(v);
  }
  return seen.size === 9;
}

// ---------------------------------------------------------------- 提示
/**
 * 决定提示内容（不消耗次数）：
 * 1. 有填错的格子 → 指出错误；2. 笔记漏掉正确答案 → 指出该格；3. 逻辑求解器找下一步；4. 兜底直接给一格答案
 */
export function pickHint(g, rng = Math.random) {
  const wrong = wrongCells(g);
  if (wrong.length) return { kind: 'wrong', cell: wrong[0] };
  for (let i = 0; i < 81; i++) {
    if (!valueAt(g, i) && g.notes[i] && !(g.notes[i] & (1 << g.solution[i]))) return { kind: 'note', cell: i };
  }
  const step = findHint(currentGrid(g));
  if (step && step.digit === g.solution[step.cell]) return { kind: 'step', ...step };
  const empty = [];
  for (let i = 0; i < 81; i++) if (!valueAt(g, i)) empty.push(i);
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
const isDigitArray = (a, max) => Array.isArray(a) && a.length === 81 && a.every((v) => Number.isInteger(v) && v >= 0 && v <= max);

function validSolution(sol) {
  return sol.every((v) => v >= 1) && UNITS.every((u) => new Set(u.map((i) => sol[i])).size === 9);
}

function validStack(stack) {
  return (
    Array.isArray(stack) &&
    stack.every(
      (changes) =>
        Array.isArray(changes) &&
        changes.every(
          (c) =>
            c &&
            Number.isInteger(c.i) && c.i >= 0 && c.i < 81 &&
            [c.v0, c.v1].every((v) => Number.isInteger(v) && v >= 0 && v <= 9) &&
            [c.n0, c.n1].every((n) => Number.isInteger(n) && n >= 0 && n <= 0x3fe),
        ),
    )
  );
}

/** 校验并还原存档；任何不一致都返回 null */
export function restoreGame(s) {
  if (!s || typeof s !== 'object' || !DIFFICULTIES[s.difficulty]) return null;
  if (!isDigitArray(s.puzzle, 9) || !isDigitArray(s.solution, 9) || !isDigitArray(s.values, 9)) return null;
  if (!Array.isArray(s.notes) || s.notes.length !== 81 || !s.notes.every((n) => Number.isInteger(n) && n >= 0 && n <= 0x3fe)) return null;
  if (!validSolution(s.solution)) return null;
  if (s.puzzle.some((v, i) => v && (v !== s.solution[i] || s.values[i]))) return null;
  const nums = ['errors', 'hintsLeft', 'hintsUsed', 'elapsed', 'moves'];
  if (!nums.every((k) => Number.isFinite(s[k]) && s[k] >= 0)) return null;
  if (s.hintsLeft > HINTS_PER_GAME) return null;
  const g = createGame(s);
  g.values = s.values.slice();
  g.notes = s.notes.slice();
  for (const k of nums) g[k] = s[k];
  g.autoNotesUsed = !!s.autoNotesUsed;
  if (validStack(s.undo) && validStack(s.redo)) {
    g.undo = s.undo;
    g.redo = s.redo;
  }
  finish(g);
  return g;
}
