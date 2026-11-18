// 生成数墙内置题库：node scripts/gen-nurikabe-bank.mjs [每档题数，默认 40] [随机种子，默认 2026]
// 输出 games/nurikabe/puzzles.js；每道题都经过求解器校验唯一解，并按 8 种旋转 / 翻转规范化去重。
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makePuzzle } from '../games/nurikabe/generator.js';
import { LEVELS, LEVEL_IDS, transformIndex, encodePuzzle, encodeSolution } from '../games/nurikabe/board.js';

const per = Number(process.argv[2]) || 40;
let seed = Number(process.argv[3]) || 2026;

function rng() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// 出题参数：maxIsland 最大岛屿，grow 额外长大岛屿的尝试次数，prefer 优先长大已有岛屿的概率，
// clues 允许的数字个数区间，maxNodes 求解器节点上限（超过视为太难算，丢弃）
const OPTS = {
  easy: { maxIsland: 5, grow: 6, prefer: 0.3, clues: [3, 7] },
  medium: { maxIsland: 7, grow: 10, prefer: 0.4, clues: [6, 12] },
  hard: { maxIsland: 9, grow: 20, clues: [14, 22], maxNodes: 20000 },
};

function canonical(str, n) {
  let best = null;
  for (let t = 0; t < 8; t++) {
    const out = new Array(n * n);
    for (let i = 0; i < n * n; i++) out[transformIndex(i, n, t)] = str[i];
    const s = out.join('');
    if (best === null || s < best) best = s;
  }
  return best;
}

const bank = {};
for (const id of LEVEL_IDS) {
  const n = LEVELS[id].size;
  const opts = OPTS[id];
  const seen = new Set();
  const list = [];
  const t0 = Date.now();
  while (list.length < per) {
    const p = makePuzzle(n, n, opts, rng, 1);
    if (!p) continue;
    const count = p.clues.filter(Boolean).length;
    if (count < opts.clues[0] || count > opts.clues[1]) continue;
    const puzzle = encodePuzzle(p.clues);
    const key = canonical(puzzle, n);
    if (seen.has(key)) continue;
    seen.add(key);
    list.push([puzzle, encodeSolution(p.solution)]);
  }
  bank[id] = list;
  console.log(`${id}（${n}×${n}）: ${per} 道，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

const body = LEVEL_IDS.map(
  (id) => `  ${id}: [\n${bank[id].map(([p, s]) => `    ['${p}', '${s}'],`).join('\n')}\n  ],`,
).join('\n');
const out = `// 内置题库（由 scripts/gen-nurikabe-bank.mjs 生成，请勿手改）。
// 每道题 [题面, 答案]，按行展开：题面中 '.' 为无数字、1–9 为数字；答案中 '#' 为黑格、'.' 为白格。
// 每道题都经求解器校验唯一解；开局时再随机做 8 种旋转 / 翻转之一。
export const BANK = {
${body}
};
`;
writeFileSync(fileURLToPath(new URL('../games/nurikabe/puzzles.js', import.meta.url)), out);
