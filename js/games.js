// 游戏清单（唯一数据源）：主页据此渲染卡片，sw.js 通过 importScripts 读取并预缓存资源。
// 保持为普通脚本（非 ES module），这样 Service Worker 也能加载。
// 新增游戏时在这里追加一项；path 相对项目根目录，files/icon 相对于 path / 根目录。
self.H5_GAMES = [
  {
    id: 'klotski',
    name: '数字华容道',
    desc: '滑动数字方块，按顺序还原。3×3 到 6×6 多种难度。',
    path: 'games/klotski/',
    icon: 'icons/klotski.svg',
    tags: ['益智', '单人'],
    files: ['index.html', 'klotski.css', 'klotski.js', 'puzzle.js'],
  },
  {
    id: 'gomoku',
    name: '五子棋',
    desc: '15×15 人机对战，三档 AI 难度，可悔棋、可选先后手。',
    path: 'games/gomoku/',
    icon: 'icons/gomoku.svg',
    tags: ['棋类', '人机'],
    files: ['index.html', 'gomoku.css', 'gomoku.js', 'ai.js', 'ai-worker.js'],
  },
];
