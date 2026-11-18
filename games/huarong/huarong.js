import { initPage, storage, toast } from '../../js/pwa.js';
import { play } from '../../js/sfx.js';
import * as E from './engine.js';
import { LEVELS, LEVELS_VERSION, CHAPTERS, chapterOf } from './levels.js';

initPage();

const DEFAULT_LEVEL = 'qianhu';
const FRAME = 8;
const DRAG_START = 8;
const stateStore = storage('h5.huarong.state', null);
const levelStore = storage('h5.huarong.level', DEFAULT_LEVEL);
const recordStore = storage('h5.huarong.records', {});
const helpSeenStore = storage('h5.huarong.helpSeen', false);

const $ = (id) => document.getElementById(id);
const board = $('board');
const inner = $('inner');
const boardWrap = $('boardWrap');

let levelIndex = 0;
let initial = [];
let pieces = [];
let names = [];
let history = [];
let pieceEls = [];
let elapsed = 0; // 已累计毫秒（不含当前运行段）
let startedAt = 0; // 当前运行段的起点，0 表示未在计时
let timer = 0;
let won = false;
let hinted = false; // 本局是否用过提示
let selected = -1; // 轻点选中、等待点虚线框的棋子
let hintMove = null; // { index, x, y, remaining }
let hintPending = 0; // 等待中的提示请求 id
let drag = null;

const level = () => LEVELS[levelIndex];

// ---------- 计时 ----------

function formatTime(ms) {
  const secs = Math.floor(ms / 1000);
  return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
}

function currentTime() {
  return elapsed + (startedAt ? performance.now() - startedAt : 0);
}

function startTimer() {
  if (startedAt || won) return;
  startedAt = performance.now();
  timer = setInterval(() => ($('time').textContent = formatTime(currentTime())), 250);
}

function pauseTimer() {
  if (!startedAt) return;
  elapsed = currentTime();
  startedAt = 0;
  clearInterval(timer);
  $('time').textContent = formatTime(elapsed);
}

// ---------- 渲染 ----------

function pieceClass(p, i) {
  if (p.type === 'cao') return 'cao';
  if (p.type === 's') return 's';
  return `${p.type} ${names[i] === '关羽' ? 'guan' : 'general'}`;
}

function setBox(el, x, y, type) {
  const [w, h] = E.SIZE[type];
  el.style.setProperty('--x', x);
  el.style.setProperty('--y', y);
  el.style.setProperty('--w', w);
  el.style.setProperty('--h', h);
}

function buildPieces() {
  inner.innerHTML = '';
  pieceEls = pieces.map((p, i) => {
    const el = document.createElement('div');
    el.className = `piece ${pieceClass(p, i)}`;
    el.dataset.index = i;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', names[i]);
    const face = document.createElement('span');
    face.className = 'face';
    face.textContent = names[i];
    el.appendChild(face);
    inner.appendChild(el);
    return el;
  });
}

function renderPieces() {
  pieces.forEach((p, i) => {
    const el = pieceEls[i];
    if (drag?.index !== i) setBox(el, p.x, p.y, p.type);
    el.classList.toggle('selected', i === selected);
    el.classList.toggle('hinted', i === hintMove?.index);
  });
  renderGhosts();
}

const ARROW =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function renderGhosts() {
  for (const g of inner.querySelectorAll('.ghost')) g.remove();
  if (won) return;
  if (selected >= 0) {
    const p = pieces[selected];
    for (const r of E.reachable(pieces, selected)) {
      const g = document.createElement('div');
      g.className = 'ghost';
      g.dataset.x = r.x;
      g.dataset.y = r.y;
      g.innerHTML = '<i></i>';
      setBox(g, r.x, r.y, p.type);
      inner.appendChild(g);
    }
  }
  if (hintMove) {
    const p = pieces[hintMove.index];
    const g = document.createElement('div');
    g.className = 'ghost hint';
    g.innerHTML = `<i>${ARROW}</i>`;
    setBox(g, hintMove.x, hintMove.y, p.type);
    const dx = hintMove.x - p.x;
    const dy = hintMove.y - p.y;
    const deg = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 180) : dy > 0 ? 90 : -90;
    g.querySelector('svg').style.transform = `rotate(${deg}deg)`;
    inner.appendChild(g);
  }
}

function renderStats() {
  const lv = level();
  const rec = recordStore.get()[lv.id];
  $('moves').textContent = history.length;
  $('min').textContent = lv.min;
  const best = $('best');
  best.textContent = rec ? (rec.best ? `最佳 ${rec.best}${rec.perfect ? ' ★' : ''}` : '已通过') : '未通关';
  best.classList.toggle('done', !!rec);
  $('time').textContent = formatTime(currentTime());
  $('undoBtn').disabled = won || history.length === 0;
  $('hintBtn').disabled = won || !!hintPending;
  $('hintText').textContent = hintPending ? '计算中' : '提示';
}

function renderLevelBar() {
  $('levelNo').textContent = `第 ${levelIndex + 1} 关`;
  $('levelName').textContent = level().name;
  $('prevBtn').disabled = levelIndex === 0;
  $('nextBtn').disabled = levelIndex === LEVELS.length - 1;
}

function render() {
  board.classList.toggle('won', won);
  renderPieces();
  renderStats();
}

function layout() {
  const w = boardWrap.clientWidth - 32 - FRAME * 2;
  const h = boardWrap.clientHeight - 40 - FRAME * 2;
  const s = Math.max(40, Math.floor(Math.min(96, w / E.COLS, h / E.ROWS)));
  board.style.setProperty('--s', `${s}px`);
  board.style.setProperty('--frame', `${FRAME}px`);
}

// ---------- 存档 ----------

function saveState() {
  if (won) {
    stateStore.set(null);
    return;
  }
  stateStore.set({ v: LEVELS_VERSION, level: level().id, history, elapsed: currentTime(), hinted });
}

function loadLevel(index, saved = null) {
  pauseTimer();
  levelIndex = index;
  levelStore.set(level().id);
  initial = E.parseLayout(level().layout);
  names = E.pieceNames(initial);
  pieces = E.clonePieces(initial);
  history = [];
  elapsed = 0;
  won = false;
  hinted = false;
  selected = -1;
  hintMove = null;
  hintPending = 0;
  drag = null;
  if (saved) {
    const replayed = E.replay(initial, saved.history);
    if (replayed) {
      pieces = replayed;
      history = saved.history;
      elapsed = Number(saved.elapsed) || 0;
      hinted = !!saved.hinted;
    }
  }
  buildPieces();
  renderLevelBar();
  render();
  saveState();
  if (history.length) startTimer();
}

function restore() {
  const s = stateStore.get();
  const savedIndex = s && s.v === LEVELS_VERSION && Array.isArray(s.history) ? LEVELS.findIndex((l) => l.id === s.level) : -1;
  if (savedIndex >= 0) {
    loadLevel(savedIndex, s);
    return;
  }
  const last = LEVELS.findIndex((l) => l.id === levelStore.get());
  loadLevel(last >= 0 ? last : LEVELS.findIndex((l) => l.id === DEFAULT_LEVEL));
}

// ---------- 移动 ----------

function clearTransient() {
  selected = -1;
  hintMove = null;
  hintPending = 0;
}

function doMove(index, x, y) {
  if (won) return false;
  const p = pieces[index];
  const next = E.moveTo(pieces, index, x, y);
  if (!next) return false;
  history = E.pushMove(history, index, [p.x, p.y], [x, y]);
  pieces = next;
  clearTransient();
  startTimer();
  play('move');
  if (navigator.vibrate) navigator.vibrate(8);
  if (E.isWon(pieces)) {
    onWin();
    return true;
  }
  render();
  saveState();
  return true;
}

function undo() {
  if (won || !history.length) return;
  const last = history[history.length - 1];
  history = history.slice(0, -1);
  pieces = E.clonePieces(pieces);
  pieces[last.index].x = last.from[0];
  pieces[last.index].y = last.from[1];
  clearTransient();
  play('tap');
  render();
  saveState();
}

function restart() {
  loadLevel(levelIndex);
}

function shake(index) {
  const el = pieceEls[index];
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 260);
  play('error');
}

function tapPiece(index) {
  if (selected === index) {
    selected = -1;
    renderPieces();
    return;
  }
  const reach = E.reachable(pieces, index);
  if (!reach.length) {
    selected = -1;
    renderPieces();
    shake(index);
    return;
  }
  if (reach.length === 1) {
    doMove(index, reach[0].x, reach[0].y);
    return;
  }
  selected = index;
  play('select');
  renderPieces();
}

// ---------- 胜利 ----------

function onWin() {
  won = true;
  pauseTimer();
  const lv = level();
  const moves = history.length;
  const all = recordStore.get();
  const prev = all[lv.id];
  const perfect = !hinted && moves === lv.min;
  const rec = { ...(prev || {}), date: prev?.date || new Date().toISOString().slice(0, 10) };
  let newRecord = false;
  if (!hinted) {
    if (!rec.best || moves < rec.best) {
      newRecord ||= !!prev?.best;
      rec.best = moves;
    }
    if (!rec.bestTime || elapsed < rec.bestTime) {
      newRecord ||= !!prev?.bestTime;
      rec.bestTime = elapsed;
    }
  }
  rec.perfect = !!prev?.perfect || perfect;
  all[lv.id] = rec;
  recordStore.set(all);
  saveState();

  selected = -1;
  hintMove = null;
  render();
  const cao = pieceEls[E.caoIndex(pieces)];
  cao.classList.add('escape');
  cao.style.setProperty('--y', E.ROWS);
  play('win', 0.1);
  if (navigator.vibrate) navigator.vibrate([30, 40, 60]);

  $('winTitle').textContent = perfect ? '完美通关！' : '曹操逃出华容道！';
  $('winDetail').textContent = `${moves} 步（最少 ${lv.min} 步） · 用时 ${formatTime(elapsed)}`;
  const recordEl = $('winRecord');
  recordEl.hidden = !(!prev || newRecord);
  recordEl.textContent = !prev ? '首次通关' : '新纪录！';
  $('winNote').hidden = !hinted;
  $('winNext').hidden = levelIndex === LEVELS.length - 1;
  setTimeout(() => ($('winModal').hidden = false), 700);
}

// ---------- 提示 ----------

let worker = null;
let hintSeq = 0;

function requestHint() {
  if (won || hintPending) return;
  if (hintMove) {
    toastHint();
    return;
  }
  const id = ++hintSeq;
  const snapshot = JSON.stringify(pieces);
  hintPending = id;
  renderStats();
  const done = (h) => {
    if (hintPending !== id || JSON.stringify(pieces) !== snapshot) return;
    hintPending = 0;
    if (!h) {
      renderStats();
      return;
    }
    hinted = true;
    selected = -1;
    hintMove = h;
    play('select');
    render();
    saveState();
    toastHint();
  };
  try {
    worker ||= new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => (e.data.id === hintPending ? done(e.data.hint) : null);
    worker.onerror = () => {
      worker = null;
      done(E.hint(pieces));
    };
    worker.postMessage({ id, pieces });
  } catch {
    worker = null;
    setTimeout(() => done(E.hint(pieces)), 0);
  }
}

function toastHint() {
  toast(`把「${names[hintMove.index]}」移到虚线框处，还需 ${hintMove.remaining} 步`, 2200);
}

// ---------- 指针交互 ----------

function nearest(fx, fy) {
  let best = drag.origin;
  let bestD = Math.hypot(fx - best.x, fy - best.y);
  for (const r of drag.reach) {
    const d = Math.hypot(fx - r.x, fy - r.y);
    if (d < bestD - 1e-6) {
      best = r;
      bestD = d;
    }
  }
  return best;
}

function cellSize() {
  return inner.getBoundingClientRect().width / E.COLS;
}

board.addEventListener('pointerdown', (e) => {
  if (won || drag || e.button > 0) return;
  const ghost = e.target.closest('.ghost:not(.hint)');
  if (ghost && selected >= 0) {
    e.preventDefault();
    doMove(selected, Number(ghost.dataset.x), Number(ghost.dataset.y));
    return;
  }
  const el = e.target.closest('.piece');
  if (!el) {
    if (selected >= 0) {
      selected = -1;
      renderPieces();
    }
    return;
  }
  const index = Number(el.dataset.index);
  const p = pieces[index];
  drag = {
    id: e.pointerId,
    index,
    sx: e.clientX,
    sy: e.clientY,
    origin: { x: p.x, y: p.y },
    cur: { x: p.x, y: p.y },
    reach: E.reachable(pieces, index),
    moving: false,
  };
  board.setPointerCapture?.(e.pointerId);
});

board.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  const dx = e.clientX - drag.sx;
  const dy = e.clientY - drag.sy;
  if (!drag.moving) {
    if (Math.hypot(dx, dy) < DRAG_START) return;
    drag.moving = true;
    pieceEls[drag.index].classList.add('dragging');
    if (selected >= 0 || hintMove) {
      selected = -1;
      renderPieces();
    }
  }
  const s = cellSize();
  const target = nearest(drag.origin.x + dx / s, drag.origin.y + dy / s);
  if (target.x !== drag.cur.x || target.y !== drag.cur.y) {
    drag.cur = { x: target.x, y: target.y };
    setBox(pieceEls[drag.index], target.x, target.y, pieces[drag.index].type);
  }
});

function endDrag(e, cancel) {
  if (!drag || drag.id !== e.pointerId) return;
  const d = drag;
  drag = null;
  pieceEls[d.index].classList.remove('dragging');
  if (cancel) {
    renderPieces();
    return;
  }
  if (!d.moving) {
    tapPiece(d.index);
    return;
  }
  if (d.cur.x === d.origin.x && d.cur.y === d.origin.y) {
    if (!d.reach.length) shake(d.index);
    renderPieces();
    return;
  }
  doMove(d.index, d.cur.x, d.cur.y);
}

board.addEventListener('pointerup', (e) => endDrag(e, false));
board.addEventListener('pointercancel', (e) => endDrag(e, true));
board.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- 键盘 ----------

const modalOpen = () => [...document.querySelectorAll('.modal')].some((m) => !m.hidden);

document.addEventListener('keydown', (e) => {
  if (modalOpen() || e.altKey || e.metaKey) return;
  const dirs = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  const focused = document.activeElement?.closest?.('.piece');
  if (dirs[e.key]) {
    e.preventDefault();
    const index = focused ? Number(focused.dataset.index) : selected;
    if (index < 0 || won) return;
    const [dx, dy] = dirs[e.key];
    if (E.canStep(pieces, index, dx, dy)) doMove(index, pieces[index].x + dx, pieces[index].y + dy);
    else shake(index);
    if (!won) pieceEls[index].focus();
    return;
  }
  const key = e.key.toLowerCase();
  if (key === 'z' || e.key === 'Backspace') {
    e.preventDefault();
    undo();
  } else if (e.ctrlKey) {
    return;
  } else if (key === 'r') {
    askRestart();
  } else if (key === 'h') {
    requestHint();
  } else if (e.key === '[' && levelIndex > 0) {
    loadLevel(levelIndex - 1);
  } else if (e.key === ']' && levelIndex < LEVELS.length - 1) {
    loadLevel(levelIndex + 1);
  } else if ((e.key === 'Enter' || e.key === ' ') && focused) {
    e.preventDefault();
    tapPiece(Number(focused.dataset.index));
  }
});

// ---------- 选关 ----------

function renderLevelList() {
  const records = recordStore.get();
  const passed = LEVELS.filter((l) => records[l.id]).length;
  const perfect = LEVELS.filter((l) => records[l.id]?.perfect).length;
  $('levelSummary').textContent = `已通过 ${passed} / ${LEVELS.length} · 完美 ${perfect}`;
  const list = $('levelList');
  list.innerHTML = '';
  CHAPTERS.forEach((ch, ci) => {
    const h = document.createElement('h3');
    h.textContent = ch.name;
    const grid = document.createElement('div');
    grid.className = 'level-grid';
    LEVELS.forEach((lv, i) => {
      if (chapterOf(lv) !== ci) return;
      const rec = records[lv.id];
      const btn = document.createElement('button');
      btn.className = `level-card${i === levelIndex ? ' current' : ''}`;
      btn.dataset.index = i;
      const mark = rec ? `<span class="mark${rec.perfect ? ' perfect' : ''}">${rec.perfect ? '★' : '✓'}</span>` : '';
      const best = rec?.best ? ` · 最佳 ${rec.best}` : '';
      btn.innerHTML = `${mark}<small>第 ${i + 1} 关</small><b>${lv.name}</b><small>最少 ${lv.min} 步${best}</small>`;
      grid.appendChild(btn);
    });
    list.append(h, grid);
  });
}

function openLevels() {
  renderLevelList();
  $('levelModal').hidden = false;
  list().querySelector('.current')?.scrollIntoView({ block: 'center' });
}

const list = () => $('levelList');

list().addEventListener('click', (e) => {
  const btn = e.target.closest('.level-card');
  if (!btn) return;
  $('levelModal').hidden = true;
  loadLevel(Number(btn.dataset.index));
});

// ---------- 按钮与弹窗 ----------

function askRestart() {
  if (history.length && !won) $('confirmModal').hidden = false;
  else restart();
}

$('undoBtn').addEventListener('click', undo);
$('restartBtn').addEventListener('click', askRestart);
$('hintBtn').addEventListener('click', requestHint);
$('confirmOk').addEventListener('click', () => {
  $('confirmModal').hidden = true;
  restart();
});
$('prevBtn').addEventListener('click', () => levelIndex > 0 && loadLevel(levelIndex - 1));
$('nextBtn').addEventListener('click', () => levelIndex < LEVELS.length - 1 && loadLevel(levelIndex + 1));
$('levelBtn').addEventListener('click', openLevels);
$('helpBtn').addEventListener('click', () => ($('helpModal').hidden = false));
$('winAgain').addEventListener('click', () => {
  $('winModal').hidden = true;
  restart();
});
$('winNext').addEventListener('click', () => {
  $('winModal').hidden = true;
  loadLevel(Math.min(levelIndex + 1, LEVELS.length - 1));
});
$('winLevels').addEventListener('click', () => {
  $('winModal').hidden = true;
  openLevels();
});

for (const id of ['helpModal', 'levelModal', 'confirmModal']) {
  $(id).addEventListener('click', (e) => {
    if (e.target === e.currentTarget || e.target.closest('[data-close]')) e.currentTarget.hidden = true;
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pauseTimer();
    saveState();
  } else if (history.length && !won) {
    startTimer();
  }
});
window.addEventListener('pagehide', saveState);

new ResizeObserver(layout).observe(boardWrap);
layout();
restore();

if (!helpSeenStore.get()) {
  helpSeenStore.set(true);
  $('helpModal').hidden = false;
}
