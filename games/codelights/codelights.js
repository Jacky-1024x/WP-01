import { initPage, storage, toast } from '../../js/pwa.js';
import { play } from '../../js/sfx.js';
import {
  COLORS,
  SLOTS,
  ROWS,
  MODES,
  COLOR_COUNTS,
  DEFAULT_COLOR_COUNT,
  palette,
  createGame,
  restoreGame,
  conflictIndex,
  cycleColor,
  nextSlot,
  selectSlot,
  allLit,
  submit,
  pegs,
} from './engine.js';

initPage();

const MODE_NAMES = { simple: '简单模式', advanced: '进阶模式' };
const COLOR_NAMES = { R: '红', O: '橙', Y: '黄', C: '青', B: '蓝', P: '紫', M: '粉' };
const REVEAL_STEP = 120;

const stateStore = storage('h5.codelights.state', null);
const modeStore = storage('h5.codelights.mode', 'simple');
const colorsStore = storage('h5.codelights.colors', DEFAULT_COLOR_COUNT);
const statsStore = storage('h5.codelights.stats', {});
const helpStore = storage('h5.codelights.helpSeen', false);

const $ = (id) => document.getElementById(id);
const board = $('board');
const boardWrap = $('boardWrap');
const nextBtn = $('nextBtn');
const colorBtn = $('colorBtn');
const okBtn = $('okBtn');

let game = null;
let busy = false; // 反馈动画播放中
let reveal = null; // { row, count }：正在逐个点亮反馈的行
let confirmAction = null;

// ---------------------------------------------------------------- 棋盘 DOM（只建一次，之后只改属性）
const rowEls = [];
for (let r = 0; r < ROWS; r++) {
  const row = document.createElement('div');
  row.className = 'row';
  const num = document.createElement('span');
  num.className = 'row-num';
  num.textContent = r + 1;
  const lights = document.createElement('div');
  lights.className = 'lights';
  const slots = [];
  for (let i = 0; i < SLOTS; i++) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.dataset.slot = i;
    const light = document.createElement('div');
    light.className = 'light';
    const bar = document.createElement('div');
    bar.className = 'bar';
    slot.append(light, bar);
    lights.appendChild(slot);
    slots.push({ slot, light, bar });
  }
  const pegBox = document.createElement('div');
  pegBox.className = 'pegs';
  const pegEls = [];
  for (let i = 0; i < SLOTS; i++) pegEls.push(pegBox.appendChild(document.createElement('i')));
  row.append(num, lights, pegBox);
  board.appendChild(row);
  rowEls.push({ row, slots, pegEls });
}

const slotMarks = [];
for (let i = 0; i < SLOTS; i++) slotMarks.push($('slotMarks').appendChild(document.createElement('i')));
const DOT_COLORS = { R: '#ef4444', O: '#fb923c', Y: '#facc15', C: '#22d3ee', B: '#3b82f6', P: '#a855f7', M: '#f472b6' };
const colorMarks = COLORS.map((c) => {
  const el = $('colorMarks').appendChild(document.createElement('i'));
  el.style.setProperty('--c', DOT_COLORS[c]);
  return el;
});

// 统计按「模式 + 颜色数量」分开记；旧版统计都是 7 色
function statKey(g = game) {
  return `${g.mode}-${g.colors}`;
}

{
  const all = statsStore.get();
  if (MODES.some((m) => all[m])) {
    for (const m of MODES) {
      if (all[m] && !all[`${m}-7`]) all[`${m}-7`] = all[m];
      delete all[m];
    }
    statsStore.set(all);
  }
}

function setAttr(el, name, value) {
  if (value == null) el.removeAttribute(name);
  else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function setColor(light, color) {
  setAttr(light, 'data-color', color);
  light.setAttribute('aria-label', color ? COLOR_NAMES[color] : '熄灭');
}

function restartAnimation(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// ---------------------------------------------------------------- 渲染
function render() {
  const playing = game.status === 'playing';
  const activeRow = playing ? game.rows.length : -1;
  const warn = playing ? conflictIndex(game) : -1;
  board.dataset.mode = game.mode;

  rowEls.forEach(({ row, slots, pegEls }, r) => {
    const submitted = game.rows[r];
    row.classList.toggle('active', r === activeRow);
    row.classList.toggle('future', !submitted && r !== activeRow);
    const guess = submitted ? submitted.guess : r === activeRow ? game.current : null;
    const shown = !submitted ? 0 : reveal && reveal.row === r ? reveal.count : SLOTS;
    const pegResult = submitted ? pegs(submitted.result) : null;
    slots.forEach(({ slot, light, bar }, i) => {
      setColor(light, guess ? guess[i] : null);
      slot.classList.toggle('selected', r === activeRow && i === game.cursor);
      slot.classList.toggle('warn', r === activeRow && i === warn);
      setAttr(bar, 'data-fb', i < shown ? submitted.result[i] : null);
      setAttr(pegEls[i], 'data-fb', i < shown ? pegResult[i] : null);
    });
  });

  slotMarks.forEach((el, i) => el.classList.toggle('on', playing && i === game.cursor));
  const cur = playing ? game.current[game.cursor] : null;
  const colors = palette(game.colors);
  COLORS.forEach((c, i) => {
    colorMarks[i].hidden = !colors.includes(c);
    colorMarks[i].classList.toggle('on', c === cur);
  });
  $('helpColors').textContent = colors.length;

  nextBtn.disabled = !playing || busy;
  colorBtn.disabled = !playing || busy;
  okBtn.textContent = playing ? '确定' : '再来一局';
  okBtn.setAttribute('aria-disabled', String(playing && (!allLit(game) || busy)));

  for (const btn of document.querySelectorAll('#modeSelect button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === game.mode));
  }
  for (const btn of document.querySelectorAll('#colorSelect button')) {
    btn.setAttribute('aria-pressed', String(Number(btn.dataset.colors) === game.colors));
  }
}

// 主灯边长 S：取宽、高两个方向约束的较小值。系数必须与 codelights.css 中以 --s 计算的尺寸保持一致
const UNITS = {
  simple: { w: 6.6, h: 12.25 },
  advanced: { w: 7.5, h: 10.7 },
};

function layout() {
  const u = UNITS[game.mode];
  const w = boardWrap.clientWidth - 24 - 4;
  const h = boardWrap.clientHeight - 12 - 21;
  const s = Math.floor(Math.max(24, Math.min(w / u.w, h / u.h, 64)));
  board.style.setProperty('--s', `${s}px`);
}

// ---------------------------------------------------------------- 存档与统计
function saveState() {
  const { mode, colors, answer, rows, current, cursor, status, lastColor } = game;
  stateStore.set({ mode, colors, answer, rows: rows.map((r) => ({ guess: r.guess })), current, cursor, status, lastColor });
}

function recordResult() {
  const all = statsStore.get();
  const s = all[statKey()] || { played: 0, won: 0, best: 0, dist: Array(ROWS).fill(0) };
  s.played++;
  if (game.status === 'won') {
    const n = game.rows.length;
    s.won++;
    s.best = s.best ? Math.min(s.best, n) : n;
    s.dist[n - 1]++;
  }
  all[statKey()] = s;
  statsStore.set(all);
}

// ---------------------------------------------------------------- 对局
function newGame(mode = game?.mode ?? 'simple', colors = game?.colors ?? DEFAULT_COLOR_COUNT) {
  game = createGame(mode, Math.random, game?.lastColor, colors);
  modeStore.set(game.mode);
  colorsStore.set(game.colors);
  busy = false;
  reveal = null;
  rowEls.forEach(({ row }) => row.classList.remove('win', 'shake'));
  closeModal($('resultModal'));
  layout();
  render();
  saveState();
}

function switchGame(mode, colors) {
  board.classList.add('switching');
  setTimeout(() => {
    newGame(mode, colors);
    board.classList.remove('switching');
  }, 160);
}

// 已提交过的进行中对局，放弃前需要确认
function guardAbandon(text, action) {
  if (game.status === 'playing' && game.rows.length > 0) {
    $('confirmText').textContent = text;
    confirmAction = action;
    $('confirmModal').hidden = false;
  } else {
    action();
  }
}

function vibrate() {
  navigator.vibrate?.(10);
}

function activeSlots() {
  return rowEls[game.rows.length].slots;
}

function afterMove(res) {
  if (!res) return;
  if (res.cleared >= 0) {
    play('error');
    restartAnimation(activeSlots()[res.cleared].light, 'out');
  } else {
    play('tap');
  }
  vibrate();
  render();
  saveState();
}

function doNext() {
  if (busy || game.status !== 'playing') return;
  afterMove(nextSlot(game));
}

function doSelect(i) {
  if (busy || game.status !== 'playing') return;
  afterMove(selectSlot(game, i));
}

function doColor() {
  if (busy || game.status !== 'playing') return;
  cycleColor(game);
  play('select');
  vibrate();
  restartAnimation(activeSlots()[game.cursor].light, 'pop');
  render();
  saveState();
}

function doSubmit() {
  if (busy) return;
  if (game.status !== 'playing') {
    newGame();
    return;
  }
  const rowIndex = game.rows.length;
  const res = submit(game);
  if (!res.ok) {
    play('error');
    if (res.cleared >= 0) restartAnimation(rowEls[rowIndex].slots[res.cleared].light, 'out');
    restartAnimation(rowEls[rowIndex].row, 'shake');
    toast(res.cleared >= 0 ? `第 ${res.cleared + 1} 盏颜色重复，已熄灭` : '还有灯没点亮');
    render();
    saveState();
    return;
  }

  // 确认即生效：先存档再播放反馈动画，刷新也无法回到确认前
  saveState();
  if (game.status !== 'playing') recordResult();
  busy = true;
  reveal = { row: rowIndex, count: 0 };
  play('place');
  render();
  for (let k = 1; k <= SLOTS; k++) {
    setTimeout(() => {
      reveal.count = k;
      play('tap');
      render();
    }, k * REVEAL_STEP);
  }
  setTimeout(() => {
    busy = false;
    reveal = null;
    render();
    if (game.status === 'won') {
      rowEls[rowIndex].row.classList.add('win');
      play('win');
      setTimeout(showResult, 700);
    } else if (game.status === 'lost') {
      play('lose');
      setTimeout(showResult, 400);
    }
  }, (SLOTS + 1) * REVEAL_STEP);
}

// ---------------------------------------------------------------- 弹窗
function showResult() {
  const won = game.status === 'won';
  $('resultTitle').textContent = won ? '破解成功！' : '机会用完了';
  $('resultDetail').textContent = won ? `用了 ${game.rows.length} 次` : '正确答案是';
  const answer = $('resultAnswer');
  answer.innerHTML = '';
  game.answer.forEach((c, i) => {
    const light = document.createElement('div');
    light.className = 'light';
    setColor(light, c);
    light.style.animationDelay = `${i * 0.12}s`;
    answer.appendChild(light);
  });
  const s = statsStore.get()[statKey()];
  const parts = [`${MODE_NAMES[game.mode]} · ${game.colors} 色`];
  if (s) {
    parts.push(`已胜 ${s.won} 局 / 共 ${s.played} 局`);
    if (s.best) parts.push(`最佳 ${s.best} 次`);
  }
  $('resultStats').textContent = parts.join(' · ');
  $('resultModal').hidden = false;
}

function closeModal(el) {
  el.hidden = true;
}

function anyModalOpen() {
  return [...document.querySelectorAll('.modal')].some((m) => !m.hidden);
}

// ---------------------------------------------------------------- 事件
nextBtn.addEventListener('click', doNext);
colorBtn.addEventListener('click', doColor);
okBtn.addEventListener('click', doSubmit);

board.addEventListener('click', (e) => {
  const slot = e.target.closest('.row.active .slot');
  if (slot) doSelect(Number(slot.dataset.slot));
});

$('modeSelect').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-mode]');
  if (!btn || btn.dataset.mode === game.mode || busy) return;
  const mode = btn.dataset.mode;
  guardAbandon('切换模式将放弃本局，确定吗？', () => switchGame(mode, game.colors));
});

$('colorSelect').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-colors]');
  const colors = Number(btn?.dataset.colors);
  if (!btn || colors === game.colors || busy) return;
  guardAbandon('切换颜色数量将放弃本局，确定吗？', () => switchGame(game.mode, colors));
});

$('restartBtn').addEventListener('click', () => {
  if (busy) return;
  guardAbandon('重新开始将放弃本局，确定吗？', () => newGame());
});

$('confirmOk').addEventListener('click', () => {
  $('confirmModal').hidden = true;
  const action = confirmAction;
  confirmAction = null;
  action?.();
});

$('resultAgain').addEventListener('click', () => newGame());
$('resultClose').addEventListener('click', () => closeModal($('resultModal')));
$('helpBtn').addEventListener('click', () => ($('helpModal').hidden = false));

for (const id of ['helpModal', 'confirmModal']) {
  $(id).addEventListener('click', (e) => {
    if (e.target === e.currentTarget || e.target.closest('[data-close]')) e.currentTarget.hidden = true;
  });
}

document.addEventListener('keydown', (e) => {
  if (anyModalOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'ArrowRight' || e.key === 'Tab') {
    e.preventDefault();
    doNext();
  } else if (e.key === 'ArrowUp' || e.key === ' ') {
    e.preventDefault();
    doColor();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    doSubmit();
  } else if (/^[1-4]$/.test(e.key)) {
    doSelect(Number(e.key) - 1);
  }
});

window.addEventListener('pagehide', () => game && saveState());
new ResizeObserver(() => game && layout()).observe(boardWrap);

// ---------------------------------------------------------------- 启动
const saved = restoreGame(stateStore.get());
if (saved) {
  game = saved;
  layout();
  render();
  if (game.status !== 'playing') showResult();
} else {
  const colors = colorsStore.get();
  newGame(
    MODES.includes(modeStore.get()) ? modeStore.get() : 'simple',
    COLOR_COUNTS.includes(colors) ? colors : DEFAULT_COLOR_COUNT,
  );
}

if (!helpStore.get()) {
  helpStore.set(true);
  $('helpModal').hidden = false;
}
