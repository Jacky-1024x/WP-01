// 生成数独内置题库：node scripts/gen-sudoku-bank.mjs [每档题数，默认 50]
// 输出 games/sudoku/puzzles.js；每道题都经过唯一解与难度评级校验。
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DIFF_IDS, makePuzzle, fitsDifficulty } from '../games/sudoku/generator.js';

const per = Number(process.argv[2]) || 50;
const bank = {};
for (const id of DIFF_IDS) {
  const seen = new Set();
  while (seen.size < per) {
    const p = makePuzzle(id);
    if (!p || !fitsDifficulty(p.puzzle, id)) continue;
    seen.add(p.puzzle.join(''));
  }
  bank[id] = [...seen];
  console.log(`${id}: ${per} 道`);
}

const body = DIFF_IDS.map((id) => `  ${id}: [\n${bank[id].map((s) => `    '${s}',`).join('\n')}\n  ],`).join('\n');
const out = `// 内置题库（由 scripts/gen-sudoku-bank.mjs 生成，请勿手改）。每道题 81 位，0 为空格。
// 实时出题超时时使用，取出后经等价变换再给玩家。
export const BANK = {
${body}
};
`;
writeFileSync(fileURLToPath(new URL('../games/sudoku/puzzles.js', import.meta.url)), out);
