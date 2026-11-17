import { initPage, storage } from '../../js/pwa.js';
import { play } from '../../js/sfx.js';
import { shuffle, isSolved, moveAt, moveDirection } from './puzzle.js';

initPage();

const SIZES = [3, 4, 5, 6];
const bestStore = storage('h5.klotski.best', {});
const stateStore = storage('h5.klotski.state', null);
const sizeStore = storage('h5.klotski.size', 4);

const $ = (id) => document.getElementById(id);
const board = $('board');
const boardWrap = $('boardWrap');
const timeEl = $('time');
const movesEl = $('moves');
const bestEl = $('best');

const inner = document.createElement('div');
inner.className = 'board-inner';
board.appendChild(inner);

let n = 4;
let tiles = [];
let moves = 0;
let elapsed = 0; // 已累计毫秒（不含当前运行段）
let startedAt = 0; // 当前运行段的起点，0 表示未在计时
let started = false;
let won = false;
let timer = 0;
let tileEls = new Map();

function formatTime(ms) {
  const total = Math.floor(ms / 100);
  const tenths = total % 10;
  const secs = Math.floor(total / 10) % 60;
  const mins = Math.floor(total / 600);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

function currentTime() {
  return elapsed + (startedAt ? performance.now() - startedAt : 0);
}

function startTimer() {
  if (startedAt || won) return;
  startedAt = performance.now();
  timer = setInterval(() => (timeEl.textContent = formatTime(currentTime())), 100);
}

function pauseTimer() {
  if (!startedAt) return;
  elapsed = currentTime();
  startedAt = 0;
  clearInterval(timer);
  timeEl.textContent = formatTime(elapsed);
}

function renderBest() {
  const best = bestStore.get()[n];
  bestEl.innerHTML = best ? `${formatTime(best.time)}<br>${best.moves} 步` : '—';
}

function renderStats() {
  movesEl.textContent = moves;
  timeEl.textContent = formatTime(currentTime());
}

function buildTiles() {
  inner.innerHTML = '';
  tileEls = new Map();
  const pct = 100 / n;
  for (let v = 1; v < n * n; v++) {
    const el = document.createElement('div');
    el.className = 'tile';
    el.style.width = `${pct}%`;
    el.style.height = `${pct}%`;
    const span = document.createElement('span');
    span.textContent = v;
    el.appendChild(span);
    inner.appendChild(el);
    tileEls.set(v, el);
  }
  layout();
}

function renderTiles() {
  tiles.forEach((v, i) => {
    if (!v) return;
    const el = tileEls.get(v);
    el.style.transform = `translate(${(i % n) * 100}%, ${Math.floor(i / n) * 100}%)`;
    el.classList.toggle('correct', v === i + 1);
  });
  board.classList.toggle('won', won);
}

function layout() {
  const w = boardWrap.clientWidth - 32;
  const h = boardWrap.clientHeight - 24;
  const size = Math.max(160, Math.min(w, h, 560));
  board.style.width = `${size}px`;
  board.style.height = `${size}px`;
  inner.style.fontSize = `${Math.round((size / n) * (n >= 5 ? 0.38 : 0.42))}px`;
}

function saveState() {
  stateStore.set({ n, tiles, moves, elapsed: currentTime(), started, won });
}

function newGame(size = n) {
  pauseTimer();
  n = size;
  sizeStore.set(n);
  tiles = shuffle(n);
  moves = 0;
  elapsed = 0;
  started = false;
  won = false;
  syncSizeButtons();
  buildTiles();
  renderTiles();
  renderStats();
  renderBest();
  saveState();
}

function restore() {
  const s = stateStore.get();
  if (!s || !SIZES.includes(s.n) || !Array.isArray(s.tiles) || s.tiles.length !== s.n * s.n || s.won) {
    newGame(SIZES.includes(sizeStore.get()) ? sizeStore.get() : 4);
    return;
  }
  n = s.n;
  tiles = s.tiles;
  moves = s.moves || 0;
  elapsed = s.elapsed || 0;
  started = !!s.started;
  won = false;
  syncSizeButtons();
  buildTiles();
  renderTiles();
  renderStats();
  renderBest();
  if (started) startTimer();
}

function syncSizeButtons() {
  for (const btn of document.querySelectorAll('#sizeSelect button')) {
    btn.setAttribute('aria-pressed', String(Number(btn.dataset.size) === n));
  }
}

function afterMove(count) {
  if (!count || won) return;
  if (!started) {
    started = true;
    startTimer();
  }
  moves += count;
  play('move');
  if (isSolved(tiles)) onWin();
  renderTiles();
  renderStats();
  saveState();
  if (navigator.vibrate) navigator.vibrate(8);
}

function onWin() {
  won = true;
  pauseTimer();
  play('win', 0.15);
  const time = elapsed;
  const all = bestStore.get();
  const prev = all[n];
  const newTime = !prev || time < prev.time;
  const newMoves = !prev || moves < prev.moves;
  all[n] = { time: newTime ? time : prev.time, moves: newMoves ? moves : prev.moves };
  bestStore.set(all);
  renderBest();
  $('winDetail').textContent = `${n}×${n} 用时 ${formatTime(time)}，共 ${moves} 步`;
  const notes = [];
  if (prev && newTime) notes.push('最短用时');
  if (prev && newMoves) notes.push('最少步数');
  $('winRecord').textContent = !prev ? '首次通关该难度！' : notes.length ? `🏆 新纪录：${notes.join('、')}` : '';
  setTimeout(() => ($('winModal').hidden = false), 250);
}

// 指针交互：短按视为点击，位移较大视为滑动
let pointer = null;

function cellAt(clientX, clientY) {
  const rect = inner.getBoundingClientRect();
  const c = Math.floor(((clientX - rect.left) / rect.width) * n);
  const r = Math.floor(((clientY - rect.top) / rect.height) * n);
  if (r < 0 || r >= n || c < 0 || c >= n) return -1;
  return r * n + c;
}

board.addEventListener('pointerdown', (e) => {
  if (won) return;
  pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, cell: cellAt(e.clientX, e.clientY), done: false };
  board.setPointerCapture?.(e.pointerId);
});

function handleSwipe(dx, dy) {
  const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  // 从与空格同行/同列的方块开始、且朝空格方向滑动时，推动整段
  const blank = tiles.indexOf(0);
  const cell = pointer.cell;
  if (cell >= 0 && cell !== blank) {
    const sameRow = Math.floor(cell / n) === Math.floor(blank / n);
    const sameCol = cell % n === blank % n;
    const toward =
      (sameRow && ((dir === 'right' && cell < blank) || (dir === 'left' && cell > blank))) ||
      (sameCol && ((dir === 'down' && cell < blank) || (dir === 'up' && cell > blank)));
    if (toward) return afterMove(moveAt(tiles, n, cell));
  }
  afterMove(moveDirection(tiles, n, dir));
}

board.addEventListener('pointermove', (e) => {
  if (!pointer || pointer.id !== e.pointerId || pointer.done) return;
  const dx = e.clientX - pointer.x;
  const dy = e.clientY - pointer.y;
  const threshold = Math.max(18, board.clientWidth / n / 3);
  if (Math.hypot(dx, dy) >= threshold) {
    pointer.done = true;
    handleSwipe(dx, dy);
  }
});

board.addEventListener('pointerup', (e) => {
  if (!pointer || pointer.id !== e.pointerId) return;
  if (!pointer.done) {
    const dx = e.clientX - pointer.x;
    const dy = e.clientY - pointer.y;
    if (Math.hypot(dx, dy) < 12) afterMove(moveAt(tiles, n, pointer.cell));
    else handleSwipe(dx, dy);
  }
  pointer = null;
});

board.addEventListener('pointercancel', () => (pointer = null));

// 键盘方向键（桌面端）
document.addEventListener('keydown', (e) => {
  const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  if (map[e.key] && !won) {
    e.preventDefault();
    afterMove(moveDirection(tiles, n, map[e.key]));
  }
});

$('sizeSelect').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-size]');
  if (!btn) return;
  const size = Number(btn.dataset.size);
  if (size !== n || started) newGame(size);
});

$('shuffleBtn').addEventListener('click', () => newGame());
$('winAgain').addEventListener('click', () => {
  $('winModal').hidden = true;
  newGame();
});
$('winClose').addEventListener('click', () => ($('winModal').hidden = true));
$('helpBtn').addEventListener('click', () => ($('helpModal').hidden = false));
$('helpModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget || e.target.closest('[data-close]')) e.currentTarget.hidden = true;
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pauseTimer();
    saveState();
  } else if (started && !won) {
    startTimer();
  }
});
window.addEventListener('pagehide', saveState);

new ResizeObserver(layout).observe(boardWrap);

restore();
