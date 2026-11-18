import { initPage, storage, toast } from '../../js/pwa.js';
import { play } from '../../js/sfx.js';
import { DIFFICULTIES, DIFF_IDS } from './levels.js';
import { BANK } from './puzzles.js';
import { digitsOf, bit } from './solver.js';
import * as B from './board.js';

initPage();

const stateStore = storage('h5.kakuro.state', null);
const settingsStore = storage('h5.kakuro.settings', {});
const statsStore = storage('h5.kakuro.stats', {});
const diffStore = storage('h5.kakuro.diff', 'easy');
const seenStore = storage('h5.kakuro.seen', {});
const helpStore = storage('h5.kakuro.helpSeen', false);

const DEFAULT_SETTINGS = { check: 'instant', hlRuns: true, showCombos: true, autoClear: true, showTimer: true };
const SWITCHES = [
  ['hlRuns', '高亮所在横段 / 竖段'],
  ['showCombos', '显示组合提示'],
  ['autoClear', '填数后自动清除笔记'],
  ['showTimer', '显示计时'],
];
const CHECK_DESC = {
  instant: '填入后立即和答案比对，填错标红并计入错误次数。',
  conflict: '只在同段数字重复、或段的和不符时标红，不计错误次数。',
};
const MAX_COMBOS = 4;
const COMBO_BUDGET = 22; // 组合栏一行大约能放下的字符数（不含“等 N 种”）
const ZOOM_S = 40; // 放大档目标格子边长（与扫雷一致）
const ZOOM_MIN_SIZE = 10; // 困难 / 专家才需要放大
let settings = { ...DEFAULT_SETTINGS, ...settingsStore.get() };

const $ = (id) => document.getElementById(id);
const boardEl = $('board');
const boardWrap = $('boardWrap');
const padEl = $('pad');
const hintPanel = $('hintPanel');
const zoomBtn = $('zoomBtn');

let game = null;
let sel = -1;
let notesMode = false;
let paused = false;
let winning = false;
let hint = null; // { h, step, view }
let menuDiff = DIFF_IDS.includes(diffStore.get()) ? diffStore.get() : 'easy';
let confirmAction = null;
let clockStart = 0;
let zoomed = false;

const strict = () => settings.check === 'instant';
const cellName = (i) => `第 ${Math.floor(i / game.size) + 1} 行第 ${(i % game.size) + 1} 列`;
const runLabel = (k) => {
  const run = B.structureOf(game).runs[k];
  return `${run.dir === 'a' ? '横段' : '竖段'}「和 ${run.sum} / ${run.cells.length} 格」`;
};
const comboText = (m) => digitsOf(m).join('+');

function fmt(ms) {
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

function restartAnimation(el, cls, delay = 0) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.style.animationDelay = delay ? `${delay}s` : '';
  el.classList.add(cls);
}

function vibrate(ms = 10) {
  navigator.vibrate?.(ms);
}

// ---------------------------------------------------------------- 棋盘 DOM（每局按尺寸重建）
let cells = [];
let clueEls = []; // clueEls[runIndex] = 提示数元素

function buildBoard() {
  const st = B.structureOf(game);
  const n = game.size;
  boardEl.style.setProperty('--n', n);
  boardEl.textContent = '';
  cells = new Array(n * n);
  clueEls = new Array(st.runs.length);
  const clueOf = new Map();
  st.runs.forEach((run, k) => {
    const c = clueOf.get(run.clue) || {};
    c[run.dir] = k;
    clueOf.set(run.clue, c);
  });
  for (let i = 0; i < n * n; i++) {
    const el = boardEl.appendChild(document.createElement('div'));
    el.dataset.i = i;
    if (!B.isWhite(game, i)) {
      el.className = 'blk';
      const c = clueOf.get(i);
      if (c) {
        el.classList.add('clue');
        for (const [dir, cls] of [['a', 'ca'], ['d', 'cd']]) {
          if (c[dir] == null) continue;
          const b = el.appendChild(document.createElement('b'));
          b.className = cls;
          b.textContent = st.runs[c[dir]].sum;
          clueEls[c[dir]] = b;
        }
        const parts = [c.a != null && `横段和 ${st.runs[c.a].sum}`, c.d != null && `竖段和 ${st.runs[c.d].sum}`].filter(Boolean);
        el.setAttribute('aria-label', parts.join('，'));
      }
      cells[i] = { el, blk: true };
      continue;
    }
    el.className = 'cell';
    el.setAttribute('role', 'gridcell');
    const v = el.appendChild(document.createElement('span'));
    v.className = 'v';
    const notes = el.appendChild(document.createElement('div'));
    notes.className = 'notes';
    const marks = [];
    for (let d = 1; d <= 9; d++) {
      const m = notes.appendChild(document.createElement('i'));
      m.textContent = d;
      marks.push(m);
    }
    cells[i] = { el, v, marks };
    el.addEventListener('animationend', () => {
      el.classList.remove('pop', 'shake', 'sweep', 'hint-ok', 'win');
      el.style.animationDelay = '';
    });
  }
}

const keys = [];
for (let d = 1; d <= 9; d++) {
  const key = padEl.appendChild(document.createElement('button'));
  key.className = 'key';
  key.dataset.sfx = 'none';
  key.innerHTML = `<b>${d}</b>`;
  key.setAttribute('aria-label', `数字 ${d}`);
  keys.push(key);
  onPress(key, () => input(d, true), () => input(d, false));
}

// 点击与长按（长按约 0.45 秒）
function onPress(el, onLong, onClick) {
  let timer = 0;
  let fired = false;
  el.addEventListener('pointerdown', () => {
    fired = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      fired = true;
      vibrate(15);
      onLong();
    }, 450);
  });
  for (const t of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(t, () => clearTimeout(timer));
  el.addEventListener('click', () => {
    if (fired) fired = false;
    else onClick();
  });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ---------------------------------------------------------------- 渲染
function render() {
  renderInfo();
  renderCombos();
  if (!game) return;
  const st = B.structureOf(game);
  const conf = B.conflicts(game);
  const hv = hint?.view || {};
  const selRuns = sel >= 0 ? [st.across[sel], st.down[sel]] : [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c.blk) continue;
    const { el, v, marks } = c;
    const val = game.values[i];
    const related = sel >= 0 && i !== sel && (st.across[i] === selRuns[0] || st.down[i] === selRuns[1]);
    el.classList.toggle('bad', !!val && ((strict() && B.isWrong(game, i)) || conf.cells.has(i)));
    el.classList.toggle('sel', i === sel);
    el.classList.toggle('peer', settings.hlRuns && related);
    el.classList.toggle('hint-area', !!hv.area?.has(i));
    el.classList.toggle('hint-src', !!hv.src?.has(i));
    el.classList.toggle('hint-target', hv.target === i);
    const text = val ? String(val) : '';
    if (v.textContent !== text) v.textContent = text;
    const notes = val ? 0 : game.notes[i];
    marks.forEach((m, k) => m.classList.toggle('on', !!(notes & bit(k + 1))));
  }
  clueEls.forEach((el, k) => {
    if (!el) return;
    el.classList.toggle('on', settings.hlRuns && selRuns.includes(k));
    el.classList.toggle('bad', conf.runs.has(k));
  });
  padEl.classList.toggle('notes-mode', notesMode);
  $('notesBtn').setAttribute('aria-pressed', String(notesMode));
  $('notesBadge').textContent = notesMode ? '开' : '关';
  $('notesBadge').classList.toggle('on', notesMode);
  $('hintBadge').textContent = game.hintsLeft;
  $('hintBadge').classList.toggle('zero', game.hintsLeft === 0);
  $('hintBtn').setAttribute('aria-disabled', String(game.hintsLeft === 0));
  $('undoBtn').setAttribute('aria-disabled', String(!game.undo.length));
}

function renderCombos() {
  const bar = $('comboBar');
  const hidden = !settings.showCombos;
  if (bar.hidden !== hidden) {
    bar.hidden = hidden;
    layout();
  }
  if (hidden) return;
  const rowA = $('comboA');
  const rowD = $('comboD');
  rowA.className = rowD.className = 'combo-row';
  if (!game || sel < 0 || paused) {
    rowA.className = 'combo-row tip';
    rowA.textContent = game && paused ? '' : '选中白格，查看所在段的可能组合';
    rowD.textContent = '';
    return;
  }
  const st = B.structureOf(game);
  [
    [rowA, st.across[sel], '→ 横'],
    [rowD, st.down[sel], '↓ 竖'],
  ].forEach(([row, k, label]) => {
    const info = B.runCombos(game, k);
    const lab = `<span class="lab">${label} <b>${info.sum}</b> / ${info.len} 格</span>`;
    let list;
    if (!info.combos.length) {
      list = `<span class="none">${info.dup ? '段内有重复数字' : '无可能组合'}</span>`;
    } else {
      // 按字符宽度限量显示，保证“等 N 种”不会被截掉
      let budget = COMBO_BUDGET;
      const fit = [];
      for (const m of info.combos) {
        const cost = digitsOf(m).length * 2 + 1;
        if (fit.length && (cost > budget || fit.length >= MAX_COMBOS)) break;
        fit.push(m);
        budget -= cost;
      }
      const shown = fit.map(
        (m) => `<span>${digitsOf(m).map((d) => (info.placed & bit(d) ? `<i>${d}</i>` : d)).join('+')}</span>`,
      );
      if (info.combos.length > fit.length) shown.push(`<em class="more">等 ${info.combos.length} 种</em>`);
      list = shown.join('');
    }
    row.innerHTML = `${lab}<span class="list">${list}</span>`;
  });
}

function renderInfo() {
  $('diffTag').textContent = DIFFICULTIES[game ? game.difficulty : menuDiff].name;
  const errors = $('errorsText');
  errors.hidden = !game || !strict();
  if (game) {
    errors.textContent = `错误 ${game.errors}`;
    errors.classList.toggle('has', game.errors > 0);
  }
  $('pauseCover').hidden = !paused || !game;
  $('pauseBtn').classList.toggle('paused', paused);
  $('pauseBtn').setAttribute('aria-label', paused ? '继续' : '暂停');
  renderTimer();
}

function renderTimer() {
  const el = $('timer');
  el.textContent = fmt(game ? elapsedNow() : 0);
  el.classList.toggle('hidden-time', !settings.showTimer);
}

function canZoom() {
  return !!game && game.size >= ZOOM_MIN_SIZE;
}

function renderZoom() {
  zoomBtn.hidden = !canZoom();
  zoomBtn.setAttribute('aria-pressed', String(zoomed));
  zoomBtn.setAttribute('aria-label', zoomed ? '缩小到全览' : '放大');
}

// 全览：宽高约束取较小值；放大档：格子至少 ZOOM_S，棋盘超出时可滚动
// anchor：屏幕坐标，缩放后让该点下的格子尽量保持不动
function layout(anchor) {
  const box = boardEl.parentElement;
  const n = game?.size || 6;
  const fit = Math.floor(Math.max(260, Math.min(boardWrap.clientWidth - 24, boardWrap.clientHeight - 8, 540)));
  const old = parseFloat(box.style.getPropertyValue('--b')) || 0;
  const b = zoomed && canZoom() ? Math.max(fit, ZOOM_S * n + 2) : fit;
  if (b === old) {
    renderZoom();
    return;
  }
  let keep = null;
  if (anchor && old) {
    const wr = boardWrap.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    keep = {
      px: anchor.x - wr.left,
      py: anchor.y - wr.top,
      bx: anchor.x - br.left,
      by: anchor.y - br.top,
      ratio: b / old,
    };
  }
  box.style.setProperty('--b', `${b}px`);
  if (keep) {
    boardWrap.scrollLeft = box.offsetLeft + keep.bx * keep.ratio - keep.px;
    boardWrap.scrollTop = box.offsetTop + keep.by * keep.ratio - keep.py;
  }
  renderZoom();
}

function setZoom(on, anchor) {
  if (!canZoom()) on = false;
  if (on === zoomed) return;
  zoomed = on;
  const r = boardWrap.getBoundingClientRect();
  layout(anchor || { x: r.left + r.width / 2, y: r.top + r.height / 2 });
}

// ---------------------------------------------------------------- 计时
function anyModalOpen() {
  return [...document.querySelectorAll('.modal')].some((m) => !m.hidden);
}

function shouldRun() {
  return (
    !!game && game.status === 'playing' && !paused && !winning &&
    $('menu').hidden && !anyModalOpen() && document.visibilityState === 'visible'
  );
}

function elapsedNow() {
  return game.elapsed + (clockStart ? performance.now() - clockStart : 0);
}

function syncClock() {
  if (!game) return;
  const run = shouldRun();
  if (run && !clockStart) clockStart = performance.now();
  else if (!run && clockStart) {
    game.elapsed += performance.now() - clockStart;
    clockStart = 0;
  }
  renderTimer();
}

setInterval(() => game && clockStart && renderTimer(), 500);

// ---------------------------------------------------------------- 存档与统计
function saveState() {
  if (!game) return;
  if (game.status !== 'playing') {
    stateStore.set(null);
    return;
  }
  const { solution, ...rest } = game;
  stateStore.set({ ...rest, elapsed: Math.round(elapsedNow()) });
}

const emptyStats = () => ({ played: 0, best: 0, total: 0, perfect: 0, streak: 0, bestStreak: 0 });

function updateStats(id, fn) {
  const all = statsStore.get();
  const s = { ...emptyStats(), ...all[id] };
  const out = fn(s);
  all[id] = s;
  statsStore.set(all);
  return out;
}

function recordWin() {
  const t = Math.round(game.elapsed);
  return updateStats(game.difficulty, (s) => {
    const prevBest = s.best;
    let newRecord = false;
    s.played++;
    s.total += t;
    if (game.hintsUsed === 0 && (!s.best || t < s.best)) {
      s.best = t;
      newRecord = true;
    }
    const perfect = game.hintsUsed === 0 && game.errors === 0;
    if (perfect) s.perfect++;
    s.streak++;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    return { newRecord, prevBest, best: s.best, perfect };
  });
}

function breakStreak() {
  if (game) updateStats(game.difficulty, (s) => (s.streak = 0));
}

// ---------------------------------------------------------------- 对局
function newGame(difficulty) {
  closeAllModals();
  closeMenu();
  closeHint(false);
  menuDiff = difficulty;
  diffStore.set(difficulty);
  winning = false;
  paused = false;
  const seenAll = seenStore.get();
  const pick = B.pickFromBank(BANK[difficulty], DIFFICULTIES[difficulty].size, seenAll[difficulty]);
  seenAll[difficulty] = pick.seen;
  seenStore.set(seenAll);
  begin(B.createGame({ difficulty, grid: pick.grid, id: pick.id, flip: pick.flip }));
}

function begin(g) {
  game = g;
  sel = -1;
  notesMode = false;
  clockStart = 0;
  if (!canZoom()) zoomed = false;
  buildBoard();
  layout();
  boardWrap.scrollTo(0, 0);
  render();
  saveState();
  syncClock();
}

function canPlay() {
  return !!game && game.status === 'playing' && !paused && !winning;
}

function select(i) {
  if (!canPlay() || !B.isWhite(game, i)) return;
  if (hint) closeHint();
  sel = i;
  render();
}

function shakeCell(i) {
  play('error');
  vibrate();
  restartAnimation(cells[i].el, 'shake');
}

function input(d, asNote) {
  if (!canPlay()) return;
  if (sel < 0) {
    play('error');
    toast('先选一个格子');
    return;
  }
  if (hint) closeHint();
  if (notesMode || asNote) {
    if (game.values[sel]) {
      shakeCell(sel);
      return;
    }
    if (B.toggleNote(game, sel, d)) play('tap');
    afterChange(null);
    return;
  }
  const res = B.setValue(game, sel, d, { autoClear: settings.autoClear, countErrors: strict() });
  if (!res) return;
  if (res.type === 'set') {
    restartAnimation(cells[sel].el, 'pop');
    if (res.wrong && strict()) shakeCell(sel);
    else play('place');
    vibrate();
    if (!res.wrong || !strict()) celebrate(res.cell);
  } else {
    play('tap');
  }
  afterChange(res);
}

// 某段填满且正确：从提示格一端扫过一道亮光
function celebrate(i) {
  if (game.status !== 'playing') return;
  const st = B.structureOf(game);
  let done = false;
  for (const k of [st.across[i], st.down[i]]) {
    if (!B.runDone(game, k, strict())) continue;
    st.runs[k].cells.forEach((j, t) => restartAnimation(cells[j].el, 'sweep', t * 0.04));
    done = true;
  }
  if (done) play('chip', 0.08);
}

function afterChange(res) {
  render();
  saveState();
  if (game.status === 'won') {
    onWin();
  } else if (res?.type === 'set' && B.filledCount(game) === B.whiteCount(game)) {
    const n = B.wrongCells(game).length;
    toast(strict() ? `还有 ${n} 处错误` : '有冲突或错误，再检查一下');
  }
}

function doErase() {
  if (!canPlay() || sel < 0) return;
  if (hint) closeHint();
  if (B.erase(game, sel)) {
    play('tap');
    afterChange(null);
  }
}

function doUndo(redo = false) {
  if (!canPlay()) return;
  if (hint) closeHint();
  const changes = redo ? B.redo(game) : B.undo(game);
  if (!changes) {
    play('error');
    return;
  }
  play('move');
  sel = changes[0].i;
  afterChange(null);
}

function toggleNotes() {
  if (!canPlay()) return;
  notesMode = !notesMode;
  play('select');
  render();
}

function requestAutoNotes() {
  if (!canPlay()) return;
  const run = () => {
    if (hint) closeHint();
    if (B.autoNotes(game)) {
      play('select');
      toast('已填入全部候选数');
      afterChange(null);
    }
  };
  if (B.hasNotes(game)) confirm('自动笔记', '会覆盖你已有的笔记（可以撤销），确定吗？', run);
  else run();
}

function togglePause(force) {
  if (!game || game.status !== 'playing' || winning) return;
  paused = force ?? !paused;
  if (paused && hint) closeHint();
  syncClock();
  render();
  saveState();
}

function onWin() {
  winning = true;
  sel = -1;
  if (hint) closeHint(false);
  syncClock();
  const info = recordWin();
  stateStore.set(null);
  render();
  const n = game.size;
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i].blk) restartAnimation(cells[i].el, 'win', ((i % n) + Math.floor(i / n)) * 0.04);
  }
  play('win', 0.1);
  setTimeout(() => {
    winning = false;
    showResult(info);
  }, 1200);
}

// ---------------------------------------------------------------- 提示
function startHint() {
  if (!canPlay()) return;
  if (hint) return;
  if (game.hintsLeft <= 0) {
    play('error');
    toast('本局提示已用完');
    return;
  }
  const h = B.pickHint(game);
  if (!h) return;
  B.useHint(game);
  play('select');
  hint = { h, step: 1 };
  if (h.kind === 'fallback') hint.step = 3;
  showHint();
  saveState();
}

// 某段“与已填数字相容”的组合，写成「7+9」「1+2+6 或 1+3+5」
function runReason(k) {
  const info = B.runCombos(game, k);
  const list = info.combos.length > 3
    ? `${info.combos.slice(0, 3).map(comboText).join('、')} 等 ${info.combos.length} 种组合`
    : info.combos.map(comboText).join(' 或 ');
  return `${runLabel(k)}可能是 ${list}`;
}

function showHint() {
  const { h, step } = hint;
  const view = {};
  let title = '提示';
  let text = '';
  let more = '再提示一点';
  let done = false;
  if (h.kind === 'wrong') {
    sel = h.cell;
    view.src = new Set([h.cell]);
    text = `${cellName(h.cell)}填错了。`;
    more = '擦除';
  } else if (h.kind === 'note') {
    sel = h.cell;
    view.src = new Set([h.cell]);
    text = `${cellName(h.cell)}的笔记里少了一个可能的数。`;
    more = null;
  } else {
    title = `提示 ${step}/3`;
    sel = h.cell;
    const st = B.structureOf(game);
    const area = new Set([...st.runs[h.runs[0]].cells, ...st.runs[h.runs[1]].cells]);
    if (step === 1) {
      view.area = area;
      view.target = h.cell;
      text = h.round === 1
        ? '看看高亮的这一格：只看它所在的横段和竖段，就能确定它填几。'
        : '看看高亮的这一格和它所在的两段。需要先结合周围其他段缩小候选数。';
    } else if (step === 2) {
      view.area = area;
      view.target = h.cell;
      if (h.round === 1) {
        text = `${runReason(h.runs[0])}；${runReason(h.runs[1])}。去掉段内已填的数后，两段都能用的只有 ${h.digit}。`;
      } else {
        text = `${runReason(h.runs[0])}；${runReason(h.runs[1])}。再结合与它们交叉的其他段排除候选数，这一格只能是 ${h.digit}。`;
      }
    } else {
      title = h.kind === 'fallback' ? '提示' : '提示 3/3';
      done = true;
      more = null;
      text =
        (h.kind === 'fallback' ? `这一步比较难，直接帮你在${cellName(h.cell)}填入 ${h.digit}。` : `已在${cellName(h.cell)}填入 ${h.digit}。`) +
        `本局剩余提示：${game.hintsLeft} 次`;
    }
  }
  hint.view = view;
  $('hintTitle').textContent = title;
  $('hintText').textContent = text;
  $('hintMore').hidden = !more;
  if (more) $('hintMore').textContent = more;
  $('hintClose').textContent = done ? '好的' : '知道了';
  hintPanel.classList.toggle('done', done);
  hintPanel.hidden = false;
  hintPanel.parentElement.classList.add('hinting');
  render();
  if (done) fillHint();
}

function fillHint() {
  const { h } = hint;
  sel = h.cell;
  const res = B.setValue(game, h.cell, h.digit, { autoClear: settings.autoClear, countErrors: false });
  play('place');
  restartAnimation(cells[h.cell].el, 'hint-ok');
  if (res) celebrate(h.cell);
  afterChange(res);
}

function hintNext() {
  if (!hint) return;
  if (hint.h.kind === 'wrong') {
    const cell = hint.h.cell;
    closeHint();
    sel = cell;
    if (B.erase(game, cell)) afterChange(null);
    return;
  }
  hint.step++;
  play('select');
  showHint();
}

function closeHint(rerender = true) {
  hint = null;
  hintPanel.hidden = true;
  hintPanel.parentElement.classList.remove('hinting');
  if (rerender && game) render();
}

// ---------------------------------------------------------------- 弹窗与菜单
function openModal(id) {
  $(id).hidden = false;
  syncClock();
}

function closeModal(id) {
  $(id).hidden = true;
  syncClock();
}

function closeAllModals() {
  for (const m of document.querySelectorAll('.modal')) m.hidden = true;
}

function confirm(title, text, action) {
  $('confirmTitle').textContent = title;
  $('confirmText').textContent = text;
  confirmAction = action;
  openModal('confirmModal');
}

function showResult(info) {
  const tags = [];
  if (info.newRecord) tags.push('<span>新纪录</span>');
  if (info.perfect) tags.push('<span class="gold">完美通关</span>');
  $('resultTags').innerHTML = tags.join('');
  let best = info.best ? fmt(info.best) : '—';
  if (info.newRecord && info.prevBest) best += `（原 ${fmt(info.prevBest)}）`;
  if (game.hintsUsed > 0 && !info.best) best = '用了提示不计入';
  const rows = [
    ['难度', DIFFICULTIES[game.difficulty].name],
    ['用时', fmt(game.elapsed)],
    ['最佳用时', best],
    ['错误', strict() ? String(game.errors) : '—'],
    ['使用提示', `${game.hintsUsed} 次`],
  ];
  $('resultRows').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  openModal('resultModal');
}

function renderMenu() {
  const stats = statsStore.get();
  $('diffList').innerHTML = DIFF_IDS.map((id) => {
    const d = DIFFICULTIES[id];
    const s = stats[id];
    const stars = '★'.repeat(d.stars) + `<i>${'★'.repeat(4 - d.stars)}</i>`;
    return `<button class="diff-card" data-diff="${id}" aria-pressed="${id === menuDiff}">
      <span class="name">${d.name}</span><span class="stars">${stars}</span>
      <span class="best">${s?.best ? `最佳 ${fmt(s.best)}` : s?.played ? `已完成 ${s.played} 局` : '尚未完成'}</span>
      <span class="range">${d.size} × ${d.size} 棋盘 · 最长段 ${d.layout.maxRun} 格</span>
    </button>`;
  }).join('');
  const resumable = game && game.status === 'playing';
  $('continueBtn').hidden = !resumable;
  if (resumable) {
    $('continueInfo').textContent = `${DIFFICULTIES[game.difficulty].name} · ${fmt(elapsedNow())} · 已填 ${B.filledCount(game)}/${B.whiteCount(game)}`;
  }
  $('menuClose').classList.toggle('invisible', !game);
}

function openMenu() {
  if (hint) closeHint();
  $('menu').hidden = false;
  renderMenu();
  syncClock();
}

function closeMenu() {
  $('menu').hidden = true;
  syncClock();
}

function renderStats() {
  const stats = statsStore.get();
  const head = ['', '完成', '最佳', '平均', '完美', '连胜']
    .map((t) => `<div class="th">${t}</div>`)
    .join('');
  const rows = DIFF_IDS.map((id) => {
    const s = { ...emptyStats(), ...stats[id] };
    const avg = s.played ? fmt(s.total / s.played) : '—';
    return [
      `<div class="rh">${DIFFICULTIES[id].name}</div>`,
      `<div>${s.played}</div>`,
      `<div>${s.best ? fmt(s.best) : '—'}</div>`,
      `<div>${avg}</div>`,
      `<div>${s.perfect}</div>`,
      `<div>${s.streak} / ${s.bestStreak}</div>`,
    ].join('');
  }).join('');
  $('statsTable').innerHTML = head + rows;
  $('statsTable').style.gridTemplateColumns = 'auto repeat(5, 1fr)';
}

function renderSettings() {
  for (const btn of document.querySelectorAll('#checkSelect button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.check === settings.check));
  }
  $('checkDesc').textContent = CHECK_DESC[settings.check];
  $('switchList').innerHTML = SWITCHES.map(
    ([k, label]) => `<button class="switch-row" data-key="${k}" aria-pressed="${!!settings[k]}"><span>${label}</span><span class="sw"></span></button>`,
  ).join('');
  const playing = !!game && game.status === 'playing';
  $('autoNotesBtn').disabled = !playing;
  $('resetBtn').disabled = !playing;
}

function saveSettings() {
  settingsStore.set(settings);
  renderSettings();
  render();
}

// ---------------------------------------------------------------- 事件
boardEl.addEventListener('click', (e) => {
  const cell = e.target.closest('.cell');
  if (cell) select(Number(cell.dataset.i));
});

$('pauseCover').addEventListener('click', () => togglePause(false));
$('pauseBtn').addEventListener('click', () => togglePause());
$('undoBtn').addEventListener('click', () => doUndo());
$('eraseBtn').addEventListener('click', doErase);
onPress($('notesBtn'), requestAutoNotes, toggleNotes);
$('hintBtn').addEventListener('click', startHint);
$('hintMore').addEventListener('click', hintNext);
$('hintClose').addEventListener('click', () => closeHint());

$('newBtn').addEventListener('click', openMenu);
$('menuClose').addEventListener('click', () => game && closeMenu());
$('diffList').addEventListener('click', (e) => {
  const card = e.target.closest('[data-diff]');
  if (!card) return;
  menuDiff = card.dataset.diff;
  renderMenu();
});
$('startBtn').addEventListener('click', () => {
  if (game && game.status === 'playing' && B.hasProgress(game)) {
    confirm('放弃当前对局？', '开始新游戏会放弃当前对局，本难度的连胜也会中断。', () => {
      breakStreak();
      newGame(menuDiff);
    });
  } else {
    newGame(menuDiff);
  }
});
$('continueBtn').addEventListener('click', closeMenu);
$('statsBtn').addEventListener('click', () => {
  renderStats();
  openModal('statsModal');
});

$('resultAgain').addEventListener('click', () => newGame(game.difficulty));
$('resultMenu').addEventListener('click', () => {
  closeModal('resultModal');
  menuDiff = game.difficulty;
  openMenu();
});
$('resultModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal('resultModal');
});

$('settingsBtn').addEventListener('click', () => {
  renderSettings();
  openModal('settingsModal');
});
$('checkSelect').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-check]');
  if (!btn) return;
  settings.check = btn.dataset.check;
  saveSettings();
});
$('switchList').addEventListener('click', (e) => {
  const row = e.target.closest('[data-key]');
  if (!row) return;
  settings[row.dataset.key] = !settings[row.dataset.key];
  saveSettings();
});
$('autoNotesBtn').addEventListener('click', () => {
  closeModal('settingsModal');
  requestAutoNotes();
});
$('resetBtn').addEventListener('click', () => {
  closeModal('settingsModal');
  confirm('重做本题？', '清空所有填入和笔记，计时归零，提示次数恢复。', () => {
    if (hint) closeHint(false);
    paused = false;
    begin(B.resetGame(game));
  });
});

$('helpBtn').addEventListener('click', () => openModal('helpModal'));

$('confirmOk').addEventListener('click', () => {
  closeModal('confirmModal');
  const action = confirmAction;
  confirmAction = null;
  action?.();
});

for (const id of ['helpModal', 'confirmModal', 'settingsModal', 'statsModal']) {
  $(id).addEventListener('click', (e) => {
    if (e.target === e.currentTarget || e.target.closest('[data-close]')) closeModal(id);
  });
}

const MOVES = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], w: [-1, 0], s: [1, 0], a: [0, -1], d: [0, 1] };

// 沿方向找最近的白格（跳过黑格），找不到就不动
function moveSel(dr, dc) {
  const n = game.size;
  if (sel < 0) {
    const first = game.solution.findIndex((v) => v > 0);
    if (first >= 0) select(first);
    return;
  }
  let r = Math.floor(sel / n) + dr;
  let c = (sel % n) + dc;
  while (r >= 0 && r < n && c >= 0 && c < n) {
    if (B.isWhite(game, r * n + c)) {
      select(r * n + c);
      return;
    }
    r += dr;
    c += dc;
  }
}

document.addEventListener('keydown', (e) => {
  if (anyModalOpen() || !$('menu').hidden) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    doUndo(e.shiftKey);
    return;
  }
  if (mod || e.altKey) return;
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.key === ' ') {
    e.preventDefault();
    togglePause();
  } else if (digit && digit[1] !== '0') {
    e.preventDefault();
    input(Number(digit[1]), e.shiftKey);
  } else if ((digit && digit[1] === '0') || e.key === 'Backspace' || e.key === 'Delete') {
    e.preventDefault();
    doErase();
  } else if (MOVES[key] && canPlay()) {
    e.preventDefault();
    moveSel(...MOVES[key]);
  } else if (key === 'n') {
    toggleNotes();
  } else if (key === 'h') {
    startHint();
  } else if (e.key === 'Escape' && hint) {
    closeHint();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && game?.status === 'playing') {
    if (hint) closeHint(false);
    paused = true;
    render();
  }
  syncClock();
  saveState();
});
window.addEventListener('pagehide', saveState);
new ResizeObserver(() => layout()).observe(boardWrap);

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
  if (touches.size === 2) startPinch();
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
layout();
const saved = B.restoreGame(stateStore.get());
if (saved && saved.status === 'playing') {
  begin(saved);
} else {
  if (stateStore.get()) {
    stateStore.set(null);
    toast('存档已失效，请重新开始');
  }
  renderInfo();
  renderCombos();
  openMenu();
}

if (!helpStore.get()) {
  helpStore.set(true);
  openModal('helpModal');
}
