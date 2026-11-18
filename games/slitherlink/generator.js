// 数回出题（纯逻辑，只在离线出题脚本中使用）：随机回路 → 全部线索 → 按层级逐个删线索
import { LEVELS } from './board.js';
import { logicSolve } from './solver.js';

// 每档：逻辑求解器允许的最高层级；是否要求必须用到试探（只用层级 0 解不出）；线索数上限（删不动的题太直白）
export const LEVEL_RULES = {
  easy: { maxLevel: 0, needTrial: false, maxClues: 15 },
  medium: { maxLevel: 1, needTrial: true, maxClues: 24 },
  hard: { maxLevel: 1, needTrial: true, maxClues: 46 },
};

export const clueCount = (puzzle) => puzzle.replace(/\./g, '').length;

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 随机生长一块区域：区域内部无洞、不出现只在角上相接的格子，它的边界就是一条简单闭合回路
export function randomRegion(rows, cols, rng, fraction) {
  const n = rows * cols;
  const inR = new Uint8Array(n);
  const at = (r, c) => (r < 0 || c < 0 || r >= rows || c >= cols ? 0 : inR[r * cols + c]);
  const regionNeighbors = (r, c) => at(r - 1, c) + at(r + 1, c) + at(r, c - 1) + at(r, c + 1);

  // 加入 (r, c) 后，它四个角上不能出现对角相接
  const cornersOk = (r, c) => {
    for (const [vr, vc] of [[r, c], [r, c + 1], [r + 1, c], [r + 1, c + 1]]) {
      const tl = at(vr - 1, vc - 1);
      const tr = at(vr - 1, vc);
      const bl = at(vr, vc - 1);
      const br = at(vr, vc);
      if (tl === br && tr === bl && tl !== tr) return false;
    }
    return true;
  };

  // 区域外的格子都能连到棋盘外（区域无洞）
  const noHole = () => {
    const seen = new Uint8Array(n);
    const stack = [];
    let outside = 0;
    for (let i = 0; i < n; i++) {
      if (inR[i]) continue;
      outside++;
      const r = Math.floor(i / cols);
      const c = i % cols;
      if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) {
        seen[i] = 1;
        stack.push(i);
      }
    }
    let reached = stack.length;
    while (stack.length) {
      const i = stack.pop();
      const r = Math.floor(i / cols);
      const c = i % cols;
      for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        const j = nr * cols + nc;
        if (inR[j] || seen[j]) continue;
        seen[j] = 1;
        reached++;
        stack.push(j);
      }
    }
    return reached === outside;
  };

  const target = Math.round(n * fraction);
  inR[Math.floor(rng() * n)] = 1;
  let size = 1;
  const ACCEPT = [0, 1, 0.5, 0.2, 0.1];
  for (let tries = 0; size < target && tries < n * 60; tries++) {
    const i = Math.floor(rng() * n);
    if (inR[i]) continue;
    const r = Math.floor(i / cols);
    const c = i % cols;
    const k = regionNeighbors(r, c);
    if (!k || rng() > ACCEPT[k]) continue;
    inR[i] = 1;
    if (cornersOk(r, c) && noHole()) size++;
    else inR[i] = 0;
  }
  return inR;
}

export function cluesFromRegion(inR, rows, cols) {
  const at = (r, c) => (r < 0 || c < 0 || r >= rows || c >= cols ? 0 : inR[r * cols + c]);
  const clues = new Int8Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const me = at(r, c);
      clues[r * cols + c] = (at(r - 1, c) !== me) + (at(r + 1, c) !== me) + (at(r, c - 1) !== me) + (at(r, c + 1) !== me);
    }
  }
  return clues;
}

export const cluesToString = (clues) => Array.from(clues, (k) => (k < 0 ? '.' : String(k))).join('');

// 出一道题，失败（不满足本档要求）返回 null
export function makePuzzle(level, rng = Math.random) {
  const { rows, cols } = LEVELS[level];
  const { maxLevel, needTrial } = LEVEL_RULES[level];
  const region = randomRegion(rows, cols, rng, 0.4 + rng() * 0.25);
  const clues = cluesFromRegion(region, rows, cols);
  const order = shuffle([...clues.keys()], rng);
  for (const i of order) {
    const saved = clues[i];
    clues[i] = -1;
    if (!logicSolve(clues, rows, cols, maxLevel).solved) clues[i] = saved;
  }
  const puzzle = cluesToString(clues);
  return fitsLevel(puzzle, level) ? puzzle : null;
}

// 题目是否符合本档要求
export function fitsLevel(puzzle, level) {
  const { rows, cols } = LEVELS[level];
  const { maxLevel, needTrial, maxClues } = LEVEL_RULES[level];
  if (clueCount(puzzle) > maxClues) return false;
  const clues = Int8Array.from(puzzle, (ch) => (ch === '.' ? -1 : Number(ch)));
  if (!logicSolve(clues, rows, cols, maxLevel).solved) return false;
  return !needTrial || !logicSolve(clues, rows, cols, 0).solved;
}
