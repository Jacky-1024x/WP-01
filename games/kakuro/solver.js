// 数和（Kakuro）盘面结构与求解器（纯逻辑，无 DOM）。
// 盘面用 n × n 的字符串表示：'.' 为黑格，'1'–'9' 为白格的答案；提示数由答案推出。
// 候选数用位掩码表示：第 d 位 = 可能是 d（与数独笔记一致，取值范围 0x3fe）。

export const ALL = 0x3fe;
export const bit = (d) => 1 << d;

const POP = new Uint8Array(1024);
const SUM = new Uint8Array(1024);
for (let m = 0; m < 1024; m++) {
  for (let d = 1; d <= 9; d++) {
    if (m & bit(d)) {
      POP[m]++;
      SUM[m] += d;
    }
  }
}
export const popcount = (m) => POP[m & 0x3ff];
export const digitsOf = (m) => {
  const out = [];
  for (let d = 1; d <= 9; d++) if (m & bit(d)) out.push(d);
  return out;
};

/** COMBOS[len][sum]：长度为 len、和为 sum 的所有数字组合（位掩码，按从小到大排序） */
export const COMBOS = Array.from({ length: 10 }, () => Array.from({ length: 46 }, () => []));
for (let m = 2; m < 1024; m += 2) COMBOS[POP[m]][SUM[m]].push(m);
// 按字典序排列（1+8、2+7、3+6…），与人读组合表的习惯一致
const lexKey = (m) => digitsOf(m).join('');
for (const byLen of COMBOS) for (const list of byLen) list.sort((a, b) => (lexKey(a) < lexKey(b) ? -1 : 1));

export function combosFor(sum, len, mustHave = 0) {
  if (len < 1 || len > 9 || sum < 0 || sum > 45) return [];
  return COMBOS[len][sum].filter((m) => (m & mustHave) === mustHave);
}

// ---------------------------------------------------------------- 盘面结构
export function parseGrid(str, n) {
  if (typeof str !== 'string' || str.length !== n * n) return null;
  const sol = new Array(n * n);
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '.') sol[i] = 0;
    else if (ch >= '1' && ch <= '9') sol[i] = ch.charCodeAt(0) - 48;
    else return null;
  }
  return sol;
}

export const gridToString = (sol) => sol.map((v) => (v ? String(v) : '.')).join('');

/** 沿主对角线翻转：横段与竖段互换，仍是合法且解不变的题 */
export function transpose(str, n) {
  let out = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out += str[c * n + r];
  return out;
}

/**
 * 由白格分布求出所有“段”（连续的横向 / 竖向白格）。
 * 返回 { n, white, runs, across, down }：runs[k] = { dir: 'a'|'d', clue, cells, sum }；
 * across[i] / down[i] = 白格 i 所在横段 / 竖段的编号，黑格为 -1。
 * sol 给出时用答案计算每段的和；只给白格分布时 sum 为 0。
 */
export function buildStructure(n, sol) {
  const N = n * n;
  const white = sol.map((v) => v > 0);
  const runs = [];
  const across = new Int16Array(N).fill(-1);
  const down = new Int16Array(N).fill(-1);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      if (white[i]) continue;
      for (const [dir, step, ok] of [
        ['a', 1, (j) => j % n !== 0],
        ['d', n, () => true],
      ]) {
        const cells = [];
        for (let j = i + step; j < N && ok(j) && white[j]; j += step) cells.push(j);
        if (!cells.length) continue;
        const k = runs.length;
        runs.push({ dir, clue: i, cells, sum: cells.reduce((s, j) => s + (sol[j] || 0), 0) });
        for (const j of cells) (dir === 'a' ? across : down)[j] = k;
      }
    }
  }
  return { n, white, runs, across, down };
}

/** 题面合法性：每个白格都属于一个横段和一个竖段，段长 2–9，段内答案不重复 */
export function validLayout(st, sol) {
  for (let i = 0; i < st.white.length; i++) {
    if (st.white[i] && (st.across[i] < 0 || st.down[i] < 0)) return false;
  }
  for (const run of st.runs) {
    if (run.cells.length < 2 || run.cells.length > 9) return false;
    if (sol) {
      let m = 0;
      for (const j of run.cells) {
        if (m & bit(sol[j])) return false;
        m |= bit(sol[j]);
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------- 约束传播
/**
 * 单段完全一致性：对一段格子，求出每格在“存在一种合法填法”的前提下还能填哪些数。
 * 用“已用数字集合”做分层状态（最多 1024 种），正向求可达、反向求可完成。
 * 返回每格新的候选掩码数组；无解时返回 null。
 */
const MARK = new Uint32Array(1024 * 10); // 第 j 层的标记放在 [j * 1024, j * 1024 + 1024)
let stamp = 0;

export function runSupport(cells, sum, cand) {
  const k = cells.length;
  if (++stamp > 0xfffffff0) {
    MARK.fill(0);
    stamp = 1;
  }
  const fwd = stamp;
  const back = ++stamp;
  const layers = [[0]];
  for (let j = 0; j < k; j++) {
    const base = (j + 1) * 1024;
    const next = [];
    const c = cand[cells[j]];
    const left = k - j - 1;
    for (const m of layers[j]) {
      for (let d = 1; d <= 9; d++) {
        const b = 1 << d;
        if (!(c & b) || m & b) continue;
        const nm = m | b;
        // 剩下的格子至少还要加上 1+2+…（粗略下界），超了就剪掉
        if (MARK[base + nm] === fwd || SUM[nm] + (left * (left + 1)) / 2 > sum) continue;
        MARK[base + nm] = fwd;
        next.push(nm);
      }
    }
    layers.push(next);
  }
  let any = false;
  for (const m of layers[k]) {
    if (SUM[m] === sum) {
      MARK[k * 1024 + m] = back;
      any = true;
    }
  }
  if (!any) return null;
  const out = new Array(k).fill(0);
  for (let j = k - 1; j >= 0; j--) {
    const c = cand[cells[j]];
    const nextBase = (j + 1) * 1024;
    for (const m of layers[j]) {
      for (let d = 1; d <= 9; d++) {
        const b = 1 << d;
        if (!(c & b) || m & b || MARK[nextBase + (m | b)] !== back) continue;
        out[j] |= b;
        MARK[j * 1024 + m] = back;
      }
    }
  }
  return out;
}

/** 对全部段反复做单段一致性，直到不再变化。cand 会被原地修改；出现矛盾返回 false */
export function propagate(st, cand) {
  const queued = new Uint8Array(st.runs.length).fill(1);
  const queue = st.runs.map((_, k) => k);
  while (queue.length) {
    const k = queue.shift();
    queued[k] = 0;
    const run = st.runs[k];
    const sup = runSupport(run.cells, run.sum, cand);
    if (!sup) return false;
    run.cells.forEach((j, t) => {
      if (sup[t] === cand[j]) return;
      cand[j] = sup[t];
      const other = run.dir === 'a' ? st.down[j] : st.across[j];
      if (other >= 0 && !queued[other]) {
        queued[other] = 1;
        queue.push(other);
      }
    });
  }
  return true;
}

export function initialCandidates(st, values) {
  return Uint16Array.from(st.white, (w, i) => (!w ? 0 : values?.[i] ? bit(values[i]) : ALL));
}

/** 数解（带传播的回溯），达到 limit 个就停止 */
export function countSolutions(st, limit = 2, cand = initialCandidates(st)) {
  let count = 0;
  const solutions = [];
  const dfs = (c) => {
    if (!propagate(st, c)) return;
    let best = -1;
    let bestPop = 10;
    for (let i = 0; i < c.length; i++) {
      if (!st.white[i]) continue;
      const p = POP[c[i]];
      if (p > 1 && p < bestPop) {
        bestPop = p;
        best = i;
      }
    }
    if (best < 0) {
      count++;
      if (solutions.length < limit) solutions.push(Array.from(c, (m) => (m ? 31 - Math.clz32(m) : 0)));
      return;
    }
    for (const d of digitsOf(c[best])) {
      if (count >= limit) return;
      const nc = c.slice();
      nc[best] = bit(d);
      dfs(nc);
    }
  };
  dfs(cand.slice());
  return { count, solutions };
}

/** 只靠约束传播（不猜）能否解完；返回传播后的候选数与是否解完 */
export function logicSolve(st, values) {
  const cand = initialCandidates(st, values);
  const ok = propagate(st, cand);
  const solved = ok && st.white.every((w, i) => !w || POP[cand[i]] === 1);
  return { ok, solved, cand };
}

/**
 * 提示用：从当前已填（且正确）的数字出发，按“轮”做传播（每轮所有段同时用上一轮的候选数），
 * 返回最早能唯一确定的空格：{ cell, digit, round, runs: [横段, 竖段] }。
 * round = 1 表示只看这一格所在的两段就能确定。
 */
export function findStep(st, values) {
  let cand = initialCandidates(st, values);
  for (let round = 1; round <= 200; round++) {
    const next = cand.slice();
    for (const run of st.runs) {
      const sup = runSupport(run.cells, run.sum, cand);
      if (!sup) return null;
      run.cells.forEach((j, t) => (next[j] &= sup[t]));
    }
    for (let i = 0; i < next.length; i++) {
      if (!st.white[i] || values[i] || POP[next[i]] !== 1) continue;
      return { cell: i, digit: 31 - Math.clz32(next[i]), round, runs: [st.across[i], st.down[i]] };
    }
    if (next.every((m, i) => m === cand[i])) return null;
    cand = next;
  }
  return null;
}

/** 某格“只看所在两段”时的候选数：两段各自与已填数字相容的组合的并集取交集，再去掉段内已填的数 */
export function simpleCandidates(st, values, i) {
  if (!st.white[i] || values[i]) return 0;
  let mask = ALL;
  for (const k of [st.across[i], st.down[i]]) {
    const run = st.runs[k];
    let placed = 0;
    let bad = false;
    for (const j of run.cells) {
      if (!values[j]) continue;
      if (placed & bit(values[j])) bad = true;
      placed |= bit(values[j]);
    }
    if (bad) continue;
    let union = 0;
    for (const m of combosFor(run.sum, run.cells.length, placed)) union |= m;
    mask &= union & ~placed;
  }
  return mask;
}
