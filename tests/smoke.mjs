// 冒烟测试：node tests/smoke.mjs
import assert from 'node:assert/strict';
import { createSolved, isSolved, isSolvable, shuffle, moveAt, moveDirection } from '../games/klotski/puzzle.js';
import { chooseMove, findWinLine, shapeAt, SHAPE, BLACK, WHITE, SIZE } from '../games/gomoku/ai.js';

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

console.log(`\n全部 ${passed} 项通过`);
