// 密码灯纯逻辑：出题、判定、当前行编辑（选中 / 换色 / 颜色互斥）、提交与存档校验。
// 不依赖 DOM，便于测试。所有修改都直接作用于传入的 game 对象。

export const COLORS = ['R', 'O', 'Y', 'C', 'B', 'P', 'M']; // 红 橙 黄 青 蓝 紫 粉
export const SLOTS = 4;
export const ROWS = 7;
export const MODES = ['simple', 'advanced'];
export const COLOR_COUNTS = [4, 5, 6, 7];
export const DEFAULT_COLOR_COUNT = 4;

// 各颜色数量下可用的颜色：颜色少时优先选区分度高的，顺序始终与 COLORS 一致
const PALETTES = {
  4: ['R', 'Y', 'B', 'P'],
  5: ['R', 'Y', 'C', 'B', 'P'],
  6: ['R', 'O', 'Y', 'C', 'B', 'P'],
  7: COLORS,
};

export function palette(count) {
  return PALETTES[count] ?? PALETTES[DEFAULT_COLOR_COUNT];
}

export function makeAnswer(rng = Math.random, colors = COLORS) {
  const pool = [...colors];
  for (let i = 0; i < SLOTS; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, SLOTS);
}

// 逐位结果：G 颜色和位置都对，W 颜色对位置不对，K 答案中没有该颜色
export function evaluate(answer, guess) {
  const result = guess.map((c, i) => (c === answer[i] ? 'G' : answer.includes(c) ? 'W' : 'K'));
  const green = result.filter((r) => r === 'G').length;
  const white = result.filter((r) => r === 'W').length;
  return { result, green, white };
}

// 进阶模式的圆点：只给数量，绿在前、白其次、黑在最后
export function pegs(result) {
  const order = { G: 0, W: 1, K: 2 };
  return [...result].sort((a, b) => order[a] - order[b]);
}

// lastColor：全局换色位置，跨行、跨局延续
export function createGame(mode = 'simple', rng = Math.random, lastColor = null, colors = DEFAULT_COLOR_COUNT) {
  const count = COLOR_COUNTS.includes(colors) ? colors : DEFAULT_COLOR_COUNT;
  return {
    mode: MODES.includes(mode) ? mode : 'simple',
    colors: count,
    answer: makeAnswer(rng, palette(count)),
    rows: [], // 已确认的行：{ guess, result }
    current: Array(SLOTS).fill(null),
    cursor: 0,
    status: 'playing', // playing | won | lost
    lastColor: COLORS.includes(lastColor) ? lastColor : null,
  };
}

// 选中灯预选的颜色与本行其他灯相同时，返回那盏灯的下标（确认后它会熄灭），否则 -1
export function conflictIndex(game) {
  const color = game.current[game.cursor];
  if (!color) return -1;
  return game.current.findIndex((c, i) => i !== game.cursor && c === color);
}

// 确认选中灯的颜色：撞色的灯熄灭。返回熄灭的灯的下标，没有则 -1
export function confirmCurrent(game) {
  const i = conflictIndex(game);
  if (i >= 0) game.current[i] = null;
  return i;
}

// 已亮的灯从自身颜色往下换；熄灭的灯从全局换色位置的下一个颜色开始。
// 按 COLORS 的顺序走，跳过本局没有的颜色，因此换了颜色数量也能接着循环
export function cycleColor(game) {
  if (game.status !== 'playing') return null;
  const colors = palette(game.colors);
  const from = game.current[game.cursor] ?? game.lastColor;
  let i = from ? COLORS.indexOf(from) : -1;
  do i = (i + 1) % COLORS.length;
  while (!colors.includes(COLORS[i]));
  const next = COLORS[i];
  game.current[game.cursor] = next;
  game.lastColor = next;
  return next;
}

// 先确认当前灯，再选中第 index 盏。返回 { cleared }；点击已选中的灯返回 null
export function selectSlot(game, index) {
  if (game.status !== 'playing' || index === game.cursor || index < 0 || index >= SLOTS) return null;
  const cleared = confirmCurrent(game);
  game.cursor = index;
  return { cleared };
}

export function nextSlot(game) {
  if (game.status !== 'playing') return null;
  const cleared = confirmCurrent(game);
  game.cursor = (game.cursor + 1) % SLOTS;
  return { cleared };
}

// 按当前看到的灯判断（含尚未确认的预选颜色）
export function allLit(game) {
  return game.current.every(Boolean);
}

// 先确认当前灯；4 盏全亮才提交。提交后不可撤销，重复的猜测也照常消耗一行
export function submit(game) {
  if (game.status !== 'playing') return { ok: false, cleared: -1 };
  const cleared = confirmCurrent(game);
  if (!allLit(game)) return { ok: false, cleared };
  const guess = [...game.current];
  const { result, green } = evaluate(game.answer, guess);
  game.rows.push({ guess, result });
  if (green === SLOTS) game.status = 'won';
  else if (game.rows.length >= ROWS) game.status = 'lost';
  game.current = Array(SLOTS).fill(null);
  game.cursor = 0;
  return { ok: true, cleared, result, status: game.status };
}

const isDistinct = (arr) => new Set(arr).size === arr.length;

// 校验并还原存档，数据不合法时返回 null。没有 colors 字段的旧存档都是 7 色
export function restoreGame(data) {
  try {
    const { mode, answer, rows, current, cursor, status, lastColor, colors = 7 } = data;
    if (!MODES.includes(mode) || !COLOR_COUNTS.includes(colors)) return null;
    const isColor = (c) => palette(colors).includes(c);
    if (!Array.isArray(answer) || answer.length !== SLOTS || !answer.every(isColor) || !isDistinct(answer)) return null;
    if (!Array.isArray(rows) || rows.length > ROWS) return null;
    for (const r of rows) {
      if (!Array.isArray(r.guess) || r.guess.length !== SLOTS || !r.guess.every(isColor) || !isDistinct(r.guess)) return null;
    }
    const game = {
      mode,
      colors,
      answer: [...answer],
      rows: rows.map((r) => ({ guess: [...r.guess], result: evaluate(answer, r.guess).result })),
      current: Array(SLOTS).fill(null),
      cursor: 0,
      status: 'playing',
      lastColor: COLORS.includes(lastColor) ? lastColor : null,
    };
    const won = game.rows.findIndex((r) => r.result.every((x) => x === 'G'));
    if (won >= 0 && won !== game.rows.length - 1) return null;
    if (won >= 0) game.status = 'won';
    else if (game.rows.length === ROWS) game.status = 'lost';
    if (game.status !== status) return null;
    if (game.status === 'playing') {
      if (Array.isArray(current) && current.length === SLOTS && current.every((c) => c === null || isColor(c))) {
        game.current = [...current];
      }
      if (Number.isInteger(cursor) && cursor >= 0 && cursor < SLOTS) game.cursor = cursor;
    }
    return game;
  } catch {
    return null;
  }
}
