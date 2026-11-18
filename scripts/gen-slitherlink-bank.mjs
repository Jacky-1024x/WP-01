// 生成数回内置题库：node scripts/gen-slitherlink-bank.mjs [每档题数，默认 40] [随机种子]
// 输出 games/slitherlink/puzzles.js；每道题都经过逻辑求解器评级，并用回溯数解复核唯一解。
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LEVELS } from '../games/slitherlink/board.js';
import { makePuzzle, clueCount } from '../games/slitherlink/generator.js';
import { countSolutions } from '../games/slitherlink/solver.js';

const per = Number(process.argv[2]) || 40;
let seed = Number(process.argv[3]) || 20261118;
const rng = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const bank = {};
for (const level of Object.keys(LEVELS)) {
  const { rows, cols } = LEVELS[level];
  const seen = new Set();
  while (seen.size < per) {
    const p = makePuzzle(level, rng);
    if (!p || seen.has(p)) continue;
    const clues = Int8Array.from(p, (ch) => (ch === '.' ? -1 : Number(ch)));
    if (countSolutions(clues, rows, cols, 2).count !== 1) throw new Error(`非唯一解：${p}`);
    seen.add(p);
  }
  bank[level] = [...seen];
  const counts = bank[level].map(clueCount);
  console.log(`${level}: ${per} 道，线索 ${Math.min(...counts)}–${Math.max(...counts)} 个`);
}

const body = Object.keys(LEVELS)
  .map((id) => `  ${id}: [\n${bank[id].map((s) => `    '${s}',`).join('\n')}\n  ],`)
  .join('\n');
const out = `// 内置题库（由 scripts/gen-slitherlink-bank.mjs 生成，请勿手改）。每道题按行展开，'.' 为空白格。
// 每道题唯一解；开局时随机做 8 种对称变换之一再给玩家。
export const BANK = {
${body}
};
`;
writeFileSync(fileURLToPath(new URL('../games/slitherlink/puzzles.js', import.meta.url)), out);
