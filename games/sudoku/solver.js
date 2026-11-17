// 数独求解与评级（纯逻辑，无 DOM）。
// 盘面统一用长度 81 的数组表示，下标 i = 行 × 9 + 列，0 为空格；候选数用位掩码表示（第 d 位 = 数字 d）。

export const ROW = Array.from({ length: 81 }, (_, i) => (i / 9) | 0);
export const COL = Array.from({ length: 81 }, (_, i) => i % 9);
export const BOX = Array.from({ length: 81 }, (_, i) => ((ROW[i] / 3) | 0) * 3 + ((COL[i] / 3) | 0));

// 27 个区域：0–8 行，9–17 列，18–26 宫
export const UNITS = [];
for (let r = 0; r < 9; r++) UNITS.push(Array.from({ length: 9 }, (_, c) => r * 9 + c));
for (let c = 0; c < 9; c++) UNITS.push(Array.from({ length: 9 }, (_, r) => r * 9 + c));
for (let b = 0; b < 9; b++) {
  const r0 = ((b / 3) | 0) * 3;
  const c0 = (b % 3) * 3;
  UNITS.push(Array.from({ length: 9 }, (_, k) => (r0 + ((k / 3) | 0)) * 9 + c0 + (k % 3)));
}

export const PEERS = Array.from({ length: 81 }, (_, i) => {
  const set = new Set([...UNITS[ROW[i]], ...UNITS[9 + COL[i]], ...UNITS[18 + BOX[i]]]);
  set.delete(i);
  return [...set];
});

const SEES = new Uint8Array(81 * 81);
PEERS.forEach((ps, i) => ps.forEach((p) => (SEES[i * 81 + p] = 1)));
export const sees = (a, b) => SEES[a * 81 + b] === 1;

export const ALL = 0x3fe;
const POP = new Uint8Array(1024);
for (let m = 1; m < 1024; m++) POP[m] = POP[m >> 1] + (m & 1);
export const popcount = (m) => POP[m];
export const digitsOf = (mask) => {
  const out = [];
  for (let d = 1; d <= 9; d++) if (mask & (1 << d)) out.push(d);
  return out;
};

export function candidatesOf(grid, i) {
  if (grid[i]) return 0;
  let mask = ALL;
  for (const p of PEERS[i]) if (grid[p]) mask &= ~(1 << grid[p]);
  return mask;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------- 回溯搜索（最少候选格优先）
function search(grid, limit, rng) {
  const g = Array.from(grid);
  const rm = new Uint16Array(9);
  const cm = new Uint16Array(9);
  const bm = new Uint16Array(9);
  for (let i = 0; i < 81; i++) {
    const d = g[i];
    if (!d) continue;
    const bit = 1 << d;
    if ((rm[ROW[i]] | cm[COL[i]] | bm[BOX[i]]) & bit) return { count: 0, first: null };
    rm[ROW[i]] |= bit;
    cm[COL[i]] |= bit;
    bm[BOX[i]] |= bit;
  }
  let count = 0;
  let first = null;
  const rec = () => {
    let best = -1;
    let bestMask = 0;
    let bestN = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const m = ALL & ~(rm[ROW[i]] | cm[COL[i]] | bm[BOX[i]]);
      const n = POP[m];
      if (n < bestN) {
        best = i;
        bestMask = m;
        bestN = n;
        if (n <= 1) break;
      }
    }
    if (best < 0) {
      count++;
      if (!first) first = g.slice();
      return count >= limit;
    }
    if (bestN === 0) return false;
    const ds = digitsOf(bestMask);
    if (rng) shuffle(ds, rng);
    const r = ROW[best];
    const c = COL[best];
    const b = BOX[best];
    for (const d of ds) {
      const bit = 1 << d;
      g[best] = d;
      rm[r] |= bit;
      cm[c] |= bit;
      bm[b] |= bit;
      if (rec()) return true;
      rm[r] &= ~bit;
      cm[c] &= ~bit;
      bm[b] &= ~bit;
    }
    g[best] = 0;
    return false;
  };
  rec();
  return { count, first };
}

/** 数解，找到 limit 个就停止（判断唯一解时 limit = 2 即可） */
export function countSolutions(grid, limit = 2) {
  return search(grid, limit).count;
}

/** 返回一个解；无解返回 null */
export function solve(grid) {
  return search(grid, 1).first;
}

/** 随机生成一个完整合法的终盘 */
export function fullGrid(rng = Math.random) {
  return search(new Array(81).fill(0), 1, rng).first;
}

// ---------------------------------------------------------------- 逻辑求解器
// 状态：g 为已填数字，c 为每个空格的候选数掩码（会随排除类技巧不断缩小）
export function makeState(grid) {
  const g = Array.from(grid);
  const c = new Uint16Array(81);
  for (let i = 0; i < 81; i++) c[i] = candidatesOf(g, i);
  return { g, c };
}

function place(s, i, d) {
  s.g[i] = d;
  s.c[i] = 0;
  const bit = 1 << d;
  for (const p of PEERS[i]) s.c[p] &= ~bit;
}

export function applyStep(s, step) {
  if (step.type === 'place') place(s, step.cell, step.digit);
  else for (const { i, d } of step.elims) s.c[i] &= ~(1 << d);
}

function* combos(arr, k, start = 0, picked = []) {
  if (picked.length === k) {
    yield picked;
    return;
  }
  for (let i = start; i <= arr.length - (k - picked.length); i++) {
    picked.push(arr[i]);
    yield* combos(arr, k, i + 1, picked);
    picked.pop();
  }
}

function nakedSingle(s) {
  for (let i = 0; i < 81; i++) {
    if (!s.g[i] && POP[s.c[i]] === 1) return { type: 'place', cell: i, digit: digitsOf(s.c[i])[0] };
  }
  return null;
}

function hiddenSingle(from, to) {
  return (s) => {
    for (let u = from; u < to; u++) {
      for (let d = 1; d <= 9; d++) {
        const bit = 1 << d;
        let pos = -1;
        let n = 0;
        for (const i of UNITS[u]) {
          if (s.c[i] & bit) {
            n++;
            pos = i;
            if (n > 1) break;
          }
        }
        if (n === 1) return { type: 'place', cell: pos, digit: d, unit: u };
      }
    }
    return null;
  };
}

function lockedCandidates(s) {
  // 宫内某数字只在一行（列）上 → 该行（列）宫外排除；行（列）内某数字只在一个宫里 → 该宫行（列）外排除
  for (let u = 0; u < 27; u++) {
    for (let d = 1; d <= 9; d++) {
      const bit = 1 << d;
      const cells = UNITS[u].filter((i) => s.c[i] & bit);
      if (cells.length < 2) continue;
      const targets = [];
      if (u >= 18) {
        if (cells.every((i) => ROW[i] === ROW[cells[0]])) targets.push(ROW[cells[0]]);
        if (cells.every((i) => COL[i] === COL[cells[0]])) targets.push(9 + COL[cells[0]]);
      } else if (cells.every((i) => BOX[i] === BOX[cells[0]])) {
        targets.push(18 + BOX[cells[0]]);
      }
      for (const t of targets) {
        const elims = UNITS[t].filter((i) => !UNITS[u].includes(i) && s.c[i] & bit).map((i) => ({ i, d }));
        if (elims.length) return { type: 'elim', elims, cells, digits: [d], unit: u };
      }
    }
  }
  return null;
}

function nakedSubset(n) {
  return (s) => {
    for (let u = 0; u < 27; u++) {
      const pool = UNITS[u].filter((i) => s.c[i] && POP[s.c[i]] >= 2 && POP[s.c[i]] <= n);
      for (const set of combos(pool, n)) {
        let union = 0;
        for (const i of set) union |= s.c[i];
        if (POP[union] !== n) continue;
        const elims = [];
        for (const i of UNITS[u]) {
          if (set.includes(i) || !(s.c[i] & union)) continue;
          for (const d of digitsOf(s.c[i] & union)) elims.push({ i, d });
        }
        if (elims.length) return { type: 'elim', elims, cells: [...set], digits: digitsOf(union), unit: u };
      }
    }
    return null;
  };
}

function hiddenSubset(n) {
  return (s) => {
    for (let u = 0; u < 27; u++) {
      const unit = UNITS[u];
      const pos = {};
      const pool = [];
      for (let d = 1; d <= 9; d++) {
        let m = 0;
        unit.forEach((i, k) => {
          if (s.c[i] & (1 << d)) m |= 1 << k;
        });
        const cnt = POP[m << 1];
        if (cnt >= 2 && cnt <= n) {
          pos[d] = m;
          pool.push(d);
        }
      }
      for (const ds of combos(pool, n)) {
        let union = 0;
        let dmask = 0;
        for (const d of ds) {
          union |= pos[d];
          dmask |= 1 << d;
        }
        if (POP[union << 1] !== n) continue;
        const cells = unit.filter((_, k) => union & (1 << k));
        const elims = [];
        for (const i of cells) for (const d of digitsOf(s.c[i] & ~dmask)) elims.push({ i, d });
        if (elims.length) return { type: 'elim', elims, cells, digits: [...ds], unit: u };
      }
    }
    return null;
  };
}

function fish(size) {
  return (s) => {
    for (let d = 1; d <= 9; d++) {
      const bit = 1 << d;
      for (const [base, cross] of [[0, 9], [9, 0]]) {
        const lines = [];
        const masks = {};
        for (let l = 0; l < 9; l++) {
          let m = 0;
          UNITS[base + l].forEach((i, k) => {
            if (s.c[i] & bit) m |= 1 << k;
          });
          const cnt = POP[m << 1];
          if (cnt >= 2 && cnt <= size) {
            lines.push(l);
            masks[l] = m;
          }
        }
        for (const set of combos(lines, size)) {
          let union = 0;
          for (const l of set) union |= masks[l];
          if (POP[union << 1] !== size) continue;
          const elims = [];
          const cells = [];
          for (let k = 0; k < 9; k++) {
            if (!(union & (1 << k))) continue;
            UNITS[cross + k].forEach((i, l) => {
              if (!(s.c[i] & bit)) return;
              if (set.includes(l)) cells.push(i);
              else elims.push({ i, d });
            });
          }
          if (elims.length) return { type: 'elim', elims, cells, digits: [d] };
        }
      }
    }
    return null;
  };
}

function xyWing(s) {
  for (let pivot = 0; pivot < 81; pivot++) {
    const pm = s.c[pivot];
    if (POP[pm] !== 2) continue;
    const wings = PEERS[pivot].filter((p) => POP[s.c[p]] === 2 && POP[s.c[p] & pm] === 1);
    for (const a of wings) {
      const z = s.c[a] & ~pm;
      if (!z) continue;
      const need = (pm & ~s.c[a]) | z;
      for (const b of wings) {
        if (b === a || s.c[b] !== need) continue;
        const elims = [];
        for (let i = 0; i < 81; i++) {
          if (i !== a && i !== b && s.c[i] & z && sees(i, a) && sees(i, b)) elims.push({ i, d: digitsOf(z)[0] });
        }
        if (elims.length) return { type: 'elim', elims, cells: [pivot, a, b], digits: digitsOf(z) };
      }
    }
  }
  return null;
}

// 按从易到难排列；level 对应难度：1 简单、2 中等、3 困难、4 专家
export const TECHNIQUES = [
  { id: 'hiddenBox', name: '宫内排除法', level: 1, fn: hiddenSingle(18, 27) },
  { id: 'nakedSingle', name: '唯余法', level: 1, fn: nakedSingle },
  { id: 'hiddenRow', name: '行排除法', level: 2, fn: hiddenSingle(0, 9) },
  { id: 'hiddenCol', name: '列排除法', level: 2, fn: hiddenSingle(9, 18) },
  { id: 'locked', name: '区块排除', level: 2, fn: lockedCandidates },
  { id: 'nakedPair', name: '显性数对', level: 3, fn: nakedSubset(2) },
  { id: 'hiddenPair', name: '隐性数对', level: 3, fn: hiddenSubset(2) },
  { id: 'nakedTriple', name: '显性三链数', level: 3, fn: nakedSubset(3) },
  { id: 'hiddenTriple', name: '隐性三链数', level: 3, fn: hiddenSubset(3) },
  { id: 'xWing', name: 'X-Wing', level: 4, fn: fish(2) },
  { id: 'xyWing', name: 'XY-Wing', level: 4, fn: xyWing },
  { id: 'swordfish', name: 'Swordfish', level: 4, fn: fish(3) },
];

/** 当前状态下最简单的一步 */
export function nextStep(s) {
  for (const t of TECHNIQUES) {
    const step = t.fn(s);
    if (step) return { ...step, tech: t.id, name: t.name, level: t.level };
  }
  return null;
}

/** 只用逻辑技巧解题：solved 表示能否解完，level 为用到的最难技巧等级 */
export function rate(grid) {
  const s = makeState(grid);
  let level = 0;
  for (;;) {
    let empty = 0;
    for (let i = 0; i < 81; i++) {
      if (s.g[i]) continue;
      if (!s.c[i]) return { solved: false, level };
      empty++;
    }
    if (!empty) return { solved: true, level };
    const step = nextStep(s);
    if (!step) return { solved: false, level };
    level = Math.max(level, step.level);
    applyStep(s, step);
  }
}

/**
 * 提示：从当前盘面（只含正确数字）出发，找到下一个能确定的格子。
 * 如果需要先做排除，pre 中按顺序列出用到的排除步骤。
 */
export function findHint(grid) {
  const s = makeState(grid);
  const pre = [];
  for (let n = 0; n < 300; n++) {
    const step = nextStep(s);
    if (!step) return null;
    if (step.type === 'place') return { ...step, pre, sources: hintSources(grid, step) };
    pre.push(step);
    applyStep(s, step);
  }
  return null;
}

// 排除法的依据：区域内其他空格各找一个“看得到”的相同数字
function hintSources(grid, step) {
  if (step.unit == null) return [];
  const out = new Set();
  for (const j of UNITS[step.unit]) {
    if (j === step.cell || grid[j]) continue;
    const seen = PEERS[j].filter((p) => grid[p] === step.digit);
    if (!seen.length) continue;
    if (!seen.some((p) => out.has(p))) out.add(seen[0]);
  }
  return [...out];
}
