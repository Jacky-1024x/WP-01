// 关灯纯逻辑：翻转、GF(2) 求解、出题、撤销 / 重来、提示与存档校验。
// 不依赖 DOM，便于测试。局面用 Uint8Array 表示，index = y * n + x，1 = 亮。

export const SIZES = [3, 4, 5, 6, 7];
export const DEFAULT_SIZE = 5;

// 出题参数：随机点击 k ∈ [min, max] 个不同的格子，最少步数不低于 floor
export const GEN = {
  3: { min: 3, max: 5, floor: 3 },
  4: { min: 4, max: 7, floor: 4 },
  5: { min: 6, max: 10, floor: 6 },
  6: { min: 8, max: 13, floor: 8 },
  7: { min: 10, max: 16, floor: 10 },
};
const MAX_TRIES = 50;

// 点击 i 会翻转的格子（自己 + 上下左右，不绕边）
export function crossOf(n, i) {
  const x = i % n;
  const y = (i / n) | 0;
  const out = [i];
  if (y > 0) out.push(i - n);
  if (x > 0) out.push(i - 1);
  if (x < n - 1) out.push(i + 1);
  if (y < n - 1) out.push(i + n);
  return out;
}

export function toggle(lights, n, i) {
  for (const j of crossOf(n, i)) lights[j] ^= 1;
  return lights;
}

export function isDark(lights) {
  return lights.every((v) => v === 0);
}

export function countLit(lights) {
  let c = 0;
  for (const v of lights) c += v;
  return c;
}

// ---------------------------------------------------------------- GF(2) 高斯消元
// 每个尺寸的系数矩阵只消元一次：记录行变换后的矩阵、主元列、自由列与零空间基
const reduced = new Map();

function reduce(n) {
  if (reduced.has(n)) return reduced.get(n);
  const N = n * n;
  // 行 j：哪些点击会翻转格子 j；同时记录行变换（单位阵），以便之后对任意 b 复用
  const rows = [];
  for (let j = 0; j < N; j++) {
    const a = new Uint8Array(N);
    for (const i of crossOf(n, j)) a[i] = 1; // A 对称：j 的十字 = 会翻转 j 的点击
    const t = new Uint8Array(N);
    t[j] = 1;
    rows.push({ a, t });
  }
  const pivots = []; // pivots[r] = 第 r 行的主元列
  let r = 0;
  for (let c = 0; c < N && r < N; c++) {
    let p = r;
    while (p < N && !rows[p].a[c]) p++;
    if (p === N) continue;
    [rows[r], rows[p]] = [rows[p], rows[r]];
    for (let k = 0; k < N; k++) {
      if (k !== r && rows[k].a[c]) {
        const { a, t } = rows[k];
        const src = rows[r];
        for (let m = 0; m < N; m++) {
          a[m] ^= src.a[m];
          t[m] ^= src.t[m];
        }
      }
    }
    pivots.push(c);
    r++;
  }
  const rank = r;
  const isPivot = new Uint8Array(N);
  for (const c of pivots) isPivot[c] = 1;
  const free = [];
  for (let c = 0; c < N; c++) if (!isPivot[c]) free.push(c);
  // 零空间基：自由变量 f 取 1、其余自由变量取 0，主元变量 = 该行在 f 列上的系数
  const nullBasis = free.map((f) => {
    const v = new Uint8Array(N);
    v[f] = 1;
    for (let k = 0; k < rank; k++) if (rows[k].a[f]) v[pivots[k]] = 1;
    return v;
  });
  const info = { N, rows, pivots, rank, nullBasis };
  reduced.set(n, info);
  return info;
}

export function rankOf(n) {
  return reduce(n).rank;
}

export function nullity(n) {
  return reduce(n).nullBasis.length;
}

// 把局面 lights 全部关掉的最少点击集合（按下标升序）。无解返回 null
export function solve(n, lights) {
  const { N, rows, pivots, rank, nullBasis } = reduce(n);
  // 变换后的右端：b' = T b
  const bt = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    let s = 0;
    const t = rows[k].t;
    for (let m = 0; m < N; m++) if (t[m] && lights[m]) s ^= 1;
    bt[k] = s;
  }
  for (let k = rank; k < N; k++) if (bt[k]) return null;
  const x = new Uint8Array(N);
  for (let k = 0; k < rank; k++) x[pivots[k]] = bt[k];
  let best = x;
  let bestW = countLit(x);
  const combos = 1 << nullBasis.length;
  for (let mask = 1; mask < combos; mask++) {
    const y = x.slice();
    for (let b = 0; b < nullBasis.length; b++) {
      if (!(mask & (1 << b))) continue;
      const v = nullBasis[b];
      for (let m = 0; m < N; m++) y[m] ^= v[m];
    }
    const w = countLit(y);
    if (w < bestW) {
      best = y;
      bestW = w;
    }
  }
  const out = [];
  for (let i = 0; i < N; i++) if (best[i]) out.push(i);
  return out;
}

export function isSolvable(n, lights) {
  return solve(n, lights) !== null;
}

// ---------------------------------------------------------------- 出题
export function generate(n, rng = Math.random) {
  const g = GEN[n];
  const N = n * n;
  let lights = null;
  let optimal = 0;
  for (let tries = 0; tries < MAX_TRIES; tries++) {
    const k = g.min + Math.floor(rng() * (g.max - g.min + 1));
    const pool = Array.from({ length: N }, (_, i) => i);
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(rng() * (N - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const cand = new Uint8Array(N);
    for (let i = 0; i < k; i++) toggle(cand, n, pool[i]);
    const m = solve(n, cand).length;
    if (m === 0) continue;
    lights = cand;
    optimal = m;
    if (m >= g.floor) break;
  }
  return { lights, optimal };
}

// ---------------------------------------------------------------- 对局
export function createGame(size = DEFAULT_SIZE, rng = Math.random) {
  const n = SIZES.includes(size) ? size : DEFAULT_SIZE;
  const { lights, optimal } = generate(n, rng);
  return {
    size: n,
    start: lights.slice(),
    lights,
    optimal, // 开局时的最少步数，整局不变
    history: [], // 点击过的格子下标
    hints: 0,
    hint: -1, // 当前标出的提示格，-1 表示没有
    elapsed: 0, // 毫秒
    status: 'playing', // playing | won
  };
}

export const moves = (game) => game.history.length;

export function press(game, i) {
  if (game.status !== 'playing' || !Number.isInteger(i) || i < 0 || i >= game.lights.length) return null;
  toggle(game.lights, game.size, i);
  game.history.push(i);
  game.hint = -1;
  if (isDark(game.lights)) game.status = 'won';
  return { cells: crossOf(game.size, i), won: game.status === 'won' };
}

export function undo(game) {
  if (game.status !== 'playing' || !game.history.length) return null;
  const i = game.history.pop();
  toggle(game.lights, game.size, i);
  game.hint = -1;
  return { cells: crossOf(game.size, i) };
}

// 回到开局局面；计时与提示次数保留
export function reset(game) {
  if (game.status !== 'playing' || !game.history.length) return null;
  game.lights = game.start.slice();
  game.history = [];
  game.hint = -1;
  return true;
}

// 对当前局面求最少解，标出阅读顺序的第一盏。返回 { index, remaining, counted }
export function hint(game) {
  if (game.status !== 'playing') return null;
  const sol = solve(game.size, game.lights);
  if (!sol || !sol.length) return null;
  const counted = game.hint < 0;
  if (counted) game.hints++;
  game.hint = sol[0];
  return { index: game.hint, remaining: sol.length, counted };
}

export function isPerfect(game) {
  return game.status === 'won' && game.hints === 0 && moves(game) === game.optimal;
}

// ---------------------------------------------------------------- 存档
const toBits = (arr) => Array.from(arr).join('');

export function serialize(game) {
  return {
    size: game.size,
    start: toBits(game.start),
    history: [...game.history],
    hints: game.hints,
    hint: game.hint,
    elapsed: Math.round(game.elapsed),
  };
}

// 校验并还原存档：用开局局面重放点击记录，数据不合法返回 null
export function restoreGame(data) {
  try {
    const { size, start, history, hints = 0, hint: h = -1, elapsed = 0 } = data;
    if (!SIZES.includes(size)) return null;
    const N = size * size;
    if (typeof start !== 'string' || start.length !== N || !/^[01]+$/.test(start)) return null;
    const lights = Uint8Array.from(start, Number);
    const optimal = solve(size, lights)?.length;
    if (!optimal) return null;
    if (!Array.isArray(history) || !history.every((i) => Number.isInteger(i) && i >= 0 && i < N)) return null;
    if (!Number.isInteger(hints) || hints < 0) return null;
    if (!(Number.isFinite(elapsed) && elapsed >= 0)) return null;
    const game = {
      size,
      start: lights.slice(),
      lights,
      optimal,
      history: [],
      hints,
      hint: -1,
      elapsed,
      status: 'playing',
    };
    for (const i of history) {
      if (game.status !== 'playing') return null;
      press(game, i);
    }
    if (game.status !== 'playing') return null;
    if (Number.isInteger(h) && h >= 0 && h < N && solve(size, game.lights).includes(h)) game.hint = h;
    return game;
  } catch {
    return null;
  }
}
