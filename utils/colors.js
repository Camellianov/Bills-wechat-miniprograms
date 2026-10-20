/**
 * 账本图标颜色：必须与 cloudfunctions/ledger/index.js 的 LEDGER_COLORS 保持一致
 * v = 色值（服务端校验的就是这个值），n = 中文名（仅前端展示）
 */
const LEDGER_COLORS = [
  { v: '#e54d4d', n: '红' },
  { v: '#34c759', n: '绿' },
  { v: '#2b6cff', n: '蓝' },
  { v: '#8e5cf6', n: '紫' },
  { v: '#ff7eb6', n: '粉' },
  { v: '#8b5e34', n: '褐' },
  { v: '#1a1a1a', n: '黑' },
  { v: '#ffffff', n: '白' },
  { v: '#f7c948', n: '黄' },
  { v: '#ff9500', n: '橙' },
  { v: '#8a8f99', n: '灰' }
]

const DEFAULT_COLOR = '#f7c948' // 默认黄色

module.exports = { LEDGER_COLORS, DEFAULT_COLOR }
