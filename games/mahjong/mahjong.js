import { initPage, storage } from '../../js/pwa.js';
import { play } from '../../js/sfx.js';
import { chooseClaim, chooseDiscard, chooseSelfGang, shanten } from './ai.js';
import {
  NAMES,
  countTiles,
  createRound,
  doDiscard,
  doResponse,
  doSelfGang,
  doSelfHu,
  remaining,
  selfOptions,
  tileName,
} from './engine.js';
import { tileSvg } from './tiles.js';

initPage();

const scoreStore = storage('h5.mahjong.scores', [0, 0, 0]);
const dealerStore = storage('h5.mahjong.dealer', 0);

const $ = (id) => document.getElementById(id);
const statsEl = $('stats');
const poolEl = $('pool');
const hintEl = $('hint');
const actionsEl = $('actions');
const helpModal = $('helpModal');
const resultModal = $('resultModal');

let state = null;
let selected = null;
let tenpai = new Set();
let timer = 0;
let lock = false;

function rng() {
  return Math.random();
}

function loadScores() {
  const saved = scoreStore.get();
  if (!Array.isArray(saved) || saved.length !== 3 || saved.some((n) => !Number.isFinite(n))) return [0, 0, 0];
  return saved;
}

function loadDealer() {
  const dealer = dealerStore.get();
  return dealer === 0 || dealer === 1 || dealer === 2 ? dealer : 0;
}

function remember() {
  scoreStore.set(state.players.map((player) => player.score));
  const dealer = state.result?.kind === 'hu' ? state.result.winner : state.dealer;
  dealerStore.set(dealer);
}

function startRound(scores, dealer) {
  clearTimeout(timer);
  state = createRound(scores, dealer, rng);
  selected = null;
  tenpai = new Set();
  lock = false;
  resultModal.hidden = true;
  render();
  pump(true);
}

function pump(immediate) {
  if (!state || state.phase === 'end') {
    render();
    if (state?.phase === 'end') showResult();
    return;
  }
  if (needsHuman()) {
    if (state.phase === 'discard' && state.turn === 0) refreshTenpai();
    render();
    return;
  }
  render();
  timer = setTimeout(() => {
    if (lock) return;
    lock = true;
    try {
      stepAi();
    } finally {
      lock = false;
    }
    pump(false);
  }, immediate ? 160 : 480);
}

function needsHuman() {
  if (state.phase === 'discard' && state.turn === 0) return true;
  if (state.phase === 'claim' && state.claimPlayer === 0) return true;
  return false;
}

function stepAi() {
  if (state.phase === 'claim') {
    const action = chooseClaim(state);
    doResponse(state, action);
    if (state.phase !== 'end' && action === 'peng') play('place');
    if (state.phase !== 'end' && action === 'gang') play('chip');
    return;
  }
  if (state.phase === 'discard') {
    const options = selfOptions(state);
    if (options.hu) {
      doSelfHu(state);
      return;
    }
    const gang = chooseSelfGang(state);
    if (gang) {
      doSelfGang(state, gang);
      play('chip');
      return;
    }
    const tile = chooseDiscard(state.players[state.turn].concealed, state.players[state.turn].melds, rng);
    doDiscard(state, tile);
    play('card');
  }
}

function refreshTenpai() {
  tenpai = new Set();
  const hand = state.players[0];
  const seen = new Set();
  for (const tile of hand.concealed) {
    if (seen.has(tile)) continue;
    seen.add(tile);
    const next = hand.concealed.slice();
    next.splice(next.indexOf(tile), 1);
    if (shanten(countTiles(next), hand.melds.length) <= 0) tenpai.add(tile);
  }
}

function render() {
  renderStats();
  for (let seat = 0; seat < 3; seat++) renderSeat(seat);
  renderPool();
  renderHint();
  renderActions();
}

function renderStats() {
  statsEl.replaceChildren();
  for (let seat = 0; seat < 3; seat++) {
    const box = document.createElement('div');
    const active = state.phase !== 'end' && (state.phase === 'claim' ? state.claimPlayer === seat : state.turn === seat);
    box.className = `stat p${seat}${seat === state.dealer ? ' dealer' : ''}${active ? ' active' : ''}`;
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = NAMES[seat];
    const value = document.createElement('div');
    value.className = 'value';
    value.textContent = String(state.players[seat].score);
    box.append(label, value);
    statsEl.append(box);
  }
}

function renderSeat(seat) {
  const root = document.getElementById(`seat${seat}`);
  const player = state.players[seat];
  root.classList.toggle('active', state.phase !== 'end' && state.phase !== 'claim' && state.turn === seat);
  root.replaceChildren();

  if (seat !== 0) {
    const head = document.createElement('div');
    head.className = 'side-head';
    head.textContent = NAMES[seat];
    const count = document.createElement('small');
    count.textContent = `${player.concealed.length}张`;
    head.append(count);
    root.append(head);
    for (const meld of player.melds) root.append(renderMeld(meld, true));
    const backs = document.createElement('div');
    backs.className = 'back-col';
    for (let i = 0; i < player.concealed.length; i++) backs.append(makeTile(0, { back: true, lie: true }));
    root.append(backs);
    return;
  }

  const head = document.createElement('div');
  head.className = 'seat-head';
  const name = document.createElement('span');
  name.textContent = NAMES[0];
  const meta = document.createElement('span');
  meta.textContent = `余 ${remaining(state)} 张`;
  head.append(name, meta);
  root.append(head);

  const row = document.createElement('div');
  row.className = 'self-row';
  row.append(renderHand(player));
  if (player.melds.length) {
    const melds = document.createElement('div');
    melds.className = 'meld-row';
    for (const meld of player.melds) melds.append(renderMeld(meld, false));
    row.append(melds);
  }
  root.append(row);
}

function renderMeld(meld, lie) {
  const group = document.createElement('div');
  group.className = 'meld';
  const copies = meld.type === 'peng' ? 3 : 4;
  for (let i = 0; i < copies; i++) {
    const hidden = meld.type === 'angang' && i !== 1;
    group.append(makeTile(meld.tile, { mini: !lie, lie, back: hidden }));
  }
  return group;
}

function renderPool() {
  poolEl.replaceChildren();
  if (!state.pool.length) {
    const empty = document.createElement('p');
    empty.className = 'pool-empty';
    empty.textContent = '打出的牌按顺序排在这里';
    poolEl.append(empty);
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'pool-grid';
  state.pool.forEach((item, index) => {
    const last = state.lastDiscard && index === state.pool.length - 1;
    const tile = makeTile(item.tile, { last, label: `${NAMES[item.from]}打出${tileName(item.tile)}` });
    tile.classList.add(`p${item.from}`);
    tile.tabIndex = -1;
    grid.append(tile);
  });
  poolEl.append(grid);
  grid.lastElementChild.scrollIntoView({ block: 'nearest' });
}

function renderHand(player) {
  const row = document.createElement('div');
  row.className = 'hand';
  const tiles = player.concealed;
  const drawnAt =
    state.phase === 'discard' && state.turn === 0 && state.drawn != null ? tiles.lastIndexOf(state.drawn) : -1;
  const order = tiles.map((_, index) => index).filter((index) => index !== drawnAt);
  if (drawnAt >= 0) order.push(drawnAt);
  for (const index of order) {
    const tile = tiles[index];
    const button = makeTile(tile, {
      selected: selected === index,
      fresh: index === drawnAt,
      tenpai: tenpai.has(tile),
      label: tileName(tile),
    });
    button.addEventListener('click', () => onTile(index));
    row.append(button);
  }
  return row;
}

function makeTile(tile, options = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tile';
  button.dataset.sfx = 'none';
  if (options.mini) button.classList.add('mini');
  if (options.lie) button.classList.add('lie');
  if (options.back) {
    button.classList.add('back');
    button.tabIndex = -1;
    button.setAttribute('aria-hidden', 'true');
    return button;
  }
  if (options.selected) button.classList.add('on');
  if (options.fresh) button.classList.add('fresh');
  if (options.tenpai) button.classList.add('tenpai');
  if (options.last) button.classList.add('last');
  const face = document.createElement('span');
  face.className = 'face';
  face.innerHTML = tileSvg(tile);
  button.append(face);
  button.setAttribute('aria-label', options.label || tileName(tile));
  return button;
}

function renderHint() {
  if (state.phase === 'end') {
    hintEl.textContent = state.result.kind === 'draw' ? '牌摸完了' : '这局结束';
    return;
  }
  if (state.phase === 'claim' && state.claimPlayer === 0) {
    const who = NAMES[state.lastDiscard.from];
    const tile = tileName(state.lastDiscard.tile);
    if (state.options.hu) hintEl.textContent = `${who}打出${tile}，可以胡`;
    else if (state.options.gang && state.options.peng) hintEl.textContent = `${who}打出${tile}，可以碰或杠`;
    else if (state.options.gang) hintEl.textContent = `${who}打出${tile}，可以杠`;
    else hintEl.textContent = `${who}打出${tile}，可以碰`;
    return;
  }
  if (state.phase === 'claim') {
    hintEl.textContent = `${NAMES[state.claimPlayer]}正在看这张牌`;
    return;
  }
  if (state.turn === 0) {
    const options = selfOptions(state);
    if (state.gangDraw) hintEl.textContent = options.hu ? '杠上开花，可以胡' : '杠后来了一张牌';
    else if (options.hu) hintEl.textContent = '可以胡，也可以先打出一张';
    else if (selected != null) hintEl.textContent = `打出${tileName(state.players[0].concealed[selected])}`;
    else hintEl.textContent = tenpai.size ? '红点的牌打出后听牌' : '点一张牌，再点一次打出';
    return;
  }
  hintEl.textContent = `${NAMES[state.turn]}出牌`;
}

function renderActions() {
  actionsEl.replaceChildren();
  if (state.phase === 'end') return;
  if (state.phase === 'claim' && state.claimPlayer === 0) {
    if (state.options.hu) actionsEl.append(actionButton('胡', 'primary', () => respond('hu')));
    if (state.options.peng) actionsEl.append(actionButton('碰', '', () => respond('peng')));
    if (state.options.gang) actionsEl.append(actionButton('杠', '', () => respond('gang')));
    actionsEl.append(actionButton('过', '', () => respond('pass')));
    return;
  }
  if (state.phase === 'discard' && state.turn === 0) {
    const options = selfOptions(state);
    if (options.hu) actionsEl.append(actionButton('胡', 'primary', () => selfHu()));
    for (const choice of options.gangs) {
      const label = `${choice.kind === 'an' ? '暗杠' : '补杠'} ${tileName(choice.tile)}`;
      actionsEl.append(actionButton(label, '', () => selfGang(choice)));
    }
    if (selected != null) actionsEl.append(actionButton('打出', 'primary', () => playSelected()));
  }
}

function actionButton(text, kind, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn${kind ? ` ${kind}` : ''}`;
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

function onTile(index) {
  if (lock || state.phase !== 'discard' || state.turn !== 0) return;
  if (selected === index) {
    playSelected();
    return;
  }
  selected = index;
  play('select');
  render();
}

function playSelected() {
  if (selected == null || lock) return;
  const tile = state.players[0].concealed[selected];
  lock = true;
  try {
    doDiscard(state, tile);
    selected = null;
    tenpai = new Set();
    play('card');
  } finally {
    lock = false;
  }
  pump(false);
}

function selfHu() {
  if (lock) return;
  lock = true;
  try {
    doSelfHu(state);
  } finally {
    lock = false;
  }
  pump(true);
}

function selfGang(choice) {
  if (lock) return;
  lock = true;
  try {
    doSelfGang(state, choice);
    selected = null;
    play('chip');
  } finally {
    lock = false;
  }
  pump(true);
}

function respond(action) {
  if (lock) return;
  lock = true;
  try {
    doResponse(state, action);
    if (state.phase !== 'end' && action === 'peng') play('place');
    else if (state.phase !== 'end' && action === 'gang') play('chip');
    selected = null;
  } finally {
    lock = false;
  }
  pump(false);
}

function showResult() {
  remember();
  const result = state.result;
  const title = $('resultTitle');
  const detail = $('resultDetail');
  const hand = $('resultHand');
  const scores = $('resultScores');
  hand.replaceChildren();
  if (!state.announced) {
    state.announced = true;
    if (result.kind === 'draw') play('draw');
    else play(result.winner === 0 ? 'win' : 'lose');
  }
  if (result.kind === 'draw') {
    title.textContent = '流局';
    detail.textContent = '牌摸完了，没人胡。已经结过的杠分留在本局输赢里。';
  } else {
    const how = result.selfDraw ? '自摸' : `点炮 · ${NAMES[result.from]}`;
    title.textContent = `${NAMES[result.winner]}${result.selfDraw ? '自摸' : '胡了'}`;
    detail.textContent = `${result.names.join(' · ')} ×${result.fan}　${how}`;
    const winner = state.players[result.winner];
    for (const meld of winner.melds) {
      const copies = meld.type === 'peng' ? 3 : 4;
      for (let i = 0; i < copies; i++) hand.append(makeTile(meld.tile, { mini: true }));
    }
    for (const tile of winner.concealed) hand.append(makeTile(tile, { mini: true }));
  }
  scores.textContent = [0, 1, 2]
    .map((seat) => {
      const delta = result.deltas[seat];
      const sign = delta > 0 ? `+${delta}` : String(delta);
      return `${NAMES[seat]} ${sign}`;
    })
    .join('　');
  resultModal.hidden = false;
}

$('helpBtn').addEventListener('click', () => {
  helpModal.hidden = false;
});
helpModal.addEventListener('click', (event) => {
  if (event.target === helpModal || event.target.closest('[data-close]')) helpModal.hidden = true;
});
$('resetBtn').addEventListener('click', () => {
  helpModal.hidden = true;
  scoreStore.set([0, 0, 0]);
  dealerStore.set(0);
  startRound([0, 0, 0], 0);
});
$('nextBtn').addEventListener('click', () => {
  const scores = state.players.map((player) => player.score);
  const dealer = state.result.kind === 'hu' ? state.result.winner : state.dealer;
  startRound(scores, dealer);
});

startRound(loadScores(), loadDealer());
