// 冒烟测试：node tests/smoke.mjs
import assert from 'node:assert/strict';
import { createSolved, isSolved, isSolvable, shuffle, moveAt, moveDirection } from '../games/klotski/puzzle.js';
import { chooseMove, findWinLine, shapeAt, SHAPE, BLACK, WHITE, SIZE } from '../games/gomoku/ai.js';
import * as bj from '../games/blackjack/engine.js';
import * as mj from '../games/mahjong/engine.js';
import { chooseClaim, chooseSelfAction, shanten } from '../games/mahjong/ai.js';
import * as cl from '../games/codelights/engine.js';
import * as ms from '../games/minesweeper/board.js';
import * as sdSolver from '../games/sudoku/solver.js';
import * as sdGen from '../games/sudoku/generator.js';
import * as sd from '../games/sudoku/board.js';
import { BANK as SD_BANK } from '../games/sudoku/puzzles.js';
import * as tt from '../games/tetris/engine.js';
import * as sk from '../games/sokoban/engine.js';
import { solve as skSolve } from '../games/sokoban/solver.js';
import { LEVELS as SK_LEVELS, CHAPTERS as SK_CHAPTERS, LEVELS_VERSION as SK_VERSION } from '../games/sokoban/levels.js';
import { recordClick, sortByUsage } from '../js/usage.js';

let passed = 0;
function test(name, fn) {
  const t0 = Date.now();
  fn();
  passed++;
  console.log(`  ✓ ${name} (${Date.now() - t0}ms)`);
}

// 可复现的伪随机数
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

console.log('数字华容道');

test('已完成状态可解且判定为完成', () => {
  for (const n of [3, 4, 5, 6]) {
    const t = createSolved(n);
    assert.ok(isSolved(t));
    assert.ok(isSolvable(t, n));
  }
});

test('交换两块后的状态被判为不可解', () => {
  for (const n of [3, 4, 5, 6]) {
    const t = createSolved(n);
    [t[0], t[1]] = [t[1], t[0]];
    assert.equal(isSolvable(t, n), false);
  }
});

test('打乱结果全部可解、未完成且是合法排列（每档 300 次）', () => {
  const rng = mulberry32(42);
  for (const n of [3, 4, 5, 6]) {
    for (let i = 0; i < 300; i++) {
      const t = shuffle(n, rng);
      assert.equal(t.length, n * n);
      assert.deepEqual([...t].sort((a, b) => a - b), [...Array(n * n).keys()]);
      assert.ok(!isSolved(t));
      assert.ok(isSolvable(t, n), `不可解局面: ${t}`);
    }
  }
});

test('3×3 打乱局面用 BFS 实际求解成功（逆序数判定与真实可解性一致）', () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 20; i++) {
    const start = shuffle(3, rng);
    const goal = createSolved(3).join(',');
    const seen = new Set([start.join(',')]);
    let frontier = [start];
    let found = false;
    while (frontier.length && !found) {
      const next = [];
      for (const s of frontier) {
        for (const dir of ['up', 'down', 'left', 'right']) {
          const t = s.slice();
          if (!moveDirection(t, 3, dir)) continue;
          const k = t.join(',');
          if (k === goal) found = true;
          if (!seen.has(k)) {
            seen.add(k);
            next.push(t);
          }
        }
      }
      frontier = next;
    }
    assert.ok(found, `BFS 未能求解: ${start}`);
  }
});

test('整排推动与方向滑动', () => {
  const t = createSolved(4); // 空格在 15
  assert.equal(moveAt(t, 4, 12), 3); // 同行最左侧，推动 3 块
  assert.deepEqual(t.slice(12), [0, 13, 14, 15]);
  assert.equal(moveAt(t, 4, 5), 0); // 不在同行同列
  assert.equal(moveDirection(t, 4, 'left'), 1);
  assert.deepEqual(t.slice(12), [13, 0, 14, 15]);
  assert.equal(moveDirection(t, 4, 'down'), 1); // 上方方块下移
  assert.equal(t[13], 10);
});

console.log('五子棋 AI');

// 用字符画摆棋盘：X 黑 O 白 . 空，可只写左上若干行
function boardFrom(rows) {
  const b = new Array(SIZE * SIZE).fill(0);
  rows.forEach((row, r) => {
    [...row.replace(/\s/g, '')].forEach((ch, c) => {
      if (ch === 'X') b[r * SIZE + c] = BLACK;
      else if (ch === 'O') b[r * SIZE + c] = WHITE;
    });
  });
  return b;
}
const at = (r, c) => r * SIZE + c;
const fmt = (p) => `(${Math.floor(p / SIZE)},${p % SIZE})`;

test('棋型识别：活四/冲四/活三/跳活三/眠三/活二', () => {
  const pad = (s) => `....${s}`.padEnd(15, '.');
  const check = (line, col, expected) => {
    const b = boardFrom(['', '', '', '', '', '', '', pad(line)]);
    assert.equal(shapeAt(b, at(7, col + 4), BLACK, 0), expected, `${line} @${col}`);
  };
  check('.XXXX.', 1, SHAPE.LIVE_FOUR);
  check('OXXXX.', 1, SHAPE.RUSH_FOUR);
  check('XX.XX', 0, SHAPE.RUSH_FOUR);
  check('..XXX..', 2, SHAPE.LIVE_THREE);
  check('.X.XX.', 1, SHAPE.LIVE_THREE);
  check('OXXX..', 1, SHAPE.SLEEP_THREE);
  check('O.XXX.O', 2, SHAPE.SLEEP_THREE);
  check('..XX..', 2, SHAPE.LIVE_TWO);
  check('XXXXX', 2, SHAPE.FIVE);
});

test('胜负判定与连线', () => {
  const b = boardFrom(['', '', '..XXXXX']);
  const line = findWinLine(b, at(2, 4));
  assert.deepEqual(line, [at(2, 2), at(2, 3), at(2, 4), at(2, 5), at(2, 6)]);
  assert.equal(findWinLine(boardFrom(['', '', '..XXXX']), at(2, 3)), null);
});

const levels = ['easy', 'normal', 'hard'];

test('各难度都会立即完成己方五连（即使对方有活四）', () => {
  const b = boardFrom([
    '',
    '',
    '',
    '....OOOO.......',
    '',
    '...XXXX........',
  ]);
  for (const lv of levels) {
    const { move } = chooseMove(b, WHITE, lv);
    assert.ok([at(3, 3), at(3, 8)].includes(move), `${lv}: ${fmt(move)}`);
  }
});

test('各难度都会封堵对方冲四', () => {
  const b = boardFrom([
    '',
    '',
    '',
    '',
    '',
    '...OXXXX.......',
    '......O........',
    '.......O.......',
  ]);
  for (const lv of levels) {
    const { move } = chooseMove(b, WHITE, lv);
    assert.equal(move, at(5, 8), `${lv}: ${fmt(move)}`);
  }
});

test('各难度都会封堵对方活三', () => {
  const b = boardFrom([
    '',
    '',
    '',
    '',
    '',
    '',
    '.....XXX.......',
    '.....O.........',
    '......O........',
  ]);
  const blocks = [at(6, 4), at(6, 8), at(6, 3), at(6, 9)];
  for (const lv of levels) {
    for (let i = 0; i < 5; i++) {
      const { move } = chooseMove(b, WHITE, lv);
      assert.ok(blocks.includes(move), `${lv}: ${fmt(move)}`);
    }
  }
});

test('封堵跳活三（X.XX）', () => {
  const b = boardFrom([
    '',
    '',
    '',
    '',
    '',
    '',
    '....X.XX.......',
    '.....O.........',
    '......O........',
  ]);
  const blocks = [at(6, 3), at(6, 5), at(6, 8)];
  for (const lv of levels) {
    const { move } = chooseMove(b, WHITE, lv);
    assert.ok(blocks.includes(move), `${lv}: ${fmt(move)}`);
  }
});

test('己方有活三且对方无威胁时，冲成活四', () => {
  const b = boardFrom([
    '',
    '',
    '',
    '',
    '',
    '',
    '.....OOO.......',
    '.....X.........',
    '......X........',
    '..........X....',
  ]);
  for (const lv of ['normal', 'hard']) {
    const { move } = chooseMove(b, WHITE, lv);
    assert.ok([at(6, 4), at(6, 8)].includes(move), `${lv}: ${fmt(move)}`);
  }
});

test('困难难度中盘单步耗时 ≤ 2s（桌面端）', () => {
  const b = boardFrom([
    '',
    '',
    '',
    '',
    '.....O.........',
    '....XXO........',
    '.....XOX.......',
    '....OX.X.......',
    '.....OXO.......',
    '......X........',
    '.....O.........',
  ]);
  const r = chooseMove(b, WHITE, 'hard');
  assert.ok(r.ms <= 2000, `耗时 ${r.ms}ms`);
  console.log(`    中盘：${fmt(r.move)} 深度 ${r.depth} 节点 ${r.nodes} 耗时 ${r.ms}ms`);
});

function playGame(blackLevel, whiteLevel, seed) {
  const rng = mulberry32(seed);
  const b = new Array(SIZE * SIZE).fill(0);
  let turn = BLACK;
  let maxMs = 0;
  // 随机开局两手，增加变化
  b[at(7, 7)] = BLACK;
  const opens = [at(6, 6), at(6, 8), at(8, 6), at(8, 8), at(7, 8), at(6, 7)];
  b[opens[Math.floor(rng() * opens.length)]] = WHITE;
  for (let ply = 2; ply < SIZE * SIZE; ply++) {
    const lv = turn === BLACK ? blackLevel : whiteLevel;
    const r = chooseMove(b, turn, lv, { rng });
    maxMs = Math.max(maxMs, r.ms);
    assert.ok(r.move >= 0 && b[r.move] === 0, '非法落子');
    b[r.move] = turn;
    if (findWinLine(b, r.move)) return { winner: turn, plies: ply + 1, maxMs };
    turn = 3 - turn;
  }
  return { winner: 0, plies: SIZE * SIZE, maxMs };
}

test('自对弈：困难 vs 简单（交换先后手共 4 局），困难全胜', () => {
  let hardWins = 0;
  let maxMs = 0;
  for (let i = 0; i < 4; i++) {
    const hardBlack = i % 2 === 0;
    const r = playGame(hardBlack ? 'hard' : 'easy', hardBlack ? 'easy' : 'hard', 100 + i);
    const hardColor = hardBlack ? BLACK : WHITE;
    if (r.winner === hardColor) hardWins++;
    maxMs = Math.max(maxMs, r.maxMs);
    console.log(`    第 ${i + 1} 局：困难执${hardBlack ? '黑' : '白'}，${r.winner === hardColor ? '困难胜' : r.winner ? '简单胜' : '平局'}，${r.plies} 手`);
  }
  console.log(`    单步最长耗时 ${maxMs}ms`);
  assert.equal(hardWins, 4);
});

test('自对弈：困难 vs 普通 2 局可正常终局', () => {
  for (let i = 0; i < 2; i++) {
    const r = playGame(i ? 'normal' : 'hard', i ? 'hard' : 'normal', 200 + i);
    console.log(`    第 ${i + 1} 局：${r.winner === BLACK ? '黑胜' : r.winner === WHITE ? '白胜' : '平局'}（黑=${i ? '普通' : '困难'}），${r.plies} 手，单步最长 ${r.maxMs}ms`);
    assert.ok(r.maxMs <= 2500);
  }
});

console.log('21 点');

// 牌面写法：'A' '2'..'10' 'J' 'Q' 'K'，花色统一取黑桃
const card = (r) => ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].indexOf(r);
// 让接下来依次发出的牌为 cards（发牌顺序：玩家、庄家、玩家、庄家暗牌，之后按需补牌）
function rigged(cards, bankroll = 1000) {
  const g = bj.createGame(bankroll, mulberry32(1));
  g.shoe = [...g.shoe.slice(0, 200), ...cards.map(card).reverse()];
  return g;
}

test('点数计算：A 的软硬、J/Q/K、Blackjack 判定', () => {
  const v = (...rs) => bj.handValue(rs.map(card));
  assert.deepEqual(v('A', 'K'), { total: 21, soft: true });
  assert.deepEqual(v('A', 'A', '9'), { total: 21, soft: true });
  assert.deepEqual(v('A', '5', 'K'), { total: 16, soft: false });
  assert.deepEqual(v('A', '6'), { total: 17, soft: true });
  assert.deepEqual(v('Q', 'J', '2'), { total: 22, soft: false });
  assert.ok(bj.isBlackjack(['A', 'Q'].map(card)));
  assert.ok(!bj.isBlackjack(['7', '7', '7'].map(card)));
  assert.ok(!bj.dealerShouldHit(['A', '6'].map(card)), '软 17 停牌');
  assert.ok(bj.dealerShouldHit(['10', '6'].map(card)));
});

test('牌靴为 6 副完整的牌', () => {
  const shoe = bj.createShoe(6, mulberry32(3));
  assert.equal(shoe.length, 312);
  const counts = new Array(52).fill(0);
  for (const c of shoe) counts[c]++;
  assert.ok(counts.every((n) => n === 6));
});

test('Blackjack 赔 3:2；庄家 Blackjack 直接结算；双方 Blackjack 平局', () => {
  let g = bj.deal(rigged(['A', '9', 'K', '7']), 100);
  assert.equal(g.phase, 'betting');
  assert.equal(g.hands[0].result, 'blackjack');
  assert.equal(g.bankroll, 1150);

  g = bj.deal(rigged(['10', 'A', 'Q', 'K']), 100);
  assert.equal(g.phase, 'betting');
  assert.equal(g.hands[0].result, 'lose');
  assert.equal(g.bankroll, 900);

  g = bj.deal(rigged(['A', 'A', 'K', 'Q']), 100);
  assert.equal(g.hands[0].result, 'push');
  assert.equal(g.bankroll, 1000);
});

test('爆牌立即判负且庄家不补牌；庄家按规则补牌', () => {
  let g = bj.deal(rigged(['10', '10', '6', '6', 'K']), 50);
  bj.hit(g);
  assert.equal(g.phase, 'betting');
  assert.equal(g.hands[0].result, 'bust');
  assert.equal(g.dealer.length, 2);
  assert.equal(g.bankroll, 950);

  g = bj.deal(rigged(['10', '10', '8', '6', '5']), 50);
  bj.stand(g);
  assert.equal(g.phase, 'dealer');
  bj.playDealer(g);
  assert.equal(g.dealer.length, 3);
  assert.equal(g.hands[0].result, 'lose'); // 18 对 21
  assert.equal(g.bankroll, 950);

  g = bj.deal(rigged(['10', '10', '8', '6', 'Q']), 50);
  bj.stand(g);
  bj.playDealer(g);
  assert.equal(g.hands[0].result, 'win'); // 庄家 26 爆牌
  assert.equal(g.bankroll, 1050);
});

test('加倍：下注翻倍且只补一张', () => {
  const g = bj.deal(rigged(['6', '10', '5', '7', 'K']), 100);
  assert.ok(bj.canDouble(g));
  bj.double(g);
  assert.equal(g.hands[0].bet, 200);
  assert.equal(g.hands[0].cards.length, 3);
  bj.playDealer(g);
  assert.equal(g.hands[0].result, 'win'); // 21 对 17
  assert.equal(g.bankroll, 1200);
});

test('分牌：两手分别结算；分 A 每手只补一张且 21 点按 1:1 赔付', () => {
  // 8,8 对庄家 10+7：分牌时第二手先补 3、第一手补 10，得到 18 与 11；第二手再要一张 10 成 21
  let g = bj.deal(rigged(['8', '10', '8', '7', '3', '10', '10']), 100);
  assert.ok(bj.canSplit(g));
  bj.split(g);
  assert.equal(g.hands.length, 2);
  assert.equal(g.bankroll, 800);
  assert.equal(g.active, 0);
  bj.stand(g);
  assert.equal(g.active, 1);
  bj.hit(g);
  assert.equal(g.phase, 'dealer');
  bj.playDealer(g);
  assert.deepEqual(g.hands.map((h) => [bj.handValue(h.cards).total, h.result]), [[18, 'win'], [21, 'win']]);
  assert.equal(g.bankroll, 1200);

  g = bj.deal(rigged(['A', '9', 'A', '8', 'K', 'Q']), 100);
  bj.split(g);
  assert.equal(g.phase, 'dealer');
  assert.ok(g.hands.every((h) => h.cards.length === 2 && h.done));
  bj.playDealer(g);
  assert.deepEqual(g.hands.map((h) => h.result), ['win', 'win']);
  assert.equal(g.bankroll, 1200);
});

test('筹码不足时不能加倍或分牌', () => {
  const g = bj.deal(rigged(['8', '10', '8', '7'], 150), 100);
  assert.ok(!bj.canSplit(g));
  assert.ok(!bj.canDouble(g));
});

test('随机对局 3000 局：资金守恒、阶段正确、牌靴自动重洗', () => {
  const rng = mulberry32(2024);
  const g = bj.createGame(1_000_000, rng);
  let reshuffles = 0;
  for (let i = 0; i < 3000; i++) {
    const before = g.bankroll;
    const bet = 10 * (1 + Math.floor(rng() * 20));
    bj.deal(g, bet, rng);
    if (g.shuffled) reshuffles++;
    let guard = 0;
    while (g.phase === 'player' && guard++ < 50) {
      const r = rng();
      if (r < 0.15 && bj.canSplit(g)) bj.split(g);
      else if (r < 0.3 && bj.canDouble(g)) bj.double(g);
      else if (bj.handValue(bj.currentHand(g).cards).total < 15) bj.hit(g);
      else bj.stand(g);
    }
    bj.playDealer(g);
    assert.equal(g.phase, 'betting');
    assert.ok(g.hands.length >= 1 && g.hands.length <= bj.MAX_HANDS);
    const staked = g.hands.reduce((s, h) => s + h.bet, 0);
    const paid = g.hands.reduce((s, h) => s + h.payout, 0);
    assert.equal(g.bankroll, before - staked + paid);
    assert.ok(g.hands.every((h) => h.result));
  }
  assert.ok(reshuffles > 0);
});

console.log('卡五星');

const bamboo = (rank) => rank - 1;
const dot = (rank) => 8 + rank;
const Z = 18;
const F = 19;
const B = 20;
const copies = (tile, n) => Array(n).fill(tile);
const chow = (tile) => [tile, tile + 1, tile + 2];

const plain = [
  ...chow(bamboo(1)),
  ...chow(bamboo(4)),
  ...chow(bamboo(7)),
  ...chow(dot(1)),
  dot(9),
  dot(9),
];

test('屁胡可以自摸，别人打出的不能胡', () => {
  const self = mj.judgeWin(plain, [], dot(9), { selfDraw: true, gangPao: false, gangDraw: false });
  assert.equal(self.fan, 1);
  assert.deepEqual(self.names, ['屁胡']);
  assert.equal(mj.judgeWin(plain, [], dot(9), { selfDraw: false, gangPao: false, gangDraw: false }), null);
});

test('卡在四五六中间的五可以接炮，一对五不算卡五星', () => {
  const ka = mj.judgeWin(plain, [], bamboo(5), { selfDraw: false, gangPao: false, gangDraw: false });
  assert.equal(ka.fan, 2);
  assert.ok(ka.names.includes('卡五星'));
  const pairOnly = [
    ...chow(bamboo(1)),
    ...chow(bamboo(7)),
    ...chow(dot(1)),
    ...chow(dot(4)),
    bamboo(5),
    bamboo(5),
  ];
  assert.equal(mj.judgeWin(pairOnly, [], bamboo(5), { selfDraw: false, gangPao: false, gangDraw: false }), null);
  const self = mj.judgeWin(pairOnly, [], bamboo(5), { selfDraw: true, gangPao: false, gangDraw: false });
  assert.deepEqual(self.names, ['屁胡']);
});

test('杠上炮、碰碰胡、七对、清一色、暗四归、三元和手抓一可以接炮', () => {
  const gangPao = mj.judgeWin(plain, [], dot(9), { selfDraw: false, gangPao: true, gangDraw: false });
  assert.equal(gangPao.fan, 2);
  assert.ok(gangPao.names.includes('杠上炮'));

  const pung = [...copies(bamboo(1), 3), ...copies(bamboo(2), 3), ...copies(bamboo(3), 3), ...copies(dot(4), 3), dot(9), dot(9)];
  const pengpeng = mj.judgeWin(pung, [], dot(9), { selfDraw: false, gangPao: false, gangDraw: false });
  assert.ok(pengpeng.names.includes('碰碰胡'));

  const pairs = [1, 2, 3, 4, 5, 6].flatMap((rank) => copies(bamboo(rank), 2)).concat(copies(dot(1), 2));
  const seven = mj.judgeWin(pairs, [], dot(1), { selfDraw: false, gangPao: false, gangDraw: false });
  assert.equal(seven.fan, 4);
  assert.deepEqual(seven.names, ['七对']);

  const dragon = [...copies(bamboo(1), 4), ...[2, 3, 4, 5, 6].flatMap((rank) => copies(bamboo(rank), 2))];
  assert.equal(mj.judgeWin(dragon, [], bamboo(1), { selfDraw: false, gangPao: false, gangDraw: false }).fan, 8);
  const twoDragons = [...copies(bamboo(1), 4), ...copies(bamboo(2), 4), ...[3, 4, 5].flatMap((rank) => copies(bamboo(rank), 2))];
  assert.equal(mj.judgeWin(twoDragons, [], bamboo(5), { selfDraw: false, gangPao: false, gangDraw: false }).fan, 16);

  const flush = [
    ...chow(bamboo(1)),
    ...chow(bamboo(4)),
    ...chow(bamboo(7)),
    ...chow(bamboo(2)),
    bamboo(9),
    bamboo(9),
  ];
  const qing = mj.judgeWin(flush, [], bamboo(9), { selfDraw: false, gangPao: false, gangDraw: false });
  assert.equal(qing.fan, 4);
  assert.ok(qing.names.includes('清一色'));

  const four = [
    bamboo(4),
    ...copies(bamboo(5), 4),
    bamboo(6),
    ...chow(bamboo(7)),
    ...chow(dot(1)),
    dot(9),
    dot(9),
  ];
  const ansi = mj.judgeWin(four, [], dot(9), { selfDraw: false, gangPao: false, gangDraw: false });
  assert.ok(ansi.names.includes('暗四归'));

  const xiao = [...copies(Z, 3), ...copies(F, 3), B, B, ...chow(bamboo(1)), ...chow(bamboo(4))];
  assert.ok(mj.judgeWin(xiao, [], B, { selfDraw: false, gangPao: false, gangDraw: false }).names.includes('小三元'));
  const da = [...copies(Z, 3), ...copies(F, 3), ...copies(B, 3), ...copies(bamboo(1), 3), bamboo(2), bamboo(2)];
  const dasan = mj.judgeWin(da, [], bamboo(2), { selfDraw: false, gangPao: false, gangDraw: false });
  assert.ok(dasan.names.includes('大三元'));
  assert.equal(dasan.fan, 8);

  const melds = [
    { type: 'peng', tile: bamboo(1) },
    { type: 'peng', tile: bamboo(2) },
    { type: 'peng', tile: dot(3) },
    { type: 'minggang', tile: dot(4) },
  ];
  const grab = mj.judgeWin([Z, Z], melds, Z, { selfDraw: false, gangPao: false, gangDraw: false });
  assert.ok(grab.names.includes('手抓一'));
});

test('红中不能代替别的牌', () => {
  const broken = [...chow(bamboo(1)), ...chow(bamboo(4)), ...chow(bamboo(7)), ...chow(dot(1)), Z, F];
  assert.equal(mj.judgeWin(broken, [], F, { selfDraw: true, gangPao: false, gangDraw: false }), null);
});

test('向听：成牌是 -1，听牌是 0', () => {
  assert.equal(shanten(mj.countTiles(plain), 0), -1);
  assert.equal(shanten(mj.countTiles(plain.slice(0, -1)), 0), 0);
  const sixPairs = [1, 2, 3, 4, 5, 6].flatMap((rank) => copies(bamboo(rank), 2)).concat(dot(1));
  assert.equal(shanten(mj.countTiles(sixPairs), 0), 0);
});

test('发牌 84 张守恒，庄家 14 张', () => {
  const state = mj.createRound([0, 0, 0], 0, mulberry32(3));
  assert.equal(mj.tileTotal(state), 84);
  assert.equal(state.players[0].concealed.length, 14);
  assert.equal(state.players[1].concealed.length, 13);
  assert.equal(state.players[2].concealed.length, 13);
  assert.equal(mj.remaining(state), 44);
});

test('直杠、暗杠、补杠当时计分，杠后打出的牌算杠上炮', () => {
  const state = mj.createRound([3, 5, 7], 1, mulberry32(9));
  state.turn = 1;
  state.phase = 'discard';
  state.canHuSelf = false;
  state.players[0].melds = [];
  state.players[1].melds = [];
  state.players[2].melds = [];
  state.players[0].concealed = [...copies(bamboo(1), 3), ...copies(bamboo(2), 2), dot(3), dot(4), dot(6), dot(7), dot(8), dot(9), F, B];
  state.players[1].concealed = [bamboo(1), ...copies(bamboo(2), 2), bamboo(3), bamboo(4), bamboo(5), bamboo(6), bamboo(7), bamboo(8), bamboo(9), dot(1), dot(2), dot(3), dot(5)];
  state.players[2].concealed = [bamboo(9), dot(1), dot(2), dot(3), dot(4), dot(5), dot(6), dot(7), dot(8), dot(9), Z, F, B];
  for (const player of state.players) {
    player.discards = [];
    player.concealed.sort((a, b) => a - b);
  }
  mj.doDiscard(state, bamboo(1));
  assert.equal(state.claimPlayer, 0);
  assert.equal(state.options.hu, false);
  assert.equal(state.options.gang, true);
  mj.doResponse(state, 'gang');
  assert.equal(state.players[0].score, 5);
  assert.equal(state.players[1].score, 3);
  assert.equal(state.gangDraw, true);
  const discard = state.players[0].concealed[0];
  mj.doDiscard(state, discard);
  assert.equal(state.lastDiscard.gangPao, true);

  const an = mj.createRound([0, 0, 0], 0, mulberry32(4));
  an.players[0].concealed = [...copies(Z, 4), ...chow(bamboo(1)), ...chow(bamboo(4)), ...chow(dot(1)), dot(9)];
  an.players[0].concealed.sort((a, b) => a - b);
  an.players[0].melds = [];
  mj.doSelfGang(an, { kind: 'an', tile: Z });
  assert.equal(an.players[0].score, 4);
  assert.equal(an.players[1].score, -2);
  assert.equal(an.players[2].score, -2);

  const bu = mj.createRound([0, 0, 0], 0, mulberry32(5));
  bu.players[0].melds = [{ type: 'peng', tile: F, from: 1 }];
  bu.players[0].concealed = [F, ...chow(bamboo(1)), ...chow(bamboo(4)), ...chow(dot(1)), dot(9), dot(9)];
  bu.players[0].concealed.sort((a, b) => a - b);
  mj.doSelfGang(bu, { kind: 'bu', tile: F });
  assert.equal(bu.players[0].score, 2);
  assert.equal(bu.players[1].score, -1);
  assert.equal(bu.players[2].score, -1);
});

test('随机对局能打完，牌数和分数都守恒', () => {
  const rng = mulberry32(11);
  for (let game = 0; game < 12; game++) {
    const state = mj.createRound([0, 0, 0], game % 3, rng);
    let guard = 0;
    while (state.phase !== 'end' && guard++ < 500) {
      assert.equal(mj.tileTotal(state), 84);
      if (state.phase === 'discard') {
        const action = chooseSelfAction(state, rng);
        if (action.type === 'hu') mj.doSelfHu(state);
        else if (action.type === 'gang') mj.doSelfGang(state, action.choice);
        else mj.doDiscard(state, action.tile);
      } else {
        mj.doResponse(state, chooseClaim(state));
      }
    }
    assert.equal(state.phase, 'end', `第 ${game} 局没有结束`);
    assert.equal(mj.tileTotal(state), 84);
    assert.equal(state.pool.length, state.players.reduce((sum, player) => sum + player.discards.length, 0));
    assert.equal(state.players.reduce((sum, player) => sum + player.score, 0), 0);
  }
});

console.log('密码灯');

// 直接指定答案的对局，避免随机性
function lightsGame(answer, mode = 'simple', colors = 7) {
  const g = cl.createGame(mode, Math.random, null, colors);
  g.answer = [...answer];
  return g;
}

// 用「换色」把选中的灯循环到指定颜色
function cycleTo(g, c) {
  while (g.current[g.cursor] !== c) cl.cycleColor(g);
}

// 依次换色并按「下一盏」，填满整行
function fillRow(g, colors) {
  colors.forEach((c) => {
    cycleTo(g, c);
    cl.nextSlot(g);
  });
}

test('答案从 7 色中取 4 个不重复颜色，且分布大致均匀', () => {
  const rng = mulberry32(3);
  const firstSlot = {};
  for (let i = 0; i < 7000; i++) {
    const a = cl.makeAnswer(rng);
    assert.equal(a.length, 4);
    assert.equal(new Set(a).size, 4);
    assert.ok(a.every((c) => cl.COLORS.includes(c)));
    firstSlot[a[0]] = (firstSlot[a[0]] || 0) + 1;
  }
  for (const c of cl.COLORS) assert.ok(firstSlot[c] > 850 && firstSlot[c] < 1150, `${c}: ${firstSlot[c]}`);
});

test('判定：绿 / 白 / 黑与进阶圆点排序', () => {
  const answer = ['B', 'R', 'P', 'Y'];
  assert.deepEqual(cl.evaluate(answer, ['R', 'O', 'Y', 'C']).result, ['W', 'K', 'W', 'K']);
  const r = cl.evaluate(answer, ['Y', 'R', 'B', 'M']);
  assert.deepEqual(r.result, ['W', 'G', 'W', 'K']);
  assert.equal(r.green, 1);
  assert.equal(r.white, 2);
  assert.deepEqual(cl.pegs(r.result), ['G', 'W', 'W', 'K']);
  assert.deepEqual(cl.evaluate(answer, answer).result, ['G', 'G', 'G', 'G']);
});

test('换色在 7 色间循环；下一盏从第 4 盏回到第 1 盏；点击选中', () => {
  const g = lightsGame(['B', 'R', 'P', 'Y']);
  const seen = [];
  for (let i = 0; i < 8; i++) seen.push(cl.cycleColor(g));
  assert.deepEqual(seen, [...cl.COLORS, 'R']);
  for (let i = 0; i < 4; i++) cl.nextSlot(g);
  assert.equal(g.cursor, 0);
  assert.deepEqual(cl.selectSlot(g, 2), { cleared: -1 });
  assert.equal(g.cursor, 2);
  assert.equal(cl.selectSlot(g, 2), null, '点击已选中的灯无反应');
});

test('换色位置全局延续：熄灭的灯接着上一次的颜色往下换，已亮的灯从自身颜色往下换', () => {
  const g = lightsGame(['B', 'R', 'P', 'Y']);
  cycleTo(g, 'B');
  cl.nextSlot(g);
  assert.equal(cl.cycleColor(g), 'P', '新的一盏从蓝的下一个开始');
  cl.selectSlot(g, 0);
  assert.equal(cl.cycleColor(g), 'P', '已亮的蓝灯换到紫（确认时与第 2 盏互斥）');

  fillRow(g, ['R', 'O', 'Y', 'C']);
  cl.submit(g);
  assert.equal(g.lastColor, 'C');
  assert.equal(cl.cycleColor(g), 'B', '换到新的一行仍接着往下');

  const next = cl.createGame('simple', Math.random, g.lastColor);
  assert.equal(cl.cycleColor(next), 'P', '新的一局也延续');
  const back = cl.restoreGame(JSON.parse(JSON.stringify(next)));
  assert.equal(back.lastColor, 'P', '存档保留换色位置');
});

test('颜色数量：默认 4 色，可选 4–7 色；出题、换色、存档都只用本局的颜色', () => {
  const g = cl.createGame('simple', Math.random);
  assert.equal(g.colors, 4);
  assert.deepEqual([...g.answer].sort(), ['B', 'P', 'R', 'Y']);
  const seen = [];
  for (let i = 0; i < 5; i++) seen.push(cl.cycleColor(g));
  assert.deepEqual(seen, ['R', 'Y', 'B', 'P', 'R']);

  for (const n of cl.COLOR_COUNTS) {
    const colors = cl.palette(n);
    assert.equal(colors.length, n);
    assert.equal(cl.createGame('advanced', Math.random, null, n).colors, n);
    for (let i = 0; i < 200; i++) assert.ok(cl.makeAnswer(Math.random, colors).every((c) => colors.includes(c)));
  }
  assert.equal(cl.createGame('simple', Math.random, null, 3).colors, 4, '非法数量回到默认');

  const g5 = cl.createGame('simple', Math.random, 'C', 4);
  assert.equal(cl.cycleColor(g5), 'B', '全局位置不在本局颜色里时，接着往下找本局有的颜色');

  const save = JSON.parse(JSON.stringify(g));
  assert.equal(cl.restoreGame(save).colors, 4);
  assert.equal(cl.restoreGame({ ...save, answer: ['R', 'O', 'B', 'P'] }), null, '答案含本局没有的颜色');
  assert.equal(cl.restoreGame({ ...save, colors: 3 }), null);
  const { colors: _, ...old } = save;
  assert.equal(cl.restoreGame({ ...old, answer: ['R', 'O', 'B', 'P'] }).colors, 7, '旧存档按 7 色还原');
});

test('颜色互斥：换色时只提醒，确认（下一盏 / 点击 / 确定）时才熄灭撞色的灯', () => {
  const g = lightsGame(['B', 'R', 'P', 'Y']);
  fillRow(g, ['R']);
  cycleTo(g, 'R'); // 第 2 盏预选红，与第 1 盏撞色
  assert.equal(cl.conflictIndex(g), 0);
  assert.equal(g.current[0], 'R', '预选阶段不熄灭');
  cl.cycleColor(g); // 换到橙，冲突消失
  assert.equal(cl.conflictIndex(g), -1);
  cycleTo(g, 'R');
  assert.deepEqual(cl.nextSlot(g), { cleared: 0 });
  assert.deepEqual(g.current, [null, 'R', null, null]);

  cycleTo(g, 'R'); // 第 3 盏预选红，点击第 4 盏确认
  assert.deepEqual(cl.selectSlot(g, 3), { cleared: 1 });
  assert.deepEqual(g.current, [null, null, 'R', null]);
});

test('4 盏全亮才能提交；撞色时按确定先熄灭再拒绝提交', () => {
  const g = lightsGame(['B', 'R', 'P', 'Y']);
  fillRow(g, ['R', 'O', 'Y']);
  assert.equal(cl.allLit(g), false);
  assert.equal(cl.submit(g).ok, false);
  assert.equal(g.rows.length, 0);

  cl.selectSlot(g, 3);
  cycleTo(g, 'R'); // 第 4 盏预选红，与第 1 盏撞色
  assert.equal(cl.allLit(g), true);
  const res = cl.submit(g);
  assert.equal(res.ok, false);
  assert.equal(res.cleared, 0);
  assert.equal(g.rows.length, 0);
  assert.deepEqual(g.current, [null, 'O', 'Y', 'R']);
});

test('确认不可逆：逐行推进，重复猜测照常消耗一行，第 7 行仍不对即失败', () => {
  const g = lightsGame(['B', 'R', 'P', 'Y'], 'advanced');
  for (let i = 0; i < cl.ROWS; i++) {
    fillRow(g, ['R', 'O', 'Y', 'C']);
    const res = cl.submit(g);
    assert.equal(res.ok, true);
    assert.equal(g.rows.length, i + 1);
    assert.deepEqual(g.current, [null, null, null, null]);
    assert.equal(g.cursor, 0);
  }
  assert.equal(g.status, 'lost');
  assert.equal(cl.submit(g).ok, false);
  assert.equal(cl.cycleColor(g), null);
  assert.equal(cl.nextSlot(g), null);
  assert.equal(g.rows.length, cl.ROWS);
});

test('猜中即胜利，之后不再接受输入', () => {
  const g = lightsGame(['B', 'R', 'P', 'Y']);
  fillRow(g, ['Y', 'R', 'B', 'M']);
  cl.submit(g);
  fillRow(g, ['B', 'R', 'P', 'Y']);
  const res = cl.submit(g);
  assert.equal(res.status, 'won');
  assert.equal(g.rows.length, 2);
  assert.equal(cl.cycleColor(g), null);
});

test('存档还原：合法存档原样恢复，篡改或不一致的存档被丢弃', () => {
  const g = lightsGame(['B', 'R', 'P', 'Y'], 'advanced');
  fillRow(g, ['Y', 'R', 'B', 'M']);
  cl.submit(g);
  cl.cycleColor(g);
  const save = JSON.parse(JSON.stringify({ ...g, rows: g.rows.map((r) => ({ guess: r.guess })) }));
  const back = cl.restoreGame(save);
  assert.deepEqual(back.rows, g.rows);
  assert.deepEqual(back.current, g.current);
  assert.equal(back.status, 'playing');

  assert.equal(cl.restoreGame(null), null);
  assert.equal(cl.restoreGame({ ...save, answer: ['B', 'B', 'P', 'Y'] }), null);
  assert.equal(cl.restoreGame({ ...save, rows: [{ guess: ['R', 'R', 'O', 'Y'] }] }), null);
  assert.equal(cl.restoreGame({ ...save, status: 'won' }), null);
  assert.equal(cl.restoreGame({ ...save, rows: [{ guess: ['B', 'R', 'P', 'Y'] }, ...save.rows] }), null, '胜利后不能还有行');
});

console.log('扫雷');

// 用字符画摆雷：* 为雷，其余为空。直接布好雷并标记为进行中，跳过「第一下安全」
function mineGame(rows) {
  const g = ms.createGame('beginner');
  g.rows = rows.length;
  g.cols = rows[0].length;
  g.state = new Uint8Array(g.cols * g.rows);
  g.mine = Uint8Array.from(rows.join(''), (ch) => (ch === '*' ? 1 : 0));
  g.mines = g.mine.reduce((a, b) => a + b, 0);
  g.count = new Uint8Array(g.cols * g.rows);
  for (let i = 0; i < g.mine.length; i++) {
    if (g.mine[i]) for (const n of ms.neighbors(g, i)) g.count[n]++;
  }
  g.status = 'playing';
  return g;
}

test('第一下及周围 8 格无雷，雷数与数字正确（含角落和边）', () => {
  const rng = mulberry32(5);
  for (const level of Object.keys(ms.LEVELS)) {
    for (let k = 0; k < 200; k++) {
      const g = ms.createGame(level, k % 2 === 0);
      const total = g.cols * g.rows;
      const first = [0, g.cols - 1, total - 1, Math.floor(total / 2), Math.floor(rng() * total)][k % 5];
      const res = ms.reveal(g, first, rng);
      assert.equal(res.exploded, -1);
      assert.equal(g.mine.reduce((a, b) => a + b, 0), g.mines);
      for (const i of [first, ...ms.neighbors(g, first)]) assert.equal(g.mine[i], 0);
      assert.equal(g.count[first], 0, '第一下一定是空白格');
      for (let i = 0; i < total; i++) {
        assert.equal(g.count[i], ms.neighbors(g, i).filter((n) => g.mine[n]).length);
      }
    }
  }
});

test('高级竖屏转置为 16 × 30，横屏为 30 × 16', () => {
  const p = ms.createGame('expert', true);
  assert.deepEqual([p.cols, p.rows, p.mines], [16, 30, 99]);
  const l = ms.createGame('expert', false);
  assert.deepEqual([l.cols, l.rows, l.mines], [30, 16, 99]);
  assert.deepEqual([ms.createGame('intermediate', true).cols, ms.createGame('beginner', true).rows], [16, 9]);
});

test('自动展开：空白格向外扩散，数字格是边界，不越过旗，层数单调不减', () => {
  const g = mineGame([
    '.....',
    '.....',
    '...**',
    '.....',
    '*....',
  ]);
  g.state[1] = ms.FLAG;
  g.flags = 1;
  const res = ms.reveal(g, 0);
  const opened = res.opened.map(([i]) => i).sort((a, b) => a - b);
  // 插了旗的第 1 格不会被展开，但扩散会绕过它到达第 4 格
  assert.ok(!opened.includes(1));
  assert.equal(g.state[1], ms.FLAG);
  assert.ok(opened.includes(4));
  for (const [i] of res.opened) assert.equal(g.mine[i], 0);
  const layers = res.opened.map(([, l]) => l);
  assert.deepEqual(layers, [...layers].sort((a, b) => a - b));
  // 第 15 格是数字 1，停在这里，不会越过去碰到第 20 格的雷；最下面一行右侧被雷隔开，不会被展开
  assert.ok(opened.includes(15));
  assert.equal(g.count[15], 1);
  assert.ok(!opened.includes(21));
  assert.equal(g.status, 'playing');
  assert.equal(g.opened, opened.length);
});

test('插旗 / 拔旗 / 问号循环；已挖开的格子不能插旗；插旗格不能挖开', () => {
  const g = mineGame(['*..', '...', '...']);
  assert.equal(ms.toggleFlag(g, 0), ms.FLAG);
  assert.equal(ms.minesLeft(g), 0);
  assert.equal(ms.reveal(g, 0), null, '插旗格不能挖开');
  assert.equal(ms.toggleFlag(g, 0), ms.HIDDEN);
  assert.equal(ms.toggleFlag(g, 0, true), ms.FLAG);
  assert.equal(ms.toggleFlag(g, 0, true), ms.MARK);
  assert.equal(g.flags, 0, '问号不计入旗数');
  assert.equal(ms.toggleFlag(g, 0, true), ms.HIDDEN);
  ms.reveal(g, 4);
  assert.equal(ms.toggleFlag(g, 4), null);
  ms.toggleFlag(g, 1);
  ms.toggleFlag(g, 2);
  assert.equal(ms.minesLeft(g), -1, '旗数可以超过雷数');
});

test('快速挖开：旗数相等才挖开；旗数不符返回待闪烁的格子；旗插错则失败', () => {
  let g = mineGame(['*..', '...', '..*']);
  ms.reveal(g, 4); // 中心是 2
  assert.equal(g.count[4], 2);
  ms.toggleFlag(g, 0);
  const bad = ms.chord(g, 4);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.targets.sort((a, b) => a - b), [1, 2, 3, 5, 6, 7, 8]);
  ms.toggleFlag(g, 8);
  const ok = ms.chord(g, 4);
  assert.equal(ok.ok, true);
  assert.equal(g.status, 'won', '挖开其余 6 格即胜利');
  assert.equal(ms.chord(g, 4), null, '结束后不再响应');

  g = mineGame(['*..', '...', '..*']);
  ms.reveal(g, 4);
  ms.toggleFlag(g, 0);
  ms.toggleFlag(g, 1); // 插错
  const lost = ms.chord(g, 4);
  assert.equal(lost.exploded, 8);
  assert.equal(g.status, 'lost');
  assert.equal(g.exploded, 8);
  assert.equal(ms.toggleFlag(g, 2), null, '失败后棋盘只读');

  g = mineGame(['*..', '...', '...']);
  ms.reveal(g, 8);
  assert.equal(ms.chord(g, 8), null, '空白格不能快速挖开');
});

test('胜利：挖开全部非雷格即胜利，剩余的雷自动插旗', () => {
  const g = mineGame(['*....', '.....', '....*']);
  ms.toggleFlag(g, 0);
  const res = ms.reveal(g, 12);
  assert.equal(g.status, 'won');
  assert.equal(g.opened, ms.safeTotal(g));
  assert.deepEqual(res.autoFlagged, [14]);
  assert.equal(g.flags, g.mines);
  assert.equal(ms.reveal(g, 1), null);
});

test('随机对局 600 局：挖开数守恒，结束状态与棋盘一致', () => {
  const rng = mulberry32(99);
  let wins = 0;
  for (let k = 0; k < 600; k++) {
    const level = ['beginner', 'intermediate', 'expert'][k % 3];
    const g = ms.createGame(level, k % 2 === 1);
    const total = g.cols * g.rows;
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    let guard = 0;
    while (!['won', 'lost'].includes(g.status) && guard++ < total * 10) {
      // 偶尔插旗 / 快速挖开，大多数时候挖开一个安全格（模拟会推理的玩家），少数时候乱挖
      const r = rng();
      if (r < 0.1) ms.toggleFlag(g, Math.floor(rng() * total));
      else if (r < 0.2) ms.chord(g, Math.floor(rng() * total));
      else {
        const closed = [...g.state.keys()].filter((i) => g.state[i] === ms.HIDDEN || g.state[i] === ms.MARK);
        const safe = g.mine ? closed.filter((i) => !g.mine[i]) : closed;
        ms.reveal(g, pick(safe.length && rng() < 0.97 ? safe : closed), rng);
      }
      assert.equal(g.opened, g.state.filter((s) => s === ms.OPEN).length);
      assert.equal(g.flags, g.state.filter((s) => s === ms.FLAG).length);
    }
    assert.ok(['won', 'lost'].includes(g.status), `第 ${k} 局没有结束`);
    if (g.status === 'won') {
      wins++;
      assert.equal(g.opened, ms.safeTotal(g));
      for (let i = 0; i < total; i++) assert.equal(g.state[i] === ms.FLAG, !!g.mine[i]);
    } else {
      assert.equal(g.mine[g.exploded], 1);
      assert.ok(g.opened < ms.safeTotal(g));
    }
    for (let i = 0; i < total; i++) if (g.state[i] === ms.OPEN) assert.equal(g.mine[i], 0);
  }
  assert.ok(wins > 0);
});

test('存档还原：进行中与未开始的对局原样恢复，篡改或不一致的存档被丢弃', () => {
  const rng = mulberry32(8);
  const g = ms.createGame('expert', true);
  ms.toggleFlag(g, 0);
  const ready = ms.restoreGame(JSON.parse(JSON.stringify(ms.serialize(g))));
  assert.equal(ready.status, 'ready');
  assert.equal(ready.flags, 1);

  ms.reveal(g, 200, rng);
  ms.toggleFlag(g, 1, true);
  ms.toggleFlag(g, 1, true);
  g.elapsed = 12345;
  const save = JSON.parse(JSON.stringify(ms.serialize(g)));
  const back = ms.restoreGame(save);
  assert.deepEqual([back.cols, back.rows, back.status, back.elapsed], [16, 30, 'playing', 12345]);
  assert.deepEqual([...back.state], [...g.state]);
  assert.deepEqual([...back.mine], [...g.mine]);
  assert.deepEqual([...back.count], [...g.count]);
  assert.equal(back.opened, g.opened);
  assert.equal(back.flags, g.flags);
  ms.reveal(back, [...back.mine.keys()].find((i) => back.mine[i] && back.state[i] === ms.HIDDEN));
  assert.equal(back.status, 'lost', '还原后可以继续对局');

  assert.equal(ms.restoreGame(null), null);
  assert.equal(ms.restoreGame({ ...save, level: 'nope' }), null);
  assert.equal(ms.restoreGame({ ...save, cols: 20 }), null);
  assert.equal(ms.restoreGame({ ...save, mine: save.mine.replace('1', '0') }), null, '雷数不符');
  const openMine = save.mine.indexOf('1');
  const badState = save.state.slice(0, openMine) + '1' + save.state.slice(openMine + 1);
  assert.equal(ms.restoreGame({ ...save, state: badState }), null, '雷不能是已挖开状态');
  assert.equal(ms.restoreGame({ ...save, status: 'won' }), null, '已结束的对局不存档');
  assert.equal(ms.restoreGame({ ...save, mine: null }), null);
});

console.log('数独');

const SD_CLASSIC = [...'530070000600195000098000060800060003400803001700020006060000280000419005000080079'].map(Number);
const sdValid = (sol) => sdSolver.UNITS.every((u) => new Set(u.map((i) => sol[i])).size === 9 && u.every((i) => sol[i] >= 1));
const sdGame = () => sd.createGame({ difficulty: 'easy', puzzle: SD_CLASSIC, solution: sdSolver.solve(SD_CLASSIC) });

test('数解：唯一解为 1，挖空过多为 2，矛盾盘面为 0；求解结果合法', () => {
  assert.equal(sdSolver.countSolutions(SD_CLASSIC), 1);
  const sol = sdSolver.solve(SD_CLASSIC);
  assert.ok(sdValid(sol));
  assert.ok(SD_CLASSIC.every((v, i) => !v || v === sol[i]));
  assert.equal(sdSolver.countSolutions(new Array(81).fill(0)), 2);
  const bad = SD_CLASSIC.slice();
  bad[2] = 5; // 与同行的 5 冲突
  assert.equal(sdSolver.countSolutions(bad), 0);
  assert.ok(sdValid(sdSolver.fullGrid(mulberry32(1))));
});

test('逻辑求解器：经典题只用简单技巧解完；X-Wing 等技巧能被识别', () => {
  assert.deepEqual(sdSolver.rate(SD_CLASSIC), { solved: true, level: 1 });
  // 只留数字 1 的两行候选构成 X-Wing：第 1、5 行的 1 都只在第 1、5 列
  const s = sdSolver.makeState(new Array(81).fill(0));
  const bit = 1 << 1;
  for (const r of [0, 4]) for (let c = 0; c < 9; c++) if (c !== 0 && c !== 4) s.c[r * 9 + c] &= ~bit;
  const xw = sdSolver.TECHNIQUES.find((t) => t.id === 'xWing').fn(s);
  assert.ok(xw && xw.elims.every(({ i, d }) => d === 1 && (i % 9 === 0 || i % 9 === 4) && ![0, 4].includes((i / 9) | 0)));
  assert.equal(xw.elims.length, 14);
});

test('每档生成的题：唯一解、可推理、已知数与最难技巧都符合难度（每档 15 题）', () => {
  const rng = mulberry32(2026);
  for (const id of sdGen.DIFF_IDS) {
    for (let k = 0; k < 15; k++) {
      const p = sdGen.createPuzzle(id, rng, 3000);
      assert.equal(p.difficulty, id);
      assert.ok(sdGen.fitsDifficulty(p.puzzle, id), `${id} 不符合难度`);
      assert.deepEqual(sdSolver.solve(p.puzzle), p.solution);
    }
  }
});

test('内置题库每道都符合难度；等价变换后仍符合且答案一致', () => {
  const rng = mulberry32(9);
  for (const id of sdGen.DIFF_IDS) {
    assert.ok(SD_BANK[id].length >= 30, `${id} 题库过少`);
    for (const raw of SD_BANK[id]) assert.ok(sdGen.fitsDifficulty([...raw].map(Number), id), `${id}: ${raw}`);
    for (let k = 0; k < 10; k++) {
      const p = sdGen.fromBank(id, rng);
      assert.ok(sdGen.fitsDifficulty(p.puzzle, id));
      assert.ok(sdValid(p.solution));
      assert.deepEqual(sdSolver.solve(p.puzzle), p.solution);
    }
  }
});

test('填数：已知数不可改；相同数字再按为擦除；填错计数；自动清除同行列宫笔记', () => {
  const g = sdGame();
  assert.equal(sd.setValue(g, 0, 1), null, '已知数不可改');
  sd.toggleNote(g, 3, 4); // (0,3) 的笔记 4
  sd.toggleNote(g, 11, 4); // (1,2) 同宫
  sd.toggleNote(g, 72, 4); // (8,0) 无关
  const res = sd.setValue(g, 2, 4); // (0,2) 答案是 4
  assert.equal(res.wrong, false);
  assert.deepEqual(res.cleared.sort((a, b) => a - b), [3, 11]);
  assert.equal(g.notes[3], 0);
  assert.equal(g.notes[72], 1 << 4);
  assert.equal(sd.setValue(g, 2, 4).type, 'erase');
  assert.equal(g.values[2], 0);
  sd.setValue(g, 2, 9);
  assert.equal(g.errors, 1);
  sd.setValue(g, 2, 8, { countErrors: false });
  assert.equal(g.errors, 1);
});

test('笔记：有数字的格不能写；擦数字后笔记恢复；撤销连带恢复被自动清除的笔记；重做', () => {
  const g = sdGame();
  sd.toggleNote(g, 2, 1);
  sd.toggleNote(g, 2, 4);
  sd.toggleNote(g, 3, 4);
  sd.setValue(g, 2, 4);
  assert.equal(sd.toggleNote(g, 2, 7), null);
  sd.erase(g, 2);
  assert.equal(g.notes[2], (1 << 1) | (1 << 4), '擦除数字后原笔记恢复');
  sd.erase(g, 2);
  assert.equal(g.notes[2], 0, '再擦除清空笔记');
  sd.undo(g);
  sd.undo(g);
  assert.equal(g.values[2], 4);
  sd.undo(g);
  assert.equal(g.values[2], 0);
  assert.equal(g.notes[3], 1 << 4, '撤销恢复被自动清除的笔记');
  sd.redo(g);
  assert.equal(g.values[2], 4);
  assert.equal(g.notes[3], 0);
});

test('自动笔记写入合法候选；冲突检测；数字计数', () => {
  const g = sdGame();
  sd.autoNotes(g);
  for (let i = 0; i < 81; i++) {
    if (SD_CLASSIC[i]) continue;
    assert.equal(g.notes[i], sdSolver.candidatesOf(SD_CLASSIC, i));
    assert.ok(g.notes[i] & (1 << g.solution[i]));
  }
  sd.setValue(g, 2, 5); // 与 (0,0) 的 5 同行冲突
  assert.deepEqual([...sd.conflicts(g)].sort((a, b) => a - b), [0, 2]);
  assert.equal(sd.placedCount(g, 5, false), SD_CLASSIC.filter((v) => v === 5).length - 1);
  sd.undo(g);
  assert.equal(sd.conflicts(g).size, 0);
});

test('提示优先级：先指出填错，再指出笔记漏数，否则给出正确的下一步；只靠提示能解完（每档 3 题）', () => {
  const g = sdGame();
  sd.setValue(g, 2, 9);
  assert.deepEqual(sd.pickHint(g), { kind: 'wrong', cell: 2 });
  sd.erase(g, 2);
  sd.toggleNote(g, 2, 1);
  assert.deepEqual(sd.pickHint(g), { kind: 'note', cell: 2 });
  sd.erase(g, 2);

  const rng = mulberry32(5);
  for (const id of sdGen.DIFF_IDS) {
    for (let k = 0; k < 3; k++) {
      const p = sdGen.fromBank(id, rng);
      const gg = sd.createGame({ difficulty: id, ...p });
      let steps = 0;
      while (gg.status === 'playing') {
        const h = sd.pickHint(gg);
        assert.equal(h.kind, 'step', '可推理的题不应走到兜底');
        assert.equal(h.digit, gg.solution[h.cell]);
        assert.equal(sd.valueAt(gg, h.cell), 0);
        sd.setValue(gg, h.cell, h.digit);
        steps++;
      }
      assert.equal(steps, p.puzzle.filter((v) => !v).length);
      assert.equal(gg.errors, 0);
    }
  }
  const h = sd.createGame({ difficulty: 'easy', puzzle: SD_CLASSIC, solution: sdSolver.solve(SD_CLASSIC) });
  for (let k = 0; k < 3; k++) assert.ok(sd.useHint(h));
  assert.equal(sd.useHint(h), false, '每局 3 次');
  assert.equal(h.hintsUsed, 3);
});

test('填满且全对即胜利；之后不再接受输入', () => {
  const g = sdGame();
  for (let i = 0; i < 81; i++) if (!SD_CLASSIC[i]) sd.setValue(g, i, g.solution[i]);
  assert.equal(g.status, 'won');
  assert.equal(sd.setValue(g, 2, 1), null);
  assert.equal(sd.undo(g), null);
});

test('存档还原：合法存档原样恢复，篡改或不一致的存档被丢弃', () => {
  const g = sdGame();
  sd.setValue(g, 2, 4);
  sd.toggleNote(g, 3, 6);
  g.elapsed = 12345;
  const save = JSON.parse(JSON.stringify(g));
  const back = sd.restoreGame(save);
  assert.deepEqual(back, g);
  assert.equal(sd.restoreGame(null), null);
  assert.equal(sd.restoreGame({ ...save, difficulty: 'nightmare' }), null);
  assert.equal(sd.restoreGame({ ...save, values: save.values.map((v, i) => (i === 0 ? 3 : v)) }), null, '已知数格不能有填入');
  const badSol = save.solution.slice();
  [badSol[0], badSol[1]] = [badSol[1], badSol[0]];
  assert.equal(sd.restoreGame({ ...save, solution: badSol }), null);
  assert.equal(sd.restoreGame({ ...save, hintsLeft: 9 }), null);
  assert.equal(sd.restoreGame({ ...save, notes: save.notes.map(() => 1 << 12) }), null);
  assert.deepEqual(sd.restoreGame({ ...save, undo: [[{ i: 99 }]] }).undo, [], '撤销栈异常时清空');
});

console.log('俄罗斯方块');

const TT_STEP = 1000 / 60;

// rows：从可见区底部往上数的若干行（字符串数组，最后一个是第 19 行），'.' 为空，其他字符为已占
function ttGame(rows = [], piece = null, opts = {}) {
  const g = tt.createGame({ seed: 1, ...opts });
  g.board.fill(0);
  rows.forEach((row, k) => {
    const y = tt.ROWS - rows.length + k;
    [...row].forEach((ch, x) => {
      if (ch !== '.') g.board[(y + tt.BUFFER) * tt.COLS + x] = 1;
    });
  });
  if (piece) g.piece = { rot: 0, ...piece };
  g.events.length = 0;
  return g;
}

const ttRow = (g, y) => Array.from({ length: tt.COLS }, (_, x) => (tt.cell(g, x, y) ? '#' : '.')).join('');
const ttEvents = (g, type) => g.events.filter((e) => e.type === type);

test('7 袋随机：每袋 7 种各一个；同一种子序列相同', () => {
  const sequence = (seed) => {
    const g = tt.createGame({ seed });
    const seq = [];
    for (let i = 0; i < 70; i++) {
      seq.push(g.piece.type);
      tt.hardDrop(g);
      g.board.fill(0);
    }
    return seq.join('');
  };
  const a = sequence(42);
  for (let i = 0; i < 70; i += 7) assert.equal([...a.slice(i, i + 7)].sort().join(''), 'IJLOSTZ');
  assert.equal(sequence(42), a);
  assert.notEqual(sequence(43), a);
});

test('方块形状与出生：4 个朝向各 4 格；出生在第 3–6 列并立刻下落一格', () => {
  for (const type of tt.TYPES) {
    for (const cells of tt.SHAPES[type]) assert.equal(new Set(cells.map(String)).size, 4);
  }
  const g = tt.createGame({ seed: 7 });
  const xs = tt.cellsOf(g.piece).map(([x]) => x);
  assert.ok(Math.min(...xs) >= 3 && Math.max(...xs) <= 6);
  assert.equal(Math.max(...tt.cellsOf(g.piece).map(([, y]) => y)), 0, '出生后最下面一格进入可见区第 0 行');
});

test('SRS：空地不踢墙；贴墙时按踢墙表偏移；转不过去则不动', () => {
  const g = ttGame([], { type: 'T', x: 4, y: 5 });
  assert.ok(tt.rotate(g, 1));
  assert.deepEqual([g.piece.rot, g.piece.x, g.piece.y, g.lastKick], [1, 4, 5, 0]);

  // T 竖着贴左墙（R 朝向占第 0 列），转到 2 时第 1 个测试越界，第 2 个测试 (+1, 0) 成功
  const t = ttGame([], { type: 'T', rot: 1, x: -1, y: 5 });
  assert.ok(tt.rotate(t, 1));
  assert.deepEqual([t.piece.rot, t.piece.x, t.lastKick], [2, 0, 1]);

  // I 竖着贴左墙（L 朝向占第 0 列），转回 0 时用 (+1, 0)
  const i = ttGame([], { type: 'I', rot: 3, x: -1, y: 5 });
  assert.ok(tt.rotate(i, 1));
  assert.deepEqual([i.piece.rot, i.piece.x, i.lastKick], [0, 0, 1]);

  // 被完全卡住：转不过去，位置不变
  const stuck = ttGame(Array(20).fill('###...####'), { type: 'I', rot: 1, x: 2, y: 10 });
  assert.equal(tt.rotate(stuck, 1), false);
  assert.deepEqual([stuck.piece.rot, stuck.piece.x, stuck.piece.y], [1, 2, 10]);
});

test('锁定延迟：着地 500ms 锁定；移动重置最多 15 次；落到更低处重置次数清零', () => {
  const g = ttGame([], { type: 'O', x: 3, y: 18 });
  tt.tick(g, 499);
  assert.ok(g.piece, '499ms 还没锁定');
  tt.tick(g, 1);
  assert.equal(g.pieces, 1);

  const r = ttGame([], { type: 'O', x: 3, y: 18 });
  for (let k = 0; k < 15; k++) {
    tt.tick(r, 400);
    assert.ok(tt.move(r, k % 2 ? 1 : -1));
  }
  assert.equal(r.lockResets, 15);
  assert.equal(r.pieces, 0);
  tt.tick(r, TT_STEP);
  assert.equal(r.pieces, 1, '重置次数用完后着地立即锁定');

  // 在台阶上用掉几次重置，再移下台阶落到更低处：重置次数清零
  const s = ttGame(['....######'], { type: 'O', x: 4, y: 17 });
  s.lowestY = 17;
  tt.tick(s, 300);
  assert.ok(tt.move(s, 1));
  assert.ok(tt.move(s, -1));
  assert.ok(tt.move(s, -1));
  assert.equal(s.lockResets, 3);
  assert.ok(tt.move(s, -1));
  assert.ok(tt.move(s, -1));
  tt.tick(s, 1000);
  assert.equal(s.piece.y, 18);
  assert.equal(s.lockResets, 0);
});

test('重力：1 级每格 1 秒；高等级一帧多格但逐格检查，不穿过横档；软降 20 倍并每格 1 分', () => {
  assert.equal(Math.round(tt.gravityMs(1)), 1000);
  assert.equal(Math.round(tt.gravityMs(10)), 64);
  assert.ok(tt.gravityMs(20) < 1);
  const g = ttGame([], { type: 'T', x: 4, y: 0 });
  tt.tick(g, 999);
  assert.equal(g.piece.y, 0);
  tt.tick(g, 1);
  assert.equal(g.piece.y, 1);

  const bar = Array(20).fill('..........');
  bar[10] = '##########';
  const fast = ttGame(bar, { type: 'I', x: 3, y: -1 });
  fast.level = 20;
  tt.tick(fast, TT_STEP);
  assert.equal(Math.max(...tt.cellsOf(fast.piece).map(([, y]) => y)), 9, '停在横档上方');

  const soft = ttGame([], { type: 'T', x: 4, y: 0 });
  tt.tick(soft, 100, true);
  assert.equal(soft.piece.y, 2);
  assert.equal(soft.score, 2);
});

test('消行：不相邻的两行同时消除，上方整体下移；消行动画结束后才出下一个', () => {
  const g = ttGame(['..........', '.#########', '..########', '.#########'], { type: 'I', rot: 1, x: -2, y: 5 });
  tt.hardDrop(g);
  assert.deepEqual(g.clearing.rows, [17, 19]);
  assert.equal(g.piece, null);
  assert.equal(g.lines, 2);
  tt.tick(g, 199);
  assert.ok(g.clearing);
  tt.tick(g, 1);
  assert.equal(g.clearing, null);
  assert.ok(g.piece, '动画结束后出生下一个方块');
  assert.equal(ttRow(g, 19), '#.########');
  assert.equal(ttRow(g, 18), '#.........');
  assert.equal(ttRow(g, 17), '..........');
  assert.equal(g.score, 300 + 2 * 11, '消 2 行 300 分 + 硬降 11 格');
});

test('计分：Tetris、背靠背 ×1.5、连击、普通消行中断背靠背；按等级升级', () => {
  const well = Array(9).fill('.#########');
  const g = ttGame(well, { type: 'I', rot: 1, x: -2, y: 0 });
  tt.hardDrop(g);
  tt.tick(g, 300);
  let clear = ttEvents(g, 'clear').pop();
  assert.deepEqual([clear.lines, clear.points, clear.b2b, clear.combo], [4, 800, false, 0]);
  g.events.length = 0;
  g.piece = { type: 'I', rot: 1, x: -2, y: 0 };
  tt.hardDrop(g);
  clear = ttEvents(g, 'clear').pop();
  assert.deepEqual([clear.lines, clear.points, clear.b2b, clear.combo], [4, 1200 + 50, true, 1]);
  tt.tick(g, 300);
  g.events.length = 0;
  g.piece = { type: 'O', rot: 0, x: -1, y: 0 };
  tt.hardDrop(g);
  assert.equal(ttEvents(g, 'clear').length, 0, '剩下的一行没填满，不消行');
  assert.equal(g.combo, -1, '没消行，连击中断');
  assert.equal(g.b2b, true, '不消行不影响背靠背');

  const lv = ttGame(['.#########'], { type: 'I', rot: 1, x: -2, y: 0 }, { startLevel: 5 });
  lv.lines = 9;
  tt.hardDrop(lv);
  assert.equal(lv.level, 6);
  assert.equal(ttEvents(lv, 'levelup').length, 1);
  assert.equal(ttEvents(lv, 'clear')[0].points, 100 * 5, '按消行前的等级计分');
  assert.equal(lv.b2b, false);

  const sprint = tt.createGame({ mode: 'sprint', startLevel: 8 });
  assert.equal(sprint.level, 1, '竞速与限时固定 1 级');
});

test('T-Spin：三角规则判定 T-Spin / Mini；第 5 个踢墙偏移一律算 T-Spin；最后一步不是旋转则不算', () => {
  const tsd = () => ttGame(['..#.......', '##...#####', '###.######'], { type: 'T', rot: 2, x: 2, y: 17 });
  const g = tsd();
  Object.assign(g, { lastRotate: true, lastKick: 0 });
  tt.hardDrop(g);
  const ev = ttEvents(g, 'clear')[0];
  assert.deepEqual([ev.spin, ev.lines, ev.points], ['tspin', 2, 1200]);
  assert.equal(g.tspins, 1);

  const plain = tsd();
  tt.hardDrop(plain);
  assert.deepEqual([ttEvents(plain, 'clear')[0].spin, ttEvents(plain, 'clear')[0].points], [null, 300]);

  const mini = () => ttGame(['#.........', '...#######'], { type: 'T', rot: 0, x: 0, y: 18 });
  const m = mini();
  Object.assign(m, { lastRotate: true, lastKick: 0 });
  tt.hardDrop(m);
  assert.deepEqual([ttEvents(m, 'clear')[0].spin, ttEvents(m, 'clear')[0].points], ['mini', 200]);

  const k5 = mini();
  Object.assign(k5, { lastRotate: true, lastKick: 4 });
  tt.hardDrop(k5);
  assert.deepEqual([ttEvents(k5, 'clear')[0].spin, ttEvents(k5, 'clear')[0].points], ['tspin', 800]);

  // 旋转后又移动或自然下落，最后一步就不是旋转了
  const moved = ttGame([], { type: 'T', x: 4, y: 5 });
  tt.rotate(moved, 1);
  assert.equal(moved.lastRotate, true);
  tt.move(moved, 1);
  assert.equal(moved.lastRotate, false);
  tt.rotate(moved, 1);
  tt.tick(moved, 1000);
  assert.equal(moved.lastRotate, false);
});

test('暂存：每个方块只能暂存一次；锁定后可再暂存并换回原方块', () => {
  const g = tt.createGame({ seed: 3 });
  const first = g.piece.type;
  const second = g.queue[0];
  assert.ok(tt.hold(g));
  assert.deepEqual([g.hold, g.piece.type, g.holdUsed], [first, second, true]);
  assert.equal(tt.hold(g), false);
  tt.hardDrop(g);
  assert.equal(g.holdUsed, false);
  const third = g.piece.type;
  assert.ok(tt.hold(g));
  assert.deepEqual([g.hold, g.piece.type], [third, first]);
});

test('游戏结束：出生被挡、整块锁在可见区以上算结束；部分伸进隐藏区不算', () => {
  const g = ttGame([], { type: 'O', x: -1, y: 10 });
  for (const y of [-2, -1, 0]) for (let x = 3; x <= 6; x++) g.board[(y + tt.BUFFER) * tt.COLS + x] = 1;
  tt.hardDrop(g);
  assert.equal(g.status, 'over');
  assert.equal(ttEvents(g, 'over')[0].reason, 'blockout');

  const full = ttGame(Array(20).fill('#########.'), { type: 'O', x: -1, y: -6 });
  tt.hardDrop(full);
  assert.equal(full.status, 'over');
  assert.equal(ttEvents(full, 'over')[0].reason, 'lockout');

  const partial = ttGame(Array(19).fill('#########.'), { type: 'O', x: -1, y: -5 });
  tt.hardDrop(partial);
  assert.ok(ttEvents(partial, 'lock')[0].cells.some(([, y]) => y >= 0));
  assert.equal(ttEvents(partial, 'over').length, 0, '下面一行进入可见区，不结束');
});

test('模式：40 行达成即完成并停表；限时 2 分钟到点结束，消行动画中则等动画结束', () => {
  const s = ttGame(['.#########'], { type: 'I', rot: 1, x: -2, y: 0 }, { mode: 'sprint' });
  s.lines = 39;
  s.elapsed = 5000;
  tt.hardDrop(s);
  assert.equal(s.status, 'done');
  tt.tick(s, 1000);
  assert.equal(s.elapsed, 5000, '完成后不再计时');
  assert.equal(s.clearing, null, '消行动画仍会播完');

  const u = tt.createGame({ mode: 'ultra', seed: 5 });
  while (u.status === 'playing') {
    u.board.fill(0);
    tt.tick(u, 50);
  }
  assert.deepEqual([u.status, u.elapsed], ['done', tt.ULTRA_MS]);

  const uc = ttGame(['.#########'], { type: 'I', rot: 1, x: -2, y: 0 }, { mode: 'ultra' });
  uc.elapsed = tt.ULTRA_MS - 50;
  tt.hardDrop(uc);
  tt.tick(uc, 100);
  assert.equal(uc.status, 'playing', '动画中到点，先等动画结束');
  tt.tick(uc, 200);
  assert.deepEqual([uc.status, uc.lines], ['done', 1]);
});

test('随机对局 300 局：方块守恒、没有残留满行、得分不减、事件与统计一致', () => {
  const rng = mulberry32(2026);
  let totalPieces = 0;
  for (let n = 0; n < 300; n++) {
    const g = tt.createGame({ seed: n, mode: tt.MODES[n % 3], startLevel: 1 + (n % 10) });
    let lines = 0;
    let lastScore = 0;
    for (let step = 0; step < 20000 && g.status === 'playing'; step++) {
      const r = rng();
      if (r < 0.25) tt.move(g, rng() < 0.5 ? -1 : 1);
      else if (r < 0.4) tt.rotate(g, rng() < 0.5 ? -1 : 1);
      else if (r < 0.45) tt.hold(g);
      else if (r < 0.5) tt.hardDrop(g);
      else tt.tick(g, TT_STEP, rng() < 0.3);
      let spawned = false;
      for (const ev of g.events) {
        if (ev.type === 'clear') lines += ev.lines;
        if (ev.type === 'spawn') spawned = true;
      }
      g.events.length = 0;
      assert.ok(g.score >= lastScore);
      lastScore = g.score;
      if (spawned) {
        assert.ok(tt.fits(g, g.piece.type, g.piece.rot, g.piece.x, g.piece.y), '新方块不与场地重叠');
        for (let y = 0; y < tt.ROWS; y++) assert.notEqual(ttRow(g, y), '##########', '出新方块时没有残留满行');
      }
    }
    assert.equal(lines, g.lines);
    totalPieces += g.pieces;
  }
  assert.ok(totalPieces > 3000);
});

test('存档还原：还原后继续对局结果完全一致；篡改或不一致的存档被丢弃', () => {
  const rng = mulberry32(99);
  const g = tt.createGame({ seed: 123, mode: 'marathon', startLevel: 3 });
  const actions = [];
  const act = (game, a) => {
    if (a === 0) tt.move(game, -1);
    else if (a === 1) tt.move(game, 1);
    else if (a === 2) tt.rotate(game, 1);
    else if (a === 3) tt.hardDrop(game);
    else if (a === 4) tt.hold(game);
    else tt.tick(game, TT_STEP);
  };
  // 先把方块随机分散地落 60 个，快到顶就清空场地，保证存档时对局还在进行
  for (let i = 0; i < 60; i++) {
    const dx = Math.floor(rng() * 9) - 4;
    for (let k = 0; k < Math.abs(dx); k++) tt.move(g, Math.sign(dx));
    for (let k = Math.floor(rng() * 4); k > 0; k--) tt.rotate(g, 1);
    if (rng() < 0.2) tt.hold(g);
    tt.hardDrop(g);
    while (g.clearing) tt.tick(g, TT_STEP);
    if (tt.inDanger(g)) g.board.fill(0);
  }
  for (let i = 0; i < 30; i++) act(g, [0, 1, 2, 5][Math.floor(rng() * 4)]);
  while (g.clearing) tt.tick(g, TT_STEP);
  assert.equal(g.status, 'playing');
  assert.ok(g.pieces >= 60 && g.score > 0);
  const save = JSON.parse(JSON.stringify(tt.serialize(g)));
  const back = tt.restoreGame(save);
  assert.deepEqual(tt.serialize(back), tt.serialize(g));
  for (let i = 0; i < 2000; i++) actions.push(Math.floor(rng() * 7));
  for (const a of actions) {
    act(g, a);
    act(back, a);
  }
  assert.deepEqual(tt.serialize(back), tt.serialize(g), '确定性：同样的操作得到同样的局面');

  assert.equal(tt.restoreGame(null), null);
  assert.equal(tt.restoreGame({ ...save, v: 0 }), null);
  assert.equal(tt.restoreGame({ ...save, mode: 'zen' }), null);
  assert.equal(tt.restoreGame({ ...save, board: save.board.replace('0', '9') }), null);
  assert.equal(tt.restoreGame({ ...save, queue: 'IOX' }), null);
  assert.equal(tt.restoreGame({ ...save, level: 1 }), null, '等级低于起始等级');
  assert.equal(tt.restoreGame({ ...save, score: -1 }), null);
  const blocked = save.board.split('');
  blocked.fill('1', (save.piece.y + tt.BUFFER) * tt.COLS, (save.piece.y + tt.BUFFER + 4) * tt.COLS);
  assert.equal(tt.restoreGame({ ...save, board: blocked.join('') }), null, '当前方块与场地重叠');
  assert.equal(tt.restoreGame({ ...save, piece: null, clearing: { rows: [19], t: 0 } }), null, '消行的行没填满');
});

console.log('推箱子');

const skSnapshot = (g) => ({ box: [...g.box].join(''), player: g.player, moves: g.moves, pushes: g.pushes, history: g.history });

test('关卡数据：100 关按章连续；每关合法、尺寸不超过 11 × 11、开局未完成且没有箱子在死格上', () => {
  assert.equal(SK_LEVELS.length, 100);
  assert.equal(SK_CHAPTERS[0].from, 0);
  SK_CHAPTERS.forEach((c, k) => {
    assert.ok(c.to > c.from);
    if (k) assert.equal(c.from, SK_CHAPTERS[k - 1].to);
  });
  assert.equal(SK_CHAPTERS.at(-1).to, SK_LEVELS.length);
  const keys = new Set();
  SK_LEVELS.forEach(({ map, minPushes }, i) => {
    const g = sk.createGame(map, i);
    assert.ok(g, `第 ${i + 1} 关解析失败`);
    assert.ok(g.w <= 11 && g.h <= 11, `第 ${i + 1} 关尺寸 ${g.w}×${g.h}`);
    assert.equal(g.status, 'playing');
    assert.ok(minPushes > 0);
    for (let c = 0; c < g.box.length; c++) assert.ok(!(g.box[c] && g.dead[c]), `第 ${i + 1} 关开局箱子在死格上`);
    keys.add(sk.levelKey(map));
  });
  assert.equal(keys.size, SK_LEVELS.length, '关卡地图不重复');
});

test('解析：多个玩家、箱子数≠目标数、没被墙围住、非法字符都判为非法', () => {
  assert.ok(sk.parseLevel(['#####', '#@$.#', '#####']));
  assert.equal(sk.parseLevel(['#####', '#@@$.#', '#####']), null);
  assert.equal(sk.parseLevel(['######', '#@$$.#', '######']), null);
  assert.equal(sk.parseLevel(['#####', '#@$. ', '#####']), null);
  assert.equal(sk.parseLevel(['#####', '#@$x.#', '#####']), null);
  assert.equal(sk.parseLevel(['#####', '#@ .#', '#####']), null, '没有箱子');
});

test('每关正向求解有解且最少推动与关卡数据一致；解法转成走法在引擎里回放能过关', () => {
  let total = 0;
  SK_LEVELS.forEach(({ map, minPushes }, i) => {
    const sol = skSolve(map);
    assert.ok(sol, `第 ${i + 1} 关无解`);
    assert.equal(sol.pushes, minPushes, `第 ${i + 1} 关最少推动`);
    total += sol.states;
    const g = sk.createGame(map, i);
    for (const { box, dir } of sol.solution) {
      const stand = box - sk.delta(g, dir);
      const path = sk.findPath(g, stand);
      assert.ok(path, `第 ${i + 1} 关走不到推箱位置`);
      for (const d of path) assert.equal(sk.step(g, d, false).type, 'move');
      assert.equal(sk.step(g, dir, false).type, 'aim', '方向键不直接推时先对准');
      assert.equal(sk.push(g).type, 'push');
    }
    assert.equal(g.status, 'won', `第 ${i + 1} 关回放没过关`);
    assert.equal(g.pushes, minPushes);
    assert.equal(sk.step(g, 0, true), null, '过关后不再接受移动');
  });
  console.log(`    ${SK_LEVELS.length} 关共搜索 ${total} 个状态`);
});

test('走路、撞墙、对准、推不动、推两个箱子；对准和撞墙不算步数', () => {
  const g = sk.createGame(['#######', '#@ $ .#', '#  $ .#', '#######']);
  assert.equal(sk.step(g, 0).type, 'bump');
  assert.equal(g.moves, 0);
  assert.equal(g.facing, 0);
  assert.equal(sk.step(g, 1, false).type, 'move');
  const aim = sk.step(g, 1, false);
  assert.equal(aim.type, 'aim');
  assert.equal(g.moves, 1);
  assert.equal(sk.aimedBox(g), aim.boxFrom);
  const res = sk.push(g);
  assert.deepEqual([res.type, g.moves, g.pushes, g.history], ['push', 2, 1, 'rR']);
  assert.equal(sk.push(g).type, 'push');
  assert.equal(g.status, 'playing', '还有箱子没就位');
  assert.equal(sk.push(g), null, '后面是墙，推不动');
  // 往下推：下面一格是箱子，再下面是另一个箱子 → 推不动
  const h = sk.createGame(['#####', '#@  #', '#$  #', '#$  #', '#.  #', '#.  #', '#####']);
  assert.equal(sk.step(h, 2, true).type, 'blocked');
  assert.equal(sk.aimedBox(h), -1);
  assert.equal(h.moves, 0);
});

test('撤销：随机操作后全部撤销回到开局；撤销推箱子时箱子拉回原位；过关后撤销回到进行中', () => {
  const rng = mulberry32(31);
  for (const i of [5, 20, 35, 49]) {
    const g = sk.createGame(SK_LEVELS[i].map, i);
    const start = skSnapshot(g);
    const states = [skSnapshot(g)];
    for (let k = 0; k < 400; k++) {
      const res = sk.step(g, Math.floor(rng() * 4), rng() < 0.5);
      if (res && (res.type === 'move' || res.type === 'push')) states.push(skSnapshot(g));
      if (g.status !== 'playing') break;
    }
    assert.equal(g.moves, g.history.length);
    assert.equal(g.pushes, [...g.history].filter((c) => c === c.toUpperCase()).length);
    while (g.history) {
      states.pop();
      assert.ok(sk.undo(g));
      assert.deepEqual(skSnapshot(g), states.at(-1));
    }
    assert.deepEqual(skSnapshot(g), start);
    assert.equal(sk.undo(g), null);
  }
  const g = sk.createGame(['#####', '#@$.#', '#####']);
  sk.step(g, 1, true);
  assert.equal(g.status, 'won');
  const res = sk.undo(g);
  assert.deepEqual([res.type, res.boxFrom, res.boxTo, g.status, g.pushes], ['push', 8, 7, 'playing', 0]);
});

test('死格：墙角和贴墙且这面墙上没有目标点的格子是死格；目标点永远是活格', () => {
  const g = sk.createGame(['#######', '#     #', '# $ . #', '#  @  #', '#######']);
  const deadAt = (x, y) => g.dead[y * g.w + x];
  for (let x = 1; x <= 5; x++) {
    assert.equal(deadAt(x, 1), 1, `(${x},1)`);
    assert.equal(deadAt(x, 3), 1, `(${x},3)`);
  }
  assert.deepEqual([deadAt(1, 2), deadAt(2, 2), deadAt(3, 2), deadAt(4, 2), deadAt(5, 2)], [1, 0, 0, 0, 1]);
  const t = sk.createGame(['#####', '#.$@#', '#####']);
  assert.equal(t.dead[t.w + 1], 0, '墙角上的目标点不是死格');
  for (const { map } of SK_LEVELS) {
    const lv = sk.createGame(map);
    for (let c = 0; c < lv.target.length; c++) if (lv.target[c]) assert.equal(lv.dead[c], 0);
  }
});

test('自动寻路：最短且不穿墙和箱子；同样长度少拐弯；走不到返回 null', () => {
  const g = sk.createGame(['#######', '#@    #', '#     #', '##$####', '#. #  #', '#######']);
  const to = 2 * g.w + 5;
  const path = sk.findPath(g, to);
  assert.equal(path.length, 5);
  const turns = path.slice(1).filter((d, k) => d !== path[k]).length;
  assert.equal(turns, 1, `路径 ${path}`);
  for (const d of path) assert.equal(sk.step(g, d, false).type, 'move');
  assert.equal(g.player, to);
  assert.equal(sk.findPath(g, 4 * g.w + 4), null, '被墙隔开');
  assert.equal(sk.findPath(g, 3 * g.w + 2), null, '箱子所在格');
  assert.deepEqual(sk.findPath(g, to), []);
});

test('存档：按历史回放后局面一致；篡改、版本不符、越界的存档被丢弃；解锁规则', () => {
  const g = sk.createGame(SK_LEVELS[7].map, 7);
  const sol = skSolve(SK_LEVELS[7].map);
  const { box, dir } = sol.solution[0];
  for (const d of sk.findPath(g, box - sk.delta(g, dir))) sk.step(g, d);
  sk.step(g, dir, true);
  sk.step(g, (dir + 2) % 4, true);
  const save = JSON.parse(JSON.stringify(sk.serialize(g, SK_VERSION)));
  const back = sk.restoreGame(save, SK_LEVELS, SK_VERSION);
  assert.deepEqual(skSnapshot(back), skSnapshot(g));
  assert.equal(back.facing, g.facing);
  assert.equal(back.index, 7);
  assert.equal(sk.restoreGame(null, SK_LEVELS, SK_VERSION), null);
  assert.equal(sk.restoreGame({ ...save, v: SK_VERSION + 1 }, SK_LEVELS, SK_VERSION), null);
  assert.equal(sk.restoreGame({ ...save, level: SK_LEVELS.length }, SK_LEVELS, SK_VERSION), null);
  assert.equal(sk.restoreGame({ ...save, history: `${save.history}x` }, SK_LEVELS, SK_VERSION), null);
  assert.equal(sk.restoreGame({ ...save, history: save.history.toUpperCase() }, SK_LEVELS, SK_VERSION), null, '大小写和是否推箱子不一致');
  assert.equal(sk.restoreGame({ ...save, history: 'uuuuuuuuuuuu' }, SK_LEVELS, SK_VERSION), null, '撞墙');
  assert.ok(sk.restoreGame({ ...save, history: '' }, SK_LEVELS, SK_VERSION));

  assert.ok(sk.isUnlocked(2, -1));
  assert.ok(!sk.isUnlocked(3, -1));
  assert.ok(sk.isUnlocked(9, 6));
  assert.ok(!sk.isUnlocked(10, 6));
});

console.log('主页排序');

test('入口按点击次数从多到少排；次数相同按最近点击；没点过的保持原顺序排在最后', () => {
  const games = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
  const order = (usage) => sortByUsage(games, usage).map((g) => g.id).join('');
  assert.equal(order({}), 'abcde');
  assert.equal(order(null), 'abcde');
  let u = {};
  u = recordClick(u, 'd', 100);
  u = recordClick(u, 'b', 200);
  u = recordClick(u, 'd', 300);
  assert.deepEqual(u.d, { count: 2, last: 300 });
  assert.equal(order(u), 'dbace');
  u = recordClick(u, 'e', 400);
  assert.equal(order(u), 'debac', '次数相同时最近点过的在前');
  u = recordClick(u, 'b', 500);
  u = recordClick(u, 'b', 600);
  assert.equal(order(u), 'bdeac');
  assert.equal(order({ ...u, zzz: { count: 99, last: 1 } }), 'bdeac', '已删除的游戏记录被忽略');
  assert.equal(order({ a: { count: 'x', last: 1 }, c: { count: 1 } }), 'abcde', '损坏的记录视为没点过');
  assert.deepEqual(recordClick({ a: { count: -3 } }, 'a', 7).a, { count: 1, last: 7 });
});

console.log(`\n全部 ${passed} 项通过`);
