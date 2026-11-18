import { initPage, storage } from '../../js/pwa.js';
import { play } from '../../js/sfx.js';
import {
  LEVELS,
  BLACK,
  DOT,
  EMPTY,
  createGame,
  restoreGame,
  serialize,
  isClue,
  strokeTarget,
  newStroke,
  paint,
  commitStroke,
  clearAll,
  undo,
  redo,
  violations,
  blackCount,
  touched,
} from './board.js';
import { BANK } from './puzzles.js';

initPage();

// 尺寸常量必须与 nurikabe.css 中 .board 的 gap / padding 和 .board-wrap 的 padding 保持一致
const GAP = 1;
const BOARD_PAD = 2;
const WRAP_PAD = 10;
const MIN_S = 24;
const MAX_S = 64;
const RECENT = 10;

const stateStore = storage('h5.nurikabe.state', null);
const levelStore = storage('h5.nurikabe.level', 'easy');
const statsStore = storage('h5.nurikabe.stats', {});
const recentStore = storage('h5.nurikabe.recent', {});
const settingsStore = storage('h5.nurikabe.settings', {});
const helpStore = storage('h5.nurikabe.helpSeen', false);

const $ = (id) => document.getElementById(id);
const board = $('board');
const boardWrap = $('boardWrap');

let game = null;
let cells = [];
const settings = { hints: true, ...settingsStore.get() };
let runningSince = null; // 计时进行中时为恢复计时的时刻
let focusIdx = -1;
let badCount = 0; // 上一次渲染时的违规格数，用于判断是否新出现违规
let confirmAction = null;

// ---------------------------------------------------------------- 工具
function animate(el, cls, delay = 0) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.style.setProperty('--d', `${Math.round(delay)}ms`);
  el.classList.add(cls);
}

const anyModalOpen = () => [...document.querySelectorAll('.modal')].some((m) => !m.hidden);

function setModal(id, open) {
  $(id).hidden = !open;
  if (anyModalOpen()) stopClock();
  else startClock();
}

function formatTime(ms) {
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (v) => String(v).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// ---------------------------------------------------------------- 计时
function elapsed() {
  return game.elapsed + (runningSince !== null ? performance.now() - runningSince : 0);
}

function startClock() {
  if (game?.status === 'playing' && runningSince === null && !document.hidden && !anyModalOpen()) {
    runningSince = performance.now();
  }
}

function stopClock() {
  if (runningSince === null) return;
  game.elapsed += performance.now() - runningSince;
  runningSince = null;
}

function renderTimer() {
  $('timer').textContent = formatTime(elapsed());
}

// ---------------------------------------------------------------- 棋盘 DOM
function buildBoard() {
  const frag = document.createDocumentFragment();
  cells = [];
  for (let i = 0; i < game.size * game.size; i++) {
    const el = document.createElement('div');
    el.className = 'cell';
    el.dataset.i = i;
    el.setAttribute('role', 'gridcell');
    if (isClue(game, i)) el.textContent = game.clues[i];
    cells.push(frag.appendChild(el));
  }
  board.replaceChildren(frag);
  board.style.setProperty('--n', game.size);
  board.classList.toggle('won', game.status === 'won');
  focusIdx = -1;
}

const VISUAL = { [EMPTY]: 'e', [BLACK]: 'b', [DOT]: 'd' };
const LABELS = { e: '空', b: '黑格', d: '白点' };

function paintCell(i, bad) {
  const el = cells[i];
  const v = isClue(game, i) ? 'n' : VISUAL[game.cells[i]];
  if (el.dataset.s !== v) {
    el.dataset.s = v;
    el.setAttribute('aria-label', v === 'n' ? `数字 ${game.clues[i]}` : LABELS[v]);
  }
  el.classList.toggle('bad', bad);
}

// 返回是否新出现了违规
function renderBoard() {
  const v = settings.hints && game.status === 'playing' ? violations(game) : null;
  let bad = 0;
  for (let i = 0; i < cells.length; i++) {
    const b = !!v && (v.squares.has(i) || v.clues.has(i) || v.dots.has(i));
    if (b) bad++;
    paintCell(i, b);
  }
  const grew = bad > badCount;
  badCount = bad;
  return grew;
}

function renderStatus() {
  $('puzzleNo').textContent = `#${game.index + 1}`;
  $('progress').textContent = `${blackCount(game)} / ${game.blackTotal}`;
  renderTimer();
  for (const btn of document.querySelectorAll('#levelSelect button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.level === game.level));
  }
  const playing = game.status === 'playing';
  $('undoBtn').disabled = !playing || !game.undo.length;
  $('redoBtn').disabled = !playing || !game.redo.length;
  $('clearBtn').disabled = !playing || !game.cells.some((s) => s !== EMPTY);
}

function render() {
  renderBoard();
  renderStatus();
}

// ---------------------------------------------------------------- 尺寸
function layout() {
  const w = boardWrap.clientWidth - 2 * WRAP_PAD - 2 * BOARD_PAD;
  const h = boardWrap.clientHeight - 2 * WRAP_PAD - 2 * BOARD_PAD;
  const fit = Math.floor((Math.min(w, h) + GAP) / game.size - GAP);
  board.style.setProperty('--s', `${Math.max(MIN_S, Math.min(MAX_S, fit))}px`);
}

// ---------------------------------------------------------------- 存档与统计
function save() {
  if (!game) return;
  if (game.status !== 'playing') stateStore.set(null);
  else stateStore.set(serialize({ ...game, elapsed: elapsed() }));
}

// 返回是否打破了已有的最佳用时
function recordWin() {
  const all = statsStore.get();
  const s = { solved: 0, total: 0, best: [], ...all[game.level] };
  const t = Math.round(elapsed() / 100) / 10;
  const record = s.best.length > 0 && t < s.best[0].t;
  s.solved++;
  s.total += t;
  s.best = [...s.best, { t, date: new Date().toISOString().slice(0, 10) }].sort((a, b) => a.t - b.t).slice(0, 5);
  all[game.level] = s;
  statsStore.set(all);
  return record;
}

// 抽题：跳过本档最近玩过的题
function pickIndex(level) {
  const total = BANK[level].length;
  const recent = recentStore.get();
  const skip = new Set((recent[level] || []).slice(-Math.min(RECENT, total - 1)));
  const pool = [...Array(total).keys()].filter((i) => !skip.has(i));
  const index = pool[Math.floor(Math.random() * pool.length)];
  recent[level] = [...(recent[level] || []).filter((i) => i !== index), index].slice(-RECENT);
  recentStore.set(recent);
  return index;
}

// ---------------------------------------------------------------- 对局
function startGame(next) {
  runningSince = null;
  cancelStroke();
  game = next;
  levelStore.set(game.level);
  badCount = 0;
  $('resultModal').hidden = true;
  buildBoard();
  layout();
  render();
  save();
  startClock();
}

function newGame(level = game?.level ?? 'easy') {
  const index = pickIndex(level);
  startGame(createGame(level, index, Math.floor(Math.random() * 8), BANK[level][index]));
}

function restartGame() {
  startGame(createGame(game.level, game.index, game.t, BANK[game.level][game.index]));
}

// 有操作且未完成的对局，放弃前需要确认
function guardAbandon(text, action) {
  if (game.status !== 'playing' || !touched(game)) {
    action();
    return;
  }
  $('confirmText').textContent = text;
  confirmAction = action;
  setModal('confirmModal', true);
}

function afterChange(changed, won) {
  if (won) {
    win();
    return;
  }
  const grew = renderBoard();
  if (grew) {
    play('error');
    for (const i of changed) if (cells[i].classList.contains('bad')) animate(cells[i], 'flash');
  }
  renderStatus();
  save();
}

function win() {
  stopClock();
  const record = recordWin();
  save();
  render();
  board.classList.add('won');
  const blacks = [];
  for (let i = 0; i < cells.length; i++) if (game.cells[i] === BLACK) blacks.push(i);
  const step = Math.min(25, 500 / Math.max(1, blacks.length));
  blacks.forEach((i, k) => animate(cells[i], 'glow', k * step));
  play('win', 0.05);
  setTimeout(() => showResult(record), 650);
}

function showResult(record) {
  if (game.status !== 'won') return;
  const s = statsStore.get()[game.level] || { solved: 0, total: 0, best: [] };
  const secs = elapsed() / 1000;
  $('resultDetail').textContent = `${LEVELS[game.level].name} · 第 ${game.index + 1} 题 · 用时 ${formatTime(elapsed())}（${secs.toFixed(1)} 秒）`;
  $('resultRecord').hidden = !record;
  const items = [
    [String(s.solved), '完成局数'],
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
  setModal('resultModal', true);
}

// ---------------------------------------------------------------- 涂色
// stroke：当前这一笔。按下时按起点格算出目标状态，划过的格子都设为该状态，抬起时作为一步入撤销栈
let stroke = null;

function cellAt(x, y) {
  const el = document.elementFromPoint(x, y)?.closest?.('.cell');
  return el && board.contains(el) ? Number(el.dataset.i) : -1;
}

function paintOne(i) {
  if (!paint(game, stroke, i)) return;
  const s = game.cells[i];
  paintCell(i, false);
  if (s === BLACK) {
    animate(cells[i], 'pop');
    play('place', 0, { volume: 0.7 });
  } else {
    play('tap', 0, { volume: 0.7 });
  }
}

// 手指移动较快时会跳格，沿直线补上经过的格子
function paintLine(from, to) {
  const n = game.size;
  let x0 = from % n;
  let y0 = Math.floor(from / n);
  const x1 = to % n;
  const y1 = Math.floor(to / n);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    paintOne(y0 * n + x0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function endStroke() {
  if (!stroke) return;
  const s = stroke;
  stroke = null;
  const won = commitStroke(game, s);
  if (s.changes.length) afterChange(s.changes.map((c) => c[0]), won);
}

function cancelStroke() {
  stroke = null;
}

function hideFocus() {
  if (focusIdx >= 0) cells[focusIdx]?.classList.remove('focus');
  focusIdx = -1;
}

board.addEventListener('pointerdown', (e) => {
  if (anyModalOpen() || game.status !== 'playing') return;
  if (stroke) return; // 多指触摸：忽略第二指
  if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
  const el = e.target.closest('.cell');
  if (!el) return;
  hideFocus();
  const i = Number(el.dataset.i);
  const target = strokeTarget(game, i, e.button === 2);
  if (target === null) return;
  e.preventDefault();
  stroke = { ...newStroke(target), id: e.pointerId, last: i };
  paintOne(i);
});

window.addEventListener('pointermove', (e) => {
  if (!stroke || stroke.id !== e.pointerId) return;
  const i = cellAt(e.clientX, e.clientY);
  if (i < 0 || i === stroke.last) return;
  paintLine(stroke.last, i);
  stroke.last = i;
});

window.addEventListener('pointerup', (e) => stroke?.id === e.pointerId && endStroke());
window.addEventListener('pointercancel', (e) => stroke?.id === e.pointerId && endStroke());
board.addEventListener('contextmenu', (e) => e.preventDefault());

board.addEventListener('animationend', (e) => {
  e.target.classList.remove('pop', 'flash', 'glow');
});

// ---------------------------------------------------------------- 撤销 / 重做 / 清空
function doUndo() {
  if (stroke) return;
  const changed = undo(game);
  if (!changed) return;
  play('select');
  afterChange(changed, false);
}

function doRedo() {
  if (stroke) return;
  const changed = redo(game);
  if (!changed) return;
  play('select');
  afterChange(changed, game.status === 'won');
}

$('undoBtn').addEventListener('click', doUndo);
$('redoBtn').addEventListener('click', doRedo);
$('clearBtn').addEventListener('click', () => {
  if (!stroke && clearAll(game)) afterChange([], false);
});

// ---------------------------------------------------------------- 键盘
const DIRS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

function moveFocus(dx, dy) {
  const n = game.size;
  let x;
  let y;
  if (focusIdx < 0) {
    x = Math.floor(n / 2);
    y = Math.floor(n / 2);
  } else {
    cells[focusIdx].classList.remove('focus');
    x = Math.min(n - 1, Math.max(0, (focusIdx % n) + dx));
    y = Math.min(n - 1, Math.max(0, Math.floor(focusIdx / n) + dy));
  }
  focusIdx = y * n + x;
  cells[focusIdx].classList.add('focus');
}

function keySet(i, target) {
  if (game.status !== 'playing' || target === null || isClue(game, i)) return;
  stroke = { ...newStroke(target), id: 'key', last: i };
  paintOne(i);
  endStroke();
}

document.addEventListener('keydown', (e) => {
  if (anyModalOpen() || e.altKey) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if ((e.metaKey || e.ctrlKey) && key === 'z') {
    e.preventDefault();
    if (e.shiftKey) doRedo();
    else doUndo();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && key === 'y') {
    e.preventDefault();
    doRedo();
    return;
  }
  if (e.metaKey || e.ctrlKey || stroke) return;
  if (DIRS[key]) {
    e.preventDefault();
    moveFocus(...DIRS[key]);
  } else if (focusIdx >= 0 && (key === ' ' || key === 'Enter')) {
    e.preventDefault();
    document.activeElement?.blur?.();
    keySet(focusIdx, strokeTarget(game, focusIdx));
  } else if (focusIdx >= 0 && key === 'x') {
    keySet(focusIdx, game.cells[focusIdx] === BLACK ? EMPTY : BLACK);
  } else if (focusIdx >= 0 && key === '.') {
    keySet(focusIdx, game.cells[focusIdx] === DOT ? EMPTY : DOT);
  }
});

// ---------------------------------------------------------------- 按钮
$('restartBtn').addEventListener('click', () => guardAbandon('重新开始将清除本题的所有操作，确定吗？', restartGame));
$('nextBtn').addEventListener('click', () => guardAbandon('换一题将放弃本题，确定吗？', () => newGame()));

$('levelSelect').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-level]');
  if (!btn || btn.dataset.level === game.level) return;
  const level = btn.dataset.level;
  guardAbandon('切换难度将放弃本题，确定吗？', () => newGame(level));
});

$('confirmOk').addEventListener('click', () => {
  const action = confirmAction;
  confirmAction = null;
  setModal('confirmModal', false);
  action?.();
});

$('resultAgain').addEventListener('click', () => {
  setModal('resultModal', false);
  newGame();
});
$('resultClose').addEventListener('click', () => setModal('resultModal', false));
$('helpBtn').addEventListener('click', () => setModal('helpModal', true));

for (const id of ['helpModal', 'confirmModal']) {
  $(id).addEventListener('click', (e) => {
    if (e.target === e.currentTarget || e.target.closest('[data-close]')) setModal(id, false);
  });
}

function renderSettings() {
  for (const btn of document.querySelectorAll('#hintSelect button')) {
    btn.setAttribute('aria-pressed', String((btn.dataset.hint === 'on') === settings.hints));
  }
}

$('hintSelect').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-hint]');
  if (!btn) return;
  settings.hints = btn.dataset.hint === 'on';
  settingsStore.set(settings);
  renderSettings();
  renderBoard();
});

// ---------------------------------------------------------------- 生命周期
setInterval(() => runningSince !== null && renderTimer(), 250);

document.addEventListener('visibilitychange', () => {
  if (!game) return;
  if (document.hidden) {
    endStroke();
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
if (!helpStore.get()) {
  helpStore.set(true);
  $('helpModal').hidden = false;
}
const saved = restoreGame(stateStore.get(), BANK);
if (saved) startGame(saved);
else newGame(LEVELS[levelStore.get()] ? levelStore.get() : 'easy');
