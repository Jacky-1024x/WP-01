// 连线纯逻辑：关卡解析、画线 / 截断、步数、撤销、提示、完成判定、存档。不依赖 DOM。
// 路径 paths[k] 是从 k 号颜色某个端点出发的格子下标序列（可以为空）。

export const SIZES = [5, 6, 7, 8, 9];
export const COLOR_RANGE = { 5: [4, 6], 6: [5, 7], 7: [6, 8], 8: [7, 10], 9: [9, 12] };
export const MAX_UNDO = 200;

const isUpper = (ch) => ch >= 'A' && ch <= 'Z';

// segs：每种颜色的答案路径（格子下标序列）。颜色按端点的行优先顺序重新编号
export function encodeLevel(n, segs) {
  const order = segs
    .map((s) => ({ s, first: Math.min(s[0], s[s.length - 1]) }))
    .sort((a, b) => a.first - b.first);
  const chars = new Array(n * n).fill('?');
  order.forEach(({ s }, k) => {
    const lo = String.fromCharCode(97 + k);
    for (const cell of s) chars[cell] = lo;
    chars[s[0]] = lo.toUpperCase();
    chars[s[s.length - 1]] = lo.toUpperCase();
  });
  return chars.join('');
}

export function adjacent(n, a, b) {
  const d = Math.abs(a - b);
  return (d === n) || (d === 1 && Math.floor(a / n) === Math.floor(b / n));
}

function neighbors(n, i) {
  const r = Math.floor(i / n);
  const c = i % n;
  const out = [];
  if (r > 0) out.push(i - n);
  if (r < n - 1) out.push(i + n);
  if (c > 0) out.push(i - 1);
  if (c < n - 1) out.push(i + 1);
  return out;
}

// 解析关卡字符串 → { n, ends, solution }；格式不合法时返回 null
export function parseLevel(str) {
  if (typeof str !== 'string') return null;
  const n = Math.round(Math.sqrt(str.length));
  if (n * n !== str.length || n < 2) return null;
  const k = Math.max(...[...str].map((ch) => ch.toLowerCase().charCodeAt(0) - 96));
  if (!(k >= 1 && k <= 26)) return null;
  const ends = Array.from({ length: k }, () => []);
  const cells = Array.from({ length: k }, () => []);
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const idx = ch.toLowerCase().charCodeAt(0) - 97;
    if (!(idx >= 0 && idx < k)) return null;
    cells[idx].push(i);
    if (isUpper(ch)) ends[idx].push(i);
  }
  if (ends.some((e) => e.length !== 2)) return null;
  // 从第一个端点出发，经过同色所有格子到达另一个端点（唯一解保证走法唯一）
  const solution = [];
  for (let c = 0; c < k; c++) {
    const set = new Set(cells[c]);
    const [a, b] = ends[c];
    const path = [a];
    const used = new Set([a]);
    const dfs = (cur) => {
      if (path.length === set.size) return cur === b;
      for (const d of neighbors(n, cur)) {
        if (!set.has(d) || used.has(d) || (d === b && path.length + 1 !== set.size)) continue;
        used.add(d);
        path.push(d);
        if (dfs(d)) return true;
        path.pop();
        used.delete(d);
      }
      return false;
    };
    if (!dfs(a)) return null;
    solution.push(path);
  }
  return { n, ends, solution };
}

export function createGame(level, levelIndex = 0) {
  const k = level.ends.length;
  const endColor = new Int8Array(level.n * level.n).fill(-1);
  level.ends.forEach(([a, b], c) => {
    endColor[a] = c;
    endColor[b] = c;
  });
  return {
    n: level.n,
    level: levelIndex,
    ends: level.ends,
    solution: level.solution,
    endColor,
    paths: Array.from({ length: k }, () => []),
    moves: 0,
    hints: 0,
    lastColor: -1,
    undo: [],
    status: 'playing',
  };
}

export const colorCount = (g) => g.ends.length;

export function otherEnd(g, c, cell) {
  const [a, b] = g.ends[c];
  return cell === a ? b : a;
}

export function isConnected(g, c) {
  const p = g.paths[c];
  if (p.length < 2) return false;
  const [a, b] = g.ends[c];
  return (p[0] === a && p[p.length - 1] === b) || (p[0] === b && p[p.length - 1] === a);
}

export function connectedCount(g) {
  let n = 0;
  for (let c = 0; c < g.paths.length; c++) if (isConnected(g, c)) n++;
  return n;
}

// 每个格子属于哪条路径（-1 为空）；只有 1 格的路径（刚按下端点）不算覆盖
export function ownerGrid(g) {
  const own = new Int8Array(g.n * g.n).fill(-1);
  g.paths.forEach((p, c) => {
    if (p.length >= 2) for (const cell of p) own[cell] = c;
  });
  return own;
}

export function filledCount(g) {
  return ownerGrid(g).reduce((s, v) => s + (v >= 0 ? 1 : 0), 0);
}

export function fillPercent(g) {
  return Math.floor((filledCount(g) * 100) / (g.n * g.n));
}

export function isSolved(g) {
  return connectedCount(g) === g.paths.length && filledCount(g) === g.n * g.n;
}

const clonePaths = (paths) => paths.map((p) => p.slice());
const samePaths = (a, b) => a.length === b.length && a.every((p, i) => p.length === b[i].length && p.every((v, j) => v === b[i][j]));

// 按下格子：返回拖动对象，按在空格上返回 null
export function beginDrag(g, cell) {
  if (g.status !== 'playing' || cell < 0 || cell >= g.n * g.n) return null;
  let color = g.endColor[cell];
  let path;
  if (color >= 0) {
    path = [cell];
  } else {
    color = g.paths.findIndex((p) => p.length >= 2 && p.includes(cell));
    if (color < 0) return null;
    const p = g.paths[color];
    path = p.slice(0, p.indexOf(cell) + 1);
  }
  const drag = { color, base: clonePaths(g.paths), path };
  applyDrag(g, drag);
  return drag;
}

// 用「快照 − 当前路径占用的格子」重新计算所有路径（截断是临时的）
function applyDrag(g, drag) {
  const taken = new Set(drag.path);
  g.paths = drag.base.map((p, c) => {
    if (c === drag.color) return drag.path.slice();
    const cut = p.findIndex((cell) => taken.has(cell));
    return cut < 0 ? p.slice() : p.slice(0, cut);
  });
}

// 拖到相邻格子。返回 { changed, connected, cut }：connected 表示这一步刚连通，cut 为被截断的颜色
export function dragTo(g, drag, cell) {
  const res = { changed: false, connected: false, cut: [] };
  if (!drag || g.status !== 'playing') return res;
  const path = drag.path;
  const last = path[path.length - 1];
  if (cell === last || !adjacent(g.n, last, cell)) return res;
  const before = g.paths.map((p) => p.length);
  const at = path.indexOf(cell);
  if (at >= 0) {
    path.length = at + 1;
  } else {
    const start = path[0];
    const done = path.length >= 2 && g.endColor[last] === drag.color && last !== start;
    if (done) return res;
    const ec = g.endColor[cell];
    if (ec >= 0 && ec !== drag.color) return res;
    path.push(cell);
    if (ec === drag.color) res.connected = true;
  }
  applyDrag(g, drag);
  res.changed = true;
  g.paths.forEach((p, c) => {
    if (c !== drag.color && p.length < before[c]) res.cut.push(c);
  });
  return res;
}

// 松手：棋盘有变化才计步、入撤销栈。返回 { changed, solved, gaps }：gaps 表示全部连通但没铺满
export function endDrag(g, drag) {
  const res = { changed: false, solved: false, gaps: false };
  if (!drag) return res;
  normalize(g);
  const base = drag.base;
  if (samePaths(base, g.paths)) return res;
  res.changed = true;
  pushUndo(g, base);
  if (drag.color !== g.lastColor) g.moves++;
  g.lastColor = drag.color;
  return finish(g, res);
}

// 只剩 1 格的路径视为空
function normalize(g) {
  g.paths = g.paths.map((p) => (p.length >= 2 ? p : []));
}

function pushUndo(g, paths) {
  g.undo.push(clonePaths(paths));
  if (g.undo.length > MAX_UNDO) g.undo.shift();
}

function finish(g, res) {
  if (connectedCount(g) === g.paths.length) {
    if (filledCount(g) === g.n * g.n) {
      g.status = 'won';
      res.solved = true;
    } else {
      res.gaps = true;
    }
  }
  return res;
}

export function canUndo(g) {
  return g.status === 'playing' && g.undo.length > 0;
}

export function undo(g) {
  if (!canUndo(g)) return false;
  g.paths = g.undo.pop();
  g.lastColor = -1;
  return true;
}

export function hasProgress(g) {
  return g.paths.some((p) => p.length >= 2);
}

export function restart(g) {
  g.paths = g.paths.map(() => []);
  g.moves = 0;
  g.hints = 0;
  g.lastColor = -1;
  g.undo = [];
  g.status = 'playing';
}

// 路径与答案一致（方向不限）
export function matchesSolution(g, c) {
  const p = g.paths[c];
  const s = g.solution[c];
  if (p.length !== s.length) return false;
  if (p[0] === s[0]) return p.every((v, i) => v === s[i]);
  return p.every((v, i) => v === s[s.length - 1 - i]);
}

// 提示：画出编号最小的「没画对」的颜色的答案路径，返回颜色编号；没有可提示的返回 -1
export function hint(g) {
  if (g.status !== 'playing') return { color: -1 };
  const color = g.paths.findIndex((_, c) => !matchesSolution(g, c));
  if (color < 0) return { color: -1 };
  const base = clonePaths(g.paths);
  applyDrag(g, { color, base, path: g.solution[color].slice() });
  normalize(g);
  pushUndo(g, base);
  g.hints++;
  g.lastColor = -1;
  return { color, ...finish(g, { changed: true, solved: false, gaps: false }) };
}

// 存档：只存与关卡无关的进度；还原时用题库重新解析关卡并校验
export function serialize(g) {
  return { v: 1, level: g.level, paths: g.paths, moves: g.moves, hints: g.hints, lastColor: g.lastColor, undo: g.undo };
}

export function validPaths(g, paths) {
  if (!Array.isArray(paths) || paths.length !== g.ends.length) return false;
  const seen = new Set();
  for (let c = 0; c < paths.length; c++) {
    const p = paths[c];
    if (!Array.isArray(p)) return false;
    if (p.length === 0) continue;
    if (p.length < 2) return false;
    const [a, b] = g.ends[c];
    if (p[0] !== a && p[0] !== b) return false;
    for (let i = 0; i < p.length; i++) {
      const cell = p[i];
      if (!Number.isInteger(cell) || cell < 0 || cell >= g.n * g.n || seen.has(cell)) return false;
      seen.add(cell);
      if (i > 0 && !adjacent(g.n, p[i - 1], cell)) return false;
      const ec = g.endColor[cell];
      if (ec >= 0 && ec !== c) return false;
      if (ec === c && i > 0 && i < p.length - 1) return false;
    }
  }
  return true;
}

export function restoreGame(level, levelIndex, save) {
  if (!level || !save || save.v !== 1 || save.level !== levelIndex) return null;
  const g = createGame(level, levelIndex);
  if (!validPaths(g, save.paths)) return null;
  if (!Number.isInteger(save.moves) || save.moves < 0 || !Number.isInteger(save.hints) || save.hints < 0) return null;
  g.paths = save.paths.map((p) => p.slice());
  g.moves = save.moves;
  g.hints = save.hints;
  g.lastColor = Number.isInteger(save.lastColor) && save.lastColor < g.ends.length ? save.lastColor : -1;
  g.undo = Array.isArray(save.undo) ? save.undo.filter((u) => validPaths(g, u)).slice(-MAX_UNDO) : [];
  if (isSolved(g)) return null;
  return g;
}
