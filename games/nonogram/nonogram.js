import { initPage, storage } from '../../js/pwa.js';
import { play, isMuted } from '../../js/sfx.js';
import {
  SIZES,
  FILL,
  EMPTY,
  makePuzzle,
  generateRandom,
  createGame,
  restoreGame,
  serialize,
  beginStroke,
  extendStroke,
  endStroke,
  undo,
  resetGame,
  clueDone,
  playerRow,
  playerCol,
  isWon,
} from './logic.js';
import { BANK, findPuzzle } from './puzzles.js';

initPage();

// 尺寸常量必须与 nonogram.css 中 .board-wrap 的 padding、.col-clues / .row-clues 的 padding 保持一致
const WRAP_PAD = 8;
const FRAME = 2;
const CLUE_PAD = 4;
const MIN_S = 16;
const MAX_S = 48;
const ZOOM_S = 40; // 放大档目标格子边长（与扫雷一致）
const ZOOM_MIN_SIZE = 10; // 10×10 / 15×15 才需要放大
const WIN_DELAY = 1100;

const sizeStore = storage('h5.nonogram.size', 5);
const toolStore = storage('h5.nonogram.tool', 'fill');
const stateStore = storage('h5.nonogram.state', {});
const solvedStore = storage('h5.nonogram.solved', {});
const statsStore = storage('h5.nonogram.stats', {});
const helpStore = storage('h5.nonogram.helpSeen', false);

const $ = (id) => document.getElementById(id);
const puzzleEl = $('puzzle');
const grid = $('grid');
const boardWrap = $('boardWrap');
const preview = $('preview');
const zoomBtn = $('zoomBtn');

let size = SIZES.includes(sizeStore.get()) ? sizeStore.get() : 5;
let tool = toolStore.get() === 'cross' ? 'cross' : 'fill';
let game = null;
let cells = [];
let zoomed = false;
let colClueEls = [];
let rowClueEls = [];
let runningSince = null;
let stroke = null; // 正在进行的一笔：{ id, ...logic 中的 stroke }
let focusIdx = -1;
let hlIdx = -1;
let confirmAction = null;
let winTimer = 0;

// ---------------------------------------------------------------- 工具
const isOver = () => game.status === 'won';
const other = (t) => (t === 'fill' ? 'cross' : 'fill');
const anyModalOpen = () => [...document.querySelectorAll('.modal')].some((m) => !m.hidden);
const hasMarks = () => game.cells.some((v) => v !== EMPTY);

function vibrate(pattern) {
  if (!isMuted()) navigator.vibrate?.(pattern);
}

function animate(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// 图案缩略图：SVG，每个涂黑格一个 rect
function artSvg(puzzle, px) {
  const { w, h, sol } = puzzle;
  const color = puzzle.color || getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
  let rects = '';
  for (let i = 0; i < sol.length; i++) {
    if (sol[i]) rects += `<rect x="${i % w}" y="${Math.floor(i / w)}" width="1.02" height="1.02"/>`;
  }
  return `<svg class="art" viewBox="-0.5 -0.5 ${w + 1} ${h + 1}" width="${px}" height="${px}" aria-hidden="true" shape-rendering="crispEdges"><g fill="${color}">${rects}</g></svg>`;
}

// ---------------------------------------------------------------- 题目
function bankPuzzle(entry) {
  return makePuzzle(entry.rows, { id: entry.id, name: entry.name, color: entry.color, no: entry.no });
}

function randomPuzzle(n) {
  const rows = generateRandom(n);
  if (rows) return makePuzzle(rows, { id: null });
  const list = BANK[n];
  return bankPuzzle(list[Math.floor(Math.random() * list.length)]);
}

// 下一题：题库中编号最小的未完成题；全部完成后出随机题
function nextPuzzle(n) {
  const solved = solvedStore.get();
  const entry = BANK[n].find((p) => !solved[p.id]);
  return entry ? bankPuzzle(entry) : randomPuzzle(n);
}

// ---------------------------------------------------------------- 计时
function elapsed() {
  return game.elapsed + (runningSince !== null ? performance.now() - runningSince : 0);
}

function startClock() {
  if (!isOver() && runningSince === null && !document.hidden) runningSince = performance.now();
}

function stopClock() {
  if (runningSince === null) return;
  game.elapsed += performance.now() - runningSince;
  runningSince = null;
}

function renderTimer() {
  $('timer').textContent = fmtTime(elapsed());
}

// ---------------------------------------------------------------- 棋盘 DOM
function clueSpans(el, clues) {
  const nums = clues.length ? clues : [0];
  el.replaceChildren(
    ...nums.map((n) => {
      const span = document.createElement('span');
      span.textContent = n;
      if (n >= 10) span.className = 'w2';
      return span;
    }),
  );
}

function buildBoard() {
  const { w, h, rowClues, colClues } = game.puzzle;
  puzzleEl.classList.remove('won');
  puzzleEl.style.setProperty('--w', w);
  puzzleEl.style.setProperty('--h', h);
  puzzleEl.style.removeProperty('--art');
  if (game.puzzle.color) puzzleEl.style.setProperty('--art', game.puzzle.color);

  const frag = document.createDocumentFragment();
  cells = [];
  for (let i = 0; i < w * h; i++) {
    const x = i % w;
    const y = Math.floor(i / w);
    const el = document.createElement('div');
    el.className = 'cell';
    if (x % 5 === 4) el.classList.add('v5');
    if (y % 5 === 4) el.classList.add('h5');
    if (x === w - 1) el.classList.add('last-x');
    if (y === h - 1) el.classList.add('last-y');
    el.dataset.i = i;
    el.setAttribute('role', 'gridcell');
    cells.push(frag.appendChild(el));
  }
  grid.replaceChildren(frag);

  colClueEls = colClues.map((c, x) => {
    const el = document.createElement('div');
    el.className = 'cc';
    if (x % 5 === 4 && x < w - 1) el.classList.add('v5');
    clueSpans(el, c);
    return el;
  });
  $('colClues').replaceChildren(...colClueEls);
  rowClueEls = rowClues.map((c, y) => {
    const el = document.createElement('div');
    el.className = 'rc';
    if (y % 5 === 4 && y < h - 1) el.classList.add('h5');
    clueSpans(el, c);
    return el;
  });
  $('rowClues').replaceChildren(...rowClueEls);
  focusIdx = -1;
  hlIdx = -1;
}

const LABELS = ['未操作', '涂黑', '打叉'];

function paint(i) {
  const el = cells[i];
  const v = String(game.cells[i]);
  if (el.dataset.v === v) return;
  el.dataset.v = v;
  el.setAttribute('aria-label', `第 ${Math.floor(i / game.puzzle.w) + 1} 行第 ${(i % game.puzzle.w) + 1} 列：${LABELS[v]}`);
}

// 返回这一组提示数是否全部满足
function paintClue(el, clues, line) {
  const spans = el.children;
  if (!clues.length) {
    const ok = !line.includes(FILL);
    spans[0].classList.toggle('done', ok);
    return ok;
  }
  const done = clueDone(clues, line);
  done.forEach((d, k) => spans[k].classList.toggle('done', d));
  return done.every(Boolean);
}

function paintRow(y) {
  return paintClue(rowClueEls[y], game.puzzle.rowClues[y], playerRow(game, y));
}

function paintCol(x) {
  return paintClue(colClueEls[x], game.puzzle.colClues[x], playerCol(game, x));
}

// 刷新受影响的格子和行列；flash 时为刚刚全部满足的行列播放闪亮动效和音效
function refresh(indices, flash = false) {
  const { w } = game.puzzle;
  const rows = new Set();
  const cols = new Set();
  for (const i of indices) {
    paint(i);
    rows.add(Math.floor(i / w));
    cols.add(i % w);
  }
  let lit = 0;
  for (const y of rows) {
    const before = rowClueEls[y].dataset.ok === '1';
    const ok = paintRow(y);
    rowClueEls[y].dataset.ok = ok ? '1' : '0';
    if (flash && ok && !before && game.puzzle.rowClues[y].length) {
      animate(rowClueEls[y], 'lit');
      lit++;
    }
  }
  for (const x of cols) {
    const before = colClueEls[x].dataset.ok === '1';
    const ok = paintCol(x);
    colClueEls[x].dataset.ok = ok ? '1' : '0';
    if (flash && ok && !before && game.puzzle.colClues[x].length) {
      animate(colClueEls[x], 'lit');
      lit++;
    }
  }
  drawPreview();
  return lit;
}

function renderStatus() {
  const p = game.puzzle;
  const title = $('puzzleTitle');
  if (p.id) {
    title.textContent = `No.${String(p.no).padStart(2, '0')}`;
    const small = document.createElement('small');
    small.textContent = isOver() || solvedStore.get()[p.id] ? p.name : '？？？';
    title.append(small);
  } else {
    title.textContent = '随机题';
  }
  renderTimer();
  for (const btn of document.querySelectorAll('#sizeSelect button')) {
    btn.setAttribute('aria-pressed', String(Number(btn.dataset.size) === size));
  }
  for (const btn of document.querySelectorAll('#toolSelect button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.tool === tool));
  }
  $('undoBtn').disabled = isOver() || !game.undo.length;
}

function render() {
  const { w, h } = game.puzzle;
  for (let i = 0; i < cells.length; i++) paint(i);
  for (let y = 0; y < h; y++) rowClueEls[y].dataset.ok = paintRow(y) ? '1' : '0';
  for (let x = 0; x < w; x++) colClueEls[x].dataset.ok = paintCol(x) ? '1' : '0';
  drawPreview();
  renderStatus();
}

// 左上角预览：实时显示已涂黑的图案；完成后显示彩色图案
function drawPreview() {
  const { w, h } = game.puzzle;
  const box = preview.parentElement;
  const avail = Math.min(box.clientWidth, box.clientHeight) - 8;
  const px = Math.max(1, Math.floor(avail / Math.max(w, h)));
  const dpr = window.devicePixelRatio || 1;
  preview.style.width = `${px * w}px`;
  preview.style.height = `${px * h}px`;
  preview.width = Math.round(px * w * dpr);
  preview.height = Math.round(px * h * dpr);
  const ctx = preview.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, px * w, px * h);
  const css = getComputedStyle(puzzleEl);
  ctx.fillStyle = isOver() ? css.getPropertyValue('--art') : css.getPropertyValue('--ng-fill');
  for (let i = 0; i < game.cells.length; i++) {
    if (game.cells[i] === FILL) ctx.fillRect((i % w) * px, Math.floor(i / w) * px, px, px);
  }
}

// ---------------------------------------------------------------- 尺寸
// 行提示每个数字占一格宽：一位数 sw、两位数 sw2；列提示每个数字占一格高 sh
function metrics(s) {
  const { rowClues, colClues } = game.puzzle;
  const sw = Math.max(11, Math.round(s * 0.6));
  const sw2 = Math.max(15, Math.round(s * 0.9));
  const sh = Math.max(11, Math.round(s * 0.6));
  const rowWidth = (c) => (c.length ? c.reduce((a, n) => a + (n >= 10 ? sw2 : sw), 0) : sw);
  const maxCol = Math.max(1, ...colClues.map((c) => c.length));
  return {
    sw,
    sw2,
    sh,
    rw: Math.max(...rowClues.map(rowWidth)) + CLUE_PAD + 4,
    ch: maxCol * sh + CLUE_PAD + 3,
    fs: Math.round(Math.min(18, Math.max(10, s * 0.5))),
  };
}

function canZoom() {
  return size >= ZOOM_MIN_SIZE;
}

function renderZoom() {
  zoomBtn.hidden = !canZoom();
  zoomBtn.setAttribute('aria-pressed', String(zoomed));
  zoomBtn.setAttribute('aria-label', zoomed ? '缩小到全览' : '放大');
}

// 全览：尽量塞进可视区；放大档：格子至少 ZOOM_S，超出后滚动
// anchor：屏幕坐标，缩放后让该点下的格子尽量保持不动
function layout(anchor) {
  const { w, h } = game.puzzle;
  const availW = boardWrap.clientWidth - 2 * WRAP_PAD - FRAME * 2;
  const availH = boardWrap.clientHeight - 2 * WRAP_PAD - FRAME * 2;
  let s = MAX_S;
  let m = metrics(s);
  while (s > MIN_S && (m.rw + w * s > availW || m.ch + h * s > availH)) m = metrics(--s);
  if (zoomed && canZoom()) s = Math.max(ZOOM_S, s);
  m = metrics(s);
  const old = parseFloat(puzzleEl.style.getPropertyValue('--s')) || 0;
  let keep = null;
  if (anchor && old) {
    const wr = boardWrap.getBoundingClientRect();
    const br = puzzleEl.getBoundingClientRect();
    keep = {
      px: anchor.x - wr.left,
      py: anchor.y - wr.top,
      bx: anchor.x - br.left,
      by: anchor.y - br.top,
      ratio: s / old,
    };
  }
  puzzleEl.style.setProperty('--s', `${s}px`);
  puzzleEl.style.setProperty('--sw', `${m.sw}px`);
  puzzleEl.style.setProperty('--sw2', `${m.sw2}px`);
  puzzleEl.style.setProperty('--sh', `${m.sh}px`);
  puzzleEl.style.setProperty('--rw', `${m.rw}px`);
  puzzleEl.style.setProperty('--ch', `${m.ch}px`);
  puzzleEl.style.setProperty('--fs', `${m.fs}px`);
  if (keep) {
    boardWrap.scrollLeft = puzzleEl.offsetLeft + keep.bx * keep.ratio - keep.px;
    boardWrap.scrollTop = puzzleEl.offsetTop + keep.by * keep.ratio - keep.py;
  }
  renderZoom();
  drawPreview();
}

function setZoom(on, anchor) {
  if (!canZoom()) on = false;
  if (on === zoomed) return;
  zoomed = on;
  const r = boardWrap.getBoundingClientRect();
  layout(anchor || { x: r.left + r.width / 2, y: r.top + r.height / 2 });
}

// ---------------------------------------------------------------- 存档与统计
function save() {
  if (!game) return;
  const all = { ...stateStore.get() };
  all[size] = isOver() ? null : serialize({ ...game, elapsed: elapsed() });
  stateStore.set(all);
}

// 返回是否打破了这道题已有的最佳用时
function recordSolved() {
  const p = game.puzzle;
  const t = Math.round(elapsed() / 100) / 10;
  if (!p.id) {
    const stats = statsStore.get();
    statsStore.set({ ...stats, [size]: (stats[size] || 0) + 1 });
    return false;
  }
  const solved = solvedStore.get();
  const prev = solved[p.id];
  const record = !!prev && t < prev.t;
  solved[p.id] = {
    t: prev ? Math.min(prev.t, t) : t,
    date: prev?.date || new Date().toISOString().slice(0, 10),
  };
  solvedStore.set(solved);
  return record;
}

// ---------------------------------------------------------------- 对局
function startGame(newGame) {
  clearTimeout(winTimer);
  cancelStroke();
  runningSince = null;
  game = newGame;
  $('resultModal').hidden = true;
  buildBoard();
  layout();
  render();
  boardWrap.scrollTo(0, 0);
  if (game.elapsed > 0 || hasMarks()) startClock();
  save();
}

function loadSize(n) {
  if (game) {
    stopClock();
    save();
  }
  size = n;
  sizeStore.set(n);
  if (!canZoom()) zoomed = false;
  const restored = restoreGame(stateStore.get()[n], findPuzzle);
  startGame(restored || createGame(nextPuzzle(n)));
}

// 换题前：当前题有标记且未完成时需要确认
function guardSwitch(action) {
  if (isOver() || !hasMarks()) {
    action();
    return;
  }
  ask('放弃当前进度？', '换题后，这道题已经做的标记会被清除。', action);
}

function ask(title, text, action) {
  $('confirmTitle').textContent = title;
  $('confirmText').textContent = text;
  confirmAction = action;
  $('confirmModal').hidden = false;
}

function win() {
  stopClock();
  game.status = 'won';
  const record = recordSolved();
  save();
  setHighlight(-1);
  hideFocus();
  const { w } = game.puzzle;
  for (let i = 0; i < cells.length; i++) {
    if (game.cells[i] !== FILL) continue;
    cells[i].classList.add('art');
    cells[i].style.setProperty('--d', `${((i % w) + Math.floor(i / w)) * Math.min(30, 600 / (2 * w))}ms`);
  }
  puzzleEl.classList.add('won');
  renderStatus();
  drawPreview();
  play('win', 0.1);
  vibrate([20, 40, 20]);
  winTimer = setTimeout(() => showResult(record), WIN_DELAY);
}

function showResult(record) {
  const p = game.puzzle;
  const solved = solvedStore.get();
  const bankDone = BANK[size].filter((e) => solved[e.id]).length;
  $('resultArt').innerHTML = artSvg(p, 132);
  $('resultName').textContent = p.id ? `No.${String(p.no).padStart(2, '0')} · ${p.name}` : '随机题';
  $('resultDetail').textContent = `${size}×${size} · 用时 ${fmtTime(elapsed())}`;
  $('resultRecord').hidden = !record;
  const best = p.id && solved[p.id] ? fmtTime(solved[p.id].t * 1000) : '—';
  const items = [
    [`${bankDone} / ${BANK[size].length}`, '题库进度'],
    [best, '本题最佳'],
    [String(statsStore.get()[size] || 0), '随机题完成'],
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

function afterChange(touched, flash) {
  const lit = refresh(touched, flash);
  if (lit) play('clear', 0.02, { pitch: Math.min(1.5, 1 + (lit - 1) * 0.12), volume: 0.7 });
}

function doUndo() {
  if (isOver() || stroke) return;
  const touched = undo(game);
  if (!touched) return;
  play('move');
  refresh(touched);
  for (const i of touched) animate(cells[i], 'flash');
  renderStatus();
  if (isWon(game)) win();
  else save();
}

function doRestart() {
  const run = () => {
    clearTimeout(winTimer);
    runningSince = null;
    resetGame(game);
    puzzleEl.classList.remove('won');
    for (const el of cells) el.classList.remove('art');
    render();
    save();
  };
  if (!isOver() && hasMarks()) ask('重新开始本题？', '将清除这道题的所有标记，计时归零。', run);
  else run();
}

// ---------------------------------------------------------------- 高亮
function setHighlight(i) {
  if (i === hlIdx) return;
  const { w, h } = game.puzzle;
  const toggle = (idx, on) => {
    if (idx < 0) return;
    const x = idx % w;
    const y = Math.floor(idx / w);
    for (let k = 0; k < w; k++) cells[y * w + k].classList.toggle('hl', on);
    for (let k = 0; k < h; k++) cells[k * w + x].classList.toggle('hl', on);
    rowClueEls[y].classList.toggle('hl', on);
    colClueEls[x].classList.toggle('hl', on);
  };
  toggle(hlIdx, false);
  hlIdx = i;
  toggle(hlIdx, true);
}

function hideFocus() {
  if (focusIdx >= 0) cells[focusIdx]?.classList.remove('focus');
  focusIdx = -1;
}

// ---------------------------------------------------------------- 指针输入
// 按下时按 strokeAction 决定本笔动作，拖动时沿锁定的行 / 列延伸，松手提交为一步撤销。
// 鼠标右键用另一种笔。只跟踪第一根手指。

// 拖出棋盘时投影到边界格
function cellAt(clientX, clientY) {
  const { w, h } = game.puzzle;
  const r = grid.getBoundingClientRect();
  const x = Math.min(w - 1, Math.max(0, Math.floor(((clientX - r.left) / r.width) * w)));
  const y = Math.min(h - 1, Math.max(0, Math.floor(((clientY - r.top) / r.height) * h)));
  return y * w + x;
}

function strokeSound(action, first) {
  if (first) {
    if (action.to === EMPTY) play('select');
    else if (action.to === FILL) play('place');
    else play('tap');
  } else {
    play('tap', 0, { volume: 0.45, pitch: 1.2 });
  }
}

function applyTouched(touched, first) {
  if (!touched.length) return;
  for (const i of touched) {
    if (game.cells[i] !== EMPTY) animate(cells[i], 'pop');
  }
  afterChange(touched, true);
  if (stroke.changed.size) strokeSound(stroke.action, first);
}

function cancelStroke() {
  if (!stroke) return;
  try {
    grid.releasePointerCapture(stroke.id);
  } catch {
    /* 指针已经释放 */
  }
  stroke = null;
}

grid.addEventListener('pointerdown', (e) => {
  if (anyModalOpen() || isOver() || stroke) return;
  const mouse = e.pointerType === 'mouse';
  if (mouse && e.button !== 0 && e.button !== 2) return;
  e.preventDefault();
  hideFocus();
  const i = cellAt(e.clientX, e.clientY);
  const useTool = mouse && e.button === 2 ? other(tool) : tool;
  try {
    grid.setPointerCapture(e.pointerId);
  } catch {
    /* 部分浏览器在合成事件上不支持捕获 */
  }
  stroke = beginStroke(game, i, useTool);
  stroke.id = e.pointerId;
  setHighlight(i);
  vibrate(10);
  applyTouched([...stroke.changed.keys()], true);
});

grid.addEventListener('pointermove', (e) => {
  if (!stroke || stroke.id !== e.pointerId) return;
  const i = cellAt(e.clientX, e.clientY);
  if (i === stroke.cur) return;
  const touched = extendStroke(game, stroke, i);
  setHighlight(stroke.axis ? projected(i) : i);
  applyTouched(touched, false);
});

// 高亮跟随锁定轴上的投影位置
function projected(i) {
  const { w } = game.puzzle;
  const sx = stroke.start % w;
  const sy = Math.floor(stroke.start / w);
  return stroke.axis === 'row' ? sy * w + (i % w) : Math.floor(i / w) * w + sx;
}

function endPointer(e) {
  if (!stroke || stroke.id !== e.pointerId) return;
  const s = stroke;
  cancelStroke();
  setHighlight(-1);
  if (!endStroke(game, s)) return;
  startClock();
  renderStatus();
  if (isWon(game)) win();
  else save();
}

grid.addEventListener('pointerup', endPointer);
grid.addEventListener('pointercancel', endPointer);
grid.addEventListener('lostpointercapture', endPointer);
grid.addEventListener('contextmenu', (e) => e.preventDefault());

grid.addEventListener('animationend', (e) => {
  if (e.target.classList.contains('cell')) e.target.classList.remove('pop', 'flash');
});
for (const el of [$('rowClues'), $('colClues')]) {
  el.addEventListener('animationend', (e) => e.target.closest('.lit')?.classList.remove('lit'));
}

// ---------------------------------------------------------------- 键盘
const DIRS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

function moveFocus(dx, dy) {
  const { w, h } = game.puzzle;
  let x;
  let y;
  if (focusIdx < 0) {
    x = Math.floor(w / 2);
    y = Math.floor(h / 2);
  } else {
    cells[focusIdx].classList.remove('focus');
    x = Math.min(w - 1, Math.max(0, (focusIdx % w) + dx));
    y = Math.min(h - 1, Math.max(0, Math.floor(focusIdx / w) + dy));
  }
  focusIdx = y * w + x;
  cells[focusIdx].classList.add('focus');
  setHighlight(focusIdx);
  cells[focusIdx].scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function keyStroke(useTool) {
  if (focusIdx < 0 || isOver() || stroke) return;
  const s = beginStroke(game, focusIdx, useTool);
  const touched = [...s.changed.keys()];
  if (!touched.length) return;
  for (const i of touched) if (game.cells[i] !== EMPTY) animate(cells[i], 'pop');
  afterChange(touched, true);
  strokeSound(s.action, true);
  endStroke(game, s);
  startClock();
  renderStatus();
  if (isWon(game)) win();
  else save();
}

function setTool(t) {
  tool = t;
  toolStore.set(t);
  renderStatus();
}

document.addEventListener('keydown', (e) => {
  if (anyModalOpen() || e.altKey) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if ((e.metaKey || e.ctrlKey) && key === 'z') {
    e.preventDefault();
    doUndo();
    return;
  }
  if (e.metaKey || e.ctrlKey) return;
  if (DIRS[key]) {
    e.preventDefault();
    moveFocus(...DIRS[key]);
  } else if (key === ' ' || key === 'Enter') {
    if (focusIdx < 0) return;
    e.preventDefault();
    document.activeElement?.blur?.();
    keyStroke(tool);
  } else if (key === 'f') {
    keyStroke('fill');
  } else if (key === 'x') {
    keyStroke('cross');
  } else if (key === 'u') {
    doUndo();
  } else if (key === 'Tab') {
    e.preventDefault();
    play('select');
    setTool(other(tool));
  }
});

// ---------------------------------------------------------------- 按钮
$('sizeSelect').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-size]');
  if (!btn || Number(btn.dataset.size) === size) return;
  loadSize(Number(btn.dataset.size));
});

$('toolSelect').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tool]');
  if (btn) setTool(btn.dataset.tool);
});

$('undoBtn').addEventListener('click', doUndo);
$('restartBtn').addEventListener('click', doRestart);

$('confirmOk').addEventListener('click', () => {
  $('confirmModal').hidden = true;
  const action = confirmAction;
  confirmAction = null;
  action?.();
});

$('resultNext').addEventListener('click', () => startGame(createGame(nextPuzzle(size))));
$('resultClose').addEventListener('click', () => ($('resultModal').hidden = true));
$('helpBtn').addEventListener('click', () => ($('helpModal').hidden = false));

function renderLibrary() {
  const solved = solvedStore.get();
  const list = BANK[size];
  const done = list.filter((p) => solved[p.id]).length;
  $('libraryTitle').textContent = `题库 · ${size}×${size}`;
  $('librarySub').textContent = `已完成 ${done} / ${list.length}，随机题完成 ${statsStore.get()[size] || 0} 道`;
  $('libraryList').replaceChildren(
    ...list.map((entry) => {
      const btn = document.createElement('button');
      btn.className = 'lib-card';
      btn.dataset.id = entry.id;
      btn.setAttribute('aria-current', String(game.puzzle.id === entry.id));
      const rec = solved[entry.id];
      const no = `No.${String(entry.no).padStart(2, '0')}`;
      if (rec) {
        btn.innerHTML = artSvg(bankPuzzle(entry), 56);
        const b = document.createElement('b');
        b.textContent = entry.name;
        const small = document.createElement('small');
        small.textContent = `${no} · ${fmtTime(rec.t * 1000)}`;
        btn.append(b, small);
      } else {
        const q = document.createElement('span');
        q.className = 'unknown';
        q.textContent = '?';
        const b = document.createElement('b');
        b.textContent = no;
        const small = document.createElement('small');
        small.textContent = game.puzzle.id === entry.id && hasMarks() ? '进行中' : '未完成';
        btn.append(q, b, small);
      }
      btn.setAttribute('aria-label', rec ? `${no} ${entry.name}，已完成` : `${no}，未完成`);
      return btn;
    }),
  );
}

$('libraryBtn').addEventListener('click', () => {
  renderLibrary();
  $('libraryModal').hidden = false;
});

$('libraryList').addEventListener('click', (e) => {
  const card = e.target.closest('.lib-card');
  if (!card) return;
  $('libraryModal').hidden = true;
  if (card.dataset.id === game.puzzle.id && !isOver()) return;
  guardSwitch(() => startGame(createGame(bankPuzzle(findPuzzle(card.dataset.id)))));
});

$('randomBtn').addEventListener('click', () => {
  $('libraryModal').hidden = true;
  guardSwitch(() => startGame(createGame(randomPuzzle(size))));
});

for (const id of ['helpModal', 'confirmModal', 'libraryModal']) {
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
  } else if (game.elapsed > 0 || hasMarks()) {
    startClock();
  }
});

window.addEventListener('pagehide', save);
new ResizeObserver(() => game && layout()).observe(boardWrap);
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => game && drawPreview());

// 双指捏合切换放大 / 全览（与扫雷相同：不做连续缩放）
const touches = new Map();
let pinch = null;

function startPinch() {
  const [a, b] = [...touches.values()];
  pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, done: false };
}

function movePinch() {
  if (!pinch || pinch.done || touches.size < 2 || !canZoom()) return;
  const [a, b] = [...touches.values()];
  const r = Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0;
  if (r > 1.3 || r < 0.77) {
    pinch.done = true;
    if (r > 1 !== zoomed) play('select');
    setZoom(r > 1, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
}

boardWrap.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size >= 2) {
    cancelStroke();
    if (touches.size === 2) startPinch();
  }
});
window.addEventListener('pointermove', (e) => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch) movePinch();
});
function endPinch(e) {
  touches.delete(e.pointerId);
  if (touches.size < 2) pinch = null;
}
window.addEventListener('pointerup', endPinch);
window.addEventListener('pointercancel', endPinch);
zoomBtn.addEventListener('click', () => setZoom(!zoomed));

// ---------------------------------------------------------------- 启动
loadSize(size);

if (!helpStore.get()) {
  helpStore.set(true);
  $('helpModal').hidden = false;
}
