import { initPage, storage, toast } from '../../js/pwa.js';
import { play, isMuted } from '../../js/sfx.js';
import {
  DX,
  DY,
  FLOOR,
  WALL,
  createGame,
  step,
  push,
  undo,
  restart,
  aimedBox,
  findPath,
  serialize,
  restoreGame,
  levelKey,
  isUnlocked,
} from './engine.js';
import { LEVELS, CHAPTERS, LEVELS_VERSION } from './levels.js';

initPage();

const MAX_S = 56;
const MOVE_MS = 90;
const WALK_MS = 60;
const REPEAT_DELAY = 220;
const REPEAT_MS = 110;
const PUSH_DELAY = 300;
const PUSH_MS = 160;
const UNDO_DELAY = 400;
const UNDO_MS = 120;
const CENTER_RATIO = 0.38;
const SLOP = 16; // 必须与 sokoban.css 中 .dpad 的 padding 一致
const HYSTERESIS = 55; // 滑动时偏离当前方向轴线不超过此角度（45° + 10° 回差）就不切换
const GUARD_MS = 250; // 走到箱子跟前后，这段时间内的同方向按键视为连点，忽略
const WIN_MS = 900;
const DEAD_TOAST_GAP = 4000;

const stateStore = storage('h5.sokoban.state', null);
const progressStore = storage('h5.sokoban.progress', {});
const settingsStore = storage('h5.sokoban.settings', {});
const helpStore = storage('h5.sokoban.helpSeen', false);

const $ = (id) => document.getElementById(id);
const stageWrap = $('stageWrap');
const stage = $('stage');
const canvas = $('floorCanvas');
const sprites = $('sprites');
const controls = $('controls');
const dpad = $('dpad');
const face = $('dpadFace');
const pushBtn = $('pushBtn');
const undoBtn = $('undoBtn');
const wedges = [...document.querySelectorAll('.wedge')];

const settings = { direct: false, hand: 'right', dead: true, ...settingsStore.get() };
let progress = progressStore.get() || {};
let game = null;
let S = 0;
let playerEl = null;
let boxEls = new Map(); // 格子 index → 箱子元素
let busyUntil = 0;
let lastDeadToast = 0;
let arrivedAt = 0; // 最近一次走到箱子跟前（并对准）的时间

// ---------------------------------------------------------------- 工具
const busy = () => performance.now() < busyUntil;
const anyModalOpen = () => [...document.querySelectorAll('.modal')].some((m) => !m.hidden);
const canAct = () => game.status === 'playing' && !busy() && !anyModalOpen();
const rotOf = (dir) => `${(dir - 1) * 90}deg`;

function vibrate(pattern) {
  if (!isMuted()) navigator.vibrate?.(pattern);
}

function animate(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

const keyOf = (i) => levelKey(LEVELS[i].map);
const recordOf = (i) => progress[keyOf(i)] || null;

function maxSolved() {
  let m = -1;
  for (let i = 0; i < LEVELS.length; i++) if (recordOf(i)) m = i;
  return m;
}

function firstUnsolved() {
  for (let i = 0; i < LEVELS.length; i++) if (!recordOf(i)) return i;
  return LEVELS.length - 1;
}

const chapterOf = (i) => CHAPTERS.find((c) => i >= c.from && i < c.to) || CHAPTERS[0];

// ---------------------------------------------------------------- 精灵
const PLAYER_SVG =
  '<svg class="body" viewBox="0 0 40 40" aria-hidden="true">' +
  '<circle cx="20" cy="20" r="14.5" fill="#4f46e5" stroke="#3730a3" stroke-width="1.6"/>' +
  '<circle cx="24" cy="14.8" r="3.5" fill="#fff"/><circle cx="24" cy="25.2" r="3.5" fill="#fff"/>' +
  '<circle cx="25.4" cy="14.8" r="1.7" fill="#111827"/><circle cx="25.4" cy="25.2" r="1.7" fill="#111827"/></svg>';

const BOX_SVG =
  '<svg class="crate" viewBox="0 0 40 40" aria-hidden="true">' +
  '<rect x="4" y="4" width="32" height="32" rx="4" style="fill:var(--fill);stroke:var(--line)" stroke-width="2.8"/>' +
  '<path d="M8.5 8.5l23 23M31.5 8.5l-23 23" style="stroke:var(--line)" stroke-width="2.8" stroke-linecap="round"/>' +
  '<rect x="8.5" y="6.6" width="13" height="2.4" rx="1.2" fill="#fff" opacity="0.3"/></svg>' +
  '<div class="aim"><svg viewBox="0 0 24 24"><path d="M7 5l11 7-11 7z" fill="#fff" stroke="rgba(0,0,0,0.45)" stroke-width="1.5" stroke-linejoin="round"/></svg></div>';

function place(el, i) {
  el.style.setProperty('--x', i % game.w);
  el.style.setProperty('--y', Math.floor(i / game.w));
}

function buildSprites() {
  const frag = document.createDocumentFragment();
  boxEls = new Map();
  for (let i = 0; i < game.box.length; i++) {
    if (!game.box[i]) continue;
    const el = document.createElement('div');
    el.className = 'sprite box';
    el.innerHTML = BOX_SVG;
    place(el, i);
    boxEls.set(i, frag.appendChild(el));
  }
  playerEl = document.createElement('div');
  playerEl.className = 'sprite player';
  playerEl.innerHTML = PLAYER_SVG;
  place(playerEl, game.player);
  frag.appendChild(playerEl);
  sprites.replaceChildren(frag);
}

// 没有动画地把精灵放到当前局面（重来、撤销很多步之后用）
function snapSprites() {
  stage.classList.add('instant');
  buildSprites();
  render();
  requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.remove('instant')));
}

function moveBoxEl(from, to) {
  const el = boxEls.get(from);
  if (!el) return null;
  boxEls.delete(from);
  boxEls.set(to, el);
  place(el, to);
  return el;
}

// ---------------------------------------------------------------- 地图绘制
function drawFloor() {
  const { w, h, tiles, target } = game;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * S * dpr);
  canvas.height = Math.round(h * S * dpr);
  canvas.style.width = `${w * S}px`;
  canvas.style.height = `${h * S}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w * S, h * S);
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const floorColor = dark ? '#3b3a36' : '#e7e1d4';
  const lineColor = dark ? '#34332f' : '#ddd5c4';
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : tiles[y * w + x]);
  const nearFloor = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (at(x + dx, y + dy) === FLOOR) return true;
    return false;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = at(x, y);
      const px = x * S;
      const py = y * S;
      if (t === FLOOR) {
        ctx.fillStyle = floorColor;
        ctx.fillRect(px, py, S, S);
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, S - 1, S - 1);
        if (target[y * w + x]) {
          ctx.beginPath();
          ctx.arc(px + S / 2, py + S / 2, S * 0.18, 0, Math.PI * 2);
          ctx.fillStyle = dark ? 'rgba(249,115,22,0.3)' : '#fed7aa';
          ctx.fill();
          ctx.lineWidth = Math.max(1.5, S * 0.06);
          ctx.strokeStyle = '#f97316';
          ctx.stroke();
        }
      } else if (t === WALL && nearFloor(x, y)) {
        ctx.fillStyle = '#475569';
        ctx.fillRect(px, py, S, S);
        if (at(x, y - 1) !== WALL) {
          ctx.fillStyle = '#64748b';
          ctx.fillRect(px, py, S, Math.round(S * 0.16));
        }
        if (at(x, y + 1) !== WALL) {
          ctx.fillStyle = '#334155';
          ctx.fillRect(px, py + S - Math.round(S * 0.14), S, Math.round(S * 0.14));
        }
      }
    }
  }
}

// 格子边长按地图区大小自适应
function layout(force = false) {
  const cs = getComputedStyle(stageWrap);
  const availW = stageWrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = stageWrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const s = Math.max(12, Math.floor(Math.min(MAX_S, availW / game.w, availH / game.h)));
  if (s === S && !force) return;
  S = s;
  stage.classList.add('instant');
  stage.style.setProperty('--s', `${S}px`);
  stage.style.width = `${game.w * S}px`;
  stage.style.height = `${game.h * S}px`;
  drawFloor();
  requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.remove('instant')));
}

// ---------------------------------------------------------------- 状态显示
function render() {
  const i = game.index;
  const min = LEVELS[i].minPushes;
  $('hudChapter').textContent = `关卡 · ${chapterOf(i).name}`;
  $('hudLevel').textContent = `第 ${i + 1} 关`;
  $('hudMoves').textContent = game.moves;
  $('hudPushes').textContent = game.pushes;
  $('hudPushes').classList.toggle('perfect', game.status === 'won' && game.pushes === min);
  $('hudMin').textContent = ` · 最少 ${min}`;

  const aim = game.status === 'playing' ? aimedBox(game) : -1;
  for (const [idx, el] of boxEls) {
    const ok = !!game.target[idx];
    el.classList.toggle('ok', ok);
    el.classList.toggle('dead', !ok && settings.dead && !!game.dead[idx]);
    el.classList.toggle('aiming', idx === aim);
    el.style.setProperty('--rot', rotOf(game.facing));
  }
  playerEl.style.setProperty('--rot', rotOf(game.facing));
  pushBtn.classList.toggle('ready', aim >= 0);
  pushBtn.style.setProperty('--rot', rotOf(game.facing));
  pushBtn.setAttribute('aria-disabled', String(aim < 0));
  undoBtn.disabled = !game.history;
}

// ---------------------------------------------------------------- 存档与成绩
function save() {
  if (!game) return;
  stateStore.set(game.status === 'won' ? null : serialize(game, LEVELS_VERSION));
}

// 返回 { record: 是否刷新了已有的最佳, best }
function recordWin() {
  const key = keyOf(game.index);
  const old = progress[key];
  const perfect = game.pushes <= LEVELS[game.index].minPushes;
  const best = {
    moves: Math.min(old?.moves ?? Infinity, game.moves),
    pushes: Math.min(old?.pushes ?? Infinity, game.pushes),
    perfect: !!old?.perfect || perfect,
    date: old?.date || new Date().toISOString().slice(0, 10),
  };
  progress = { ...progressStore.get(), [key]: best };
  progressStore.set(progress);
  return { record: !!old && (game.moves < old.moves || game.pushes < old.pushes), best, perfect };
}

// ---------------------------------------------------------------- 关卡
function loadLevel(i, restored = null) {
  stopAll();
  game = restored || createGame(LEVELS[i].map, i);
  busyUntil = 0;
  stage.classList.remove('won');
  $('resultModal').hidden = true;
  stage.classList.add('instant');
  buildSprites();
  layout(true);
  render();
  save();
}

function doRestart() {
  stopAll();
  restart(game);
  stage.classList.remove('won');
  snapSprites();
  save();
}

function requestRestart() {
  if (!game.history || game.status === 'won') {
    doRestart();
    return;
  }
  $('confirmModal').hidden = false;
}

// ---------------------------------------------------------------- 动作
function afterPush(res) {
  const el = moveBoxEl(res.boxFrom, res.boxTo);
  place(playerEl, game.player);
  if (game.target[res.boxTo]) {
    play('place');
    animate(el, 'glow');
    vibrate(15);
  } else if (settings.dead && game.dead[res.boxTo]) {
    play('error');
    animate(el, 'shake');
    const now = performance.now();
    if (now - lastDeadToast > DEAD_TOAST_GAP) {
      lastDeadToast = now;
      toast('这个箱子推不出来了，撤销试试', 2000);
    }
  } else {
    play('move');
    vibrate(8);
  }
  if (game.status === 'won') win();
}

// 已对准（面朝推得动的箱子）时再按同方向 = 推；连续走、滑动永远不推
function allowPushFor(dir, { repeat, keyboard, aimOnly }) {
  if (repeat || aimOnly) return false;
  if (keyboard || settings.direct) return true;
  return game.facing === dir;
}

// 返回结果类型（'move' | 'push' | ...），被忽略或无效时返回 null
function doDir(dir, opts = {}) {
  if (!canAct()) return null;
  const { repeat = false, keyboard = false, aimOnly = false } = opts;
  if (
    !repeat && !keyboard && !settings.direct &&
    game.facing === dir && aimedBox(game, dir) >= 0 &&
    performance.now() - arrivedAt < GUARD_MS
  ) {
    return null;
  }
  const res = step(game, dir, allowPushFor(dir, { repeat, keyboard, aimOnly }));
  if (!res) return null;
  if (res.type === 'move') {
    place(playerEl, game.player);
    if (aimedBox(game) >= 0) arrivedAt = performance.now();
  } else if (res.type === 'push') {
    afterPush(res);
  } else if (res.type === 'aim') {
    if (!repeat) play('tap', 0, { volume: 0.5 });
  } else if (res.type === 'blocked') {
    if (!repeat) {
      play('error');
      animate(boxEls.get(res.boxFrom), 'shake');
    }
  } else if (res.type === 'bump' && !repeat) {
    playerEl.style.setProperty('--bx', `${(DX[dir] * S) / 6}px`);
    playerEl.style.setProperty('--by', `${(DY[dir] * S) / 6}px`);
    animate(playerEl, 'bump');
  }
  render();
  if (res.type === 'move' || res.type === 'push') save();
  return res.type;
}

// 返回推完后是否还能接着推
function doPush() {
  if (!canAct()) return false;
  const res = push(game);
  if (!res) {
    play('error');
    animate(pushBtn, 'shake');
    return false;
  }
  afterPush(res);
  render();
  save();
  return game.status === 'playing' && aimedBox(game) >= 0;
}

function doUndo(quiet = false) {
  if (busy() || anyModalOpen()) return false;
  const res = undo(game);
  if (!res) return false;
  if (res.type === 'push') moveBoxEl(res.boxFrom, res.boxTo);
  place(playerEl, game.player);
  stage.classList.remove('won');
  if (!quiet) play('tap');
  render();
  save();
  return true;
}

function win() {
  stopAll();
  busyUntil = performance.now() + WIN_MS;
  const result = recordWin();
  [...boxEls.entries()]
    .sort((a, b) => a[0] - b[0])
    .forEach(([, el], k) => {
      el.style.setProperty('--d', `${120 + k * 80}ms`);
      animate(el, 'hop');
    });
  animate(stage, 'won');
  play('win', 0.12);
  vibrate([30, 40, 60]);
  render();
  save();
  setTimeout(() => showResult(result), WIN_MS);
}

// ---------------------------------------------------------------- 自动走路
let walk = null;

function stopAutoWalk() {
  if (!walk) return false;
  clearTimeout(walk);
  walk = null;
  stage.style.setProperty('--t', `${MOVE_MS}ms`);
  return true;
}

function startAutoWalk(path) {
  stopAll();
  stage.style.setProperty('--t', `${WALK_MS}ms`);
  let k = 0;
  const tick = () => {
    if (k >= path.length || !canAct()) {
      stopAutoWalk();
      return;
    }
    const res = step(game, path[k++], false);
    if (!res || res.type !== 'move') {
      stopAutoWalk();
      render();
      return;
    }
    place(playerEl, game.player);
    render();
    save();
    walk = setTimeout(tick, WALK_MS);
  };
  tick();
}

stage.addEventListener('pointerdown', (e) => {
  if (!canAct()) return;
  const r = stage.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / S);
  const y = Math.floor((e.clientY - r.top) / S);
  if (x < 0 || y < 0 || x >= game.w || y >= game.h) return;
  if (stopAutoWalk()) return;
  const i = y * game.w + x;
  if (game.box[i]) {
    const dir = [0, 1, 2, 3].find((d) => game.player + DX[d] + DY[d] * game.w === i);
    if (dir !== undefined) doDir(dir, { aimOnly: true });
    return;
  }
  const path = findPath(game, i);
  if (path?.length) startAutoWalk(path);
});

// ---------------------------------------------------------------- 方向盘
// 按触点相对圆心的位置判定：中心圆 = 推；圆环按 45° 分成四个方向；外沿再往外 SLOP 以内也算
let dirPointer = null; // { id, dir }，dir 为 null 表示手指在中心或超出范围
let pushPointer = null;
let dirTimer = 0;
let pushTimer = 0;

// cur：滑动中的当前方向，偏离其轴线不超过 HYSTERESIS 时保持不变
function zoneAt(x, y, cur = null) {
  const r = face.getBoundingClientRect();
  const R = r.width / 2;
  const dx = x - (r.left + R);
  const dy = y - (r.top + R);
  const dist = Math.hypot(dx, dy);
  if (dist <= R * CENTER_RATIO) return 'push';
  if (dist > R + SLOP) return null;
  if (cur !== null) {
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const diff = Math.abs((((angle - (cur * 90 - 90)) % 360) + 540) % 360 - 180);
    if (diff <= HYSTERESIS) return cur;
  }
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 1 : 3;
  return dy > 0 ? 2 : 0;
}

function pressDir(dir, aimOnly = false) {
  stopAutoWalk();
  wedges[dir].classList.add('on');
  const type = doDir(dir, { aimOnly });
  if (type === 'move') {
    const loop = () => {
      dirTimer = doDir(dir, { repeat: true }) === 'move' ? setTimeout(loop, REPEAT_MS) : 0;
    };
    dirTimer = setTimeout(loop, REPEAT_DELAY);
  } else if (type === 'push' && game.status === 'playing' && aimedBox(game) >= 0) {
    const loop = () => {
      dirTimer = doPush() ? setTimeout(loop, PUSH_MS) : 0;
    };
    dirTimer = setTimeout(loop, PUSH_DELAY);
  }
}

function releaseDir() {
  clearTimeout(dirTimer);
  dirTimer = 0;
  for (const w of wedges) w.classList.remove('on');
}

function pressPush() {
  stopAutoWalk();
  pushBtn.classList.add('on');
  if (!doPush()) return;
  const loop = () => {
    pushTimer = doPush() ? setTimeout(loop, PUSH_MS) : 0;
  };
  pushTimer = setTimeout(loop, PUSH_DELAY);
}

function releasePush() {
  clearTimeout(pushTimer);
  pushTimer = 0;
  pushBtn.classList.remove('on');
}

function stopAll() {
  stopAutoWalk();
  releaseDir();
  releasePush();
  stopUndoRepeat();
}

dpad.addEventListener('pointerdown', (e) => {
  if (anyModalOpen()) return;
  const z = zoneAt(e.clientX, e.clientY);
  if (z === null) return;
  e.preventDefault();
  dpad.setPointerCapture?.(e.pointerId);
  if (z === 'push') {
    if (pushPointer !== null) return;
    pushPointer = e.pointerId;
    pressPush();
  } else {
    if (dirPointer) return;
    dirPointer = { id: e.pointerId, dir: z };
    pressDir(z);
  }
});

dpad.addEventListener('pointermove', (e) => {
  if (!dirPointer || dirPointer.id !== e.pointerId) return;
  const z = zoneAt(e.clientX, e.clientY, dirPointer.dir);
  const dir = typeof z === 'number' ? z : null;
  if (dir === dirPointer.dir) return;
  releaseDir();
  dirPointer.dir = dir;
  // 滑进中心不推；滑到另一个扇形只走路或转身，也不推
  if (dir !== null) pressDir(dir, true);
});

function endDpadPointer(e) {
  if (dirPointer?.id === e.pointerId) {
    releaseDir();
    dirPointer = null;
  }
  if (pushPointer === e.pointerId) {
    releasePush();
    pushPointer = null;
  }
}

dpad.addEventListener('pointerup', endDpadPointer);
dpad.addEventListener('pointercancel', endDpadPointer);
dpad.addEventListener('lostpointercapture', endDpadPointer);
dpad.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------------------------------------------------------------- 撤销（按住连续撤销）
let undoTimer = 0;

function stopUndoRepeat() {
  clearTimeout(undoTimer);
  undoTimer = 0;
  undoBtn.classList.remove('on');
}

undoBtn.addEventListener('pointerdown', (e) => {
  if (undoBtn.disabled) return;
  e.preventDefault();
  stopAutoWalk();
  undoBtn.classList.add('on');
  if (!doUndo()) return;
  const loop = () => {
    undoTimer = doUndo(true) ? setTimeout(loop, UNDO_MS) : 0;
  };
  undoTimer = setTimeout(loop, UNDO_DELAY);
});
for (const type of ['pointerup', 'pointercancel', 'pointerleave']) undoBtn.addEventListener(type, stopUndoRepeat);
// 键盘（Tab 到按钮再按回车 / 空格）触发的 click 没有对应的 pointerdown
undoBtn.addEventListener('click', (e) => e.detail === 0 && doUndo());
undoBtn.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------------------------------------------------------------- 键盘
const KEY_DIRS = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3, w: 0, d: 1, s: 2, a: 3 };

function gotoLevel(i) {
  if (i < 0 || i >= LEVELS.length || !isUnlocked(i, maxSolved())) return;
  play('select');
  loadLevel(i);
}

document.addEventListener('keydown', (e) => {
  if (anyModalOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key in KEY_DIRS) {
    e.preventDefault();
    stopAutoWalk();
    doDir(KEY_DIRS[key], { keyboard: true, repeat: e.repeat });
  } else if (key === ' ' || key === 'Enter') {
    if (document.activeElement?.closest?.('button, a')) return;
    e.preventDefault();
    stopAutoWalk();
    if (!e.repeat) doPush();
  } else if (key === 'z' || key === 'u' || key === 'Backspace') {
    e.preventDefault();
    stopAutoWalk();
    doUndo(e.repeat);
  } else if (key === 'r' && !e.repeat) {
    requestRestart();
  } else if (key === 'n') {
    gotoLevel(game.index + 1);
  } else if (key === 'p') {
    gotoLevel(game.index - 1);
  } else if (key === 'l') {
    openLevels();
  }
});

// ---------------------------------------------------------------- 弹窗
function statCells(items) {
  return items.map(([value, label]) => {
    const div = document.createElement('div');
    const b = document.createElement('b');
    const span = document.createElement('span');
    b.textContent = value;
    span.textContent = label;
    div.append(b, span);
    return div;
  });
}

function showResult({ record, best, perfect }) {
  const i = game.index;
  const last = i === LEVELS.length - 1;
  $('resultTitle').textContent = perfect ? '完美过关！' : '过关！';
  $('resultStar').textContent = perfect ? '★ 推动次数达到最少' : `离最少推动还差 ${game.pushes - LEVELS[i].minPushes} 次`;
  $('resultRecord').hidden = !record;
  $('resultStats').replaceChildren(
    ...statCells([
      [game.moves, '步数'],
      [game.pushes, '推动'],
      [LEVELS[i].minPushes, '最少推动'],
    ]),
  );
  $('resultBest').textContent = last
    ? `全部 ${LEVELS.length} 关通关！本关最佳：${best.moves} 步 · 推动 ${best.pushes}`
    : `本关最佳：${best.moves} 步 · 推动 ${best.pushes}`;
  $('resultNext').hidden = last;
  $('resultModal').hidden = false;
}

function openLevels() {
  const ms = maxSolved();
  let solved = 0;
  let perfect = 0;
  const list = $('levelsList');
  const frag = document.createDocumentFragment();
  for (const ch of CHAPTERS) {
    const h3 = document.createElement('h3');
    h3.textContent = `${ch.name} · 第 ${ch.from + 1}–${ch.to} 关`;
    const grid = document.createElement('div');
    grid.className = 'level-grid';
    for (let i = ch.from; i < ch.to; i++) {
      const rec = recordOf(i);
      const btn = document.createElement('button');
      btn.dataset.level = i;
      btn.textContent = i + 1;
      btn.disabled = !isUnlocked(i, ms);
      if (rec) {
        solved++;
        if (rec.perfect) perfect++;
        btn.classList.add(rec.perfect ? 'perfect' : 'solved');
        const mark = document.createElement('small');
        mark.textContent = rec.perfect ? '★' : '✓';
        btn.append(mark);
      }
      btn.classList.toggle('current', i === game.index);
      btn.setAttribute('aria-label', `第 ${i + 1} 关${btn.disabled ? '，未解锁' : rec ? (rec.perfect ? '，完美' : '，已通过') : ''}`);
      grid.append(btn);
    }
    frag.append(h3, grid);
  }
  list.replaceChildren(frag);
  $('levelsSummary').textContent = `已通过 ${solved} / ${LEVELS.length} · 完美 ${perfect}`;
  $('levelsModal').hidden = false;
  list.querySelector('.current')?.scrollIntoView({ block: 'center' });
}

$('levelsList').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-level]');
  if (!btn || btn.disabled) return;
  $('levelsModal').hidden = true;
  loadLevel(Number(btn.dataset.level));
});

$('levelsBtn').addEventListener('click', openLevels);
$('helpBtn').addEventListener('click', () => ($('helpModal').hidden = false));
$('settingsBtn').addEventListener('click', () => ($('settingsModal').hidden = false));
$('restartBtn').addEventListener('click', requestRestart);
$('confirmOk').addEventListener('click', () => {
  $('confirmModal').hidden = true;
  doRestart();
});
$('resultNext').addEventListener('click', () => loadLevel(game.index + 1));
$('resultAgain').addEventListener('click', () => loadLevel(game.index));
$('resultLevels').addEventListener('click', () => {
  $('resultModal').hidden = true;
  openLevels();
});

// 点遮罩关闭；过关弹窗关闭后可以回看局面
for (const id of ['levelsModal', 'resultModal', 'settingsModal', 'confirmModal', 'helpModal']) {
  $(id).addEventListener('click', (e) => {
    if (e.target === e.currentTarget || e.target.closest('[data-close]')) e.currentTarget.hidden = true;
  });
}

// ---------------------------------------------------------------- 设置
const coarse = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const padVisible = () => (settings.pad === undefined ? coarse() : settings.pad);

function applySettings() {
  controls.classList.toggle('left', settings.hand === 'left');
  dpad.hidden = !padVisible();
  const pressed = (sel, attr, value) => {
    for (const btn of document.querySelectorAll(`${sel} button`)) btn.setAttribute('aria-pressed', String(btn.dataset[attr] === value));
  };
  pressed('#directSelect', 'direct', settings.direct ? 'on' : 'off');
  pressed('#handSelect', 'hand', settings.hand);
  pressed('#padSelect', 'pad', padVisible() ? 'on' : 'off');
  pressed('#deadSelect', 'dead', settings.dead ? 'on' : 'off');
  if (game) {
    render();
    layout();
  }
}

function bindSetting(id, attr, apply) {
  $(id).addEventListener('click', (e) => {
    const btn = e.target.closest(`button[data-${attr}]`);
    if (!btn) return;
    apply(btn.dataset[attr]);
    settingsStore.set(settings);
    applySettings();
  });
}

bindSetting('directSelect', 'direct', (v) => (settings.direct = v === 'on'));
bindSetting('handSelect', 'hand', (v) => (settings.hand = v === 'left' ? 'left' : 'right'));
bindSetting('padSelect', 'pad', (v) => (settings.pad = v === 'on'));
bindSetting('deadSelect', 'dead', (v) => (settings.dead = v === 'on'));

// ---------------------------------------------------------------- 生命周期
sprites.addEventListener('animationend', (e) => {
  const el = e.target.closest?.('.sprite') || e.target;
  const cls = { shake: 'shake', hop: 'hop', glow: 'glow', bump: 'bump' }[e.animationName];
  if (cls) el.classList.remove(cls);
});
pushBtn.addEventListener('animationend', (e) => e.animationName === 'shake-c' && pushBtn.classList.remove('shake'));

window.addEventListener('pagehide', save);
window.addEventListener('blur', stopAll);
document.addEventListener('visibilitychange', () => document.hidden && (stopAll(), save()));
new ResizeObserver(() => game && layout()).observe(stageWrap);
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => game && drawFloor());

// ---------------------------------------------------------------- 启动
applySettings();
const saved = restoreGame(stateStore.get(), LEVELS, LEVELS_VERSION);
if (saved && isUnlocked(saved.index, maxSolved())) loadLevel(saved.index, saved);
else loadLevel(firstUnsolved());

if (!helpStore.get()) {
  helpStore.set(true);
  $('helpModal').hidden = false;
}
