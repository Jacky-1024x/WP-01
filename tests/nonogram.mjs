// 数织测试：node tests/nonogram.mjs
import assert from 'node:assert/strict';
import * as ng from '../games/nonogram/logic.js';
import { BANK, ALL, findPuzzle } from '../games/nonogram/puzzles.js';

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

// 字符画 ↔ 求解器格式：'#' 黑 '.' 白 '?' 未知
const line = (s) => [...s].map((c) => (c === '#' ? 1 : c === '.' ? 0 : -1));
const str = (arr) => (arr ? arr.map((v) => (v === 1 ? '#' : v === 0 ? '.' : '?')).join('') : null);

// 暴力枚举一行的所有合法排法，作为 solveLine 的参照
function bruteLine(clues, known) {
  const n = known.length;
  const fits = [];
  for (let mask = 0; mask < 1 << n; mask++) {
    const cells = Array.from({ length: n }, (_, i) => (mask >> i) & 1);
    if (cells.some((v, i) => known[i] !== -1 && known[i] !== v)) continue;
    if (ng.cluesOf(cells).join() !== clues.join()) continue;
    fits.push(cells);
  }
  if (!fits.length) return null;
  return known.map((_, i) => {
    const vals = new Set(fits.map((f) => f[i]));
    return vals.size === 2 ? -1 : [...vals][0];
  });
}

// 玩家盘面字符画：'#' 涂黑 'x' 打叉 '.' 未操作
const pline = (s) => [...s].map((c) => (c === '#' ? ng.FILL : c === 'x' ? ng.CROSS : ng.EMPTY));

console.log('数织 · 提示数与单行推理');

test('提示数：连续段长度，全空为空数组', () => {
  assert.deepEqual(ng.cluesOf(line('##.#..###')), [2, 1, 3]);
  assert.deepEqual(ng.cluesOf(line('.....')), []);
  assert.deepEqual(ng.cluesOf(line('#####')), [5]);
  const p = ng.makePuzzle(['#.#', '###', '...']);
  assert.deepEqual(p.rowClues, [[1, 1], [3], []]);
  assert.deepEqual(p.colClues, [[2], [1], [2]]);
  assert.throws(() => ng.parseRows(['##', '#']));
});

test('单行推理：典型例子', () => {
  assert.equal(str(ng.solveLine([3, 1], line('?????'))), '###.#');
  assert.equal(str(ng.solveLine([4], line('?????'))), '?###?', '重叠法');
  assert.equal(str(ng.solveLine([2], line('?????'))), '?????');
  assert.equal(str(ng.solveLine([], line('?????'))), '.....');
  assert.equal(str(ng.solveLine([1], line('??#??'))), '..#..');
  assert.equal(str(ng.solveLine([3], line('#????'))), '###..', '贴边推进');
  assert.equal(str(ng.solveLine([2, 2], line('???.???'))), '?#?.?#?');
  assert.equal(ng.solveLine([3], line('#.???')), null, '矛盾');
  assert.equal(ng.solveLine([1, 1], line('###??')), null);
  assert.equal(ng.solveLine([], line('..#..')), null);
});

test('单行推理与暴力枚举一致（随机 3000 组，长度 1–12）', () => {
  const rng = mulberry32(2026);
  for (let t = 0; t < 3000; t++) {
    const n = 1 + Math.floor(rng() * 12);
    const sol = Array.from({ length: n }, () => (rng() < 0.55 ? 1 : 0));
    // 一半用真实提示（必有解），一半用随机提示（可能矛盾）
    const clues = rng() < 0.5 ? ng.cluesOf(sol) : ng.cluesOf(Array.from({ length: n }, () => (rng() < 0.5 ? 1 : 0)));
    const known = sol.map((v) => (rng() < 0.3 ? v : -1));
    assert.deepEqual(ng.solveLine(clues, known), bruteLine(clues, known), `${clues} / ${str(known)}`);
  }
});

console.log('数织 · 整盘求解与唯一解');

test('需要猜的题被判为 stuck，且确实有多解', () => {
  // 两个对角互换的 2×2 是经典多解
  const p = ng.makePuzzle(['#.', '.#']);
  assert.equal(ng.logicSolve(p.rowClues, p.colClues).status, 'stuck');
  assert.equal(ng.isLogicSolvable(p), false);
  assert.equal(ng.countSolutions(p.rowClues, p.colClues), 2);
});

test('矛盾的提示被判为 contradiction，解数为 0', () => {
  assert.equal(ng.logicSolve([[2], []], [[2], [2]]).status, 'contradiction');
  assert.equal(ng.countSolutions([[2], []], [[2], [2]]), 0);
  assert.equal(ng.logicSolve([[2], []], [[1], [1]]).status, 'solved');
});

test('逻辑可解 ⇒ 解数恰好为 1（随机 6×6 共 300 张）', () => {
  const rng = mulberry32(11);
  let solvable = 0;
  for (let t = 0; t < 300; t++) {
    const rows = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => (rng() < 0.5 ? '#' : '.')).join(''));
    const p = ng.makePuzzle(rows);
    const n = ng.countSolutions(p.rowClues, p.colClues, 3);
    assert.ok(n >= 1, '由图生成的提示至少有一个解');
    if (ng.isLogicSolvable(p)) {
      solvable++;
      assert.equal(n, 1);
    }
  }
  assert.ok(solvable > 30, `可解样本太少: ${solvable}`);
});

console.log('数织 · 题库');

test('题库：三档尺寸、题量、编号与 id 唯一', () => {
  assert.deepEqual(Object.keys(BANK).map(Number), ng.SIZES);
  assert.equal(BANK[5].length, 12);
  assert.equal(BANK[10].length, 12);
  assert.equal(BANK[15].length, 8);
  const ids = new Set(ALL.map((p) => p.id));
  assert.equal(ids.size, ALL.length, 'id 不重复');
  for (const [size, list] of Object.entries(BANK)) {
    list.forEach((p, k) => {
      assert.equal(p.no, k + 1);
      assert.ok(p.name && /^#[0-9a-f]{6}$/i.test(p.color), `${p.id} 缺少名称或颜色`);
      assert.equal(p.rows.length, Number(size), `${p.id} 行数`);
      for (const r of p.rows) assert.match(r, new RegExp(`^[#.]{${size}}$`), `${p.id} 行格式: ${r}`);
      assert.equal(findPuzzle(p.id), p);
    });
  }
  assert.equal(findPuzzle('nope'), null);
});

test('题库每道题都可纯逻辑推出，且独立计数确认解数恰好为 1', () => {
  for (const entry of ALL) {
    const p = ng.makePuzzle(entry.rows);
    const res = ng.logicSolve(p.rowClues, p.colClues);
    assert.equal(res.status, 'solved', `${entry.id} ${entry.name} 需要猜`);
    assert.ok(ng.isLogicSolvable(p), `${entry.id} 解出的图与原图不一致`);
    assert.equal(ng.countSolutions(p.rowClues, p.colClues, 2), 1, `${entry.id} 不是唯一解`);
    assert.ok(p.sol.some(Boolean), `${entry.id} 是空图`);
  }
});

test('题库中没有重复的图', () => {
  const seen = new Set();
  for (const p of ALL) {
    const key = p.rows.join('/');
    assert.ok(!seen.has(key), `${p.id} 与其他题重复`);
    seen.add(key);
  }
});

test('随机出题：每档 50 张全部可纯逻辑推出、唯一解、无全空行列', () => {
  const rng = mulberry32(5);
  for (const size of ng.SIZES) {
    for (let t = 0; t < 50; t++) {
      const rows = ng.generateRandom(size, rng);
      assert.ok(rows, `${size}×${size} 出题失败`);
      const p = ng.makePuzzle(rows);
      assert.equal(p.w, size);
      assert.ok(ng.isLogicSolvable(p));
      assert.equal(ng.countSolutions(p.rowClues, p.colClues, 2), 1);
      assert.ok(p.rowClues.every((c) => c.length) && p.colClues.every((c) => c.length));
    }
  }
});

console.log('数织 · 玩家操作');

const heart = () => ng.createGame(ng.makePuzzle(BANK[5][0].rows)); // .#.#. / ##### / ##### / .###. / ..#..

test('笔的动作：标记 / 擦除 / 改写', () => {
  const cells = Uint8Array.from([ng.EMPTY, ng.FILL, ng.CROSS]);
  assert.deepEqual(ng.strokeAction(cells, 0, 'fill'), { from: [ng.EMPTY], to: ng.FILL });
  assert.deepEqual(ng.strokeAction(cells, 1, 'fill'), { from: [ng.FILL], to: ng.EMPTY });
  assert.deepEqual(ng.strokeAction(cells, 2, 'fill'), { from: [ng.EMPTY, ng.CROSS], to: ng.FILL });
  assert.deepEqual(ng.strokeAction(cells, 2, 'cross'), { from: [ng.CROSS], to: ng.EMPTY });
  assert.deepEqual(ng.strokeAction(cells, 1, 'cross'), { from: [ng.EMPTY, ng.FILL], to: ng.CROSS });
});

test('拖动：方向锁定、投影、往回拉恢复、不覆盖另一种标记、一笔一步撤销', () => {
  const g = heart();
  g.cells[7] = ng.FILL; // 第 1 行第 2 列已涂黑
  const s = ng.beginStroke(g, 5, 'cross'); // 第 1 行第 0 列开始打叉
  assert.deepEqual([...s.changed.keys()], [5]);
  ng.extendStroke(g, s, 11); // 斜向第 2 行第 1 列：|dx| = |dy| 时按行锁定
  assert.equal(s.axis, 'row');
  ng.extendStroke(g, s, 19); // 第 3 行第 4 列 → 投影到第 1 行第 4 列
  assert.deepEqual(Array.from(g.cells.slice(5, 10)), [2, 2, 1, 2, 2], '涂黑格不被打叉覆盖');
  assert.equal(g.cells[19], ng.EMPTY);
  const touched = ng.extendStroke(g, s, 6); // 往回拉到第 1 列
  assert.deepEqual(touched.sort(), [8, 9]);
  assert.deepEqual(Array.from(g.cells.slice(5, 10)), [2, 2, 1, 0, 0]);
  assert.equal(ng.endStroke(g, s), 2);
  assert.equal(g.undo.length, 1);
  assert.deepEqual(ng.undo(g).sort(), [5, 6]);
  assert.deepEqual(Array.from(g.cells.slice(5, 10)), [0, 0, 1, 0, 0]);
  assert.equal(ng.undo(g), null);

  const c = ng.beginStroke(g, 2, 'fill');
  ng.extendStroke(g, c, 22); // 竖向
  assert.equal(c.axis, 'col');
  assert.deepEqual([0, 1, 2, 3, 4].map((y) => g.cells[y * 5 + 2]), [1, 1, 1, 1, 1]);
  ng.endStroke(g, c);
  const e = ng.beginStroke(g, 12, 'fill'); // 从已涂黑格起笔 → 擦除
  assert.equal(e.action.to, ng.EMPTY);
  ng.extendStroke(g, e, 10);
  assert.deepEqual(Array.from(g.cells.slice(10, 15)), [0, 0, 0, 0, 0]);
  assert.equal(ng.endStroke(g, e), 1);
  assert.equal(g.undo.length, 2);

  // 改写：从打叉格起笔用涂黑笔，未操作格和打叉格都涂黑，已涂黑的不变
  const h = heart();
  h.cells[0] = ng.CROSS;
  h.cells[2] = ng.CROSS;
  h.cells[3] = ng.FILL;
  const rw = ng.beginStroke(h, 0, 'fill');
  ng.extendStroke(h, rw, 4);
  assert.deepEqual(Array.from(h.cells.slice(0, 5)), [1, 1, 1, 1, 1]);
  assert.equal(ng.endStroke(h, rw), 4);
  ng.undo(h);
  assert.deepEqual(Array.from(h.cells.slice(0, 5)), [2, 0, 2, 1, 0]);
});

test('拖回起点：方向保持锁定，只剩起点一格', () => {
  const g = heart();
  const s = ng.beginStroke(g, 12, 'fill');
  ng.extendStroke(g, s, 2); // 竖向锁定
  ng.extendStroke(g, s, 13); // 横向移动也投影到第 2 列
  assert.equal(s.axis, 'col');
  assert.equal(g.cells[13], ng.EMPTY);
  ng.extendStroke(g, s, 12);
  assert.deepEqual([...s.changed.keys()], [12]);
  assert.equal(ng.filledCount(g), 1);
  assert.equal(ng.endStroke(g, { ...s, changed: new Map() }), 0, '没有改动的一笔不进撤销栈');
  assert.equal(g.undo.length, 0);
});

test('提示数置灰：整行匹配、两端推进、出错时停止', () => {
  const done = (clues, s) => ng.clueDone(clues, pline(s)).map((d) => (d ? 1 : 0)).join('');
  assert.equal(done([2, 1], '##.#.'), '11', '不打叉也能整行置灰');
  assert.equal(done([2, 1], '.....'), '00');
  assert.equal(done([2, 1, 3], '##x........'), '100', '左端封闭的完整段');
  assert.equal(done([2, 1, 3], '.......x###'), '001', '右端贴边的完整段');
  assert.equal(done([2, 1, 3], '##x#x...##.'), '110', '右端的段还没画完');
  assert.equal(done([2, 1, 3], '##x#x....##'), '110', '贴右边的段左侧未封闭，可能更长');
  assert.equal(done([2, 1, 3], '##x#x..x###'), '111');
  assert.equal(done([2, 1, 3], 'x##x...x###'), '101', '两端各满足一段，中间还没画');
  assert.equal(done([2, 1], '###x.'), '00', '左端第一段长度不符');
  assert.equal(done([1, 1], '#x#x#'), '00', '段数多于提示');
  assert.equal(done([3], '##...'), '0', '未封闭的段不算');
  assert.equal(done([3], '###..'), '1');
  assert.equal(done([1], '..#..'), '1');
  assert.equal(done([1, 1], '#....'), '00', '只差最后一段时不整行置灰，左端段也未封闭');
  assert.equal(done([1, 1], '#x...'), '10');
});

test('胜利判定只看涂黑格；打叉不影响', () => {
  const g = heart();
  const { sol } = g.puzzle;
  for (let i = 0; i < sol.length; i++) g.cells[i] = sol[i] ? ng.FILL : ng.EMPTY;
  assert.ok(ng.isWon(g));
  for (let i = 0; i < sol.length; i++) if (!sol[i]) g.cells[i] = ng.CROSS;
  assert.ok(ng.isWon(g));
  g.cells[0] = ng.FILL;
  assert.ok(!ng.isWon(g), '多涂');
  g.cells[0] = ng.EMPTY;
  g.cells[1] = ng.CROSS;
  assert.ok(!ng.isWon(g), '少涂');
  assert.equal(ng.filledCount(g), sol.reduce((a, b) => a + b, 0) - 1);
  ng.resetGame(g);
  assert.equal(ng.filledCount(g), 0);
  assert.deepEqual(g.undo, []);
});

test('按求解器的结果逐格落笔，最终判定完成且所有提示置灰', () => {
  for (const entry of [BANK[5][5], BANK[10][3], BANK[15][1]]) {
    const g = ng.createGame(ng.makePuzzle(entry.rows));
    const { grid } = ng.logicSolve(g.puzzle.rowClues, g.puzzle.colClues);
    for (let i = 0; i < grid.length; i++) {
      const s = ng.beginStroke(g, i, grid[i] ? 'fill' : 'cross');
      ng.endStroke(g, s);
    }
    assert.ok(ng.isWon(g), entry.id);
    for (let y = 0; y < g.puzzle.h; y++) assert.ok(ng.clueDone(g.puzzle.rowClues[y], ng.playerRow(g, y)).every(Boolean));
    for (let x = 0; x < g.puzzle.w; x++) assert.ok(ng.clueDone(g.puzzle.colClues[x], ng.playerCol(g, x)).every(Boolean));
  }
});

console.log('数织 · 存档');

test('存档还原：题库题与随机题；损坏、版本不符、题库被修改、已完成的存档被丢弃', () => {
  const g = ng.createGame(ng.makePuzzle(BANK[10][2].rows, { ...BANK[10][2] }));
  const s1 = ng.beginStroke(g, 3, 'fill');
  ng.extendStroke(g, s1, 7);
  ng.endStroke(g, s1);
  ng.endStroke(g, ng.beginStroke(g, 55, 'cross'));
  g.elapsed = 12345;
  const save = JSON.parse(JSON.stringify(ng.serialize(g)));
  const back = ng.restoreGame(save, findPuzzle);
  assert.ok(back);
  assert.equal(back.puzzle.id, 'm03');
  assert.equal(back.puzzle.name, BANK[10][2].name);
  assert.equal(back.puzzle.no, 3);
  assert.deepEqual(Array.from(back.cells), Array.from(g.cells));
  assert.deepEqual(back.undo, g.undo);
  assert.equal(back.elapsed, 12345);
  ng.undo(back);
  ng.undo(back);
  assert.ok(back.cells.every((v) => v === ng.EMPTY), '还原后撤销栈可用');

  const rows = ng.generateRandom(15, mulberry32(3));
  const r = ng.createGame(ng.makePuzzle(rows, { id: null }));
  r.cells[0] = ng.CROSS;
  const rback = ng.restoreGame(JSON.parse(JSON.stringify(ng.serialize(r))), findPuzzle);
  assert.equal(rback.puzzle.id, null);
  assert.deepEqual(rback.puzzle.rows, rows);
  assert.equal(rback.cells[0], ng.CROSS);

  assert.equal(ng.restoreGame(null), null);
  assert.equal(ng.restoreGame({ ...save, v: 0 }, findPuzzle), null);
  assert.equal(ng.restoreGame({ ...save, cells: save.cells.slice(1) }, findPuzzle), null);
  assert.equal(ng.restoreGame({ ...save, cells: save.cells.replace('0', '7') }, findPuzzle), null);
  assert.equal(ng.restoreGame({ ...save, rows: save.rows.slice(1) }, findPuzzle), null);
  const edited = [...save.rows];
  edited[0] = edited[0].replace('.', '#');
  assert.equal(ng.restoreGame({ ...save, rows: edited }, findPuzzle), null, '题库题被修改');
  assert.equal(ng.restoreGame({ ...save, id: 'zzz' }, findPuzzle), null, '题号不存在');
  assert.deepEqual(ng.restoreGame({ ...save, undo: [[[999, 0]]] }, findPuzzle).undo, [], '撤销栈损坏只丢弃撤销栈');
  assert.equal(ng.restoreGame({ ...save, elapsed: -5 }, findPuzzle).elapsed, 0);
  const won = ng.createGame(ng.makePuzzle(BANK[5][0].rows, { ...BANK[5][0] }));
  won.puzzle.sol.forEach((v, i) => (won.cells[i] = v ? ng.FILL : ng.EMPTY));
  assert.equal(ng.restoreGame(ng.serialize(won), findPuzzle), null, '已完成的局不恢复');
});

console.log(`\n全部 ${passed} 项通过`);
