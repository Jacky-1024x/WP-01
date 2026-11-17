// 出题（纯逻辑，无 DOM）：随机终盘 → 中心对称挖空并保证唯一解 → 逻辑求解器评级。
// 实时生成超时则从内置题库取题，并做不改变唯一性和难度的等价变换。
import { countSolutions, fullGrid, rate, solve } from './solver.js';
import { BANK } from './puzzles.js';

export const DIFFICULTIES = {
  easy: { name: '简单', stars: 1, level: 1, clues: [36, 40] },
  medium: { name: '中等', stars: 2, level: 2, clues: [30, 35] },
  hard: { name: '困难', stars: 3, level: 3, clues: [26, 30] },
  expert: { name: '专家', stars: 4, level: 4, clues: [22, 26] },
};
export const DIFF_IDS = Object.keys(DIFFICULTIES);

const randInt = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));

function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const clueCount = (grid) => grid.reduce((n, v) => n + (v ? 1 : 0), 0);

/** 题目是否满足该难度的全部条件：唯一解、可推理、已知数在区间内、最难技巧恰好属于该档 */
export function fitsDifficulty(puzzle, id) {
  const { level, clues } = DIFFICULTIES[id];
  const n = clueCount(puzzle);
  if (n < clues[0] || n > clues[1]) return false;
  if (countSolutions(puzzle) !== 1) return false;
  const r = rate(puzzle);
  return r.solved && r.level === level;
}

/** 尝试生成一道题，不命中目标难度返回 null */
export function makePuzzle(id, rng = Math.random) {
  const { level, clues } = DIFFICULTIES[id];
  const solution = fullGrid(rng);
  const grid = solution.slice();
  // 越难的档位越往下限挖，命中率更高
  const target = level >= 3 ? clues[0] : randInt(rng, clues[0], clues[1]);
  let left = 81;
  const cells = shuffled([...Array(41).keys()], rng);
  for (const i of cells) {
    if (left <= target) break;
    const j = 80 - i;
    const k = i === j ? 1 : 2;
    if (left - k < clues[0]) continue;
    const keep = [grid[i], grid[j]];
    grid[i] = 0;
    grid[j] = 0;
    if (countSolutions(grid) === 1) left -= k;
    else [grid[i], grid[j]] = keep;
  }
  if (left > clues[1]) return null;
  const r = rate(grid);
  if (!r.solved || r.level !== level) return null;
  return { difficulty: id, puzzle: grid, solution, source: 'generated' };
}

/** 在时间预算内反复尝试，超时返回 null */
export function generate(id, rng = Math.random, timeLimit = 1500) {
  const t0 = Date.now();
  do {
    const p = makePuzzle(id, rng);
    if (p) return p;
  } while (Date.now() - t0 < timeLimit);
  return null;
}

/** 等价变换：数字重映射、带内换行/列、换带、转置。唯一性和所需技巧都不变 */
export function transform(puzzle, solution, rng = Math.random) {
  const digits = [0, ...shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9], rng)];
  const perm = () => shuffled([0, 1, 2], rng).flatMap((band) => shuffled([0, 1, 2], rng).map((k) => band * 3 + k));
  const rows = perm();
  const cols = perm();
  const flip = rng() < 0.5;
  const map = (grid) =>
    Array.from({ length: 81 }, (_, i) => {
      let r = rows[(i / 9) | 0];
      let c = cols[i % 9];
      if (flip) [r, c] = [c, r];
      return digits[grid[r * 9 + c]];
    });
  return { puzzle: map(puzzle), solution: map(solution) };
}

export function fromBank(id, rng = Math.random) {
  const list = BANK[id];
  const raw = list[Math.floor(rng() * list.length)];
  const puzzle = [...raw].map(Number);
  const t = transform(puzzle, solve(puzzle), rng);
  return { difficulty: id, ...t, source: 'bank' };
}

/** 对外入口：优先实时生成，超时用题库 */
export function createPuzzle(id, rng = Math.random, timeLimit = 1500) {
  return generate(id, rng, timeLimit) || fromBank(id, rng);
}
