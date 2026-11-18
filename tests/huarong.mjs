// 华容道测试：node tests/huarong.mjs
import assert from 'node:assert/strict';
import * as E from '../games/huarong/engine.js';
import { LEVELS, CHAPTERS, chapterOf } from '../games/huarong/levels.js';

let passed = 0;
function test(name, fn) {
  const t0 = Date.now();
  fn();
  passed++;
  console.log(`  ✓ ${name} (${Date.now() - t0}ms)`);
}

const HENGDAO = 'aCCb/aCCb/cdde/cfge/h..i';
const at = (pieces, x, y) => E.buildGrid(pieces)[y * E.COLS + x];
const key = (pieces) => JSON.stringify(pieces);

console.log('华容道');

test('解析横刀立马：棋子类型、位置与名字', () => {
  const p = E.parseLayout(HENGDAO);
  assert.equal(p.length, 10);
  const count = (t) => p.filter((q) => q.type === t).length;
  assert.deepEqual([count('cao'), count('h'), count('v'), count('s')], [1, 1, 4, 4]);
  assert.deepEqual(p[E.caoIndex(p)], { type: 'cao', x: 1, y: 0 });
  const names = E.pieceNames(p);
  assert.equal(names[E.caoIndex(p)], '曹操');
  assert.equal(names[p.findIndex((q) => q.type === 'h')], '关羽');
  assert.deepEqual(names.filter((n) => n !== '兵').sort(), ['关羽', '张飞', '曹操', '赵云', '马超', '黄忠'].sort());
  assert.equal(at(p, 1, 4), -1);
  assert.equal(at(p, 2, 4), -1);
});

test('非法布局被拒绝', () => {
  assert.throws(() => E.parseLayout('aCCb/aCCb/cdde/cfge/h..'), /尺寸/);
  assert.throws(() => E.parseLayout('aCCb/aCCb/cdde/cfge/hjji'.replace('jj', 'j.')), /空格/);
  assert.throws(() => E.parseLayout('aCCb/aCCb/cdde/cfge/hddi'), /形状/); // d 不是矩形
  assert.throws(() => E.parseLayout('abcd/abcd/efgh/efgh/ij..'), /曹操/);
});

test('关卡数据：id 唯一、棋子组成合法、按最少步数升序、章节划分正确', () => {
  assert.equal(LEVELS.length, 38);
  assert.equal(new Set(LEVELS.map((l) => l.id)).size, LEVELS.length);
  assert.equal(new Set(LEVELS.map((l) => l.layout)).size, LEVELS.length);
  for (const lv of LEVELS) {
    const p = E.parseLayout(lv.layout);
    const count = (t) => p.filter((q) => q.type === t).length;
    assert.equal(count('cao'), 1, lv.name);
    assert.equal(count('s'), 4, lv.name);
    assert.equal(count('h') + count('v'), 5, lv.name);
    assert.ok(!E.isWon(p), `${lv.name} 开局不应已胜利`);
    assert.ok(chapterOf(lv) >= 0);
  }
  for (let i = 1; i < LEVELS.length; i++) assert.ok(LEVELS[i - 1].min <= LEVELS[i].min);
  for (let i = 1; i < LEVELS.length; i++) assert.ok(chapterOf(LEVELS[i - 1]) <= chapterOf(LEVELS[i]));
  assert.equal(CHAPTERS.length, 4);
  assert.deepEqual(
    CHAPTERS.map((_, ci) => LEVELS.filter((l) => chapterOf(l) === ci).length),
    [9, 10, 12, 7],
  );
  const famous = { hengdao: 81, zhihui: 70, jiangyong: 72, qitou: 60, bingfen: 72, fenghui: 138 };
  for (const [id, min] of Object.entries(famous)) assert.equal(LEVELS.find((l) => l.id === id).min, min, id);
});

test('移动规则：不能越界、不能重叠、不能跳过棋子', () => {
  const p = E.parseLayout(HENGDAO);
  const cao = E.caoIndex(p);
  assert.deepEqual(E.reachable(p, cao), []);
  assert.equal(E.moveTo(p, cao, 1, 1), null);
  const guan = p.findIndex((q) => q.type === 'h');
  assert.deepEqual(E.reachable(p, guan), []);
  // 左上竖将：上方是边界、右边是曹操、下方是竖将
  assert.equal(E.canStep(p, 0, 0, -1), false);
  assert.equal(E.canStep(p, 0, -1, 0), false);
  assert.equal(E.canStep(p, 0, 1, 0), false);
  assert.equal(E.canStep(p, 0, 0, 1), false);
  // 底行左边的兵 h(0,4) 可以右移 1 格或 2 格，不能跳到别处
  const h = p.findIndex((q) => q.x === 0 && q.y === 4);
  assert.deepEqual(E.reachable(p, h).map((r) => [r.x, r.y, r.dist]), [[1, 4, 1], [2, 4, 2]]);
  assert.equal(E.moveTo(p, h, 3, 4), null);
  // 不修改原局面
  const before = key(p);
  E.moveTo(p, h, 2, 4);
  assert.equal(key(p), before);
});

test('拐弯可达：兵可以一步走 L 形；竖将不能走进 1 格宽的缝', () => {
  const p = E.parseLayout(HENGDAO);
  const f = p.findIndex((q) => q.x === 1 && q.y === 3); // 关羽下方左边的兵
  const r = E.reachable(p, f).map((q) => `${q.x},${q.y}:${q.dist}`).sort();
  assert.deepEqual(r, ['1,4:1', '2,4:2']);
  const moved = E.moveTo(p, f, 2, 4);
  assert.ok(moved);
  assert.equal(at(moved, 2, 4), f);
  assert.equal(at(moved, 1, 3), -1);
  // 竖将在只有横向两格空位时无法移动
  const v = E.parseLayout('aCCb/aCCb/cdde/cfge/h..i');
  assert.deepEqual(E.reachable(v, 0), []);
});

test('可达集合与逐格搜索一致（随机局面 300 个）', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let p = E.parseLayout(HENGDAO);
  for (let n = 0; n < 300; n++) {
    for (let i = 0; i < p.length; i++) {
      const fast = new Set(E.reachable(p, i).map((r) => `${r.x},${r.y}`));
      // 朴素实现：逐格 DFS，每步用 canStep 判断
      const seen = new Set([`${p[i].x},${p[i].y}`]);
      const stack = [p];
      const slow = new Set();
      while (stack.length) {
        const cur = stack.pop();
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          if (!E.canStep(cur, i, dx, dy)) continue;
          const k = `${cur[i].x + dx},${cur[i].y + dy}`;
          if (seen.has(k)) continue;
          seen.add(k);
          slow.add(k);
          const next = E.clonePieces(cur);
          next[i].x += dx;
          next[i].y += dy;
          stack.push(next);
        }
      }
      assert.deepEqual([...fast].sort(), [...slow].sort());
    }
    const succ = E.successors(p);
    p = succ[Math.floor(rnd() * succ.length)].pieces;
  }
});

test('胜利判定：只有曹操在底部正中才算胜利', () => {
  const win = E.parseLayout('abcd/abcd/efgh/iCCj/.CC.');
  assert.ok(E.isWon(win));
  assert.ok(!E.isWon(E.parseLayout('abcd/abcd/efgh/CCij/CC..')));
  assert.ok(!E.isWon(E.parseLayout('abcd/abcd/eCCh/iCCj/f..g')));
  assert.ok(!E.isWon(E.parseLayout(HENGDAO)));
  assert.deepEqual(E.solve(win), { steps: 0, path: [], explored: 1 });
});

test('步数合并：同一棋子连续移动算 1 步，走回原位取消，换棋子另起一步', () => {
  let h = [];
  h = E.pushMove(h, 8, [0, 4], [1, 4]);
  assert.equal(h.length, 1);
  h = E.pushMove(h, 8, [1, 4], [2, 4]);
  assert.deepEqual(h, [{ index: 8, from: [0, 4], to: [2, 4] }]);
  h = E.pushMove(h, 9, [3, 4], [3, 3]);
  assert.equal(h.length, 2);
  h = E.pushMove(h, 8, [2, 4], [1, 4]);
  assert.equal(h.length, 3);
  h = E.pushMove(h, 8, [1, 4], [2, 4]);
  assert.equal(h.length, 2, '走回这一步开始前的位置，这一步取消');
});

test('回放：合法 history 得到相同局面，非法 history 被拒绝', () => {
  const start = E.parseLayout(HENGDAO);
  const sol = E.solve(start);
  let p = start;
  let h = [];
  for (const m of sol.path.slice(0, 20)) {
    h = E.pushMove(h, m.index, [p[m.index].x, p[m.index].y], [m.x, m.y]);
    p = E.moveTo(p, m.index, m.x, m.y);
  }
  assert.equal(key(E.replay(start, h)), key(p));
  assert.equal(E.replay(start, [{ index: 4, from: [1, 0], to: [1, 1] }]), null);
  assert.equal(E.replay(start, [{ index: 99, from: [0, 0], to: [0, 1] }]), null);
  assert.equal(E.replay(start, [null]), null);
  // 被合并的一步（兵 L 形）也能回放
  const f = start.findIndex((q) => q.x === 1 && q.y === 3);
  assert.ok(E.replay(start, [{ index: f, from: [1, 3], to: [2, 4] }]));
});

test('每一关都可解，最少步数与标注一致，按解法执行确实胜利', () => {
  let explored = 0;
  for (const lv of LEVELS) {
    const start = E.parseLayout(lv.layout);
    const r = E.solve(start);
    assert.ok(r, `${lv.name} 无解`);
    assert.equal(r.steps, lv.min, `${lv.name}：求解 ${r.steps} 步，标注 ${lv.min} 步`);
    let p = start;
    let h = [];
    for (const m of r.path) {
      const from = [p[m.index].x, p[m.index].y];
      p = E.moveTo(p, m.index, m.x, m.y);
      assert.ok(p, `${lv.name} 解法中有非法移动`);
      h = E.pushMove(h, m.index, from, [m.x, m.y]);
    }
    assert.ok(E.isWon(p), `${lv.name} 解法没有到达胜利局面`);
    // 最优解不会连续移动同一枚棋子，所以合并后步数不变
    assert.equal(h.length, lv.min);
    explored += r.explored;
  }
  console.log(`    （共搜索 ${explored} 个局面）`);
});

test('走投无路（无解布局）求解返回 null', () => {
  assert.equal(E.solve(E.parseLayout('aCCb/aCCb/cefd/cegd/h..i')), null);
});

test('提示：沿最优路线走，剩余步数逐步减 1', () => {
  const lv = LEVELS.find((l) => l.id === 'jiezu');
  let p = E.parseLayout(lv.layout);
  for (let left = lv.min; left > 0; left--) {
    const h = E.hint(p);
    assert.ok(h);
    assert.equal(h.remaining, left);
    assert.ok(E.canMoveTo(p, h.index, h.x, h.y));
    p = E.moveTo(p, h.index, h.x, h.y);
  }
  assert.ok(E.isWon(p));
  assert.equal(E.hint(p), null);
});

test('提示：走了弯路后仍给出从当前局面出发的最优下一步', () => {
  const start = E.parseLayout(HENGDAO);
  // 先走一步 L 形（不是最优开局之一），剩余步数仍应是 81
  const f = start.findIndex((q) => q.x === 1 && q.y === 3);
  const p = E.moveTo(start, f, 2, 4);
  assert.equal(E.hint(p).remaining, 81);
  const p2 = E.moveTo(start, f, 1, 4);
  assert.equal(E.hint(p2).remaining, 80);
});

console.log(`\n${passed} 项测试全部通过`);
