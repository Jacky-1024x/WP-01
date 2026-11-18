// 关灯测试：node tests/lightsout.mjs
import assert from 'node:assert/strict';
import * as lo from '../games/lightsout/engine.js';

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

const grid = (rows) => Uint8Array.from(rows.join(''), Number);
const apply = (n, lights, clicks) => {
  const out = lights.slice();
  for (const i of clicks) lo.toggle(out, n, i);
  return out;
};

// 独立于高斯消元的穷举：枚举第一行的 2^n 种点法，逐行追灯，最后一行全灭即为一个解。
// 每个第一行点法唯一确定其余各行，所以这就是全部解，从中取最少步数
function chaseAll(n, lights) {
  const sols = [];
  for (let mask = 0; mask < 1 << n; mask++) {
    const cur = lights.slice();
    const clicks = [];
    for (let x = 0; x < n; x++) {
      if (mask & (1 << x)) {
        lo.toggle(cur, n, x);
        clicks.push(x);
      }
    }
    for (let y = 1; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (cur[(y - 1) * n + x]) {
          lo.toggle(cur, n, y * n + x);
          clicks.push(y * n + x);
        }
      }
    }
    if (lo.isDark(cur)) sols.push(clicks);
  }
  return sols;
}

console.log('关灯');

test('翻转规则：中间翻十字，边 4 格、角 3 格，不绕边', () => {
  const n = 5;
  assert.deepEqual(lo.toggle(new Uint8Array(25), n, 12), grid(['00000', '00100', '01110', '00100', '00000']));
  assert.deepEqual(lo.toggle(new Uint8Array(25), n, 0), grid(['11000', '10000', '00000', '00000', '00000']));
  assert.deepEqual(lo.toggle(new Uint8Array(25), n, 24), grid(['00000', '00000', '00000', '00001', '00011']));
  assert.deepEqual(lo.toggle(new Uint8Array(25), n, 2), grid(['01110', '00100', '00000', '00000', '00000']));
  assert.deepEqual(lo.toggle(new Uint8Array(25), n, 9), grid(['00001', '00011', '00001', '00000', '00000']));
  for (const n of lo.SIZES) {
    for (let i = 0; i < n * n; i++) {
      const x = i % n;
      const y = Math.floor(i / n);
      const expect = 1 + (x > 0) + (x < n - 1) + (y > 0) + (y < n - 1);
      assert.equal(lo.countLit(lo.toggle(new Uint8Array(n * n), n, i)), expect);
    }
  }
});

test('同一格点两次复原；点击顺序不影响结果', () => {
  const rng = mulberry32(1);
  for (const n of lo.SIZES) {
    const base = Uint8Array.from({ length: n * n }, () => (rng() < 0.5 ? 1 : 0));
    for (let i = 0; i < n * n; i++) assert.deepEqual(apply(n, base, [i, i]), base);
    const clicks = Array.from({ length: 12 }, () => Math.floor(rng() * n * n));
    assert.deepEqual(apply(n, base, clicks), apply(n, base, [...clicks].reverse()));
  }
});

test('零空间维数：3×3 / 6×6 / 7×7 满秩，4×4 为 4，5×5 为 2', () => {
  assert.deepEqual(lo.SIZES.map(lo.nullity), [0, 4, 2, 0, 0]);
  assert.deepEqual(lo.SIZES.map(lo.rankOf), [9, 12, 23, 36, 49]);
});

test('求解器给出的点法能关掉所有灯，步数与追灯法穷举的最少步数一致（每档 150 题）', () => {
  const rng = mulberry32(7);
  for (const n of lo.SIZES) {
    for (let k = 0; k < 150; k++) {
      // 一半从点击生成（必然有解），一半随机撒灯（可能无解）
      const lights =
        k % 2
          ? apply(n, new Uint8Array(n * n), Array.from({ length: 1 + Math.floor(rng() * n * n) }, () => Math.floor(rng() * n * n)))
          : Uint8Array.from({ length: n * n }, () => (rng() < 0.5 ? 1 : 0));
      const sol = lo.solve(n, lights);
      const all = chaseAll(n, lights);
      if (!all.length) {
        assert.equal(sol, null, `${n}×${n} 无解局面应返回 null`);
        continue;
      }
      assert.ok(sol, `${n}×${n} 有解局面不应返回 null`);
      assert.equal(new Set(sol).size, sol.length, '每格最多点一次');
      assert.ok(lo.isDark(apply(n, lights, sol)), '按解点完应全灭');
      assert.equal(sol.length, Math.min(...all.map((s) => s.length)), `${n}×${n} 最少步数`);
      assert.equal(all.length, 2 ** lo.nullity(n), '解的个数 = 2^零空间维数');
    }
  }
});

test('全灭局面最少 0 步；单盏灯的经典局面', () => {
  for (const n of lo.SIZES) assert.deepEqual(lo.solve(n, new Uint8Array(n * n)), []);
  // 5×5 只亮一个角是无解的；只亮中心十字 1 步
  const corner = new Uint8Array(25);
  corner[0] = 1;
  assert.equal(lo.solve(5, corner), null);
  assert.deepEqual(lo.solve(5, lo.toggle(new Uint8Array(25), 5, 12)), [12]);
  // 3×3 满秩：任意局面都可解
  for (let m = 0; m < 512; m++) {
    const lights = Uint8Array.from({ length: 9 }, (_, i) => (m >> i) & 1);
    assert.ok(lo.isSolvable(3, lights));
  }
});

test('出题：有解、非全灭、最少步数在范围内且达到下限（每档 200 题）', () => {
  const rng = mulberry32(42);
  for (const n of lo.SIZES) {
    const { floor, max } = lo.GEN[n];
    for (let k = 0; k < 200; k++) {
      const { lights, optimal } = lo.generate(n, rng);
      assert.equal(lights.length, n * n);
      assert.ok(!lo.isDark(lights));
      const sol = lo.solve(n, lights);
      assert.ok(sol);
      assert.equal(sol.length, optimal);
      assert.ok(optimal >= floor && optimal <= max, `${n}×${n} 最少 ${optimal} 步`);
    }
  }
});

test('对局：点灯计步、撤销还原、重来回到开局，通关后不再接受操作', () => {
  const g = lo.createGame(5, mulberry32(3));
  const start = g.start.slice();
  assert.equal(g.status, 'playing');
  assert.equal(lo.moves(g), 0);
  assert.equal(lo.undo(g), null);
  assert.equal(lo.reset(g), null);
  lo.press(g, 0);
  lo.press(g, 7);
  assert.equal(lo.moves(g), 2);
  assert.deepEqual(g.lights, apply(5, start, [0, 7]));
  lo.undo(g);
  assert.equal(lo.moves(g), 1);
  assert.deepEqual(g.lights, apply(5, start, [0]));
  lo.press(g, 3);
  assert.ok(lo.reset(g));
  assert.deepEqual(g.lights, start);
  assert.equal(lo.moves(g), 0);
  assert.equal(lo.press(g, -1), null);
  assert.equal(lo.press(g, 25), null);

  const sol = lo.solve(5, g.lights);
  let res;
  for (const i of sol) res = lo.press(g, i);
  assert.ok(res.won);
  assert.equal(g.status, 'won');
  assert.equal(lo.moves(g), g.optimal);
  assert.ok(lo.isPerfect(g));
  assert.equal(lo.press(g, 0), null);
  assert.equal(lo.undo(g), null);
  assert.equal(lo.hint(g), null);
});

test('提示：每次标出最少解中的一格，照着点剩余步数 −1；同一提示不重复计数', () => {
  const rng = mulberry32(9);
  for (const n of lo.SIZES) {
    const g = lo.createGame(n, rng);
    lo.press(g, Math.floor(rng() * n * n));
    let remaining = lo.solve(n, g.lights).length;
    let steps = 0;
    while (g.status === 'playing') {
      const h = lo.hint(g);
      assert.equal(h.remaining, remaining);
      assert.ok(h.counted);
      assert.equal(lo.hint(g).counted, false, '提示框还在时不重复计数');
      lo.press(g, h.index);
      assert.equal(g.hint, -1, '点击后提示消失');
      remaining--;
      steps++;
      if (g.status === 'playing') assert.equal(lo.solve(n, g.lights).length, remaining);
    }
    assert.equal(remaining, 0);
    assert.equal(g.hints, steps);
    assert.ok(!lo.isPerfect(g), '用过提示不算完美');
  }
});

test('存档还原：合法存档原样恢复，篡改或不一致的存档被丢弃', () => {
  const g = lo.createGame(6, mulberry32(11));
  lo.press(g, 4);
  lo.press(g, 20);
  lo.hint(g);
  g.elapsed = 12345;
  const data = JSON.parse(JSON.stringify(lo.serialize(g)));
  const r = lo.restoreGame(data);
  assert.ok(r);
  assert.equal(r.size, 6);
  assert.deepEqual(r.lights, g.lights);
  assert.deepEqual(r.start, g.start);
  assert.deepEqual(r.history, [4, 20]);
  assert.equal(r.optimal, g.optimal);
  assert.equal(r.hints, 1);
  assert.equal(r.hint, g.hint);
  assert.equal(r.elapsed, 12345);

  assert.equal(lo.restoreGame(null), null);
  assert.equal(lo.restoreGame({ ...data, size: 8 }), null);
  assert.equal(lo.restoreGame({ ...data, start: data.start.slice(1) }), null);
  assert.equal(lo.restoreGame({ ...data, start: data.start.replace(/.$/, '2') }), null);
  assert.equal(lo.restoreGame({ ...data, start: '0'.repeat(36) }), null, '全灭的开局不合法');
  assert.equal(lo.restoreGame({ ...data, history: [4, 99] }), null);
  assert.equal(lo.restoreGame({ ...data, hints: -1 }), null);
  // 5×5 无解的开局
  assert.equal(lo.restoreGame({ size: 5, start: `1${'0'.repeat(24)}`, history: [] }), null);
  // 重放后已经通关的存档不应作为进行中的对局恢复
  const w = lo.createGame(3, mulberry32(5));
  const sol = lo.solve(3, w.lights);
  assert.equal(lo.restoreGame({ ...lo.serialize(w), history: sol }), null);
  // 提示格不在当前最少解中时丢弃提示，但保留对局
  const bad = lo.restoreGame({ ...data, hint: lo.solve(6, g.lights).includes(0) ? 1 : 0 });
  assert.ok(bad);
  assert.equal(bad.hint, -1);
});

console.log(`\n${passed} 项全部通过`);
