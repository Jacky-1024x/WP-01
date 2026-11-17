// 牌面图案：筒画圆饼，条画竹节（一条是鸟），中、發照真牌写字，白板画蓝框。
// 返回 SVG 字符串，全部是本文件生成的静态内容。

const IVORY = '#fbf7ea';
const GREEN = '#15803d';
const BLUE = '#1d4ed8';
const RED = '#dc2626';
const DARK = { [GREEN]: '#0b5a2a', [BLUE]: '#173a9e', [RED]: '#9f1d1d' };

function wrap(inner) {
  return `<svg viewBox="0 0 60 80" aria-hidden="true">${inner}</svg>`;
}

function dot(cx, cy, r, color) {
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r * 0.72}" fill="${IVORY}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r * 0.5}" fill="${color}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r * 0.17}" fill="${IVORY}"/>`
  );
}

function bigDot() {
  let petals = '';
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI / 4) * i;
    const x = 30 + Math.cos(angle) * 12.5;
    const y = 40 + Math.sin(angle) * 12.5;
    petals += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2.2" fill="${IVORY}"/>`;
  }
  return (
    `<circle cx="30" cy="40" r="24" fill="${GREEN}"/>` +
    `<circle cx="30" cy="40" r="20" fill="${IVORY}"/>` +
    `<circle cx="30" cy="40" r="17" fill="${BLUE}"/>` +
    petals +
    `<circle cx="30" cy="40" r="8" fill="${RED}"/>` +
    `<circle cx="30" cy="40" r="3" fill="${IVORY}"/>`
  );
}

const DOTS = [
  null,
  [[30, 23, 12.5, GREEN], [30, 57, 12.5, BLUE]],
  [[16, 17, 10, BLUE], [30, 40, 10, RED], [44, 63, 10, GREEN]],
  [[18, 23, 11, BLUE], [42, 23, 11, GREEN], [18, 57, 11, GREEN], [42, 57, 11, BLUE]],
  [[16, 19, 9.5, BLUE], [44, 19, 9.5, GREEN], [30, 40, 9.5, RED], [16, 61, 9.5, GREEN], [44, 61, 9.5, BLUE]],
  [[18, 16, 8.5, GREEN], [42, 16, 8.5, GREEN], [18, 43, 8.5, RED], [42, 43, 8.5, RED], [18, 64, 8.5, RED], [42, 64, 8.5, RED]],
  [[13, 12, 7, GREEN], [30, 21, 7, GREEN], [47, 30, 7, GREEN], [19, 49, 8, RED], [41, 49, 8, RED], [19, 67, 8, RED], [41, 67, 8, RED]],
  [14, 32, 50, 68].flatMap((y) => [[19, y, 8, BLUE], [41, y, 8, BLUE]]),
  [[18, BLUE], [40, RED], [62, GREEN]].flatMap(([y, color]) => [[14, y, 7.5, color], [30, y, 7.5, color], [46, y, 7.5, color]]),
];

function stick(cx, cy, h, color, rotate = 0) {
  const top = cy - h / 2;
  const dark = DARK[color];
  return (
    `<g transform="rotate(${rotate} ${cx} ${cy})">` +
    `<rect x="${cx - 3.6}" y="${top}" width="7.2" height="${h}" rx="3.6" fill="${color}"/>` +
    `<rect x="${cx - 1}" y="${top + 3}" width="2" height="${h - 6}" rx="1" fill="${IVORY}" opacity=".5"/>` +
    `<rect x="${cx - 4.6}" y="${cy - 1.3}" width="9.2" height="2.6" rx="1.3" fill="${dark}"/>` +
    `<rect x="${cx - 4.2}" y="${top + 0.6}" width="8.4" height="2" rx="1" fill="${dark}"/>` +
    `<rect x="${cx - 4.2}" y="${top + h - 2.6}" width="8.4" height="2" rx="1" fill="${dark}"/>` +
    `</g>`
  );
}

function bird() {
  return (
    `<ellipse cx="17" cy="56" rx="5" ry="13" transform="rotate(48 17 56)" fill="${RED}"/>` +
    `<ellipse cx="22" cy="62" rx="5" ry="14" transform="rotate(28 22 62)" fill="${BLUE}"/>` +
    `<ellipse cx="29" cy="65" rx="4.5" ry="12" transform="rotate(8 29 65)" fill="${GREEN}"/>` +
    `<ellipse cx="34" cy="43" rx="12" ry="15" fill="${GREEN}"/>` +
    `<path d="M28 37q13 1 15 16q-12-2-15-16z" fill="${BLUE}"/>` +
    `<circle cx="39" cy="22" r="7.5" fill="${RED}"/>` +
    `<circle cx="41.5" cy="20.5" r="1.7" fill="${IVORY}"/>` +
    `<path d="M45.5 21l8 2.5-8 2.5z" fill="#d97706"/>` +
    `<path d="M31 57v11M38 57v11" stroke="${RED}" stroke-width="2.2" stroke-linecap="round"/>`
  );
}

const STICKS = [
  null,
  [[30, 23, 28, GREEN], [30, 57, 28, BLUE]],
  [[30, 23, 28, GREEN], [19, 57, 28, BLUE], [41, 57, 28, BLUE]],
  [[19, 23, 28, GREEN], [41, 23, 28, BLUE], [19, 57, 28, BLUE], [41, 57, 28, GREEN]],
  [[14, 22, 26, GREEN], [46, 22, 26, BLUE], [30, 40, 28, RED], [14, 58, 26, BLUE], [46, 58, 26, GREEN]],
  [15, 30, 45].flatMap((x) => [[x, 23, 28, GREEN], [x, 57, 28, BLUE]]),
  [[30, 14, 18, RED], ...[15, 30, 45].flatMap((x) => [[x, 41, 21, GREEN], [x, 65, 21, GREEN]])],
  [
    [13, 23, 26, GREEN, 20], [24, 23, 26, GREEN, -20], [36, 23, 26, GREEN, 20], [47, 23, 26, GREEN, -20],
    [13, 57, 26, BLUE, -20], [24, 57, 26, BLUE, 20], [36, 57, 26, BLUE, -20], [47, 57, 26, BLUE, 20],
  ],
  [17, 40, 63].flatMap((y) => [[15, y, 19, GREEN], [30, y, 19, RED], [45, y, 19, BLUE]]),
];

function honor(char, color) {
  return wrap(
    `<text x="30" y="55" text-anchor="middle" font-size="40" font-weight="900" fill="${color}" ` +
      `font-family="'Kaiti SC','STKaiti','KaiTi','Songti SC',serif">${char}</text>`,
  );
}

function build(tile) {
  if (tile < 9) {
    const rank = tile;
    if (rank === 0) return wrap(bird());
    return wrap(STICKS[rank].map(([x, y, h, c, r]) => stick(x, y, h, c, r)).join(''));
  }
  if (tile < 18) {
    const rank = tile - 9;
    if (rank === 0) return wrap(bigDot());
    return wrap(DOTS[rank].map(([x, y, r, c]) => dot(x, y, r, c)).join(''));
  }
  if (tile === 18) return honor('中', RED);
  if (tile === 19) return honor('發', GREEN);
  return wrap(
    `<rect x="12" y="14" width="36" height="52" rx="4" fill="none" stroke="${BLUE}" stroke-width="3"/>` +
      `<rect x="17.5" y="19.5" width="25" height="41" rx="2" fill="none" stroke="${BLUE}" stroke-width="1.4"/>`,
  );
}

const cache = new Map();

export function tileSvg(tile) {
  if (!cache.has(tile)) cache.set(tile, build(tile));
  return cache.get(tile);
}
