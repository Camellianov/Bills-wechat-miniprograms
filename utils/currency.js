/**
 * 货币符号：必须与 cloudfunctions/ledger 的 CURRENCIES 及 cloudfunctions/export 的 CURRENCIES 保持一致
 * 全部用转义序列定义，避免源文件编码差异导致与服务端白名单不匹配
 */
const CURRENCIES = [
  { v: '\uFFE5', n: '人民币' },
  { v: '$', n: '美元' },
  { v: '\u20AC', n: '欧元' },
  { v: '\u00A3', n: '英镑' },
  { v: '\u20A9', n: '韩元' },
  { v: '\u20BD', n: '卢布' }
]

const DEFAULT_CURRENCY = '\uFFE5'

module.exports = { CURRENCIES, DEFAULT_CURRENCY }
