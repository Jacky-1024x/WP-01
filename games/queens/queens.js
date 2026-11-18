import { initPage, storage, toast } from '../../js/pwa.js';
import { play, isMuted } from '../../js/sfx.js';
import {
  EMPTY,
  CROSS,
  QUEEN,
  SIZES,
  rowOf,
  colOf,
  check,
  autoCrosses,
  isSolved,
  createGame,
  restoreGame,
  setMarks,
  undo,
  nextCycle,
} from './board.js';
import { nextStep } from './solver.js';
import { generate } from './generator.js';

initPage();

const DOUBLE_TAP_MS = 350;
const LOADING_DELAY = 300;
const COLOR_NAMES = ['橙色', '蓝色', '绿色', '黄色', '紫色', '粉色', '青色', '灰色', '白色', '棕色'];
const TECH_NAMES = {
  attack: '皇后排除',
  single: '唯一位置',
  confine: '区块排除',
  predict: '预判排除',
  subset: '组合排除',
  reveal: '直接揭晓',
};

const stateStore = storage('h5.queens.state', null);
const sizeStore = storage('h5.queens.size', 7);
const settingsStore = storage('h5.queens.settings', {});
const statsStore = storage('h5.queens.stats', {});
const helpStore = storage('h5.queens.helpSeen', false);

const $ = (id) => document.getElementById(id);
const board = $('board');
const boardBox = $('boardBox');
const boardWrap = $('boardWrap');

const settings = { autoX: true, conflicts: true, showTimer: true, ...settingsStore.get() };

let game = null;
let cells = [];
let runningSince = null;
let paused = false;
let loading = false;
let lastBad = new Set();
let focusIdx = -1;
let hint = null; // { step, cells, area, fix }
let confirmAction = null;
let lastTap = null; // { i, t } 用于识别双击
let busyUntil = 0;

const busy = () => performance.now() < busyUntil || loading || paused;
const anyModalOpen = () => [...document.querySelectorAll('.modal')].some((m) => !m.hidden);

function vibrate(pattern) {
  if (!isMuted()) navigator.vibrate?.(pattern);
}

function animate(el, cls, delay = 0) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.style.setProperty('--d', `${Math.round(delay)}ms`);
  el.classList.add(cls);
}

// ---------------------------------------------------------------- 出题
let worker = null;
let workerSeq = 0;
const pending = new Map();

function makeWorker() {
  try {
    const w = new Worker(new URL('worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const cb = pending.get(e.data.id);
      pending.delete(e.data.id);
      cb?.resolve(e.data.puzzle);
    };
    w.onerror = (e) => {
      e.preventDefault?.();
      worker = false;
      for (const cb of pending.values()) cb.fallback();
      pending.clear();
    };
    return w;
  } catch {
    return false;
  }
}

function requestPuzzle(n) {
  if (worker === null) worker = makeWorker();
  if (!worker) return Promise.resolve(generate(n));
  return new Promise((resolve) => {
    const id = ++workerSeq;
    pending.set(id, { resolve, fallback: () => resolve(generate(n)) });
    worker.postMessage({ id, n });
  });
}

// ---------------------------------------------------------------- 计时
function elapsed() {
  return game.elapsed + (runningSince !== null ? performance.now() - runningSince : 0);
}

function shouldRun() {
  return game && game.status === 'playing' && !paused && !loading && !document.hidden && !anyModalOpen();
}

function syncClock() {
  if (!game) return;
  if (shouldRun()) {
    if (runningSince === null) runningSince = performance.now();
  } else if (runningSince !== null) {
    game.elapsed += performance.now() - runningSince;
    runningSince = null;
  }
  renderTimer();
}

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function renderTimer() {
  if (!game) return;
  $('timer').textContent = fmtTime(elapsed());
  $('timer').classList.toggle('hidden-time', !settings.showTimer);
}

// ---------------------------------------------------------------- 棋盘 DOM
function buildBoard() {
  const { n, regions } = game;
  const frag = document.createDocumentFragment();
  cells = [];
  for (let i = 0; i < n * n; i++) {
    const el = document.createElement('div');
    const r = rowOf(n, i);
    const c = colOf(n, i);
    const g = regions[i];
    el.className = 'cell';
    if (r > 0 && regions[i - n] !== g) el.classList.add('et');
    if (r < n - 1 && regions[i + n] !== g) el.classList.add('eb');
    if (c > 0 && regions[i - 1] !== g) el.classList.add('el');
    if (c < n - 1 && regions[i + 1] !== g) el.classList.add('er');
    el.dataset.i = i;
    el.dataset.c = game.colors[g];
    el.setAttribute('role', 'gridcell');
    cells.push(frag.appendChild(el));
  }
  board.replaceChildren(frag);
  board.style.setProperty('--n', n);
  board.classList.remove('won');
  focusIdx = -1;
  layout();
}

const QUEEN_SVG = '<svg class="q" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-queen"/></svg>';
const CROSS_SVG = '<svg class="x" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-cross"/></svg>';

function render() {
  const { n, regions, marks } = game;
  const res = check(n, regions, marks);
  const auto = settings.autoX ? autoCrosses(n, regions, marks) : new Set();
  const dead = new Set(settings.conflicts ? res.dead.flatMap((u) => u.cells) : []);
  const bad = settings.conflicts ? res.bad : new Set();
  const area = new Set(hint?.area || []);
  const target = new Set(hint?.cells || []);
  for (let i = 0; i < n * n; i++) {
    const el = cells[i];
    const m = marks[i];
    const s = m === QUEEN ? 'q' : m === CROSS ? 'x' : auto.has(i) ? 'a' : 'e';
    if (el.dataset.s !== s) {
      el.dataset.s = s;
      el.innerHTML = s === 'q' ? QUEEN_SVG : s === 'x' ? CROSS_SVG : s === 'a' ? '<i class="dot"></i>' : '';
      const where = `第 ${rowOf(n, i) + 1} 行第 ${colOf(n, i) + 1} 列`;
      el.setAttribute('aria-label', `${where}，${s === 'q' ? '皇后' : s === 'x' ? '叉' : '空'}`);
    }
    el.classList.toggle('bad', bad.has(i));
    el.classList.toggle('dead', dead.has(i) && m !== QUEEN);
    el.classList.toggle('hint-area', area.has(i));
    el.classList.toggle('hint-target', target.has(i));
    el.classList.toggle('focus', i === focusIdx);
  }
  board.classList.toggle('hinting', area.size > 0);
  $('queenNum').textContent = `${res.queens} / ${n}`;
  for (const btn of document.querySelectorAll('#sizeSelect button')) {
    btn.setAttribute('aria-pressed', String(Number(btn.dataset.size) === n));
  }
  $('autoBtn').setAttribute('aria-pressed', String(settings.autoX));
  $('autoBadge').textContent = settings.autoX ? '开' : '关';
  $('autoBadge').classList.toggle('on', settings.autoX);
  $('undoBtn').setAttribute('aria-disabled', String(!game.undo.length || game.status !== 'playing'));
  $('hintBtn').setAttribute('aria-disabled', String(game.status !== 'playing'));
  $('pauseBtn').classList.toggle('paused', paused);
  $('pauseCover').hidden = !paused;
  renderTimer();
  return res;
}

function layout() {
  const w = boardWrap.clientWidth - 24;
  const h = boardWrap.clientHeight - 8;
  const b = Math.max(200, Math.floor(Math.min(w, h, 520)));
  boardBox.style.setProperty('--b', `${b}px`);
}

// ---------------------------------------------------------------- 存档与统计
function save() {
  if (!game) return;
  if (game.status !== 'playing') stateStore.set(null);
  else stateStore.set({ ...game, elapsed: elapsed() });
}

function recordWin() {
  const all = statsStore.get();
  const s = { done: 0, sum: 0, best: null, clean: 0, ...all[game.n] };
  const t = Math.round(elapsed() / 100) / 10;
  const prevBest = s.best;
  let record = false;
  s.done++;
  s.sum += t;
  if (!game.hints) {
    s.clean++;
    if (s.best === null || t < s.best) {
      record = s.best !== null;
      s.best = t;
    }
  }
  all[game.n] = s;
  statsStore.set(all);
  return { record, prevBest, best: s.best, t };
}

// ---------------------------------------------------------------- 对局
// 调色板按区分度排序，小棋盘只用前 n 种最好区分的颜色，再随机分配给各区域
function shuffledColors(n, rng = Math.random) {
  const a = [...Array(n).keys()];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function newGame(n = game?.n ?? 7) {
  closeHint(false);
  $('resultModal').hidden = true;
  sizeStore.set(n);
  loading = true;
  if (game) syncClock();
  const timer = setTimeout(() => ($('loadingCover').hidden = false), LOADING_DELAY);
  const puzzle = await requestPuzzle(n);
  clearTimeout(timer);
  $('loadingCover').hidden = true;
  loading = false;
  paused = false;
  runningSince = null;
  game = { ...createGame(puzzle), colors: shuffledColors(puzzle.n) };
  lastBad = new Set();
  lastTap = null;
  buildBoard();
  render();
  save();
  syncClock();
}

const hasProgress = () => game && game.status === 'playing' && game.marks.some((m) => m !== EMPTY);

function confirm(title, text, action) {
  $('confirmTitle').textContent = title;
  $('confirmText').textContent = text;
  confirmAction = action;
  $('confirmModal').hidden = false;
  syncClock();
}

function guardAbandon(text, action) {
  if (!hasProgress()) action();
  else confirm('放弃本局？', text, action);
}

// 修改盘面后的统一处理：重绘、音效、冲突抖动、通关
function afterChange(changes, { sound = true } = {}) {
  if (!changes.length) return;
  if (hint) closeHint(false);
  const res = render();
  const last = changes[changes.length - 1];
  if (sound) play(last[2] === QUEEN ? 'place' : last[2] === CROSS ? 'tap' : 'select');
  if (last[2] === QUEEN) animate(cells[last[0]], 'pop');
  const fresh = [...res.bad].filter((i) => !lastBad.has(i));
  if (settings.conflicts && fresh.length && last[2] === QUEEN) {
    for (const i of fresh) animate(cells[i], 'shake');
    play('error', 0.06);
    vibrate(20);
  }
  lastBad = res.bad;
  if (isSolved(game.n, game.regions, game.marks)) win();
  else {
    if (res.queens === game.n && !settings.conflicts) toast('还有冲突');
    save();
  }
}

function tap(i) {
  const now = performance.now();
  if (lastTap && lastTap.i === i && now - lastTap.t < DOUBLE_TAP_MS) {
    // 双击：并入第一下，直接放皇后
    lastTap = null;
    const changes = setMarks(game, [[i, QUEEN]], true);
    afterChange(changes);
    return;
  }
  lastTap = { i, t: now };
  afterChange(setMarks(game, [[i, nextCycle(game.marks[i])]]));
}

function setCell(i, v) {
  lastTap = null;
  afterChange(setMarks(game, [[i, game.marks[i] === v ? EMPTY : v]]));
}

function doUndo() {
  if (!game || game.status !== 'playing' || busy()) return;
  const changes = undo(game);
  if (!changes) {
    play('error');
    return;
  }
  lastTap = null;
  play('move');
  closeHint(false);
  lastBad = render().bad;
  save();
}

function win() {
  game.status = 'won';
  syncClock();
  const result = recordWin();
  save();
  render();
  board.classList.add('won');
  game.marks.forEach((m, i) => m === QUEEN && animate(cells[i], 'win', rowOf(game.n, i) * 70));
  play('win', 0.1);
  vibrate([30, 40, 60]);
  busyUntil = performance.now() + 900;
  setTimeout(() => showResult(result), 900);
}

function showResult({ record, prevBest, best, t }) {
  const tags = [];
  if (record) tags.push('<span class="gold">新纪录</span>');
  if (!game.hints) tags.push('<span>无提示</span>');
  $('resultTags').innerHTML = tags.join('');
  const rows = [
    ['尺寸', `${game.n} × ${game.n}`],
    ['用时', fmtTime(t * 1000)],
    ['最佳用时', best === null ? '—' : fmtTime(best * 1000) + (record ? `（原 ${fmtTime(prevBest * 1000)}）` : '')],
    ['提示', `${game.hints} 次`],
  ];
  $('resultRows').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('resultModal').hidden = false;
}

// ---------------------------------------------------------------- 提示
function unitName(u) {
  if (u.kind === 'row') return `第 ${u.idx + 1} 行`;
  if (u.kind === 'col') return `第 ${u.idx + 1} 列`;
  return `${COLOR_NAMES[game.colors[u.idx]]}区域`;
}

function unitsName(list) {
  const kind = list[0].kind;
  if (kind === 'region') return list.map((u) => COLOR_NAMES[game.colors[u.idx]]).join('、') + '区域';
  return `第 ${list.map((u) => u.idx + 1).join('、')} ${kind === 'row' ? '行' : '列'}`;
}

function unitCells(u) {
  const { n, regions } = game;
  const out = [];
  for (let i = 0; i < n * n; i++) {
    if (
      (u.kind === 'row' && rowOf(n, i) === u.idx) ||
      (u.kind === 'col' && colOf(n, i) === u.idx) ||
      (u.kind === 'region' && regions[i] === u.idx)
    ) {
      out.push(i);
    }
  }
  return out;
}

function describe(step) {
  const KIND = { row: '行', col: '列', region: '区域' };
  switch (step.tech) {
    case 'attack':
      return '已放的皇后会攻击同行、同列、同色区域和周围 8 格，黄框里的格子都不能再放，可以先打上叉。';
    case 'single':
      return `${unitName(step.units[0])}只剩下一个格子能放皇后。`;
    case 'confine': {
      const t = unitsName(step.targets);
      return `${unitName(step.units[0])}的可放位置都在${t}，所以${t}的其他格子都不能放。`;
    }
    case 'predict':
      return `如果在黄框这一格放皇后，${unitName(step.units[0])}就没有位置可放了，所以这一格不能放。`;
    case 'subset': {
      const m = step.units.length;
      return `${unitsName(step.units)}这 ${m} 个${KIND[step.units[0].kind]}的可放位置都落在${unitsName(step.targets)}，所以这些${KIND[step.targets[0].kind]}里的其他格子都不能放。`;
    }
    default:
      return '这一步比较难，直接告诉你：黄框这一格放皇后。';
  }
}

function showHint() {
  if (!game || game.status !== 'playing' || busy()) return;
  const { n, regions, marks, solution } = game;
  game.hints++;
  const answer = new Set(solution);
  const wrongQueens = [];
  const wrongCrosses = [];
  for (let i = 0; i < n * n; i++) {
    if (marks[i] === QUEEN && !answer.has(i)) wrongQueens.push(i);
    if (marks[i] === CROSS && answer.has(i)) wrongCrosses.push(i);
  }
  if (wrongQueens.length || wrongCrosses.length) {
    const parts = [];
    if (wrongQueens.length) parts.push(`有 ${wrongQueens.length} 个皇后的位置不对`);
    if (wrongCrosses.length) parts.push(`有 ${wrongCrosses.length} 个叉打在了皇后该在的位置`);
    hint = {
      fix: true,
      cells: [...wrongQueens, ...wrongCrosses],
      area: [],
      apply: [...wrongQueens, ...wrongCrosses].map((i) => [i, EMPTY]),
      title: '发现错误',
      text: `${parts.join('，')}（黄框标出）。先改正它们，再继续推理。`,
      button: '帮我移除',
    };
  } else {
    let step = nextStep(n, regions, marks, { explicitAttack: !settings.autoX });
    if (!step || step.contradiction) {
      const missing = solution.find((i) => marks[i] !== QUEEN);
      step = { tech: 'reveal', place: missing, units: [] };
    }
    const area = new Set();
    for (const u of [...(step.units || []), ...(step.targets || [])]) for (const i of unitCells(u)) area.add(i);
    const target = step.place !== undefined ? [step.place] : step.cross;
    hint = {
      fix: false,
      cells: target,
      area: [...area],
      apply: step.place !== undefined ? [[step.place, QUEEN]] : step.cross.map((i) => [i, CROSS]),
      title: `提示 · ${TECH_NAMES[step.tech]}`,
      text: describe(step),
      button: step.place !== undefined ? '帮我放上' : '帮我标上',
    };
  }
  play('select');
  $('hintPanel').classList.toggle('fix', hint.fix);
  $('hintTitle').textContent = hint.title;
  $('hintText').textContent = hint.text;
  $('hintApply').textContent = hint.button;
  $('hintPanel').hidden = false;
  $('dock').classList.add('hinting');
  render();
  save();
}

function closeHint(rerender = true) {
  if (!hint) return;
  hint = null;
  $('hintPanel').hidden = true;
  $('dock').classList.remove('hinting');
  if (rerender && game) render();
}

function applyHint() {
  if (!hint || busy()) return;
  const list = hint.apply;
  closeHint(false);
  lastTap = null;
  afterChange(setMarks(game, list));
}

// ---------------------------------------------------------------- 指针输入
// 轻点：循环 空 → 叉 → 皇后；双击：直接放皇后；按住拖到别的格子：连续打叉（从叉开始则连续擦除）
let press = null;

function cellAt(x, y) {
  const el = document.elementFromPoint(x, y)?.closest?.('.cell');
  return el && board.contains(el) ? Number(el.dataset.i) : -1;
}

function dragApply(i) {
  if (i < 0 || press.done.has(i)) return;
  press.done.add(i);
  const m = game.marks[i];
  let v = null;
  if (press.mode === 'cross' && m === EMPTY) v = CROSS;
  else if (press.mode === 'erase' && m === CROSS) v = EMPTY;
  if (v === null) return;
  const changes = setMarks(game, [[i, v]], press.merged);
  if (!changes.length) return;
  if (!press.merged) play(v === CROSS ? 'tap' : 'select');
  press.merged = true;
  if (hint) closeHint(false);
  lastBad = render().bad;
}

board.addEventListener('pointerdown', (e) => {
  if (press || anyModalOpen() || !game || game.status !== 'playing' || busy()) return;
  const el = e.target.closest('.cell');
  if (!el) return;
  const i = Number(el.dataset.i);
  if (focusIdx >= 0) {
    focusIdx = -1;
    render();
  }
  if (e.pointerType === 'mouse' && e.button === 2) {
    setCell(i, QUEEN);
    return;
  }
  if (e.button !== 0) return;
  e.preventDefault();
  press = { id: e.pointerId, start: i, last: i, mode: null, done: new Set(), merged: false };
});

window.addEventListener('pointermove', (e) => {
  if (!press || press.id !== e.pointerId) return;
  const i = cellAt(e.clientX, e.clientY);
  if (i === press.last) return;
  press.last = i;
  if (!press.mode) {
    if (i < 0) return;
    press.mode = game.marks[press.start] === CROSS ? 'erase' : 'cross';
    lastTap = null;
    dragApply(press.start);
  }
  dragApply(i);
});

function endPress(e, cancelled) {
  if (!press || press.id !== e.pointerId) return;
  const p = press;
  press = null;
  if (p.mode) {
    if (p.merged) save();
    return;
  }
  if (!cancelled && game.status === 'playing') tap(p.start);
}

window.addEventListener('pointerup', (e) => endPress(e, false));
window.addEventListener('pointercancel', (e) => endPress(e, true));
board.addEventListener('contextmenu', (e) => e.preventDefault());

board.addEventListener('animationend', (e) => {
  const el = e.target.closest?.('.cell');
  el?.classList.remove('pop', 'shake', 'win');
});

// ---------------------------------------------------------------- 键盘
const DIRS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

function moveFocus(dx, dy) {
  const { n } = game;
  if (focusIdx < 0) focusIdx = Math.floor(n / 2) * n + Math.floor(n / 2);
  else {
    const r = Math.min(n - 1, Math.max(0, rowOf(n, focusIdx) + dy));
    const c = Math.min(n - 1, Math.max(0, colOf(n, focusIdx) + dx));
    focusIdx = r * n + c;
  }
  render();
}

document.addEventListener('keydown', (e) => {
  if (!game || anyModalOpen()) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    doUndo();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === 'p') {
    togglePause();
    return;
  }
  if (game.status !== 'playing' || busy()) return;
  if (DIRS[key]) {
    e.preventDefault();
    moveFocus(...DIRS[key]);
  } else if (key === 'h') {
    showHint();
  } else if (focusIdx >= 0) {
    if (key === ' ' || key === 'Enter') {
      e.preventDefault();
      document.activeElement?.blur?.();
      lastTap = null;
      afterChange(setMarks(game, [[focusIdx, nextCycle(game.marks[focusIdx])]]));
    } else if (key === 'q') setCell(focusIdx, QUEEN);
    else if (key === 'x') setCell(focusIdx, CROSS);
    else if (key === 'Backspace' || key === 'Delete') afterChange(setMarks(game, [[focusIdx, EMPTY]]));
  }
});

// ---------------------------------------------------------------- 按钮与弹窗
function togglePause() {
  if (!game || game.status !== 'playing' || loading) return;
  paused = !paused;
  if (paused) closeHint(false);
  syncClock();
  render();
  save();
}

$('pauseBtn').addEventListener('click', togglePause);
$('pauseCover').addEventListener('click', togglePause);

$('newBtn').addEventListener('click', () => guardAbandon('开始新游戏将放弃当前进度。', () => newGame()));

$('sizeSelect').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-size]');
  if (!btn || loading) return;
  const n = Number(btn.dataset.size);
  if (n === game?.n && game.status === 'playing') return;
  guardAbandon(`切换到 ${n} × ${n} 将放弃当前进度。`, () => newGame(n));
});

$('undoBtn').addEventListener('click', doUndo);
$('hintBtn').addEventListener('click', showHint);
$('hintClose').addEventListener('click', () => closeHint());
$('hintApply').addEventListener('click', applyHint);

$('clearBtn').addEventListener('click', () => {
  if (!game || game.status !== 'playing' || busy()) return;
  if (!game.marks.some((m) => m !== EMPTY)) return;
  confirm('清空棋盘？', '清除所有皇后和叉，可以撤销。', () => {
    lastTap = null;
    afterChange(
      setMarks(
        game,
        game.marks.map((_, i) => [i, EMPTY]),
      ),
      { sound: false },
    );
    play('move');
  });
});

function setSetting(key, value) {
  settings[key] = value;
  settingsStore.set(settings);
  renderSettings();
  if (game) lastBad = render().bad;
}

$('autoBtn').addEventListener('click', () => setSetting('autoX', !settings.autoX));

const SWITCHES = [
  ['autoX', '自动打叉', '皇后攻击范围内的空格显示小圆点'],
  ['conflicts', '冲突高亮', '冲突的皇后、已放不下的行列区域标出红色斜纹'],
  ['showTimer', '显示计时', '关闭后仍在后台计时'],
];

function renderSettings() {
  $('switchList').replaceChildren(
    ...SWITCHES.map(([key, label, desc]) => {
      const btn = document.createElement('button');
      btn.className = 'switch-row';
      btn.setAttribute('aria-pressed', String(!!settings[key]));
      btn.innerHTML = `<span>${label}<small>${desc}</small></span><i class="sw"></i>`;
      btn.addEventListener('click', () => setSetting(key, !settings[key]));
      return btn;
    }),
  );
}

function openModal(id) {
  $(id).hidden = false;
  syncClock();
}

$('settingsBtn').addEventListener('click', () => {
  renderSettings();
  openModal('settingsModal');
});
$('helpBtn').addEventListener('click', () => openModal('helpModal'));

$('statsBtn').addEventListener('click', () => {
  const all = statsStore.get();
  const head = ['', '完成', '最佳', '平均', '无提示'].map((t) => `<div class="th">${t}</div>`).join('');
  const rows = SIZES.map((n) => {
    const s = all[n] || { done: 0, sum: 0, best: null, clean: 0 };
    const avg = s.done ? fmtTime((s.sum / s.done) * 1000) : '—';
    const best = s.best === null ? '—' : fmtTime(s.best * 1000);
    return `<div class="rh">${n}×${n}</div><div>${s.done}</div><div>${best}</div><div>${avg}</div><div>${s.clean}</div>`;
  }).join('');
  $('statsTable').innerHTML = head + rows;
  $('settingsModal').hidden = true;
  openModal('statsModal');
});

$('resetBtn').addEventListener('click', () => {
  if (!game || game.status !== 'playing') return;
  $('settingsModal').hidden = true;
  confirm('重做本题？', '清空所有标记，计时和提示次数归零。', () => {
    game.marks.fill(EMPTY);
    game.undo = [];
    game.elapsed = 0;
    game.hints = 0;
    runningSince = null;
    lastTap = null;
    closeHint(false);
    lastBad = render().bad;
    save();
    syncClock();
  });
});

$('confirmOk').addEventListener('click', () => {
  $('confirmModal').hidden = true;
  const action = confirmAction;
  confirmAction = null;
  action?.();
  syncClock();
});

$('resultAgain').addEventListener('click', () => newGame());
$('resultClose').addEventListener('click', () => ($('resultModal').hidden = true));

for (const id of ['helpModal', 'confirmModal', 'settingsModal', 'statsModal']) {
  $(id).addEventListener('click', (e) => {
    if (e.target === e.currentTarget || e.target.closest('[data-close]')) {
      e.currentTarget.hidden = true;
      syncClock();
    }
  });
}

// ---------------------------------------------------------------- 生命周期
setInterval(() => runningSince !== null && renderTimer(), 250);

document.addEventListener('visibilitychange', () => {
  syncClock();
  if (document.hidden) save();
});

window.addEventListener('pagehide', save);
new ResizeObserver(() => game && layout()).observe(boardWrap);

// ---------------------------------------------------------------- 启动
const saved = restoreGame(stateStore.get());
if (saved && Array.isArray(saved.colors) && saved.colors.length === saved.n) {
  game = saved;
  buildBoard();
  lastBad = render().bad;
  syncClock();
} else {
  const n = Number(sizeStore.get());
  newGame(SIZES.includes(n) ? n : 7);
}

if (!helpStore.get()) {
  helpStore.set(true);
  openModal('helpModal');
}
