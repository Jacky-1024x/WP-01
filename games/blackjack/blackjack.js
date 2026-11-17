import { initPage, storage, toast } from '../../js/pwa.js';
import {
  createGame,
  deal,
  hit,
  stand,
  double,
  split,
  dealerStep,
  handValue,
  isBlackjack,
  canHit,
  canDouble,
  canSplit,
  rankOf,
  suitOf,
} from './engine.js';

initPage();

const START_BANKROLL = 1000;
const MIN_CHIP = 10;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
// U+FE0E 强制文本样式，避免 iOS 把 ♥♦ 渲染成 emoji
const SUITS = ['♠\uFE0E', '♥\uFE0E', '♦\uFE0E', '♣\uFE0E'];
const RESULT_TEXT = { blackjack: 'Blackjack', win: '赢', push: '平局', lose: '输', bust: '爆牌' };

const stateStore = storage('h5.blackjack.state', null);
const statsStore = storage('h5.blackjack.stats', null);

const $ = (id) => document.getElementById(id);
const table = $('table');
const dealerCardsEl = $('dealerCards');
const dealerTotalEl = $('dealerTotal');
const handsEl = $('playerHands');
const messageEl = $('message');

let game;
let pendingBet = 0;
let lastBet = 0;
let message = { text: '选择筹码下注', tone: '' };
let busy = false;
let stats;
let seen = new Set();

function defaultStats() {
  return { hands: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, best: START_BANKROLL, bailouts: 0 };
}

function isValidGame(g) {
  return (
    g &&
    Number.isFinite(g.bankroll) &&
    g.bankroll >= 0 &&
    Array.isArray(g.shoe) &&
    Array.isArray(g.dealer) &&
    Array.isArray(g.hands) &&
    ['betting', 'player', 'dealer'].includes(g.phase) &&
    (g.phase !== 'player' || (g.hands[g.active] && !g.hands[g.active].done))
  );
}

function save() {
  stateStore.set({ game, pendingBet, lastBet, message });
  statsStore.set(stats);
}

function restore() {
  stats = { ...defaultStats(), ...(statsStore.get() || {}) };
  const s = stateStore.get();
  if (s && isValidGame(s.game)) {
    game = s.game;
    pendingBet = Math.min(s.pendingBet || 0, game.bankroll);
    lastBet = s.lastBet || 0;
    if (s.message) message = s.message;
  } else {
    game = createGame(START_BANKROLL);
  }
  render();
  if (game.phase === 'dealer') runDealer();
}

function cardEl(c, hidden) {
  const el = document.createElement('div');
  el.className = 'card';
  if (hidden) {
    el.classList.add('back');
    return el;
  }
  const suit = suitOf(c);
  if (suit === 1 || suit === 2) el.classList.add('red');
  const corner = document.createElement('span');
  corner.className = 'corner';
  corner.append(RANKS[rankOf(c)], document.createElement('br'), SUITS[suit]);
  const pip = document.createElement('span');
  pip.className = 'pip';
  pip.textContent = SUITS[suit];
  el.append(corner, pip);
  return el;
}

// 只给新出现的牌（含翻开的暗牌）加发牌动画，并按出现顺序错开
function renderCards(container, cards, prefix, hideFrom = Infinity) {
  container.innerHTML = '';
  let fresh = 0;
  cards.forEach((c, i) => {
    const hidden = i >= hideFrom;
    const el = cardEl(c, hidden);
    const key = `${prefix}:${i}:${c}:${hidden}`;
    if (!seen.has(key)) {
      seen.add(key);
      el.classList.add('deal');
      el.style.animationDelay = `${fresh++ * 90}ms`;
    }
    container.appendChild(el);
  });
  return fresh;
}

function totalText(cards) {
  const { total, soft } = handValue(cards);
  if (isBlackjack(cards)) return '21';
  if (total > 21) return `${total} 爆`;
  return soft && total < 21 ? `${total - 10}/${total}` : String(total);
}

function signed(n) {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0';
}

function render() {
  const holeHidden = game.phase === 'player';
  renderCards(dealerCardsEl, game.dealer, 'd', holeHidden ? 1 : Infinity);
  dealerTotalEl.hidden = game.dealer.length === 0;
  dealerTotalEl.textContent = holeHidden ? totalText(game.dealer.slice(0, 1)) : totalText(game.dealer);

  handsEl.innerHTML = '';
  const multi = game.hands.length > 1;
  game.hands.forEach((h, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'hand';
    if (multi && i === game.active) wrap.classList.add('active');
    const cards = document.createElement('div');
    cards.className = 'cards';
    renderCards(cards, h.cards, `h${i}`);
    const info = document.createElement('div');
    info.className = 'hand-info';
    const total = document.createElement('span');
    total.className = 'total-pill';
    total.textContent = totalText(h.cards);
    const bet = document.createElement('span');
    bet.className = 'hand-bet';
    bet.textContent = `注 ${h.bet}${h.doubled ? ' ×2' : ''}`;
    info.append(total, bet);
    wrap.append(cards, info);
    if (h.result) {
      const res = document.createElement('div');
      res.className = `result ${h.result}`;
      const net = h.payout - h.bet;
      res.textContent = h.result === 'push' ? '平局' : `${RESULT_TEXT[h.result]} ${signed(net)}`;
      wrap.appendChild(res);
    }
    handsEl.appendChild(wrap);
  });

  messageEl.textContent = message.text;
  messageEl.className = `message ${message.tone}`;

  const betting = game.phase === 'betting';
  const available = betting ? game.bankroll - pendingBet : game.bankroll;
  $('bankroll').textContent = available;
  $('bet').textContent = betting ? pendingBet : game.hands.reduce((s, h) => s + h.bet, 0);
  $('best').textContent = stats.best;

  $('betControls').hidden = !betting;
  $('playControls').hidden = betting;
  for (const chip of document.querySelectorAll('#chips .chip')) {
    chip.disabled = busy || Number(chip.dataset.chip) > available;
  }
  const broke = betting && game.bankroll < MIN_CHIP;
  $('clearBtn').disabled = busy || pendingBet === 0;
  $('dealBtn').disabled = busy || (!broke && pendingBet === 0);
  $('dealBtn').textContent = broke ? `领取 ${START_BANKROLL} 筹码` : '发牌';
  $('hitBtn').disabled = busy || !canHit(game);
  $('standBtn').disabled = busy || !canHit(game);
  $('doubleBtn').disabled = busy || !canDouble(game);
  $('splitBtn').disabled = busy || !canSplit(game);

  layout();
}

function layout() {
  const w = table.clientWidth - 20;
  const h = table.clientHeight - 28;
  const n = Math.max(1, game.hands.length);
  const maxCards = Math.max(4, game.dealer.length, ...game.hands.map((x) => x.cards.length));
  const perHand = (w - (n - 1) * 8) / n - 12;
  const byWidth = perHand / (1 + 0.45 * (maxCards - 1));
  const byHeight = (h - 150) / 2.8;
  const cw = Math.max(34, Math.min(96, byWidth, byHeight));
  table.style.setProperty('--cw', `${Math.floor(cw)}px`);
}

function playerMessage() {
  if (game.hands.length > 1) return { text: `第 ${game.active + 1} / ${game.hands.length} 手`, tone: '' };
  return { text: '', tone: '' };
}

function onSettled() {
  let net = 0;
  for (const h of game.hands) {
    net += h.payout - h.bet;
    stats.hands++;
    if (h.result === 'win' || h.result === 'blackjack') stats.wins++;
    else if (h.result === 'push') stats.pushes++;
    else stats.losses++;
    if (h.result === 'blackjack') stats.blackjacks++;
  }
  stats.best = Math.max(stats.best, game.bankroll);
  const dealerBJ = isBlackjack(game.dealer);
  const playerBJ = game.hands.some((h) => h.result === 'blackjack');
  let text;
  if (playerBJ) text = `Blackjack！${signed(net)}`;
  else if (dealerBJ) text = `庄家 Blackjack ${signed(net)}`;
  else if (net > 0) text = `你赢了 ${signed(net)}`;
  else if (net < 0) text = `你输了 ${signed(net)}`;
  else text = '平局';
  message = { text, tone: net > 0 ? 'win' : net < 0 ? 'lose' : '' };
  if (game.bankroll < MIN_CHIP) message = { text: `${text} · 筹码已输光`, tone: 'lose' };
  pendingBet = lastBet <= game.bankroll ? lastBet : 0;
  if (navigator.vibrate) navigator.vibrate(net > 0 ? [12, 60, 12] : 10);
}

function runDealer() {
  busy = true;
  message = { text: '庄家补牌…', tone: '' };
  render();
  save();
  const step = () => {
    const drew = dealerStep(game);
    if (!drew) {
      busy = false;
      onSettled();
    }
    render();
    save();
    if (drew) setTimeout(step, 550);
  };
  setTimeout(step, 650);
}

function afterAction() {
  if (game.phase === 'dealer') return runDealer();
  if (game.phase === 'betting') onSettled();
  else message = playerMessage();
  render();
  save();
}

function onDeal() {
  if (busy || game.phase !== 'betting') return;
  if (game.bankroll < MIN_CHIP) {
    game.bankroll = START_BANKROLL;
    stats.bailouts++;
    pendingBet = 0;
    lastBet = 0;
    message = { text: `已领取 ${START_BANKROLL} 筹码`, tone: '' };
    render();
    save();
    return;
  }
  if (pendingBet <= 0) return;
  seen = new Set();
  deal(game, pendingBet);
  lastBet = pendingBet;
  if (game.shuffled) toast('牌靴已重新洗牌');
  if (navigator.vibrate) navigator.vibrate(8);
  afterAction();
}

function act(fn, allowed) {
  if (busy || !allowed(game)) return;
  fn(game);
  if (navigator.vibrate) navigator.vibrate(8);
  afterAction();
}

$('chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip || chip.disabled || busy || game.phase !== 'betting') return;
  pendingBet += Number(chip.dataset.chip);
  message = { text: '点「发牌」开始', tone: '' };
  render();
  save();
});
$('clearBtn').addEventListener('click', () => {
  if (busy) return;
  pendingBet = 0;
  message = { text: '选择筹码下注', tone: '' };
  render();
  save();
});
$('dealBtn').addEventListener('click', onDeal);
$('hitBtn').addEventListener('click', () => act(hit, canHit));
$('standBtn').addEventListener('click', () => act(stand, canHit));
$('doubleBtn').addEventListener('click', () => act(double, canDouble));
$('splitBtn').addEventListener('click', () => act(split, canSplit));

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || !$('helpModal').hidden) return;
  const key = e.key.toLowerCase();
  if (key === 'h') act(hit, canHit);
  else if (key === 's') act(stand, canHit);
  else if (key === 'd') act(double, canDouble);
  else if (key === 'p') act(split, canSplit);
  else if (key === 'enter') {
    e.preventDefault();
    onDeal();
  }
});

function renderStatsLine() {
  const rate = stats.hands ? Math.round((stats.wins / stats.hands) * 100) : 0;
  $('statsLine').textContent = stats.hands
    ? `战绩：共 ${stats.hands} 手，胜 ${stats.wins} / 负 ${stats.losses} / 平 ${stats.pushes}（胜率 ${rate}%），Blackjack ${stats.blackjacks} 次`
    : '';
}

$('helpBtn').addEventListener('click', () => {
  renderStatsLine();
  $('helpModal').hidden = false;
});
$('helpModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget || e.target.closest('[data-close]')) e.currentTarget.hidden = true;
});

window.addEventListener('pagehide', save);
new ResizeObserver(layout).observe(table);

restore();
