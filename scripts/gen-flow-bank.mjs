// 生成连线内置题库：node scripts/gen-flow-bank.mjs [每档关数，默认 30] [随机种子，默认 2026]
// 输出 games/flow/levels.js。每关由「随机合并路径」铺满棋盘得到（天然有解且铺满），并经求解器校验唯一解。
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { solve } from '../games/flow/solver.js';
import { SIZES, COLOR_RANGE, encodeLevel, parseLevel } from '../games/flow/engine.js';

const per = Number(process.argv[2]) || 30;
let seed = Number(process.argv[3]) || 2026;

function rng() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

function neighbors(n, i) {
  const r = (i / n) | 0;
  const c = i % n;
  const out = [];
  if (r > 0) out.push(i - n);
  if (r < n - 1) out.push(i + n);
  if (c > 0) out.push(i - 1);
  if (c < n - 1) out.push(i + 1);
  return out;
}

// 路径上不相邻的两格互相挨着（“贴着自己走”）：这种路径通常能被别的走法替代，直接不要
function selfTouch(n, path) {
  const pos = new Map(path.map((c, i) => [c, i]));
  for (let i = 0; i < path.length; i++) {
    for (const d of neighbors(n, path[i])) {
      const j = pos.get(d);
      if (j !== undefined && Math.abs(j - i) > 1) return true;
    }
  }
  return false;
}

// 每格各自是一条路径，反复随机把两条路径的端点接起来（优先接最短的），直到接不动为止
function randomCover(n) {
  const total = n * n;
  const owner = Int32Array.from({ length: total }, (_, i) => i);
  const paths = new Map();
  for (let i = 0; i < total; i++) paths.set(i, [i]);
  const stuck = new Set();
  let fails = 0;
  while (fails < total * 30) {
    const ids = [...paths.keys()];
    let id = pick(ids);
    if (rng() < 0.7) {
      let min = Infinity;
      for (const x of ids) if (!stuck.has(x)) min = Math.min(min, paths.get(x).length);
      const shortest = ids.filter((x) => !stuck.has(x) && paths.get(x).length === min);
      if (shortest.length) id = pick(shortest);
    }
    const p = paths.get(id);
    const atStart = rng() < 0.5;
    const end = atStart ? p[0] : p[p.length - 1];
    const cands = neighbors(n, end).filter((d) => {
      if (owner[d] === id) return false;
      const q = paths.get(owner[d]);
      return q[0] === d || q[q.length - 1] === d;
    });
    if (!cands.length) {
      fails++;
      if (p.length < 3) stuck.add(id);
      continue;
    }
    const d = pick(cands);
    const qid = owner[d];
    const q = paths.get(qid);
    const merged = (atStart ? p.slice().reverse() : p).concat(q[0] === d ? q : q.slice().reverse());
    if (selfTouch(n, merged)) {
      fails++;
      continue;
    }
    paths.delete(qid);
    paths.set(id, merged);
    for (const c of merged) owner[c] = id;
  }
  return [...paths.values()];
}

const bank = {};
for (const n of SIZES) {
  const [lo, hi] = COLOR_RANGE[n];
  const found = new Map();
  let tries = 0;
  const t0 = Date.now();
  while (found.size < per * 2 && tries < per * 20000) {
    tries++;
    const segs = randomCover(n);
    if (segs.length < lo || segs.length > hi || segs.some((s) => s.length < 3)) continue;
    const str = encodeLevel(n, segs);
    if (found.has(str)) continue;
    const res = solve(n, parseLevel(str).ends, { limit: 2, maxNodes: 2e5 });
    if (res.count !== 1 || res.aborted) continue;
    found.set(str, res.nodes);
  }
  // 按求解难度排序，从多出来的候选里均匀抽取，难度从易到难平滑上升
  const sorted = [...found].sort((a, b) => a[1] - b[1]);
  const levels = [];
  for (let i = 0; i < per && i < sorted.length; i++) levels.push(sorted[Math.floor((i * sorted.length) / per)][0]);
  bank[n] = levels;
  console.log(`${n}×${n}: ${levels.length} 关（尝试 ${tries} 次，唯一解候选 ${found.size}，${Date.now() - t0}ms）`);
}

const body = SIZES.map((n) => `  ${n}: [\n${bank[n].map((s) => `    '${s}',`).join('\n')}\n  ],`).join('\n');
const out = `// 内置关卡（由 scripts/gen-flow-bank.mjs 生成，请勿手改；追加关卡只能加在末尾，否则已有进度会错位）。
// 每关 n² 个字符，行优先：大写字母 = 端点，小写字母 = 答案路径经过的格子，A/a 为 1 号色。每关唯一解。
export const LEVELS = {
${body}
};
`;
writeFileSync(fileURLToPath(new URL('../games/flow/levels.js', import.meta.url)), out);
