/**
 * 金额：全程整数【分】，禁止浮点参与计算与存储
 * 展示层才转元并保留两位小数
 */

/** 删除键：由本模块统一定义，键盘与页面都用这一个（此前各处自定义导致不一致） */
const DEL = '\u232b'

/** 分 -> "12.30" */
function fen2yuan(fen) {
  const n = Number(fen) || 0
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return sign + Math.floor(abs / 100) + '.' + String(abs % 100).padStart(2, '0')
}

/** "12.3" -> 1230（纯字符串解析，不产生浮点误差） */
function yuanStrToFen(str) {
  const s = String(str || '').trim()
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return 0
  const parts = s.split('.')
  const intPart = parts[0]
  const decPart = parts[1] || ''
  const dec = (decPart + '00').slice(0, 2)
  return Number(intPart) * 100 + Number(dec)
}

/**
 * 输入串 -> 展示串（纯字符串处理，支持 "12." 这类正在输入小数的中间态）
 * 绝不经由数值转换，避免中间态被判为 0
 */
function formatInput(str) {
  let s = String(str == null ? '' : str).trim()
  if (!s) return '0.00'
  if (s.charAt(0) === '.') s = '0' + s
  const i = s.indexOf('.')
  if (i < 0) return s + '.00'
  const intPart = s.slice(0, i) || '0'
  const dec = s.slice(i + 1)
  if (dec === '') return intPart + '.'      // 刚按下小数点，整数部分保持不变
  if (dec.length === 1) return intPart + '.' + dec
  return intPart + '.' + dec.slice(0, 2)
}

/** 数字键盘输入：返回新的金额字符串，非法输入返回原值 */
function inputKey(str, key) {
  let s = String(str || '')
  if (key === 'back' || key === DEL) return s.slice(0, -1)
  if (key === '.') {
    if (!s) return '0.'
    if (s.indexOf('.') >= 0) return s
    return s + '.'
  }
  if (!/^\d$/.test(key)) return s
  if (s === '0') s = ''
  const intLen = s.indexOf('.') >= 0 ? s.split('.')[0].length : s.length
  if (intLen >= 9) return s                                  // 上限 999,999,999
  if (s.indexOf('.') >= 0 && s.split('.')[1].length >= 2) return s  // 最多两位小数
  return s + key
}

module.exports = { DEL, fen2yuan, yuanStrToFen, formatInput, inputKey }
