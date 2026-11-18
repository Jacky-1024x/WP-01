// 生成推箱子关卡：node scripts/gen-sokoban-levels.mjs
// 教学关手写；其余关卡随机生成房间和目标点，从“已完成”局面反向拉箱子，取最远的局面作为开局，
// 所以每关都有解，且最少推动是精确值。结果写入 games/sokoban/levels.js。
// 新章节只能追加在末尾并使用自己的 seed：前面章节共用一条随机序列，改动会让已发布的关卡全部变样。
// 只试验某一章（不写文件）：ONLY=精通 node scripts/gen-sokoban-levels.mjs
import { writeFileSync } from 'node:fs';
import { WALL, FLOOR } from '../games/sokoban/engine.js';
import { solve, pullSearch } from '../games/sokoban/solver.js';

const OUT = new URL('../games/sokoban/levels.js', import.meta.url);
const VERSION = 1;

const TUTORIAL = [
  ['#######', '#     #', '#@$   #', '###  .#', '  #####'],
  ['#######', '#.    #', '# $   #', '#   @ #', '#######'],
  ['#######', '#.  @ #', '#.$$  #', '#     #', '#######'],
  ['########', '#  #   #', '# $  $ #', '#. ##. #', '#  @   #', '########'],
  ['  ######', '  #    #', '###$## #', '#  .  @#', '# $#.$ #', '#   .  #', '########'],
];

const CHAPTERS = [
  { name: '入门', boxes: 2, size: [[5, 7], [5, 7]], wallRate: [0.2, 0.32], pushes: [8, 24], tries: 6000 },
  { name: '进阶', boxes: 3, size: [[6, 8], [6, 8]], wallRate: [0.2, 0.32], pushes: [12, 35], tries: 6000 },
  { name: '挑战', boxes: 4, size: [[7, 9], [6, 8]], wallRate: [0.18, 0.3], pushes: [22, 45], tries: 6000 },
  // 以下为 v2 追加
  { name: '精通', seed: 101, boxes: 4, size: [[8, 9], [7, 9]], wallRate: [0.16, 0.28], pushes: [30, 70], tries: 10000, count: 20 },
  { name: '大师', seed: 102, boxes: 5, size: [[7, 9], [7, 8]], wallRate: [0.3, 0.42], pushes: [30, 80], tries: 30000, maxStates: 1_000_000, partial: true, onTarget: 1 },
  { name: '宗师', seed: 103, boxes: 6, size: [[8, 9], [8, 9]], wallRate: [0.32, 0.44], pushes: [34, 90], tries: 6000, maxStates: 1_000_000, partial: true, onTarget: 2 },
];
const PER_CHAPTER = 15; // 章节没写 count 时的关数
const ONLY = process.env.ONLY;

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = mulberry32(20261118);
const randInt = (a, b) => a + Math.floor(rng() * (b - a + 1));

// ---------------------------------------------------------------- 房间
function makeRoom(W, H, wallRate) {
  const w = W + 2;
  const h = H + 2;
  const tiles = new Uint8Array(w * h).fill(WALL);
  for (let y = 1; y <= H; y++) for (let x = 1; x <= W; x++) if (rng() >= wallRate) tiles[y * w + x] = FLOOR;
  const S = [-w, 1, w, -1];

  // 只保留最大的连通地板
  const comp = new Int32Array(w * h).fill(-1);
  let bestComp = -1;
  let bestSize = 0;
  for (let i = 0, c = 0; i < tiles.length; i++) {
    if (tiles[i] !== FLOOR || comp[i] >= 0) continue;
    const stack = [i];
    comp[i] = c;
    let size = 0;
    while (stack.length) {
      const j = stack.pop();
      size++;
      for (const s of S) if (tiles[j + s] === FLOOR && comp[j + s] < 0) (comp[j + s] = c), stack.push(j + s);
    }
    if (size > bestSize) (bestSize = size), (bestComp = c);
    c++;
  }
  for (let i = 0; i < tiles.length; i++) if (tiles[i] === FLOOR && comp[i] !== bestComp) tiles[i] = WALL;

  // 去掉死胡同（三面是墙的地板），反复做直到没有
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] !== FLOOR) continue;
      if (S.filter((s) => tiles[i + s] !== FLOOR).length >= 3) {
        tiles[i] = WALL;
        changed = true;
      }
    }
  }

  // 太空旷（有 3×3 全是地板）的房间太简单，不要
  for (let y = 1; y + 2 <= H; y++) {
    for (let x = 1; x + 2 <= W; x++) {
      let open = true;
      for (let dy = 0; dy < 3 && open; dy++) for (let dx = 0; dx < 3 && open; dx++) open = tiles[(y + dy) * w + x + dx] === FLOOR;
      if (open) return null;
    }
  }
  const floor = [];
  for (let i = 0; i < tiles.length; i++) if (tiles[i] === FLOOR) floor.push(i);
  return { w, h, tiles, floor };
}

// ---------------------------------------------------------------- 输出 XSB
function toRows({ w, h, tiles }, boxes, targets, player) {
  const box = new Set(boxes);
  const tgt = new Set(targets);
  const grid = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (tiles[i] === FLOOR) {
        if (i === player) row += tgt.has(i) ? '+' : '@';
        else if (box.has(i)) row += tgt.has(i) ? '*' : '$';
        else row += tgt.has(i) ? '.' : ' ';
        continue;
      }
      // 只保留贴着地板的墙（含斜角），其余是场外
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1 && !near; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          near = nx >= 0 && ny >= 0 && nx < w && ny < h && tiles[ny * w + nx] === FLOOR;
        }
      }
      row += near ? '#' : ' ';
    }
    grid.push(row);
  }
  // 裁掉全空的行列和行尾空格
  let rows = grid.filter((r) => r.trim());
  const left = Math.min(...rows.map((r) => r.search(/\S/)));
  rows = rows.map((r) => r.slice(left).replace(/\s+$/, ''));
  return rows;
}

// 解法中换箱子的次数：这次推的箱子不是上一次推完的那个
function countSwitches(rows, solution) {
  const w = Math.max(...rows.map((r) => r.length));
  const S = [-w, 1, w, -1];
  let switches = 0;
  let at = -1;
  for (const { box, dir } of solution) {
    if (at >= 0 && box !== at) switches++;
    at = box + S[dir];
  }
  return switches;
}

// ---------------------------------------------------------------- 生成
function generate(ch) {
  if (ch.seed) rng = mulberry32(ch.seed);
  const t0 = Date.now();
  const out = [];
  const stats = {};
  const seen = new Set();
  for (let t = 0; t < ch.tries; t++) {
    const W = randInt(...ch.size[0]);
    const H = randInt(...ch.size[1]);
    const rate = ch.wallRate[0] + rng() * (ch.wallRate[1] - ch.wallRate[0]);
    const room = makeRoom(W, H, rate);
    if (!room || room.floor.length < ch.boxes * 4 + 6) continue;
    const pool = room.floor.slice();
    const targets = [];
    for (let k = 0; k < ch.boxes; k++) targets.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    const res = pullSearch({ w: room.w, tiles: room.tiles, targets }, { maxStates: ch.maxStates, partial: ch.partial, maxOnTarget: ch.onTarget });
    if (ONLY) {
      const k = !res ? 'over' : res.pushes < ch.pushes[0] ? 'low' : res.pushes > ch.pushes[1] ? 'high' : 'ok';
      stats[k] = (stats[k] || 0) + 1;
    }
    if (!res || res.pushes < ch.pushes[0] || res.pushes > ch.pushes[1]) continue;
    const rows = toRows(room, res.boxes, targets, res.player);
    const key = rows.join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    // 正向求解超出上限的局面跳过：测试要能在默认上限内验证每一关
    const sol = solve(rows);
    if (!sol) {
      if (ONLY) stats.unverified = (stats.unverified || 0) + 1;
      continue;
    }
    if (sol.pushes !== res.pushes) throw new Error(`正反向求解不一致：\n${rows.join('\n')}`);
    const switches = countSwitches(rows, sol.solution);
    out.push({ rows, pushes: sol.pushes, switches, score: sol.pushes + 3 * switches });
  }
  out.sort((a, b) => a.score - b.score);
  if (ONLY) console.log(ch.name, stats, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
  // 跳过分数最低的 40%，其余均匀取，难度递增
  const count = ch.count ?? PER_CHAPTER;
  const from = Math.floor(out.length * 0.4);
  if (out.length - from < count) throw new Error(`${ch.name} 只生成了 ${out.length} 关`);
  const picked = [];
  for (let k = 0; k < count; k++) {
    picked.push(out[from + Math.round((k * (out.length - 1 - from)) / (count - 1))]);
  }
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`${ch.name}：候选 ${out.length} 关，推动 ${picked.map((p) => p.pushes).join(' ')}，${sec}s`);
  return picked;
}

const levels = [];
const chapters = [];
chapters.push({ name: '教学', from: 0, to: TUTORIAL.length });
for (const rows of TUTORIAL) {
  const sol = solve(rows);
  if (!sol) throw new Error(`教学关无解：\n${rows.join('\n')}`);
  levels.push({ map: rows, minPushes: sol.pushes });
}
console.log(`教学：推动 ${levels.map((l) => l.minPushes).join(' ')}`);
if (ONLY) {
  generate(CHAPTERS.find((c) => c.name === ONLY));
  process.exit(0);
}
for (const ch of CHAPTERS) {
  const from = levels.length;
  for (const p of generate(ch)) levels.push({ map: p.rows, minPushes: p.pushes });
  chapters.push({ name: ch.name, from, to: levels.length });
}

const body = levels
  .map((l) => `  { minPushes: ${l.minPushes}, map: [\n${l.map.map((r) => `    ${JSON.stringify(r)},`).join('\n')}\n  ] },`)
  .join('\n');
writeFileSync(
  OUT,
  `// 由 scripts/gen-sokoban-levels.mjs 生成，请勿手改。
// 关卡改动后请修改 LEVELS_VERSION：进行中的存档会被丢弃（成绩按地图哈希保存，地图没变的关不受影响）。
export const LEVELS_VERSION = ${VERSION};

// 每章的关卡范围 [from, to)
export const CHAPTERS = ${JSON.stringify(chapters)};

export const LEVELS = [
${body}
];
`,
);
console.log(`共 ${levels.length} 关，已写入 games/sokoban/levels.js`);
