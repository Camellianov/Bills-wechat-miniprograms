/**
 * 分类图标库：必须与 cloudfunctions/ledger/index.js 的 ALLOWED_EMOJI 保持一致
 * 全部用转义序列定义，避免源文件编码差异导致与服务端白名单不匹配
 */

/** 完整图标库（分类管理页用） */
const EMOJI_LIB = [
  // 内置 12 分类
  '\uD83C\uDF5A', '\uD83D\uDED2', '\uD83D\uDE97', '\uD83C\uDFE0', '\uD83C\uDFAE', '\u2695\uFE0F',
  '\uD83D\uDCDA', '\u2708\uFE0F', '\uD83D\uDCF1', '\uD83D\uDCB0', '\uD83E\uDDE7', '\uD83D\uDCC8',
  // 记一笔页快捷三个（礼物 / 星星 / 花朵）
  '\uD83C\uDF81', '\u2B50', '\uD83C\uDF38',
  // 扩展库
  '\uD83C\uDF5C', '\uD83C\uDF54', '\u2615', '\uD83C\uDF7A', '\uD83D\uDECD\uFE0F', '\uD83D\uDC55',
  '\uD83D\uDC84', '\uD83C\uDFE5', '\uD83D\uDC8A', '\uD83D\uDCA1', '\uD83E\uDDF9', '\uD83D\uDE95',
  '\u26FD\uFE0F', '\u270F\uFE0F', '\uD83C\uDFAC', '\uD83C\uDFB5', '\uD83D\uDC31', '\uD83C\uDF7C',
  '\uD83C\uDFAB', '\uD83C\uDFE6', '\uD83D\uDCE6', '\uD83D\uDCBC', '\uD83D\uDC8E', '\uD83E\uDDFE'
]

/** 记一笔页新增分类时的快捷三选（礼物 / 星星 / 花朵） */
const QUICK = ['\uD83C\uDF81', '\u2B50', '\uD83C\uDF38']

module.exports = { EMOJI_LIB, QUICK }
