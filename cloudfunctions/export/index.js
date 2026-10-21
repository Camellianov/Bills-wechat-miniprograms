const cloud = require('wx-server-sdk')
const G = require('./guard')

// 北京时间偏移（导出文件里的时间一律按 +08:00 展示，与前端一致）
const OFFSET = 8 * 3600 * 1000

// 货币符号白名单（必须与 utils/currency.js 的 CURRENCIES 保持一致）
const CURRENCIES = ['\uFFE5', '$', '\u20AC', '\u00A3', '\u20A9', '\u20BD']
const DEFAULT_CURRENCY = '\uFFE5'

const MAX_PAGES = 100       // 最多翻 100 页
const PAGE_SIZE = 100       // 每页 100 条 -> 上限 10000 笔
const MAX_BILLS = 10000     // 单次导出的账单条数上限，超出请缩小日期范围
const KEEP_DAYS = 7         // 导出文件在云存储的保留天数（前端告知用户）

exports.main = async (event) => {
  const e = event || {}
  try {
    switch (e.action) {
      case 'ping': return ping()
      case 'exportLedger': return await exportLedger(e)
      default: return { ok: false, code: 'BAD_ACTION' }
    }
  } catch (err) {
    console.error('[export]', e.action, err)
    return { ok: false, code: err.code || 'INTERNAL' } // 不回吐内部堆栈
  }
}

function ping() {
  return {
    ok: true,
    pong: true,
    env: process.env.TCB_ENV || process.env.SCF_NAMESPACE || '',
    time: new Date().toISOString()
  }
}

/** 导出本账本账单为 CSV（UTF-8 BOM，Excel 直接打开不乱码） */
async function exportLedger(e) {
  const openid = G.getOpenid()
  const { ledgerId } = e

  await G.assertMember(ledgerId, openid)          // 唯一的权限依据
  const ledger = await G.getLedgerOrThrow(ledgerId)

  const w = { ledgerId }
  if (e.startAt || e.endAt) {
    // 只传一头也要生效：起始/结束单独成立
    const conds = []
    if (e.startAt) conds.push(G._.gte(new Date(e.startAt)))
    if (e.endAt) conds.push(G._.lt(new Date(e.endAt)))
    w.occuredAt = conds.length === 1 ? conds[0] : G._.and(conds)
  }

  // 先估量再导出：数据过多会让小程序卡死，直接拦下让前端缩小范围
  const total = (await G.db.collection('bills').where(w).count()).total
  if (total > MAX_BILLS) throw G.err('TOO_MANY', 'too many bills to export')

  // 分页取全量（skip 翻页，导出非高频操作，接受这个开销）
  const bills = []
  for (let i = 0; i < MAX_PAGES; i++) {
    const r = await G.db.collection('bills')
      .where(w)
      .orderBy('occuredAt', 'asc')
      .skip(bills.length)
      .limit(PAGE_SIZE)
      .get()
    bills.push.apply(bills, r.data)
    if (r.data.length < PAGE_SIZE) break
  }
  if (!bills.length) throw G.err('NO_DATA', 'no bills to export')

  const currency = CURRENCIES.indexOf(ledger.currency) >= 0 ? ledger.currency : DEFAULT_CURRENCY
  const cats = ledger.categories || []
  const csv = toCsv(ledger, cats, bills, currency)

  // 文件路径带 openid 前缀，避免越权猜到他人文件
  const now = new Date()
  // 有日期范围时文件名体现范围：结束时间前端传来的是“次日零点”，减 1 秒才能显示成当天
  const stamp = (e.startAt || e.endAt)
    ? (e.startAt ? fmt(new Date(e.startAt), '') : 'start') + '_' +
      (e.endAt ? fmt(new Date(new Date(e.endAt).getTime() - 1000), '') : 'now')
    : fmt(now, '') + fmtTime(now)
  const cloudPath = 'exports/' + openid + '/' + now.getTime() + '.csv'
  const up = await cloud.uploadFile({
    cloudPath: cloudPath,
    fileContent: Buffer.from(csv, 'utf8')
  })

  return {
    ok: true,
    fileID: up.fileID,
    fileName: (ledger.name || '账本') + '-' + stamp + '.csv',
    count: bills.length,
    keepDays: KEEP_DAYS
  }
}

/** 拼 CSV：字段统一加引号转义，避免备注里的逗号/换行破坏结构 */
function toCsv(ledger, cats, bills, currency) {
  const rows = [['日期', '类型', '分类', '金额(' + currency + ')', '备注']]

  let expenseFen = 0
  let incomeFen = 0
  bills.forEach(b => {
    const cat = cats.find(c => c.id === b.categoryId)
    if (b.type === 'expense') expenseFen += b.amountFen
    else incomeFen += b.amountFen
    rows.push([
      fmt(new Date(b.occuredAt), '-'),
      b.type === 'expense' ? '支出' : '收入',
      cat ? cat.name : '其他',
      String(b.amountFen / 100),
      b.note || ''
    ])
  })

  rows.push([])
  rows.push(['支出合计', '', '', String(expenseFen / 100), ''])
  rows.push(['收入合计', '', '', String(incomeFen / 100), ''])
  rows.push(['结余', '', '', String((incomeFen - expenseFen) / 100), ''])

  const body = rows.map(cols => cols.map(esc).join(',')).join('\r\n')
  return '\uFEFF' + body // BOM：Excel 打开中文不乱码
}

function esc(v) {
  const s = String(v == null ? '' : v)
  return '"' + s.replace(/"/g, '""') + '"'
}

function parts(d) {
  const t = new Date(new Date(d).getTime() + OFFSET)
  return {
    y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(),
    hh: t.getUTCHours(), mm: t.getUTCMinutes(), ss: t.getUTCSeconds()
  }
}

function p2(n) { return String(n).padStart(2, '0') }

/** "YYYY-MM-DD" */
function fmt(d, sep) {
  const t = parts(d)
  return t.y + sep + p2(t.m) + sep + p2(t.d)
}

/** "HHmmss" */
function fmtTime(d) {
  const t = parts(d)
  return p2(t.hh) + p2(t.mm) + p2(t.ss)
}
