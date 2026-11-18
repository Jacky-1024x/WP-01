// 皇后：回溯数解 + 逻辑求解器（纯逻辑，不依赖 DOM）
// 逻辑求解器按技巧从易到难寻找“下一步”，同时服务于出题评级和游戏内提示。
import { EMPTY, CROSS, QUEEN, rowOf, colOf, units, attacks, available, isSolved } from './board.js';

// 回溯找解：逐行放置，列 / 区域 / 与上一行相邻三个条件剪枝。找到 limit 个即停。
// 返回解的数组，每个解是皇后所在格子下标（按行排列）。
export function findSolutions(n, regions, limit = 2) {
  const out = [];
  const cols = new Array(n);
  const walk = (r, colMask, regMask) => {
    if (out.length >= limit) return;
    if (r === n) {
      out.push(cols.map((c, row) => row * n + c));
      return;
    }
    for (let c = 0; c < n; c++) {
      if (colMask & (1 << c)) continue;
      if (r > 0 && Math.abs(cols[r - 1] - c) <= 1) continue;
      const g = regions[r * n + c];
      if (regMask & (1 << g)) continue;
      cols[r] = c;
      walk(r + 1, colMask | (1 << c), regMask | (1 << g));
      if (out.length >= limit) return;
    }
  };
  walk(0, 0, 0);
  return out;
}

export const countSolutions = (n, regions, limit = 2) => findSolutions(n, regions, limit).length;

// ---------------------------------------------------------------- 逻辑求解器
// 技巧级别
export const TECH = {
  attack: 0, // 皇后排除：被已放皇后攻击的空格打叉（仅关闭自动打叉时作为提示）
  single: 1, // 唯一位置
  confine: 2, // 区块排除（一个单元的候选全在另一类的同一个单元内）
  predict: 3, // 预判排除（放这里会让某单元无处可放）
  subset: 4, // 组合排除（k 个单元的候选落在另一类的 k 个单元内）
};

const KIND_INDEX = { row: (n, i) => rowOf(n, i), col: (n, i) => colOf(n, i) };
const bitCount = (x) => {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
};

// 返回下一步：
//   { tech, level, place: 格子 } 或 { tech, level, cross: [格子...] }
//   以及说明用的 units（涉及的单元）/ targets（被排除的单元）/ source（预判的假设格）
// 盘面已经矛盾（某单元无处可放）时返回 { contradiction: 单元 }；无步可走返回 null。
// explicitAttack：把“被皇后攻击但没打叉的空格”作为第 0 级步骤返回（关闭自动打叉时的提示）。
export function nextStep(n, regions, marks, { explicitAttack = false } = {}) {
  const avail = available(n, regions, marks);
  const all = units(n, regions);
  const queens = [];
  for (let i = 0; i < n * n; i++) if (marks[i] === QUEEN) queens.push(i);

  if (explicitAttack) {
    for (const q of queens) {
      const cells = [];
      for (let i = 0; i < n * n; i++) if (marks[i] === EMPTY && attacks(n, regions, q, i)) cells.push(i);
      if (cells.length) return { tech: 'attack', level: TECH.attack, cross: cells, source: q, units: [] };
    }
  }

  // 未完成的单元及其候选格
  const open = [];
  for (const u of all) {
    if (u.cells.some((i) => marks[i] === QUEEN)) continue;
    const cand = u.cells.filter((i) => avail[i]);
    if (!cand.length) return { contradiction: u };
    open.push({ ...u, cand });
  }

  // 1. 唯一位置：优先区域，其次行、列（区域最直观）
  const order = [...open.filter((u) => u.kind === 'region'), ...open.filter((u) => u.kind !== 'region')];
  for (const u of order) {
    if (u.cand.length === 1) return { tech: 'single', level: TECH.single, place: u.cand[0], units: [u] };
  }

  // 2. 区块排除：一个单元的候选全落在另一类的同一个单元
  const confine = pigeonhole(n, regions, open, avail, 1, 1);
  if (confine) return { tech: 'confine', level: TECH.confine, ...confine };

  // 3. 预判排除：放在 c 会让另一个单元失去全部候选
  const candCells = [];
  for (let i = 0; i < n * n; i++) if (avail[i]) candCells.push(i);
  for (const u of order) {
    for (const c of candCells) {
      if (u.cells.includes(c)) continue;
      if (u.cand.every((x) => attacks(n, regions, c, x))) {
        return { tech: 'predict', level: TECH.predict, cross: [c], source: c, units: [u] };
      }
    }
  }

  // 4. 组合排除：m 个单元的候选恰好落在另一类的 m 个单元里
  const subset = pigeonhole(n, regions, open, avail, 2, n - 1);
  if (subset) return { tech: 'subset', level: TECH.subset, ...subset };

  return null;
}

// 在 [minSize, maxSize] 大小的单元组合中找可以排除的格子
function pigeonhole(n, regions, open, avail, minSize, maxSize) {
  const indexOf = { ...KIND_INDEX, region: (_n, i) => regions[i] };
  const kinds = ['region', 'row', 'col'];
  for (let size = minSize; size <= maxSize; size++) {
    for (const src of kinds) {
      const srcUnits = open.filter((u) => u.kind === src);
      if (srcUnits.length <= size) continue;
      const masks = srcUnits.map((u) => {
        const m = {};
        for (const t of kinds) if (t !== src) m[t] = u.cand.reduce((acc, i) => acc | (1 << indexOf[t](n, i)), 0);
        return m;
      });
      for (const pick of combinations(srcUnits.length, size)) {
        for (const tgt of kinds) {
          if (tgt === src) continue;
          let union = 0;
          for (const p of pick) union |= masks[p][tgt];
          if (bitCount(union) !== size) continue;
          const inside = new Set(pick.flatMap((p) => srcUnits[p].cells));
          const cross = [];
          for (let i = 0; i < n * n; i++) {
            if (avail[i] && union & (1 << indexOf[tgt](n, i)) && !inside.has(i)) cross.push(i);
          }
          if (!cross.length) continue;
          const targets = [];
          for (let t = 0; t < n; t++) if (union & (1 << t)) targets.push({ kind: tgt, idx: t });
          return { cross, units: pick.map((p) => srcUnits[p]), targets };
        }
      }
    }
  }
  return null;
}

function* combinations(total, size, start = 0, acc = []) {
  if (acc.length === size) {
    yield acc.slice();
    return;
  }
  for (let i = start; i <= total - (size - acc.length); i++) {
    acc.push(i);
    yield* combinations(total, size, i + 1, acc);
    acc.pop();
  }
}

export function applyStep(marks, step) {
  if (step.place !== undefined) marks[step.place] = QUEEN;
  else for (const i of step.cross) marks[i] = CROSS;
}

// 从当前盘面（默认空盘）只用逻辑解题。返回 { solved, level（用到的最难技巧）, steps, marks }
export function logicSolve(n, regions, start = null) {
  const marks = start ? start.slice() : new Array(n * n).fill(EMPTY);
  let level = 0;
  let steps = 0;
  for (;;) {
    if (isSolved(n, regions, marks)) return { solved: true, level, steps, marks };
    const step = nextStep(n, regions, marks);
    if (!step || step.contradiction) return { solved: false, level, steps, marks };
    level = Math.max(level, step.level);
    steps++;
    applyStep(marks, step);
  }
}
