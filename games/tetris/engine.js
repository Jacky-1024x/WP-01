// 俄罗斯方块纯逻辑：场地、7 袋随机、SRS 旋转、锁定延迟、消行与计分、模式规则。
// 不依赖 DOM 和真实时间：界面层调用 move / rotate / hardDrop / hold，并按固定步长调用 tick；
// 引擎把锁定、消行、升级、结束等事件写入 g.events，由界面层取走后播放动画和音效。

export const COLS = 10;
export const ROWS = 20;
export const BUFFER = 20; // 可见区上方的隐藏行，y 为负数
export const TYPES = 'IOTSZJL';
export const MODES = ['marathon', 'sprint', 'ultra'];
export const LOCK_DELAY = 500;
export const MAX_RESETS = 15;
export const SOFT_FACTOR = 20;
export const MAX_LEVEL = 20;
export const SPRINT_LINES = 40;
export const ULTRA_MS = 120000;
export const CLEAR_DELAY = [0, 200, 200, 200, 300];

const SAVE_VERSION = 1;

// 出生朝向，坐标 y 向下；I、O 在 4×4 框内，其余在 3×3 框内
const SPAWN = {
  I: [[0, 1], [1, 1], [2, 1], [3, 1]],
  O: [[1, 0], [2, 0], [1, 1], [2, 1]],
  T: [[1, 0], [0, 1], [1, 1], [2, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
  J: [[0, 0], [0, 1], [1, 1], [2, 1]],
  L: [[2, 0], [0, 1], [1, 1], [2, 1]],
};

// SHAPES[type][rot] = 4 个格子的相对坐标；rot 0 / 1 / 2 / 3 对应 SRS 的 0 / R / 2 / L
export const SHAPES = {};
for (const type of TYPES) {
  const n = type === 'I' || type === 'O' ? 4 : 3;
  const rots = [SPAWN[type]];
  for (let r = 1; r < 4; r++) {
    rots.push(type === 'O' ? SPAWN.O : rots[r - 1].map(([x, y]) => [n - 1 - y, x]));
  }
  SHAPES[type] = rots;
}

// SRS 踢墙表，沿用资料的写法：y 向上为正，使用时取反
const KICKS = {
  '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};
const KICKS_I = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

// 得分表（乘以等级）：[消 0 行, 1 行, 2 行, 3 行, 4 行]
const POINTS = {
  none: [0, 100, 300, 500, 800],
  mini: [100, 200, 400],
  tspin: [400, 800, 1200, 1600],
};

export const typeId = (type) => TYPES.indexOf(type) + 1;
export const typeOf = (id) => TYPES[id - 1];
const idx = (x, y) => (y + BUFFER) * COLS + x;

export function gravityMs(level) {
  return Math.pow(0.8 - (level - 1) * 0.007, level - 1) * 1000;
}

// mulberry32；状态存在 g.seed 里，存档后能接着同一序列
function rand(g) {
  const s = (g.seed = (g.seed + 0x6d2b79f5) | 0);
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function refill(g) {
  while (g.queue.length < 7) {
    const bag = [...TYPES];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(rand(g) * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    g.queue.push(...bag);
  }
}

// ---------------------------------------------------------------- 场地查询
export function cell(g, x, y) {
  return g.board[idx(x, y)];
}

function occupied(g, x, y) {
  if (x < 0 || x >= COLS || y >= ROWS || y < -BUFFER) return true;
  return g.board[idx(x, y)] !== 0;
}

export function fits(g, type, rot, x, y) {
  return SHAPES[type][rot].every(([cx, cy]) => !occupied(g, x + cx, y + cy));
}

export function cellsOf(p, y = p.y) {
  return SHAPES[p.type][p.rot].map(([cx, cy]) => [p.x + cx, y + cy]);
}

export function ghostY(g) {
  const p = g.piece;
  let y = p.y;
  while (fits(g, p.type, p.rot, p.x, y + 1)) y++;
  return y;
}

function grounded(g) {
  const p = g.piece;
  return !fits(g, p.type, p.rot, p.x, p.y + 1);
}

export const canAct = (g) => g.status === 'playing' && !g.clearing && !!g.piece;

// ---------------------------------------------------------------- 对局
export function createGame({ mode = 'marathon', startLevel = 1, seed = (Math.random() * 2 ** 32) >>> 0 } = {}) {
  if (!MODES.includes(mode)) mode = 'marathon';
  const level = mode === 'marathon' ? Math.min(10, Math.max(1, Math.floor(startLevel) || 1)) : 1;
  const g = {
    mode,
    startLevel: level,
    seed: seed | 0,
    board: new Uint8Array(COLS * (ROWS + BUFFER)),
    queue: [],
    piece: null,
    hold: null,
    holdUsed: false,
    status: 'playing', // playing / over（堆满）/ done（达成模式目标或时间到）
    score: 0,
    lines: 0,
    level,
    combo: -1,
    b2b: false,
    elapsed: 0,
    pieces: 0,
    tetrises: 0,
    tspins: 0,
    maxCombo: 0,
    gravity: 0,
    lockTimer: 0,
    lockResets: 0,
    lowestY: 0,
    lastRotate: false,
    lastKick: -1,
    clearing: null, // { rows, t, dur } 消行动画期间
    version: 0, // 已锁定的方块变化时加 1，界面据此重画缓存
    events: [],
  };
  refill(g);
  spawn(g);
  return g;
}

function spawn(g, type = null) {
  if (!type) {
    type = g.queue.shift();
    refill(g);
  }
  const p = { type, rot: 0, x: 3, y: -2 };
  g.piece = p;
  g.gravity = 0;
  g.lockTimer = 0;
  g.lockResets = 0;
  g.lastRotate = false;
  g.lastKick = -1;
  if (!fits(g, type, 0, p.x, p.y)) {
    end(g, 'over', 'blockout');
    return false;
  }
  if (fits(g, type, 0, p.x, p.y + 1)) p.y++;
  g.lowestY = p.y;
  g.events.push({ type: 'spawn' });
  return true;
}

function end(g, status, reason) {
  g.status = status;
  g.events.push({ type: status, reason });
}

// 落到比之前更低的一行时，锁定延迟的重置次数清零
function reachLowest(g) {
  if (g.piece.y > g.lowestY) {
    g.lowestY = g.piece.y;
    g.lockResets = 0;
  }
}

function resetLock(g, wasGrounded) {
  if (wasGrounded && g.lockResets < MAX_RESETS) {
    g.lockTimer = 0;
    g.lockResets++;
  }
}

export function move(g, dx) {
  if (!canAct(g)) return false;
  const p = g.piece;
  if (!fits(g, p.type, p.rot, p.x + dx, p.y)) return false;
  const was = grounded(g);
  p.x += dx;
  g.lastRotate = false;
  resetLock(g, was);
  return true;
}

// dir：+1 顺时针，-1 逆时针
export function rotate(g, dir) {
  if (!canAct(g)) return false;
  const p = g.piece;
  if (p.type === 'O') return true;
  const to = (p.rot + dir + 4) % 4;
  const kicks = (p.type === 'I' ? KICKS_I : KICKS)[`${p.rot}>${to}`];
  const was = grounded(g);
  for (let i = 0; i < kicks.length; i++) {
    const nx = p.x + kicks[i][0];
    const ny = p.y - kicks[i][1];
    if (!fits(g, p.type, to, nx, ny)) continue;
    Object.assign(p, { rot: to, x: nx, y: ny });
    g.lastRotate = true;
    g.lastKick = i;
    reachLowest(g);
    resetLock(g, was);
    return true;
  }
  return false;
}

export function hardDrop(g) {
  if (!canAct(g)) return false;
  const p = g.piece;
  const from = p.y;
  p.y = ghostY(g);
  if (p.y > from) g.lastRotate = false;
  g.score += (p.y - from) * 2;
  lock(g, true, from);
  return true;
}

export function hold(g) {
  if (!canAct(g) || g.holdUsed) return false;
  const held = g.hold;
  g.hold = g.piece.type;
  g.holdUsed = true;
  g.events.push({ type: 'hold' });
  spawn(g, held);
  return true;
}

export function tick(g, dt, soft = false) {
  if (g.clearing) {
    addTime(g, dt);
    g.clearing.t += dt;
    if (g.clearing.t < g.clearing.dur) return;
    removeRows(g, g.clearing.rows);
    g.clearing = null;
    g.version++;
    if (g.status !== 'playing') return;
    if (timeUp(g)) end(g, 'done', 'time');
    else spawn(g);
    return;
  }
  if (g.status !== 'playing') return;
  addTime(g, dt);
  if (timeUp(g)) {
    end(g, 'done', 'time');
    return;
  }
  const p = g.piece;
  if (grounded(g)) {
    g.gravity = 0;
    g.lockTimer += dt;
    if (g.lockResets >= MAX_RESETS || g.lockTimer >= LOCK_DELAY) lock(g);
    return;
  }
  g.lockTimer = 0;
  const interval = gravityMs(g.level);
  g.gravity += dt * (soft ? SOFT_FACTOR : 1);
  let rows = Math.min(ROWS + BUFFER, Math.floor(g.gravity / interval));
  g.gravity -= rows * interval;
  // 逐格下落并检查碰撞，高速时也不会穿过窄缝
  while (rows-- > 0 && fits(g, p.type, p.rot, p.x, p.y + 1)) {
    p.y++;
    g.lastRotate = false;
    if (soft) g.score++;
    reachLowest(g);
  }
  if (grounded(g)) g.gravity = 0;
}

function addTime(g, dt) {
  if (g.status !== 'playing') return;
  g.elapsed += dt;
  if (g.mode === 'ultra') g.elapsed = Math.min(ULTRA_MS, g.elapsed);
}

const timeUp = (g) => g.mode === 'ultra' && g.elapsed >= ULTRA_MS;

// 三角规则：T 中心的 4 个斜角至少 3 个被占（墙和地板也算）
function detectSpin(g, p) {
  if (p.type !== 'T' || !g.lastRotate) return null;
  const corners = [[0, 0], [2, 0], [2, 2], [0, 2]].map(([cx, cy]) => occupied(g, p.x + cx, p.y + cy));
  if (corners.filter(Boolean).length < 3) return null;
  // 正面两个斜角：朝上为左上、右上，朝右为右上、右下……依次顺时针
  const front = corners[p.rot] && corners[(p.rot + 1) % 4];
  return front || g.lastKick === 4 ? 'tspin' : 'mini';
}

function lock(g, hard = false, from = g.piece.y) {
  const p = g.piece;
  const spin = detectSpin(g, p);
  const cells = cellsOf(p);
  const id = typeId(p.type);
  for (const [x, y] of cells) g.board[idx(x, y)] = id;
  g.piece = null;
  g.holdUsed = false;
  g.pieces++;
  g.version++;
  g.events.push({ type: 'lock', piece: p.type, cells, hard, from, to: p.y });
  if (cells.every(([, y]) => y < 0)) {
    end(g, 'over', 'lockout');
    return;
  }
  const rows = [...new Set(cells.map(([, y]) => y))]
    .filter((y) => {
      for (let x = 0; x < COLS; x++) if (!g.board[idx(x, y)]) return false;
      return true;
    })
    .sort((a, b) => a - b);
  award(g, rows, spin);
  if (rows.length) g.clearing = { rows, t: 0, dur: CLEAR_DELAY[rows.length] };
  if (g.mode === 'sprint' && g.lines >= SPRINT_LINES) end(g, 'done', 'lines');
  else if (!rows.length) spawn(g);
}

function award(g, rows, spin) {
  const n = rows.length;
  const level = g.level;
  let pts = POINTS[spin || 'none'][n] ?? 0;
  let b2b = false;
  if (n > 0) {
    if (n === 4 || spin) {
      b2b = g.b2b;
      if (b2b) pts *= 1.5;
      g.b2b = true;
    } else {
      g.b2b = false;
    }
  }
  pts = Math.floor(pts * level);
  let combo = 0;
  if (n > 0) {
    g.combo++;
    if (g.combo > 0) {
      combo = g.combo;
      pts += 50 * combo * level;
      g.maxCombo = Math.max(g.maxCombo, combo);
    }
  } else {
    g.combo = -1;
  }
  g.score += pts;
  g.lines += n;
  if (n === 4) g.tetrises++;
  if (spin) g.tspins++;
  if (n > 0 || spin) g.events.push({ type: 'clear', lines: n, rows, spin, b2b, combo, points: pts });
  if (g.mode === 'marathon') {
    const next = Math.min(MAX_LEVEL, g.startLevel + Math.floor(g.lines / 10));
    if (next > g.level) {
      g.level = next;
      g.events.push({ type: 'levelup', level: next });
    }
  }
}

// 朴素重力：只把消掉的行上方整体下移
function removeRows(g, rows) {
  const keep = [];
  for (let y = ROWS - 1; y >= -BUFFER; y--) {
    if (!rows.includes(y)) keep.push(g.board.slice(idx(0, y), idx(0, y) + COLS));
  }
  g.board.fill(0);
  keep.forEach((row, k) => g.board.set(row, idx(0, ROWS - 1 - k)));
}

export function preview(g, n = 5) {
  return g.queue.slice(0, n);
}

// 最高处进入顶部 4 行时提示危险
export function inDanger(g) {
  for (let i = idx(0, -BUFFER); i < idx(0, 4); i++) if (g.board[i]) return true;
  return false;
}

// ---------------------------------------------------------------- 存档
const NUM_FIELDS = ['score', 'lines', 'elapsed', 'pieces', 'tetrises', 'tspins', 'maxCombo', 'gravity', 'lockTimer', 'lockResets'];

export function serialize(g) {
  return {
    v: SAVE_VERSION,
    mode: g.mode,
    startLevel: g.startLevel,
    level: g.level,
    seed: g.seed,
    board: g.board.join(''),
    queue: g.queue.join(''),
    piece: g.piece && { ...g.piece },
    hold: g.hold,
    holdUsed: g.holdUsed,
    combo: g.combo,
    b2b: g.b2b,
    lowestY: g.lowestY,
    lastRotate: g.lastRotate,
    lastKick: g.lastKick,
    clearing: g.clearing && { ...g.clearing, rows: [...g.clearing.rows] },
    ...Object.fromEntries(NUM_FIELDS.map((k) => [k, g[k]])),
  };
}

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

export function restoreGame(d) {
  try {
    if (!d || d.v !== SAVE_VERSION || !MODES.includes(d.mode)) return null;
    if (typeof d.board !== 'string' || d.board.length !== COLS * (ROWS + BUFFER) || !/^[0-7]+$/.test(d.board)) return null;
    if (typeof d.queue !== 'string' || d.queue.length < 7 || !/^[IOTSZJL]+$/.test(d.queue)) return null;
    if (!isInt(d.startLevel, 1, 10) || !isInt(d.level, d.startLevel, MAX_LEVEL) || !Number.isInteger(d.seed)) return null;
    if (d.mode !== 'marathon' && (d.startLevel !== 1 || d.level !== 1)) return null;
    if (NUM_FIELDS.some((k) => typeof d[k] !== 'number' || !Number.isFinite(d[k]) || d[k] < 0)) return null;
    if (d.hold !== null && !TYPES.includes(d.hold)) return null;
    if (!isInt(d.combo, -1, 1e6) || !isInt(d.lowestY, -BUFFER, ROWS)) return null;
    if (d.mode === 'ultra' && d.elapsed > ULTRA_MS) return null;
    if (d.mode === 'sprint' && d.lines >= SPRINT_LINES) return null;
    const g = createGame({ mode: d.mode, startLevel: d.startLevel, seed: d.seed });
    g.events = [];
    g.board = Uint8Array.from(d.board, Number);
    g.queue = [...d.queue];
    Object.assign(g, {
      seed: d.seed,
      level: d.level,
      hold: d.hold,
      holdUsed: !!d.holdUsed,
      combo: d.combo,
      b2b: !!d.b2b,
      lowestY: d.lowestY,
      lastRotate: !!d.lastRotate,
      lastKick: isInt(d.lastKick, -1, 4) ? d.lastKick : -1,
    });
    for (const k of NUM_FIELDS) g[k] = d[k];
    if (d.clearing) {
      const { rows, t, dur } = d.clearing;
      if (d.piece || !Array.isArray(rows) || !rows.length || rows.length > 4) return null;
      if (!rows.every((y) => isInt(y, 0, ROWS - 1) && [...Array(COLS).keys()].every((x) => g.board[idx(x, y)]))) return null;
      g.clearing = { rows: [...rows], t: Math.max(0, Number(t) || 0), dur: CLEAR_DELAY[rows.length] };
      g.piece = null;
    } else {
      const p = d.piece;
      if (!p || !TYPES.includes(p.type) || !isInt(p.rot, 0, 3) || !Number.isInteger(p.x) || !Number.isInteger(p.y)) return null;
      if (!fits(g, p.type, p.rot, p.x, p.y)) return null;
      g.piece = { type: p.type, rot: p.rot, x: p.x, y: p.y };
    }
    return g;
  } catch {
    return null;
  }
}
