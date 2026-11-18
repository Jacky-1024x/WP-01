import { initPage, storage, toast } from '../../js/pwa.js';
import { play, isMuted } from '../../js/sfx.js';
import * as fl from './engine.js';
import { LEVELS } from './levels.js';

initPage();

const PALETTE = ['#ef4444', '#3b82f6', '#facc15', '#22c55e', '#fb923c', '#22d3ee', '#e879f9', '#a8743a', '#e5e7eb', '#8b5cf6', '#f9a8d4', '#a3e635'];
const BOARD_BG = '#111827';
const GRID_LINE = '#374151';

const sizeStore = storage('h5.flow.size', 5);
const levelStore = storage('h5.flow.level', {});
const progressStore = storage('h5.flow.progress', {});
const stateStore = storage('h5.flow.state', {});
const helpStore = storage('h5.flow.helpSeen', false);

const $ = (id) => document.getElementById(id);
const canvas = $('board');
const ctx = canvas.getContext('2d');
const boardWrap = $('boardWrap');

let n = 5;
let levelIdx = 0;
let g = null;
let drag = null;
let pointer = null; // { id, x, y }：当前跟踪的手指（棋盘内 CSS 像素）
let boardPx = 300;
let anims = []; // { type, start, dur, color? }
let rafId = 0;

const parsedCache = new Map();
function levelData(size, idx) {
  const key = `${size}:${idx}`;
  if (!parsedCache.has(key)) parsedCache.set(key, fl.parseLevel(LEVELS[size][idx]));
  return parsedCache.get(key);
}

function textColor(hex) {
  const v = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
  return lum > 0.6 ? '#111827' : '#ffffff';
}

// ---------- 存档 ----------

function saveState() {
  if (!g) return;
  const all = stateStore.get() || {};
  if (g.status === 'playing' && (fl.hasProgress(g) || g.moves || g.undo.length)) all[n] = fl.serialize(g);
  else delete all[n];
  stateStore.set(all);
  const lv = levelStore.get() || {};
  lv[n] = levelIdx;
  levelStore.set(lv);
  sizeStore.set(n);
}

function progressOf(size, idx) {
  return (progressStore.get() || {})[size]?.[idx] || null;
}

// ---------- 载入 ----------

function loadLevel(size, idx, { fresh = false } = {}) {
  n = size;
  levelIdx = Math.max(0, Math.min(idx, LEVELS[n].length - 1));
  const level = levelData(n, levelIdx);
  const save = fresh ? null : (stateStore.get() || {})[n];
  g = fl.restoreGame(level, levelIdx, save) || fl.createGame(level, levelIdx);
  drag = null;
  pointer = null;
  anims = [];
  syncSizeButtons();
  saveState();
  layout();
  updateUI();
}

function syncSizeButtons() {
  for (const btn of document.querySelectorAll('#sizeSelect button')) {
    btn.setAttribute('aria-pressed', String(Number(btn.dataset.size) === n));
  }
}

// ---------- 界面 ----------

function updateUI() {
  const k = fl.colorCount(g);
  $('flows').textContent = `${fl.connectedCount(g)}/${k}`;
  $('fill').textContent = `${fl.fillPercent(g)}%`;
  $('moves').textContent = g.moves;
  const rec = progressOf(n, levelIdx);
  $('best').textContent = `最佳 ${rec ? rec.best : '—'}`;
  $('levelText').textContent = `第 ${levelIdx + 1} 关`;
  $('levelTotal').textContent = `/ ${LEVELS[n].length}`;
  $('levelMark').textContent = rec ? (rec.perfect ? '★' : '✓') : '';
  $('prevBtn').disabled = levelIdx === 0;
  $('nextBtn').disabled = levelIdx >= LEVELS[n].length - 1;
  $('undoBtn').disabled = !fl.canUndo(g);
  $('restartBtn').disabled = g.status === 'playing' && !fl.hasProgress(g) && !g.moves;
  $('hintText').textContent = g.status === 'won' ? '下一关' : '提示';
  render();
}

function layout() {
  const w = boardWrap.clientWidth - 24;
  const h = boardWrap.clientHeight - 16;
  boardPx = Math.floor(Math.max(240, Math.min(w, h, 560)));
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${boardPx}px`;
  canvas.style.height = `${boardPx}px`;
  canvas.width = Math.round(boardPx * dpr);
  canvas.height = Math.round(boardPx * dpr);
  render();
}

// ---------- 绘制 ----------

function center(cell) {
  const s = boardPx / n;
  return [(cell % n) * s + s / 2, Math.floor(cell / n) * s + s / 2];
}

function animProgress(a, now) {
  return Math.min(1, (now - a.start) / a.dur);
}

function render() {
  if (!g) return;
  const now = performance.now();
  anims = anims.filter((a) => now - a.start < a.dur);
  const s = boardPx / n;
  const own = fl.ownerGrid(g);
  // 画布上下文可能被浏览器重置（如 GPU 上下文丢失），每帧重新设置缩放
  const scale = canvas.width / boardPx;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, boardPx, boardPx);
  ctx.fillStyle = BOARD_BG;
  ctx.fillRect(0, 0, boardPx, boardPx);

  const winA = anims.find((a) => a.type === 'win');
  const gapA = anims.find((a) => a.type === 'gaps');
  const hintA = anims.find((a) => a.type === 'hint');

  // 格子底色
  for (let i = 0; i < n * n; i++) {
    const x = (i % n) * s;
    const y = Math.floor(i / n) * s;
    const c = own[i];
    if (c >= 0) {
      let alpha = fl.isConnected(g, c) ? 0.3 : 0.2;
      if (g.status === 'won') alpha = 0.34;
      if (winA) {
        const t = animProgress(winA, now);
        const wave = (Math.floor(i / n) + (i % n)) / (2 * n);
        alpha += 0.35 * Math.max(0, 1 - Math.abs(t * 1.6 - wave - 0.2) * 4);
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = PALETTE[c % PALETTE.length];
      ctx.fillRect(x, y, s, s);
      ctx.globalAlpha = 1;
    } else if (gapA && g.endColor[i] < 0) {
      const t = animProgress(gapA, now);
      ctx.globalAlpha = 0.28 * Math.sin(t * Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, s, s);
      ctx.globalAlpha = 1;
    }
  }

  // 格线
  ctx.strokeStyle = GRID_LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < n; i++) {
    const p = Math.round(i * s) + 0.5;
    ctx.moveTo(p, 0);
    ctx.lineTo(p, boardPx);
    ctx.moveTo(0, p);
    ctx.lineTo(boardPx, p);
  }
  ctx.stroke();

  // 路径
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  g.paths.forEach((p, c) => {
    if (p.length < 2) return;
    ctx.strokeStyle = PALETTE[c % PALETTE.length];
    ctx.lineWidth = s * 0.34;
    if (hintA && hintA.color === c) {
      const t = animProgress(hintA, now);
      ctx.globalAlpha = 0.45 + 0.55 * Math.abs(Math.cos(t * Math.PI * 3));
    }
    ctx.beginPath();
    p.forEach((cell, i) => {
      const [x, y] = center(cell);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
  });

  // 端点
  const r0 = s * 0.34;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(s * 0.36)}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`;
  g.ends.forEach((pair, c) => {
    const color = PALETTE[c % PALETTE.length];
    const connected = fl.isConnected(g, c);
    const active = drag && drag.color === c;
    const pulse = anims.find((a) => a.type === 'connect' && a.color === c);
    for (const cell of pair) {
      const [x, y] = center(cell);
      let r = r0;
      if (pulse) {
        const t = animProgress(pulse, now);
        r = r0 * (1 + 0.25 * Math.sin(t * Math.PI));
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, r0 * (1 + t * 0.9), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (active || connected) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = active ? 3 : 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r + (active ? 2.5 : 1), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = textColor(color);
      ctx.fillText(String(c + 1), x, y + s * 0.02);
    }
  });

  // 手指位置的半透明大圆
  if (drag && pointer) {
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = PALETTE[drag.color % PALETTE.length];
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, s * 1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  if (anims.length && !rafId) rafId = requestAnimationFrame(tick);
}

function tick() {
  rafId = 0;
  render();
}

function animate(type, dur, extra = {}) {
  anims = anims.filter((a) => !(a.type === type && a.color === extra.color));
  anims.push({ type, start: performance.now(), dur, ...extra });
  render();
}

// ---------- 拖动 ----------

function localPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function cellAtPos({ x, y }) {
  const s = boardPx / n;
  const c = Math.floor(x / s);
  const r = Math.floor(y / s);
  if (r < 0 || r >= n || c < 0 || c >= n) return -1;
  return r * n + c;
}

// 从路径末端逐格走向目标格，先走差距大的方向；被挡住就停
function stepToward(target) {
  for (let guard = 0; guard < n * 4; guard++) {
    const last = drag.path[drag.path.length - 1];
    if (last === target) return;
    const dr = Math.floor(target / n) - Math.floor(last / n);
    const dc = (target % n) - (last % n);
    const next = Math.abs(dr) >= Math.abs(dc) ? last + Math.sign(dr) * n : last + Math.sign(dc);
    const res = fl.dragTo(g, drag, next);
    if (!res.changed) return;
    if (res.connected) onConnect(drag.color);
  }
}

function onConnect(color) {
  play('clear', 0, { pitch: 1 + 0.06 * fl.connectedCount(g) });
  animate('connect', 320, { color });
  if (navigator.vibrate && !isMuted()) navigator.vibrate(10);
}

canvas.addEventListener('pointerdown', (e) => {
  if (pointer || !g || g.status !== 'playing') return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const pos = localPos(e);
  const d = fl.beginDrag(g, cellAtPos(pos));
  if (!d) return;
  e.preventDefault();
  drag = d;
  pointer = { id: e.pointerId, ...pos };
  canvas.setPointerCapture?.(e.pointerId);
  updateUI();
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointer || pointer.id !== e.pointerId || !drag) return;
  e.preventDefault();
  const pos = localPos(e);
  pointer.x = pos.x;
  pointer.y = pos.y;
  const cell = cellAtPos(pos);
  if (cell >= 0) stepToward(cell);
  updateStatsOnly();
  render();
});

function updateStatsOnly() {
  $('flows').textContent = `${fl.connectedCount(g)}/${fl.colorCount(g)}`;
  $('fill').textContent = `${fl.fillPercent(g)}%`;
}

function finishDrag(e) {
  if (!pointer || pointer.id !== e.pointerId) return;
  const d = drag;
  drag = null;
  pointer = null;
  const res = fl.endDrag(g, d);
  if (res.changed) saveState();
  afterChange(res);
}

canvas.addEventListener('pointerup', finishDrag);
canvas.addEventListener('pointercancel', finishDrag);
canvas.addEventListener('lostpointercapture', finishDrag);

function afterChange(res) {
  if (res.solved) onWin();
  else if (res.gaps) {
    play('error');
    toast('还有格子没铺满');
    animate('gaps', 600);
  }
  updateUI();
}

// ---------- 过关 ----------

function onWin() {
  const k = fl.colorCount(g);
  const perfect = g.moves === k && g.hints === 0;
  const all = progressStore.get() || {};
  const bySize = (all[n] = all[n] || {});
  const prev = bySize[levelIdx];
  const best = prev ? Math.min(prev.best, g.moves) : g.moves;
  bySize[levelIdx] = { best, perfect: !!(prev?.perfect || perfect) };
  progressStore.set(all);
  saveState();
  play('win', 0.15);
  animate('win', 900);
  $('winTitle').textContent = perfect ? '完美！' : '完成！';
  const hintNote = g.hints ? `，用了 ${g.hints} 次提示` : '';
  $('winDetail').textContent = `${n}×${n} · 第 ${levelIdx + 1} 关　${g.moves} 步${hintNote}`;
  $('winRecord').textContent = !prev ? '首次通关！' : g.moves < prev.best ? `🏆 新纪录：${g.moves} 步` : `最佳 ${best} 步`;
  setTimeout(() => {
    if (g.status === 'won') $('winModal').hidden = false;
  }, 900);
}

function nextLevel() {
  $('winModal').hidden = true;
  loadLevel(n, (levelIdx + 1) % LEVELS[n].length, { fresh: true });
}

// ---------- 按钮 ----------

function confirmThen(title, text, fn) {
  $('confirmTitle').textContent = title;
  $('confirmText').textContent = text;
  $('confirmModal').hidden = false;
  $('confirmOk').onclick = () => {
    $('confirmModal').hidden = true;
    fn();
  };
}

function guardLeave(fn) {
  if (g.status === 'playing' && fl.hasProgress(g)) confirmThen('切换关卡', '切换关卡将清空本关的棋盘，确定吗？', fn);
  else fn();
}

function gotoLevel(idx) {
  if (idx === levelIdx || idx < 0 || idx >= LEVELS[n].length) return;
  guardLeave(() => {
    const all = stateStore.get() || {};
    delete all[n];
    stateStore.set(all);
    loadLevel(n, idx, { fresh: true });
  });
}

$('undoBtn').addEventListener('click', () => {
  if (fl.undo(g)) {
    saveState();
    updateUI();
  }
});

function doRestart() {
  fl.restart(g);
  anims = [];
  saveState();
  updateUI();
}

$('restartBtn').addEventListener('click', () => {
  if (g.status === 'playing' && fl.hasProgress(g)) confirmThen('重新开始', '清空本关所有路径，确定吗？', doRestart);
  else doRestart();
});

function doHint() {
  if (g.status === 'won') return nextLevel();
  const res = fl.hint(g);
  if (res.color < 0) return;
  play('select');
  animate('hint', 600, { color: res.color });
  saveState();
  afterChange(res);
}

$('hintBtn').addEventListener('click', doHint);

$('sizeSelect').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-size]');
  if (!btn) return;
  const size = Number(btn.dataset.size);
  if (size === n) return;
  saveState();
  const lv = levelStore.get() || {};
  loadLevel(size, Number.isInteger(lv[size]) ? lv[size] : 0);
});

$('prevBtn').addEventListener('click', () => gotoLevel(levelIdx - 1));
$('nextBtn').addEventListener('click', () => gotoLevel(levelIdx + 1));

$('levelBtn').addEventListener('click', () => {
  const grid = $('levelGrid');
  grid.innerHTML = '';
  const prog = (progressStore.get() || {})[n] || {};
  LEVELS[n].forEach((_, i) => {
    const b = document.createElement('button');
    const rec = prog[i];
    b.textContent = i + 1;
    if (rec) {
      b.classList.add(rec.perfect ? 'perfect' : 'done');
      const mark = document.createElement('i');
      mark.textContent = rec.perfect ? '★' : '✓';
      b.appendChild(mark);
    }
    if (i === levelIdx) b.classList.add('current');
    b.addEventListener('click', () => {
      $('levelModal').hidden = true;
      gotoLevel(i);
    });
    grid.appendChild(b);
  });
  $('levelModalTitle').textContent = `${n}×${n} 选择关卡`;
  $('levelModal').hidden = false;
});

$('winNext').addEventListener('click', nextLevel);
$('winClose').addEventListener('click', () => ($('winModal').hidden = true));
$('helpBtn').addEventListener('click', () => ($('helpModal').hidden = false));

for (const id of ['helpModal', 'levelModal', 'confirmModal']) {
  $(id).addEventListener('click', (e) => {
    if (e.target === e.currentTarget || e.target.closest('[data-close]')) e.currentTarget.hidden = true;
  });
}

document.addEventListener('keydown', (e) => {
  if (document.querySelector('.modal:not([hidden])') || drag) return;
  const key = e.key.toLowerCase();
  if (key === 'z') {
    e.preventDefault();
    $('undoBtn').click();
  } else if (key === 'h' && !e.metaKey && !e.ctrlKey) {
    doHint();
  } else if (key === 'r' && !e.metaKey && !e.ctrlKey) {
    $('restartBtn').click();
  } else if (e.key === 'ArrowLeft') {
    gotoLevel(levelIdx - 1);
  } else if (e.key === 'ArrowRight') {
    gotoLevel(levelIdx + 1);
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveState();
});
window.addEventListener('pagehide', saveState);

new ResizeObserver(layout).observe(boardWrap);

// ---------- 启动 ----------

{
  const size = fl.SIZES.includes(sizeStore.get()) ? sizeStore.get() : 5;
  const lv = levelStore.get() || {};
  loadLevel(size, Number.isInteger(lv[size]) ? lv[size] : 0);
  if (!helpStore.get()) {
    helpStore.set(true);
    $('helpModal').hidden = false;
  }
}
