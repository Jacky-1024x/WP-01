// 21 点纯逻辑（无 DOM 依赖，可在 node 中测试）。
// 牌用 0..51 的整数表示：rank = c % 13（0=A，1..9 为 2..10，10/11/12 为 J/Q/K），suit = Math.floor(c / 13)。
// 规则：6 副牌，剩余不足 1/4 时发牌前重新洗牌；庄家软 17 停牌；Blackjack 赔 3:2；
// 庄家明牌为 A 或 10 点时先查暗牌，庄家 Blackjack 则直接结算；
// 任意两张可加倍（含分牌后）；同点数可分牌，最多分到 4 手；分 A 后每手只补一张，分牌后的 21 点不算 Blackjack。

export const DECKS = 6;
export const MAX_HANDS = 4;
const RESHUFFLE_AT = 0.25;
const PAYOUT = { blackjack: 2.5, win: 2, push: 1, lose: 0, bust: 0 };

export const rankOf = (c) => c % 13;
export const suitOf = (c) => Math.floor(c / 13);

export function cardValue(c) {
  const r = rankOf(c);
  return r === 0 ? 1 : Math.min(r + 1, 10);
}

export function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const v = cardValue(c);
    total += v;
    if (v === 1) aces++;
  }
  const soft = aces > 0 && total + 10 <= 21;
  return { total: soft ? total + 10 : total, soft };
}

export const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21;

// 软 17 停牌
export const dealerShouldHit = (cards) => handValue(cards).total < 17;

export function createShoe(decks = DECKS, rng = Math.random) {
  const shoe = [];
  for (let d = 0; d < decks; d++) for (let c = 0; c < 52; c++) shoe.push(c);
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

// phase: 'betting'（可下注，桌上保留上一局的牌）| 'player'（玩家行动）| 'dealer'（庄家补牌）
export function createGame(bankroll = 1000, rng = Math.random) {
  return {
    bankroll,
    shoe: createShoe(DECKS, rng),
    shoeSize: DECKS * 52,
    shuffled: false,
    phase: 'betting',
    dealer: [],
    hands: [],
    active: -1,
  };
}

function newHand(cards, bet) {
  return { cards, bet, done: false, doubled: false, split: false, result: null, payout: 0 };
}

const draw = (state) => state.shoe.pop();

function autoDone(hand) {
  if (handValue(hand.cards).total >= 21) hand.done = true;
}

export const currentHand = (state) => (state.phase === 'player' ? state.hands[state.active] : null);

export function canHit(state) {
  return !!currentHand(state);
}

export function canDouble(state) {
  const h = currentHand(state);
  return !!h && h.cards.length === 2 && state.bankroll >= h.bet;
}

export function canSplit(state) {
  const h = currentHand(state);
  return (
    !!h &&
    h.cards.length === 2 &&
    cardValue(h.cards[0]) === cardValue(h.cards[1]) &&
    state.hands.length < MAX_HANDS &&
    state.bankroll >= h.bet
  );
}

export function deal(state, bet, rng = Math.random) {
  if (state.phase !== 'betting') throw new Error('当前不能发牌');
  if (!(bet > 0) || bet > state.bankroll) throw new Error('下注金额无效');
  state.shuffled = state.shoe.length < state.shoeSize * RESHUFFLE_AT;
  if (state.shuffled) state.shoe = createShoe(state.shoeSize / 52, rng);
  state.bankroll -= bet;
  const hand = newHand([], bet);
  state.hands = [hand];
  state.dealer = [];
  state.active = 0;
  hand.cards.push(draw(state));
  state.dealer.push(draw(state));
  hand.cards.push(draw(state));
  state.dealer.push(draw(state));
  if (isBlackjack(state.dealer) || isBlackjack(hand.cards)) return settle(state);
  state.phase = 'player';
  return state;
}

export function hit(state) {
  if (!canHit(state)) throw new Error('当前不能要牌');
  const hand = currentHand(state);
  hand.cards.push(draw(state));
  autoDone(hand);
  return advance(state);
}

export function stand(state) {
  if (!canHit(state)) throw new Error('当前不能停牌');
  currentHand(state).done = true;
  return advance(state);
}

export function double(state) {
  if (!canDouble(state)) throw new Error('当前不能加倍');
  const hand = currentHand(state);
  state.bankroll -= hand.bet;
  hand.bet *= 2;
  hand.doubled = true;
  hand.cards.push(draw(state));
  hand.done = true;
  return advance(state);
}

export function split(state) {
  if (!canSplit(state)) throw new Error('当前不能分牌');
  const hand = currentHand(state);
  const [a, b] = hand.cards;
  state.bankroll -= hand.bet;
  const second = newHand([b, draw(state)], hand.bet);
  hand.cards = [a, draw(state)];
  hand.split = second.split = true;
  if (cardValue(a) === 1) {
    hand.done = second.done = true;
  } else {
    autoDone(hand);
    autoDone(second);
  }
  state.hands.splice(state.active + 1, 0, second);
  return advance(state);
}

function advance(state) {
  while (state.active < state.hands.length && state.hands[state.active].done) state.active++;
  if (state.active < state.hands.length) return state;
  state.active = -1;
  if (state.hands.every((h) => handValue(h.cards).total > 21)) return settle(state);
  state.phase = 'dealer';
  return state;
}

// 庄家补一张牌；无需补牌时结算本局。返回是否补了牌。
export function dealerStep(state) {
  if (state.phase !== 'dealer') return false;
  if (dealerShouldHit(state.dealer)) {
    state.dealer.push(draw(state));
    return true;
  }
  settle(state);
  return false;
}

export function playDealer(state) {
  while (dealerStep(state));
  return state;
}

function settle(state) {
  const dealerTotal = handValue(state.dealer).total;
  const dealerBJ = isBlackjack(state.dealer);
  for (const h of state.hands) {
    const total = handValue(h.cards).total;
    const playerBJ = !h.split && isBlackjack(h.cards);
    let result;
    if (total > 21) result = 'bust';
    else if (playerBJ && !dealerBJ) result = 'blackjack';
    else if (dealerBJ) result = playerBJ ? 'push' : 'lose';
    else if (dealerTotal > 21 || total > dealerTotal) result = 'win';
    else if (total === dealerTotal) result = 'push';
    else result = 'lose';
    h.result = result;
    h.payout = Math.floor(h.bet * PAYOUT[result]);
    h.done = true;
    state.bankroll += h.payout;
  }
  state.active = -1;
  state.phase = 'betting';
  return state;
}
