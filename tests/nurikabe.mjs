// 数墙测试：node tests/nurikabe.mjs
import assert from 'node:assert/strict';
import * as nk from '../games/nurikabe/board.js';
import { solve, enumerateShapes } from '../games/nurikabe/solver.js';
import { makePuzzle, randomSolution, placeClues } from '../games/nurikabe/generator.js';
import { BANK } from '../games/nurikabe/puzzles.js';

const { EMPTY, BLACK, DOT } = nk;
let passed = 0;
function test(name, fn) {
  const t0 = Date.now();
  fn();
  passed++;
  console.log(`  ✓ ${name} (${Date.now() - t0}ms)`);
}

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 用字符画建题：数字为数字格，'#' 为黑格，'o' 为白点，'.' 为空格
function gameFrom(rows) {
  const n = rows.length;
  const puzzle = rows.join('').replace(/[#o]/g, '.');
  const game = nk.createGame(n === 5 ? 'easy' : n === 7 ? 'medium' : 'hard', 0, 0, [puzzle, '.'.repeat(n * n)]);
  [...rows.join('')].forEach((c, i) => {
    if (c === '#') game.cells[i] = BLACK;
    if (c === 'o') game.cells[i] = DOT;
  });
  return game;
}

// 交互测试用的题面（答案不参与）
const SAMPLE = ['2...2', '.....', '..3..', '.....', '1...3'];
const SAMPLE_ANSWER = ['.....', '.....', '.....', '.....', '.....'];
// 5×5 唯一解示例（答案中 # 为黑格）
const EXAMPLE = ['....2', '..4..', '....1', '2....', '....1'];
const EXAMPLE_ANSWER = ['###..', '#..##', '##.#.', '.#.##', '.###.'];

console.log('数墙');

test('题库：三档各 40 道，格式正确，题面与答案一致', () => {
  for (const id of nk.LEVEL_IDS) {
    const n = nk.LEVELS[id].size;
    assert.equal(BANK[id].length, 40, id);
    for (const [p, s] of BANK[id]) {
      assert.equal(p.length, n * n);
      assert.equal(s.length, n * n);
      assert.match(p, /^[.1-9]+$/);
      assert.match(s, /^[.#]+$/);
      const clues = nk.decodePuzzle(p);
      for (let i = 0; i < n * n; i++) if (clues[i]) assert.equal(s[i], '.', '数字格必须是白格');
      const cells = Uint8Array.from(s, (c) => (c === '#' ? BLACK : EMPTY));
      assert.ok(nk.isSolved(n, clues, cells), `${id} 答案满足规则：${p}`);
    }
  }
});

test('题库：每道题求解器解数恰好为 1，且与存储的答案一致', () => {
  for (const id of nk.LEVEL_IDS) {
    const n = nk.LEVELS[id].size;
    for (const [p, s] of BANK[id]) {
      const res = solve(n, n, nk.decodePuzzle(p), { limit: 2 });
      assert.equal(res.count, 1, `${id} ${p}`);
      assert.equal(nk.encodeSolution(res.solution), s);
    }
  }
});

// 与求解器无关的朴素穷举：逐格试黑 / 白，只用黑格总数和 2×2 剪枝，最后整盘判定
function bruteCount(n, clues, limit = 2) {
  const N = n * n;
  const cells = new Uint8Array(N);
  const blacks = N - clues.reduce((a, b) => a + b, 0);
  const freeAfter = new Array(N + 1).fill(0);
  for (let i = N - 1; i >= 0; i--) freeAfter[i] = freeAfter[i + 1] + (clues[i] ? 0 : 1);
  let count = 0;
  const rec = (i, used) => {
    if (count >= limit || used > blacks || used + freeAfter[i] < blacks) return;
    if (i === N) {
      if (nk.isSolved(n, clues, cells)) count++;
      return;
    }
    rec(i + 1, used);
    if (clues[i]) return;
    const x = i % n;
    if (x > 0 && i >= n && cells[i - 1] && cells[i - n] && cells[i - n - 1]) return;
    cells[i] = BLACK;
    rec(i + 1, used + 1);
    cells[i] = EMPTY;
  };
  rec(0, 0);
  return count;
}

test('题库：5×5 每道题用朴素穷举复核，解数恰好为 1', () => {
  for (const [p] of BANK.easy) assert.equal(bruteCount(5, nk.decodePuzzle(p)), 1, p);
});

test('求解器与朴素穷举对随机 5×5 题面的解数（封顶 2）一致（200 题）', () => {
  const rng = mulberry32(99);
  let multi = 0;
  for (let k = 0; k < 200; k++) {
    const black = randomSolution(5, 5, { maxIsland: 5, grow: 6 }, rng);
    if (!black) continue;
    const clues = placeClues(black, 5, 5, rng);
    const want = bruteCount(5, clues);
    assert.equal(Math.min(2, solve(5, 5, clues).count), want, clues.join(''));
    if (want > 1) multi++;
  }
  assert.ok(multi > 10, '样本中应包含多解题');
});

test('题库：按 8 种旋转 / 翻转规范化后没有重复题', () => {
  for (const id of nk.LEVEL_IDS) {
    const n = nk.LEVELS[id].size;
    const keys = BANK[id].map(([p]) => {
      const all = [];
      for (let t = 0; t < 8; t++) all.push(nk.transformArray([...p], n, t).join(''));
      return all.sort()[0];
    });
    assert.equal(new Set(keys).size, keys.length, id);
  }
});

test('等价变换：8 种变换是互不相同的双射，变换后仍唯一解且答案随之变换', () => {
  const n = 7;
  const [p, s] = BANK.medium[3];
  const seen = new Set();
  for (let t = 0; t < 8; t++) {
    const map = [...Array(n * n).keys()].map((i) => nk.transformIndex(i, n, t));
    assert.equal(new Set(map).size, n * n);
    seen.add(map.join(','));
    const game = nk.createGame('medium', 3, t, [p, s]);
    const res = solve(n, n, game.clues);
    assert.equal(res.count, 1);
    assert.deepEqual(Array.from(res.solution), nk.transformArray(Array.from(nk.decodeSolution(s)), n, t));
  }
  assert.equal(seen.size, 8);
});

test('求解器：示例题唯一解；多解题数到 2；无解题为 0', () => {
  const res = solve(5, 5, nk.decodePuzzle(EXAMPLE.join('')));
  assert.equal(res.count, 1);
  assert.equal(nk.encodeSolution(res.solution), EXAMPLE_ANSWER.join(''));
  // 只有一个 2：放在哪个方向都行，多解
  assert.equal(solve(3, 3, [0, 0, 0, 0, 2, 0, 0, 0, 0]).count, 2);
  // 两个数字相邻：无解
  assert.equal(solve(3, 3, [1, 1, 0, 0, 0, 0, 0, 0, 0]).count, 0);
  // 白格总数超过盘面：无解
  assert.equal(solve(3, 3, [9, 0, 0, 0, 0, 0, 0, 0, 1]).count, 0);
});

test('求解器：形状枚举不重不漏（含固定格的 n 格连通形状数）', () => {
  // 7×7 中心格，大小 1–4 的含该格固定多连块数：1、4、18、76
  const n = 7;
  const nb = [...Array(n * n).keys()].map((i) => nk.neighbors(i, n));
  const allowed = new Uint8Array(n * n).fill(1);
  [1, 4, 18, 76].forEach((want, k) => {
    const keys = new Set();
    let total = 0;
    enumerateShapes(24, k + 1, allowed, nb, (cells) => {
      total++;
      keys.add([...cells].sort((a, b) => a - b).join(','));
    });
    assert.equal(total, want);
    assert.equal(keys.size, want);
  });
});

test('出题器：随机盘面满足规则；生成的题唯一解', () => {
  const rng = mulberry32(7);
  for (let k = 0; k < 30; k++) {
    const black = randomSolution(7, 7, { maxIsland: 7, grow: 10 }, rng);
    if (!black) continue;
    const clues = placeClues(black, 7, 7, rng);
    assert.ok(nk.isSolved(7, clues, black));
  }
  for (let k = 0; k < 5; k++) {
    const p = makePuzzle(5, 5, { maxIsland: 5, grow: 6 }, rng);
    assert.ok(p);
    assert.equal(solve(5, 5, p.clues).count, 1);
    assert.ok(nk.isSolved(5, p.clues, p.solution));
  }
});

test('状态循环：空 → 黑 → 白点 → 空；右键在白点与空之间切换；数字格不可操作', () => {
  const g = nk.createGame('easy', 0, 0, [SAMPLE.join(''), SAMPLE_ANSWER.join('')]);
  assert.equal(nk.strokeTarget(g, 1), BLACK);
  g.cells[1] = BLACK;
  assert.equal(nk.strokeTarget(g, 1), DOT);
  g.cells[1] = DOT;
  assert.equal(nk.strokeTarget(g, 1), EMPTY);
  assert.equal(nk.strokeTarget(g, 1, true), EMPTY);
  g.cells[1] = BLACK;
  assert.equal(nk.strokeTarget(g, 1, true), DOT);
  assert.equal(nk.strokeTarget(g, 0), null, '数字格');
});

test('拖动连涂：整笔使用起点的目标状态，跳过数字格，同格不重复，一笔一步撤销', () => {
  const g = nk.createGame('easy', 0, 0, [SAMPLE.join(''), SAMPLE_ANSWER.join('')]);
  g.cells[2] = BLACK;
  const st = nk.newStroke(nk.strokeTarget(g, 1));
  for (const i of [1, 2, 3, 4, 3, 2, 1]) nk.paint(g, st, i);
  assert.deepEqual([...g.cells.slice(0, 5)], [EMPTY, BLACK, BLACK, BLACK, EMPTY]);
  assert.equal(st.changes.length, 2, '已是黑格的 2 和数字格 4 不算改动');
  nk.commitStroke(g, st);
  assert.equal(g.undo.length, 1);
  assert.deepEqual(nk.undo(g).sort(), [1, 3]);
  assert.deepEqual([...g.cells.slice(0, 5)], [EMPTY, EMPTY, BLACK, EMPTY, EMPTY]);
  nk.redo(g);
  assert.deepEqual([...g.cells.slice(0, 5)], [EMPTY, BLACK, BLACK, BLACK, EMPTY]);
  // 新操作清空重做栈；没有改动的一笔不入栈
  nk.undo(g);
  const st2 = nk.newStroke(DOT);
  nk.paint(g, st2, 10);
  nk.commitStroke(g, st2);
  assert.equal(g.redo.length, 0);
  const st3 = nk.newStroke(DOT);
  nk.paint(g, st3, 10);
  assert.equal(nk.commitStroke(g, st3), false);
  assert.equal(g.undo.length, 1);
});

test('清空：清除所有黑格和白点，作为一步可撤销', () => {
  const g = gameFrom(['2#o.2', '.#...', '..3..', '.....', '1...3']);
  assert.ok(nk.clearAll(g));
  assert.equal(nk.blackCount(g), 0);
  assert.ok(g.cells.every((s) => s === EMPTY));
  nk.undo(g);
  assert.equal(g.cells[1], BLACK);
  assert.equal(g.cells[2], DOT);
  assert.equal(nk.clearAll(nk.createGame('easy', 0, 0, [SAMPLE.join(''), SAMPLE_ANSWER.join('')])), false);
});

test('违规：2×2 黑块标出 4 格', () => {
  const v = nk.violations(gameFrom(['2##.2', '.##..', '..3..', '.....', '1...3']));
  assert.deepEqual([...v.squares].sort((a, b) => a - b), [1, 2, 6, 7]);
  assert.equal(v.clues.size, 0);
  // 3×2 黑块包含两个 2×2，格子去重
  const v2 = nk.violations(gameFrom(['2###2', '.###.', '..3..', '.....', '1...3']));
  assert.deepEqual([...v2.squares].sort((a, b) => a - b), [1, 2, 3, 6, 7, 8]);
});

test('违规：岛屿超数（数字格 + 白点超过数字）、一岛多数、岛屿被封死', () => {
  let v = nk.violations(gameFrom(['2oo.2', '.....', '..3..', '.....', '1...3']));
  assert.deepEqual([...v.clues], [0]);
  assert.deepEqual([...v.dots].sort(), [1, 2]);
  // 刚好等于数字不算违规
  v = nk.violations(gameFrom(['2o..2', '.....', '..3..', '.....', '1...3']));
  assert.equal(v.clues.size + v.dots.size, 0);
  // 白点连起两个数字
  v = nk.violations(gameFrom(['2ooo2', '.....', '..3..', '.....', '1...3']));
  assert.deepEqual([...v.clues].sort((a, b) => a - b), [0, 4]);
  // 3 被墙围死在 2 格里
  v = nk.violations(gameFrom(['2...2', '.###.', '#3.#.', '.###.', '1...3']));
  assert.deepEqual([...v.clues], [11]);
  // 空格不计入岛屿大小
  v = nk.violations(gameFrom(['2...2', '.....', '..3..', '.....', '1...3']));
  assert.equal(v.clues.size + v.dots.size + v.squares.size, 0);
});

test('完成判定：未涂黑视为白格；墙不连通、2×2、岛屿大小不符均不算完成', () => {
  const ans = EXAMPLE_ANSWER.map((r, y) => [...r].map((c, x) => (c === '#' ? '#' : EXAMPLE[y][x])).join(''));
  const g = gameFrom(ans);
  assert.ok(nk.isSolved(5, g.clues, g.cells));
  // 白格点满白点也算完成
  const dotted = gameFrom(ans.map((r) => r.replace(/\./g, 'o')));
  assert.ok(nk.isSolved(5, dotted.clues, dotted.cells));
  // 少涂一个黑格：岛屿变大
  const less = gameFrom(ans);
  less.cells[ans.join('').indexOf('#')] = EMPTY;
  assert.equal(nk.isSolved(5, less.clues, less.cells), false);
  // 墙不连通
  assert.equal(nk.isSolved(3, [1, 0, 0, 0, 0, 0, 0, 0, 0], Uint8Array.from([0, 1, 1, 1, 0, 1, 1, 1, 1])), false);
  // 有 2×2 黑块
  assert.equal(nk.isSolved(3, [1, 0, 0, 0, 0, 0, 0, 0, 0], Uint8Array.from([0, 1, 1, 1, 1, 1, 1, 1, 1])), false);
  // 没有数字的岛
  assert.equal(nk.isSolved(3, [1, 0, 0, 0, 0, 0, 0, 0, 0], Uint8Array.from([0, 1, 0, 1, 1, 1, 1, 1, 1])), false);
});

test('完成后：状态变为 won，棋盘只读，撤销 / 重做 / 清空无效', () => {
  const [p, s] = BANK.easy[0];
  const g = nk.createGame('easy', 0, 5, [p, s]);
  const sol = nk.transformArray(Array.from(nk.decodeSolution(s)), 5, 5);
  const st = nk.newStroke(BLACK);
  let won = false;
  sol.forEach((b, i) => b && nk.paint(g, st, i));
  won = nk.commitStroke(g, st);
  assert.ok(won);
  assert.equal(g.status, 'won');
  assert.equal(nk.blackCount(g), g.blackTotal);
  assert.equal(nk.strokeTarget(g, sol.indexOf(0)), null);
  assert.equal(nk.undo(g), null);
  assert.equal(nk.clearAll(g), false);
});

test('重做到完成状态也会判定完成', () => {
  const [p, s] = BANK.easy[1];
  const g = nk.createGame('easy', 1, 0, [p, s]);
  const st = nk.newStroke(BLACK);
  [...s].forEach((c, i) => c === '#' && nk.paint(g, st, i));
  nk.commitStroke(g, st);
  assert.equal(g.status, 'won');
  g.status = 'playing';
  nk.undo(g);
  nk.redo(g);
  assert.equal(g.status, 'won');
});

test('存档还原：合法存档原样恢复；损坏、题号越界、已完成的存档被丢弃', () => {
  const g = nk.createGame('medium', 5, 3, BANK.medium[5]);
  const st = nk.newStroke(BLACK);
  const free = [...Array(49).keys()].filter((i) => !nk.isClue(g, i));
  nk.paint(g, st, free[0]);
  nk.paint(g, st, free[1]);
  nk.commitStroke(g, st);
  g.elapsed = 12345;
  const data = JSON.parse(JSON.stringify(nk.serialize(g)));
  const r = nk.restoreGame(data, BANK);
  assert.ok(r);
  assert.deepEqual(Array.from(r.cells), Array.from(g.cells));
  assert.deepEqual(r.clues, g.clues);
  assert.equal(r.elapsed, 12345);
  assert.deepEqual(nk.undo(r).sort(), [free[0], free[1]].sort());
  assert.equal(nk.restoreGame(null, BANK), null);
  assert.equal(nk.restoreGame({ ...data, index: 999 }, BANK), null);
  assert.equal(nk.restoreGame({ ...data, t: 9 }, BANK), null);
  assert.equal(nk.restoreGame({ ...data, cells: '12' }, BANK), null);
  assert.equal(nk.restoreGame({ ...data, undo: [[['x']]] }, BANK), null);
  assert.equal(nk.restoreGame({ ...data, level: 'huge' }, BANK), null);
  const solved = { ...data, cells: [...BANK.medium[5][1]].map((c) => (c === '#' ? 1 : 0)).join(''), t: 0 };
  assert.equal(nk.restoreGame(solved, BANK), null);
});

console.log(`\n全部通过：${passed} 项`);
