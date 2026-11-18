// 皇后：出题（纯逻辑，不依赖 DOM）
// 流程：随机摆答案 → 以答案为种子生长区域 → 多解时局部改区域直到唯一 → 逻辑求解器验证无需猜测。
import { neighbors4, regionsValid } from './board.js';
import { findSolutions, logicSolve } from './solver.js';

const FIX_ROUNDS = 60;

function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 每行一个、每列一个、上下相邻行列差 ≥ 2
export function randomPlacement(n, rng = Math.random) {
  const cols = [];
  const used = new Array(n).fill(false);
  const walk = (r) => {
    if (r === n) return true;
    for (const c of shuffled([...Array(n).keys()], rng)) {
      if (used[c] || (r > 0 && Math.abs(cols[r - 1] - c) <= 1)) continue;
      used[c] = true;
      cols[r] = c;
      if (walk(r + 1)) return true;
      used[c] = false;
    }
    return false;
  };
  walk(0);
  return cols.map((c, r) => r * n + c);
}

// 以 seeds[k] 为第 k 个区域的种子随机生长。每个区域有随机权重，长出大小不一的区域。
export function growRegions(n, seeds, rng = Math.random) {
  const regions = new Array(n * n).fill(-1);
  seeds.forEach((cell, k) => (regions[cell] = k));
  const weight = seeds.map(() => 0.15 + rng() ** 2);
  let left = n * n - seeds.length;
  while (left > 0) {
    // 收集每个区域可扩张的边界格
    const frontier = seeds.map(() => []);
    for (let i = 0; i < n * n; i++) {
      if (regions[i] !== -1) continue;
      for (const j of neighbors4(n, i)) if (regions[j] !== -1) frontier[regions[j]].push(i);
    }
    let total = 0;
    for (let k = 0; k < n; k++) if (frontier[k].length) total += weight[k];
    let x = rng() * total;
    let pick = -1;
    for (let k = 0; k < n; k++) {
      if (!frontier[k].length) continue;
      pick = k;
      x -= weight[k];
      if (x <= 0) break;
    }
    const cells = frontier[pick];
    regions[cells[Math.floor(rng() * cells.length)]] = pick;
    left--;
  }
  return regions;
}

// 区域 g 去掉格子 cell 后是否仍连通
function stillConnected(n, regions, g, cell) {
  const cells = [];
  for (let i = 0; i < n * n; i++) if (regions[i] === g && i !== cell) cells.push(i);
  if (!cells.length) return false;
  const seen = new Set([cells[0]]);
  const stack = [cells[0]];
  while (stack.length) {
    const i = stack.pop();
    for (const j of neighbors4(n, i)) {
      if (j !== cell && regions[j] === g && !seen.has(j)) {
        seen.add(j);
        stack.push(j);
      }
    }
  }
  return seen.size === cells.length;
}

// 多解时：把另一个解独有的某个皇后格改划给相邻区域，答案不受影响而该解被破坏
function breakAlternative(n, regions, solution, other, rng) {
  const answer = new Set(solution);
  for (const cell of shuffled(
    other.filter((c) => !answer.has(c)),
    rng,
  )) {
    const g = regions[cell];
    if (!stillConnected(n, regions, g, cell)) continue;
    const targets = shuffled(
      [...new Set(neighbors4(n, cell).map((j) => regions[j]))].filter((h) => h !== g),
      rng,
    );
    if (!targets.length) continue;
    regions[cell] = targets[0];
    return true;
  }
  return false;
}

// 生成一道唯一解、逻辑可解的题。返回 { n, regions, solution, level, tries }
export function generate(n, rng = Math.random) {
  for (let tries = 1; ; tries++) {
    const solution = randomPlacement(n, rng);
    const regions = growRegions(n, solution, rng);
    for (let round = 0; round < FIX_ROUNDS; round++) {
      const sols = findSolutions(n, regions, 2);
      if (sols.length === 1) break;
      const other = sols.find((s) => s.some((c, r) => c !== solution[r]));
      if (!breakAlternative(n, regions, solution, other, rng)) break;
    }
    if (findSolutions(n, regions, 2).length !== 1 || !regionsValid(n, regions)) continue;
    const res = logicSolve(n, regions);
    if (!res.solved) continue;
    return { n, regions, solution, level: res.level, tries };
  }
}
