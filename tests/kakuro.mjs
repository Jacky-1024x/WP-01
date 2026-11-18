// 数和测试：node tests/kakuro.mjs
import assert from 'node:assert/strict';
import * as kk from '../games/kakuro/solver.js';
import * as kb from '../games/kakuro/board.js';
import { DIFFICULTIES, DIFF_IDS } from '../games/kakuro/levels.js';
import { BANK } from '../games/kakuro/puzzles.js';

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

/**
 * 独立的数解器（不复用 solver.js 的传播）：按格子顺序回溯，
 * 只用“段内不重复、已填之和 + 剩余格最小和 ≤ 提示数 ≤ 已填之和 + 剩余格最大和”剪枝。
 */
function bruteCount(n, sol, limit = 2) {
  const st = kk.buildStructure(n, sol);
  const order = [];
  for (let i = 0; i < n * n; i++) if (st.white[i]) order.push(i);
  const used = new Uint16Array(st.runs.length);
  const sum = new Int16Array(st.runs.length);
  const left = st.runs.map((r) => r.cells.length);
  const feasible = (k) => {
    const r = left[k];
    const need = st.runs[k].sum - sum[k];
    const free = [];
    for (let d = 1; d <= 9; d++) if (!(used[k] & (1 << d))) free.push(d);
    if (r === 0) return need === 0;
    const lo = free.slice(0, r).reduce((a, b) => a + b, 0);
    const hi = free.slice(-r).reduce((a, b) => a + b, 0);
    return free.length >= r && lo <= need && need <= hi;
  };
  const filled = new Uint8Array(n * n);
  const place = (i, v, s) => {
    const a = st.across[i];
    const d = st.down[i];
    const b = 1 << v;
    if (s > 0) {
      used[a] |= b; used[d] |= b;
    } else {
      used[a] &= ~b; used[d] &= ~b;
    }
    sum[a] += s * v; sum[d] += s * v; left[a] -= s; left[d] -= s;
  };
  const options = (i) => {
    const out = [];
    const a = st.across[i];
    const d = st.down[i];
    for (let v = 1; v <= 9; v++) {
      if ((used[a] | used[d]) & (1 << v)) continue;
      place(i, v, 1);
      if (feasible(a) && feasible(d)) out.push(v);
      place(i, v, -1);
    }
    return out;
  };
  let count = 0;
  const go = (depth) => {
    if (count >= limit) return;
    if (depth === order.length) {
      count++;
      return;
    }
    // 每次挑可选数字最少的空格
    let best = -1;
    let bestOpts = null;
    for (const i of order) {
      if (filled[i]) continue;
      const o = options(i);
      if (!bestOpts || o.length < bestOpts.length) {
        best = i;
        bestOpts = o;
        if (o.length <= 1) break;
      }
    }
    filled[best] = 1;
    for (const v of bestOpts) {
      place(best, v, 1);
      go(depth + 1);
      place(best, v, -1);
    }
    filled[best] = 0;
  };
  go(0);
  return count;
}

// 一道手工小题（4 × 4），横段和 3 / 6 / 12，竖段和 3 / 14 / 4：
//   .  .  .  .
//   .  1  2  .
//   .  2  3  1
//   .  .  9  3
const SMALL = '.....12..231..93';
const SMALL_N = 4;

console.log('数和 · 组合表与盘面结构');

test('组合表：经典唯一组合', () => {
  const one = (sum, len) => kk.COMBOS[len][sum].map((m) => kk.digitsOf(m).join('+'));
  assert.deepEqual(one(3, 2), ['1+2']);
  assert.deepEqual(one(4, 2), ['1+3']);
  assert.deepEqual(one(16, 2), ['7+9']);
  assert.deepEqual(one(17, 2), ['8+9']);
  assert.deepEqual(one(6, 3), ['1+2+3']);
  assert.deepEqual(one(24, 3), ['7+8+9']);
  assert.deepEqual(one(45, 9), ['1+2+3+4+5+6+7+8+9']);
  assert.equal(kk.COMBOS[2][10].length, 4); // 1+9 2+8 3+7 4+6
  assert.equal(kk.COMBOS[2][2].length, 0);
  assert.deepEqual(kk.combosFor(10, 2, kk.bit(3)).map(kk.digitsOf), [[3, 7]]);
  let total = 0;
  for (let len = 1; len <= 9; len++) for (let s = 0; s <= 45; s++) total += kk.COMBOS[len][s].length;
  assert.equal(total, 511, '1–9 的非空子集共 511 个');
});

test('盘面结构：段、提示格与归属', () => {
  const sol = kk.parseGrid(SMALL, SMALL_N);
  const st = kk.buildStructure(SMALL_N, sol);
  const desc = st.runs.map((r) => `${r.dir}${r.clue}:${r.cells.join(',')}=${r.sum}`).sort();
  assert.deepEqual(desc, ['a4:5,6=3', 'a8:9,10,11=6', 'a13:14,15=12', 'd1:5,9=3', 'd2:6,10,14=14', 'd7:11,15=4'].sort());
  assert.ok(kk.validLayout(st, sol));
  for (let i = 0; i < 16; i++) assert.equal(st.white[i], sol[i] > 0);
  assert.equal(st.runs[st.across[10]].sum, 6);
  assert.equal(st.runs[st.down[10]].sum, 14);
});

test('非法布局：1 格的段、段内重复都判为不合法', () => {
  const lone = kk.parseGrid('.....1..........', 4);
  assert.equal(kk.validLayout(kk.buildStructure(4, lone)), false);
  const dup = kk.parseGrid('.....11..349..58', 4);
  assert.equal(kk.validLayout(kk.buildStructure(4, dup), dup), false);
  assert.equal(kk.parseGrid('abc', 4), null);
});

test('沿对角线翻转：横竖段互换，两次翻转还原', () => {
  const t = kk.transpose(SMALL, SMALL_N);
  assert.equal(kk.transpose(t, SMALL_N), SMALL);
  const a = kk.buildStructure(SMALL_N, kk.parseGrid(SMALL, SMALL_N));
  const b = kk.buildStructure(SMALL_N, kk.parseGrid(t, SMALL_N));
  const sums = (st, dir) => st.runs.filter((r) => r.dir === dir).map((r) => r.sum).sort((x, y) => x - y);
  assert.deepEqual(sums(a, 'a'), sums(b, 'd'));
  assert.deepEqual(sums(a, 'd'), sums(b, 'a'));
});

test('单段一致性：和 3 / 2 格只剩 1、2；与已知数配合', () => {
  const cand = new Uint16Array([kk.ALL, kk.ALL]);
  assert.deepEqual(kk.runSupport([0, 1], 3, cand), [kk.bit(1) | kk.bit(2), kk.bit(1) | kk.bit(2)]);
  cand[0] = kk.bit(2);
  assert.deepEqual(kk.runSupport([0, 1], 3, cand), [kk.bit(2), kk.bit(1)]);
  cand[0] = kk.bit(5);
  assert.equal(kk.runSupport([0, 1], 3, cand), null);
  // 和 23 / 3 格 = 6+8+9
  const c3 = new Uint16Array([kk.ALL, kk.ALL, kk.ALL]);
  const sup = kk.runSupport([0, 1, 2], 23, c3);
  assert.ok(sup.every((m) => m === (kk.bit(6) | kk.bit(8) | kk.bit(9))));
});

test('手工小题：传播可解完、唯一解、提示步骤正确', () => {
  const sol = kk.parseGrid(SMALL, SMALL_N);
  const st = kk.buildStructure(SMALL_N, sol);
  const { solved, cand } = kk.logicSolve(st);
  assert.ok(solved);
  for (let i = 0; i < 16; i++) if (sol[i]) assert.equal(cand[i], kk.bit(sol[i]));
  assert.equal(kk.countSolutions(st).count, 1);
  assert.equal(bruteCount(SMALL_N, sol), 1);
  const step = kk.findStep(st, new Array(16).fill(0));
  assert.ok(step && step.digit === sol[step.cell]);
});

test('多解的题能被识别', () => {
  // 2 × 2 白格，横和 3、3，竖和 4、2？——用答案 1 2 / 2 1 推出横 3,3 竖 3,3：有两解
  const g = '....' + '.12.' + '.21.' + '....';
  const sol = kk.parseGrid(g, 4);
  const st = kk.buildStructure(4, sol);
  assert.equal(kk.countSolutions(st).count, 2);
  assert.equal(bruteCount(4, sol), 2);
  assert.equal(kk.logicSolve(st).solved, false);
});

console.log('数和 · 对局逻辑');

const gameOf = () => kb.createGame({ difficulty: 'easy', grid: BANK.easy[0], id: 0 });
const whites = (g) => g.solution.flatMap((v, i) => (v ? [i] : []));

test('填数、错误计数、擦除、再按同数字等于擦除', () => {
  const g = gameOf();
  const [i] = whites(g);
  const right = g.solution[i];
  const wrong = right === 9 ? 8 : right + 1;
  assert.equal(kb.setValue(g, i, wrong).wrong, true);
  assert.equal(g.errors, 1);
  assert.ok(kb.isWrong(g, i));
  assert.equal(kb.setValue(g, i, wrong, { countErrors: false }).type, 'erase');
  assert.equal(g.values[i], 0);
  assert.equal(kb.setValue(g, i, right).wrong, false);
  assert.equal(g.errors, 1);
  const black = g.solution.indexOf(0);
  assert.equal(kb.setValue(g, black, 1), null, '黑格不能填');
});

test('规则检查：段内重复、和超出、填满后和不符', () => {
  const g = kb.createGame({ difficulty: 'easy', grid: '......' + '.12...' + '.21...' + '......' + '......' + '......' });
  // 横段 [7,8] 和 3，竖段 [7,13] 和 3
  const st = kb.structureOf(g);
  const row = st.across[7];
  kb.setValue(g, 7, 1);
  let c = kb.conflicts(g);
  assert.equal(c.cells.size + c.runs.size, 0, '只填一格、未超出时没有问题');
  kb.setValue(g, 8, 1);
  c = kb.conflicts(g);
  assert.ok(c.cells.has(7) && c.cells.has(8), '段内重复');
  assert.ok(c.runs.has(row), '填满后 1 + 1 ≠ 3');
  kb.setValue(g, 8, 9);
  c = kb.conflicts(g);
  assert.ok(c.runs.has(row), '1 + 9 = 10 > 3');
  assert.equal(c.cells.size, 0);
  kb.setValue(g, 8, 2);
  c = kb.conflicts(g);
  assert.ok(!c.runs.has(row));
  assert.ok(kb.runDone(g, row, false));
});

test('笔记：自动清除同段笔记，撤销一步恢复', () => {
  const g = gameOf();
  const st = kb.structureOf(g);
  const run = st.runs.find((r) => r.cells.length >= 2);
  const [a, b] = run.cells;
  const d = g.solution[a];
  kb.toggleNote(g, b, d);
  kb.toggleNote(g, b, d === 9 ? 1 : 9);
  const before = g.notes[b];
  kb.setValue(g, a, d);
  assert.equal(g.notes[b] & kk.bit(d), 0, '同段笔记里的 d 被清除');
  kb.undo(g);
  assert.equal(g.values[a], 0);
  assert.equal(g.notes[b], before, '撤销后笔记恢复');
  kb.redo(g);
  assert.equal(g.values[a], d);
  assert.equal(kb.toggleNote(g, a, 3), null, '有数字的格子不能写笔记');
});

test('自动笔记：候选包含答案，可撤销', () => {
  const g = gameOf();
  kb.autoNotes(g);
  for (const i of whites(g)) assert.ok(g.notes[i] & kk.bit(g.solution[i]));
  assert.ok(g.autoNotesUsed);
  kb.undo(g);
  assert.ok(!kb.hasNotes(g));
});

test('完成判定：按答案填满即通关；有错不通关', () => {
  const g = gameOf();
  const ws = whites(g);
  for (const i of ws.slice(0, -1)) kb.setValue(g, i, g.solution[i]);
  assert.equal(g.status, 'playing');
  const last = ws[ws.length - 1];
  const wrong = g.solution[last] === 9 ? 8 : g.solution[last] + 1;
  kb.setValue(g, last, wrong);
  assert.equal(g.status, 'playing');
  assert.equal(kb.filledCount(g), kb.whiteCount(g));
  kb.setValue(g, last, g.solution[last]);
  assert.equal(g.status, 'won');
  assert.equal(kb.setValue(g, last, 1), null, '通关后不能再改');
});

test('提示：先指错，再按求解器一步步填，最终解完', () => {
  const g = gameOf();
  const ws = whites(g);
  const wrong = g.solution[ws[0]] === 9 ? 8 : g.solution[ws[0]] + 1;
  kb.setValue(g, ws[0], wrong);
  assert.deepEqual(kb.pickHint(g), { kind: 'wrong', cell: ws[0] });
  kb.erase(g, ws[0]);
  kb.toggleNote(g, ws[1], g.solution[ws[1]] === 1 ? 2 : 1);
  assert.equal(kb.pickHint(g).kind, 'note');
  kb.erase(g, ws[1]);
  let guard = 0;
  while (g.status === 'playing' && guard++ < 200) {
    const h = kb.pickHint(g);
    assert.equal(h.kind, 'step', '题库题应始终有逻辑步');
    assert.equal(h.digit, g.solution[h.cell]);
    kb.setValue(g, h.cell, h.digit);
  }
  assert.equal(g.status, 'won');
  const g2 = gameOf();
  assert.ok(kb.useHint(g2) && kb.useHint(g2) && kb.useHint(g2));
  assert.equal(kb.useHint(g2), false);
  assert.equal(g2.hintsUsed, 3);
});

test('组合栏数据：与已填数字相容的组合', () => {
  const g = gameOf();
  const st = kb.structureOf(g);
  const k = 0;
  const run = st.runs[k];
  const info = kb.runCombos(g, k);
  assert.equal(info.len, run.cells.length);
  assert.ok(info.combos.length >= 1);
  const solMask = run.cells.reduce((m, j) => m | kk.bit(g.solution[j]), 0);
  assert.ok(info.combos.includes(solMask));
  kb.setValue(g, run.cells[0], g.solution[run.cells[0]]);
  const after = kb.runCombos(g, k);
  assert.ok(after.combos.every((m) => m & kk.bit(g.solution[run.cells[0]])));
  assert.ok(after.combos.includes(solMask));
});

test('存档：JSON 往返一致；篡改后拒绝', () => {
  const g = gameOf();
  const ws = whites(g);
  kb.setValue(g, ws[0], g.solution[ws[0]]);
  kb.toggleNote(g, ws[1], 4);
  const { solution, ...saved } = g;
  const r = kb.restoreGame(JSON.parse(JSON.stringify(saved)));
  assert.ok(r);
  assert.deepEqual(r.values, g.values);
  assert.deepEqual(r.notes, g.notes);
  assert.equal(r.undo.length, 2);
  kb.undo(r);
  assert.equal(r.notes[ws[1]], 0);
  assert.equal(kb.restoreGame(null), null);
  assert.equal(kb.restoreGame({ ...saved, difficulty: 'nope' }), null);
  assert.equal(kb.restoreGame({ ...saved, grid: saved.grid.slice(1) }), null);
  assert.equal(kb.restoreGame({ ...saved, grid: '1' + saved.grid.slice(1) }), null, '首行必须是黑格');
  const blackIdx = g.solution.indexOf(0);
  const vals = saved.values.slice();
  vals[blackIdx] = 3;
  assert.equal(kb.restoreGame({ ...saved, values: vals }), null, '黑格不能有数字');
  assert.equal(kb.restoreGame({ ...saved, hintsLeft: 9 }), null);
  assert.equal(kb.restoreGame({ ...saved, elapsed: -1 }), null);
});

test('题库取题：优先没玩过的，全部玩过后重置', () => {
  const rng = mulberry32(1);
  const list = BANK.easy.slice(0, 5);
  let seen = [];
  const ids = new Set();
  for (let t = 0; t < 5; t++) {
    const p = kb.pickFromBank(list, 6, seen, rng);
    ids.add(p.id);
    seen = p.seen;
    assert.equal(p.grid, p.flip ? kk.transpose(list[p.id], 6) : list[p.id]);
  }
  assert.equal(ids.size, 5);
  const again = kb.pickFromBank(list, 6, seen, rng);
  assert.equal(again.seen.length, 1);
  assert.ok(kb.pickFromBank(list, 6, 'bad', rng).seen.length === 1);
});

console.log('数和 · 题库');

for (const id of DIFF_IDS) {
  test(`题库「${DIFFICULTIES[id].name}」：合法、唯一解（两种求解器）、只靠推理可解完（含翻转）`, () => {
    const n = DIFFICULTIES[id].size;
    const list = BANK[id];
    assert.ok(list.length >= 50, `至少 50 道，实际 ${list.length}`);
    assert.equal(new Set(list).size, list.length, '题目不重复');
    for (const [k, grid] of list.entries()) {
      for (const g of [grid, kk.transpose(grid, n)]) {
        const sol = kk.parseGrid(g, n);
        assert.ok(sol, `#${k} 格式错误`);
        for (let i = 0; i < n; i++) assert.ok(!sol[i] && !sol[i * n], `#${k} 首行首列必须是黑格`);
        const st = kk.buildStructure(n, sol);
        assert.ok(kk.validLayout(st, sol), `#${k} 布局不合法`);
        assert.ok(st.runs.every((r) => r.cells.length <= DIFFICULTIES[id].layout.maxRun), `#${k} 段过长`);
        const logic = kk.logicSolve(st);
        assert.ok(logic.solved, `#${k} 不能只靠推理解完`);
        assert.ok(sol.every((v, i) => !v || logic.cand[i] === kk.bit(v)), `#${k} 推理结果与答案不符`);
        assert.equal(kk.countSolutions(st).count, 1, `#${k} 解不唯一`);
        const game = kb.createGame({ difficulty: id, grid: g });
        assert.ok(kb.restoreGame(JSON.parse(JSON.stringify(game))), `#${k} 存档校验不通过`);
      }
      assert.equal(bruteCount(n, kk.parseGrid(grid, n)), 1, `#${k} 独立回溯数解 ≠ 1`);
    }
  });
}

console.log(`\n全部 ${passed} 项通过`);
