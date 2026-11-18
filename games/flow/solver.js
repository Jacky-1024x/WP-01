// 连线求解器：深度优先搜索 + MRV + 死角 / 分区剪枝，统计解的个数（到 limit 即停）。
// 只被出题脚本和测试使用，游戏运行时不加载。
// ends：[[a, b], …]，每种颜色的两个端点（行优先下标）。

// prune = false 时关闭剪枝，只用于测试剪枝没有误杀解。
export function solve(n, ends, { limit = 2, maxNodes = 5e6, prune = true } = {}) {
  const total = n * n;
  const k = ends.length;
  const grid = new Int8Array(total).fill(-1);
  const head = new Int32Array(k);
  const target = new Int32Array(k);
  const done = new Uint8Array(k);
  const paths = [];
  const nbr = [];
  for (let i = 0; i < total; i++) {
    const r = (i / n) | 0;
    const c = i % n;
    const list = [];
    if (r > 0) list.push(i - n);
    if (r < n - 1) list.push(i + n);
    if (c > 0) list.push(i - 1);
    if (c < n - 1) list.push(i + 1);
    nbr.push(list);
  }
  ends.forEach(([a, b], color) => {
    grid[a] = color;
    grid[b] = color;
    head[color] = a;
    target[color] = b;
    paths.push([a]);
  });
  let empty = total - 2 * k;
  let count = 0;
  let nodes = 0;
  let solution = null;
  const comp = new Int32Array(total);
  const stack = new Int32Array(total);

  function feasible() {
    if (!prune) return true;
    // 死角：每个空格至少要有 2 个可用邻居
    for (let i = 0; i < total; i++) {
      if (grid[i] !== -1) continue;
      let free = 0;
      for (const d of nbr[i]) {
        const o = grid[d];
        if (o === -1 || (!done[o] && (d === head[o] || d === target[o]))) free++;
      }
      if (free < 2) return false;
    }
    // 分区：每个空格分区要同时挨着某个颜色的线头和目标；每个颜色的线头和目标要能连上
    comp.fill(-1);
    let ncomp = 0;
    const headMask = [];
    const targetMask = [];
    for (let s = 0; s < total; s++) {
      if (grid[s] !== -1 || comp[s] !== -1) continue;
      let hm = 0;
      let tm = 0;
      let sp = 0;
      stack[sp++] = s;
      comp[s] = ncomp;
      while (sp) {
        const i = stack[--sp];
        for (const d of nbr[i]) {
          const o = grid[d];
          if (o === -1) {
            if (comp[d] === -1) {
              comp[d] = ncomp;
              stack[sp++] = d;
            }
          } else if (!done[o]) {
            if (d === head[o]) hm |= 1 << o;
            if (d === target[o]) tm |= 1 << o;
          }
        }
      }
      if (!(hm & tm)) return false;
      headMask.push(hm);
      targetMask.push(tm);
      ncomp++;
    }
    for (let c = 0; c < k; c++) {
      if (done[c]) continue;
      if (nbr[head[c]].includes(target[c])) continue;
      const bit = 1 << c;
      let ok = false;
      for (let j = 0; j < ncomp && !ok; j++) ok = (headMask[j] & bit) && (targetMask[j] & bit);
      if (!ok) return false;
    }
    return true;
  }

  function movesOf(c) {
    const out = [];
    for (const d of nbr[head[c]]) {
      if (d === target[c] || grid[d] === -1) out.push(d);
    }
    return out;
  }

  function rec() {
    if (count >= limit || nodes > maxNodes) return;
    nodes++;
    let best = -1;
    let bestMoves = null;
    for (let c = 0; c < k; c++) {
      if (done[c]) continue;
      const m = movesOf(c);
      if (!m.length) return;
      if (!bestMoves || m.length < bestMoves.length) {
        best = c;
        bestMoves = m;
        if (m.length === 1) break;
      }
    }
    if (best < 0) {
      if (empty === 0) {
        count++;
        if (!solution) solution = paths.map((p) => p.slice());
      }
      return;
    }
    const c = best;
    const prev = head[c];
    for (const d of bestMoves) {
      paths[c].push(d);
      if (d === target[c]) {
        done[c] = 1;
        if (feasible()) rec();
        done[c] = 0;
      } else {
        grid[d] = c;
        head[c] = d;
        empty--;
        if (feasible()) rec();
        empty++;
        head[c] = prev;
        grid[d] = -1;
      }
      paths[c].pop();
      if (count >= limit || nodes > maxNodes) return;
    }
  }

  if (feasible()) rec();
  return { count, solution, nodes, aborted: nodes > maxNodes };
}
