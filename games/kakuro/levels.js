// 难度档位（纯数据）：size 为含提示行 / 列在内的边长；layout 只供离线出题脚本使用。
export const DIFFICULTIES = {
  easy: { name: '简单', stars: 1, size: 6, layout: { maxRun: 4, black: 0.12, minWhite: 0.55 } },
  medium: { name: '中等', stars: 2, size: 8, layout: { maxRun: 5, black: 0.14, minWhite: 0.6 } },
  hard: { name: '困难', stars: 3, size: 10, layout: { maxRun: 6, black: 0.16, minWhite: 0.6 } },
  expert: { name: '专家', stars: 4, size: 12, layout: { maxRun: 6, black: 0.17, minWhite: 0.6 } },
};
export const DIFF_IDS = Object.keys(DIFFICULTIES);
