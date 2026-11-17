import { initPage, storage, toast } from '../../js/pwa.js';
import { play } from '../../js/sfx.js';
import { DIFFICULTIES, DIFF_IDS, fromBank } from './generator.js';
import { UNITS, ROW, COL, BOX, PEERS } from './solver.js';
import * as B from './board.js';

initPage();

const stateStore = storage('h5.sudoku.state', null);
const settingsStore = storage('h5.sudoku.settings', {});
const statsStore = storage('h5.sudoku.stats', {});
const diffStore = storage('h5.sudoku.diff', 'easy');
const nextStore = storage('h5.sudoku.next', {});
const helpStore = storage('h5.sudoku.helpSeen', false);

const DEFAULT_SETTINGS = { check: 'instant', hlPeers: true, hlSame: true, autoClear: true, showTimer: true };
const SWITCHES = [
  ['hlPeers', '高亮同行 / 列 / 宫'],
  ['hlSame', '高亮相同数字'],
  ['autoClear', '填数后自动清除笔记'],
  ['showTimer', '显示计时'],
];
const CHECK_DESC = {
  instant: '填入后立即和答案比对，填错标红并计入错误次数。',
  conflict: '只在同行、同列、同宫出现重复数字时标红，不计错误次数。',
};
let settings = { ...DEFAULT_SETTINGS, ...settingsStore.get() };

const $ = (id) => document.getElementById(id);
const boardEl = $('board');
const boardWrap = $('boardWrap');
const padEl = $('pad');
const hintPanel = $('hintPanel');

let game = null;
let sel = -1;
let notesMode = false;
let paused = false;
let loading = false;
let winning = false;
let hint = null; // { h, step, view }
let menuDiff = DIFF_IDS.includes(diffStore.get()) ? diffStore.get() : 'easy';
let confirmAction = null;
let clockStart = 0;
let loadToken = 0;

const strict = () => settings.check === 'instant';
const cellName = (i) => `第 ${ROW[i] + 1} 行第 ${COL[i] + 1} 列`;
const unitName = (u) => (u < 9 ? `第 ${u + 1} 行` : u < 18 ? `第 ${u - 8} 列` : `第 ${u - 17} 宫`);
const unitKind = (u) => (u < 9 ? '行' : u < 18 ? '列' : '宫');

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

// ---------------------------------------------------------------- 棋盘与键盘 DOM（只建一次）
const cells = new Array(81);
for (let b = 0; b < 9; b++) {
  const box = boardEl.appendChild(document.createElement('div'));
  box.className = 'box';
  for (const i of UNITS[18 + b]) {
    const el = box.appendChild(document.createElement('div'));
    el.className = 'cell';
    el.dataset.i = i;
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
      el.classList.remove('pop', 'shake', 'flash', 'sweep', 'hint-ok', 'win');
      el.style.animationDelay = '';
    });
  }
}

const keys = [];
for (let d = 1; d <= 9; d++) {
  const key = padEl.appendChild(document.createElement('button'));
  key.className = 'key';
  key.dataset.sfx = 'none';
  key.innerHTML = `<b>${d}</b><small></small>`;
  key.setAttribute('aria-label', `数字 ${d}`);
  keys.push({ key, count: key.querySelector('small') });
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
  if (!game) return;
  const conf = B.conflicts(game);
  const sv = sel >= 0 ? B.valueAt(game, sel) : 0;
  const hv = hint?.view || {};
  for (let i = 0; i < 81; i++) {
    const { el, v, marks } = cells[i];
    const val = B.valueAt(game, i);
    const given = B.isGiven(game, i);
    const user = !given && !!val;
    const related = sel >= 0 && i !== sel && (ROW[i] === ROW[sel] || COL[i] === COL[sel] || BOX[i] === BOX[sel]);
    el.classList.toggle('given', given);
    el.classList.toggle('bad', user && ((strict() && B.isWrong(game, i)) || conf.has(i)));
    el.classList.toggle('csrc', given && conf.has(i));
    el.classList.toggle('sel', i === sel);
    el.classList.toggle('peer', settings.hlPeers && related);
    el.classList.toggle('same', settings.hlSame && !!sv && val === sv && i !== sel);
    el.classList.toggle('hint-area', !!hv.area?.has(i));
    el.classList.toggle('hint-src', !!hv.src?.has(i));
    el.classList.toggle('hint-target', hv.target === i);
    const text = val ? String(val) : '';
    if (v.textContent !== text) v.textContent = text;
    const notes = val ? 0 : game.notes[i];
    marks.forEach((m, k) => {
      m.classList.toggle('on', !!(notes & (1 << (k + 1))));
      m.classList.toggle('hl', settings.hlSame && sv === k + 1);
    });
  }
  keys.forEach(({ key, count }, k) => {
    const left = 9 - B.placedCount(game, k + 1, strict(), conf);
    key.classList.toggle('done', left <= 0);
    count.textContent = left > 0 ? left : '';
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

function renderInfo() {
  $('diffTag').textContent = game ? DIFFICULTIES[game.difficulty].name : DIFFICULTIES[menuDiff].name;
  const errors = $('errorsText');
  errors.hidden = !game || !strict();
  if (game) {
    errors.textContent = `错误 ${game.errors}`;
    errors.classList.toggle('has', game.errors > 0);
  }
  $('pauseCover').hidden = !paused || !game;
  $('pauseBtn').classList.toggle('paused', paused);
  $('pauseBtn').setAttribute('aria-label', paused ? '继续' : '暂停');
  $('loadingCover').hidden = !loading;
  renderTimer();
}

function renderTimer() {
  const el = $('timer');
  el.textContent = fmt(game ? elapsedNow() : 0);
  el.classList.toggle('hidden-time', !settings.showTimer);
}

// 棋盘边长：宽、高两个方向约束取较小值
function layout() {
  const b = Math.floor(Math.max(260, Math.min(boardWrap.clientWidth - 24, boardWrap.clientHeight - 8, 540)));
  boardEl.parentElement.style.setProperty('--b', `${b}px`);
}

// ---------------------------------------------------------------- 计时
function anyModalOpen() {
  return [...document.querySelectorAll('.modal')].some((m) => !m.hidden);
}

function shouldRun() {
  return (
    !!game && game.status === 'playing' && !paused && !loading && !winning &&
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
  stateStore.set({ ...game, elapsed: Math.round(elapsedNow()) });
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

// ---------------------------------------------------------------- 出题（Web Worker，失败时只用题库）
let worker = null;
let workerFailed = false;
let reqId = 0;
const pending = new Map();

function getWorker() {
  if (worker || workerFailed) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, ...p } = e.data;
      pending.get(id)?.(p);
      pending.delete(id);
    };
    worker.onerror = (e) => {
      console.warn('出题 Worker 出错，改用内置题库', e.message);
      workerFailed = true;
      worker?.terminate();
      worker = null;
      for (const [id, resolve] of pending) resolve(fromBank(resolve.difficulty));
      pending.clear();
    };
  } catch {
    workerFailed = true;
  }
  return worker;
}

function requestPuzzle(difficulty) {
  const w = getWorker();
  if (!w) return Promise.resolve(fromBank(difficulty));
  return new Promise((resolve) => {
    const id = ++reqId;
    resolve.difficulty = difficulty;
    pending.set(id, resolve);
    w.postMessage({ id, difficulty });
  });
}

function validPuzzle(p, difficulty) {
  return p && B.restoreGame({ ...B.createGame({ difficulty, puzzle: p.puzzle, solution: p.solution }) });
}

// 预生成下一局，存起来以便「再来一局」瞬间开始
function prefetch(difficulty) {
  if (nextStore.get()[difficulty]) return;
  requestPuzzle(difficulty).then((p) => {
    const all = nextStore.get();
    all[difficulty] = { puzzle: p.puzzle.join(''), solution: p.solution.join('') };
    nextStore.set(all);
  });
}

function takeNext(difficulty) {
  const all = nextStore.get();
  const raw = all[difficulty];
  if (!raw) return null;
  delete all[difficulty];
  nextStore.set(all);
  if (typeof raw.puzzle !== 'string' || typeof raw.solution !== 'string') return null;
  const p = { puzzle: [...raw.puzzle].map(Number), solution: [...raw.solution].map(Number) };
  return validPuzzle(p, difficulty) ? p : null;
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
  const token = ++loadToken;
  const p = takeNext(difficulty);
  if (p) {
    begin(difficulty, p);
    return;
  }
  game = null;
  loading = true;
  clockStart = 0;
  clearBoard();
  renderInfo();
  requestPuzzle(difficulty).then((res) => token === loadToken && begin(difficulty, res));
}

function begin(difficulty, p) {
  game = B.createGame({ difficulty, puzzle: p.puzzle, solution: p.solution });
  sel = -1;
  notesMode = false;
  loading = false;
  clockStart = 0;
  render();
  saveState();
  syncClock();
  prefetch(difficulty);
}

function clearBoard() {
  for (const { el, v, marks } of cells) {
    el.className = 'cell';
    v.textContent = '';
    marks.forEach((m) => m.classList.remove('on'));
  }
}

function canPlay() {
  return !!game && game.status === 'playing' && !paused && !loading && !winning;
}

function select(i) {
  if (!canPlay()) return;
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
  if (B.isGiven(game, sel)) {
    shakeCell(sel);
    return;
  }
  if (hint) closeHint();
  if (notesMode || asNote) {
    if (B.valueAt(game, sel)) {
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
    if (!res.wrong || !strict()) celebrate(res.cell, res.digit);
  } else {
    play('tap');
  }
  afterChange(res);
}

// 某数字全部完成、某行/列/宫完成时的动效
function celebrate(i, d) {
  if (game.status !== 'playing') return;
  const conf = B.conflicts(game);
  if (conf.has(i)) return;
  let sound = null;
  if (B.placedCount(game, d, strict(), conf) === 9) {
    for (let j = 0; j < 81; j++) if (B.valueAt(game, j) === d) restartAnimation(cells[j].el, 'flash');
    sound = 'select';
  }
  for (const u of [ROW[i], 9 + COL[i], 18 + BOX[i]]) {
    if (!B.unitDone(game, u, strict())) continue;
    const order = UNITS[u].slice().sort((a, b) => Math.abs(a - i) - Math.abs(b - i));
    order.forEach((j, k) => restartAnimation(cells[j].el, 'sweep', k * 0.035));
    sound = 'chip';
  }
  if (sound) play(sound, 0.08);
}

function afterChange(res) {
  render();
  saveState();
  if (game.status === 'won') {
    onWin();
  } else if (res?.type === 'set' && B.filledCount(game) === 81) {
    const n = B.wrongCells(game).length;
    toast(strict() ? `还有 ${n} 处错误` : '有冲突或错误，再检查一下');
  }
}

function doErase() {
  if (!canPlay() || sel < 0) return;
  if (B.isGiven(game, sel)) {
    shakeCell(sel);
    return;
  }
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
  if (!game || game.status !== 'playing' || loading || winning) return;
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
  for (let b = 0; b < 9; b++) {
    for (const i of UNITS[18 + b]) restartAnimation(cells[i].el, 'win', b * 0.08);
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

function techList(pre) {
  return [...new Set(pre.map((s) => s.name))].join('」「');
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
    const naked = h.unit == null;
    const area = naked ? [h.cell, ...PEERS[h.cell]] : UNITS[h.unit];
    if (step === 1) {
      view.area = new Set(area);
      text = naked ? '看看高亮的这一格，它能填的数字只剩一个。' : `看看高亮的这一${unitKind(h.unit)}，有一个数字只剩一个位置可放。`;
      if (naked) view.target = h.cell;
    } else if (step === 2) {
      view.area = new Set(area);
      view.src = new Set(h.sources);
      view.target = h.cell;
      if (naked) {
        text = `排除同行、同列、同宫已有的数字后，这一格只剩 ${h.digit} 可填（${h.name}）。`;
      } else {
        const how = h.unit < 9 ? '列、宫' : h.unit < 18 ? '行、宫' : '行、列';
        text = `${unitName(h.unit)}还缺 ${h.digit}。已有的 ${h.digit} 通过${how}排除了其他空格，只剩深色这一格（${h.name}）。`;
      }
      if (h.pre?.length) text += `这一步之前还需要先用「${techList(h.pre)}」排除一些候选数。`;
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
  if (res) celebrate(h.cell, h.digit);
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
      <span class="range">${d.clues[0]}–${d.clues[1]} 个已知数</span>
    </button>`;
  }).join('');
  const resumable = game && game.status === 'playing';
  $('continueBtn').hidden = !resumable;
  if (resumable) {
    $('continueInfo').textContent = `${DIFFICULTIES[game.difficulty].name} · ${fmt(elapsedNow())} · 已填 ${B.filledCount(game)}/81`;
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
    game = B.resetGame(game);
    sel = -1;
    paused = false;
    clockStart = 0;
    render();
    saveState();
    syncClock();
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
    const [dr, dc] = MOVES[key];
    const r = sel < 0 ? 4 : Math.min(8, Math.max(0, ROW[sel] + dr));
    const c = sel < 0 ? 4 : Math.min(8, Math.max(0, COL[sel] + dc));
    select(r * 9 + c);
  } else if (key === 'n') {
    toggleNotes();
  } else if (key === 'h') {
    startHint();
  } else if (e.key === 'Escape' && hint) {
    closeHint();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && game?.status === 'playing' && !loading) {
    if (hint) closeHint(false);
    paused = true;
    render();
  }
  syncClock();
  saveState();
});
window.addEventListener('pagehide', saveState);
new ResizeObserver(layout).observe(boardWrap);

// ---------------------------------------------------------------- 启动
layout();
const saved = B.restoreGame(stateStore.get());
if (saved && saved.status === 'playing') {
  game = saved;
  render();
  syncClock();
  prefetch(game.difficulty);
} else {
  renderInfo();
  openMenu();
  prefetch(menuDiff);
}

if (!helpStore.get()) {
  helpStore.set(true);
  openModal('helpModal');
}
