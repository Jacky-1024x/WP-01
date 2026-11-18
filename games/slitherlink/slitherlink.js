import { initPage, storage, toast } from '../../js/pwa.js';
import { play, isMuted } from '../../js/sfx.js';
import {
  LEVELS,
  EMPTY,
  LINE,
  CROSS,
  geoOf,
  nearestEdge,
  nearestVertex,
  pathEdges,
  transformClues,
  pickPuzzle,
  pushRecent,
  createGame,
  restoreGame,
  serialize,
  applyChanges,
  pushStep,
  undo,
  redo,
  clearAll,
  tapNext,
  holdNext,
  hasProgress,
  analyze,
  insideCells,
  finish,
} from './board.js';
import { BANK } from './puzzles.js';

initPage();

const NS = 'http://www.w3.org/2000/svg';
// 尺寸常量必须与 slitherlink.css 中 .board-wrap 的 padding 保持一致
const WRAP_PAD = 8;
const MAX_S = 72;
const HOLD_MS = 350;
const DRAG_MIN_PX = 8;
const DRAG_FRACTION = 0.25; // 移动超过 0.25S 视为拖动
const SNAP = 0.4; // 拖动时离格点小于 0.4S 才算到达

const stateStore = storage('h5.slitherlink.state', null);
const levelStore = storage('h5.slitherlink.level', 'easy');
const recentStore = storage('h5.slitherlink.recent', {});
const settingsStore = storage('h5.slitherlink.settings', {});
const statsStore = storage('h5.slitherlink.stats', {});
const helpStore = storage('h5.slitherlink.helpSeen', false);

const $ = (id) => document.getElementById(id);
const board = $('board');
const boardWrap = $('boardWrap');

let game = null;
let geo = null;
let S = 40;
let edgeEls = [];
let crossEls = [];
let clueEls = [];
let dotEls = [];
let preview = null;
let fillLayer = null;
const settings = { errors: true, ...settingsStore.get() };
let runningSince = null;
let busyUntil = 0;
let lastBad = new Set();
let closedToastKey = '';
let confirmAction = null;

// ---------------------------------------------------------------- 工具
const isOver = () => game.status !== 'playing';
const busy = () => performance.now() < busyUntil;

function vibrate(pattern) {
  if (!isMuted()) navigator.vibrate?.(pattern);
}

function animate(el, cls, delay = 0) {
  el.classList.remove(cls);
  void el.getBoundingClientRect();
  if (delay) el.style.setProperty('--d', `${Math.round(delay)}ms`);
  el.classList.add(cls);
}

function anyModalOpen() {
  return [...document.querySelectorAll('.modal')].some((m) => !m.hidden);
}

function svgEl(tag, attrs, parent) {
  const el = document.createElementNS(NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  parent?.appendChild(el);
  return el;
}

// 边 e 的两个端点坐标（以格子为单位）
function edgeCoords(e) {
  const { cols, H } = geo;
  if (e < H) {
    const r = Math.floor(e / cols);
    const c = e % cols;
    return [c, r, c + 1, r];
  }
  const k = e - H;
  const r = Math.floor(k / (cols + 1));
  const c = k % (cols + 1);
  return [c, r, c, r + 1];
}

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

function formatTime(ms) {
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${String(m).padStart(2, '0')}:${s}`;
}

function renderTimer() {
  $('timer').textContent = formatTime(elapsed());
}

// ---------------------------------------------------------------- 棋盘 DOM
function buildBoard() {
  geo = geoOf(game);
  const { rows, cols, E, V } = geo;
  board.replaceChildren();
  board.setAttribute('viewBox', `-0.5 -0.5 ${cols + 1} ${rows + 1}`);
  board.classList.remove('won');
  fillLayer = svgEl('g', {}, board);
  const clueLayer = svgEl('g', {}, board);
  const crossLayer = svgEl('g', {}, board);
  preview = svgEl('line', { class: 'preview', visibility: 'hidden' }, board);
  const edgeLayer = svgEl('g', {}, board);
  const dotLayer = svgEl('g', {}, board);
  clueEls = [];
  for (let i = 0; i < rows * cols; i++) {
    const k = game.clues[i];
    if (k < 0) {
      clueEls.push(null);
      continue;
    }
    const t = svgEl('text', { class: 'clue', x: (i % cols) + 0.5, y: Math.floor(i / cols) + 0.54 }, clueLayer);
    t.textContent = k;
    clueEls.push(t);
  }
  edgeEls = [];
  crossEls = [];
  for (let e = 0; e < E; e++) {
    const [x1, y1, x2, y2] = edgeCoords(e);
    edgeEls.push(svgEl('line', { class: `edge ${y1 === y2 ? 'h' : 'v'}`, x1, y1, x2, y2 }, edgeLayer));
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const s = 0.11;
    crossEls.push(
      svgEl('path', { class: 'cross', d: `M${mx - s} ${my - s}L${mx + s} ${my + s}M${mx + s} ${my - s}L${mx - s} ${my + s}` }, crossLayer),
    );
  }
  dotEls = [];
  for (let v = 0; v < V; v++) {
    dotEls.push(svgEl('circle', { class: 'dot', cx: v % (cols + 1), cy: Math.floor(v / (cols + 1)), r: 0.07 }, dotLayer));
  }
  lastBad = new Set();
  closedToastKey = '';
}

function paintEdge(e, anim = false) {
  const s = game.edges[e];
  const line = edgeEls[e];
  const cross = crossEls[e];
  const wasLine = line.classList.contains('on');
  const wasCross = cross.classList.contains('on');
  line.classList.toggle('on', s === LINE);
  cross.classList.toggle('on', s === CROSS);
  if (!anim) return;
  if (s === LINE && !wasLine) animate(line, 'grow');
  if (s === CROSS && !wasCross) animate(cross, 'pop');
}

// 违规提示与数字满足状态；返回本次新出现的违规元素
function renderChecks() {
  const res = analyze(game);
  const bad = new Set();
  for (let i = 0; i < clueEls.length; i++) {
    const el = clueEls[i];
    if (!el) continue;
    el.classList.toggle('ok', res.cells[i] === 1);
    const isBad = settings.errors && res.cells[i] === 2;
    el.classList.toggle('bad', isBad);
    if (isBad) bad.add(el);
  }
  const badVerts = new Set(settings.errors ? res.badVerts : []);
  for (let v = 0; v < dotEls.length; v++) {
    dotEls[v].classList.toggle('bad', badVerts.has(v));
    if (badVerts.has(v)) bad.add(dotEls[v]);
  }
  const loop = new Set(settings.errors ? res.loopEdges : []);
  for (let e = 0; e < edgeEls.length; e++) edgeEls[e].classList.toggle('loop', loop.has(e));
  if (loop.size) bad.add(edgeEls[res.loopEdges[0]]);
  const fresh = [...bad].filter((el) => !lastBad.has(el));
  lastBad = bad;
  return { res, fresh };
}

function renderStatus() {
  const name = LEVELS[game.level].name;
  $('puzzleTag').textContent = `${name} · 第 ${game.id + 1} 题`;
  renderTimer();
  for (const btn of document.querySelectorAll('#levelSelect button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.level === game.level));
  }
  const playing = !isOver();
  $('undoBtn').setAttribute('aria-disabled', String(!playing || !game.undo.length));
  $('redoBtn').setAttribute('aria-disabled', String(!playing || !game.redo.length));
  $('clearBtn').setAttribute('aria-disabled', String(!playing || !game.edges.some((s) => s !== EMPTY)));
}

function render() {
  for (let e = 0; e < edgeEls.length; e++) paintEdge(e);
  renderChecks();
  renderStatus();
}

// ---------------------------------------------------------------- 尺寸
function layout() {
  const w = boardWrap.clientWidth - 2 * WRAP_PAD;
  const h = boardWrap.clientHeight - 2 * WRAP_PAD;
  S = Math.max(16, Math.floor(Math.min(MAX_S, w / (game.cols + 1), h / (game.rows + 1))));
  board.style.width = `${S * (game.cols + 1)}px`;
  board.style.height = `${S * (game.rows + 1)}px`;
  const r = Math.max(0.07, 2.5 / S);
  for (const d of dotEls) d.setAttribute('r', r);
}

// 屏幕坐标 → 棋盘坐标（以格子为单位，左上角点为原点）
function toBoard(e) {
  const rect = board.getBoundingClientRect();
  const unit = rect.width / (game.cols + 1);
  return { x: (e.clientX - rect.left) / unit - 0.5, y: (e.clientY - rect.top) / unit - 0.5 };
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
  const s = { played: 0, best: [], total: 0, ...all[game.level] };
  const t = Math.round(elapsed() / 100) / 10;
  const record = s.best.length > 0 && t < s.best[0].t;
  s.played++;
  s.total = Math.round((s.total + t) * 10) / 10;
  s.best = [...s.best, { t, date: new Date().toISOString().slice(0, 10) }].sort((a, b) => a.t - b.t).slice(0, 5);
  all[game.level] = s;
  statsStore.set(all);
  return record;
}

// ---------------------------------------------------------------- 对局
function newGame(level = game?.level ?? 'easy') {
  runningSince = null;
  busyUntil = 0;
  cancelPress();
  const list = BANK[level];
  const recentAll = recentStore.get() || {};
  const { id, t } = pickPuzzle(list.length, recentAll[level]);
  recentStore.set({ ...recentAll, [level]: pushRecent(recentAll[level], id, list.length) });
  game = createGame(level, id, t, transformClues(list[id], LEVELS[level].rows, t));
  levelStore.set(level);
  $('resultModal').hidden = true;
  buildBoard();
  layout();
  render();
  startClock();
  save();
}

// 有过操作、尚未完成的题，放弃前需要确认；放弃不计入统计
function guardAbandon(text, action) {
  if (isOver() || !hasProgress(game)) {
    action();
    return;
  }
  $('confirmText').textContent = text;
  confirmAction = action;
  $('confirmModal').hidden = false;
}

const requestNewGame = () => guardAbandon('换一道新题将放弃本题的进度，确定吗？', () => newGame());

// 每次操作结束后：违规提示、完成判定、存档
function afterChange() {
  const { res, fresh } = renderChecks();
  renderStatus();
  if (res.solved) {
    win();
    return;
  }
  if (fresh.length) {
    play('error', 0.05);
    for (const el of fresh) animate(el, 'flash');
  }
  if (res.closed) {
    const key = Array.from(game.edges, (s) => (s === LINE ? 1 : 0)).join('');
    if (key !== closedToastKey) {
      closedToastKey = key;
      toast('回路已闭合，但还有数字没满足');
    }
  }
  save();
}

function soundFor(next) {
  if (next === LINE) play('place');
  else if (next === CROSS) play('tap');
  else play('select');
}

function setEdge(e, next) {
  const changed = applyChanges(game, [[e, next]]);
  if (!changed.length) return;
  paintEdge(e, true);
  soundFor(next);
  afterChange();
}

function win() {
  stopClock();
  finish(game);
  const record = recordResult();
  save();
  for (let e = 0; e < edgeEls.length; e++) paintEdge(e);
  renderChecks();
  renderStatus();
  board.classList.add('won');
  const inside = insideCells(game);
  const step = Math.min(30, 500 / Math.max(1, inside.length));
  inside.forEach((i, k) => {
    const rect = svgEl('rect', { class: 'fill', x: i % game.cols, y: Math.floor(i / game.cols), width: 1, height: 1 }, fillLayer);
    rect.style.setProperty('--d', `${Math.round(k * step)}ms`);
  });
  play('win', 0.1);
  vibrate([30, 40, 30]);
  busyUntil = performance.now() + 900;
  setTimeout(() => showResult(record), 900);
}

// ---------------------------------------------------------------- 弹窗
function showResult(record) {
  const s = statsStore.get()[game.level] || { played: 0, best: [], total: 0 };
  const secs = elapsed() / 1000;
  $('resultDetail').textContent = `${LEVELS[game.level].name} · 第 ${game.id + 1} 题 · 用时 ${formatTime(elapsed())}（${secs.toFixed(1)} 秒）`;
  $('resultRecord').hidden = !record;
  const avg = s.played ? s.total / s.played : 0;
  const items = [
    [String(s.played), '完成局数'],
    [s.best?.length ? formatTime(s.best[0].t * 1000) : '—', '最佳用时'],
    [s.played ? formatTime(avg * 1000) : '—', '平均用时'],
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
// 轻点：空 → 线 → 叉 → 空；长按 / 右键：切换叉；按住拖动：连续画线（从线开始拖则擦除）
let press = null;

function showPreview(e) {
  const [x1, y1, x2, y2] = edgeCoords(e);
  preview.setAttribute('x1', x1);
  preview.setAttribute('y1', y1);
  preview.setAttribute('x2', x2);
  preview.setAttribute('y2', y2);
  preview.setAttribute('visibility', 'visible');
}

const hidePreview = () => preview?.setAttribute('visibility', 'hidden');

function cancelPress() {
  if (!press) return;
  clearTimeout(press.timer);
  hidePreview();
  press = null;
}

function onHold() {
  if (!press || press.drag) return;
  press.handled = true;
  hidePreview();
  vibrate(15);
  setEdge(press.e0, holdNext(game.edges[press.e0]));
}

// 拖动到点 v：沿格点逐段画线；沿本笔刚画的边原路退回则撤掉这一段
function dragTo(v) {
  const edges = pathEdges(geo, press.v, v);
  let changed = false;
  for (const e of edges) {
    const last = press.path[press.path.length - 1];
    if (last && last.e === e) {
      press.path.pop();
      if (game.edges[e] !== last.before) {
        game.edges[e] = last.before;
        paintEdge(e);
        changed = true;
      }
      continue;
    }
    if (press.value === null) press.value = game.edges[e] === LINE ? EMPTY : LINE;
    press.path.push({ e, before: game.edges[e] });
    if (!press.first.has(e)) press.first.set(e, game.edges[e]);
    if (game.edges[e] !== press.value) {
      game.edges[e] = press.value;
      paintEdge(e, true);
      changed = true;
    }
  }
  press.v = v;
  if (changed) {
    play(press.value === LINE ? 'move' : 'select');
    renderChecks();
  }
}

function endDrag() {
  const step = [];
  for (const [e, before] of press.first) step.push([e, before, game.edges[e]]);
  pushStep(game, step);
  afterChange();
}

board.addEventListener('pointerdown', (e) => {
  if (press || anyModalOpen() || busy() || isOver()) return;
  if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
  const p = toBoard(e);
  const e0 = nearestEdge(geo, p.x, p.y);
  if (e0 < 0) return;
  if (e.pointerType === 'mouse' && e.button === 2) {
    setEdge(e0, holdNext(game.edges[e0]));
    return;
  }
  board.setPointerCapture?.(e.pointerId);
  press = {
    id: e.pointerId,
    x: e.clientX,
    y: e.clientY,
    e0,
    v: nearestVertex(geo, p.x, p.y).v,
    drag: false,
    handled: false,
    value: null,
    path: [],
    first: new Map(),
    timer: 0,
  };
  showPreview(e0);
  if (e.pointerType !== 'mouse') press.timer = setTimeout(onHold, HOLD_MS);
});

board.addEventListener('pointermove', (e) => {
  if (!press || press.id !== e.pointerId || press.handled) return;
  if (!press.drag) {
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < Math.max(DRAG_MIN_PX, S * DRAG_FRACTION)) return;
    press.drag = true;
    clearTimeout(press.timer);
    hidePreview();
  }
  const p = toBoard(e);
  const { v, d } = nearestVertex(geo, p.x, p.y);
  if (v !== press.v && d < SNAP) dragTo(v);
});

function endPointer(e) {
  if (!press || press.id !== e.pointerId) return;
  const { drag, handled, e0 } = press;
  clearTimeout(press.timer);
  hidePreview();
  if (drag) endDrag();
  press = null;
  if (!drag && !handled && e.type === 'pointerup') setEdge(e0, tapNext(game.edges[e0]));
}

board.addEventListener('pointerup', endPointer);
board.addEventListener('pointercancel', endPointer);
board.addEventListener('lostpointercapture', endPointer);
board.addEventListener('contextmenu', (e) => e.preventDefault());

board.addEventListener('animationend', (e) => e.target.classList?.remove('grow', 'pop', 'flash'));

// ---------------------------------------------------------------- 工具栏
function shake(btn) {
  play('error');
  animate(btn, 'shake');
}

function doUndo(redoing = false) {
  const btn = $(redoing ? 'redoBtn' : 'undoBtn');
  if (busy() || isOver()) return;
  const step = redoing ? redo(game) : undo(game);
  if (!step) {
    shake(btn);
    return;
  }
  for (const [e] of step) paintEdge(e, true);
  play('select');
  afterChange();
}

$('undoBtn').addEventListener('click', () => doUndo(false));
$('redoBtn').addEventListener('click', () => doUndo(true));
$('clearBtn').addEventListener('click', () => {
  if (busy() || isOver()) return;
  const changed = clearAll(game);
  if (!changed.length) {
    shake($('clearBtn'));
    return;
  }
  for (const [e] of changed) paintEdge(e);
  play('select');
  afterChange();
});

document.addEventListener('keydown', (e) => {
  if (anyModalOpen() || e.altKey) return;
  const key = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && key === 'z') {
    e.preventDefault();
    doUndo(e.shiftKey);
  } else if ((e.metaKey || e.ctrlKey) && key === 'y') {
    e.preventDefault();
    doUndo(true);
  } else if (!e.metaKey && !e.ctrlKey && key === 'n') {
    requestNewGame();
  }
});

// ---------------------------------------------------------------- 按钮
$('newBtn').addEventListener('click', requestNewGame);

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

function renderSettings() {
  for (const btn of document.querySelectorAll('#errorsSelect button')) {
    btn.setAttribute('aria-pressed', String((btn.dataset.errors === 'on') === settings.errors));
  }
}

$('errorsSelect').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-errors]');
  if (!btn) return;
  settings.errors = btn.dataset.errors === 'on';
  settingsStore.set(settings);
  renderSettings();
  renderChecks();
});

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
renderSettings();
const saved = restoreGame(stateStore.get(), BANK);
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
