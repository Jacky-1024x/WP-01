// 五子棋 AI（纯逻辑，无 DOM 依赖，可在 Web Worker 与 node 中运行）。
// 规则：15×15 自由五子棋，连成五子或以上获胜，无禁手。
//
// 核心思路：
// 1. 棋型表：以某点为中心，取一条线上前后各 4 格共 9 格，每格 {空, 己方, 阻挡} 三态，
//    预计算 3^9 种组合对应的棋型（五连/活四/冲四/活三/眠三/活二/眠二）。
//    棋型按「再下一子能变成什么」递归定义，因此跳活三、边界阻挡等情况都能准确识别。
// 2. 候选点：已有棋子周围两格内的空点，按「己方进攻棋型 + 对方防守棋型」评分排序，只取前 K 个。
// 3. 局面评估：枚举全盘所有五元组（连续 5 格），只含一方棋子的五元组按子数计分，下子时增量更新。
// 4. 搜索：负极大值 + alpha-beta 剪枝 + 迭代加深 + 限时；并加入强制规则：
//    能连五直接连五；对方有冲四必须封堵；己方能成活四/双四即判胜；对方有活三时只考虑封堵或反冲四。

export const SIZE = 15;
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

const N = SIZE;
const NN = N * N;
const DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

export const SHAPE = {
  NONE: 0,
  ONE: 1,
  SLEEP_TWO: 2,
  LIVE_TWO: 3,
  SLEEP_THREE: 4,
  LIVE_THREE: 5,
  RUSH_FOUR: 6,
  LIVE_FOUR: 7,
  FIVE: 8,
};

// ---------- 棋型表 ----------
const POW3 = [1, 3, 9, 27, 81, 243, 729, 2187, 6561];
const SHAPE_TABLE = new Uint8Array(19683);

(function buildShapeTable() {
  const memo = new Int8Array(19683).fill(-1);
  const a = new Array(9);
  const encode = () => {
    let code = 0;
    for (let i = 0; i < 9; i++) code += a[i] * POW3[i];
    return code;
  };
  function classify() {
    const code = encode();
    if (memo[code] >= 0) return memo[code];
    let result = -1;
    let winMask = 0;
    // 所有包含中心(下标 4)的五格窗口
    for (let s = 0; s <= 4 && result < 0; s++) {
      let own = 0;
      let empty = -1;
      let emptyCount = 0;
      let blocked = false;
      for (let k = s; k < s + 5; k++) {
        if (a[k] === 1) own++;
        else if (a[k] === 0) {
          emptyCount++;
          empty = k;
        } else blocked = true;
      }
      if (own === 5) result = SHAPE.FIVE;
      else if (!blocked && own === 4 && emptyCount === 1) winMask |= 1 << empty;
    }
    if (result < 0) {
      let wins = 0;
      for (let m = winMask; m; m &= m - 1) wins++;
      if (wins >= 2) result = SHAPE.LIVE_FOUR;
      else if (wins === 1) result = SHAPE.RUSH_FOUR;
      else {
        let best = SHAPE.NONE;
        for (let e = 0; e < 9; e++) {
          if (a[e] !== 0) continue;
          a[e] = 1;
          const s = classify();
          a[e] = 0;
          if (s > best) best = s;
        }
        if (best === SHAPE.LIVE_FOUR) result = SHAPE.LIVE_THREE;
        else if (best === SHAPE.RUSH_FOUR) result = SHAPE.SLEEP_THREE;
        else if (best === SHAPE.LIVE_THREE) result = SHAPE.LIVE_TWO;
        else if (best === SHAPE.SLEEP_THREE) result = SHAPE.SLEEP_TWO;
        else if (best >= SHAPE.SLEEP_TWO) result = SHAPE.ONE;
        else result = SHAPE.NONE;
      }
    }
    memo[code] = result;
    return result;
  }
  for (let code = 0; code < 19683; code++) {
    let x = code;
    for (let i = 0; i < 9; i++) {
      a[i] = x % 3;
      x = (x - a[i]) / 3;
    }
    if (a[4] !== 1) continue;
    SHAPE_TABLE[code] = classify();
  }
})();

// 每个点、每个方向上的 9 个格子下标（越界为 -1）
const LINE = new Int16Array(NN * 4 * 9);
for (let p = 0; p < NN; p++) {
  const r = Math.floor(p / N);
  const c = p % N;
  for (let d = 0; d < 4; d++) {
    const [dr, dc] = DIRS[d];
    for (let k = -4; k <= 4; k++) {
      const rr = r + dr * k;
      const cc = c + dc * k;
      LINE[(p * 4 + d) * 9 + k + 4] = rr >= 0 && rr < N && cc >= 0 && cc < N ? rr * N + cc : -1;
    }
  }
}

// 周围两格（5×5）邻域，用于候选点生成
const NEAR = [];
for (let p = 0; p < NN; p++) {
  const r = Math.floor(p / N);
  const c = p % N;
  const list = [];
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (rr >= 0 && rr < N && cc >= 0 && cc < N) list.push(rr * N + cc);
    }
  }
  NEAR.push(list);
}

// 全部五元组
const WIN_CELLS = [];
const POINT_WINS = Array.from({ length: NN }, () => []);
for (let r = 0; r < N; r++) {
  for (let c = 0; c < N; c++) {
    for (const [dr, dc] of DIRS) {
      const er = r + dr * 4;
      const ec = c + dc * 4;
      if (er < 0 || er >= N || ec < 0 || ec >= N) continue;
      const w = WIN_CELLS.length / 5;
      for (let k = 0; k < 5; k++) {
        const p = (r + dr * k) * N + (c + dc * k);
        WIN_CELLS.push(p);
        POINT_WINS[p].push(w);
      }
    }
  }
}
const WIN_COUNT = WIN_CELLS.length / 5;

// 五元组按己方子数计分（另一方子数为 0 时才有效）
const TUPLE_SCORE = [0, 1, 12, 160, 2000, 0];

// 候选点评分：单方向棋型分 + 组合加成
const SHAPE_SCORE = [0, 10, 40, 260, 300, 2600, 3000, 60000, 10000000];
const FLAG_FOUR = 1; // 下此点可成冲四/活四
const FLAG_LIVE4 = 2; // 下此点可成活四或双四（必胜）
const FLAG_FIVE = 4;
const FLAG_THREE = 8; // 下此点可成活三

export const WIN_SCORE = 100000000;
const INF = WIN_SCORE * 10;
const ABORT = Symbol('abort');

const LEVELS = {
  easy: { maxDepth: 0, width: 10, timeMs: 300 },
  normal: { maxDepth: 4, width: 10, timeMs: 800 },
  hard: { maxDepth: 10, width: 14, timeMs: 1300 },
};

export class Engine {
  constructor(board) {
    this.board = new Int8Array(NN);
    this.near = new Uint8Array(NN);
    this.wb = new Uint8Array(WIN_COUNT);
    this.ww = new Uint8Array(WIN_COUNT);
    this.score = [0, 0, 0];
    this.four = [0, 0, 0];
    this.five = [0, 0, 0];
    this.count = 0;
    this.nodes = 0;
    if (board) {
      for (let p = 0; p < NN; p++) if (board[p]) this.place(p, board[p]);
    }
  }

  contrib(sign, w) {
    const b = this.wb[w];
    const wh = this.ww[w];
    if (b && wh) return;
    if (b) {
      this.score[BLACK] += sign * TUPLE_SCORE[b];
      if (b === 4) this.four[BLACK] += sign;
      else if (b === 5) this.five[BLACK] += sign;
    } else if (wh) {
      this.score[WHITE] += sign * TUPLE_SCORE[wh];
      if (wh === 4) this.four[WHITE] += sign;
      else if (wh === 5) this.five[WHITE] += sign;
    }
  }

  place(p, c) {
    this.board[p] = c;
    this.count++;
    const arr = c === BLACK ? this.wb : this.ww;
    for (const w of POINT_WINS[p]) {
      this.contrib(-1, w);
      arr[w]++;
      this.contrib(1, w);
    }
    for (const q of NEAR[p]) this.near[q]++;
  }

  remove(p) {
    const c = this.board[p];
    const arr = c === BLACK ? this.wb : this.ww;
    for (const w of POINT_WINS[p]) {
      this.contrib(-1, w);
      arr[w]--;
      this.contrib(1, w);
    }
    for (const q of NEAR[p]) this.near[q]--;
    this.board[p] = EMPTY;
    this.count--;
  }

  // 对方「再下一子即成五」的所有空点（去重）
  fivePoints(c) {
    const out = [];
    if (!this.four[c]) return out;
    const own = c === BLACK ? this.wb : this.ww;
    const other = c === BLACK ? this.ww : this.wb;
    for (let w = 0; w < WIN_COUNT; w++) {
      if (own[w] !== 4 || other[w]) continue;
      for (let k = 0; k < 5; k++) {
        const p = WIN_CELLS[w * 5 + k];
        if (!this.board[p]) {
          if (!out.includes(p)) out.push(p);
          break;
        }
      }
    }
    return out;
  }

  // 计算在空点 p 落子后，c 方与对方在四个方向上的棋型，返回 [进攻分, 进攻标记, 防守分, 防守标记]
  evalPoint(p, c, out) {
    const board = this.board;
    let aSum = 0;
    let dSum = 0;
    let aFive = 0, aL4 = 0, aR4 = 0, aL3 = 0;
    let dFive = 0, dL4 = 0, dR4 = 0, dL3 = 0;
    for (let d = 0; d < 4; d++) {
      const base = (p * 4 + d) * 9;
      let codeA = POW3[4];
      let codeD = POW3[4];
      for (let k = 0; k < 9; k++) {
        if (k === 4) continue;
        const idx = LINE[base + k];
        if (idx < 0) {
          codeA += 2 * POW3[k];
          codeD += 2 * POW3[k];
        } else {
          const v = board[idx];
          if (v === c) {
            codeA += POW3[k];
            codeD += 2 * POW3[k];
          } else if (v) {
            codeA += 2 * POW3[k];
            codeD += POW3[k];
          }
        }
      }
      const sa = SHAPE_TABLE[codeA];
      const sd = SHAPE_TABLE[codeD];
      aSum += SHAPE_SCORE[sa];
      dSum += SHAPE_SCORE[sd];
      if (sa === SHAPE.FIVE) aFive++;
      else if (sa === SHAPE.LIVE_FOUR) aL4++;
      else if (sa === SHAPE.RUSH_FOUR) aR4++;
      else if (sa === SHAPE.LIVE_THREE) aL3++;
      if (sd === SHAPE.FIVE) dFive++;
      else if (sd === SHAPE.LIVE_FOUR) dL4++;
      else if (sd === SHAPE.RUSH_FOUR) dR4++;
      else if (sd === SHAPE.LIVE_THREE) dL3++;
    }
    out[0] = combine(aSum, aFive, aL4, aR4, aL3);
    out[1] = flags(aFive, aL4, aR4, aL3);
    out[2] = combine(dSum, dFive, dL4, dR4, dL3);
    out[3] = flags(dFive, dL4, dR4, dL3);
    return out;
  }

  // 生成并排序候选点。返回 { moves, win } ；win 为必胜点（若有）
  candidates(c, width) {
    const o = 3 - c;
    const forced = this.fivePoints(o);
    const tmp = [0, 0, 0, 0];
    if (forced.length) {
      return { moves: forced, win: -1 };
    }
    const list = [];
    let oppLive4 = false;
    let winMove = -1;
    let winScore = -1;
    for (let p = 0; p < NN; p++) {
      if (this.board[p] || !this.near[p]) continue;
      this.evalPoint(p, c, tmp);
      if (tmp[1] & (FLAG_FIVE | FLAG_LIVE4) && tmp[0] > winScore) {
        winScore = tmp[0];
        winMove = p;
      }
      if (tmp[3] & FLAG_LIVE4) oppLive4 = true;
      list.push({ p, s: tmp[0] + tmp[2] * 0.8, af: tmp[1], df: tmp[3] });
    }
    if (winMove >= 0) return { moves: [winMove], win: winMove };
    let pool = list;
    if (oppLive4) {
      // 对方有活三（或可成双四）：只考虑封堵点和己方冲四反击
      pool = list.filter((m) => m.df & FLAG_FOUR || m.af & FLAG_FOUR);
    }
    pool.sort((x, y) => y.s - x.s);
    if (pool.length > width) pool.length = width;
    return { moves: pool.map((m) => m.p), win: -1, scored: pool };
  }

  evaluate(c) {
    return this.score[c] - this.score[3 - c];
  }

  search(c, depth, alpha, beta, ply, ctx) {
    if ((++this.nodes & 1023) === 0 && Date.now() > ctx.deadline) throw ABORT;
    const o = 3 - c;
    if (this.five[o]) return -WIN_SCORE + ply;
    if (this.four[c]) return WIN_SCORE - ply - 1;
    const forced = this.four[o] > 0;
    if (forced) {
      const pts = this.fivePoints(o);
      if (pts.length >= 2) return -WIN_SCORE + ply + 2;
    }
    if (depth <= 0 && (!forced || ply >= ctx.maxPly)) return this.evaluate(c);
    if (this.count >= NN) return 0;

    const width = ply < 2 ? ctx.width : Math.max(6, ctx.width - 4);
    const { moves, win } = this.candidates(c, width);
    if (win >= 0) return WIN_SCORE - ply - 3;
    if (!moves.length) return this.evaluate(c);

    const nextDepth = forced ? depth : depth - 1; // 强制封堵不消耗深度
    let best = -INF;
    for (const p of moves) {
      this.place(p, c);
      let v;
      try {
        v = -this.search(o, nextDepth, -beta, -alpha, ply + 1, ctx);
      } finally {
        this.remove(p);
      }
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }
}

function combine(sum, five, l4, r4, l3) {
  if (five) return 10000000;
  if (l4 || r4 >= 2) return 1000000;
  if (r4 && l3) return 200000;
  if (l3 >= 2) return 100000;
  return sum;
}

function flags(five, l4, r4, l3) {
  let f = 0;
  if (five) f |= FLAG_FIVE | FLAG_LIVE4 | FLAG_FOUR;
  if (l4 || r4 >= 2) f |= FLAG_LIVE4 | FLAG_FOUR;
  if (r4) f |= FLAG_FOUR;
  if (l3) f |= FLAG_THREE;
  return f;
}

// ---------- 对外接口 ----------

/**
 * 计算 AI 落子。
 * @param {ArrayLike<number>} board 长度 225，0 空 / 1 黑 / 2 白
 * @param {number} player AI 执子颜色
 * @param {'easy'|'normal'|'hard'} level
 * @param {{timeMs?: number, rng?: () => number}} [opts]
 * @returns {{move: number, score: number, depth: number, nodes: number, ms: number}}
 */
export function chooseMove(board, player, level = 'normal', opts = {}) {
  const t0 = Date.now();
  const cfg = { ...(LEVELS[level] || LEVELS.normal) };
  if (opts.timeMs) cfg.timeMs = opts.timeMs;
  const rng = opts.rng || Math.random;
  const engine = new Engine(board);
  const done = (move, score = 0, depth = 0) => ({ move, score, depth, nodes: engine.nodes, ms: Date.now() - t0 });

  if (engine.count === 0) return done(7 * N + 7);
  if (engine.count >= NN) return done(-1);

  // 第二手：贴着对方第一子斜向落子
  if (engine.count === 1) {
    const first = engine.board.findIndex((v) => v !== EMPTY);
    const r = Math.floor(first / N);
    const c = first % N;
    const options = [
      [r + 1, c + 1], [r - 1, c + 1], [r + 1, c - 1], [r - 1, c - 1],
      [r, c + 1], [r + 1, c],
    ].filter(([rr, cc]) => rr >= 1 && rr < N - 1 && cc >= 1 && cc < N - 1);
    const toward = options.sort((x, y) => dist(x) - dist(y))[0];
    if (toward) return done(toward[0] * N + toward[1]);
  }

  // 1. 能连五立即连五
  if (engine.four[player]) {
    const pts = engine.fivePoints(player);
    if (pts.length) return done(pts[0], WIN_SCORE);
  }

  const root = engine.candidates(player, cfg.width);
  if (root.win >= 0) return done(root.win, WIN_SCORE - 3);
  // 2. 对方有冲四/活四：必须封堵（只有一个点时直接下）
  if (root.moves.length === 1) return done(root.moves[0]);
  if (!root.moves.length) return done(-1);

  // 简单：一层贪心 + 随机扰动（强制规则仍然生效）
  if (cfg.maxDepth === 0) {
    const scored = root.scored || root.moves.map((p) => ({ p, s: 1 }));
    let best = scored[0];
    let bestVal = -Infinity;
    for (const m of scored.slice(0, 6)) {
      const val = m.s * (0.55 + rng() * 0.45);
      if (val > bestVal) {
        bestVal = val;
        best = m;
      }
    }
    return done(best.p);
  }

  // 普通/困难：迭代加深 alpha-beta
  const ctx = {
    deadline: t0 + cfg.timeMs,
    width: cfg.width,
    maxPly: cfg.maxDepth + 8,
  };
  const o = 3 - player;
  let moves = root.moves.slice();
  let bestMove = moves[0];
  let bestScore = -INF;
  let reached = 0;
  for (let depth = 2; depth <= cfg.maxDepth; depth += 2) {
    let alpha = -INF;
    let iterBest = moves[0];
    const scores = new Map();
    try {
      for (const p of moves) {
        engine.place(p, player);
        let v;
        try {
          v = -engine.search(o, depth - 1, -INF, -alpha, 1, ctx);
        } finally {
          engine.remove(p);
        }
        scores.set(p, v);
        if (v > alpha) {
          alpha = v;
          iterBest = p;
        }
      }
    } catch (e) {
      if (e !== ABORT) throw e;
      // 本轮未完成：上一轮最佳着法排在首位且已完整搜索，若之后有着法超过它，说明更优，予以采纳
      if (scores.size >= 2 && iterBest !== moves[0]) {
        bestMove = iterBest;
        bestScore = alpha;
      }
      break;
    }
    bestMove = iterBest;
    bestScore = alpha;
    reached = depth;
    // 按本轮结果重新排序，下一轮先搜好棋
    moves = moves.slice().sort((x, y) => (scores.get(y) ?? -INF) - (scores.get(x) ?? -INF));
    if (alpha >= WIN_SCORE / 2 || alpha <= -WIN_SCORE / 2) break;
    if (Date.now() - t0 > cfg.timeMs * 0.45) break; // 下一轮大概率超时，提前结束
  }
  return done(bestMove, bestScore, reached);
}

function dist([r, c]) {
  return Math.abs(r - 7) + Math.abs(c - 7);
}

// 判断 p 处落子后是否连成五子，返回连线上的所有格子（不足五子返回 null）
export function findWinLine(board, p) {
  const c = board[p];
  if (!c) return null;
  const r0 = Math.floor(p / N);
  const c0 = p % N;
  for (const [dr, dc] of DIRS) {
    const line = [p];
    for (const s of [1, -1]) {
      let r = r0 + dr * s;
      let cc = c0 + dc * s;
      while (r >= 0 && r < N && cc >= 0 && cc < N && board[r * N + cc] === c) {
        line.push(r * N + cc);
        r += dr * s;
        cc += dc * s;
      }
    }
    if (line.length >= 5) return line.sort((a, b) => a - b);
  }
  return null;
}

// 供测试使用：查询某点在某方向上的棋型
export function shapeAt(board, p, c, d) {
  const base = (p * 4 + d) * 9;
  let code = POW3[4];
  for (let k = 0; k < 9; k++) {
    if (k === 4) continue;
    const idx = LINE[base + k];
    if (idx < 0) code += 2 * POW3[k];
    else if (board[idx] === c) code += POW3[k];
    else if (board[idx]) code += 2 * POW3[k];
  }
  return SHAPE_TABLE[code];
}
