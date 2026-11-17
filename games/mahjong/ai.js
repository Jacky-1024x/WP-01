// 电脑玩家：能胡就胡；向听数变差就不碰。杠在没听牌时要，听牌后留着牌型。
import { countTiles, gangChoices, selfOptions } from './engine.js';

const suitMemo = new Map();

function packFrom(counts, index) {
  let key = String(index);
  for (let i = index; i < 9; i++) key += counts[i];
  return key;
}

function pareto(list) {
  const unique = [];
  const seen = new Set();
  for (const item of list) {
    const key = `${item.m},${item.t},${item.p}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique.filter(
    (item, index) =>
      !unique.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          other.m >= item.m &&
          other.t >= item.t &&
          other.p >= item.p &&
          (other.m > item.m || other.t > item.t || other.p > item.p),
      ),
  );
}

/** 一门序数牌能拆出的面子、搭子、对子。结果按牌面缓存。 */
function suitForms(source) {
  const counts = source.slice();
  function rec(index) {
    while (index < 9 && counts[index] === 0) index++;
    const key = packFrom(counts, index);
    const cached = suitMemo.get(key);
    if (cached) return cached;
    if (index >= 9) return [{ m: 0, t: 0, p: 0 }];

    const found = [];
    const seen = new Set();
    const take = (dm, dt, dp) => {
      for (const shape of rec(index)) {
        const m = shape.m + dm;
        const t = shape.t + dt;
        const p = shape.p + dp;
        const mark = `${m},${t},${p}`;
        if (seen.has(mark)) continue;
        seen.add(mark);
        found.push({ m, t, p });
      }
    };
    const n = counts[index];
    counts[index]--;
    take(0, 0, 0);
    counts[index]++;
    if (n >= 2) {
      counts[index] -= 2;
      take(0, 0, 1);
      counts[index] += 2;
    }
    if (n >= 3) {
      counts[index] -= 3;
      take(1, 0, 0);
      counts[index] += 3;
    }
    if (n >= 4) {
      counts[index] -= 4;
      take(0, 0, 2);
      counts[index] += 4;
    }
    if (index <= 6 && counts[index] > 0 && counts[index + 1] > 0 && counts[index + 2] > 0) {
      counts[index]--;
      counts[index + 1]--;
      counts[index + 2]--;
      take(1, 0, 0);
      counts[index]++;
      counts[index + 1]++;
      counts[index + 2]++;
    }
    if (index <= 7 && counts[index] > 0 && counts[index + 1] > 0) {
      counts[index]--;
      counts[index + 1]--;
      take(0, 1, 0);
      counts[index]++;
      counts[index + 1]++;
    }
    if (index <= 6 && counts[index] > 0 && counts[index + 2] > 0) {
      counts[index]--;
      counts[index + 2]--;
      take(0, 1, 0);
      counts[index]++;
      counts[index + 2]++;
    }
    const best = pareto(found);
    suitMemo.set(key, best);
    return best;
  }
  return rec(0);
}

function honorOptions(n) {
  if (n <= 1) return [{ m: 0, t: 0, p: 0 }];
  if (n === 2) return [{ m: 0, t: 0, p: 1 }];
  if (n === 3) return [{ m: 1, t: 0, p: 0 }, { m: 0, t: 0, p: 1 }];
  return [{ m: 1, t: 0, p: 0 }, { m: 0, t: 0, p: 2 }];
}

function honorForms(honors) {
  let forms = [{ m: 0, t: 0, p: 0 }];
  for (const n of honors) {
    const next = [];
    for (const form of forms) {
      for (const option of honorOptions(n)) {
        next.push({ m: form.m + option.m, t: form.t + option.t, p: form.p + option.p });
      }
    }
    forms = pareto(next);
  }
  return forms;
}

function toShanten(melds, taatsu, pairs, openMelds) {
  const need = 4 - openMelds;
  let m = melds;
  let t = taatsu;
  let p = pairs;
  if (p > 1) {
    t += p - 1;
    p = 1;
  }
  if (m > need) {
    m = need;
    t = 0;
  } else if (m + t > need) t = need - m;
  return 2 * need - 2 * m - t - (p ? 1 : 0);
}

function sevenShanten(counts) {
  const types = [];
  for (const n of counts) if (n) types.push(n);
  types.sort((a, b) => b - a);
  let pairs = 0;
  for (let i = 0; i < types.length && i < 7; i++) {
    if (types[i] >= 4) pairs += 2;
    else if (types[i] >= 2) pairs += 1;
  }
  return 6 - pairs;
}

/** 距离胡牌还差几张。听牌是 0，已经胡了是 -1。 */
export function shanten(counts, openMelds) {
  const bamboo = suitForms(counts.slice(0, 9));
  const dots = suitForms(counts.slice(9, 18));
  const honors = honorForms([counts[18], counts[19], counts[20]]);
  let best = 8;
  for (const a of bamboo) {
    for (const b of dots) {
      for (const honor of honors) {
        const value = toShanten(a.m + b.m + honor.m, a.t + b.t + honor.t, a.p + b.p + honor.p, openMelds);
        if (value < best) best = value;
      }
    }
  }
  if (openMelds === 0) best = Math.min(best, sevenShanten(counts));
  return best;
}

function without(tiles, tile) {
  const next = tiles.slice();
  next.splice(next.indexOf(tile), 1);
  return next;
}

function bestDiscard(tiles, openMelds) {
  const counts = countTiles(tiles);
  let best = 99;
  let choices = [];
  const seen = new Set();
  for (const tile of tiles) {
    if (seen.has(tile)) continue;
    seen.add(tile);
    const value = shanten(countTiles(without(tiles, tile)), openMelds);
    if (value < best) {
      best = value;
      choices = [tile];
    } else if (value === best) choices.push(tile);
  }
  choices.sort((a, b) => discardRank(a, counts) - discardRank(b, counts));
  const rank = discardRank(choices[0], counts);
  return { shanten: best, tiles: choices.filter((tile) => discardRank(tile, counts) === rank) };
}

function discardRank(tile, counts) {
  let rank = 0;
  if (counts[tile] === 1) rank -= 2;
  if (tile >= 18) rank -= 2;
  if (tile < 18 && (tile % 9 === 0 || tile % 9 === 8)) rank -= 1;
  return rank;
}

export function chooseDiscard(concealed, melds, rng) {
  const { tiles } = bestDiscard(concealed, melds.length);
  return tiles[Math.floor(rng() * tiles.length)];
}

export function wantsPeng(concealed, melds, tile) {
  const current = shanten(countTiles(concealed), melds.length);
  const after = without(without(concealed, tile), tile);
  const { shanten: next } = bestDiscard(after, melds.length + 1);
  return next <= current;
}

export function chooseSelfGang(state) {
  const hand = state.players[state.turn];
  if (shanten(countTiles(hand.concealed), hand.melds.length) <= 0) return null;
  const choices = gangChoices(state, state.turn);
  return choices.find((choice) => choice.kind === 'an') || choices[0] || null;
}

export function chooseClaim(state) {
  if (state.options.hu) return 'hu';
  const hand = state.players[state.claimPlayer];
  const tile = state.lastDiscard.tile;
  if (state.options.gang && shanten(countTiles(hand.concealed), hand.melds.length) > 0) return 'gang';
  if (state.options.peng && wantsPeng(hand.concealed, hand.melds, tile)) return 'peng';
  return 'pass';
}

export function chooseSelfAction(state, rng) {
  const options = selfOptions(state);
  if (options.hu) return { type: 'hu' };
  const gang = chooseSelfGang(state);
  if (gang) return { type: 'gang', choice: gang };
  return { type: 'discard', tile: chooseDiscard(state.players[state.turn].concealed, state.players[state.turn].melds, rng) };
}
