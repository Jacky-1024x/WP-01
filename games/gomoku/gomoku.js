import { initPage, storage, toast } from '../../js/pwa.js';
import { play } from '../../js/sfx.js';
import { SIZE, BLACK, WHITE, findWinLine } from './ai.js';

initPage();

const N = SIZE;
const LEVEL_NAMES = { easy: '简单', normal: '普通', hard: '困难' };
const MIN_THINK_MS = 350;

const $ = (id) => document.getElementById(id);
const canvas = $('board');
const ctx = canvas.getContext('2d');
const wrap = $('boardWrap');
const statusEl = $('status');

const settingsStore = storage('h5.gomoku.settings', { level: 'normal', side: BLACK, confirm: true });
const gameStore = storage('h5.gomoku.game', null);
const statsStore = storage('h5.gomoku.stats', {});

const settings = { level: 'normal', side: BLACK, confirm: true, ...settingsStore.get() };
if (!LEVEL_NAMES[settings.level]) settings.level = 'normal';
if (settings.side !== BLACK && settings.side !== WHITE) settings.side = BLACK;

let moves = [];
let board = new Array(N * N).fill(0);
let playerColor = settings.side;
let winLine = null;
let gameOver = false;
let thinking = false;
let requestId = 0;
let preview = -1;

// ---------- AI 调度（优先 Web Worker，失败时回退到主线程） ----------
let worker = null;
let workerFailed = false;
const pending = new Map();

function getWorker() {
  if (worker || workerFailed) return worker;
  try {
    worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const cb = pending.get(e.data.id);
      pending.delete(e.data.id);
      cb?.(e.data);
    };
    worker.onerror = (e) => {
      console.warn('AI Worker 出错，改用主线程计算', e.message);
      e.preventDefault?.();
      worker?.terminate();
      worker = null;
      workerFailed = true;
      for (const [id, cb] of pending) computeOnMainThread(id, cb);
      pending.clear();
    };
  } catch (err) {
    console.warn('无法创建 Worker，改用主线程计算', err);
    workerFailed = true;
    worker = null;
  }
  return worker;
}

const lastRequest = new Map();

function computeOnMainThread(id, cb) {
  const req = lastRequest.get(id);
  if (!req) return;
  // 让出一帧，先把「思考中」状态渲染出来
  setTimeout(async () => {
    const { chooseMove } = await import('./ai.js');
    cb({ id, ...chooseMove(req.board, req.player, req.level) });
  }, 30);
}

function requestAiMove(cb) {
  const id = ++requestId;
  const req = { id, board: board.slice(), player: 3 - playerColor, level: settings.level };
  lastRequest.clear();
  lastRequest.set(id, req);
  const w = getWorker();
  if (w) {
    pending.set(id, cb);
    w.postMessage(req);
  } else {
    computeOnMainThread(id, cb);
  }
  return id;
}

// ---------- 对局逻辑 ----------
const colorAt = (i) => (i % 2 === 0 ? BLACK : WHITE);
const turnColor = () => colorAt(moves.length);
const aiColor = () => 3 - playerColor;

function rebuildBoard() {
  board = new Array(N * N).fill(0);
  moves.forEach((p, i) => (board[p] = colorAt(i)));
  winLine = null;
  gameOver = false;
  if (moves.length) {
    const last = moves[moves.length - 1];
    winLine = findWinLine(board, last);
    gameOver = !!winLine || moves.length >= N * N;
  }
}

function saveGame() {
  gameStore.set({ moves, playerColor });
}

function saveSettings() {
  settingsStore.set(settings);
}

function place(p) {
  const color = turnColor();
  moves.push(p);
  board[p] = color;
  preview = -1;
  play('place');
  const line = findWinLine(board, p);
  if (line) {
    winLine = line;
    gameOver = true;
    finish(color);
  } else if (moves.length >= N * N) {
    gameOver = true;
    finish(0);
  }
  saveGame();
  draw();
  updateUI();
}

function finish(winner) {
  const stats = statsStore.get();
  const s = (stats[settings.level] ||= { w: 0, l: 0, d: 0 });
  let title;
  let detail;
  if (winner === playerColor) {
    s.w++;
    title = '🎉 你赢了！';
    detail = `${LEVEL_NAMES[settings.level]}难度，共 ${moves.length} 手`;
    navigator.vibrate?.([30, 40, 30]);
    play('win', 0.3);
  } else if (winner) {
    s.l++;
    title = '😵 AI 获胜';
    detail = '可以悔棋再试，或者换个难度再来一局';
    play('lose', 0.3);
  } else {
    s.d++;
    play('draw', 0.3);
    title = '平局';
    detail = '棋盘已下满';
  }
  statsStore.set(stats);
  $('resultTitle').textContent = title;
  $('resultDetail').textContent = detail;
  setTimeout(() => ($('resultModal').hidden = false), 600);
}

function maybeAiMove() {
  if (gameOver || turnColor() !== aiColor()) return;
  thinking = true;
  updateUI();
  const started = performance.now();
  const id = requestAiMove((res) => {
    if (id !== requestId || !thinking) return; // 已被悔棋/重开取消
    const wait = Math.max(0, MIN_THINK_MS - (performance.now() - started));
    setTimeout(() => {
      if (id !== requestId || !thinking) return;
      thinking = false;
      if (res.move >= 0 && !board[res.move]) place(res.move);
      else updateUI();
    }, wait);
  });
}

function cancelThinking() {
  thinking = false;
  requestId++;
}

function newGame(side = settings.side) {
  cancelThinking();
  settings.side = side;
  playerColor = side;
  saveSettings();
  moves = [];
  preview = -1;
  rebuildBoard();
  saveGame();
  $('resultModal').hidden = true;
  draw();
  updateUI();
  maybeAiMove();
}

function canUndo() {
  return moves.some((_, i) => colorAt(i) === playerColor);
}

function undo() {
  if (!canUndo()) return;
  cancelThinking();
  while (moves.length && colorAt(moves.length - 1) !== playerColor) moves.pop();
  moves.pop();
  preview = -1;
  rebuildBoard();
  saveGame();
  $('resultModal').hidden = true;
  draw();
  updateUI();
}

function updateUI() {
  const you = playerColor === BLACK ? 'black' : 'white';
  const ai = playerColor === BLACK ? 'white' : 'black';
  $('youStone').className = `stone ${you}`;
  $('aiStone').className = `stone ${ai}`;
  const yourTurn = !gameOver && turnColor() === playerColor;
  $('playerYou').classList.toggle('active', yourTurn);
  $('playerAi').classList.toggle('active', !gameOver && !yourTurn);

  statusEl.classList.toggle('thinking', thinking);
  if (gameOver) {
    const winner = winLine ? board[winLine[0]] : 0;
    statusEl.textContent = winner === playerColor ? '你赢了！' : winner ? 'AI 获胜' : '平局';
  } else if (thinking) {
    statusEl.textContent = 'AI 思考中';
  } else if (yourTurn) {
    statusEl.textContent = preview >= 0 ? '再点一次确认落子' : `轮到你落子（${playerColor === BLACK ? '黑' : '白'}）`;
  } else {
    statusEl.textContent = '等待 AI';
  }

  for (const btn of document.querySelectorAll('#levelSelect button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.level === settings.level));
  }
  for (const btn of document.querySelectorAll('#sideSelect button')) {
    btn.setAttribute('aria-pressed', String(Number(btn.dataset.side) === playerColor));
  }
  $('confirmBtn').setAttribute('aria-pressed', String(settings.confirm));
  $('confirmBtn').textContent = settings.confirm ? '确认落子 ✓' : '确认落子';
  $('undoBtn').disabled = !canUndo();

  const s = statsStore.get()[settings.level];
  $('record').textContent = s ? `${LEVEL_NAMES[settings.level]}战绩：${s.w} 胜 ${s.l} 负${s.d ? ` ${s.d} 平` : ''}` : '';
}

// ---------- 绘制 ----------
const geo = { size: 0, cell: 0, pad: 0 };
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function resize() {
  const avail = Math.floor(Math.min(wrap.clientWidth - 16, wrap.clientHeight - 8));
  const size = Math.max(200, Math.min(avail, 640));
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  geo.size = size;
  geo.cell = size / (N - 1 + 1.3);
  geo.pad = geo.cell * 0.65;
  draw();
}

const pos = (i) => geo.pad + i * geo.cell;

function drawStone(p, color, alpha = 1) {
  const x = pos(p % N);
  const y = pos(Math.floor(p / N));
  const r = geo.cell * 0.44;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = geo.cell * 0.12;
  ctx.shadowOffsetY = geo.cell * 0.06;
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  if (color === BLACK) {
    g.addColorStop(0, '#6b7280');
    g.addColorStop(1, '#0b0f19');
  } else {
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#cbd0d8');
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function draw() {
  if (!geo.size) return;
  const dark = darkQuery.matches;
  const { size, cell } = geo;
  ctx.clearRect(0, 0, size, size);
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, dark ? '#9a7442' : '#f1cd8a');
  bg.addColorStop(1, dark ? '#7d5a2e' : '#dfac5c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = dark ? 'rgba(30,18,6,0.75)' : 'rgba(92,58,20,0.8)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < N; i++) {
    const v = Math.round(pos(i)) + 0.5;
    ctx.moveTo(pos(0), v);
    ctx.lineTo(pos(N - 1), v);
    ctx.moveTo(v, pos(0));
    ctx.lineTo(v, pos(N - 1));
  }
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeRect(pos(0), pos(0), pos(N - 1) - pos(0), pos(N - 1) - pos(0));

  ctx.fillStyle = ctx.strokeStyle;
  for (const [r, c] of [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]]) {
    ctx.beginPath();
    ctx.arc(Math.round(pos(c)) + 0.5, Math.round(pos(r)) + 0.5, Math.max(2.5, cell * 0.12), 0, Math.PI * 2);
    ctx.fill();
  }

  moves.forEach((p, i) => drawStone(p, colorAt(i)));

  if (preview >= 0 && !board[preview]) {
    drawStone(preview, playerColor, 0.55);
    const x = pos(preview % N);
    const y = pos(Math.floor(preview / N));
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, cell * 0.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (moves.length) {
    const last = moves[moves.length - 1];
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(pos(last % N), pos(Math.floor(last / N)), Math.max(3, cell * 0.13), 0, Math.PI * 2);
    ctx.fill();
  }

  if (winLine) {
    const a = winLine[0];
    const b = winLine[winLine.length - 1];
    ctx.save();
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
    ctx.lineWidth = Math.max(3, cell * 0.16);
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(250, 204, 21, 0.9)';
    ctx.shadowBlur = cell * 0.4;
    ctx.beginPath();
    ctx.moveTo(pos(a % N), pos(Math.floor(a / N)));
    ctx.lineTo(pos(b % N), pos(Math.floor(b / N)));
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2.5;
    for (const p of winLine) {
      ctx.beginPath();
      ctx.arc(pos(p % N), pos(Math.floor(p / N)), cell * 0.47, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

// ---------- 交互 ----------
function pointFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const c = Math.round((x - geo.pad) / geo.cell);
  const r = Math.round((y - geo.pad) / geo.cell);
  if (r < 0 || r >= N || c < 0 || c >= N) return -1;
  return r * N + c;
}

let down = null;
canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, id: e.pointerId };
});
canvas.addEventListener('pointercancel', () => (down = null));
canvas.addEventListener('pointerup', (e) => {
  if (!down || down.id !== e.pointerId) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (moved > geo.cell * 0.8) return;
  if (gameOver || thinking || turnColor() !== playerColor) return;
  const p = pointFromEvent(e);
  if (p < 0) return;
  if (board[p]) return play('error');
  if (settings.confirm && preview !== p) {
    play('select');
    preview = p;
    draw();
    updateUI();
    return;
  }
  place(p);
  maybeAiMove();
});

$('levelSelect').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-level]');
  if (!btn || btn.dataset.level === settings.level) return;
  settings.level = btn.dataset.level;
  saveSettings();
  updateUI();
  toast(`已切换为${LEVEL_NAMES[settings.level]}难度`);
});

$('sideSelect').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-side]');
  if (!btn) return;
  const side = Number(btn.dataset.side);
  if (side === playerColor) return;
  const inProgress = !gameOver && moves.some((_, i) => colorAt(i) === playerColor);
  if (inProgress && !confirm('切换执子会重新开始本局，确定吗？')) return;
  newGame(side);
});

$('confirmBtn').addEventListener('click', () => {
  settings.confirm = !settings.confirm;
  preview = -1;
  saveSettings();
  draw();
  updateUI();
  toast(settings.confirm ? '已开启确认落子：点两次落子' : '已关闭确认落子：点一次落子');
});

$('undoBtn').addEventListener('click', undo);
$('restartBtn').addEventListener('click', () => {
  if (!gameOver && moves.length > 1 && !confirm('确定放弃当前对局，重新开始吗？')) return;
  newGame();
});
$('resultAgain').addEventListener('click', () => newGame());
$('resultClose').addEventListener('click', () => ($('resultModal').hidden = true));
$('helpBtn').addEventListener('click', () => ($('helpModal').hidden = false));
$('helpModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget || e.target.closest('[data-close]')) e.currentTarget.hidden = true;
});

darkQuery.addEventListener?.('change', draw);
new ResizeObserver(resize).observe(wrap);

// ---------- 恢复上次对局 ----------
(function restore() {
  const saved = gameStore.get();
  const valid =
    saved &&
    Array.isArray(saved.moves) &&
    (saved.playerColor === BLACK || saved.playerColor === WHITE) &&
    saved.moves.every((p) => Number.isInteger(p) && p >= 0 && p < N * N) &&
    new Set(saved.moves).size === saved.moves.length;
  if (valid) {
    playerColor = saved.playerColor;
    moves = saved.moves.slice();
    rebuildBoard();
    if (gameOver) {
      moves = [];
      rebuildBoard();
    }
  }
  updateUI();
  resize();
  maybeAiMove();
})();
