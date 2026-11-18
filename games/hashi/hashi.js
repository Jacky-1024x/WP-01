import { initPage, storage, toast } from '../../js/pwa.js';
import { play, isMuted } from '../../js/sfx.js';
import {
  LEVELS,
  createGame,
  restoreGame,
  serialize,
  cycleBridge,
  clearBridges,
  undo,
  hasBridges,
  islandState,
  satisfiedCount,
  components,
  evaluate,
  edgeBetween,
  neighborIsland,
} from './board.js';
import { generate } from './generator.js';

initPage();

const LEVEL_NAMES = { easy: '简单', medium: '中等', hard: '困难', expert: '专家' };
const U = 100; // SVG 中每格的单位长度
const MAX_S = 56;
const WRAP_PAD_X = 12;
const WRAP_PAD_Y = 10;
const R = 40; // 岛半径
const PAD = 0.18; // 棋盘四周留白（格）
const DOUBLE_GAP = 11; // 双桥两条线各自偏离中心的距离
const DRAG_START = 0.35; // 拖动超过 0.35 格才锁定方向
const ARM_MAX = 1.2; // 拖过 min(两岛距离 / 2, 1.2 格) 即生效
const TAP_PX = 8;

const stateStore = storage('h5.hashi.state', null);
const levelStore = storage('h5.hashi.level', 'easy');
const statsStore = storage('h5.hashi.stats', {});
const helpStore = storage('h5.hashi.helpSeen', false);

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const board = $('board');
const boardWrap = $('boardWrap');
const dotsLayer = $('dotsLayer');
const guideLayer = $('guideLayer');
const bridgeLayer = $('bridgeLayer');
const islandLayer = $('islandLayer');

let game = null;
let islandEls = [];
let bridgeEls = new Map(); // edge → <g>
let selected = -1;
let runningSince = null;
let busyUntil = 0;
let confirmAction = null;

// ---------------------------------------------------------------- 工具
const isOver = () => game.status === 'won';
const busy = () => performance.now() < busyUntil;
const holdInput = (ms) => (busyUntil = Math.max(busyUntil, performance.now() + ms));

function svg(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function vibrate(pattern) {
  if (!isMuted()) navigator.vibrate?.(pattern);
}

function animate(el, cls, delay = 0) {
  el.classList.remove(cls);
  void el.getBoundingClientRect();
  el.style.setProperty('--d', `${Math.round(delay)}ms`);
  el.classList.add(cls);
}

function anyModalOpen() {
  return [...document.querySelectorAll('.modal')].some((m) => !m.hidden);
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const center = (k) => {
  const { x, y } = game.p.islands[k];
  return [x * U + U / 2, y * U + U / 2];
};

// ---------------------------------------------------------------- 计时
function elapsed() {
  return game.elapsed + (runningSince !== null ? performance.now() - runningSince : 0);
}

function startClock() {
  if (game.status === 'playing' && runningSince === null && !document.hidden) runningSince = performance.now();
}

function stopClock() {
  if (runningSince === null) return;
  game.elapsed += performance.now() - runningSince;
  runningSince = null;
}

function renderTimer() {
  $('timer').textContent = formatTime(elapsed());
}

// ---------------------------------------------------------------- 棋盘 SVG
function buildBoard() {
  const { cols, rows, islands } = game.p;
  board.setAttribute('viewBox', `${-PAD * U} ${-PAD * U} ${(cols + 2 * PAD) * U} ${(rows + 2 * PAD) * U}`);
  board.classList.remove('won');
  dotsLayer.replaceChildren();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (game.p.islandAt[y * cols + x] < 0) dotsLayer.append(svg('circle', { cx: x * U + U / 2, cy: y * U + U / 2, r: 4 }));
    }
  }
  islandEls = islands.map((isl, k) => {
    const g = svg('g', { class: 'island', transform: `translate(${isl.x * U + U / 2} ${isl.y * U + U / 2})` });
    g.dataset.k = k;
    const inner = svg('g');
    const text = svg('text', { y: 1 });
    text.textContent = isl.n;
    inner.append(svg('circle', { class: 'ring', r: R + 8 }), svg('circle', { r: R }), text);
    g.append(inner);
    return g;
  });
  islandLayer.replaceChildren(...islandEls);
  bridgeLayer.replaceChildren();
  bridgeEls = new Map();
  guideLayer.replaceChildren();
  selected = -1;
}

function bridgeLines(e, from) {
  const { a, b, dir } = game.p.edges[e];
  const s = from === b ? b : a;
  const t = s === a ? b : a;
  const [x1, y1] = center(s);
  const [x2, y2] = center(t);
  const n = game.bridges[e];
  const offs = n === 2 ? [-DOUBLE_GAP, DOUBLE_GAP] : [0];
  return offs.map((o) =>
    svg('line', {
      x1: dir === 'v' ? x1 + o : x1,
      x2: dir === 'v' ? x2 + o : x2,
      y1: dir === 'h' ? y1 + o : y1,
      y2: dir === 'h' ? y2 + o : y2,
      pathLength: 1,
    }),
  );
}

// from：从哪个岛开始伸展（用于动画方向）
function paintBridge(e, { grow = false, from = -1 } = {}) {
  const n = game.bridges[e];
  let g = bridgeEls.get(e);
  if (!n) {
    g?.remove();
    bridgeEls.delete(e);
    return;
  }
  if (!g) {
    g = svg('g');
    bridgeEls.set(e, g);
    bridgeLayer.append(g);
  }
  g.replaceChildren(...bridgeLines(e, from));
  g.classList.toggle('grow', grow);
}

function paintIsland(k, prevState) {
  const el = islandEls[k];
  const s = islandState(game, k);
  el.dataset.s = s;
  el.classList.toggle('selected', k === selected);
  if (prevState && prevState !== 'done' && s === 'done') animate(el, 'pop');
}

function renderGuides(preview) {
  const items = [];
  if (selected >= 0 && !isOver()) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const o = neighborIsland(game.p, selected, dx, dy);
      if (o < 0) continue;
      const [x1, y1] = center(selected);
      const [x2, y2] = center(o);
      items.push(svg('line', { class: 'guide', x1, y1, x2, y2 }));
    }
  }
  if (preview) {
    const [x1, y1] = center(preview.from);
    const [x2, y2] = center(preview.to);
    items.push(svg('line', { class: `preview${preview.armed ? ' armed' : ''}`, x1, y1, x2, y2 }));
  }
  guideLayer.replaceChildren(...items);
}

function renderStatus() {
  $('islandsDone').textContent = `${satisfiedCount(game)} / ${game.p.islands.length}`;
  renderTimer();
  for (const btn of document.querySelectorAll('#levelSelect button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.level === game.level));
  }
  $('undoBtn').disabled = isOver() || !game.undo.length;
  $('clearBtn').disabled = isOver() || !hasBridges(game);
}

function render() {
  for (let e = 0; e < game.bridges.length; e++) paintBridge(e);
  for (let k = 0; k < islandEls.length; k++) paintIsland(k);
  renderGuides();
  renderStatus();
}

function layout() {
  const { cols, rows } = game.p;
  const w = boardWrap.clientWidth - 2 * WRAP_PAD_X;
  const h = boardWrap.clientHeight - 2 * WRAP_PAD_Y;
  const s = Math.max(16, Math.floor(Math.min(MAX_S, w / (cols + 2 * PAD), h / (rows + 2 * PAD))));
  board.style.width = `${Math.round(s * (cols + 2 * PAD))}px`;
  board.style.height = `${Math.round(s * (rows + 2 * PAD))}px`;
}

// ---------------------------------------------------------------- 存档与统计
function save() {
  if (!game) return;
  if (isOver()) stateStore.set(null);
  else stateStore.set(serialize({ ...game, elapsed: elapsed() }));
}

// 返回是否打破了已有的最佳用时
function recordResult() {
  const all = statsStore.get();
  const s = { solved: 0, total: 0, best: [], ...all[game.level] };
  const t = Math.max(1, Math.floor(elapsed() / 1000));
  const record = s.best.length > 0 && t < s.best[0].t;
  s.solved++;
  s.total += t;
  s.best = [...s.best, { t, date: new Date().toISOString().slice(0, 10) }].sort((a, b) => a.t - b.t).slice(0, 5);
  all[game.level] = s;
  statsStore.set(all);
  return record;
}

// ---------------------------------------------------------------- 对局
function makePuzzle(level) {
  for (;;) {
    const res = generate(level);
    if (res) return res;
  }
}

function newGame(level = game?.level ?? 'easy') {
  runningSince = null;
  const { puzzle, cols, rows } = makePuzzle(level);
  game = createGame(level, puzzle, cols, rows);
  levelStore.set(level);
  busyUntil = 0;
  cancelDrag();
  $('resultModal').hidden = true;
  buildBoard();
  layout();
  render();
  startClock();
  save();
}

// 已经架过桥、尚未完成的题，放弃前需要确认
function guardAbandon(text, action) {
  if (isOver() || !game.undo.length) {
    action();
    return;
  }
  $('confirmText').textContent = text;
  confirmAction = action;
  $('confirmModal').hidden = false;
}

const requestNewGame = () => guardAbandon('换一道新题将放弃本题的进度，确定吗？', () => newGame());

// 改动了若干条边之后统一刷新
function afterChange(edges, prevStates, opts = {}) {
  for (const e of edges) paintBridge(e, { grow: !!opts.grow, from: opts.from ?? -1 });
  for (let k = 0; k < islandEls.length; k++) paintIsland(k, prevStates[k]);
  renderGuides();
  const result = evaluate(game);
  if (result === 'solved') {
    win();
    return;
  }
  if (result === 'disconnected') {
    play('error', 0.12);
    toast('所有岛需要连成一片');
    const { comp } = components(game.p, game.bridges);
    for (let k = 0; k < islandEls.length; k++) if (comp[k] !== 0) animate(islandEls[k], 'flash');
  }
  renderStatus();
  save();
}

const snapshotStates = () => islandEls.map((_, k) => islandState(game, k));

function doCycle(e, from) {
  if (e < 0 || busy() || isOver()) return;
  const prev = snapshotStates();
  const res = cycleBridge(game, e);
  if (!res.ok) {
    play('error');
    for (const c of res.blocked) {
      const g = bridgeEls.get(c);
      if (g) animate(g, 'blocked');
    }
    return;
  }
  if (res.next > 0) {
    play('place');
    vibrate(10);
  } else {
    play('select');
  }
  afterChange([e], prev, { grow: res.next > 0, from: from ?? -1 });
}

function doUndo() {
  if (busy() || isOver()) return;
  const prev = snapshotStates();
  const edges = undo(game);
  if (!edges) return;
  play('move');
  afterChange(edges, prev);
}

function doClear() {
  if (busy() || isOver()) return;
  const prev = snapshotStates();
  const edges = game.bridges.reduce((acc, b, e) => (b ? [...acc, e] : acc), []);
  if (!clearBridges(game)) return;
  play('move');
  afterChange(edges, prev);
}

function select(k) {
  const old = selected;
  selected = k;
  if (old >= 0) paintIsland(old);
  if (k >= 0) paintIsland(k);
  renderGuides();
}

function win() {
  stopClock();
  game.status = 'won';
  const record = recordResult();
  save();
  selected = -1;
  cancelDrag();
  render();
  board.classList.add('won');
  const { cols } = game.p;
  game.p.islands.forEach((isl, k) => {
    animate(islandEls[k], 'shine', ((isl.x + isl.y) / (cols * 2)) * 600);
  });
  play('win', 0.1);
  holdInput(1000);
  setTimeout(() => showResult(record), 1000);
}

// ---------------------------------------------------------------- 弹窗
function showResult(record) {
  const s = statsStore.get()[game.level] || { solved: 0, total: 0, best: [] };
  $('resultDetail').textContent = `${LEVEL_NAMES[game.level]} · ${game.p.cols} × ${game.p.rows} · 用时 ${formatTime(elapsed())}`;
  $('resultRecord').hidden = !record;
  const items = [
    [String(s.solved), '已完成'],
    [s.best?.length ? formatTime(s.best[0].t * 1000) : '—', '最佳用时'],
    [s.solved ? formatTime((s.total / s.solved) * 1000) : '—', '平均用时'],
  ];
  $('resultStats').replaceChildren(
    ...items.map(([value, label]) => {
      const div = document.createElement('div');
      const b = document.createElement('b');
      const span = document.createElement('span');
      b.textContent = value;
      span.textContent = label;
      div.append(b, span);
      return div;
    }),
  );
  $('resultModal').hidden = false;
}

// ---------------------------------------------------------------- 指针输入
// 从岛上按下并拖动：锁定方向上最近的岛，拖过一定距离后松手即循环切换桥数。
// 没有拖动的轻点：点岛 = 选中 / 与已选中的邻岛连桥；点有桥经过的空格 = 切换这座桥；点空白 = 取消选中。
let drag = null;

function toGrid(clientX, clientY) {
  const r = board.getBoundingClientRect();
  const { cols, rows } = game.p;
  return [((clientX - r.left) / r.width) * (cols + 2 * PAD) - PAD, ((clientY - r.top) / r.height) * (rows + 2 * PAD) - PAD];
}

function cellIndex(gx, gy) {
  const x = Math.floor(gx);
  const y = Math.floor(gy);
  if (x < 0 || y < 0 || x >= game.p.cols || y >= game.p.rows) return -1;
  return y * game.p.cols + x;
}

function cancelDrag() {
  if (drag) renderGuides();
  drag = null;
}

function updateDrag(e) {
  const [gx, gy] = toGrid(e.clientX, e.clientY);
  const ddx = gx - drag.gx;
  const ddy = gy - drag.gy;
  if (Math.hypot(e.clientX - drag.px, e.clientY - drag.py) > TAP_PX) drag.moved = true;
  if (drag.k < 0) return;
  if (Math.max(Math.abs(ddx), Math.abs(ddy)) < DRAG_START) {
    drag.target = -1;
    renderGuides();
    return;
  }
  const horizontal = Math.abs(ddx) >= Math.abs(ddy);
  const dx = horizontal ? Math.sign(ddx) : 0;
  const dy = horizontal ? 0 : Math.sign(ddy);
  const target = neighborIsland(game.p, drag.k, dx, dy);
  drag.target = target;
  if (target < 0) {
    drag.armed = false;
    renderGuides();
    return;
  }
  const a = game.p.islands[drag.k];
  const b = game.p.islands[target];
  const dist = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
  const progress = horizontal ? ddx * dx : ddy * dy;
  drag.armed = progress >= Math.min(dist / 2, ARM_MAX);
  renderGuides({ from: drag.k, to: target, armed: drag.armed });
}

function handleTap(gx, gy) {
  const i = cellIndex(gx, gy);
  if (i < 0) {
    select(-1);
    return;
  }
  const k = game.p.islandAt[i];
  if (k >= 0) {
    if (k === selected) {
      select(-1);
      return;
    }
    const e = selected >= 0 ? edgeBetween(game.p, selected, k) : -1;
    if (e >= 0) doCycle(e, selected);
    else {
      play('tap');
      select(k);
    }
    return;
  }
  const e = [...bridgeEls.keys()].find((id) => game.p.edges[id].cells.includes(i));
  if (e !== undefined) doCycle(e);
  else select(-1);
}

board.addEventListener('pointerdown', (e) => {
  if (anyModalOpen() || !game) return;
  if (drag) {
    // 第二根手指：取消本次拖动
    cancelDrag();
    return;
  }
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (busy() || isOver()) return;
  const [gx, gy] = toGrid(e.clientX, e.clientY);
  const i = cellIndex(gx, gy);
  const k = i >= 0 ? game.p.islandAt[i] : -1;
  drag = { id: e.pointerId, k, gx, gy, px: e.clientX, py: e.clientY, moved: false, target: -1, armed: false };
  board.setPointerCapture?.(e.pointerId);
  e.preventDefault();
});

board.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  updateDrag(e);
});

function endPointer(e, cancelled) {
  if (!drag || drag.id !== e.pointerId) return;
  const d = drag;
  cancelDrag();
  if (cancelled) return;
  if (!d.moved) {
    handleTap(d.gx, d.gy);
    return;
  }
  if (d.k >= 0 && d.armed && d.target >= 0) {
    doCycle(edgeBetween(game.p, d.k, d.target), d.k);
  }
}

board.addEventListener('pointerup', (e) => endPointer(e, false));
board.addEventListener('pointercancel', (e) => endPointer(e, true));
board.addEventListener('contextmenu', (e) => e.preventDefault());

board.addEventListener('animationend', (e) => {
  const el = e.target.closest?.('.island, .bridges g');
  el?.classList.remove('pop', 'flash', 'shine', 'blocked', 'grow');
});

// ---------------------------------------------------------------- 键盘
const DIRS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

// 方向键在岛之间移动选中：优先同一行 / 列上最近的岛，否则取该方向上最近的岛
function islandToward(k, dx, dy) {
  const direct = neighborIsland(game.p, k, dx, dy);
  if (direct >= 0) return direct;
  const { x, y } = game.p.islands[k];
  let best = -1;
  let bestD = Infinity;
  game.p.islands.forEach((o, j) => {
    const along = (o.x - x) * dx + (o.y - y) * dy;
    if (along <= 0) return;
    const side = Math.abs((o.x - x) * dy) + Math.abs((o.y - y) * dx);
    const d = along + side * 2;
    if (d < bestD) {
      bestD = d;
      best = j;
    }
  });
  return best;
}

document.addEventListener('keydown', (e) => {
  if (anyModalOpen() || e.altKey || !game) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if ((e.metaKey || e.ctrlKey) && key === 'z') {
    e.preventDefault();
    doUndo();
    return;
  }
  if (e.metaKey || e.ctrlKey) return;
  if (key === 'n') {
    requestNewGame();
  } else if (key === 'u') {
    doUndo();
  } else if (DIRS[key] && !isOver()) {
    e.preventDefault();
    const [dx, dy] = DIRS[key];
    if (selected < 0) {
      select(0);
      return;
    }
    if (e.shiftKey) {
      const o = neighborIsland(game.p, selected, dx, dy);
      if (o >= 0) doCycle(edgeBetween(game.p, selected, o), selected);
      else play('error');
    } else {
      const o = islandToward(selected, dx, dy);
      if (o >= 0) select(o);
    }
  } else if (key === 'Escape') {
    select(-1);
  }
});

// ---------------------------------------------------------------- 按钮
$('restartBtn').addEventListener('click', requestNewGame);
$('newBtn').addEventListener('click', requestNewGame);
$('undoBtn').addEventListener('click', doUndo);
$('clearBtn').addEventListener('click', doClear);

$('levelSelect').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-level]');
  if (!btn || btn.dataset.level === game.level) return;
  const level = btn.dataset.level;
  guardAbandon('切换难度将放弃本题的进度，确定吗？', () => newGame(level));
});

$('confirmOk').addEventListener('click', () => {
  $('confirmModal').hidden = true;
  const action = confirmAction;
  confirmAction = null;
  action?.();
});

$('resultAgain').addEventListener('click', () => newGame());
$('resultClose').addEventListener('click', () => ($('resultModal').hidden = true));
$('helpBtn').addEventListener('click', () => ($('helpModal').hidden = false));

for (const id of ['helpModal', 'confirmModal']) {
  $(id).addEventListener('click', (e) => {
    if (e.target === e.currentTarget || e.target.closest('[data-close]')) e.currentTarget.hidden = true;
  });
}

// ---------------------------------------------------------------- 生命周期
setInterval(() => runningSince !== null && renderTimer(), 250);

document.addEventListener('visibilitychange', () => {
  if (!game) return;
  if (document.hidden) {
    stopClock();
    save();
  } else {
    startClock();
  }
});

window.addEventListener('pagehide', save);
new ResizeObserver(() => game && layout()).observe(boardWrap);

// ---------------------------------------------------------------- 启动
const saved = restoreGame(stateStore.get());
if (saved) {
  game = saved;
  buildBoard();
  layout();
  render();
  startClock();
} else {
  newGame(LEVELS[levelStore.get()] ? levelStore.get() : 'easy');
}

if (!helpStore.get()) {
  helpStore.set(true);
  $('helpModal').hidden = false;
}
