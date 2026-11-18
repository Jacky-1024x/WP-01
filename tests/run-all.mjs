// 依次运行全部测试：node tests/run-all.mjs（即 npm test）。任一文件失败则以非 0 退出。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FILES = [
  'smoke.mjs',
  'nonogram.mjs',
  'huarong.mjs',
  'lightsout.mjs',
  'slitherlink.mjs',
  'nurikabe.mjs',
  'hashi.mjs',
  'kakuro.mjs',
  'queens.mjs',
  'flow.mjs',
];

const failed = [];
for (const f of FILES) {
  console.log(`\n▶ tests/${f}`);
  const r = spawnSync(process.execPath, [fileURLToPath(new URL(f, import.meta.url))], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(f);
}

if (failed.length) {
  console.error(`\n✗ 失败：${failed.join('、')}`);
  process.exit(1);
}
console.log(`\n✓ ${FILES.length} 个测试文件全部通过`);
