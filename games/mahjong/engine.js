// 湖北三人卡五星。纯规则，不碰界面。
// 牌：0–8 一条到九条，9–17 一筒到九筒，18 红中、19 发财、20 白板。各 4 张，共 84 张。
// 不能吃。红中、发财、白板都是普通牌。
// 自己摸到，牌型成立就能胡。别人打出的牌，只有卡五星、杠上炮、碰碰胡、大胡、暗四归能胡。

export const TILE_COUNT = 21;
export const COPIES = 4;
export const NAMES = ['你', '下家', '上家'];

const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const HONOR = ['红中', '发财', '白板'];

export function tileName(tile) {
  if (tile < 9) return `${CN[tile]}条`;
  if (tile < 18) return `${CN[tile - 9]}筒`;
  return HONOR[tile - 18];
}

export function tileSuit(tile) {
  if (tile < 9) return 'bamboo';
  if (tile < 18) return 'dot';
  return tile === 18 ? 'zhong' : tile === 19 ? 'fa' : 'bai';
}

export function countTiles(tiles) {
  const counts = new Array(TILE_COUNT).fill(0);
  for (const tile of tiles) counts[tile]++;
  return counts;
}

function removeTiles(tiles, tile, n) {
  for (let i = 0; i < n; i++) {
    const at = tiles.indexOf(tile);
    if (at < 0) throw new Error(`手牌里没有 ${tileName(tile)}`);
    tiles.splice(at, 1);
  }
}

function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function nextSeat(player) {
  return (player + 1) % 3;
}

/** 出牌前手里应有的张数（不含已经摆出的面子）。 */
function readySize(melds) {
  return 14 - 3 * melds.length;
}

function pay(state, from, to, amount) {
  state.players[from].score -= amount;
  state.players[to].score += amount;
}

function snapshot(state) {
  state.paid = state.players.map((player) => player.score);
}

function finish(state, result) {
  state.phase = 'end';
  state.result = {
    ...result,
    deltas: state.players.map((player, index) => player.score - state.paid[index]),
  };
}

// —— 胡牌判定 ——

function canForm(counts, meldsLeft) {
  const tiles = counts.slice();
  const total = tiles.reduce((sum, n) => sum + n, 0);
  if (total !== meldsLeft * 3 + 2) return false;

  function dfs(left, pairUsed) {
    let index = 0;
    while (index < TILE_COUNT && tiles[index] === 0) index++;
    if (index === TILE_COUNT) return left === 0 && pairUsed;

    if (!pairUsed && tiles[index] >= 2) {
      tiles[index] -= 2;
      const ok = dfs(left, true);
      tiles[index] += 2;
      if (ok) return true;
    }
    if (left > 0 && tiles[index] >= 3) {
      tiles[index] -= 3;
      const ok = dfs(left - 1, pairUsed);
      tiles[index] += 3;
      if (ok) return true;
    }
    if (
      left > 0 &&
      index < 18 &&
      index % 9 <= 6 &&
      tiles[index + 1] > 0 &&
      tiles[index + 2] > 0
    ) {
      tiles[index]--;
      tiles[index + 1]--;
      tiles[index + 2]--;
      const ok = dfs(left - 1, pairUsed);
      tiles[index]++;
      tiles[index + 1]++;
      tiles[index + 2]++;
      if (ok) return true;
    }
    return false;
  }

  return dfs(meldsLeft, false);
}

function sevenPairs(counts) {
  let pairs = 0;
  let fours = 0;
  for (const n of counts) {
    if (n === 0) continue;
    if (n === 2) pairs += 1;
    else if (n === 4) {
      pairs += 2;
      fours += 1;
    } else return null;
  }
  return pairs === 7 ? { fours } : null;
}

function isAllPungs(counts) {
  let pair = false;
  for (const n of counts) {
    if (n === 0 || n === 3) continue;
    if (n === 2 && !pair) {
      pair = true;
      continue;
    }
    return false;
  }
  return pair;
}

function isQingYiSe(concealed, melds) {
  let suit = -1;
  const see = (tile) => {
    const next = tile < 9 ? 0 : tile < 18 ? 1 : 2;
    if (suit === -1) suit = next;
    else if (suit !== next) suit = -2;
  };
  concealed.forEach(see);
  melds.forEach((meld) => see(meld.tile));
  return suit === 0 || suit === 1;
}

function dragonKind(counts, melds) {
  const roles = [18, 19, 20].map((tile) => {
    if (melds.some((meld) => meld.tile === tile)) return 'pung';
    const n = counts[tile];
    if (n === 0) return 'none';
    if (n === 2) return 'pair';
    if (n === 3) return 'pung';
    return 'bad';
  });
  if (roles.includes('bad')) return null;
  const pungs = roles.filter((role) => role === 'pung').length;
  const pairs = roles.filter((role) => role === 'pair').length;
  if (pungs === 3) return 'da';
  if (pungs === 2 && pairs === 1) return 'xiao';
  return null;
}

/** 胡的那张是五条或五筒，并且有一种拆法把它卡在 4 和 6 中间。 */
function isKaWuXing(counts, meldCount, winTile) {
  if (winTile !== 4 && winTile !== 13) return false;
  if (meldCount >= 4) return false;
  if (counts[winTile - 1] < 1 || counts[winTile] < 1 || counts[winTile + 1] < 1) return false;
  const left = counts.slice();
  left[winTile - 1]--;
  left[winTile]--;
  left[winTile + 1]--;
  return canForm(left, 4 - meldCount - 1);
}

function capFan(fan, names) {
  const cap = names.includes('双龙七对') ? 16 : 8;
  return fan > cap ? cap : fan;
}

/**
 * concealed 必须已经包含胡的那张牌。
 * selfDraw 为真时，屁胡也能胡；否则要满足接炮条件。
 */
export function judgeWin(concealed, melds, winTile, ctx) {
  const counts = countTiles(concealed);
  const meldCount = melds.length;
  const seven = meldCount === 0 && concealed.length === 14 ? sevenPairs(counts) : null;
  const standard =
    concealed.length === (4 - meldCount) * 3 + 2 && canForm(counts, 4 - meldCount);
  if (!seven && !standard) return null;

  const pengpeng = standard && isAllPungs(counts);
  const kawuxing = standard && isKaWuXing(counts, meldCount, winTile);
  const qingyise = isQingYiSe(concealed, melds);
  const dragons = standard ? dragonKind(counts, melds) : null;
  const shouzhuayi = standard && meldCount === 4 && concealed.length === 2;
  const anSiGui = counts.some((n) => n === 4);
  const big = Boolean(seven) || pengpeng || qingyise || Boolean(dragons) || shouzhuayi;
  const canRon = ctx.gangPao || kawuxing || pengpeng || big || anSiGui;
  if (!ctx.selfDraw && !canRon) return null;

  let fan = 1;
  const names = [];
  const add = (mult, name) => {
    fan *= mult;
    names.push(name);
  };

  if (seven) {
    if (seven.fours >= 2) add(16, '双龙七对');
    else if (seven.fours === 1) add(8, '龙七对');
    else add(4, '七对');
  } else {
    if (pengpeng) add(2, '碰碰胡');
    if (kawuxing) add(2, '卡五星');
    if (anSiGui) add(4, '暗四归');
  }
  if (qingyise) add(4, '清一色');
  if (dragons === 'da') add(8, '大三元');
  if (dragons === 'xiao') add(4, '小三元');
  if (shouzhuayi) add(4, '手抓一');
  if (!ctx.selfDraw && ctx.gangPao) add(2, '杠上炮');
  if (ctx.selfDraw && ctx.gangDraw) add(2, '杠上开花');
  if (names.length === 0) names.push('屁胡');

  return { fan: capFan(fan, names), names, selfDraw: ctx.selfDraw };
}

function uniqueTiles(tiles) {
  const seen = new Set();
  const list = [];
  for (const tile of tiles) {
    if (seen.has(tile)) continue;
    seen.add(tile);
    list.push(tile);
  }
  return list;
}

/** 庄家起手没有单独的摸牌，十四张里哪张当胡张，取番数最高的拆法。 */
function judgeSelf(player, winTile, ctx) {
  if (winTile != null) return judgeWin(player.concealed, player.melds, winTile, ctx);
  let best = null;
  for (const tile of uniqueTiles(player.concealed)) {
    const result = judgeWin(player.concealed, player.melds, tile, ctx);
    if (result && (!best || result.fan > best.fan)) best = result;
  }
  return best;
}

export function gangChoices(state, player) {
  if (state.head > state.tail) return [];
  const hand = state.players[player];
  const counts = countTiles(hand.concealed);
  const choices = [];
  for (let tile = 0; tile < TILE_COUNT; tile++) {
    if (counts[tile] === 4) choices.push({ kind: 'an', tile });
  }
  for (const meld of hand.melds) {
    if (meld.type === 'peng' && counts[meld.tile] > 0) choices.push({ kind: 'bu', tile: meld.tile });
  }
  return choices;
}

function replacementLeft(state) {
  return state.tail - state.head + 1;
}

export function createRound(scores = [0, 0, 0], dealer = 0, rng = Math.random) {
  const wall = [];
  for (let tile = 0; tile < TILE_COUNT; tile++) {
    for (let copy = 0; copy < COPIES; copy++) wall.push(tile);
  }
  shuffle(wall, rng);

  const players = [0, 1, 2].map((index) => ({
    concealed: [],
    melds: [],
    discards: [],
    score: scores[index] || 0,
  }));

  let head = 0;
  for (let round = 0; round < 13; round++) {
    for (let step = 0; step < 3; step++) players[(dealer + step) % 3].concealed.push(wall[head++]);
  }
  players[dealer].concealed.push(wall[head++]);
  for (const player of players) player.concealed.sort((a, b) => a - b);

  const state = {
    wall,
    head,
    tail: wall.length - 1,
    players,
    dealer,
    turn: dealer,
    phase: 'discard',
    canHuSelf: true,
    drawn: null,
    gangDraw: false,
    gangPaoArmed: false,
    lastDiscard: null,
    pool: [],
    stage: null,
    cursor: 0,
    claimPlayer: null,
    options: null,
    result: null,
    paid: [0, 0, 0],
  };
  snapshot(state);
  return state;
}

function drawFront(state) {
  if (state.head > state.tail) return null;
  return state.wall[state.head++];
}

function drawBack(state) {
  if (state.head > state.tail) return null;
  return state.wall[state.tail--];
}

function giveDrawn(state, tile, gang) {
  const player = state.players[state.turn];
  player.concealed.push(tile);
  player.concealed.sort((a, b) => a - b);
  state.drawn = tile;
  state.gangDraw = gang;
  state.canHuSelf = true;
  state.phase = 'discard';
  if (gang) state.gangPaoArmed = true;
}

function startTurn(state, player) {
  state.turn = player;
  state.gangPaoArmed = false;
  state.gangDraw = false;
  state.drawn = null;
  state.lastDiscard = null;
  const tile = drawFront(state);
  if (tile == null) {
    finish(state, { kind: 'draw' });
    return;
  }
  giveDrawn(state, tile, false);
}

function claimOrder(from) {
  return [nextSeat(from), nextSeat(nextSeat(from))];
}

function canPeng(state, player) {
  const tile = state.lastDiscard.tile;
  return state.players[player].concealed.filter((item) => item === tile).length >= 2;
}

function canMingGang(state, player) {
  if (replacementLeft(state) <= 0) return false;
  const tile = state.lastDiscard.tile;
  return state.players[player].concealed.filter((item) => item === tile).length >= 3;
}

function canRon(state, player) {
  const discard = state.lastDiscard;
  const hand = state.players[player];
  return Boolean(
    judgeWin(hand.concealed.concat(discard.tile), hand.melds, discard.tile, {
      selfDraw: false,
      gangPao: discard.gangPao,
      gangDraw: false,
    }),
  );
}

function advanceClaim(state) {
  const order = claimOrder(state.lastDiscard.from);
  while (state.cursor < order.length) {
    const player = order[state.cursor];
    if (state.stage === 'hu' && canRon(state, player)) {
      state.phase = 'claim';
      state.claimPlayer = player;
      state.options = { hu: true, peng: false, gang: false };
      return;
    }
    if (state.stage === 'meld' && (canPeng(state, player) || canMingGang(state, player))) {
      state.phase = 'claim';
      state.claimPlayer = player;
      state.options = { hu: false, peng: canPeng(state, player), gang: canMingGang(state, player) };
      return;
    }
    state.cursor++;
  }
  if (state.stage === 'hu') {
    state.stage = 'meld';
    state.cursor = 0;
    advanceClaim(state);
    return;
  }
  startTurn(state, order[0]);
}

function openClaims(state) {
  state.stage = 'hu';
  state.cursor = 0;
  state.phase = 'claim';
  advanceClaim(state);
}

export function selfOptions(state) {
  if (state.phase !== 'discard') return { hu: null, gangs: [] };
  const player = state.players[state.turn];
  const hu = state.canHuSelf
    ? judgeSelf(player, state.drawn, { selfDraw: true, gangPao: false, gangDraw: state.gangDraw })
    : null;
  return { hu, gangs: gangChoices(state, state.turn) };
}

export function doDiscard(state, tile) {
  if (state.phase !== 'discard') throw new Error('现在不能出牌');
  const player = state.players[state.turn];
  if (player.concealed.length !== readySize(player.melds)) throw new Error('手牌张数不对');
  removeTiles(player.concealed, tile, 1);
  player.discards.push(tile);
  state.pool.push({ tile, from: state.turn });
  state.lastDiscard = { tile, from: state.turn, gangPao: state.gangPaoArmed };
  state.gangPaoArmed = false;
  state.drawn = null;
  state.gangDraw = false;
  state.canHuSelf = false;
  openClaims(state);
}

export function doSelfHu(state) {
  const options = selfOptions(state);
  if (!options.hu) throw new Error('现在不能胡');
  const winner = state.turn;
  for (const payer of [0, 1, 2]) {
    if (payer !== winner) pay(state, payer, winner, options.hu.fan);
  }
  finish(state, { kind: 'hu', winner, from: null, ...options.hu });
}

export function doSelfGang(state, choice) {
  if (state.phase !== 'discard') throw new Error('现在不能杠');
  const choices = gangChoices(state, state.turn);
  const match = choices.find((item) => item.kind === choice.kind && item.tile === choice.tile);
  if (!match) throw new Error('不能这样杠');
  const player = state.players[state.turn];
  if (choice.kind === 'an') {
    removeTiles(player.concealed, choice.tile, 4);
    player.melds.push({ type: 'angang', tile: choice.tile, from: -1 });
    for (const payer of [0, 1, 2]) if (payer !== state.turn) pay(state, payer, state.turn, 2);
  } else {
    removeTiles(player.concealed, choice.tile, 1);
    const meld = player.melds.find((item) => item.type === 'peng' && item.tile === choice.tile);
    meld.type = 'bugang';
    for (const payer of [0, 1, 2]) if (payer !== state.turn) pay(state, payer, state.turn, 1);
  }
  const tile = drawBack(state);
  if (tile == null) {
    finish(state, { kind: 'draw' });
    return;
  }
  giveDrawn(state, tile, true);
}

function applyRon(state) {
  const discard = state.lastDiscard;
  const winner = state.claimPlayer;
  const hand = state.players[winner];
  const judgement = judgeWin(hand.concealed.concat(discard.tile), hand.melds, discard.tile, {
    selfDraw: false,
    gangPao: discard.gangPao,
    gangDraw: false,
  });
  if (!judgement) throw new Error('这张牌不能胡');
  hand.concealed.push(discard.tile);
  hand.concealed.sort((a, b) => a - b);
  state.players[discard.from].discards.pop();
  state.pool.pop();
  pay(state, discard.from, winner, judgement.fan);
  finish(state, { kind: 'hu', winner, from: discard.from, winTile: discard.tile, ...judgement });
}

function applyPeng(state) {
  const discard = state.lastDiscard;
  const player = state.players[state.claimPlayer];
  removeTiles(player.concealed, discard.tile, 2);
  player.melds.push({ type: 'peng', tile: discard.tile, from: discard.from });
  state.players[discard.from].discards.pop();
  state.pool.pop();
  state.turn = state.claimPlayer;
  state.phase = 'discard';
  state.canHuSelf = false;
  state.drawn = null;
  state.gangDraw = false;
  state.gangPaoArmed = false;
  state.lastDiscard = null;
  state.options = null;
}

function applyMingGang(state) {
  const discard = state.lastDiscard;
  const seat = state.claimPlayer;
  const player = state.players[seat];
  removeTiles(player.concealed, discard.tile, 3);
  player.melds.push({ type: 'minggang', tile: discard.tile, from: discard.from });
  state.players[discard.from].discards.pop();
  state.pool.pop();
  pay(state, discard.from, seat, 2);
  state.turn = seat;
  state.lastDiscard = null;
  const tile = drawBack(state);
  if (tile == null) {
    finish(state, { kind: 'draw' });
    return;
  }
  giveDrawn(state, tile, true);
  state.options = null;
}

export function doResponse(state, action) {
  if (state.phase !== 'claim') throw new Error('现在没有牌可应');
  if (action === 'hu') {
    if (!state.options.hu) throw new Error('不能胡这张牌');
    applyRon(state);
    return;
  }
  if (action === 'peng') {
    if (!state.options.peng) throw new Error('不能碰');
    applyPeng(state);
    return;
  }
  if (action === 'gang') {
    if (!state.options.gang) throw new Error('不能杠');
    applyMingGang(state);
    return;
  }
  if (action !== 'pass') throw new Error('未知操作');
  state.cursor++;
  advanceClaim(state);
}

export function remaining(state) {
  return state.tail - state.head + 1;
}

export function tileTotal(state) {
  let total = remaining(state);
  for (const player of state.players) {
    total += player.concealed.length + player.discards.length;
    for (const meld of player.melds) total += meld.type === 'peng' ? 3 : 4;
  }
  return total;
}
