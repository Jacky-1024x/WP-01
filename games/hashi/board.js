// 数桥纯逻辑：题面解析、可连接岛对与交叉关系、循环切换、撤销、满足 / 连通 / 完成判定。不依赖 DOM。
// 题面编码：长度 cols × rows 的字符串，行优先；'.' 为空格，'1'–'8' 为岛的数字。

export const LEVELS = {
  easy: { cols: 7, rows: 7 },
  medium: { cols: 9, rows: 9 },
  hard: { cols: 11, rows: 11 },
  expert: { cols: 13, rows: 13 },
};

// 解析题面，得到岛、可连接的岛对（edges）与交叉关系。
// edge：{ a, b, dir: 'h' | 'v', cells: 中间经过的格子下标 }，a 在左 / 上，b 在右 / 下。
export function parsePuzzle(str, cols, rows) {
  if (typeof str !== 'string' || str.length !== cols * rows) throw new Error('题面长度不符');
  const islands = [];
  const islandAt = new Int16Array(cols * rows).fill(-1);
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '.') continue;
    const n = ch.charCodeAt(0) - 48;
    if (n < 1 || n > 8) throw new Error(`非法字符 ${ch}`);
    islandAt[i] = islands.length;
    islands.push({ i, x: i % cols, y: Math.floor(i / cols), n });
  }
  const edges = [];
  const edgeAt = new Map(); // `${a},${b}` → edge id
  const islandEdges = islands.map(() => []);
  for (let k = 0; k < islands.length; k++) {
    const { x, y } = islands[k];
    for (const [dx, dy, dir] of [[1, 0, 'h'], [0, 1, 'v']]) {
      const cells = [];
      let cx = x + dx;
      let cy = y + dy;
      while (cx < cols && cy < rows && islandAt[cy * cols + cx] < 0) {
        cells.push(cy * cols + cx);
        cx += dx;
        cy += dy;
      }
      if (cx >= cols || cy >= rows) continue;
      const b = islandAt[cy * cols + cx];
      const id = edges.length;
      edges.push({ a: k, b, dir, cells });
      edgeAt.set(`${k},${b}`, id);
      islandEdges[k].push(id);
      islandEdges[b].push(id);
    }
  }
  // 交叉：一条水平边与一条垂直边经过同一个格子
  const cellH = new Int16Array(cols * rows).fill(-1);
  for (let e = 0; e < edges.length; e++) {
    if (edges[e].dir === 'h') for (const c of edges[e].cells) cellH[c] = e;
  }
  const cross = edges.map(() => []);
  for (let e = 0; e < edges.length; e++) {
    if (edges[e].dir !== 'v') continue;
    for (const c of edges[e].cells) {
      const h = cellH[c];
      if (h >= 0) {
        cross[e].push(h);
        cross[h].push(e);
      }
    }
  }
  return { cols, rows, str, islands, islandAt, edges, edgeAt, islandEdges, cross };
}

export function edgeBetween(p, a, b) {
  const id = p.edgeAt.get(a < b ? `${a},${b}` : `${b},${a}`);
  return id === undefined ? -1 : id;
}

// 从岛 k 沿方向 (dx, dy) 看过去最近的岛，没有则 -1
export function neighborIsland(p, k, dx, dy) {
  for (const e of p.islandEdges[k]) {
    const { a, b, dir } = p.edges[e];
    if (dx !== 0 && dir === 'h') {
      if (dx > 0 && a === k) return b;
      if (dx < 0 && b === k) return a;
    }
    if (dy !== 0 && dir === 'v') {
      if (dy > 0 && a === k) return b;
      if (dy < 0 && b === k) return a;
    }
  }
  return -1;
}

// ---------------------------------------------------------------- 对局
export function createGame(level, puzzle, cols, rows) {
  const p = parsePuzzle(puzzle, cols, rows);
  return {
    level,
    p,
    bridges: new Uint8Array(p.edges.length),
    undo: [], // [[edge, prev], ...] 每一步可能改动多条边（清空）
    elapsed: 0,
    status: 'playing',
  };
}

// 该边若从 0 架起，会被哪些已有的桥挡住
export function blockers(game, e) {
  return game.p.cross[e].filter((c) => game.bridges[c] > 0);
}

// 循环切换 0 → 1 → 2 → 0。被交叉挡住时返回 { ok: false, blocked }
export function cycleBridge(game, e) {
  if (game.status !== 'playing' || e < 0) return { ok: false, blocked: [] };
  const prev = game.bridges[e];
  const next = (prev + 1) % 3;
  if (prev === 0) {
    const blocked = blockers(game, e);
    if (blocked.length) return { ok: false, blocked };
  }
  game.bridges[e] = next;
  game.undo.push([[e, prev]]);
  return { ok: true, prev, next };
}

export function clearBridges(game) {
  if (game.status !== 'playing') return false;
  const step = [];
  for (let e = 0; e < game.bridges.length; e++) {
    if (game.bridges[e]) {
      step.push([e, game.bridges[e]]);
      game.bridges[e] = 0;
    }
  }
  if (!step.length) return false;
  game.undo.push(step);
  return true;
}

// 返回被改动的边
export function undo(game) {
  if (game.status !== 'playing' || !game.undo.length) return null;
  const step = game.undo.pop();
  for (let k = step.length - 1; k >= 0; k--) game.bridges[step[k][0]] = step[k][1];
  return step.map(([e]) => e);
}

export const hasBridges = (game) => game.bridges.some((b) => b > 0);

export function bridgeCount(game, k) {
  let s = 0;
  for (const e of game.p.islandEdges[k]) s += game.bridges[e];
  return s;
}

// 'under' / 'done' / 'over'
export function islandState(game, k) {
  const c = bridgeCount(game, k);
  const n = game.p.islands[k].n;
  return c === n ? 'done' : c < n ? 'under' : 'over';
}

export function satisfiedCount(game) {
  let s = 0;
  for (let k = 0; k < game.p.islands.length; k++) if (bridgeCount(game, k) === game.p.islands[k].n) s++;
  return s;
}

// 按已架的桥求连通分量，返回 comp[k] = 分量编号，分量按大小降序编号（0 为最大）
export function components(p, bridges) {
  const n = p.islands.length;
  const comp = new Int16Array(n).fill(-1);
  const groups = [];
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0) continue;
    const id = groups.length;
    const members = [s];
    comp[s] = id;
    for (let q = 0; q < members.length; q++) {
      const k = members[q];
      for (const e of p.islandEdges[k]) {
        if (!bridges[e]) continue;
        const o = p.edges[e].a === k ? p.edges[e].b : p.edges[e].a;
        if (comp[o] < 0) {
          comp[o] = id;
          members.push(o);
        }
      }
    }
    groups.push(members);
  }
  groups.sort((x, y) => y.length - x.length);
  groups.forEach((g, id) => g.forEach((k) => (comp[k] = id)));
  return { comp, groups };
}

export const isConnected = (p, bridges) => p.islands.length === 0 || components(p, bridges).groups.length === 1;

// 按规则检查：无交叉、每岛桥数等于数字、全部连通
export function checkSolution(p, bridges) {
  for (let e = 0; e < p.edges.length; e++) {
    if (bridges[e] > 2) return false;
    if (bridges[e] && p.cross[e].some((c) => bridges[c] > 0)) return false;
  }
  for (let k = 0; k < p.islands.length; k++) {
    let s = 0;
    for (const e of p.islandEdges[k]) s += bridges[e];
    if (s !== p.islands[k].n) return false;
  }
  return isConnected(p, bridges);
}

// 'playing' 未全部满足 / 'disconnected' 全部满足但不连通 / 'solved'
export function evaluate(game) {
  if (satisfiedCount(game) !== game.p.islands.length) return 'playing';
  if (!isConnected(game.p, game.bridges)) return 'disconnected';
  return checkSolution(game.p, game.bridges) ? 'solved' : 'playing';
}

// ---------------------------------------------------------------- 存档
const SAVE_VERSION = 1;

export function serialize(game) {
  return {
    v: SAVE_VERSION,
    level: game.level,
    puzzle: game.p.str,
    cols: game.p.cols,
    rows: game.p.rows,
    bridges: [...game.bridges],
    undo: game.undo,
    elapsed: Math.round(game.elapsed),
  };
}

export function restoreGame(data) {
  try {
    if (!data || data.v !== SAVE_VERSION || !LEVELS[data.level]) return null;
    const game = createGame(data.level, data.puzzle, data.cols, data.rows);
    const m = game.bridges.length;
    if (!Array.isArray(data.bridges) || data.bridges.length !== m) return null;
    if (data.bridges.some((b) => !(b === 0 || b === 1 || b === 2))) return null;
    game.bridges.set(data.bridges);
    for (let e = 0; e < m; e++) {
      if (game.bridges[e] && blockers(game, e).length) return null;
    }
    const okStep = (s) =>
      Array.isArray(s) && s.every((x) => Array.isArray(x) && x[0] >= 0 && x[0] < m && x[1] >= 0 && x[1] <= 2);
    game.undo = Array.isArray(data.undo) && data.undo.every(okStep) ? data.undo : [];
    game.elapsed = Number.isFinite(data.elapsed) && data.elapsed >= 0 ? data.elapsed : 0;
    if (evaluate(game) === 'solved') return null;
    return game;
  } catch {
    return null;
  }
}
