// 数墙求解器（纯逻辑，不依赖 DOM）：只用于离线出题脚本和测试，页面运行时不加载。
// 思路：对每个数字枚举所有可能的岛屿形状，再回溯为每个数字选一种形状，
// 用位集做重叠 / 相邻剔除，并以「2×2 必须有白格」「肯定是黑格的格子必须能连成一片」剪枝。

function neighborsOf(w, h) {
  const nb = [];
  for (let i = 0; i < w * h; i++) {
    const x = i % w;
    const y = (i / w) | 0;
    const list = [];
    if (y > 0) list.push(i - w);
    if (x > 0) list.push(i - 1);
    if (x < w - 1) list.push(i + 1);
    if (y < h - 1) list.push(i + w);
    nb.push(list);
  }
  return nb;
}

// 枚举包含 root、大小为 n、只用 allowed 格的所有连通形状，每种形状恰好输出一次（Redelmeier 算法）
export function enumerateShapes(root, n, allowed, nb, emit) {
  const visited = new Uint8Array(allowed.length);
  const cells = [];
  visited[root] = 1;
  const rec = (untried) => {
    const pool = untried.slice();
    while (pool.length) {
      const v = pool.pop();
      cells.push(v);
      if (cells.length === n) {
        emit(cells);
      } else {
        const next = pool.slice();
        const added = [];
        for (const u of nb[v]) {
          if (allowed[u] && !visited[u]) {
            visited[u] = 1;
            added.push(u);
            next.push(u);
          }
        }
        rec(next);
        for (const u of added) visited[u] = 0;
      }
      cells.pop();
    }
  };
  rec([root]);
}

/**
 * 数解。clues：长度 w*h 的数组，0 表示无数字。
 * 返回 { count, solution }：count 最多数到 limit；solution 为找到的第一个解（Uint8Array，1 = 黑格）。
 * maxShapes / maxNodes：单个数字的形状数、搜索节点数上限，超过则放弃（返回 count = -1），防止出题时卡死。
 */
export function solve(w, h, clues, { limit = 2, maxShapes = 200000, maxNodes = Infinity } = {}) {
  const N = w * h;
  const K = Math.ceil(N / 32);
  const nb = neighborsOf(w, h);
  const clueCells = [];
  let area = 0;
  for (let i = 0; i < N; i++) {
    if (clues[i] > 0) {
      clueCells.push(i);
      area += clues[i];
    }
  }
  if (area > N || clueCells.length === 0) return { count: 0, solution: null };

  // 每个数字的候选形状：cells 与 closure（形状 + 相邻格）两个位集，扁平存放
  const shapes = [];
  for (const c of clueCells) {
    const allowed = new Uint8Array(N).fill(1);
    for (const o of clueCells) {
      if (o === c) continue;
      allowed[o] = 0;
      for (const u of nb[o]) allowed[u] = 0;
    }
    if (!allowed[c]) return { count: 0, solution: null }; // 两个数字相邻
    const cellsBits = [];
    const closureBits = [];
    let overflow = false;
    enumerateShapes(c, clues[c], allowed, nb, (cells) => {
      if (overflow) return;
      if (cellsBits.length / K >= maxShapes) {
        overflow = true;
        return;
      }
      const a = new Int32Array(K);
      const b = new Int32Array(K);
      for (const v of cells) {
        a[v >> 5] |= 1 << (v & 31);
        b[v >> 5] |= 1 << (v & 31);
        for (const u of nb[v]) b[u >> 5] |= 1 << (u & 31);
      }
      cellsBits.push(...a);
      closureBits.push(...b);
    });
    if (overflow) return { count: -1, solution: null };
    shapes.push({ cells: Int32Array.from(cellsBits), closure: Int32Array.from(closureBits), n: cellsBits.length / K });
  }

  const windows = [];
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const m = new Int32Array(K);
      for (const v of [y * w + x, y * w + x + 1, (y + 1) * w + x, (y + 1) * w + x + 1]) m[v >> 5] |= 1 << (v & 31);
      windows.push(m);
    }
  }

  const M = clueCells.length;
  let count = 0;
  let first = null;
  const has = (bits, v) => (bits[v >> 5] >>> (v & 31)) & 1;
  const queue = new Int32Array(N);
  const seen = new Uint8Array(N);

  // 「肯定是黑格」的格子必须都落在「可能是黑格」的同一个连通块里
  function wallOk(occupied, whiteMaybe) {
    let start = -1;
    let need = 0;
    for (let i = 0; i < N; i++) {
      if (!has(whiteMaybe, i)) {
        need++;
        if (start < 0) start = i;
      }
    }
    if (need <= 1) return true;
    seen.fill(0);
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    let got = 0;
    while (head < tail) {
      const v = queue[head++];
      if (!has(whiteMaybe, v)) got++;
      for (const u of nb[v]) {
        if (!seen[u] && !has(occupied, u)) {
          seen[u] = 1;
          queue[tail++] = u;
        }
      }
    }
    return got === need;
  }

  const cellClosure = [];
  for (let v = 0; v < N; v++) {
    const m = new Int32Array(K);
    m[v >> 5] |= 1 << (v & 31);
    for (const u of nb[v]) m[u >> 5] |= 1 << (u & 31);
    cellClosure.push(m);
  }
  const closureOf = (bits) => {
    const out = new Int32Array(K);
    for (let v = 0; v < N; v++) if (has(bits, v)) for (let k = 0; k < K; k++) out[k] |= cellClosure[v][k];
    return out;
  };
  const filter = (j, list, test) => {
    const { cells } = shapes[j];
    const keep = [];
    for (const s of list) if (test(cells, s * K)) keep.push(s);
    return keep;
  };
  const disjoint = (mask) => (cells, o) => {
    for (let k = 0; k < K; k++) if (cells[o + k] & mask[k]) return false;
    return true;
  };
  const touches = (mask) => (cells, o) => {
    for (let k = 0; k < K; k++) if (cells[o + k] & mask[k]) return true;
    return false;
  };
  let nodes = 0;
  let aborted = false;

  // lists[j]：第 j 个数字当前仍可用的候选序号（未选定的数字）。
  // 每个节点先做传播直到稳定：
  //   ① 某数字所有候选的公共格一定属于它，其他数字的候选不能碰到这些格及其邻格；
  //   ② 某个 2×2 只有一个数字能覆盖时，这个数字只保留覆盖它的候选。
  function search(lists, placed, occupied, banned) {
    if (++nodes > maxNodes) {
      aborted = true;
      return;
    }
    const cur = new Array(M);
    const inter = new Array(M);
    const union = new Array(M);
    const clInter = new Array(M);
    const open = [];
    for (let j = 0; j < M; j++) {
      if (placed[j]) continue;
      open.push(j);
      cur[j] = lists[j];
      clInter[j] = new Int32Array(K);
    }
    for (let changed = true; changed; ) {
      changed = false;
      for (const j of open) {
        const ban = banned.slice();
        for (const i of open) if (i !== j) for (let k = 0; k < K; k++) ban[k] |= clInter[i][k];
        const keep = filter(j, cur[j], disjoint(ban));
        if (!keep.length) return;
        if (keep.length !== cur[j].length) changed = true;
        cur[j] = keep;
        const { cells } = shapes[j];
        const a = new Int32Array(K).fill(-1);
        const u = new Int32Array(K);
        for (const s of keep) {
          for (let k = 0; k < K; k++) {
            a[k] &= cells[s * K + k];
            u[k] |= cells[s * K + k];
          }
        }
        inter[j] = a;
        union[j] = u;
        const cl = closureOf(a);
        for (let k = 0; k < K; k++) if (cl[k] !== clInter[j][k]) changed = true;
        clInter[j] = cl;
      }
      for (const m of windows) {
        if (touches(m)(occupied, 0)) continue;
        let only = -1;
        let n = 0;
        for (const j of open) {
          if (touches(m)(union[j], 0)) {
            only = j;
            if (++n > 1) break;
          }
        }
        if (n === 0) return;
        if (n === 1) {
          const keep = filter(only, cur[only], touches(m));
          if (keep.length !== cur[only].length) {
            cur[only] = keep;
            changed = true;
          }
        }
      }
    }
    const whiteSure = occupied.slice();
    const whiteMaybe = occupied.slice();
    let best = -1;
    for (const j of open) {
      for (let k = 0; k < K; k++) {
        whiteSure[k] |= inter[j][k];
        whiteMaybe[k] |= union[j][k];
      }
      if (best < 0 || cur[j].length < cur[best].length) best = j;
    }
    if (!wallOk(whiteSure, whiteMaybe)) return;
    const next = cur;
    if (best < 0) {
      count++;
      if (!first) {
        first = new Uint8Array(N);
        for (let i = 0; i < N; i++) first[i] = has(occupied, i) ? 0 : 1;
      }
      return;
    }
    placed[best] = 1;
    const { cells, closure } = shapes[best];
    for (const s of next[best]) {
      const occ = occupied.slice();
      const ban = banned.slice();
      for (let k = 0; k < K; k++) {
        occ[k] |= cells[s * K + k];
        ban[k] |= closure[s * K + k];
      }
      search(next, placed, occ, ban);
      if (count >= limit) break;
    }
    placed[best] = 0;
  }

  const lists = shapes.map((s) => Array.from({ length: s.n }, (_, i) => i));
  search(lists, new Uint8Array(M), new Int32Array(K), new Int32Array(K));
  if (aborted) return { count: -1, solution: null, nodes };
  return { count, solution: first, nodes };
}
