// 38 个传统布局，按最少步数升序排列（相同步数保持布局集原有顺序）。
// layout：5 行 × 4 列，用 / 分隔；同一字母为一枚棋子，C 为曹操，. 为空格（格式见 PRD 2.5）。
// min：最少步数（同一棋子的一次连续移动算 1 步），由 tests/huarong.mjs 用求解器逐关验证。

export const LEVELS_VERSION = 1;

export const CHAPTERS = [
  { name: '入门', maxMin: 40 },
  { name: '进阶', maxMin: 70 },
  { name: '困难', maxMin: 90 },
  { name: '大师', maxMin: Infinity },
];

export const LEVELS = [
  { id: 'qianhu', name: '前呼后拥', min: 22, layout: 'abCC/ccCC/ddee/ffgg/..hi' },
  { id: 'biyi', name: '比翼横空', min: 28, layout: 'aaCC/bbCC/ccdd/e.fg/h.ig' },
  { id: 'jiezu', name: '捷足先登', min: 32, layout: 'aCCb/cCCd/.ee./fghi/fghi' },
  { id: 'yongchuang', name: '勇闯五关', min: 34, layout: 'aCCb/cCCd/eeff/gghh/.ii.' },
  { id: 'binglin', name: '兵临曹营', min: 34, layout: 'aCCb/cCCd/effg/ehig/.hi.' },
  { id: 'wujiang', name: '五将逼宫', min: 36, layout: 'aabb/cCCd/cCCd/effg/h..i' },
  { id: 'shunfeng', name: '一路顺风', min: 39, layout: 'aCCb/aCCc/deef/dghf/.ih.' },
  { id: 'sijiang', name: '四将连关', min: 39, layout: 'CCaa/CCbb/cdee/cdfg/h..i' },
  { id: 'dusai', name: '堵塞要道', min: 40, layout: 'aCCb/cCCd/efgg/efhh/.ii.' },
  { id: 'qiandang', name: '前挡后阻', min: 42, layout: 'CCaa/CCbc/debf/degh/.ii.' },
  { id: 'yusheng', name: '雨声淅沥', min: 47, layout: 'aCCb/aCCc/deef/dg.f/hg.i' },
  { id: 'zuoyou', name: '左右布兵', min: 54, layout: 'aCCb/cCCd/efgh/efgh/.ii.' },
  { id: 'simian', name: '四面楚歌', min: 56, layout: 'abcd/aCCd/eCCf/ghhf/g..i' },
  { id: 'jinjun', name: '一路进军', min: 58, layout: 'aCCb/aCCc/defg/defh/.ii.' },
  { id: 'qitou', name: '齐头并进', min: 60, layout: 'aCCb/aCCb/cdef/ghhi/g..i' },
  { id: 'weier', name: '围而不歼', min: 62, layout: 'aCCb/aCCc/deef/dghi/.gh.' },
  { id: 'chachi', name: '插翅难飞', min: 62, layout: 'aCCb/aCCc/ddef/ghhi/g..i' },
  { id: 'zhihui', name: '指挥若定', min: 70, layout: 'aCCb/aCCb/cdde/fghi/f..i' },
  { id: 'taohua', name: '桃花园中', min: 70, layout: 'aCCb/cCCd/cefd/gefh/.ii.' },
  { id: 'tunbing', name: '屯兵东路', min: 71, layout: 'CCab/CCab/ccde/fghi/fg..' },
  { id: 'jiangyong', name: '将拥曹营', min: 72, layout: '.CC./aCCb/acdb/ecdf/gghi' },
  { id: 'bingfen', name: '兵分三路', min: 72, layout: 'aCCb/cCCd/ceed/fghi/f..i' },
  { id: 'shuangjiang', name: '双将挡路', min: 73, layout: 'aCCb/aCCc/deef/dggf/h..i' },
  { id: 'jiadao', name: '夹道藏兵', min: 75, layout: 'CCab/CCcb/ddee/ffgg/h..i' },
  { id: 'silu', name: '四路进兵', min: 77, layout: 'aCCb/cCCd/e.ff/e.gg/hhii' },
  { id: 'shuixie', name: '水泄不通', min: 79, layout: 'aCCb/aCCc/ddee/ffgg/h..i' },
  { id: 'hengdao', name: '横刀立马', min: 81, layout: 'aCCb/aCCb/cdde/cfge/h..i' },
  { id: 'shoukou', name: '守口如瓶', min: 81, layout: 'aCCb/aCCb/cd.e/fd.g/hhii' },
  { id: 'hengma', name: '横马当关', min: 83, layout: 'aCCb/aCCb/ccdd/ef.g/hf.i' },
  { id: 'bingdang', name: '兵挡将阻', min: 87, layout: 'aCCb/cCCb/deef/dggh/.ii.' },
  { id: 'rudi', name: '入地无门', min: 87, layout: 'aCCb/aCCc/deef/gghh/.ii.' },
  { id: 'cengluan', name: '层峦叠嶂', min: 98, layout: 'aCCb/aCCb/cdde/ffgg/h..i' },
  { id: 'jinzai', name: '近在咫尺', min: 98, layout: 'abcd/ebcd/ffgh/iiCC/..CC' },
  { id: 'shoukou2', name: '守口如瓶（二）', min: 99, layout: 'aCCb/cCCd/ce.d/fe.g/hhii' },
  { id: 'cengceng', name: '层层设防', min: 102, layout: 'aCCb/aCCb/cdde/fggh/.ii.' },
  { id: 'wengzhong', name: '瓮中之鳖', min: 103, layout: 'aCCb/aCCb/ccdd/effg/h..i' },
  { id: 'cengceng2', name: '层层设防（二）', min: 120, layout: 'aCCb/cCCd/ceed/fggh/.ii.' },
  { id: 'fenghui', name: '峰回路转', min: 138, layout: 'abcd/CCed/CCef/.ggf/.hii' },
];

export function chapterOf(level) {
  return CHAPTERS.findIndex((c) => level.min <= c.maxMin);
}
