// 数桥随机出题：树状扩展放岛（保证连通、不交叉），补几座成环的桥，写出数字后用求解器校验唯一解。
// 单题平均约 1–2ms，页面开局时直接调用。
import { LEVELS, parsePuzzle } from './board.js';
import { solve, solvableByLogic } from './solver.js';

// min / max：岛数区间；logic：要求只靠基本推理（不分支）就能解完
export const GEN_PARAMS = {
  easy: { ...LEVELS.easy, min: 8, max: 12, logic: true },
  medium: { ...LEVELS.medium, min: 14, max: 20, logic: false },
  hard: { ...LEVELS.hard, min: 22, max: 30, logic: false },
  expert: { ...LEVELS.expert, min: 30, max: 40, logic: false },
};

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// 随机构造一个解：返回题面字符串，失败返回 null
export function layout(cols, rows, target, rng) {
  const EMPTY = 0;
  const ISLAND = 1;
  const PATH = 2;
  const grid = new Uint8Array(cols * rows);
  const num = new Uint8Array(cols * rows);
  const islands = [];
  const inside = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
  const nearIsland = (x, y) =>
    DIRS.some(([dx, dy]) => inside(x + dx, y + dy) && grid[(y + dy) * cols + x + dx] === ISLAND);
  const randInt = (n) => Math.floor(rng() * n);
  const addBridge = (cells, a, b) => {
    const c = rng() < 0.4 ? 2 : 1;
    for (const i of cells) grid[i] = PATH;
    num[a] += c;
    num[b] += c;
  };

  const first = randInt(cols * rows);
  grid[first] = ISLAND;
  islands.push(first);
  let fails = 0;
  while (islands.length < target && fails < 400) {
    const from = islands[randInt(islands.length)];
    const [dx, dy] = DIRS[randInt(4)];
    const fx = from % cols;
    const fy = Math.floor(from / cols);
    // 可用长度：沿该方向连续空格的数量
    let free = 0;
    while (inside(fx + dx * (free + 1), fy + dy * (free + 1)) && grid[(fy + dy * (free + 1)) * cols + fx + dx * (free + 1)] === EMPTY) free++;
    if (free < 2) {
      fails++;
      continue;
    }
    const len = 2 + randInt(Math.min(free, Math.max(cols, rows) >> 1) - 1);
    const tx = fx + dx * len;
    const ty = fy + dy * len;
    const ti = ty * cols + tx;
    if (nearIsland(tx, ty)) {
      fails++;
      continue;
    }
    const cells = [];
    for (let s = 1; s < len; s++) cells.push((fy + dy * s) * cols + fx + dx * s);
    grid[ti] = ISLAND;
    islands.push(ti);
    addBridge(cells, from, ti);
    fails = 0;
  }
  if (islands.length < target) return null;

  // 补成环的桥：相互可见、路径全空的岛对
  for (const a of islands) {
    const ax = a % cols;
    const ay = Math.floor(a / cols);
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const cells = [];
      let x = ax + dx;
      let y = ay + dy;
      while (inside(x, y) && grid[y * cols + x] === EMPTY) {
        cells.push(y * cols + x);
        x += dx;
        y += dy;
      }
      if (!inside(x, y) || grid[y * cols + x] !== ISLAND || !cells.length) continue;
      if (rng() < 0.3) addBridge(cells, a, y * cols + x);
    }
  }

  let str = '';
  for (let i = 0; i < cols * rows; i++) str += grid[i] === ISLAND ? String(num[i]) : '.';
  return str;
}

// 生成一道唯一解的题；maxTries 次仍失败返回 null
export function generate(level, rng = Math.random, maxTries = 2000) {
  const g = GEN_PARAMS[level];
  for (let t = 0; t < maxTries; t++) {
    const target = g.min + Math.floor(rng() * (g.max - g.min + 1));
    const str = layout(g.cols, g.rows, target, rng);
    if (!str) continue;
    const p = parsePuzzle(str, g.cols, g.rows);
    if (g.logic && !solvableByLogic(p)) continue;
    const res = solve(p, { limit: 2 });
    if (res.count !== 1) continue;
    return { puzzle: str, cols: g.cols, rows: g.rows, islands: p.islands.length, branches: res.branches };
  }
  return null;
}
