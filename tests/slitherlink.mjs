// 数回测试：node tests/slitherlink.mjs
import assert from 'node:assert/strict';
import * as sl from '../games/slitherlink/board.js';
import { logicSolve, countSolutions } from '../games/slitherlink/solver.js';
import {
  randomRegion,
  cluesFromRegion,
  cluesToString,
  makePuzzle,
  fitsLevel,
  LEVEL_RULES,
  clueCount,
} from '../games/slitherlink/generator.js';
import { BANK } from '../games/slitherlink/puzzles.js';

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

const toClues = (str) => Int8Array.from(str, (ch) => (ch === '.' ? -1 : Number(ch)));

// 区域边界上的边（区域外 / 棋盘外不同则为边界）
function boundaryEdges(inR, rows, cols) {
  const geo = sl.geometry(rows, cols);
  const at = (r, c) => (r < 0 || c < 0 || r >= rows || c >= cols ? 0 : inR[r * cols + c]);
  const edges = new Uint8Array(geo.E);
  for (let r = 0; r <= rows; r++) for (let c = 0; c < cols; c++) edges[geo.hid(r, c)] = at(r - 1, c) !== at(r, c) ? 1 : 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c <= cols; c++) edges[geo.vtid(r, c)] = at(r, c - 1) !== at(r, c) ? 1 : 0;
  return edges;
}

// 独立枚举：rows × cols 上所有简单闭合回路 = 所有合法区域（非空、连通、无洞、无对角相接）
function bruteForceRegions(rows, cols) {
  const n = rows * cols;
  const out = [];
  for (let mask = 1; mask < 1 << n; mask++) {
    const inR = Uint8Array.from({ length: n }, (_, i) => (mask >> i) & 1);
    const at = (r, c) => (r < 0 || c < 0 || r >= rows || c >= cols ? 0 : inR[r * cols + c]);
    let ok = true;
    for (let r = 0; r <= rows && ok; r++) {
      for (let c = 0; c <= cols && ok; c++) {
        const tl = at(r - 1, c - 1), tr = at(r - 1, c), bl = at(r, c - 1), br = at(r, c);
        if (tl === br && tr === bl && tl !== tr) ok = false;
      }
    }
    if (!ok) continue;
    // 区域连通、补集（含棋盘外）连通
    const flood = (val) => {
      const seen = new Set();
      const start = val ? inR.indexOf(1) : -1;
      const key = (r, c) => `${r},${c}`;
      const stack = val ? [[Math.floor(start / cols), start % cols]] : [[-1, -1]];
      seen.add(key(...stack[0]));
      let cnt = 0;
      while (stack.length) {
        const [r, c] = stack.pop();
        if (r >= 0 && c >= 0 && r < rows && c < cols) cnt++;
        for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
          if (nr < -1 || nc < -1 || nr > rows || nc > cols || seen.has(key(nr, nc)) || at(nr, nc) !== val) continue;
          seen.add(key(nr, nc));
          stack.push([nr, nc]);
        }
      }
      return cnt;
    };
    const size = inR.reduce((a, b) => a + b, 0);
    if (flood(1) === size && flood(0) === n - size) out.push(inR);
  }
  return out;
}

const bruteForceLoops = (rows, cols) => bruteForceRegions(rows, cols).length;

function solvedGame(level = 'easy', id = 0) {
  const { rows } = sl.LEVELS[level];
  const puzzle = BANK[level][id];
  const game = sl.createGame(level, id, 0, sl.transformClues(puzzle, rows, 0));
  const { edges } = countSolutions(game.clues, game.rows, game.cols, 1);
  return { game, solution: edges };
}

console.log('数回');

test('几何索引：边 / 点数量，每格 4 条不同的边，边与格互相对应', () => {
  for (const [rows, cols] of [[5, 5], [7, 7], [10, 10], [3, 4]]) {
    const geo = sl.geometry(rows, cols);
    assert.equal(geo.E, (rows + 1) * cols + rows * (cols + 1));
    assert.equal(geo.V, (rows + 1) * (cols + 1));
    for (let i = 0; i < rows * cols; i++) {
      const es = [...geo.cellEdges.subarray(4 * i, 4 * i + 4)];
      assert.equal(new Set(es).size, 4);
      for (const e of es) assert.ok(geo.edgeCells[2 * e] === i || geo.edgeCells[2 * e + 1] === i);
    }
    for (let v = 0; v < geo.V; v++) assert.ok(geo.vertEdges[v].length >= 2 && geo.vertEdges[v].length <= 4);
  }
  assert.equal(sl.geometry(5, 5).E, 60);
  assert.equal(sl.geometry(10, 10).E, 220);
});

test('就近选边：落点选最近的边，棋盘外 0.5 格以外不响应', () => {
  const geo = sl.geometry(5, 5);
  assert.equal(sl.nearestEdge(geo, 0.5, 0.1), geo.hid(0, 0));
  assert.equal(sl.nearestEdge(geo, 0.1, 0.5), geo.vtid(0, 0));
  assert.equal(sl.nearestEdge(geo, 2.4, 3.9), geo.hid(4, 2));
  assert.equal(sl.nearestEdge(geo, 4.95, 2.5), geo.vtid(2, 5));
  assert.equal(sl.nearestEdge(geo, -0.4, 4.6), geo.vtid(4, 0));
  assert.equal(sl.nearestEdge(geo, 5.3, 5.3), geo.hid(5, 4));
  assert.equal(sl.nearestEdge(geo, 1, 1), geo.hid(1, 1));
  assert.equal(sl.nearestEdge(geo, -0.6, 2), -1);
  assert.equal(sl.nearestEdge(geo, 2, 5.6), -1);
  // 每个落点选到的边，离落点的距离不大于其他任何边
  const rng = mulberry32(3);
  for (let k = 0; k < 500; k++) {
    const x = rng() * 6 - 0.5;
    const y = rng() * 6 - 0.5;
    const e = sl.nearestEdge(geo, x, y);
    const dist = (edge) => {
      const a = edge < geo.H ? [edge % 5, Math.floor(edge / 5), 1, 0] : [(edge - geo.H) % 6, Math.floor((edge - geo.H) / 6), 0, 1];
      const t = Math.max(0, Math.min(1, a[2] ? x - a[0] : y - a[1]));
      return Math.hypot(x - (a[0] + a[2] * t), y - (a[1] + a[3] * t));
    };
    const best = Math.min(...Array.from({ length: geo.E }, (_, i) => dist(i)));
    assert.ok(dist(e) <= best + 1e-9, `(${x}, ${y})`);
  }
});

test('拖动路径：相邻点直接成边，跳过的格点按先横后竖补齐', () => {
  const geo = sl.geometry(5, 5);
  const v = (r, c) => geo.vid(r, c);
  assert.equal(sl.edgeBetween(geo, v(0, 0), v(0, 1)), geo.hid(0, 0));
  assert.equal(sl.edgeBetween(geo, v(2, 3), v(3, 3)), geo.vtid(2, 3));
  assert.equal(sl.edgeBetween(geo, v(0, 0), v(1, 1)), -1);
  assert.deepEqual(sl.pathEdges(geo, v(1, 1), v(1, 1)), []);
  assert.deepEqual(sl.pathEdges(geo, v(1, 1), v(3, 2)), [geo.hid(1, 1), geo.vtid(1, 2), geo.vtid(2, 2)]);
  assert.deepEqual(sl.pathEdges(geo, v(2, 3), v(2, 1)), [geo.hid(2, 2), geo.hid(2, 1)]);
});

test('边状态循环：轻点 空→线→叉→空；长按 空/线→叉，叉→空', () => {
  assert.equal(sl.tapNext(sl.EMPTY), sl.LINE);
  assert.equal(sl.tapNext(sl.LINE), sl.CROSS);
  assert.equal(sl.tapNext(sl.CROSS), sl.EMPTY);
  assert.equal(sl.holdNext(sl.EMPTY), sl.CROSS);
  assert.equal(sl.holdNext(sl.LINE), sl.CROSS);
  assert.equal(sl.holdNext(sl.CROSS), sl.EMPTY);
});

test('回溯数解器与独立枚举一致：空白盘面上的回路总数（2×2、3×3、3×4）', () => {
  for (const [rows, cols] of [[2, 2], [3, 3], [3, 4]]) {
    const expect = bruteForceLoops(rows, cols);
    const got = countSolutions(new Int8Array(rows * cols).fill(-1), rows, cols, 1e6).count;
    assert.equal(got, expect, `${rows}×${cols}`);
  }
  assert.equal(bruteForceLoops(2, 2), 13);
});

test('回溯数解器与独立枚举一致：4×4 随机挖线索 300 次，解数逐一相同', () => {
  const regions = bruteForceRegions(4, 4);
  const allClues = regions.map((r) => cluesFromRegion(r, 4, 4));
  const rng = mulberry32(77);
  let unique = 0;
  for (let k = 0; k < 300; k++) {
    const base = allClues[Math.floor(rng() * allClues.length)];
    const keep = 0.15 + rng() * 0.6;
    const clues = base.map((v) => (rng() < keep ? v : -1));
    const expect = allClues.filter((c) => c.every((v, i) => clues[i] < 0 || v === clues[i])).length;
    assert.equal(countSolutions(clues, 4, 4, 1e6).count, expect, cluesToString(clues));
    if (expect === 1) unique++;
    // 逻辑求解器能解出的题必定唯一
    if (logicSolve(clues, 4, 4, 1).solved) assert.equal(expect, 1);
  }
  assert.ok(unique > 10);
});

test('随机回路：区域边界是一条简单闭合回路，完整线索唯一解且解就是这条回路', () => {
  const rng = mulberry32(11);
  for (const [rows, cols] of [[5, 5], [7, 7], [10, 10]]) {
    for (let k = 0; k < 10; k++) {
      const region = randomRegion(rows, cols, rng, 0.5);
      const clues = cluesFromRegion(region, rows, cols);
      const game = { rows, cols, clues, edges: boundaryEdges(region, rows, cols) };
      assert.ok(sl.analyze(game).solved);
      assert.deepEqual(sl.insideCells(game), [...region.keys()].filter((i) => region[i]));
      const res = countSolutions(clues, rows, cols, 2);
      assert.equal(res.count, 1);
      assert.deepEqual([...res.edges], [...game.edges]);
    }
  }
});

test('违规检查：数字超出、数字无法满足、分叉、死路、提前闭合', () => {
  // 3×3，中间格是 0，左上格是 1
  const game = { rows: 3, cols: 3, clues: toClues('1...0....'), edges: new Uint8Array(sl.geometry(3, 3).E) };
  const geo = sl.geometry(3, 3);
  const set = (e, s) => (game.edges[e] = s);
  // 中间格画一条线 → 超出
  set(geo.hid(1, 1), sl.LINE);
  let res = sl.analyze(game);
  assert.equal(res.cells[4], 2);
  assert.equal(res.cells[0], 0);
  set(geo.hid(1, 1), sl.EMPTY);
  // 0 没有线时不算满足（不变淡），四边都打叉才算
  assert.equal(sl.analyze(game).cells[4], 0);
  for (const e of geo.cellEdges.subarray(16, 20)) set(e, sl.CROSS);
  assert.equal(sl.analyze(game).cells[4], 1);
  game.edges.fill(0);
  // 左上格四边都打叉 → 无法满足
  for (const e of geo.cellEdges.subarray(0, 4)) set(e, sl.CROSS);
  res = sl.analyze(game);
  assert.equal(res.cells[0], 2);
  game.edges.fill(0);
  // 左上格恰好一条线 → 满足
  set(geo.hid(0, 0), sl.LINE);
  assert.equal(sl.analyze(game).cells[0], 1);
  // 分叉：点 (0, 1) 上 3 条线
  set(geo.hid(0, 1), sl.LINE);
  set(geo.vtid(0, 1), sl.LINE);
  res = sl.analyze(game);
  assert.deepEqual(res.badVerts, [geo.vid(0, 1)]);
  assert.equal(res.closed, false);
  game.edges.fill(0);
  // 死路：点 (0, 0) 只有 1 条线，另一条边打叉
  set(geo.hid(0, 0), sl.LINE);
  set(geo.vtid(0, 0), sl.CROSS);
  assert.deepEqual(sl.analyze(game).badVerts, [geo.vid(0, 0)]);
  game.edges.fill(0);
  // 提前闭合：右下格围成小圈，另有一段线
  const loop = [...geo.cellEdges.subarray(4 * 8, 4 * 8 + 4)];
  for (const e of loop) set(e, sl.LINE);
  res = sl.analyze(game);
  assert.equal(res.closed, true);
  assert.equal(res.solved, false);
  assert.deepEqual(res.loopEdges, []);
  set(geo.hid(0, 0), sl.LINE);
  res = sl.analyze(game);
  assert.equal(res.closed, false);
  assert.deepEqual([...res.loopEdges].sort((a, b) => a - b), loop.sort((a, b) => a - b));
  // 两个独立的圈：都算提前闭合，也不算完成
  game.edges.fill(0);
  for (const e of loop) set(e, sl.LINE);
  for (const e of geo.cellEdges.subarray(0, 4)) set(e, sl.LINE);
  res = sl.analyze(game);
  assert.equal(res.closed, false);
  assert.equal(res.loopEdges.length, 8);
});

test('完成判定：唯一解即完成；少一段、多一段、只有叉都不算完成；叉不影响完成', () => {
  for (const level of Object.keys(sl.LEVELS)) {
    const { game, solution } = solvedGame(level, 3);
    assert.equal(sl.isSolved(game), false);
    for (let e = 0; e < solution.length; e++) if (solution[e]) game.edges[e] = sl.LINE;
    assert.equal(sl.isSolved(game), true);
    const on = solution.indexOf(1);
    game.edges[on] = sl.EMPTY;
    assert.equal(sl.isSolved(game), false);
    game.edges[on] = sl.LINE;
    const off = solution.indexOf(0);
    game.edges[off] = sl.LINE;
    assert.equal(sl.isSolved(game), false);
    game.edges[off] = sl.CROSS;
    assert.equal(sl.isSolved(game), true);
    sl.finish(game);
    assert.equal(game.status, 'won');
    assert.ok(game.edges.every((s) => s !== sl.CROSS));
    assert.deepEqual(sl.applyChanges(game, [[off, sl.LINE]]), []);
    assert.equal(sl.undo(game), null);
  }
  const blank = sl.createGame('easy', 0, 0, BANK.easy[0]);
  assert.equal(sl.analyze(blank).solved, false);
  assert.equal(sl.analyze(blank).closed, false);
});

test('撤销 / 重做 / 清空：一步可含多条边，新操作清空重做栈', () => {
  const game = sl.createGame('easy', 0, 0, BANK.easy[0]);
  assert.equal(sl.hasProgress(game), false);
  sl.applyChanges(game, [[0, sl.LINE]]);
  sl.applyChanges(game, [[1, sl.LINE], [2, sl.CROSS], [1, sl.CROSS]]);
  assert.deepEqual(game.undo[1], [[1, 0, 2], [2, 0, 2]]);
  assert.deepEqual(sl.applyChanges(game, [[0, sl.LINE]]), []);
  assert.equal(game.undo.length, 2);
  sl.undo(game);
  assert.deepEqual([game.edges[0], game.edges[1], game.edges[2]], [1, 0, 0]);
  sl.redo(game);
  assert.deepEqual([game.edges[0], game.edges[1], game.edges[2]], [1, 2, 2]);
  sl.undo(game);
  sl.applyChanges(game, [[5, sl.LINE]]);
  assert.equal(game.redo.length, 0);
  assert.equal(sl.redo(game), null);
  const cleared = sl.clearAll(game);
  assert.equal(cleared.length, 2);
  assert.ok(game.edges.every((s) => s === sl.EMPTY));
  sl.undo(game);
  assert.deepEqual([game.edges[0], game.edges[5]], [1, 1]);
  // 拖动：边画边改，结束时整笔入栈；没有净变化的一笔不入栈
  const n = game.undo.length;
  game.edges[10] = sl.LINE;
  sl.pushStep(game, [[10, 0, 1], [11, 0, 0]]);
  assert.equal(game.undo.length, n + 1);
  assert.deepEqual(game.undo[n], [[10, 0, 1]]);
  sl.pushStep(game, [[12, 1, 1]]);
  assert.equal(game.undo.length, n + 1);
  assert.ok(sl.hasProgress(game));
});

test('存档还原：合法存档原样恢复；篡改、与题库不一致、已完成的存档被丢弃', () => {
  const level = 'medium';
  const t = 5;
  const game = sl.createGame(level, 7, t, sl.transformClues(BANK[level][7], 7, t));
  sl.applyChanges(game, [[3, sl.LINE], [4, sl.CROSS]]);
  sl.applyChanges(game, [[20, sl.LINE]]);
  sl.undo(game);
  game.elapsed = 12345;
  const data = JSON.parse(JSON.stringify(sl.serialize(game)));
  const back = sl.restoreGame(data, BANK);
  assert.ok(back);
  assert.deepEqual([...back.edges], [...game.edges]);
  assert.deepEqual(back.undo, game.undo);
  assert.deepEqual(back.redo, game.redo);
  assert.equal(back.elapsed, 12345);
  assert.equal(back.puzzle, game.puzzle);
  assert.equal(sl.restoreGame(null, BANK), null);
  assert.equal(sl.restoreGame({ ...data, v: 99 }, BANK), null);
  assert.equal(sl.restoreGame({ ...data, level: 'huge' }, BANK), null);
  assert.equal(sl.restoreGame({ ...data, id: 999 }, BANK), null);
  assert.equal(sl.restoreGame({ ...data, t: 8 }, BANK), null);
  assert.equal(sl.restoreGame({ ...data, puzzle: BANK[level][8] }, BANK), null);
  assert.equal(sl.restoreGame({ ...data, edges: data.edges.slice(1) }, BANK), null);
  assert.equal(sl.restoreGame({ ...data, edges: data.edges.replace('0', '7') }, BANK), null);
  assert.equal(sl.restoreGame({ ...data, undo: [[[9999, 0, 1]]] }, BANK), null);
  assert.equal(sl.restoreGame({ ...data, undo: 'x' }, BANK), null);
  // 已完成的局面不恢复
  const { game: done, solution } = solvedGame('easy', 2);
  for (let e = 0; e < solution.length; e++) if (solution[e]) done.edges[e] = sl.LINE;
  assert.equal(sl.restoreGame(JSON.parse(JSON.stringify(sl.serialize(done))), BANK), null);
});

test('对称变换：8 种变换互不相同（一般题面），旋转 4 次复原，变换后仍唯一解', () => {
  const rng = mulberry32(5);
  for (const level of Object.keys(sl.LEVELS)) {
    const n = sl.LEVELS[level].rows;
    const p = BANK[level][0];
    assert.equal(sl.transformClues(p, n, 0), p);
    let q = p;
    for (let k = 0; k < 4; k++) q = sl.transformClues(q, n, 1);
    assert.equal(q, p);
    assert.equal(sl.transformClues(sl.transformClues(p, n, 4), n, 4), p);
    // 用全部格子都不同的“题面”检验 8 种变换是不同的置换
    const ids = Array.from({ length: n * n }, (_, i) => String.fromCharCode(48 + i));
    const perms = new Set(Array.from({ length: 8 }, (_, t) => sl.transformClues(ids, n, t)));
    assert.equal(perms.size, 8);
    for (let k = 0; k < 5; k++) {
      const t = Math.floor(rng() * 8);
      const tp = sl.transformClues(BANK[level][k], n, t);
      assert.equal(countSolutions(toClues(tp), n, n, 2).count, 1);
    }
  }
});

test('选题：优先选最近没玩过的题，记录最多保留题库的一半', () => {
  const rng = mulberry32(9);
  const recent = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  for (let k = 0; k < 200; k++) {
    const { id, t } = sl.pickPuzzle(10, recent, rng);
    assert.equal(id, 9);
    assert.ok(t >= 0 && t < 8);
  }
  assert.ok(sl.pickPuzzle(3, [0, 1, 2], rng).id < 3);
  let list = [];
  for (let i = 0; i < 30; i++) list = sl.pushRecent(list, i % 25, 40);
  assert.equal(list.length, 20);
  assert.equal(list[list.length - 1], 4);
  assert.deepEqual(sl.pushRecent([1, 2, 3], 2, 40), [1, 3, 2]);
});

test('题库：每档 40 道，格式正确、无重复，回溯数解恰好 1 个解，并符合本档推理层级', () => {
  for (const level of Object.keys(sl.LEVELS)) {
    const { rows, cols } = sl.LEVELS[level];
    const list = BANK[level];
    assert.equal(list.length, 40, level);
    assert.equal(new Set(list).size, list.length);
    for (const p of list) {
      assert.ok(sl.parseClues(p, rows, cols), p);
      assert.ok(clueCount(p) <= LEVEL_RULES[level].maxClues);
      const clues = toClues(p);
      const res = countSolutions(clues, rows, cols, 2);
      assert.equal(res.count, 1, `${level} 非唯一解：${p}`);
      const logic = logicSolve(clues, rows, cols, LEVEL_RULES[level].maxLevel);
      assert.ok(logic.solved, `${level} 逻辑解不出：${p}`);
      assert.deepEqual([...logic.edges], [...res.edges]);
      if (LEVEL_RULES[level].needTrial) assert.equal(logicSolve(clues, rows, cols, 0).solved, false);
      // 解按游戏规则判定为完成
      const game = sl.createGame(level, 0, 0, p);
      game.edges = Uint8Array.from(res.edges);
      assert.ok(sl.isSolved(game));
    }
  }
});

test('出题器：生成的题符合本档要求且唯一解', () => {
  const rng = mulberry32(2026);
  for (const level of Object.keys(sl.LEVELS)) {
    const { rows, cols } = sl.LEVELS[level];
    let made = 0;
    for (let k = 0; k < 40 && made < 2; k++) {
      const p = makePuzzle(level, rng);
      if (!p) continue;
      made++;
      assert.ok(fitsLevel(p, level));
      assert.equal(countSolutions(toClues(p), rows, cols, 2).count, 1);
    }
    assert.equal(made, 2, level);
  }
});

console.log(`\n全部通过：${passed} 项`);
