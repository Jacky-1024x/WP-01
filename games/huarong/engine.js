// 华容道纯逻辑：解析布局、移动规则、胜利判定、BFS 求解。不依赖 DOM，便于 node 测试和 Worker 复用。
//
// 棋盘 4 列 × 5 行，坐标 (x, y)，原点在左上角。
// 一个局面 = 棋子数组 [{ type, x, y }]，宽高由 type 决定；数组下标就是棋子的身份（名字、颜色）。

export const COLS = 4;
export const ROWS = 5;

export const SIZE = {
  cao: [2, 2], // 曹操
  h: [2, 1], // 横将（关羽等）
  v: [1, 2], // 竖将
  s: [1, 1], // 小兵
};

// 曹操左上角到达这里即胜利（底部正中，正对出口）
export const GOAL = { x: 1, y: 3 };

const TYPE_CODE = { cao: 'C', h: 'H', v: 'V', s: 'S' };
const DIRS = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

// 布局文本：5 行、每行 4 个字符，用 / 分隔。同一个字母（或数字）组成一个矩形棋子，'.' 为空格。
// 棋子类型由矩形的大小决定：2×2 曹操，2×1 横将，1×2 竖将，1×1 兵。
export function parseLayout(text) {
  const rows = text.split('/');
  if (rows.length !== ROWS || rows.some((r) => r.length !== COLS)) throw new Error(`布局尺寸错误：${text}`);
  const cells = new Map();
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      if (!cells.has(ch)) cells.set(ch, []);
      cells.get(ch).push([x, y]);
    }),
  );
  const pieces = [];
  for (const [ch, list] of cells) {
    const xs = list.map((c) => c[0]);
    const ys = list.map((c) => c[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const w = Math.max(...xs) - x + 1;
    const h = Math.max(...ys) - y + 1;
    const type = Object.keys(SIZE).find((t) => SIZE[t][0] === w && SIZE[t][1] === h);
    if (!type || list.length !== w * h) throw new Error(`棋子 ${ch} 形状非法：${text}`);
    pieces.push({ type, x, y });
  }
  pieces.sort((a, b) => a.y - b.y || a.x - b.x);
  const counts = { cao: 0, h: 0, v: 0, s: 0 };
  for (const p of pieces) counts[p.type]++;
  if (counts.cao !== 1) throw new Error(`必须恰好有一个曹操：${text}`);
  if (20 - pieces.reduce((n, p) => n + SIZE[p.type][0] * SIZE[p.type][1], 0) !== 2) {
    throw new Error(`必须恰好有两个空格：${text}`);
  }
  return pieces;
}

// 棋子名字：第一员横将叫关羽，其余大将按阅读顺序依次叫张飞、赵云、马超、黄忠（见 PRD 2.1）
export function pieceNames(pieces) {
  const generals = ['张飞', '赵云', '马超', '黄忠'];
  let guan = pieces.findIndex((p) => p.type === 'h');
  if (guan < 0) guan = pieces.findIndex((p) => p.type === 'v');
  let k = 0;
  return pieces.map((p, i) => {
    if (p.type === 'cao') return '曹操';
    if (p.type === 's') return '兵';
    if (i === guan) return '关羽';
    return generals[k++] ?? '大将';
  });
}

export function clonePieces(pieces) {
  return pieces.map((p) => ({ ...p }));
}

// 占用表：长度 20，值为棋子下标，-1 为空
export function buildGrid(pieces) {
  const grid = new Int8Array(COLS * ROWS).fill(-1);
  pieces.forEach((p, i) => {
    const [w, h] = SIZE[p.type];
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) grid[(p.y + dy) * COLS + p.x + dx] = i;
  });
  return grid;
}

function fits(grid, index, type, x, y) {
  const [w, h] = SIZE[type];
  if (x < 0 || y < 0 || x + w > COLS || y + h > ROWS) return false;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const v = grid[(y + dy) * COLS + x + dx];
      if (v !== -1 && v !== index) return false;
    }
  }
  return true;
}

// 某棋子不动其他棋子时能到达的所有位置（不含原位），带最短格数距离。
// 返回 [{ x, y, dist }]，按距离升序。一次「步」可以到达其中任意一个（见 PRD 2.3）。
export function reachable(pieces, index, grid = buildGrid(pieces)) {
  const p = pieces[index];
  const seen = new Set([p.y * COLS + p.x]);
  const out = [];
  let frontier = [[p.x, p.y]];
  for (let dist = 1; frontier.length; dist++) {
    const next = [];
    for (const [x, y] of frontier) {
      for (const [dx, dy] of DIRS) {
        const nx = x + dx;
        const ny = y + dy;
        const k = ny * COLS + nx;
        if (seen.has(k) || !fits(grid, index, p.type, nx, ny)) continue;
        seen.add(k);
        out.push({ x: nx, y: ny, dist });
        next.push([nx, ny]);
      }
    }
    frontier = next;
  }
  return out;
}

// 单格移动是否合法（键盘操作用）
export function canStep(pieces, index, dx, dy, grid = buildGrid(pieces)) {
  const p = pieces[index];
  return fits(grid, index, p.type, p.x + dx, p.y + dy);
}

export function canMoveTo(pieces, index, x, y) {
  return reachable(pieces, index).some((r) => r.x === x && r.y === y);
}

// 移动棋子到 (x, y)；不可达时返回 null，否则返回新局面（不修改原数组）
export function moveTo(pieces, index, x, y) {
  if (!canMoveTo(pieces, index, x, y)) return null;
  const next = clonePieces(pieces);
  next[index].x = x;
  next[index].y = y;
  return next;
}

export function caoIndex(pieces) {
  return pieces.findIndex((p) => p.type === 'cao');
}

export function isWon(pieces) {
  const c = pieces[caoIndex(pieces)];
  return c.x === GOAL.x && c.y === GOAL.y;
}

// 局面键：每格写棋子类型字母。同类棋子互换视为同一局面；
// 同类相邻的竖将 / 横将拼法唯一（只能从上 / 从左两两配对），所以键与局面一一对应。
export function stateKey(pieces, grid = buildGrid(pieces)) {
  let s = '';
  for (let i = 0; i < grid.length; i++) s += grid[i] === -1 ? '.' : TYPE_CODE[pieces[grid[i]].type];
  return s;
}

// 左右镜像的局面等价（步数相同），求解时合并可减少一半状态
function mirrorKey(key) {
  let s = '';
  for (let y = 0; y < ROWS; y++) {
    for (let x = COLS - 1; x >= 0; x--) s += key[y * COLS + x];
  }
  return s;
}

// 局面的所有后继：[{ index, x, y, pieces }]
export function successors(pieces) {
  const grid = buildGrid(pieces);
  const out = [];
  pieces.forEach((p, index) => {
    for (const r of reachable(pieces, index, grid)) {
      const next = clonePieces(pieces);
      next[index].x = r.x;
      next[index].y = r.y;
      out.push({ index, x: r.x, y: r.y, pieces: next });
    }
  });
  return out;
}

// BFS 求最少步数解（步 = 一块棋子移动到任意可达位置）。
// 返回 { steps, path: [{ index, x, y }]（下标对应传入的 pieces）, explored } ，无解返回 null。
export function solve(start, { maxStates = 500000 } = {}) {
  if (isWon(start)) return { steps: 0, path: [], explored: 1 };
  const canon = (k) => {
    const m = mirrorKey(k);
    return m < k ? m : k;
  };
  const startKey = stateKey(start);
  // 每个节点保存：局面、父节点下标、从父局面到它的那一步
  const nodes = [{ pieces: start, parent: -1, move: null }];
  const seen = new Set([canon(startKey)]);
  for (let head = 0; head < nodes.length; head++) {
    const node = nodes[head];
    for (const s of successors(node.pieces)) {
      const key = canon(stateKey(s.pieces));
      if (seen.has(key)) continue;
      seen.add(key);
      nodes.push({ pieces: s.pieces, parent: head, move: { index: s.index, x: s.x, y: s.y } });
      if (isWon(s.pieces)) {
        const path = [];
        for (let i = nodes.length - 1; i > 0; i = nodes[i].parent) path.push(nodes[i].move);
        path.reverse();
        return { steps: path.length, path, explored: nodes.length };
      }
      if (nodes.length > maxStates) return null;
    }
  }
  return null;
}

// 提示：当前局面最少步解法的第一步；已胜利或无解时返回 null
export function hint(pieces) {
  const r = solve(pieces);
  if (!r || !r.path.length) return null;
  return { ...r.path[0], remaining: r.steps };
}

// 步数记录：同一块棋子连续移动合并为一步（见 PRD 2.3）。
// history: [{ index, from: [x, y], to: [x, y] }]，返回新的 history。
export function pushMove(history, index, from, to) {
  const last = history[history.length - 1];
  if (last && last.index === index) {
    const merged = history.slice(0, -1);
    // 走回了这一步开始前的位置：这一步等于没走
    if (last.from[0] === to[0] && last.from[1] === to[1]) return merged;
    merged.push({ index, from: last.from, to });
    return merged;
  }
  return [...history, { index, from, to }];
}

// 按 history 从初始局面回放；任何一步不合法返回 null（存档校验用）
export function replay(initial, history) {
  let pieces = clonePieces(initial);
  for (const m of history) {
    const p = pieces[m?.index];
    if (!p || p.x !== m.from?.[0] || p.y !== m.from?.[1]) return null;
    const next = moveTo(pieces, m.index, m.to[0], m.to[1]);
    if (!next) return null;
    pieces = next;
  }
  return pieces;
}
