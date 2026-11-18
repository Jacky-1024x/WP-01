// 连线测试：node tests/flow.mjs
import assert from 'node:assert/strict';
import * as fl from '../games/flow/engine.js';
import { solve } from '../games/flow/solver.js';
import { LEVELS } from '../games/flow/levels.js';

let passed = 0;
function test(name, fn) {
  const t0 = Date.now();
  fn();
  passed++;
  console.log(`  ✓ ${name} (${Date.now() - t0}ms)`);
}

// 用题库格式的字符画写关卡（每行一个字符串），下标行优先
const SMALL = ['AaaA', 'BbbB', 'CccC', 'DddD'].join('');
const small = () => fl.createGame(fl.parseLevel(SMALL));
const TWIST = ['AaaB', 'aaab', 'aABb', 'CccC'].join('');
const STRIPES = ['AaaA', 'bbbb', 'BbbB', 'CccC'].join('');

// 拖动一整条路线：从第一个格子按下，依次拖到后面的格子，然后松手
function stroke(g, cells) {
  const d = fl.beginDrag(g, cells[0]);
  assert.ok(d, `按下 ${cells[0]} 应能开始拖动`);
  const steps = cells.slice(1).map((c) => fl.dragTo(g, d, c));
  return { drag: d, steps, end: fl.endDrag(g, d) };
}

console.log('连线 · 关卡格式');

test('解析关卡：端点、颜色数、答案路径', () => {
  const lv = fl.parseLevel(SMALL);
  assert.equal(lv.n, 4);
  assert.deepEqual(lv.ends, [[0, 3], [4, 7], [8, 11], [12, 15]]);
  assert.deepEqual(lv.solution[0], [0, 1, 2, 3]);
  const twist = fl.parseLevel(TWIST);
  assert.deepEqual(twist.solution[0], [0, 1, 2, 6, 5, 4, 8, 9]);
  assert.deepEqual(twist.solution[1], [3, 7, 11, 10]);
  assert.equal(fl.parseLevel('AaaA'), null, '不是平方数');
  assert.equal(fl.parseLevel(['AaaA', 'BbbB', 'CccC', 'DddA'].join('')), null, '端点不是两个');
  assert.equal(fl.parseLevel(['AaaA', 'BbbB', 'CbcC', 'DddD'].join('')), null, '路径不连续');
});

test('encodeLevel 与 parseLevel 互逆，颜色按端点位置编号', () => {
  const segs = [[15, 14, 13, 12], [0, 1, 2, 3], [4, 5, 6, 7, 11, 10, 9, 8]];
  const str = fl.encodeLevel(4, segs);
  assert.equal(str, 'AaaABbbbBbbbCccC');
  const lv = fl.parseLevel(str);
  assert.deepEqual(lv.solution[1], [4, 5, 6, 7, 11, 10, 9, 8]);
});

console.log('连线 · 画线与截断');

test('从端点画线：延伸、回退、连通后不能继续往前', () => {
  const g = small();
  const d = fl.beginDrag(g, 0);
  assert.equal(d.color, 0);
  assert.ok(fl.dragTo(g, d, 1).changed);
  assert.equal(fl.dragTo(g, d, 3).changed, false, '不相邻');
  assert.ok(fl.dragTo(g, d, 2).changed);
  assert.ok(fl.dragTo(g, d, 1).changed, '拖回上一格');
  assert.deepEqual(g.paths[0], [0, 1]);
  fl.dragTo(g, d, 2);
  const res = fl.dragTo(g, d, 3);
  assert.equal(res.connected, true);
  assert.equal(fl.dragTo(g, d, 7).changed, false, '连通后不能再往前');
  assert.ok(fl.dragTo(g, d, 2).changed, '连通后可以往回拖');
  fl.dragTo(g, d, 3);
  fl.endDrag(g, d);
  assert.ok(fl.isConnected(g, 0));
  assert.equal(fl.connectedCount(g), 1);
});

test('不能穿过别的颜色的端点；拖到自己更早的格子会回退到那里', () => {
  const g = small();
  const d = fl.beginDrag(g, 0);
  assert.equal(fl.dragTo(g, d, 4).changed, false, '4 是 2 号色端点');
  fl.dragTo(g, d, 1);
  fl.dragTo(g, d, 5);
  fl.dragTo(g, d, 6);
  fl.dragTo(g, d, 2);
  assert.deepEqual(d.path, [0, 1, 5, 6, 2]);
  fl.dragTo(g, d, 1);
  assert.deepEqual(d.path, [0, 1], '1 是更早的格子');
  fl.endDrag(g, d);
});

test('按下空格无反应；按路径中间格保留前半段并继续画', () => {
  const g = small();
  assert.equal(fl.beginDrag(g, 5), null);
  stroke(g, [0, 1, 2, 3]);
  const d = fl.beginDrag(g, 1);
  assert.equal(d.color, 0);
  assert.deepEqual(g.paths[0], [0, 1]);
  fl.dragTo(g, d, 5);
  fl.endDrag(g, d);
  assert.deepEqual(g.paths[0], [0, 1, 5]);
  assert.equal(fl.isConnected(g, 0), false);
});

test('按下端点清空该色原有路径（包括从另一端画的路径）', () => {
  const g = small();
  stroke(g, [0, 1, 2]);
  const d = fl.beginDrag(g, 3);
  assert.deepEqual(g.paths[0], [3]);
  fl.endDrag(g, d);
  assert.deepEqual(g.paths[0], [], '只剩一格视为空');
});

test('截断：画到别的路径上会剪掉对方从这一格起的部分；退回来就恢复；松手后生效', () => {
  const g = small();
  stroke(g, [4, 5, 6, 7]);
  assert.ok(fl.isConnected(g, 1));
  const d = fl.beginDrag(g, 0);
  fl.dragTo(g, d, 1);
  const res = fl.dragTo(g, d, 5);
  assert.deepEqual(res.cut, [1]);
  assert.deepEqual(g.paths[1], [4], '对方截到 5 之前');
  fl.dragTo(g, d, 1);
  assert.deepEqual(g.paths[1], [4, 5, 6, 7], '退回来恢复');
  fl.dragTo(g, d, 5);
  fl.dragTo(g, d, 6);
  fl.endDrag(g, d);
  assert.deepEqual(g.paths[0], [0, 1, 5, 6]);
  assert.deepEqual(g.paths[1], [], '松手后截断生效（只剩端点视为空）');
  // 截断中间：保留起点到截断处之前
  const h = small();
  stroke(h, [4, 5, 6, 7]);
  stroke(h, [8, 9, 10, 6]);
  assert.deepEqual(h.paths[1], [4, 5]);
  assert.deepEqual(h.paths[2], [8, 9, 10, 6]);
});

test('截断从另一端画的路径时，保留它自己的起点一侧', () => {
  const g = fl.createGame(fl.parseLevel(STRIPES));
  stroke(g, [8, 4, 5, 6, 7, 11]);
  assert.ok(fl.isConnected(g, 1));
  const d = fl.beginDrag(g, 0);
  fl.dragTo(g, d, 1);
  fl.dragTo(g, d, 5);
  fl.endDrag(g, d);
  assert.deepEqual(g.paths[1], [8, 4]);
});

console.log('连线 · 步数、撤销、重来、提示');

test('步数：连续画同一颜色只算 1 步；棋盘没变化不计步', () => {
  const g = small();
  stroke(g, [0, 1]);
  stroke(g, [1, 2]);
  assert.equal(g.moves, 1);
  stroke(g, [4, 5]);
  assert.equal(g.moves, 2);
  const d = fl.beginDrag(g, 2);
  assert.equal(fl.endDrag(g, d).changed, false, '在路径末端按下又松开，棋盘没变');
  assert.equal(g.moves, 2);
  stroke(g, [0, 1, 2, 3]);
  assert.equal(g.moves, 3);
});

test('撤销回到上一次松手前；撤销后的下一笔无论颜色都计步；撤销栈为空时不可撤销', () => {
  const g = small();
  assert.equal(fl.canUndo(g), false);
  stroke(g, [0, 1, 2]);
  stroke(g, [4, 5, 1]);
  assert.deepEqual(g.paths[0], [], '在 1 被截断，只剩端点');
  assert.ok(fl.undo(g));
  assert.deepEqual(g.paths, [[0, 1, 2], [], [], []]);
  assert.equal(g.moves, 2, '撤销不减步数');
  stroke(g, [2, 3]);
  assert.equal(g.moves, 3);
  assert.ok(fl.undo(g));
  assert.ok(fl.undo(g));
  assert.equal(fl.undo(g), false);
  assert.ok(g.paths.every((p) => p.length === 0));
});

test('重来清空路径、步数、提示与撤销栈', () => {
  const g = small();
  stroke(g, [0, 1, 2]);
  fl.hint(g);
  fl.restart(g);
  assert.ok(g.paths.every((p) => p.length === 0));
  assert.deepEqual([g.moves, g.hints, g.undo.length, g.status], [0, 0, 0, 'playing']);
});

test('提示：画出编号最小的没画对的颜色，截断冲突路径，可撤销，不计步', () => {
  const g = fl.createGame(fl.parseLevel(STRIPES));
  stroke(g, [0, 1, 2, 3]);
  stroke(g, [12, 13, 9, 10]);
  const res = fl.hint(g);
  assert.equal(res.color, 1, '1 号色已画对，提示 2 号色');
  assert.deepEqual(g.paths[1], [8, 4, 5, 9, 10, 6, 7, 11]);
  assert.deepEqual(g.paths[2], [12, 13], '3 号色被截断');
  assert.equal(g.hints, 1);
  assert.equal(g.moves, 2);
  fl.undo(g);
  assert.deepEqual(g.paths[2], [12, 13, 9, 10]);
  assert.equal(fl.matchesSolution(g, 0), true);
});

test('提示直到过关；反方向画的正确路径也算画对', () => {
  const g = fl.createGame(fl.parseLevel(LEVELS[7][0]), 0);
  const sol = g.solution[0];
  stroke(g, sol.slice().reverse());
  assert.ok(fl.matchesSolution(g, 0));
  let res;
  for (let i = 0; i < 20 && g.status === 'playing'; i++) res = fl.hint(g);
  assert.equal(g.status, 'won');
  assert.equal(res.solved, true);
  assert.equal(g.hints, fl.colorCount(g) - 1);
  assert.equal(fl.hint(g).color, -1, '过关后提示无效');
});

console.log('连线 · 完成判定');

test('全部连通且铺满才过关；连通但有空格返回 gaps', () => {
  const g = fl.createGame(fl.parseLevel(['AaaA', 'BbbB', 'CccC', 'DddD'].join('')));
  stroke(g, [0, 1, 2, 3]);
  stroke(g, [4, 5, 6, 7]);
  stroke(g, [8, 9, 10, 11]);
  const end = stroke(g, [12, 13, 14, 15]).end;
  assert.equal(end.solved, true);
  assert.equal(g.status, 'won');
  assert.equal(fl.fillPercent(g), 100);
  assert.equal(fl.beginDrag(g, 0), null, '过关后只读');
  assert.equal(fl.canUndo(g), false);

  const h = fl.createGame(fl.parseLevel(TWIST));
  assert.equal(stroke(h, [0, 4, 8, 9]).end.gaps, false);
  assert.equal(stroke(h, [3, 7, 11, 10]).end.gaps, false);
  const r = stroke(h, [12, 13, 14, 15]).end;
  assert.deepEqual([r.solved, r.gaps], [false, true]);
  assert.equal(fl.connectedCount(h), 3);
  assert.equal(fl.fillPercent(h), 75);
  assert.equal(h.status, 'playing');
});

console.log('连线 · 存档');

test('存档还原：合法存档原样恢复，篡改或不一致的存档被丢弃', () => {
  const lv = fl.parseLevel(LEVELS[6][3]);
  const g = fl.createGame(lv, 3);
  stroke(g, g.solution[0]);
  stroke(g, g.solution[1].slice(0, 3));
  const save = JSON.parse(JSON.stringify(fl.serialize(g)));
  const back = fl.restoreGame(lv, 3, save);
  assert.deepEqual(back.paths, g.paths);
  assert.deepEqual([back.moves, back.hints, back.lastColor, back.undo.length], [2, 0, 1, 2]);
  assert.equal(fl.restoreGame(lv, 4, save), null, '关号不符');
  assert.equal(fl.restoreGame(lv, 3, { ...save, v: 0 }), null);
  assert.equal(fl.restoreGame(lv, 3, { ...save, moves: -1 }), null);
  const broken = save.paths.map((p) => p.slice());
  broken[0] = [broken[0][0], broken[0][2]];
  assert.equal(fl.restoreGame(lv, 3, { ...save, paths: broken }), null, '路径不连续');
  const overlap = save.paths.map((p) => p.slice());
  overlap[1] = [...overlap[1], overlap[0][1]];
  assert.equal(fl.restoreGame(lv, 3, { ...save, paths: overlap }), null, '路径重叠');
  assert.equal(fl.restoreGame(lv, 3, { ...save, paths: save.paths.slice(1) }), null, '颜色数不符');
  const won = fl.createGame(lv, 3);
  won.solution.forEach((p) => stroke(won, p));
  assert.equal(won.status, 'won');
  assert.equal(fl.restoreGame(lv, 3, fl.serialize(won)), null, '已过关的不恢复');
});

console.log('连线 · 求解器与题库');

test('求解器：唯一解返回 1；多解返回 2；无解返回 0', () => {
  const uniq = fl.parseLevel(['AaaA', 'BbbB', 'CccC', 'DddD'].join(''));
  assert.equal(solve(4, uniq.ends).count, 1);
  assert.equal(solve(3, [[0, 8]]).count, 2, '3×3 对角两个端点有两种铺满走法');
  assert.equal(solve(3, [[0, 8], [2, 6]]).count, 0, '必然交叉');
});

test('求解器剪枝不误杀：随机 4×4 / 5×5 端点布局，解的个数与不剪枝的穷举一致（300 组）', () => {
  let seed = 11;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x80000000;
  };
  let withSolution = 0;
  for (let t = 0; t < 300; t++) {
    const n = t % 3 ? 4 : 5;
    const cells = [...Array(n * n).keys()].sort(() => rng() - 0.5);
    const k = 2 + Math.floor(rng() * (n - 1));
    const ends = Array.from({ length: k }, (_, c) => [cells[2 * c], cells[2 * c + 1]]);
    const fast = solve(n, ends, { limit: 50 });
    const slow = solve(n, ends, { limit: 50, prune: false });
    assert.equal(fast.count, slow.count, JSON.stringify({ n, ends }));
    if (fast.count) withSolution++;
  }
  assert.ok(withSolution > 10, `有解的样本太少：${withSolution}`);
});

test(`题库：五档各 ${LEVELS[5].length} 关，格式与颜色数合法，答案路径铺满且合法`, () => {
  for (const n of fl.SIZES) {
    assert.ok(LEVELS[n].length >= 30, `${n}×${n} 关卡过少`);
    assert.equal(new Set(LEVELS[n]).size, LEVELS[n].length, `${n}×${n} 有重复关卡`);
    const [lo, hi] = fl.COLOR_RANGE[n];
    LEVELS[n].forEach((str, i) => {
      const lv = fl.parseLevel(str);
      assert.ok(lv && lv.n === n, `${n}×${n} 第 ${i + 1} 关格式错误`);
      const k = lv.ends.length;
      assert.ok(k >= lo && k <= hi, `${n}×${n} 第 ${i + 1} 关颜色数 ${k}`);
      const g = fl.createGame(lv, i);
      assert.ok(fl.validPaths(g, lv.solution));
      assert.equal(lv.solution.reduce((s, p) => s + p.length, 0), n * n);
      assert.ok(lv.solution.every((p) => p.length >= 3));
      // 按答案逐条画完即过关
      lv.solution.forEach((p) => stroke(g, p));
      assert.equal(g.status, 'won', `${n}×${n} 第 ${i + 1} 关按答案画完未过关`);
      assert.equal(g.moves, k);
    });
  }
});

test('题库：每关都经求解器确认唯一解，且解与题库答案一致', () => {
  const t0 = Date.now();
  let maxNodes = 0;
  for (const n of fl.SIZES) {
    LEVELS[n].forEach((str, i) => {
      const lv = fl.parseLevel(str);
      const res = solve(n, lv.ends, { limit: 2 });
      assert.equal(res.aborted, false);
      assert.equal(res.count, 1, `${n}×${n} 第 ${i + 1} 关不是唯一解（${res.count}）`);
      res.solution.forEach((p, c) => assert.deepEqual(p, lv.solution[c], `${n}×${n} 第 ${i + 1} 关 ${c + 1} 号色`));
      maxNodes = Math.max(maxNodes, res.nodes);
    });
  }
  console.log(`    共 ${fl.SIZES.reduce((s, n) => s + LEVELS[n].length, 0)} 关，单关最多 ${maxNodes} 个搜索节点，总耗时 ${Date.now() - t0}ms`);
});

console.log(`\n全部 ${passed} 项通过`);
