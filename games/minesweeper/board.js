// 扫雷纯逻辑：生成地雷（第一下安全）、挖开与自动展开、插旗、快速挖开、胜负判定、存档校验。
// 不依赖 DOM，便于测试。格子用一维下标 i = y * cols + x，所有修改都直接作用于传入的 game 对象。

export const LEVELS = {
  beginner: { cols: 9, rows: 9, mines: 10 },
  intermediate: { cols: 16, rows: 16, mines: 40 },
  expert: { cols: 30, rows: 16, mines: 99 },
};

export const HIDDEN = 0;
export const OPEN = 1;
export const FLAG = 2;
export const MARK = 3; // 问号

// portrait：高级在竖屏时转置为 16 × 30，难度不变
export function createGame(level = 'beginner', portrait = false) {
  if (!LEVELS[level]) level = 'beginner';
  let { cols, rows, mines } = LEVELS[level];
  if (portrait && cols > rows) [cols, rows] = [rows, cols];
  return {
    level,
    cols,
    rows,
    mines,
    mine: null, // 第一次挖开时才生成
    count: null,
    state: new Uint8Array(cols * rows),
    opened: 0,
    flags: 0,
    status: 'ready', // ready | playing | won | lost
    exploded: -1,
    elapsed: 0, // 已用毫秒数，由界面层累加
  };
}

export function neighbors(game, i) {
  const { cols, rows } = game;
  const x = i % cols;
  const y = (i - x) / cols;
  const out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) out.push(ny * cols + nx);
    }
  }
  return out;
}

function computeCounts(game) {
  const count = new Uint8Array(game.cols * game.rows);
  for (let i = 0; i < count.length; i++) {
    if (game.mine[i]) for (const n of neighbors(game, i)) count[n]++;
  }
  game.count = count;
}

// 第 safe 格及其周围 8 格不放雷；开局前插的旗不影响布雷
export function placeMines(game, safe, rng = Math.random) {
  const total = game.cols * game.rows;
  const excluded = new Set([safe, ...neighbors(game, safe)]);
  const pool = [];
  for (let i = 0; i < total; i++) if (!excluded.has(i)) pool.push(i);
  for (let k = 0; k < game.mines; k++) {
    const j = k + Math.floor(rng() * (pool.length - k));
    [pool[k], pool[j]] = [pool[j], pool[k]];
  }
  game.mine = new Uint8Array(total);
  for (let k = 0; k < game.mines; k++) game.mine[pool[k]] = 1;
  computeCounts(game);
}

const isClosed = (s) => s === HIDDEN || s === MARK;

// 从 starts 开始挖开，空白格按 BFS 向外展开（插旗的格子不会被挖开）。
// 返回 { opened: [[下标, 层数], ...], exploded, autoFlagged }
function open(game, starts) {
  const opened = [];
  let exploded = -1;
  const queue = [];
  const layer = new Map();
  for (const i of starts) {
    if (!isClosed(game.state[i]) || layer.has(i)) continue;
    if (game.mine[i]) {
      if (exploded < 0) exploded = i;
      continue;
    }
    layer.set(i, 0);
    queue.push(i);
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    game.state[i] = OPEN;
    game.opened++;
    opened.push([i, layer.get(i)]);
    if (game.count[i]) continue;
    for (const n of neighbors(game, i)) {
      if (isClosed(game.state[n]) && !layer.has(n)) {
        layer.set(n, layer.get(i) + 1);
        queue.push(n);
      }
    }
  }
  let autoFlagged = [];
  if (exploded >= 0) {
    game.status = 'lost';
    game.exploded = exploded;
  } else if (game.opened === game.cols * game.rows - game.mines) {
    game.status = 'won';
    for (let i = 0; i < game.mine.length; i++) {
      if (game.mine[i] && game.state[i] !== FLAG) {
        game.state[i] = FLAG;
        autoFlagged.push(i);
      }
    }
    game.flags = game.mines;
  }
  return { opened, exploded, autoFlagged };
}

const over = (game) => game.status === 'won' || game.status === 'lost';

// 挖开一格。插旗或已挖开的格子返回 null
export function reveal(game, i, rng = Math.random) {
  if (over(game) || !isClosed(game.state[i])) return null;
  if (game.status === 'ready') {
    placeMines(game, i, rng);
    game.status = 'playing';
  }
  return open(game, [i]);
}

// 对已挖开的数字格快速挖开：周围旗数等于数字时挖开其余未插旗的格子。
// 不是数字格或周围没有可挖的格子返回 null；旗数不符返回 { ok: false, targets }
export function chord(game, i) {
  if (game.status !== 'playing' || game.state[i] !== OPEN || !game.count[i]) return null;
  const around = neighbors(game, i);
  const targets = around.filter((n) => isClosed(game.state[n]));
  if (!targets.length) return null;
  const flags = around.filter((n) => game.state[n] === FLAG).length;
  if (flags !== game.count[i]) return { ok: false, targets };
  return { ok: true, targets, ...open(game, targets) };
}

// 插旗 / 拔旗；marks 为 true 时在「无 → 旗 → 问号 → 无」之间循环。返回新状态，不可操作时返回 null
export function toggleFlag(game, i, marks = false) {
  if (over(game)) return null;
  const s = game.state[i];
  let next;
  if (s === HIDDEN) next = FLAG;
  else if (s === FLAG) next = marks ? MARK : HIDDEN;
  else if (s === MARK) next = HIDDEN;
  else return null;
  if (s === FLAG) game.flags--;
  if (next === FLAG) game.flags++;
  game.state[i] = next;
  return next;
}

export const minesLeft = (game) => game.mines - game.flags;

export const safeTotal = (game) => game.cols * game.rows - game.mines;

// ---------------------------------------------------------------- 存档

export function serialize(game) {
  const { level, cols, rows, mines, status, elapsed } = game;
  return {
    level,
    cols,
    rows,
    mines,
    status,
    elapsed: Math.round(elapsed),
    mine: game.mine ? game.mine.join('') : null,
    state: game.state.join(''),
  };
}

// 只存进行中或未开始的对局；数据不合法时返回 null
export function restoreGame(data) {
  try {
    const { level, cols, rows, mines, status, elapsed, mine, state } = data;
    const def = LEVELS[level];
    if (!def || mines !== def.mines) return null;
    const sameShape = (cols === def.cols && rows === def.rows) || (cols === def.rows && rows === def.cols);
    if (!sameShape) return null;
    const total = cols * rows;
    if (typeof state !== 'string' || state.length !== total || !/^[0-3]*$/.test(state)) return null;
    if (!Number.isFinite(elapsed) || elapsed < 0) return null;

    const game = createGame(level);
    Object.assign(game, { cols, rows, state: Uint8Array.from(state, Number), elapsed });
    game.flags = game.state.filter((s) => s === FLAG).length;
    game.opened = game.state.filter((s) => s === OPEN).length;

    if (status === 'ready') {
      if (mine !== null || game.opened) return null;
      return game;
    }
    if (status !== 'playing' || typeof mine !== 'string' || mine.length !== total || !/^[01]*$/.test(mine)) return null;
    game.mine = Uint8Array.from(mine, Number);
    if (game.mine.reduce((a, b) => a + b, 0) !== mines) return null;
    if (!game.opened || game.opened >= safeTotal(game)) return null;
    for (let i = 0; i < total; i++) if (game.mine[i] && game.state[i] === OPEN) return null;
    computeCounts(game);
    game.status = 'playing';
    return game;
  } catch {
    return null;
  }
}
