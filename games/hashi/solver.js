// 数桥求解器：每条可连接的边是一个 0–2 的变量，维护取值范围 [lo, hi]。
// 基本推理（数字上下界、交叉排除、连通剪枝、孤岛排除）推到不动后再分支回溯；找到 limit 个解即停止。

// 基本推理推到不动点；返回 false 表示矛盾。lo / hi 原地修改
export function propagate(p, lo, hi) {
  const { islands, islandEdges, edges, cross } = p;
  const N = islands.length;
  let changed = true;
  while (changed) {
    changed = false;
    for (let k = 0; k < N; k++) {
      const n = islands[k].n;
      const ie = islandEdges[k];
      let sl = 0;
      let sh = 0;
      for (const e of ie) {
        sl += lo[e];
        sh += hi[e];
      }
      if (sl > n || sh < n) return false;
      for (const e of ie) {
        const nlo = Math.max(lo[e], n - (sh - hi[e]));
        const nhi = Math.min(hi[e], n - (sl - lo[e]));
        if (nlo > nhi) return false;
        if (nlo !== lo[e] || nhi !== hi[e]) {
          sl += nlo - lo[e];
          sh += nhi - hi[e];
          lo[e] = nlo;
          hi[e] = nhi;
          changed = true;
        }
      }
    }
    for (let e = 0; e < edges.length; e++) {
      if (!lo[e]) continue;
      for (const c of cross[e]) {
        if (!hi[c]) continue;
        if (lo[c]) return false;
        hi[c] = 0;
        changed = true;
      }
    }
    if (!changed && N > 1) {
      // 孤岛排除：两个只差一座就满足的岛之间，如果连上就会形成闭合的小岛群，则不能连满
      for (let e = 0; e < edges.length; e++) {
        if (lo[e] === hi[e]) continue;
        if (closesGroup(p, lo, e, hi[e])) {
          hi[e]--;
          changed = true;
        }
      }
    }
  }
  if (N <= 1) return true;
  // 连通剪枝：可能有桥的边必须连通所有岛
  if (reach(p, hi) !== N) return false;
  // 孤岛排除：已确定的桥组成的闭合小岛群
  if (closedGroupExists(p, lo, hi)) return false;
  return true;
}

function reach(p, w) {
  const N = p.islands.length;
  const seen = new Uint8Array(N);
  const stack = [0];
  seen[0] = 1;
  let count = 1;
  while (stack.length) {
    const k = stack.pop();
    for (const e of p.islandEdges[k]) {
      if (!w[e]) continue;
      const o = p.edges[e].a === k ? p.edges[e].b : p.edges[e].a;
      if (!seen[o]) {
        seen[o] = 1;
        count++;
        stack.push(o);
      }
    }
  }
  return count;
}

// 假设边 e 取值 v（其余取 lo），从 e 的端点出发沿已确定的桥扩展：若得到的岛群每个岛都恰好满足，且不含全部岛，则闭合
function closesGroup(p, lo, e, v) {
  const { islands, islandEdges, edges } = p;
  const N = islands.length;
  const val = (x) => (x === e ? v : lo[x]);
  const seen = new Uint8Array(N);
  const stack = [edges[e].a];
  seen[edges[e].a] = 1;
  let count = 1;
  while (stack.length) {
    const k = stack.pop();
    let s = 0;
    for (const x of islandEdges[k]) s += val(x);
    if (s !== islands[k].n) return false;
    for (const x of islandEdges[k]) {
      if (!val(x)) continue;
      const o = edges[x].a === k ? edges[x].b : edges[x].a;
      if (!seen[o]) {
        seen[o] = 1;
        count++;
        stack.push(o);
      }
    }
  }
  return count < N;
}

function closedGroupExists(p, lo, hi) {
  const { islands, islandEdges, edges } = p;
  const N = islands.length;
  const seen = new Uint8Array(N);
  for (let s = 0; s < N; s++) {
    if (seen[s]) continue;
    const members = [s];
    seen[s] = 1;
    let closed = true;
    for (let q = 0; q < members.length; q++) {
      const k = members[q];
      let sl = 0;
      for (const e of islandEdges[k]) {
        sl += lo[e];
        if (lo[e] !== hi[e]) closed = false;
      }
      if (sl !== islands[k].n) closed = false;
      for (const e of islandEdges[k]) {
        if (!lo[e]) continue;
        const o = edges[e].a === k ? edges[e].b : edges[e].a;
        if (!seen[o]) {
          seen[o] = 1;
          members.push(o);
        }
      }
    }
    if (closed && members.length < N) return true;
  }
  return false;
}

function pickEdge(p, lo, hi) {
  // 选未确定边最少的岛上的一条未确定边
  let best = -1;
  let bestScore = Infinity;
  for (let k = 0; k < p.islands.length; k++) {
    let open = 0;
    let cand = -1;
    for (const e of p.islandEdges[k]) {
      if (lo[e] !== hi[e]) {
        open++;
        cand = e;
      }
    }
    if (open && open < bestScore) {
      bestScore = open;
      best = cand;
      if (open === 1) break;
    }
  }
  return best;
}

// 返回 { count, solution, branches }：count 为找到的解数（≤ limit），solution 为第一个解，branches 为分支次数
export function solve(p, { limit = 2 } = {}) {
  const m = p.edges.length;
  const lo = new Uint8Array(m);
  const hi = new Uint8Array(m).fill(2);
  const res = { count: 0, solution: null, branches: 0 };
  const rec = (lo, hi) => {
    if (!propagate(p, lo, hi)) return;
    const e = pickEdge(p, lo, hi);
    if (e < 0) {
      res.count++;
      if (!res.solution) res.solution = Uint8Array.from(lo);
      return;
    }
    res.branches++;
    for (let v = hi[e]; v >= lo[e] && res.count < limit; v--) {
      const l2 = Uint8Array.from(lo);
      const h2 = Uint8Array.from(hi);
      l2[e] = h2[e] = v;
      rec(l2, h2);
    }
  };
  rec(lo, hi);
  return res;
}

export const countSolutions = (p, limit = 2) => solve(p, { limit }).count;

// 只用基本推理（不分支）能否解完
export function solvableByLogic(p) {
  const m = p.edges.length;
  const lo = new Uint8Array(m);
  const hi = new Uint8Array(m).fill(2);
  if (!propagate(p, lo, hi)) return false;
  for (let e = 0; e < m; e++) if (lo[e] !== hi[e]) return false;
  return true;
}
