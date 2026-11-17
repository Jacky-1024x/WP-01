import { initPage, storage } from '../../js/pwa.js';
import { play, isMuted } from '../../js/sfx.js';
import {
  LEVELS,
  OPEN,
  FLAG,
  MARK,
  createGame,
  restoreGame,
  serialize,
  reveal,
  chord,
  toggleFlag,
  neighbors,
  minesLeft,
  safeTotal,
} from './board.js';

initPage();

const LEVEL_NAMES = { beginner: '初级', intermediate: '中级', expert: '高级' };
// 尺寸常量必须与 minesweeper.css 中 .board 的 gap / padding 和 .board-wrap 的 padding 保持一致
const GAP = 1;
const BOARD_PAD = 6;
const WRAP_PAD = 8;
const MIN_S = 22;
const MAX_S = 48;
const ZOOM_S = 40;
const MOVE_TOLERANCE = 8;
const LAYER_STEP = 15;
const MAX_SPREAD = 300;
const HOLD_OPTIONS = [250, 350, 500];

const stateStore = storage('h5.minesweeper.state', null);
const levelStore = storage('h5.minesweeper.level', 'beginner');
const modeStore = storage('h5.minesweeper.mode', 'dig');
const settingsStore = storage('h5.minesweeper.settings', {});
const statsStore = storage('h5.minesweeper.stats', {});
const helpStore = storage('h5.minesweeper.helpSeen', false);

const $ = (id) => document.getElementById(id);
const board = $('board');
const boardWrap = $('boardWrap');
const faceBtn = $('faceBtn');
const zoomBtn = $('zoomBtn');

let game = null;
let cells = [];
let mode = modeStore.get() === 'flag' ? 'flag' : 'dig';
const settings = { marks: false, hold: 350, ...settingsStore.get() };
if (!HOLD_OPTIONS.includes(settings.hold)) settings.hold = 350;
let zoomed = false;
let runningSince = null; // 计时进行中时为恢复计时的时刻
let busyUntil = 0; // 动画播放期间忽略输入
let focusIdx = -1; // 键盘焦点格
let pressFace = false;
let confirmAction = null;

// ---------------------------------------------------------------- 表情
const FACE_BASE = '<circle cx="24" cy="24" r="21" fill="#facc15" stroke="#ca8a04" stroke-width="2"/>';
const EYES = '<circle cx="16.5" cy="19.5" r="2.6" fill="#111827"/><circle cx="31.5" cy="19.5" r="2.6" fill="#111827"/>';
const SMILE = '<path d="M15 28.5q9 8.5 18 0" fill="none" stroke="#111827" stroke-width="2.6" stroke-linecap="round"/>';
const FACES = {
  smile: EYES + SMILE,
  o: `${EYES}<circle cx="24" cy="32" r="3.6" fill="#111827"/>`,
  cool:
    '<rect x="10" y="15" width="12" height="7.5" rx="2.2" fill="#111827"/><rect x="26" y="15" width="12" height="7.5" rx="2.2" fill="#111827"/>' +
    `<path d="M22 18h4" stroke="#111827" stroke-width="2"/>${SMILE}`,
  dead:
    '<path d="M13.5 16.5l6 6m0-6-6 6M28.5 16.5l6 6m0-6-6 6" stroke="#111827" stroke-width="2.4" stroke-linecap="round"/>' +
    '<path d="M16 34q8-7 16 0" fill="none" stroke="#111827" stroke-width="2.6" stroke-linecap="round"/>',
};
const faceSvg = (kind) => `<svg viewBox="0 0 48 48" aria-hidden="true">${FACE_BASE}${FACES[kind]}</svg>`;

// ---------------------------------------------------------------- 工具
const isOver = () => game.status === 'won' || game.status === 'lost';
const busy = () => performance.now() < busyUntil;
const holdInput = (ms) => (busyUntil = Math.max(busyUntil, performance.now() + ms));

function vibrate(pattern) {
  if (!isMuted()) navigator.vibrate?.(pattern);
}

function animate(el, cls, delay = 0) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.style.setProperty('--d', `${Math.round(delay)}ms`);
  el.classList.add(cls);
}

function anyModalOpen() {
  return [...document.querySelectorAll('.modal')].some((m) => !m.hidden);
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

function renderTimer() {
  $('timer').textContent = String(Math.min(999, Math.floor(elapsed() / 1000))).padStart(3, '0');
}

// ---------------------------------------------------------------- 棋盘 DOM
function buildBoard() {
  const frag = document.createDocumentFragment();
  cells = [];
  for (let i = 0; i < game.cols * game.rows; i++) {
    const el = document.createElement('div');
    el.className = 'cell';
    el.dataset.i = i;
    el.setAttribute('role', 'gridcell');
    cells.push(frag.appendChild(el));
  }
  board.replaceChildren(frag);
  board.style.setProperty('--cols', game.cols);
  board.style.removeProperty('--s');
  board.classList.remove('boom', 'won');
  focusIdx = -1;
}

// h 未挖开 / f 旗 / q 问号 / o 已挖开 / m 地雷 / x 踩中的雷 / w 插错的旗
function visual(i) {
  const s = game.state[i];
  if (game.status === 'lost') {
    if (i === game.exploded) return 'x';
    if (s === FLAG) return game.mine[i] ? 'f' : 'w';
    if (game.mine[i]) return 'm';
  }
  if (s === OPEN) return 'o';
  if (s === FLAG) return 'f';
  if (s === MARK) return 'q';
  return 'h';
}

const LABELS = { h: '未挖开', f: '旗', q: '问号', m: '地雷', x: '踩中的雷', w: '插错的旗' };

function paint(i) {
  const el = cells[i];
  const v = visual(i);
  if (el.dataset.s === v) return;
  el.dataset.s = v;
  const n = v === 'o' ? game.count[i] : 0;
  if (n) el.dataset.n = n;
  else delete el.dataset.n;
  el.textContent = n ? n : v === 'q' ? '?' : '';
  el.setAttribute('aria-label', v === 'o' ? (n ? String(n) : '空白') : LABELS[v]);
}

function renderFace() {
  const kind = game.status === 'won' ? 'cool' : game.status === 'lost' ? 'dead' : pressFace ? 'o' : 'smile';
  if (faceBtn.dataset.kind !== kind) {
    faceBtn.dataset.kind = kind;
    faceBtn.innerHTML = faceSvg(kind);
  }
}

function renderStatus() {
  const left = minesLeft(game);
  $('minesLeft').textContent = left < 0 ? `-${String(-left).padStart(2, '0')}` : String(left).padStart(3, '0');
  renderTimer();
  renderFace();
  for (const btn of document.querySelectorAll('#levelSelect button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.level === game.level));
  }
  for (const btn of document.querySelectorAll('#modeSelect button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode));
  }
  zoomBtn.hidden = game.level === 'beginner';
  zoomBtn.setAttribute('aria-pressed', String(zoomed));
  zoomBtn.setAttribute('aria-label', zoomed ? '缩小到全览' : '放大');
}

function render() {
  for (let i = 0; i < cells.length; i++) paint(i);
  renderStatus();
}

// ---------------------------------------------------------------- 尺寸与缩放
// 全览：宽度方向始终放得下（不出现横向滚动），高度方向最小 MIN_S，放不下时纵向滚动
function cellSize() {
  const w = boardWrap.clientWidth - 2 * WRAP_PAD - 2 * BOARD_PAD;
  const h = boardWrap.clientHeight - 2 * WRAP_PAD - 2 * BOARD_PAD;
  const fitW = Math.floor((w + GAP) / game.cols - GAP);
  const fitH = Math.floor((h + GAP) / game.rows - GAP);
  const s = Math.max(16, Math.min(MAX_S, fitW, Math.max(MIN_S, fitH)));
  return zoomed ? Math.max(ZOOM_S, s) : s;
}

// anchor：屏幕坐标，缩放后让这个位置下的格子保持不动
function layout(anchor) {
  const old = parseFloat(board.style.getPropertyValue('--s')) || 0;
  const s = cellSize();
  if (s === old) return;
  let keep = null;
  if (anchor && old) {
    const wr = boardWrap.getBoundingClientRect();
    const br = board.getBoundingClientRect();
    keep = {
      px: anchor.x - wr.left,
      py: anchor.y - wr.top,
      bx: anchor.x - br.left - BOARD_PAD,
      by: anchor.y - br.top - BOARD_PAD,
      ratio: (s + GAP) / (old + GAP),
    };
  }
  board.style.setProperty('--s', `${s}px`);
  if (keep) {
    boardWrap.scrollLeft = board.offsetLeft + BOARD_PAD + keep.bx * keep.ratio - keep.px;
    boardWrap.scrollTop = board.offsetTop + BOARD_PAD + keep.by * keep.ratio - keep.py;
  }
}

function setZoom(on, anchor) {
  if (game.level === 'beginner') on = false;
  if (on === zoomed) return;
  zoomed = on;
  const r = boardWrap.getBoundingClientRect();
  layout(anchor || { x: r.left + r.width / 2, y: r.top + r.height / 2 });
  renderStatus();
}

// ---------------------------------------------------------------- 存档与统计
function save() {
  if (!game) return;
  if (isOver()) stateStore.set(null);
  else stateStore.set(serialize({ ...game, elapsed: elapsed() }));
}

// 返回是否打破了已有的最佳用时
function recordResult(won) {
  const all = statsStore.get();
  const s = { played: 0, won: 0, best: [], streak: 0, maxStreak: 0, ...all[game.level] };
  let record = false;
  s.played++;
  if (won) {
    const t = Math.round(elapsed() / 100) / 10;
    record = s.best.length > 0 && t < s.best[0].t;
    s.won++;
    s.streak++;
    s.maxStreak = Math.max(s.maxStreak, s.streak);
    s.best = [...s.best, { t, date: new Date().toISOString().slice(0, 10) }].sort((a, b) => a.t - b.t).slice(0, 5);
  } else {
    s.streak = 0;
  }
  all[game.level] = s;
  statsStore.set(all);
  return record;
}

// ---------------------------------------------------------------- 对局
function newGame(level = game?.level ?? 'beginner') {
  runningSince = null;
  game = createGame(level, boardWrap.clientHeight >= boardWrap.clientWidth);
  levelStore.set(level);
  if (level === 'beginner') zoomed = false;
  pressFace = false;
  busyUntil = 0;
  cancelPress();
  $('resultModal').hidden = true;
  buildBoard();
  layout();
  render();
  boardWrap.scrollTo(0, 0);
  save();
}

// 已经挖开过格子、尚未结束的对局，放弃前需要确认，放弃计为一局失败
function guardAbandon(text, action) {
  if (game.status !== 'playing') {
    action();
    return;
  }
  $('confirmText').textContent = text;
  confirmAction = () => {
    stopClock();
    recordResult(false);
    action();
  };
  $('confirmModal').hidden = false;
}

const requestNewGame = () => guardAbandon('重新开始将放弃本局，确定吗？', () => newGame());

// 新挖开的格子按 BFS 层数依次播放；局面已经更新，动画期间不阻塞操作
function showOpened(opened) {
  if (!opened.length) return;
  const maxLayer = opened[opened.length - 1][1];
  const step = maxLayer ? Math.min(LAYER_STEP, MAX_SPREAD / maxLayer) : 0;
  for (const [i, layer] of opened) {
    paint(i);
    animate(cells[i], 'opening', layer * step);
  }
}

function afterOpen(res) {
  startClock();
  showOpened(res.opened);
  if (res.opened.length > 1) play('move');
  else if (res.opened.length) play('tap');
  if (game.status === 'lost') lose();
  else if (game.status === 'won') win(res.autoFlagged);
  else {
    renderStatus();
    save();
  }
}

function doReveal(i) {
  const res = reveal(game, i);
  if (res) {
    afterOpen(res);
  } else if (game.state[i] === FLAG) {
    play('error');
    animate(cells[i], 'shake');
  }
}

function doChord(i) {
  const res = chord(game, i);
  if (!res) return;
  if (res.ok) {
    afterOpen(res);
    return;
  }
  play('error');
  for (const n of res.targets) animate(cells[n], 'flash');
}

function doFlag(i) {
  const next = toggleFlag(game, i, settings.marks);
  if (next === null) return;
  paint(i);
  if (next === FLAG) {
    play('place');
    animate(cells[i], 'drop');
  } else {
    play('select');
  }
  renderStatus();
  save();
}

// alt：长按，执行与当前模式相反的操作。数字格不论模式都是快速挖开
function act(i, alt = false) {
  if (i < 0 || busy() || isOver()) return;
  if (game.state[i] === OPEN) doChord(i);
  else if ((mode === 'dig') !== alt) doReveal(i);
  else doFlag(i);
}

function lose() {
  stopClock();
  const record = recordResult(false);
  save();
  play('lose');
  vibrate([60, 40, 120]);
  render();
  animate(board, 'boom');
  const { cols, exploded } = game;
  const ex = exploded % cols;
  const ey = Math.floor(exploded / cols);
  const mines = [];
  for (let i = 0; i < cells.length; i++) {
    if (game.mine[i] && i !== exploded && game.state[i] !== FLAG) {
      mines.push([i, Math.hypot((i % cols) - ex, Math.floor(i / cols) - ey)]);
    }
  }
  const far = Math.max(1, ...mines.map(([, d]) => d));
  for (const [i, d] of mines) animate(cells[i], 'appear', 150 + (d / far) * 450);
  holdInput(800);
  setTimeout(() => showResult(false, record), 800);
}

function win(autoFlagged) {
  stopClock();
  const record = recordResult(true);
  save();
  render();
  const step = Math.min(40, 500 / Math.max(1, autoFlagged.length));
  autoFlagged.forEach((i, k) => animate(cells[i], 'drop', 100 + k * step));
  board.classList.add('won');
  play('win', 0.1);
  holdInput(900);
  setTimeout(() => showResult(true, record), 900);
}

// ---------------------------------------------------------------- 弹窗
function showResult(won, record) {
  const s = statsStore.get()[game.level] || { played: 0, won: 0, best: [], streak: 0 };
  const secs = elapsed() / 1000;
  const name = LEVEL_NAMES[game.level];
  $('resultFace').innerHTML = faceSvg(won ? 'cool' : 'dead');
  $('resultTitle').textContent = won ? '扫雷成功！' : '踩雷了';
  const pct = Math.floor((game.opened * 100) / safeTotal(game));
  $('resultDetail').textContent = won
    ? `${name} · 用时 ${secs.toFixed(1)} 秒`
    : `${name} · 用时 ${Math.floor(secs)} 秒 · 已完成 ${pct}%`;
  $('resultRecord').hidden = !record;
  $('resultProgress').hidden = won;
  $('resultProgress').style.setProperty('--p', `${pct}%`);
  const items = [
    [`${s.won} / ${s.played}`, '胜局 / 总局'],
    [s.best?.length ? `${s.best[0].t.toFixed(1)} 秒` : '—', '最佳用时'],
    [String(s.streak), '当前连胜'],
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
// press：当前按住的格子。触屏：轻点抬起执行当前模式，长按到时执行相反操作，移动超过 8px 视为滚动。
// 鼠标：左键按当前模式，右键插旗，中键（或按住左键再按右键）快速挖开；按下时只显示按下状态，抬起才生效。
let press = null;
const touches = new Map();
let pinch = null;

function cellAt(x, y) {
  const el = document.elementFromPoint(x, y)?.closest?.('.cell');
  return el && board.contains(el) ? Number(el.dataset.i) : -1;
}

function setPressed(on) {
  if (!press || press.i < 0) return;
  const targets = press.chord || game.state[press.i] === OPEN ? [press.i, ...neighbors(game, press.i)] : [press.i];
  for (const n of targets) cells[n].classList.toggle('pressed', on);
  pressFace = on && !isOver();
  renderFace();
}

function cancelPress() {
  if (!press) return;
  clearTimeout(press.timer);
  setPressed(false);
  press = null;
}

function onHold() {
  if (!press) return;
  const i = press.i;
  press.handled = true;
  setPressed(false);
  vibrate(15);
  act(i, true);
}

function startPinch() {
  const [a, b] = [...touches.values()];
  pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, done: false };
}

function movePinch() {
  if (!pinch || pinch.done || touches.size < 2 || game.level === 'beginner') return;
  const [a, b] = [...touches.values()];
  const r = Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0;
  if (r > 1.3 || r < 0.77) {
    pinch.done = true;
    if (r > 1 !== zoomed) play('select');
    setZoom(r > 1, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
}

function hideFocus() {
  if (focusIdx >= 0) cells[focusIdx]?.classList.remove('focus');
  focusIdx = -1;
}

board.addEventListener('pointerdown', (e) => {
  if (anyModalOpen()) return;
  const touch = e.pointerType !== 'mouse';
  if (touch) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size >= 2) {
      cancelPress();
      if (touches.size === 2) startPinch();
      return;
    }
  }
  const el = e.target.closest('.cell');
  if (!el) return;
  hideFocus();
  if (busy() || isOver()) return;
  const i = Number(el.dataset.i);
  cancelPress();
  if (!touch && e.button === 2) {
    if (game.state[i] !== OPEN) doFlag(i);
    return;
  }
  if (!touch && e.button !== 0 && e.button !== 1) return;
  press = { id: e.pointerId, touch, i, x: e.clientX, y: e.clientY, chord: e.button === 1, handled: false, timer: 0 };
  if (touch) press.timer = setTimeout(onHold, settings.hold);
  setPressed(true);
});

window.addEventListener('pointermove', (e) => {
  if (touches.has(e.pointerId)) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) movePinch();
  }
  if (!press || press.id !== e.pointerId) return;
  if (press.touch) {
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_TOLERANCE) cancelPress();
    return;
  }
  // 按住左键时再按右键：转为快速挖开
  if (e.button === 2 && !press.chord) {
    setPressed(false);
    press.chord = true;
    setPressed(true);
  }
  const i = cellAt(e.clientX, e.clientY);
  if (i !== press.i) {
    setPressed(false);
    press.i = i;
    setPressed(true);
    if (i < 0) {
      pressFace = false;
      renderFace();
    }
  }
});

function endPointer(e, cancelled) {
  touches.delete(e.pointerId);
  if (touches.size < 2) pinch = null;
  if (!press || press.id !== e.pointerId) return;
  const { i, handled, chord: isChord } = press;
  cancelPress();
  if (cancelled || handled || i < 0) return;
  if (isChord) {
    if (!busy() && !isOver() && game.state[i] === OPEN) doChord(i);
  } else {
    act(i);
  }
}

window.addEventListener('pointerup', (e) => endPointer(e, false));
window.addEventListener('pointercancel', (e) => endPointer(e, true));
board.addEventListener('contextmenu', (e) => e.preventDefault());

board.addEventListener('animationend', (e) => {
  if (e.target === board) board.classList.remove('boom');
  else e.target.classList.remove('opening', 'drop', 'appear', 'flash', 'shake');
});

// ---------------------------------------------------------------- 键盘
const DIRS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

function moveFocus(dx, dy) {
  const { cols, rows } = game;
  let x;
  let y;
  if (focusIdx < 0) {
    x = Math.floor(cols / 2);
    y = Math.floor(rows / 2);
  } else {
    cells[focusIdx].classList.remove('focus');
    x = Math.min(cols - 1, Math.max(0, (focusIdx % cols) + dx));
    y = Math.min(rows - 1, Math.max(0, Math.floor(focusIdx / cols) + dy));
  }
  focusIdx = y * cols + x;
  cells[focusIdx].classList.add('focus');
  cells[focusIdx].scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

document.addEventListener('keydown', (e) => {
  if (anyModalOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === 'n') {
    requestNewGame();
  } else if (DIRS[key]) {
    e.preventDefault();
    moveFocus(...DIRS[key]);
  } else if (focusIdx >= 0 && (key === ' ' || key === 'Enter')) {
    e.preventDefault();
    document.activeElement?.blur?.();
    if (busy() || isOver()) return;
    if (game.state[focusIdx] === OPEN) doChord(focusIdx);
    else doReveal(focusIdx);
  } else if (focusIdx >= 0 && key === 'f') {
    if (!busy() && !isOver()) doFlag(focusIdx);
  }
});

// ---------------------------------------------------------------- 按钮
faceBtn.addEventListener('click', requestNewGame);
$('restartBtn').addEventListener('click', requestNewGame);

$('levelSelect').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-level]');
  if (!btn || btn.dataset.level === game.level) return;
  const level = btn.dataset.level;
  guardAbandon('切换难度将放弃本局，确定吗？', () => newGame(level));
});

$('modeSelect').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-mode]');
  if (!btn) return;
  mode = btn.dataset.mode;
  modeStore.set(mode);
  renderStatus();
});

zoomBtn.addEventListener('click', () => setZoom(!zoomed));

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
  for (const btn of document.querySelectorAll('#marksSelect button')) {
    btn.setAttribute('aria-pressed', String((btn.dataset.marks === 'on') === settings.marks));
  }
  for (const btn of document.querySelectorAll('#holdSelect button')) {
    btn.setAttribute('aria-pressed', String(Number(btn.dataset.hold) === settings.hold));
  }
}

$('marksSelect').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-marks]');
  if (!btn) return;
  settings.marks = btn.dataset.marks === 'on';
  settingsStore.set(settings);
  renderSettings();
});

$('holdSelect').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-hold]');
  if (!btn) return;
  settings.hold = Number(btn.dataset.hold);
  settingsStore.set(settings);
  renderSettings();
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
const saved = restoreGame(stateStore.get());
if (saved) {
  game = saved;
  buildBoard();
  layout();
  render();
  startClock();
} else {
  newGame(LEVELS[levelStore.get()] ? levelStore.get() : 'beginner');
}

if (!helpStore.get()) {
  helpStore.set(true);
  $('helpModal').hidden = false;
}
