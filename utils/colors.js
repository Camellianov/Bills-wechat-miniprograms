/**
 * 账本图标颜色：必须与 cloudfunctions/ledger/index.js 的 LEDGER_COLORS 保持一致
 * v = 色值（服务端校验的就是这个值），n = 中文名（仅前端展示）
 * 全部取低饱和莫兰迪色：保留账本间的标识区分度，不参与界面的高饱和堆砌
 */
const LEDGER_COLORS = [
  { v: '#c98a8a', n: '红' },
  { v: '#8fb394', n: '绿' },
  { v: '#9db9d9', n: '蓝' },
  { v: '#a89bc4', n: '紫' },
  { v: '#d4a8bd', n: '粉' },
  { v: '#a89078', n: '褐' },
  { v: '#4a4a4a', n: '黑' },
  { v: '#ffffff', n: '白' },
  { v: '#d9c48a', n: '黄' },
  { v: '#d4a373', n: '橙' },
  { v: '#a8adb5', n: '灰' }
]

const DEFAULT_COLOR = '#d9c48a' // 默认低饱和黄

/**
 * 环形图取色顺序：与账本图标共用同一套莫兰迪色，色相各异
 * 刻意把暖冷深浅交错排列（红→蓝→黄→绿→紫→橙→粉→黑→灰→褐），
 * 让相邻扇区在色相与明度上都能拉开差距，分类一眼可辨
 * 仍从 LEDGER_COLORS 派生，改色板时两处自动同步；白色不参与（白扇区在白色卡片上看不见）
 */
const CHART_ORDER = ['红', '蓝', '黄', '绿', '紫', '橙', '粉', '黑', '灰', '褐']
const CHART_COLORS = CHART_ORDER
  .map(n => (LEDGER_COLORS.find(c => c.n === n) || {}).v)
  .filter(Boolean)

module.exports = { LEDGER_COLORS, DEFAULT_COLOR, CHART_COLORS }
