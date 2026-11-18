// 推箱子纯逻辑：解析关卡、走路 / 对准 / 推、撤销、死格、自动寻路、存档校验。不依赖 DOM。
// 关卡用 XSB 文本：# 墙  空格 地板  . 目标点  $ 箱子  * 箱子在目标点上  @ 玩家  + 玩家在目标点上
// 历史用 LURD 记法：小写 u r d l 为走路，大写 U R D L 为推箱子。

export const OUTSIDE = 0;
export const WALL = 1;
export const FLOOR = 2;

// 方向：0 上 1 右 2 下 3 左
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];
const MOVE_CH = 'urdl';
const PUSH_CH = 'URDL';

export const delta = (g, dir) => DX[dir] + DY[dir] * g.w;

// 解析并校验关卡，非法时返回 null
export function parseLevel(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const n = w * h;
  const tiles = new Uint8Array(n);
  const target = new Uint8Array(n);
  const box = new Uint8Array(n);
  let player = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x] ?? ' ';
      const i = y * w + x;
      if (!'#@+$*. '.includes(ch)) return null;
      if (ch === '#') tiles[i] = WALL;
      if ('.*+'.includes(ch)) target[i] = 1;
      if ('$*'.includes(ch)) box[i] = 1;
      if ('@+'.includes(ch)) {
        if (player >= 0) return null;
        player = i;
      }
    }
  }
  if (player < 0) return null;
  // 从玩家出发能到的非墙格子是地板；碰到地图边缘说明没有被墙围住
  const stack = [player];
  tiles[player] = FLOOR;
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const y = (i - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return null;
    for (let d = 0; d < 4; d++) {
      const j = i + DX[d] + DY[d] * w;
      if (tiles[j] === OUTSIDE) {
        tiles[j] = FLOOR;
        stack.push(j);
      }
    }
  }
  let boxes = 0;
  let targets = 0;
  for (let i = 0; i < n; i++) {
    if ((box[i] || target[i]) && tiles[i] !== FLOOR) return null;
    boxes += box[i];
    targets += target[i];
  }
  if (!boxes || boxes !== targets) return null;
  return { w, h, tiles, target, box, player, boxes };
}

// 死格：箱子在这一格上时，不管怎么推都到不了任何目标点。
// 从每个目标点反向“拉”箱子，只看墙不看箱子，拉得到的是活格。
export function computeDead(level) {
  const { w, tiles, target } = level;
  const live = new Uint8Array(tiles.length);
  const stack = [];
  for (let i = 0; i < tiles.length; i++) {
    if (target[i]) {
      live[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length) {
    const c = stack.pop();
    for (let d = 0; d < 4; d++) {
      const s = DX[d] + DY[d] * w;
      const b = c - s;
      if (!live[b] && tiles[b] === FLOOR && tiles[b - s] === FLOOR) {
        live[b] = 1;
        stack.push(b);
      }
    }
  }
  const dead = new Uint8Array(tiles.length);
  for (let i = 0; i < tiles.length; i++) dead[i] = tiles[i] === FLOOR && !live[i] ? 1 : 0;
  return dead;
}

export function createGame(rows, index = 0) {
  const level = parseLevel(rows);
  if (!level) return null;
  return {
    index,
    rows,
    w: level.w,
    h: level.h,
    tiles: level.tiles,
    target: level.target,
    box: level.box,
    player: level.player,
    start: { box: level.box.slice(), player: level.player },
    dead: computeDead(level),
    facing: 2,
    history: '',
    moves: 0,
    pushes: 0,
    status: isSolvedRaw(level) ? 'won' : 'playing',
  };
}

function isSolvedRaw(g) {
  for (let i = 0; i < g.box.length; i++) if (g.box[i] && !g.target[i]) return false;
  return true;
}

export const isSolved = (g) => isSolvedRaw(g);
export const free = (g, i) => g.tiles[i] === FLOOR && !g.box[i];

// 玩家正前方推得动的箱子位置，没有则 -1
export function aimedBox(g, dir = g.facing) {
  const s = delta(g, dir);
  const b = g.player + s;
  return g.box[b] && free(g, b + s) ? b : -1;
}

// 走一步。allowPush 为 false 时，朝推得动的箱子只转身对准，返回 aim。
// 返回 { type: 'move' | 'push' | 'aim' | 'blocked' | 'bump', dir, from, to, boxFrom, boxTo }
export function step(g, dir, allowPush = true) {
  if (g.status !== 'playing') return null;
  const s = delta(g, dir);
  const from = g.player;
  const next = from + s;
  g.facing = dir;
  if (g.tiles[next] !== FLOOR) return { type: 'bump', dir, from };
  if (!g.box[next]) {
    g.player = next;
    g.history += MOVE_CH[dir];
    g.moves++;
    return { type: 'move', dir, from, to: next };
  }
  const beyond = next + s;
  if (!free(g, beyond)) return { type: 'blocked', dir, from, boxFrom: next };
  if (!allowPush) return { type: 'aim', dir, from, boxFrom: next };
  g.box[next] = 0;
  g.box[beyond] = 1;
  g.player = next;
  g.history += PUSH_CH[dir];
  g.moves++;
  g.pushes++;
  if (isSolvedRaw(g)) g.status = 'won';
  return { type: 'push', dir, from, to: next, boxFrom: next, boxTo: beyond };
}

// 推正对着的箱子；推不动返回 null
export function push(g) {
  if (g.status !== 'playing' || aimedBox(g) < 0) return null;
  return step(g, g.facing, true);
}

// 撤销一步，返回 { type, dir, from, to, boxFrom, boxTo }（from / to 为撤销前后的玩家位置）
export function undo(g) {
  if (!g.history) return null;
  const ch = g.history[g.history.length - 1];
  const pushed = ch === ch.toUpperCase();
  const dir = (pushed ? PUSH_CH : MOVE_CH).indexOf(ch);
  const s = delta(g, dir);
  const from = g.player;
  const to = from - s;
  g.history = g.history.slice(0, -1);
  g.moves--;
  g.player = to;
  g.facing = dir;
  if (g.status === 'won') g.status = 'playing';
  if (!pushed) return { type: 'move', dir, from, to };
  g.box[from + s] = 0;
  g.box[from] = 1;
  g.pushes--;
  return { type: 'push', dir, from, to, boxFrom: from + s, boxTo: from };
}

export function restart(g) {
  g.box = g.start.box.slice();
  g.player = g.start.player;
  g.facing = 2;
  g.history = '';
  g.moves = 0;
  g.pushes = 0;
  g.status = isSolvedRaw(g) ? 'won' : 'playing';
}

// 按 LURD 回放，大小写必须和实际是否推箱子一致；失败返回 false
export function replay(g, history) {
  if (typeof history !== 'string') return false;
  for (const ch of history) {
    const pushDir = PUSH_CH.indexOf(ch);
    const dir = pushDir >= 0 ? pushDir : MOVE_CH.indexOf(ch);
    if (dir < 0 || g.status !== 'playing') return false;
    const res = step(g, dir, true);
    if (!res || res.type !== (pushDir >= 0 ? 'push' : 'move')) return false;
  }
  return true;
}

// 在空地上从玩家走到 to 的最短路径（方向数组），同样长度优先少拐弯；走不到返回 null
export function findPath(g, to) {
  if (to === g.player) return [];
  if (!free(g, to)) return null;
  const n = g.tiles.length;
  // 状态 = 格子 × 进入方向，代价 = 步数 × 1024 + 拐弯数。按步数分层推进，层内松弛拐弯数
  const cost = new Float64Array(n * 4).fill(Infinity);
  const prev = new Int32Array(n * 4).fill(-1);
  let frontier = [];
  for (let d = 0; d < 4; d++) {
    const j = g.player + delta(g, d);
    if (!free(g, j)) continue;
    const k = j * 4 + d;
    cost[k] = 1024;
    frontier.push(k);
  }
  while (frontier.length) {
    const next = [];
    for (const k of frontier) {
      const i = k >> 2;
      const d = k & 3;
      for (let nd = 0; nd < 4; nd++) {
        const j = i + delta(g, nd);
        if (!free(g, j) || j === g.player) continue;
        const nk = j * 4 + nd;
        const c = cost[k] + 1024 + (nd === d ? 0 : 1);
        if (c < cost[nk]) {
          if (cost[nk] === Infinity) next.push(nk);
          cost[nk] = c;
          prev[nk] = k;
        }
      }
    }
    frontier = next;
  }
  let best = -1;
  for (let d = 0; d < 4; d++) if (cost[to * 4 + d] < (best < 0 ? Infinity : cost[best])) best = to * 4 + d;
  if (best < 0) return null;
  const path = [];
  for (let k = best; k >= 0; k = prev[k]) path.push(k & 3);
  return path.reverse();
}

// 存档只保存关卡号和历史，恢复时回放
export function serialize(g, version) {
  return { v: version, level: g.index, history: g.history };
}

export function restoreGame(save, levels, version) {
  if (!save || typeof save !== 'object' || save.v !== version) return null;
  const { level, history } = save;
  if (!Number.isInteger(level) || level < 0 || level >= levels.length) return null;
  const g = createGame(levels[level].map, level);
  if (!g || !replay(g, history)) return null;
  return g.status === 'playing' ? g : null;
}

// 关卡地图的短哈希，用来按关卡保存成绩（关卡顺序调整后成绩不串）
export function levelKey(rows) {
  let h = 5381;
  for (const ch of rows.join('|')) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

// 第 i 关（从 0 开始）可玩：不超过“已通过的最远一关 + 3”
export function isUnlocked(i, maxSolved) {
  return i <= maxSolved + 3;
}
