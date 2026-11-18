import { initPage, storage, toast } from '../../js/pwa.js';
import { play, isMuted } from '../../js/sfx.js';
import {
  SIZES,
  DEFAULT_SIZE,
  createGame,
  restoreGame,
  serialize,
  press,
  undo,
  reset,
  hint,
  moves,
  isPerfect,
} from './engine.js';

initPage();

// 尺寸系数必须与 lightsout.css 中 .board 的 gap（0.12S）/ padding（0.25S）和 .board-wrap 的 padding 保持一致
const GAP = 0.12;
const PAD = 0.25;
const WRAP_PAD_X = 16;
const WRAP_PAD_Y = 10;
const MIN_S = 28;
const MAX_S = 84;
const WAVE_STEP = 40;

const stateStore = storage('h5.lightsout.state', null);
const sizeStore = storage('h5.lightsout.size', DEFAULT_SIZE);
const statsStore = storage('h5.lightsout.stats', {});
const helpStore = storage('h5.lightsout.helpSeen', false);

const $ = (id) => document.getElementById(id);
const board = $('board');
const boardWrap = $('boardWrap');
const undoBtn = $('undoBtn');
const resetBtn = $('resetBtn');
const hintBtn = $('hintBtn');

let game = null;
let cells = [];
let runningSince = null; // 计时进行中时为恢复计时的时刻
let busyUntil = 0; // 胜利动画期间忽略输入
let focusIdx = -1; // 键盘焦点格
let confirmAction = null;

// ---------------------------------------------------------------- 工具
const isOver = () => game.status === 'won';
const busy = () => performance.now() < busyUntil;
const started = () => moves(game) > 0 || game.elapsed > 0 || runningSince !== null;

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

function formatTime(ms) {
  const secs = Math.min(99 * 60 + 59, Math.floor(ms / 1000));
  return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
}

function renderTimer() {
  $('timer').textContent = formatTime(elapsed());
}

// ---------------------------------------------------------------- 棋盘
function buildBoard() {
  const n = game.size;
  const frag = document.createDocumentFragment();
  cells = [];
  for (let i = 0; i < n * n; i++) {
    const el = document.createElement('button');
    el.className = 'cell';
    el.dataset.i = i;
    el.dataset.sfx = 'none';
    el.setAttribute('role', 'gridcell');
    cells.push(frag.appendChild(el));
  }
  board.replaceChildren(frag);
  board.style.setProperty('--n', n);
  focusIdx = -1;
}

function paint(i) {
  const el = cells[i];
  const on = game.lights[i] === 1;
  if (el.hasAttribute('data-on') !== on) {
    el.toggleAttribute('data-on', on);
    const n = game.size;
    el.setAttribute('aria-label', `第 ${Math.floor(i / n) + 1} 行第 ${(i % n) + 1} 列，${on ? '亮' : '灭'}`);
  }
  el.classList.toggle('hint', i === game.hint);
}

function render() {
  for (let i = 0; i < cells.length; i++) paint(i);
  board.classList.toggle('over', isOver());
  $('moves').textContent = moves(game);
  $('optimal').textContent = game.optimal;
  renderTimer();
  const playing = !isOver();
  undoBtn.disabled = !playing || moves(game) === 0;
  resetBtn.disabled = !playing || moves(game) === 0;
  hintBtn.disabled = !playing;
  $('hintCount').hidden = game.hints === 0;
  $('hintCount').textContent = game.hints;
  $('playControls').hidden = !playing;
  $('againBtn').hidden = playing;
  for (const btn of document.querySelectorAll('#sizeSelect button')) {
    btn.setAttribute('aria-pressed', String(Number(btn.dataset.size) === game.size));
  }
}

function layout() {
  const n = game.size;
  const units = n + GAP * (n - 1) + 2 * PAD;
  const w = boardWrap.clientWidth - 2 * WRAP_PAD_X;
  const h = boardWrap.clientHeight - 2 * WRAP_PAD_Y;
  const s = Math.floor(Math.max(MIN_S, Math.min(MAX_S, Math.min(w, h) / units)));
  board.style.setProperty('--s', `${s}px`);
}

// ---------------------------------------------------------------- 存档与统计
function save() {
  if (!game) return;
  if (isOver()) stateStore.set(null);
  else stateStore.set(serialize({ ...game, elapsed: elapsed() }));
}

function statsFor(all, size) {
  return { played: 0, won: 0, perfect: 0, bestTime: 0, ...all[size] };
}

// 返回是否打破最佳用时
function recordWin() {
  const all = statsStore.get();
  const s = statsFor(all, game.size);
  const t = Math.round(elapsed());
  s.played++;
  s.won++;
  let record = false;
  if (isPerfect(game)) s.perfect++;
  if (game.hints === 0 && (!s.bestTime || t < s.bestTime)) {
    record = !!s.bestTime;
    s.bestTime = t;
  }
  all[game.size] = s;
  statsStore.set(all);
  return record;
}

function recordAbandon() {
  const all = statsStore.get();
  const s = statsFor(all, game.size);
  s.played++;
  all[game.size] = s;
  statsStore.set(all);
}

// ---------------------------------------------------------------- 对局
function newGame(size = game?.size ?? DEFAULT_SIZE) {
  game = createGame(size);
  sizeStore.set(game.size);
  runningSince = null;
  busyUntil = 0;
  $('resultModal').hidden = true;
  buildBoard();
  layout();
  render();
  save();
}

function switchSize(size) {
  board.classList.add('switching');
  setTimeout(() => {
    newGame(size);
    board.classList.remove('switching');
  }, 160);
}

// 已开始且未通关的对局，放弃前需要确认，放弃计入总局数
function guardAbandon(text, action) {
  if (!isOver() && started()) {
    $('confirmText').textContent = text;
    confirmAction = () => {
      recordAbandon();
      action();
    };
    $('confirmModal').hidden = false;
  } else {
    action();
  }
}

function doPress(i) {
  if (busy() || isOver()) return;
  const res = press(game, i);
  if (!res) return;
  startClock();
  animate(cells[i], 'pop');
  play('tap');
  vibrate(10);
  if (res.won) {
    stopClock();
    const record = recordWin();
    render();
    save();
    winWave(i);
    play('win', 0.1);
    setTimeout(() => showResult(record), 750);
  } else {
    render();
    save();
  }
}

function doUndo() {
  if (busy() || isOver()) return;
  if (!undo(game)) {
    play('error');
    return;
  }
  play('move');
  render();
  save();
}

function doReset() {
  if (busy() || isOver() || !reset(game)) return;
  play('move');
  render();
  save();
}

function doHint() {
  if (busy() || isOver()) return;
  const res = hint(game);
  if (!res) return;
  play('select');
  toast(`还需最少 ${res.remaining} 步`);
  render();
  save();
}

function winWave(from) {
  const n = game.size;
  const fx = from % n;
  const fy = Math.floor(from / n);
  let maxD = 0;
  cells.forEach((el, i) => {
    const d = Math.abs((i % n) - fx) + Math.abs(Math.floor(i / n) - fy);
    maxD = Math.max(maxD, d);
    animate(el, 'flash', d * WAVE_STEP);
  });
  busyUntil = performance.now() + maxD * WAVE_STEP + 320;
}

// ---------------------------------------------------------------- 弹窗
function showResult(record = false) {
  const perfect = isPerfect(game);
  const s = statsFor(statsStore.get(), game.size);
  $('resultTitle').textContent = perfect ? '完美通关！' : '全部关灯！';
  const line2 = [`用时 ${formatTime(elapsed())}`];
  if (game.hints) line2.push(`提示 ${game.hints} 次`);
  $('resultDetail').replaceChildren(
    `${game.size}×${game.size} · ${moves(game)} 步（最少 ${game.optimal} 步）`,
    document.createElement('br'),
    line2.join(' · '),
  );
  $('resultRecord').hidden = !record;
  const items = [
    [`${s.won} / ${s.played}`, '胜局 / 总局'],
    [String(s.perfect), '完美通关'],
    [s.bestTime ? formatTime(s.bestTime) : '—', '最佳用时'],
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

// ---------------------------------------------------------------- 输入
board.addEventListener('click', (e) => {
  const el = e.target.closest('.cell');
  if (!el || anyModalOpen()) return;
  hideFocus();
  doPress(Number(el.dataset.i));
});

function hideFocus() {
  if (focusIdx >= 0) cells[focusIdx]?.classList.remove('focus');
  focusIdx = -1;
}

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

document.addEventListener('keydown', (e) => {
  if (anyModalOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (DIRS[key]) {
    e.preventDefault();
    moveFocus(...DIRS[key]);
  } else if (focusIdx >= 0 && (key === ' ' || key === 'Enter')) {
    e.preventDefault();
    document.activeElement?.blur?.();
    doPress(focusIdx);
  } else if (key === 'z' || key === 'Backspace') {
    e.preventDefault();
    doUndo();
  } else if (key === 'r') {
    doReset();
  } else if (key === 'h') {
    doHint();
  } else if (key === 'n') {
    requestNewGame();
  }
});

function requestNewGame() {
  if (busy()) return;
  guardAbandon('换一题将放弃本局，确定吗？', () => newGame());
}

undoBtn.addEventListener('click', doUndo);
resetBtn.addEventListener('click', doReset);
hintBtn.addEventListener('click', doHint);
$('againBtn').addEventListener('click', () => newGame());
$('restartBtn').addEventListener('click', requestNewGame);

$('sizeSelect').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-size]');
  const size = Number(btn?.dataset.size);
  if (!btn || size === game.size || busy()) return;
  guardAbandon('切换尺寸将放弃本局，确定吗？', () => switchSize(size));
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

board.addEventListener('animationend', (e) => e.target.classList.remove('pop', 'flash'));

// ---------------------------------------------------------------- 生命周期
setInterval(() => runningSince !== null && renderTimer(), 250);

document.addEventListener('visibilitychange', () => {
  if (!game) return;
  if (document.hidden) {
    stopClock();
    save();
  } else if (started()) {
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
  if (started()) startClock();
} else {
  const size = sizeStore.get();
  newGame(SIZES.includes(size) ? size : DEFAULT_SIZE);
}

if (!helpStore.get()) {
  helpStore.set(true);
  $('helpModal').hidden = false;
}
