// 数字华容道纯逻辑（无 DOM 依赖，可在 node 中测试）。
// tiles 为长度 n*n 的数组，0 表示空格；已完成状态为 [1, 2, ..., n*n-1, 0]。

export function createSolved(n) {
  const tiles = [];
  for (let i = 1; i < n * n; i++) tiles.push(i);
  tiles.push(0);
  return tiles;
}

export function isSolved(tiles) {
  const last = tiles.length - 1;
  for (let i = 0; i < last; i++) if (tiles[i] !== i + 1) return false;
  return tiles[last] === 0;
}

// 逆序数校验：奇数阶要求逆序数为偶数；偶数阶要求「逆序数 + 空格自底向上的行号(从 1 起)」为奇数。
export function isSolvable(tiles, n) {
  let inversions = 0;
  const nums = tiles.filter((t) => t !== 0);
  for (let i = 0; i < nums.length; i++) {
    for (let j = i + 1; j < nums.length; j++) if (nums[i] > nums[j]) inversions++;
  }
  if (n % 2 === 1) return inversions % 2 === 0;
  const blankRowFromBottom = n - Math.floor(tiles.indexOf(0) / n);
  return (inversions + blankRowFromBottom) % 2 === 1;
}

function neighbors(index, n) {
  const r = Math.floor(index / n);
  const c = index % n;
  const out = [];
  if (r > 0) out.push(index - n);
  if (r < n - 1) out.push(index + n);
  if (c > 0) out.push(index - 1);
  if (c < n - 1) out.push(index + 1);
  return out;
}

// 从已完成状态出发做随机合法移动来打乱，结果必然可解。
export function shuffle(n, rng = Math.random) {
  const tiles = createSolved(n);
  let blank = tiles.length - 1;
  let prev = -1;
  const steps = n * n * n * 8 + 50;
  for (let s = 0; s < steps; s++) {
    const options = neighbors(blank, n).filter((i) => i !== prev);
    const pick = options[Math.floor(rng() * options.length)];
    tiles[blank] = tiles[pick];
    tiles[pick] = 0;
    prev = blank;
    blank = pick;
  }
  // 极小概率仍为已完成或过于接近完成时，再多挪几步
  if (isSolved(tiles) || misplaced(tiles) < Math.min(n * n - 1, 4)) return shuffle(n, rng);
  return tiles;
}

export function misplaced(tiles) {
  let count = 0;
  for (let i = 0; i < tiles.length; i++) if (tiles[i] !== 0 && tiles[i] !== i + 1) count++;
  return count;
}

// 点击某格：若与空格同行或同列，则把这一段方块整体朝空格方向推动。
// 返回移动的方块数（0 表示不可移动），会原地修改 tiles。
export function moveAt(tiles, n, index) {
  const blank = tiles.indexOf(0);
  if (index === blank || index < 0 || index >= tiles.length) return 0;
  const br = Math.floor(blank / n);
  const bc = blank % n;
  const r = Math.floor(index / n);
  const c = index % n;
  let step;
  if (r === br) step = c < bc ? -1 : 1;
  else if (c === bc) step = r < br ? -n : n;
  else return 0;
  let cur = blank;
  let moved = 0;
  while (cur !== index) {
    const next = cur + step;
    tiles[cur] = tiles[next];
    tiles[next] = 0;
    cur = next;
    moved++;
  }
  return moved;
}

// 滑动手势：方向为 'up' | 'down' | 'left' | 'right'，移动空格对侧相邻的方块。
export function moveDirection(tiles, n, dir) {
  const blank = tiles.indexOf(0);
  const r = Math.floor(blank / n);
  const c = blank % n;
  let target = -1;
  if (dir === 'left' && c < n - 1) target = blank + 1;
  else if (dir === 'right' && c > 0) target = blank - 1;
  else if (dir === 'up' && r < n - 1) target = blank + n;
  else if (dir === 'down' && r > 0) target = blank - n;
  return target < 0 ? 0 : moveAt(tiles, n, target);
}
