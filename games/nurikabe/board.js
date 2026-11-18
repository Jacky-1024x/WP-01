// 数墙纯逻辑（不依赖 DOM）：盘面、状态循环、拖动连涂、撤销栈、违规检测、完成判定、等价变换。
// 盘面用一维数组存储，index = y * size + x。

export const EMPTY = 0;
export const BLACK = 1;
export const DOT = 2;

export const LEVELS = {
  easy: { size: 5, name: '5×5' },
  medium: { size: 7, name: '7×7' },
  hard: { size: 10, name: '10×10' },
};
export const LEVEL_IDS = Object.keys(LEVELS);

// ---------------------------------------------------------------- 编码与变换
export const encodePuzzle = (clues) => clues.map((v) => (v ? String(v) : '.')).join('');
export const encodeSolution = (black) => Array.from(black, (b) => (b ? '#' : '.')).join('');
export const decodePuzzle = (str) => Array.from(str, (c) => (c === '.' ? 0 : Number(c)));
export const decodeSolution = (str) => Uint8Array.from(str, (c) => (c === '#' ? 1 : 0));

/** 正方形的 8 种对称变换：t & 4 转置，t & 1 左右翻转，t & 2 上下翻转。返回格子 i 变换后的位置 */
export function transformIndex(i, n, t) {
  let x = i % n;
  let y = Math.floor(i / n);
  if (t & 4) [x, y] = [y, x];
  if (t & 1) x = n - 1 - x;
  if (t & 2) y = n - 1 - y;
  return y * n + x;
}

export function transformArray(arr, n, t) {
  const out = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[transformIndex(i, n, t)] = arr[i];
  return out;
}

export function neighbors(i, n) {
  const x = i % n;
  const list = [];
  if (i >= n) list.push(i - n);
  if (x > 0) list.push(i - 1);
  if (x < n - 1) list.push(i + 1);
  if (i < n * n - n) list.push(i + n);
  return list;
}

// ---------------------------------------------------------------- 对局
/**
 * entry：题库中的一项 [题面, 答案]；t：变换编号 0–7。
 * clues[i] > 0 为数字格；cells[i] 为玩家状态（数字格恒为 EMPTY）。
 */
export function createGame(level, index, t, entry) {
  const size = LEVELS[level].size;
  const clues = transformArray(decodePuzzle(entry[0]), size, t);
  const solution = transformArray(Array.from(decodeSolution(entry[1])), size, t);
  return {
    level,
    index,
    t,
    size,
    clues,
    blackTotal: solution.reduce((a, b) => a + b, 0),
    cells: new Uint8Array(size * size),
    undo: [],
    redo: [],
    elapsed: 0,
    status: 'playing',
  };
}

export const isClue = (game, i) => game.clues[i] > 0;
export const nextState = (s) => (s + 1) % 3; // 空 → 黑 → 白点 → 空
export const blackCount = (game) => game.cells.reduce((a, s) => a + (s === BLACK), 0);
export const touched = (game) => game.undo.length > 0;

/** 一笔开始：返回本笔的目标状态。alt（右键）只在「白点 ↔ 空」之间切换。数字格返回 null */
export function strokeTarget(game, i, alt = false) {
  if (game.status !== 'playing' || isClue(game, i)) return null;
  const s = game.cells[i];
  if (alt) return s === DOT ? EMPTY : DOT;
  return nextState(s);
}

export const newStroke = (target) => ({ target, changes: [] });

/** 把格子 i 设为本笔的目标状态；有改动返回 true */
export function paint(game, stroke, i) {
  if (game.status !== 'playing' || isClue(game, i)) return false;
  const from = game.cells[i];
  if (from === stroke.target) return false;
  if (stroke.changes.some((c) => c[0] === i)) return false; // 同一笔中每格只改一次
  game.cells[i] = stroke.target;
  stroke.changes.push([i, from, stroke.target]);
  return true;
}

/** 一笔结束：入撤销栈、清空重做栈、判定完成。返回是否刚刚完成 */
export function commitStroke(game, stroke) {
  if (!stroke.changes.length) return false;
  game.undo.push(stroke.changes);
  game.redo = [];
  return checkWin(game);
}

/** 清空所有黑格和白点，作为一步入撤销栈 */
export function clearAll(game) {
  if (game.status !== 'playing') return false;
  const changes = [];
  for (let i = 0; i < game.cells.length; i++) {
    if (game.cells[i] !== EMPTY) {
      changes.push([i, game.cells[i], EMPTY]);
      game.cells[i] = EMPTY;
    }
  }
  if (!changes.length) return false;
  game.undo.push(changes);
  game.redo = [];
  return true;
}

/** 撤销一步，返回改动过的格子；无可撤销返回 null */
export function undo(game) {
  if (game.status !== 'playing' || !game.undo.length) return null;
  const changes = game.undo.pop();
  for (let k = changes.length - 1; k >= 0; k--) game.cells[changes[k][0]] = changes[k][1];
  game.redo.push(changes);
  return changes.map((c) => c[0]);
}

/** 重做一步，返回改动过的格子；无可重做返回 null。重做后也可能完成 */
export function redo(game) {
  if (game.status !== 'playing' || !game.redo.length) return null;
  const changes = game.redo.pop();
  for (const [i, , to] of changes) game.cells[i] = to;
  game.undo.push(changes);
  checkWin(game);
  return changes.map((c) => c[0]);
}

function checkWin(game) {
  if (!isSolved(game.size, game.clues, game.cells)) return false;
  game.status = 'won';
  return true;
}

// ---------------------------------------------------------------- 规则
// 按条件 inSet(i) 求连通块，返回块的格子数组列表
function components(n, inSet) {
  const N = n * n;
  const seen = new Uint8Array(N);
  const out = [];
  for (let s = 0; s < N; s++) {
    if (seen[s] || !inSet(s)) continue;
    const comp = [s];
    seen[s] = 1;
    for (let k = 0; k < comp.length; k++) {
      for (const u of neighbors(comp[k], n)) {
        if (!seen[u] && inSet(u)) {
          seen[u] = 1;
          comp.push(u);
        }
      }
    }
    out.push(comp);
  }
  return out;
}

/** 所有 2×2 全黑块的左上角格子 */
export function blackSquares(n, isBlack) {
  const list = [];
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const a = y * n + x;
      if (isBlack(a) && isBlack(a + 1) && isBlack(a + n) && isBlack(a + n + 1)) list.push(a);
    }
  }
  return list;
}

/** 完成判定：未涂黑的格子都视为白格 */
export function isSolved(n, clues, cells) {
  const isBlack = (i) => cells[i] === BLACK && !(clues[i] > 0);
  if (blackSquares(n, isBlack).length) return false;
  if (components(n, isBlack).length > 1) return false;
  for (const comp of components(n, (i) => !isBlack(i))) {
    const nums = comp.filter((i) => clues[i] > 0);
    if (nums.length !== 1 || clues[nums[0]] !== comp.length) return false;
  }
  return true;
}

/**
 * 违规检测（只看规则不看答案），返回三个 Set：
 *   squares：2×2 全黑块中的格子；clues：违规的数字格；dots：违规岛屿中的白点。
 * 岛屿大小只算「数字格 + 白点」；「岛屿被封死」看包含该数字的非黑连通块是否小于数字。
 */
export function violations(game) {
  const { size: n, clues, cells } = game;
  const squares = new Set();
  const badClues = new Set();
  const dots = new Set();
  for (const a of blackSquares(n, (i) => cells[i] === BLACK)) {
    for (const i of [a, a + 1, a + n, a + n + 1]) squares.add(i);
  }
  for (const comp of components(n, (i) => clues[i] > 0 || cells[i] === DOT)) {
    const nums = comp.filter((i) => clues[i] > 0);
    if (nums.length > 1 || (nums.length === 1 && comp.length > clues[nums[0]])) {
      for (const i of comp) (clues[i] > 0 ? badClues : dots).add(i);
    }
  }
  for (const comp of components(n, (i) => cells[i] !== BLACK)) {
    for (const i of comp) if (clues[i] > comp.length) badClues.add(i);
  }
  return { squares, clues: badClues, dots };
}

// ---------------------------------------------------------------- 存档
export function serialize(game) {
  return {
    v: 1,
    level: game.level,
    index: game.index,
    t: game.t,
    cells: Array.from(game.cells).join(''),
    undo: game.undo,
    redo: game.redo,
    elapsed: game.elapsed,
  };
}

const validChanges = (list, N) =>
  Array.isArray(list) &&
  list.every(
    (step) =>
      Array.isArray(step) &&
      step.every((c) => Array.isArray(c) && c.length === 3 && c[0] >= 0 && c[0] < N && c.every(Number.isInteger)),
  );

/** 从存档恢复；bank 为题库。存档无效（损坏、题号超出、尺寸不符、已完成）返回 null */
export function restoreGame(data, bank) {
  try {
    if (!data || data.v !== 1 || !LEVELS[data.level]) return null;
    const entry = bank[data.level]?.[data.index];
    if (!entry || !Number.isInteger(data.t) || data.t < 0 || data.t > 7) return null;
    const game = createGame(data.level, data.index, data.t, entry);
    const N = game.size * game.size;
    if (typeof data.cells !== 'string' || data.cells.length !== N || !/^[012]*$/.test(data.cells)) return null;
    if (!validChanges(data.undo, N) || !validChanges(data.redo, N)) return null;
    for (let i = 0; i < N; i++) game.cells[i] = isClue(game, i) ? EMPTY : Number(data.cells[i]);
    game.undo = data.undo;
    game.redo = data.redo;
    game.elapsed = Math.max(0, Number(data.elapsed) || 0);
    if (isSolved(game.size, game.clues, game.cells)) return null;
    return game;
  } catch {
    return null;
  }
}
