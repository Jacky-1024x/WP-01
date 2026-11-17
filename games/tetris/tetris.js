import { initPage, storage } from '../../js/pwa.js';
import { play, isMuted } from '../../js/sfx.js';
import * as T from './engine.js';
import { createInput } from './input.js';

initPage();

const { COLS, ROWS } = T;
// 尺寸常量必须与 tetris.css 中 .side 的宽度、.play 的 gap / padding、.well 的边框保持一致
const SIDE_W = 52;
const PLAY_GAP = 8;
const PLAY_PAD_X = 12;
const PLAY_PAD_Y = 8;
const BORDER = 3;
const MAX_S = 36;
const HOLD_H = 40;
const NEXT_H = 156;
// 逻辑固定 60Hz 推进；卡顿时一帧最多补 5 步，超出的部分丢弃
const STEP = 1000 / 60;
const MAX_STEPS = 5;
const COUNT_STEP = 400;
const SPEEDS = {
  slow: { das: 220, arr: 50 },
  mid: { das: 167, arr: 33 },
  fast: { das: 117, arr: 0 },
};
const MODE_NAMES = { marathon: '马拉松', sprint: '40 行竞速', ultra: '限时 2 分钟' };
const CLEAR_NAMES = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS'];

// 按 typeId 索引：[主色, 高光, 阴影]
const COLORS = [
  null,
  ['#22d3ee', '#67e8f9', '#0891b2'],
  ['#facc15', '#fde047', '#ca8a04'],
  ['#a855f7', '#c084fc', '#7e22ce'],
  ['#22c55e', '#4ade80', '#15803d'],
  ['#ef4444', '#f87171', '#b91c1c'],
  ['#3b82f6', '#60a5fa', '#1d4ed8'],
  ['#f97316', '#fb923c', '#c2410c'],
];
const GRAY = ['#4b5563', '#6b7280', '#374151'];
const BG = '#111827';
const GRID = '#1f2937';

const stateStore = storage('h5.tetris.state', null);
const settingsStore = storage('h5.tetris.settings', {});
const statsStore = storage('h5.tetris.stats', {});
const lastStore = storage('h5.tetris.last', {});
const helpStore = storage('h5.tetris.helpSeen', false);

const $ = (id) => document.getElementById(id);
const playEl = $('play');
const well = $('well');
const boardCanvas = $('boardCanvas');
const holdCanvas = $('holdCanvas');
const nextCanvas = $('nextCanvas');
const overlay = $('overlay');
const countdownEl = $('countdown');
const pad = $('pad');
const holdBox = $('holdBox');
const cache = document.createElement('canvas');

// 屏幕按键默认按设备判断（触屏显示），只有玩家明确选过才保存
const coarse = matchMedia('(pointer: coarse)').matches;
const settings = { layout: 'rot', speed: 'mid', ghost: true, ...settingsStore.get() };
let padChosen = typeof settings.pad === 'boolean';
if (!padChosen) settings.pad = coarse;
if (!SPEEDS[settings.speed]) settings.speed = 'mid';
if (settings.layout !== 'move') settings.layout = 'rot';

const last = lastStore.get();
const pick = {
  mode: T.MODES.includes(last.mode) ? last.mode : 'marathon',
  level: Number.isInteger(last.level) && last.level >= 1 && last.level <= 10 ? last.level : 1,
};

let game = null;
let paused = false;
let countdownUntil = 0;
let lastCount = 0;
let S = 24;
let dpr = 1;
let cacheVersion = -1;
let sideKey = null;
let confirmAction = null;
let lastUltraSec = 0;
const hudCache = [];
const fx = { trails: [], flashes: [], shakeUntil: 0, overAt: 0 };

// 自动重复移动（DAS / ARR）
const held = { left: false, right: false, soft: false };
let dir = 0;
let das = 0;
let arrAcc = 0;
let charged = false;

// ---------------------------------------------------------------- 工具
function vibrate(pattern) {
  if (!isMuted()) navigator.vibrate?.(pattern);
}

function animate(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

for (const el of [well, holdBox, ...document.querySelectorAll('.hud b')]) {
  el.addEventListener('animationend', (e) => {
    if (e.target === el) el.classList.remove('sink', 'flash', 'tetris', 'shake', 'pop');
  });
}

function anyModalOpen() {
  return [...document.querySelectorAll('.modal')].some((m) => !m.hidden);
}

const fmtNum = (n) => Math.floor(n).toLocaleString('en-US');

function fmtTime(ms, cs = false) {
  const total = Math.max(0, ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const base = `${m}:${String(s).padStart(2, '0')}`;
  return cs ? `${base}.${String(Math.floor((total % 1000) / 10)).padStart(2, '0')}` : base;
}

const pps = (g) => (g.elapsed > 0 ? (g.pieces / (g.elapsed / 1000)).toFixed(2) : '0.00');
const today = () => new Date().toISOString().slice(0, 10);

const isPlaying = () => !!game && game.status === 'playing';
// 逻辑是否推进：消行动画在对局结束后也要播完
const running = () => !!game && !paused && !countdownUntil && (game.status === 'playing' || !!game.clearing);
const inputEnabled = () => running() && game.status === 'playing' && !anyModalOpen();

// ---------------------------------------------------------------- 操作
function startShift(d) {
  dir = d;
  das = 0;
  arrAcc = 0;
  charged = false;
  T.move(game, d);
}

function autoShift() {
  if (!dir) return;
  const { das: delay, arr } = SPEEDS[settings.speed];
  das += STEP;
  if (das < delay) return;
  if (arr === 0) {
    while (T.move(game, dir));
    return;
  }
  if (!charged) {
    charged = true;
    T.move(game, dir);
    return;
  }
  arrAcc += STEP;
  while (arrAcc >= arr) {
    arrAcc -= arr;
    T.move(game, dir);
  }
}

function doRotate(d) {
  if (T.rotate(game, d)) play('select', 0, { volume: 0.4 });
  else if (T.canAct(game)) fx.shakeUntil = performance.now() + 150;
}

function doHold() {
  if (T.hold(game)) {
    drain();
  } else if (T.canAct(game) && game.holdUsed) {
    play('error');
    animate(holdBox, 'shake');
  }
}

function onPress(act) {
  if (!inputEnabled()) return;
  switch (act) {
    case 'left':
    case 'right':
      held[act] = true;
      startShift(act === 'left' ? -1 : 1);
      break;
    case 'soft':
      held.soft = true;
      break;
    case 'hard':
      if (T.hardDrop(game)) drain();
      break;
    case 'cw':
    case 'ccw':
      doRotate(act === 'cw' ? 1 : -1);
      break;
    case 'hold':
      doHold();
      break;
  }
}

// 同时按住左右时以后按下的为准；松开它后立即转向另一个方向，并重新计算 DAS
function onRelease(act) {
  if (act === 'soft') held.soft = false;
  if (act !== 'left' && act !== 'right') return;
  held[act] = false;
  const d = act === 'left' ? -1 : 1;
  if (dir !== d) return;
  const other = d < 0 ? 'right' : 'left';
  if (held[other] && inputEnabled()) startShift(-d);
  else dir = 0;
}

const input = createInput({
  pad,
  holdBox,
  onPress,
  onRelease,
  enabled: inputEnabled,
  onPause() {
    if (!$('pauseModal').hidden) resume();
    else if (isPlaying() && !anyModalOpen()) pause();
  },
  onRestart() {
    if (game && !anyModalOpen()) requestRestart();
  },
});

// ---------------------------------------------------------------- 事件
function drain() {
  const now = performance.now();
  for (const ev of game.events) {
    switch (ev.type) {
      case 'lock':
        play('place', 0, { volume: ev.hard ? 1 : 0.5 });
        if (ev.hard) {
          vibrate(10);
          animate(well, 'sink');
          if (ev.to > ev.from) fx.trails.push({ t0: now, piece: ev.piece, cells: ev.cells, rows: ev.to - ev.from });
        }
        fx.flashes.push({ t0: now, cells: ev.cells });
        save();
        break;
      case 'clear':
        onClear(ev);
        break;
      case 'levelup':
        play('chip');
        animate($('hudV1'), 'pop');
        animate(well, 'flash');
        break;
      case 'hold':
        play('tap');
        break;
      case 'over':
      case 'done':
        finish();
        break;
    }
  }
  game.events.length = 0;
}

function onClear(ev) {
  let title = '';
  let cls = '';
  if (ev.spin) {
    title = `T-SPIN${ev.spin === 'mini' ? ' MINI' : ''}${ev.lines ? ` ${CLEAR_NAMES[ev.lines]}` : ''}`;
    cls = 'spin';
  } else if (ev.lines === 4) {
    title = 'TETRIS';
    cls = 'tetris';
  }
  const subs = [];
  if (ev.b2b) subs.push('B2B');
  if (ev.combo > 0) subs.push(`${ev.combo} 连击`);
  if (title) popup(title, subs.join(' · '), cls);
  else if (subs.length) popup(subs.join(' · '), '', 'small');

  if (ev.lines === 4) {
    play('tetris');
    vibrate([20, 30, 40]);
    animate(well, 'tetris');
  } else if (ev.lines) {
    play('clear', 0, { pitch: 1 + (ev.lines - 1) * 0.12 });
  }
  if (ev.spin) play('select', ev.lines ? 0.08 : 0);
}

function popup(text, sub, cls) {
  const el = document.createElement('div');
  el.className = `popup ${cls}`;
  const b = document.createElement('b');
  b.textContent = text;
  el.append(b);
  if (sub) {
    const span = document.createElement('span');
    span.textContent = sub;
    el.append(span);
  }
  el.addEventListener('animationend', () => el.remove());
  overlay.append(el);
}

// ---------------------------------------------------------------- 对局流程
function newGame(mode, level) {
  for (const id of ['newModal', 'resultModal', 'pauseModal', 'confirmModal']) $(id).hidden = true;
  game = T.createGame({ mode, startLevel: level });
  game.events.length = 0;
  pick.mode = mode;
  pick.level = game.startLevel;
  lastStore.set({ mode, level: game.startLevel });
  resetRun();
  paused = false;
  well.classList.remove('covered');
  startCountdown();
  save();
}

function resetRun() {
  input.reset();
  dir = 0;
  held.left = held.right = held.soft = false;
  fx.trails.length = 0;
  fx.flashes.length = 0;
  fx.overAt = 0;
  cacheVersion = -1;
  sideKey = null;
  lastUltraSec = 0;
  for (const el of overlay.querySelectorAll('.popup')) el.remove();
  well.classList.remove('danger');
}

function startCountdown() {
  countdownUntil = performance.now() + COUNT_STEP * 3;
  lastCount = 0;
}

function updateCountdown(now) {
  const left = countdownUntil - now;
  if (left <= 0) {
    countdownUntil = 0;
    countdownEl.textContent = '';
    return;
  }
  const n = Math.ceil(left / COUNT_STEP);
  if (n === lastCount) return;
  lastCount = n;
  countdownEl.textContent = n;
  animate(countdownEl, 'tick');
  play('tap');
}

function pause(showMenu = true) {
  if (!isPlaying()) return;
  if (!paused) {
    paused = true;
    countdownUntil = 0;
    countdownEl.textContent = '';
    input.reset();
    well.classList.add('covered');
    save();
  }
  if (showMenu) openPause();
}

function openPause() {
  const g = game;
  const info = {
    marathon: `等级 ${g.level} · ${fmtNum(g.score)} 分`,
    sprint: `已消 ${g.lines} 行 · ${fmtTime(g.elapsed, true)}`,
    ultra: `剩余 ${fmtTime(T.ULTRA_MS - g.elapsed)} · ${fmtNum(g.score)} 分`,
  }[g.mode];
  $('pauseInfo').textContent = `${MODE_NAMES[g.mode]} · ${info}`;
  renderSettings();
  $('pauseModal').hidden = false;
}

function resume() {
  $('pauseModal').hidden = true;
  if (!paused || !isPlaying()) return;
  paused = false;
  well.classList.remove('covered');
  startCountdown();
}

function requestRestart() {
  if (!isPlaying()) {
    newGame(game.mode, game.startLevel);
    return;
  }
  pause(false);
  $('pauseModal').hidden = true;
  $('confirmText').textContent =
    game.mode === 'marathon' ? '本局会按当前分数记录，然后重新开始。' : '本局不会记录成绩，确定重新开始吗？';
  confirmAction = () => {
    if (game.mode === 'marathon') record();
    newGame(game.mode, game.startLevel);
  };
  $('confirmModal').hidden = false;
}

function finish() {
  const g = game;
  input.reset();
  dir = 0;
  stateStore.set(null);
  well.classList.remove('danger');
  const rec = record();
  const over = g.status === 'over';
  if (over) {
    play('lose');
    vibrate([60, 40, 120]);
    fx.overAt = performance.now();
  } else {
    play('win', 0.1);
  }
  setTimeout(() => game === g && showResult(rec), over ? 900 : 500);
}

// ---------------------------------------------------------------- 统计
function loadStats() {
  const s = statsStore.get() || {};
  return {
    marathon: { games: 0, lines: 0, best: [], ...s.marathon },
    sprint: { done: 0, best: [], ...s.sprint },
    ultra: { games: 0, best: [], ...s.ultra },
    total: { tetrises: 0, tspins: 0, maxCombo: 0, ...s.total },
  };
}

// 按 better 排序插入前 5 名，返回名次（0 起），没进前 5 返回 -1
function insertTop(list, entry, better) {
  let rank = list.findIndex((e) => better(entry, e));
  if (rank < 0) rank = list.length;
  list.splice(rank, 0, entry);
  list.length = Math.min(list.length, 5);
  return rank < 5 ? rank : -1;
}

function record() {
  const g = game;
  const stats = loadStats();
  stats.total.tetrises += g.tetrises;
  stats.total.tspins += g.tspins;
  stats.total.maxCombo = Math.max(stats.total.maxCombo, g.maxCombo);
  const prev = stats[g.mode].best[0];
  let rank = -1;
  if (g.mode === 'marathon') {
    stats.marathon.games++;
    stats.marathon.lines += g.lines;
    if (g.score > 0) {
      rank = insertTop(stats.marathon.best, { score: g.score, level: g.level, lines: g.lines, date: today() }, (a, b) => a.score > b.score);
    }
  } else if (g.mode === 'sprint') {
    if (g.status === 'done') {
      stats.sprint.done++;
      rank = insertTop(stats.sprint.best, { ms: Math.round(g.elapsed), pieces: g.pieces, date: today() }, (a, b) => a.ms < b.ms);
    }
  } else {
    stats.ultra.games++;
    if (g.score > 0) {
      rank = insertTop(stats.ultra.best, { score: g.score, lines: g.lines, date: today() }, (a, b) => a.score > b.score);
    }
  }
  statsStore.set(stats);
  return { stats, prev, isRecord: rank === 0 && !!prev };
}

function showResult({ stats, prev, isRecord }) {
  const g = game;
  const over = g.status === 'over';
  const best = stats[g.mode].best[0];
  let title;
  let big;
  let detail;
  let items;
  if (g.mode === 'marathon') {
    title = '游戏结束';
    big = fmtNum(g.score);
    detail = `等级 ${g.level} · 消 ${g.lines} 行 · 用时 ${fmtTime(g.elapsed)}`;
    items = [
      ['Tetris', g.tetrises],
      ['T-Spin', g.tspins],
      ['最高分', fmtNum(best?.score ?? g.score)],
    ];
  } else if (g.mode === 'sprint') {
    if (over) {
      title = '堆满了';
      big = `${g.lines} / ${T.SPRINT_LINES}`;
      detail = `用时 ${fmtTime(g.elapsed, true)}，这局不计入最佳用时`;
    } else {
      title = '完成！';
      big = fmtTime(g.elapsed, true);
      detail = `${g.pieces} 个方块 · 每秒 ${pps(g)} 个`;
    }
    const diff = !over && prev && !isRecord ? `+${((g.elapsed - prev.ms) / 1000).toFixed(2)}s` : '—';
    items = [
      ['最佳用时', best ? fmtTime(best.ms, true) : '—'],
      ['完成次数', stats.sprint.done],
      ['与最佳', diff],
    ];
  } else {
    title = over ? '堆满了' : '时间到';
    big = fmtNum(g.score);
    detail = `消 ${g.lines} 行 · Tetris ${g.tetrises} 次${over ? ` · 用时 ${fmtTime(g.elapsed)}` : ''}`;
    items = [
      ['最高分', fmtNum(best?.score ?? g.score)],
      ['本局行数', g.lines],
      ['T-Spin', g.tspins],
    ];
  }
  $('resultTitle').textContent = title;
  $('resultBig').textContent = big;
  $('resultDetail').textContent = detail;
  $('resultRecord').hidden = !isRecord;
  const box = $('resultStats');
  box.replaceChildren(
    ...items.map(([label, value]) => {
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

// ---------------------------------------------------------------- 存档
function save() {
  stateStore.set(isPlaying() ? T.serialize(game) : null);
}

// ---------------------------------------------------------------- 绘制
function sizeCanvas(c, w, h, css = true) {
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  if (css) {
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
  }
}

function context(c) {
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function layout() {
  const w = playEl.clientWidth - 2 * SIDE_W - 2 * PLAY_GAP - 2 * PLAY_PAD_X - 2 * BORDER;
  const h = playEl.clientHeight - 2 * PLAY_PAD_Y - 2 * BORDER;
  S = Math.max(8, Math.floor(Math.min(MAX_S, w / COLS, h / ROWS)));
  dpr = Math.min(3, window.devicePixelRatio || 1);
  sizeCanvas(boardCanvas, COLS * S, ROWS * S);
  sizeCanvas(cache, COLS * S, ROWS * S, false);
  sizeCanvas(holdCanvas, SIDE_W, HOLD_H);
  sizeCanvas(nextCanvas, SIDE_W, NEXT_H);
  cacheVersion = -1;
  sideKey = null;
}

// 格子右下留 1px 缝，与网格线重合
function drawCell(ctx, x, y, s, [base, hi, lo], alpha = 1) {
  const size = s - 1;
  const b = Math.max(1, Math.round(s / 8));
  ctx.globalAlpha = alpha;
  ctx.fillStyle = lo;
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = hi;
  ctx.fillRect(x, y, size - b, size - b);
  ctx.fillStyle = base;
  ctx.fillRect(x + b, y + b, size - 2 * b, size - 2 * b);
  ctx.globalAlpha = 1;
}

function redrawCache() {
  const ctx = context(cache);
  const W = COLS * S;
  const H = ROWS * S;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = GRID;
  for (let x = 0; x < COLS - 1; x++) ctx.fillRect(x * S + S - 1, 0, 1, H);
  for (let y = 0; y < ROWS - 1; y++) ctx.fillRect(0, y * S + S - 1, W, 1);
  if (game) {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const id = T.cell(game, x, y);
        if (id) drawCell(ctx, x * S, y * S, S, COLORS[id]);
      }
    }
    if (isPlaying()) well.classList.toggle('danger', T.inDanger(game));
  }
  cacheVersion = game ? game.version : -2;
}

// 满行先闪白，再从两边向中间收缩消失
function drawClearing(ctx) {
  const { rows, t, dur } = game.clearing;
  const p = Math.min(1, t / dur);
  const W = COLS * S;
  for (const y of rows) {
    const top = y * S;
    if (p < 0.4) {
      ctx.fillStyle = `rgba(255,255,255,${(0.85 * p) / 0.4})`;
      ctx.fillRect(0, top, W, S - 1);
    } else {
      const q = (p - 0.4) / 0.6;
      const cut = (q * W) / 2;
      ctx.fillStyle = `rgba(255,255,255,${0.85 * (1 - q)})`;
      ctx.fillRect(0, top, W, S - 1);
      ctx.fillStyle = BG;
      ctx.fillRect(0, top, cut, S - 1);
      ctx.fillRect(W - cut, top, cut, S - 1);
    }
  }
}

// 结束时从下到上逐行变灰
function drawOver(ctx, now) {
  const n = Math.min(ROWS, Math.floor(((now - fx.overAt) / 600) * ROWS));
  for (let y = ROWS - 1; y >= ROWS - n; y--) {
    for (let x = 0; x < COLS; x++) if (T.cell(game, x, y)) drawCell(ctx, x * S, y * S, S, GRAY);
  }
}

function drawTrails(ctx, now) {
  fx.trails = fx.trails.filter((tr) => now - tr.t0 < 150);
  for (const tr of fx.trails) {
    const fade = 1 - (now - tr.t0) / 150;
    const color = COLORS[T.typeId(tr.piece)][0];
    const tops = new Map();
    for (const [x, y] of tr.cells) tops.set(x, Math.min(tops.get(x) ?? Infinity, y));
    for (const [x, top] of tops) {
      const y0 = Math.max(0, top - tr.rows) * S;
      const y1 = top * S;
      if (y1 <= y0) continue;
      const grad = ctx.createLinearGradient(0, y0, 0, y1);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(1, color);
      ctx.globalAlpha = 0.35 * fade;
      ctx.fillStyle = grad;
      ctx.fillRect(x * S + 2, y0, S - 5, y1 - y0);
    }
    ctx.globalAlpha = 1;
  }
}

function drawFlashes(ctx, now) {
  fx.flashes = fx.flashes.filter((f) => now - f.t0 < 90);
  for (const f of fx.flashes) {
    ctx.fillStyle = `rgba(255,255,255,${0.55 * (1 - (now - f.t0) / 90)})`;
    for (const [x, y] of f.cells) if (y >= 0) ctx.fillRect(x * S, y * S, S - 1, S - 1);
  }
}

function drawPiece(ctx, now) {
  const p = game.piece;
  if (!p || !isPlaying()) return;
  const colors = COLORS[T.typeId(p.type)];
  if (settings.ghost) {
    const gy = T.ghostY(game);
    if (gy !== p.y) {
      ctx.strokeStyle = colors[0];
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.5;
      for (const [x, y] of T.cellsOf(p, gy)) if (y >= 0) ctx.strokeRect(x * S + 1.25, y * S + 1.25, S - 3.5, S - 3.5);
      ctx.globalAlpha = 1;
    }
  }
  const left = fx.shakeUntil - now;
  const dx = left > 0 ? Math.round(Math.sin((left / 150) * Math.PI * 4) * 2) : 0;
  for (const [x, y] of T.cellsOf(p)) if (y >= 0) drawCell(ctx, x * S + dx, y * S, S, colors);
}

function drawMini(ctx, type, cx, cy, s, alpha = 1) {
  const cells = T.SHAPES[type][0];
  const xs = cells.map((c) => c[0]);
  const ys = cells.map((c) => c[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = (Math.max(...xs) - minX + 1) * s;
  const h = (Math.max(...ys) - minY + 1) * s;
  const ox = Math.round(cx - w / 2);
  const oy = Math.round(cy - h / 2);
  for (const [x, y] of cells) drawCell(ctx, ox + (x - minX) * s, oy + (y - minY) * s, s, COLORS[T.typeId(type)], alpha);
}

function drawSides() {
  const queue = game ? T.preview(game) : [];
  const key = game ? `${game.hold}|${game.holdUsed}|${queue.join('')}` : '';
  if (key === sideKey) return;
  sideKey = key;
  const h = context(holdCanvas);
  h.clearRect(0, 0, SIDE_W, HOLD_H);
  if (game?.hold) drawMini(h, game.hold, SIDE_W / 2, HOLD_H / 2, 11, game.holdUsed ? 0.4 : 1);
  const n = context(nextCanvas);
  n.clearRect(0, 0, SIDE_W, NEXT_H);
  queue.forEach((type, i) => {
    if (i === 0) drawMini(n, type, SIDE_W / 2, 22, 11);
    else drawMini(n, type, SIDE_W / 2, 26 + i * 28, 8);
  });
}

function render(now) {
  if (cacheVersion !== (game ? game.version : -2)) redrawCache();
  const ctx = context(boardCanvas);
  ctx.drawImage(cache, 0, 0, COLS * S, ROWS * S);
  if (game) {
    if (game.clearing) drawClearing(ctx);
    if (fx.overAt) drawOver(ctx, now);
    drawTrails(ctx, now);
    drawPiece(ctx, now);
    drawFlashes(ctx, now);
  }
  drawSides();
}

// ---------------------------------------------------------------- 状态栏
function hudValues() {
  const g = game;
  if (!g) return [['分数', '0'], ['等级', '1'], ['行数', '0']];
  if (g.mode === 'sprint') {
    return [
      ['用时', fmtTime(g.elapsed, true)],
      ['剩余行数', String(Math.max(0, T.SPRINT_LINES - g.lines))],
      ['每秒方块', pps(g)],
    ];
  }
  if (g.mode === 'ultra') {
    return [
      ['剩余时间', fmtTime(Math.ceil((T.ULTRA_MS - g.elapsed) / 1000) * 1000)],
      ['分数', fmtNum(g.score)],
      ['行数', String(g.lines)],
    ];
  }
  return [['分数', fmtNum(g.score)], ['等级', String(g.level)], ['行数', String(g.lines)]];
}

function renderHud() {
  hudValues().forEach(([label, value], i) => {
    const prev = hudCache[i] || [];
    if (prev[0] !== label) $(`hudL${i}`).textContent = label;
    if (prev[1] !== value) $(`hudV${i}`).textContent = value;
    hudCache[i] = [label, value];
  });
  // 限时模式最后 10 秒：数字变红并每秒响一声
  const warn = game?.mode === 'ultra' && isPlaying() && T.ULTRA_MS - game.elapsed <= 10000;
  $('hudV0').classList.toggle('warn', warn);
  if (warn && running()) {
    const sec = Math.ceil((T.ULTRA_MS - game.elapsed) / 1000);
    if (sec !== lastUltraSec) {
      lastUltraSec = sec;
      play('tap');
    }
  }
}

// ---------------------------------------------------------------- 主循环
let lastFrame = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = now - lastFrame;
  lastFrame = now;
  if (countdownUntil) updateCountdown(now);
  if (running()) {
    acc = Math.min(acc + dt, STEP * MAX_STEPS);
    while (acc >= STEP && running()) {
      acc -= STEP;
      autoShift();
      T.tick(game, STEP, held.soft);
      drain();
    }
  } else {
    acc = 0;
  }
  render(now);
  renderHud();
}

// ---------------------------------------------------------------- 新游戏面板
const levelGrid = $('levelGrid');
for (let i = 1; i <= 10; i++) {
  const btn = document.createElement('button');
  btn.dataset.level = i;
  btn.textContent = i;
  btn.setAttribute('data-sfx', 'select');
  levelGrid.append(btn);
}

function renderNew() {
  for (const btn of document.querySelectorAll('#modeList button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === pick.mode));
  }
  for (const btn of levelGrid.children) {
    btn.setAttribute('aria-pressed', String(Number(btn.dataset.level) === pick.level));
  }
  $('levelPick').hidden = pick.mode !== 'marathon';
  const best = loadStats()[pick.mode].best[0];
  $('newBest').textContent = !best
    ? '还没有成绩'
    : pick.mode === 'sprint'
      ? `最佳用时 ${fmtTime(best.ms, true)}`
      : `最高分 ${fmtNum(best.score)}`;
}

function openNew() {
  renderNew();
  $('newModal').hidden = false;
}

$('modeList').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-mode]');
  if (!btn) return;
  pick.mode = btn.dataset.mode;
  renderNew();
});

levelGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-level]');
  if (!btn) return;
  pick.level = Number(btn.dataset.level);
  renderNew();
});

$('newStart').addEventListener('click', () => newGame(pick.mode, pick.level));

// ---------------------------------------------------------------- 设置
function renderSettings() {
  const marks = [
    ['#layoutSelect', 'layout', (v) => v === settings.layout],
    ['#speedSelect', 'speed', (v) => v === settings.speed],
    ['#ghostSelect', 'ghost', (v) => (v === 'on') === settings.ghost],
    ['#padSelect', 'pad', (v) => (v === 'on') === settings.pad],
  ];
  for (const [sel, key, on] of marks) {
    for (const btn of document.querySelectorAll(`${sel} button`)) btn.setAttribute('aria-pressed', String(on(btn.dataset[key])));
  }
  pad.classList.toggle('swap', settings.layout === 'move');
  pad.hidden = !settings.pad;
}

function bindSetting(sel, key, parse) {
  $(sel).addEventListener('click', (e) => {
    const btn = e.target.closest(`button[data-${key}]`);
    if (!btn) return;
    settings[key] = parse(btn.dataset[key]);
    if (key === 'pad') padChosen = true;
    settingsStore.set({ ...settings, pad: padChosen ? settings.pad : undefined });
    renderSettings();
  });
}

bindSetting('layoutSelect', 'layout', (v) => v);
bindSetting('speedSelect', 'speed', (v) => v);
bindSetting('ghostSelect', 'ghost', (v) => v === 'on');
bindSetting('padSelect', 'pad', (v) => v === 'on');

// ---------------------------------------------------------------- 按钮与弹窗
$('pauseBtn').addEventListener('click', () => {
  play('select');
  if (isPlaying()) pause();
  else openNew();
});

$('helpBtn').addEventListener('click', () => {
  pause(false);
  $('helpModal').hidden = false;
});

$('pauseResume').addEventListener('click', resume);
$('pauseRestart').addEventListener('click', requestRestart);

$('confirmOk').addEventListener('click', () => {
  $('confirmModal').hidden = true;
  const action = confirmAction;
  confirmAction = null;
  action?.();
});

$('resultAgain').addEventListener('click', () => newGame(game.mode, game.startLevel));
$('resultMode').addEventListener('click', () => {
  $('resultModal').hidden = true;
  openNew();
});
$('resultClose').addEventListener('click', () => ($('resultModal').hidden = true));

// 关闭弹窗后：取消重新开始回到暂停菜单；关闭玩法说明则继续对局
function afterClose(id) {
  if (!paused || !isPlaying()) return;
  if (id === 'confirmModal') openPause();
  else if (id === 'helpModal' && !anyModalOpen()) resume();
}

for (const id of ['helpModal', 'confirmModal', 'pauseModal', 'newModal', 'resultModal']) {
  $(id).addEventListener('click', (e) => {
    const backdrop = e.target === e.currentTarget;
    if (!backdrop && !e.target.closest('[data-close]')) return;
    if (id === 'pauseModal') return resume();
    if (id === 'newModal' && !game) return;
    e.currentTarget.hidden = true;
    afterClose(id);
  });
}

// ---------------------------------------------------------------- 生命周期
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pause();
    save();
  }
});
window.addEventListener('blur', () => pause());
window.addEventListener('pagehide', save);
new ResizeObserver(layout).observe(playEl);

// ---------------------------------------------------------------- 启动
renderSettings();
layout();
const saved = T.restoreGame(stateStore.get());
if (saved) {
  game = saved;
  paused = true;
  well.classList.add('covered');
  openPause();
} else {
  openNew();
}

if (!helpStore.get()) {
  helpStore.set(true);
  $('helpModal').hidden = false;
}

requestAnimationFrame(frame);
