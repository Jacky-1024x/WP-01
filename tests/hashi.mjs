// 数桥测试：node tests/hashi.mjs
import assert from 'node:assert/strict';
import * as hb from '../games/hashi/board.js';
import { solve, countSolutions, solvableByLogic } from '../games/hashi/solver.js';
import { generate, layout, GEN_PARAMS } from '../games/hashi/generator.js';

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

const rows = (...lines) => ({ str: lines.join(''), cols: lines[0].length, rows: lines.length });
function gameOf(...lines) {
  const { str, cols, rows: r } = rows(...lines);
  return hb.createGame('easy', str, cols, r);
}
const edge = (g, a, b) => hb.edgeBetween(g.p, a, b);

// 穷举所有 0–2 取值数解，用来校验求解器
function bruteCount(p) {
  const m = p.edges.length;
  const b = new Uint8Array(m);
  let count = 0;
  for (let code = 0; code < 3 ** m; code++) {
    let c = code;
    for (let e = 0; e < m; e++) {
      b[e] = c % 3;
      c = Math.floor(c / 3);
    }
    if (hb.checkSolution(p, b)) count++;
  }
  return count;
}

console.log('数桥');

test('解析题面：只连同行 / 同列最近的岛，不越过中间的岛', () => {
  // 岛：0(0,0)=2 1(2,0)=3 2(4,0)=1 3(0,2)=1 4(2,2)=2
  const g = gameOf('2.3.1', '.....', '1.2..');
  const { p } = g;
  assert.equal(p.islands.length, 5);
  assert.ok(edge(g, 0, 1) >= 0);
  assert.ok(edge(g, 1, 2) >= 0);
  assert.equal(edge(g, 0, 2), -1, '0 和 2 之间隔着岛 1');
  assert.ok(edge(g, 0, 3) >= 0);
  assert.ok(edge(g, 1, 4) >= 0);
  assert.ok(edge(g, 3, 4) >= 0);
  assert.equal(p.edges.length, 5);
  assert.equal(hb.neighborIsland(p, 1, -1, 0), 0);
  assert.equal(hb.neighborIsland(p, 1, 1, 0), 2);
  assert.equal(hb.neighborIsland(p, 1, 0, 1), 4);
  assert.equal(hb.neighborIsland(p, 1, 0, -1), -1);
  assert.throws(() => hb.parsePuzzle('12', 3, 1));
  assert.throws(() => hb.parsePuzzle('1x.', 3, 1));
});

test('循环切换 0 → 1 → 2 → 0：两岛之间最多 2 座桥', () => {
  const g = gameOf('2.2');
  const e = edge(g, 0, 1);
  assert.deepEqual([1, 2, 0, 1].map(() => hb.cycleBridge(g, e).next), [1, 2, 0, 1]);
  for (let i = 0; i < 10; i++) {
    hb.cycleBridge(g, e);
    assert.ok(g.bridges[e] <= 2);
  }
});

test('交叉：已有桥挡住时拒绝架桥，且不计入撤销；拆掉后可以架', () => {
  // 十字：上下两岛与左右两岛的连线在中心格交叉
  const g = gameOf('.1.', '1.1', '.1.');
  const v = edge(g, 0, 3);
  const h = edge(g, 1, 2);
  assert.ok(v >= 0 && h >= 0);
  assert.deepEqual(g.p.cross[v], [h]);
  assert.deepEqual(g.p.cross[h], [v]);
  assert.ok(hb.cycleBridge(g, v).ok);
  const res = hb.cycleBridge(g, h);
  assert.equal(res.ok, false);
  assert.deepEqual(res.blocked, [v]);
  assert.equal(g.bridges[h], 0);
  assert.equal(g.undo.length, 1);
  hb.cycleBridge(g, v); // 1 → 2
  hb.cycleBridge(g, v); // 2 → 0
  assert.ok(hb.cycleBridge(g, h).ok);
  // 规则检查也拒绝交叉的局面
  const bad = new Uint8Array(g.p.edges.length);
  bad[v] = 1;
  bad[h] = 1;
  assert.equal(hb.checkSolution(g.p, bad), false);
  assert.equal(countSolutions(g.p), 0, '十字形四个 1 无解');
});

test('岛的状态：未满足 / 已满足 / 超出', () => {
  const g = gameOf('1.2');
  const e = edge(g, 0, 1);
  assert.equal(hb.islandState(g, 0), 'under');
  hb.cycleBridge(g, e);
  assert.equal(hb.islandState(g, 0), 'done');
  assert.equal(hb.islandState(g, 1), 'under');
  hb.cycleBridge(g, e);
  assert.equal(hb.islandState(g, 0), 'over');
  assert.equal(hb.islandState(g, 1), 'done');
  assert.equal(hb.satisfiedCount(g), 1);
});

test('连通判定：全部满足但分成两群不算完成', () => {
  const g = gameOf('1.1', '...', '1.1');
  hb.cycleBridge(g, edge(g, 0, 1));
  hb.cycleBridge(g, edge(g, 2, 3));
  assert.equal(hb.satisfiedCount(g), 4);
  assert.equal(hb.isConnected(g.p, g.bridges), false);
  assert.equal(hb.evaluate(g), 'disconnected');
  const { comp, groups } = hb.components(g.p, g.bridges);
  assert.equal(groups.length, 2);
  assert.equal(comp[0], comp[1]);
  assert.notEqual(comp[0], comp[2]);
  assert.equal(countSolutions(g.p), 0);
});

test('完成判定：按规则检查，完成后不能再操作', () => {
  const g = gameOf('2.3', '...', '..1');
  assert.equal(countSolutions(g.p), 1);
  hb.cycleBridge(g, edge(g, 0, 1));
  assert.equal(hb.evaluate(g), 'playing');
  hb.cycleBridge(g, edge(g, 0, 1));
  hb.cycleBridge(g, edge(g, 1, 2));
  assert.equal(hb.evaluate(g), 'solved');
  assert.ok(hb.checkSolution(g.p, g.bridges));
  g.status = 'won';
  assert.equal(hb.cycleBridge(g, 0).ok, false);
  assert.equal(hb.undo(g), null);
  assert.equal(hb.clearBridges(g), false);
});

test('撤销与清空：清空可整体撤销，撤销到开局后无反应', () => {
  const g = gameOf('2.2', '...', '2.2');
  const top = edge(g, 0, 1);
  const left = edge(g, 0, 2);
  hb.cycleBridge(g, top);
  hb.cycleBridge(g, top);
  hb.cycleBridge(g, left);
  assert.ok(hb.clearBridges(g));
  assert.equal(hb.hasBridges(g), false);
  assert.equal(hb.clearBridges(g), false, '没有桥时清空无效');
  assert.deepEqual(hb.undo(g).sort(), [top, left].sort());
  assert.equal(g.bridges[top], 2);
  assert.equal(g.bridges[left], 1);
  hb.undo(g);
  hb.undo(g);
  hb.undo(g);
  assert.equal(hb.hasBridges(g), false);
  assert.equal(hb.undo(g), null);
});

test('存档：序列化往返一致，损坏或已完成的存档被丢弃', () => {
  const g = gameOf('2.3', '...', '..1');
  hb.cycleBridge(g, edge(g, 0, 1));
  g.elapsed = 12345;
  const data = JSON.parse(JSON.stringify(hb.serialize(g)));
  const r = hb.restoreGame(data);
  assert.ok(r);
  assert.deepEqual([...r.bridges], [...g.bridges]);
  assert.deepEqual(r.undo, g.undo);
  assert.equal(r.elapsed, 12345);
  assert.equal(hb.restoreGame(null), null);
  assert.equal(hb.restoreGame({ ...data, v: 0 }), null);
  assert.equal(hb.restoreGame({ ...data, puzzle: '2.3' }), null);
  assert.equal(hb.restoreGame({ ...data, bridges: [3, 0] }), null);
  const cross = gameOf('.1.', '1.1', '.1.');
  const bad = hb.serialize(cross);
  bad.bridges = bad.bridges.map(() => 1);
  assert.equal(hb.restoreGame(bad), null, '交叉的桥');
  hb.cycleBridge(g, edge(g, 0, 1));
  hb.cycleBridge(g, edge(g, 1, 2));
  assert.equal(hb.restoreGame(hb.serialize(g)), null, '已完成');
});

test('求解器与穷举数解一致（随机小棋盘 300 道，含多解）', () => {
  const rng = mulberry32(2026);
  let n = 0;
  let multi = 0;
  while (n < 300) {
    const str = layout(6, 6, 4 + Math.floor(rng() * 5), rng);
    if (!str) continue;
    const p = hb.parsePuzzle(str, 6, 6);
    if (p.edges.length > 10) continue;
    const brute = bruteCount(p);
    const res = solve(p, { limit: 100 });
    assert.equal(res.count, brute, str);
    if (brute) assert.ok(hb.checkSolution(p, res.solution), str);
    if (brute > 1) multi++;
    n++;
  }
  assert.ok(multi > 10, '样本中应包含多解题');
});

test('求解器识别多解：正方形四个 3 有两种解，四个 2 只有一种（双桥会断开）', () => {
  assert.equal(countSolutions(gameOf('3.3', '...', '3.3').p, 10), 2);
  assert.equal(countSolutions(gameOf('2.2', '...', '2.2').p, 10), 1);
});

test('生成的题目唯一解、岛数在区间内、岛不相邻（每档 60 道）', () => {
  for (const level of Object.keys(GEN_PARAMS)) {
    const rng = mulberry32(level.length * 977);
    const gp = GEN_PARAMS[level];
    let maxMs = 0;
    for (let i = 0; i < 60; i++) {
      const t0 = Date.now();
      const r = generate(level, rng);
      maxMs = Math.max(maxMs, Date.now() - t0);
      assert.ok(r, `${level} 生成失败`);
      assert.equal(r.cols, gp.cols);
      assert.equal(r.rows, gp.rows);
      const p = hb.parsePuzzle(r.puzzle, r.cols, r.rows);
      assert.ok(p.islands.length >= gp.min && p.islands.length <= gp.max, `${level} 岛数 ${p.islands.length}`);
      assert.equal(countSolutions(p, 2), 1, `${level} 非唯一解：${r.puzzle}`);
      if (gp.logic) assert.ok(solvableByLogic(p), `${level} 需要试错：${r.puzzle}`);
      for (const { x, y } of p.islands) {
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < r.cols && ny < r.rows) assert.equal(p.islandAt[ny * r.cols + nx], -1, `${level} 岛相邻`);
        }
      }
      // 唯一解按规则在棋盘上可以完成
      const g = hb.createGame(level, r.puzzle, r.cols, r.rows);
      g.bridges.set(solve(p).solution);
      assert.equal(hb.evaluate(g), 'solved');
    }
    assert.ok(maxMs < 500, `${level} 单题最长耗时 ${maxMs}ms`);
  }
});

console.log(`\n全部通过：${passed} 项`);
