// 皇后测试：node tests/queens.mjs
import assert from 'node:assert/strict';
import * as qb from '../games/queens/board.js';
import { findSolutions, countSolutions, nextStep, applyStep, logicSolve } from '../games/queens/solver.js';
import { generate, randomPlacement, growRegions } from '../games/queens/generator.js';

const { EMPTY, CROSS, QUEEN } = qb;

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

// 用字符画描述区域：每行一个字符串，字母 a.. 表示区域
const parseRegions = (rows) =>
  rows
    .join('')
    .split('')
    .map((ch) => ch.charCodeAt(0) - 97);
// 皇后位置：每行皇后所在列
const marksFrom = (n, cols) => {
  const m = new Array(n * n).fill(EMPTY);
  cols.forEach((c, r) => c >= 0 && (m[r * n + c] = QUEEN));
  return m;
};

// 一道已知唯一解的 5×5：答案每行列 = [0, 2, 4, 1, 3]
const N5 = 5;
const R5 = parseRegions(['abbbb', 'bbcbb', 'bbbbd', 'eebbd', 'eebbb']);
const S5 = [0, 2, 4, 1, 3];

console.log('皇后 · 规则');

test('相邻判定含斜对角，不含同一格', () => {
  assert.ok(qb.isAdjacent(5, 0, 1));
  assert.ok(qb.isAdjacent(5, 0, 6));
  assert.ok(!qb.isAdjacent(5, 0, 2));
  assert.ok(!qb.isAdjacent(5, 0, 0));
  assert.ok(!qb.isAdjacent(5, 4, 5)); // 行尾与下一行行首不相邻
});

test('同行 / 同列 / 同区域 / 相邻 均判为冲突', () => {
  const n = 5;
  const regions = R5;
  const cases = [
    [
      [0, 0],
      [0, 3],
    ], // 同行
    [
      [0, 1],
      [3, 1],
    ], // 同列
    [
      [1, 0],
      [3, 3],
    ], // 同区域 b
    [
      [2, 2],
      [3, 3],
    ], // 斜对角相邻
  ];
  for (const pair of cases) {
    const marks = new Array(n * n).fill(EMPTY);
    for (const [r, c] of pair) marks[r * n + c] = QUEEN;
    const { bad } = qb.check(n, regions, marks);
    assert.equal(bad.size, 2, `应冲突: ${JSON.stringify(pair)}`);
  }
  const ok = new Array(n * n).fill(EMPTY);
  ok[0] = QUEEN;
  ok[1 * n + 2] = QUEEN;
  assert.equal(qb.check(n, regions, ok).bad.size, 0);
});

test('叉不参与判定；单元放不下时标记为 dead', () => {
  const marks = new Array(25).fill(EMPTY);
  for (let c = 0; c < 5; c++) marks[2 * 5 + c] = CROSS; // 第 3 行全叉
  const { bad, dead } = qb.check(N5, R5, marks);
  assert.equal(bad.size, 0);
  assert.ok(dead.some((u) => u.kind === 'row' && u.idx === 2));
  // 皇后攻击也会让单元放不下：区域 a 只有格 0，在 1 放皇后后 a 无处可放
  const m2 = new Array(25).fill(EMPTY);
  m2[1] = QUEEN;
  assert.ok(qb.check(N5, R5, m2).dead.some((u) => u.kind === 'region' && u.idx === 0));
});

test('通关判定：答案通过，缺一个 / 多一个 / 冲突均不通过', () => {
  assert.ok(qb.isSolved(N5, R5, marksFrom(N5, S5)));
  assert.ok(!qb.isSolved(N5, R5, marksFrom(N5, [0, 2, 4, 1, -1])));
  const extra = marksFrom(N5, S5);
  extra[1 * 5 + 4] = QUEEN;
  assert.ok(!qb.isSolved(N5, R5, extra));
  const withCross = marksFrom(N5, S5);
  withCross[1] = CROSS;
  assert.ok(qb.isSolved(N5, R5, withCross), '叉不影响通关');
  // 每行每列各一但区域重复
  const regions = parseRegions(['aaaab', 'aaaab', 'ccddb', 'ccddb', 'eeeee']);
  assert.ok(!qb.isSolved(5, regions, marksFrom(5, [0, 2, 4, 1, 3])));
});

test('k = 2（星战）规则参数化', () => {
  // 4×4 不可能放 2 星，这里只校验计数规则：同行 3 个算冲突，2 个不算
  const n = 6;
  const regions = parseRegions(['aaabbb', 'aaabbb', 'cccddd', 'cccddd', 'eeefff', 'eeefff']);
  const marks = new Array(36).fill(EMPTY);
  marks[0] = QUEEN;
  marks[2] = QUEEN;
  assert.equal(qb.check(n, regions, marks, 2).bad.size, 0);
  marks[4] = QUEEN;
  assert.ok(qb.check(n, regions, marks, 2).bad.size >= 3);
});

test('自动叉 = 被皇后攻击的空格', () => {
  const marks = new Array(25).fill(EMPTY);
  marks[0] = QUEEN;
  const auto = qb.autoCrosses(N5, R5, marks);
  for (const i of [1, 2, 3, 4, 5, 10, 15, 20, 6]) assert.ok(auto.has(i), `格 ${i} 应被攻击`);
  assert.ok(!auto.has(12));
  assert.ok(!auto.has(0));
});

test('撤销：单步、合并步、清空都能还原', () => {
  const g = qb.createGame({ n: N5, regions: R5, solution: S5.map((c, r) => r * 5 + c) });
  qb.setMarks(g, [[3, qb.nextCycle(g.marks[3])]]);
  assert.equal(g.marks[3], CROSS);
  qb.setMarks(g, [[3, QUEEN]], true); // 双击并入上一步
  assert.equal(g.undo.length, 1);
  qb.setMarks(g, [[7, CROSS]]);
  qb.setMarks(g, [[8, CROSS]], true); // 拖动
  qb.setMarks(
    g,
    g.marks.map((_, i) => [i, EMPTY]),
  ); // 清空
  assert.ok(g.marks.every((m) => m === EMPTY));
  qb.undo(g);
  assert.equal(g.marks[3], QUEEN);
  assert.equal(g.marks[8], CROSS);
  qb.undo(g);
  assert.equal(g.marks[7], EMPTY);
  assert.equal(g.marks[8], EMPTY);
  qb.undo(g);
  assert.ok(g.marks.every((m) => m === EMPTY));
  assert.equal(qb.undo(g), null);
  assert.deepEqual(qb.setMarks(g, [[0, EMPTY]]), [], '无变化不入栈');
});

test('轻点循环 空 → 叉 → 皇后 → 空', () => {
  assert.equal(qb.nextCycle(EMPTY), CROSS);
  assert.equal(qb.nextCycle(CROSS), QUEEN);
  assert.equal(qb.nextCycle(QUEEN), EMPTY);
});

test('存档恢复：合法存档可恢复，损坏存档丢弃', () => {
  const g = qb.createGame({ n: N5, regions: R5, solution: S5.map((c, r) => r * 5 + c) });
  const data = JSON.parse(JSON.stringify({ ...g, colors: [...Array(10).keys()] }));
  assert.ok(qb.restoreGame(data));
  assert.equal(qb.restoreGame({ ...data, v: 99 }), null);
  assert.equal(qb.restoreGame({ ...data, marks: [1, 2] }), null);
  assert.equal(qb.restoreGame({ ...data, regions: data.regions.map(() => 0) }), null);
  assert.equal(qb.restoreGame(null), null);
});

console.log('皇后 · 求解器');

test('回溯数解：示例题唯一解且与答案一致', () => {
  const sols = findSolutions(N5, R5, 3);
  assert.equal(sols.length, 1);
  assert.deepEqual(
    sols[0],
    S5.map((c, r) => r * 5 + c),
  );
});

test('回溯数解：多解与无解', () => {
  // 按行分区：任何合法排列都是解，5×5 有多个
  const rows = parseRegions(['aaaaa', 'bbbbb', 'ccccc', 'ddddd', 'eeeee']);
  assert.equal(countSolutions(5, rows, 2), 2);
  // 4×4 只有 2 个不相邻排列，用区域排除掉
  const r4 = parseRegions(['abbb', 'bbbb', 'cccc', 'dddd']);
  assert.equal(countSolutions(4, r4, 2), 0);
});

test('逻辑求解器能解完示例题，每一步都与答案一致', () => {
  const answer = new Set(S5.map((c, r) => r * 5 + c));
  const marks = new Array(25).fill(EMPTY);
  for (let guard = 0; guard < 100 && !qb.isSolved(N5, R5, marks); guard++) {
    const step = nextStep(N5, R5, marks);
    assert.ok(step && !step.contradiction, '应能找到下一步');
    if (step.place !== undefined) assert.ok(answer.has(step.place));
    else for (const i of step.cross) assert.ok(!answer.has(i), `不应排除答案格 ${i}`);
    applyStep(marks, step);
  }
  assert.ok(qb.isSolved(N5, R5, marks));
});

test('关闭自动叉时提示先给出“皇后排除”', () => {
  const marks = new Array(25).fill(EMPTY);
  marks[0] = QUEEN;
  const step = nextStep(N5, R5, marks, { explicitAttack: true });
  assert.equal(step.tech, 'attack');
  assert.ok(step.cross.includes(1) && step.cross.includes(6));
  assert.notEqual(nextStep(N5, R5, marks).tech, 'attack');
});

test('盘面矛盾时返回 contradiction', () => {
  const marks = new Array(25).fill(EMPTY);
  marks[1] = QUEEN; // 区域 a 唯一格 0 被攻击
  assert.ok(nextStep(N5, R5, marks).contradiction);
});

console.log('皇后 · 出题');

test('随机答案：每行每列一个且互不相邻', () => {
  const rng = mulberry32(1);
  for (const n of qb.SIZES) {
    for (let k = 0; k < 50; k++) {
      const sol = randomPlacement(n, rng);
      assert.equal(sol.length, n);
      const cols = sol.map((i) => i % n);
      assert.equal(new Set(cols).size, n);
      for (let r = 1; r < n; r++) assert.ok(Math.abs(cols[r] - cols[r - 1]) >= 2);
    }
  }
});

test('区域生长：N 个连通区域，各含一个种子', () => {
  const rng = mulberry32(2);
  for (const n of qb.SIZES) {
    for (let k = 0; k < 30; k++) {
      const seeds = randomPlacement(n, rng);
      const regions = growRegions(n, seeds, rng);
      assert.ok(qb.regionsValid(n, regions));
      seeds.forEach((cell, g) => assert.equal(regions[cell], g));
    }
  }
});

test('各尺寸生成：唯一解、答案正确、逻辑可解（每档 25 道）', () => {
  const rng = mulberry32(2026);
  for (const n of qb.SIZES) {
    const t0 = Date.now();
    const levels = [0, 0, 0, 0, 0];
    for (let k = 0; k < 25; k++) {
      const p = generate(n, rng);
      assert.ok(qb.regionsValid(n, p.regions), '区域不合法');
      const sols = findSolutions(n, p.regions, 2);
      assert.equal(sols.length, 1, `${n}×${n} 不唯一`);
      assert.deepEqual(sols[0], p.solution);
      const marks = new Array(n * n).fill(EMPTY);
      for (const i of p.solution) marks[i] = QUEEN;
      assert.ok(qb.isSolved(n, p.regions, marks));
      const res = logicSolve(n, p.regions);
      assert.ok(res.solved, '逻辑求解器应能解完');
      assert.deepEqual(qb.queensOf(res.marks), p.solution);
      levels[p.level]++;
    }
    console.log(`      ${n}×${n}: 平均 ${((Date.now() - t0) / 25).toFixed(1)}ms，评级分布 ${levels.join('/')}`);
  }
});

test('提示永不与答案矛盾：从随机正确进度出发逐步推理', () => {
  const rng = mulberry32(99);
  for (const n of [6, 8, 10]) {
    for (let k = 0; k < 10; k++) {
      const p = generate(n, rng);
      const answer = new Set(p.solution);
      const marks = new Array(n * n).fill(EMPTY);
      // 随机放一些正确的皇后和正确的叉
      for (const i of p.solution) if (rng() < 0.3) marks[i] = QUEEN;
      for (let i = 0; i < n * n; i++) if (!answer.has(i) && marks[i] === EMPTY && rng() < 0.2) marks[i] = CROSS;
      for (let guard = 0; guard < 500 && !qb.isSolved(n, p.regions, marks); guard++) {
        const step = nextStep(n, p.regions, marks, { explicitAttack: guard % 2 === 0 });
        assert.ok(step && !step.contradiction);
        if (step.place !== undefined) assert.ok(answer.has(step.place));
        else for (const i of step.cross) assert.ok(!answer.has(i));
        applyStep(marks, step);
      }
      assert.ok(qb.isSolved(n, p.regions, marks));
    }
  }
});

console.log(`\n皇后：全部 ${passed} 项通过`);
