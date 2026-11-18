// 数回纯逻辑：几何索引、边状态、撤销栈、违规检查、完成判定、对称变换、选题。不依赖 DOM。
//
// 边：先横边后竖边
//   横边 h(r, c)：r ∈ [0, rows]，c ∈ [0, cols)，index = r * cols + c
//   竖边 v(r, c)：r ∈ [0, rows)，c ∈ [0, cols]，index = H + r * (cols + 1) + c
// 点：index = r * (cols + 1) + c
// 线索：Int8Array(rows * cols)，-1 为空白格；题面字符串中 '.' 为空白格

export const LEVELS = {
  easy: { name: '简单', rows: 5, cols: 5 },
  medium: { name: '中等', rows: 7, cols: 7 },
  hard: { name: '困难', rows: 10, cols: 10 },
};

export const EMPTY = 0;
export const LINE = 1;
export const CROSS = 2;

const MAX_UNDO = 500;
const SAVE_VERSION = 1;

// ---------------------------------------------------------------- 几何
const geoCache = new Map();

export function geometry(rows, cols) {
  const key = `${rows}x${cols}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const H = (rows + 1) * cols;
  const E = H + rows * (cols + 1);
  const V = (rows + 1) * (cols + 1);
  const vid = (r, c) => r * (cols + 1) + c;
  const hid = (r, c) => r * cols + c;
  const vtid = (r, c) => H + r * (cols + 1) + c;
  const edgeVerts = new Int16Array(2 * E);
  const edgeCells = new Int16Array(2 * E).fill(-1);
  const cellEdges = new Int16Array(4 * rows * cols);
  const vertEdges = Array.from({ length: V }, () => []);
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      const e = hid(r, c);
      edgeVerts[2 * e] = vid(r, c);
      edgeVerts[2 * e + 1] = vid(r, c + 1);
      if (r > 0) edgeCells[2 * e] = (r - 1) * cols + c;
      if (r < rows) edgeCells[2 * e + 1] = r * cols + c;
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const e = vtid(r, c);
      edgeVerts[2 * e] = vid(r, c);
      edgeVerts[2 * e + 1] = vid(r + 1, c);
      if (c > 0) edgeCells[2 * e] = r * cols + c - 1;
      if (c < cols) edgeCells[2 * e + 1] = r * cols + c;
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      cellEdges.set([hid(r, c), hid(r + 1, c), vtid(r, c), vtid(r, c + 1)], 4 * i);
    }
  }
  for (let e = 0; e < E; e++) {
    vertEdges[edgeVerts[2 * e]].push(e);
    vertEdges[edgeVerts[2 * e + 1]].push(e);
  }
  const geo = { rows, cols, H, E, V, vid, hid, vtid, edgeVerts, edgeCells, cellEdges, vertEdges };
  geoCache.set(key, geo);
  return geo;
}

// 两个相邻点之间的边，不相邻返回 -1
export function edgeBetween(geo, a, b) {
  for (const e of geo.vertEdges[a]) {
    if (geo.edgeVerts[2 * e] === b || geo.edgeVerts[2 * e + 1] === b) return e;
  }
  return -1;
}

// 从点 a 到点 b 的格点路径（先横后竖），返回经过的边；用于拖动过快跳过格点时补齐
export function pathEdges(geo, a, b) {
  const w = geo.cols + 1;
  let r = Math.floor(a / w);
  let c = a % w;
  const tr = Math.floor(b / w);
  const tc = b % w;
  const out = [];
  while (c !== tc) {
    const nc = c + Math.sign(tc - c);
    out.push(edgeBetween(geo, r * w + c, r * w + nc));
    c = nc;
  }
  while (r !== tr) {
    const nr = r + Math.sign(tr - r);
    out.push(edgeBetween(geo, r * w + c, nr * w + c));
    r = nr;
  }
  return out;
}

// 棋盘坐标（以格子为单位，左上角点为原点）下离 (x, y) 最近的边；超出棋盘 margin 以外返回 -1
export function nearestEdge(geo, x, y, margin = 0.5) {
  const { rows, cols } = geo;
  if (x < -margin || y < -margin || x > cols + margin || y > rows + margin) return -1;
  const ry = Math.min(rows, Math.max(0, Math.round(y)));
  const rx = Math.min(cols, Math.max(0, Math.round(x)));
  const hc = Math.min(cols - 1, Math.max(0, Math.floor(x)));
  const vr = Math.min(rows - 1, Math.max(0, Math.floor(y)));
  // 到线段的距离（落点在棋盘外边距里时，线段端点外的部分也要算上）
  const dh = Math.hypot(y - ry, x - Math.min(hc + 1, Math.max(hc, x)));
  const dv = Math.hypot(x - rx, y - Math.min(vr + 1, Math.max(vr, y)));
  return dh <= dv ? geo.hid(ry, hc) : geo.vtid(vr, rx);
}

// 离 (x, y) 最近的点及距离
export function nearestVertex(geo, x, y) {
  const r = Math.min(geo.rows, Math.max(0, Math.round(y)));
  const c = Math.min(geo.cols, Math.max(0, Math.round(x)));
  return { v: geo.vid(r, c), d: Math.hypot(x - c, y - r) };
}

// ---------------------------------------------------------------- 题面
export function parseClues(str, rows, cols) {
  if (typeof str !== 'string' || str.length !== rows * cols || !/^[0-3.]+$/.test(str)) return null;
  return Int8Array.from(str, (ch) => (ch === '.' ? -1 : Number(ch)));
}

// 8 种对称变换（t = 0–7）：t & 3 为顺时针旋转 90° 的次数，t & 4 为先左右镜像。只用于正方形盘面
export function transformClues(str, n, t) {
  const out = new Array(n * n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      let rr = r;
      let cc = t & 4 ? n - 1 - c : c;
      for (let k = 0; k < (t & 3); k++) [rr, cc] = [cc, n - 1 - rr];
      out[rr * n + cc] = str[r * n + c];
    }
  }
  return out.join('');
}

// 优先选最近没玩过的题；recent 为最近玩过的题号（0 起），返回 { id, t }
export function pickPuzzle(count, recent = [], rng = Math.random) {
  const seen = new Set(recent);
  let pool = [...Array(count).keys()].filter((i) => !seen.has(i));
  if (!pool.length) pool = [...Array(count).keys()];
  return { id: pool[Math.floor(rng() * pool.length)], t: Math.floor(rng() * 8) };
}

// 记录一道题为最近玩过，最多记住题库的一半
export function pushRecent(recent, id, count) {
  const list = (Array.isArray(recent) ? recent : []).filter((i) => i !== id);
  list.push(id);
  return list.slice(-Math.max(1, Math.floor(count / 2)));
}

// ---------------------------------------------------------------- 对局
export function createGame(level, id, t, puzzle) {
  const { rows, cols } = LEVELS[level];
  const clues = parseClues(puzzle, rows, cols);
  if (!clues) throw new Error('题面格式错误');
  const geo = geometry(rows, cols);
  return {
    level,
    id,
    t,
    rows,
    cols,
    puzzle,
    clues,
    edges: new Uint8Array(geo.E),
    undo: [],
    redo: [],
    elapsed: 0,
    status: 'playing',
  };
}

export const geoOf = (game) => geometry(game.rows, game.cols);

// 应用一组修改 [[边, 新状态], ...]，作为一步压入撤销栈；返回实际改变的 [边, 旧, 新]
export function applyChanges(game, changes) {
  if (game.status !== 'playing') return [];
  const step = [];
  const seen = new Map();
  for (const [e, next] of changes) {
    const prev = game.edges[e];
    if (prev === next) continue;
    if (seen.has(e)) seen.get(e)[2] = next;
    else {
      const item = [e, prev, next];
      seen.set(e, item);
      step.push(item);
    }
    game.edges[e] = next;
  }
  const real = step.filter(([, a, b]) => a !== b);
  if (real.length) pushStep(game, real);
  return real;
}

// 直接压入一步已经应用过的修改（拖动时边画边改，结束时整笔入栈）
export function pushStep(game, step) {
  const real = step.filter(([, a, b]) => a !== b);
  if (!real.length) return;
  game.undo.push(real);
  if (game.undo.length > MAX_UNDO) game.undo.shift();
  game.redo = [];
}

export function undo(game) {
  if (game.status !== 'playing' || !game.undo.length) return null;
  const step = game.undo.pop();
  for (let k = step.length - 1; k >= 0; k--) game.edges[step[k][0]] = step[k][1];
  game.redo.push(step);
  return step;
}

export function redo(game) {
  if (game.status !== 'playing' || !game.redo.length) return null;
  const step = game.redo.pop();
  for (const [e, , next] of step) game.edges[e] = next;
  game.undo.push(step);
  return step;
}

export function clearAll(game) {
  const changes = [];
  for (let e = 0; e < game.edges.length; e++) if (game.edges[e] !== EMPTY) changes.push([e, EMPTY]);
  return applyChanges(game, changes);
}

// 轻点：空 → 线 → 叉 → 空；长按 / 右键：空 / 线 → 叉，叉 → 空
export const tapNext = (s) => (s === EMPTY ? LINE : s === LINE ? CROSS : EMPTY);
export const holdNext = (s) => (s === CROSS ? EMPTY : CROSS);

export const hasProgress = (game) => game.undo.length > 0 || game.edges.some((s) => s !== EMPTY);

// ---------------------------------------------------------------- 检查
// 返回：
//   cells: Int8Array，每格 0 未满足 / 1 恰好满足（0 要四边都打叉才算）/ 2 违规（超出或无法满足）；空白格为 0
//   badVerts: 分叉或死路的点
//   loopEdges: 提前闭合的圈上的边
//   closed: 所有线恰好构成一条闭合回路（不论数字是否满足）
//   solved: 完成
export function analyze(game) {
  const geo = geoOf(game);
  const { edges, clues } = game;
  const cells = new Int8Array(clues.length);
  let allClues = true;
  for (let i = 0; i < clues.length; i++) {
    if (clues[i] < 0) continue;
    let lines = 0;
    let open = 0;
    for (let k = 0; k < 4; k++) {
      const s = edges[geo.cellEdges[4 * i + k]];
      if (s === LINE) lines++;
      else if (s === EMPTY) open++;
    }
    if (lines > clues[i] || lines + open < clues[i]) cells[i] = 2;
    else if (lines === clues[i] && (clues[i] > 0 || open === 0)) cells[i] = 1;
    if (lines !== clues[i]) allClues = false;
  }

  const deg = new Uint8Array(geo.V);
  let total = 0;
  for (let e = 0; e < geo.E; e++) {
    if (edges[e] !== LINE) continue;
    total++;
    deg[geo.edgeVerts[2 * e]]++;
    deg[geo.edgeVerts[2 * e + 1]]++;
  }
  const badVerts = [];
  let degOk = true;
  for (let v = 0; v < geo.V; v++) {
    if (deg[v] !== 0 && deg[v] !== 2) degOk = false;
    if (deg[v] > 2) badVerts.push(v);
    else if (deg[v] === 1 && geo.vertEdges[v].every((e) => edges[e] !== EMPTY)) badVerts.push(v);
  }

  // 线的连通分量：全部点度为 2 的分量是闭合的圈
  const comp = new Int32Array(geo.E).fill(-1);
  const loops = [];
  let comps = 0;
  for (let e0 = 0; e0 < geo.E; e0++) {
    if (edges[e0] !== LINE || comp[e0] >= 0) continue;
    const list = [];
    let isLoop = true;
    const stack = [e0];
    comp[e0] = comps;
    while (stack.length) {
      const e = stack.pop();
      list.push(e);
      for (const v of [geo.edgeVerts[2 * e], geo.edgeVerts[2 * e + 1]]) {
        if (deg[v] !== 2) isLoop = false;
        for (const n of geo.vertEdges[v]) {
          if (edges[n] === LINE && comp[n] < 0) {
            comp[n] = comps;
            stack.push(n);
          }
        }
      }
    }
    comps++;
    if (isLoop) loops.push(list);
  }
  const closed = total > 0 && degOk && comps === 1;
  const loopEdges = comps > 1 ? loops.flat() : [];
  return { cells, badVerts, loopEdges, closed, solved: closed && allClues };
}

export const isSolved = (game) => analyze(game).solved;

// 回路内部的格子（射线奇偶法：格子左侧的竖线条数为奇数即在内部）
export function insideCells(game) {
  const geo = geoOf(game);
  const inside = [];
  for (let r = 0; r < game.rows; r++) {
    let crossings = 0;
    for (let c = 0; c < game.cols; c++) {
      if (game.edges[geo.vtid(r, c)] === LINE) crossings++;
      if (crossings % 2) inside.push(r * game.cols + c);
    }
  }
  return inside;
}

// 胜利时调用：去掉所有叉，状态改为完成
export function finish(game) {
  for (let e = 0; e < game.edges.length; e++) if (game.edges[e] === CROSS) game.edges[e] = EMPTY;
  game.status = 'won';
}

// ---------------------------------------------------------------- 存档
export function serialize(game) {
  return {
    v: SAVE_VERSION,
    level: game.level,
    id: game.id,
    t: game.t,
    puzzle: game.puzzle,
    edges: Array.from(game.edges).join(''),
    undo: game.undo,
    redo: game.redo,
    elapsed: Math.round(game.elapsed),
  };
}

// bank：按难度的题库；存档与题库对不上（题库更新过）时丢弃
export function restoreGame(data, bank) {
  try {
    if (!data || data.v !== SAVE_VERSION || !LEVELS[data.level]) return null;
    const list = bank[data.level];
    if (!Number.isInteger(data.id) || !list?.[data.id] || !Number.isInteger(data.t) || data.t < 0 || data.t > 7) return null;
    const { rows } = LEVELS[data.level];
    if (transformClues(list[data.id], rows, data.t) !== data.puzzle) return null;
    const game = createGame(data.level, data.id, data.t, data.puzzle);
    const E = game.edges.length;
    if (typeof data.edges !== 'string' || data.edges.length !== E || !/^[012]+$/.test(data.edges)) return null;
    game.edges = Uint8Array.from(data.edges, Number);
    const validStep = (step) =>
      Array.isArray(step) &&
      step.length > 0 &&
      step.every(
        (it) => Array.isArray(it) && it.length === 3 && Number.isInteger(it[0]) && it[0] >= 0 && it[0] < E && [0, 1, 2].includes(it[1]) && [0, 1, 2].includes(it[2]),
      );
    if (!Array.isArray(data.undo) || !Array.isArray(data.redo) || !data.undo.every(validStep) || !data.redo.every(validStep)) return null;
    game.undo = data.undo;
    game.redo = data.redo;
    game.elapsed = Number.isFinite(data.elapsed) && data.elapsed >= 0 ? data.elapsed : 0;
    if (isSolved(game)) return null;
    return game;
  } catch {
    return null;
  }
}
