// 生成数和（Kakuro）内置题库：node scripts/gen-kakuro-bank.mjs [每档题数，默认 60] [随机种子，默认 2026]
// 输出 games/kakuro/puzzles.js；每道题都经过“唯一解”与“只靠推理可解完”两项校验。
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DIFFICULTIES, DIFF_IDS } from '../games/kakuro/levels.js';
import { buildStructure, validLayout, countSolutions, logicSolve, gridToString, bit, popcount } from '../games/kakuro/solver.js';

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(a, rng) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------- 黑白格布局
// 第 0 行、第 0 列全黑；其余格子按 180° 旋转对称随机放黑格，再修补：
// 长度为 1 的段整格涂黑，超长的段从中间切开；最后要求白格连通、白格比例达标。
function makeLayout(n, { maxRun, black, minWhite }, rng) {
  const N = n * n;
  const w = new Array(N).fill(false);
  const mirror = (r, c) => (n - r) * n + (n - c);
  const set = (r, c, v) => {
    w[r * n + c] = v;
    w[mirror(r, c)] = v;
  };
  for (let r = 1; r < n; r++) for (let c = 1; c < n; c++) w[r * n + c] = true;
  for (let r = 1; r < n; r++) for (let c = 1; c < n; c++) if (r * n + c <= mirror(r, c) && rng() < black) set(r, c, false);

  for (let guard = 0; guard < 200; guard++) {
    let changed = false;
    // 短段：长度 1 的横 / 竖段，把这一格涂黑
    for (let r = 1; r < n && !changed; r++) {
      for (let c = 1; c < n && !changed; c++) {
        if (!w[r * n + c]) continue;
        const h = (c > 1 && w[r * n + c - 1]) || (c < n - 1 && w[r * n + c + 1]);
        const v = (r > 1 && w[(r - 1) * n + c]) || (r < n - 1 && w[(r + 1) * n + c]);
        if (!h || !v) {
          set(r, c, false);
          changed = true;
        }
      }
    }
    if (changed) continue;
    // 长段：从段内随机位置切开（两边都至少留 2 格）
    for (const dir of [0, 1]) {
      for (let a = 1; a < n && !changed; a++) {
        let start = 1;
        for (let b = 1; b <= n && !changed; b++) {
          const isW = b < n && (dir ? w[b * n + a] : w[a * n + b]);
          if (isW) continue;
          const len = b - start;
          if (len > maxRun) {
            const cut = start + 2 + Math.floor(rng() * (len - 4 + 1));
            if (dir) set(cut, a, false);
            else set(a, cut, false);
            changed = true;
          }
          start = b + 1;
        }
      }
    }
    if (!changed) break;
  }

  const whites = [];
  for (let i = 0; i < N; i++) if (w[i]) whites.push(i);
  if (whites.length < minWhite * (n - 1) * (n - 1)) return null;
  // 连通性
  const seen = new Set([whites[0]]);
  const stack = [whites[0]];
  while (stack.length) {
    const i = stack.pop();
    for (const j of [i - 1, i + 1, i - n, i + n]) {
      if (j < 0 || j >= N || !w[j] || seen.has(j)) continue;
      if (Math.abs((j % n) - (i % n)) > 1) continue;
      seen.add(j);
      stack.push(j);
    }
  }
  if (seen.size !== whites.length) return null;
  const sol = w.map((x) => (x ? 1 : 0));
  const st = buildStructure(n, sol);
  if (!validLayout(st)) return null;
  for (const run of st.runs) if (run.cells.length > maxRun) return null;
  return st;
}

// ---------------------------------------------------------------- 随机填数
// 按格子顺序回溯，每格在所在两段都没用过的数字里随机选。
function fill(st, rng) {
  const N = st.white.length;
  const sol = new Array(N).fill(0);
  const used = new Uint16Array(st.runs.length);
  const order = [];
  for (let i = 0; i < N; i++) if (st.white[i]) order.push(i);
  let steps = 0;
  const go = (t) => {
    if (t === order.length) return true;
    if (++steps > 20000) return false;
    const i = order[t];
    const a = st.across[i];
    const d = st.down[i];
    for (const v of shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9], rng)) {
      const b = bit(v);
      if (used[a] & b || used[d] & b) continue;
      used[a] |= b;
      used[d] |= b;
      sol[i] = v;
      if (go(t + 1)) return true;
      used[a] &= ~b;
      used[d] &= ~b;
    }
    sol[i] = 0;
    return false;
  };
  return go(0) ? sol : null;
}

// 不确定度：只靠推理之后，所有白格剩余候选数的个数之和（0 = 推理可解完）
function looseness(n, sol) {
  const { cand } = logicSolve(buildStructure(n, sol));
  let score = 0;
  for (let i = 0; i < cand.length; i++) if (sol[i]) score += popcount(cand[i]) - 1;
  return { score, cand };
}

/**
 * 生成一道题：返回 n × n 答案字符串，或 null（本次失败）。
 * 随机填满后做爬山：随机改一个仍不确定的格子的数字（保持段内不重复），
 * 不确定度不升高就接受，直到只靠推理就能解完。
 */
export function makePuzzle(id, rng, maxSteps = 2500, patience = 500) {
  const cfg = DIFFICULTIES[id];
  const n = cfg.size;
  const st = makeLayout(n, cfg.layout, rng);
  if (!st) return null;
  const sol = fill(st, rng);
  if (!sol) return null;
  let { score, cand } = looseness(n, sol);
  let best = score;
  let lastGain = 0;
  for (let step = 0; step < maxSteps && score > 0 && step - lastGain < patience; step++) {
    const open = [];
    for (let i = 0; i < sol.length; i++) if (sol[i] && popcount(cand[i]) > 1) open.push(i);
    const i = open[Math.floor(rng() * open.length)];
    let usedMask = 0;
    for (const k of [st.across[i], st.down[i]]) for (const j of st.runs[k].cells) if (j !== i) usedMask |= bit(sol[j]);
    const choices = [];
    for (let v = 1; v <= 9; v++) if (v !== sol[i] && !(usedMask & bit(v))) choices.push(v);
    if (!choices.length) continue;
    const old = sol[i];
    sol[i] = choices[Math.floor(rng() * choices.length)];
    const next = looseness(n, sol);
    if (next.score <= score) {
      ({ score, cand } = next);
      if (score < best) {
        best = score;
        lastGain = step;
      }
    } else {
      sol[i] = old;
    }
  }
  if (score > 0) return null;
  if (countSolutions(buildStructure(n, sol), 2).count !== 1) return null;
  return gridToString(sol);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const per = Number(process.argv[2]) || 60;
  const rng = mulberry32(Number(process.argv[3]) || 2026);
  const bank = {};
  for (const id of DIFF_IDS) {
    const t0 = Date.now();
    const seen = new Set();
    let attempts = 0;
    while (seen.size < per) {
      attempts++;
      const p = makePuzzle(id, rng);
      if (p) seen.add(p);
    }
    bank[id] = [...seen];
    console.log(`${id}: ${per} 道（尝试 ${attempts} 个布局，${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  }
  const body = DIFF_IDS.map((id) => `  ${id}: [\n${bank[id].map((s) => `    '${s}',`).join('\n')}\n  ],`).join('\n');
  const out = `// 内置题库（由 scripts/gen-kakuro-bank.mjs 生成，请勿手改）。
// 每道题是 n × n 的答案字符串（按行排列）：'.' 为黑格，数字为白格答案；提示数由答案推出。
// 每道题都校验过唯一解、且只靠推理即可解完；出题时随机沿对角线翻转。
export const BANK = {
${body}
};
`;
  writeFileSync(fileURLToPath(new URL('../games/kakuro/puzzles.js', import.meta.url)), out);
}
