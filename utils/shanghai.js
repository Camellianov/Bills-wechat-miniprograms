/**
 * 时间：数据库 occurredAt 存 UTC；前端统一按 Asia/Shanghai(UTC+8，无夏令时) 展示与划月
 * 说明：不依赖设备本地时区（境外手机本地时区非 +8 会算错），统一用固定 +08:00 偏移计算
 */
const OFFSET = 8 * 3600 * 1000

function p2(n) { return String(n).padStart(2, '0') }

/** Date -> 北京时间各部分 */
function parts(d) {
  const t = new Date(new Date(d).getTime() + OFFSET)
  return {
    y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(),
    hh: t.getUTCHours(), mm: t.getUTCMinutes()
  }
}

/** 北京时间今天 "YYYY-MM-DD" */
function todayStr() {
  const t = parts(new Date())
  return `${t.y}-${p2(t.m)}-${p2(t.d)}`
}

/** "YYYY-MM-DD HH:mm" */
function fmtDateTime(d) {
  const t = parts(d)
  return `${t.y}-${p2(t.m)}-${p2(t.d)} ${p2(t.hh)}:${p2(t.mm)}`
}

/** "MM-DD HH:mm" */
function fmtShort(d) {
  const t = parts(d)
  return `${p2(t.m)}-${p2(t.d)} ${p2(t.hh)}:${p2(t.mm)}`
}

/** "YYYY年M月" */
function fmtMonth(y, m) { return `${y}年${m}月` }

/** 北京时间某天 00:00 对应的 UTC 时间点（左闭区间） */
function dayStart(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number)
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 0, 0, 0) - OFFSET)
}

/** 北京时间当月 1 号 00:00，传 m 为 1-12；m=13 表示次年 1 月 */
function monthStart(y, m) {
  return new Date(Date.UTC(y, m - 1, 1, 0, 0, 0) - OFFSET)
}

/** 北京时间自然月区间 [月初, 次月初)，用于传给云函数按 UTC 比较 */
function monthRange(y, m) {
  return { startAt: monthStart(y, m), endAt: monthStart(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1) }
}

/** 当前北京时间所在自然月区间 */
function currentMonthRange() {
  const t = parts(new Date())
  return monthRange(t.y, t.m)
}

/** 近 n 个月（含本月）的 [y,m] 列表，从旧到新 */
function recentMonths(n) {
  const t = parts(new Date())
  const arr = []
  for (let i = n - 1; i >= 0; i--) {
    const total = t.y * 12 + (t.m - 1) - i
    arr.push([Math.floor(total / 12), (total % 12) + 1])
  }
  return arr
}

/**
 * 用户选择的日期 -> occuredAt
 * 今天：用当前时刻；其它日期：北京时间当天 12:00（避开任何跨日边界）
 */
function dateToOccuredAt(dateStr) {
  if (dateStr === todayStr()) return new Date()
  const [y, m, d] = String(dateStr).split('-').map(Number)
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12, 0, 0) - OFFSET)
}

module.exports = {
  OFFSET, parts, todayStr, fmtDateTime, fmtShort, fmtMonth,
  dayStart, monthStart, monthRange, currentMonthRange, recentMonths, dateToOccuredAt
}
