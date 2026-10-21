/**
 * 公共守卫模块（每个云函数目录各放一份副本，云开发不支持跨目录 require）
 * 数据安全底线：
 * 1. 集合权限 = 所有用户不可读写（仅云函数可读写），客户端零直连
 * 2. 云函数中所有读写必须显式带 openid / ledgerId 条件，严禁无条件全表操作
 * 3. 身份只认 cloud.getWXContext().OPENID，绝不信任客户端传入的 openid / role
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate
const crypto = require('crypto')

const MAX_LIMIT = 100
const MAX_MEMBERS = 5

function err(code, msg) {
  const e = new Error(msg || code)
  e.code = code
  return e
}

/** 识别“集合不存在”错误（控制台未建集合时云函数读写会直接失败） */
function isCollectionMissing(e) {
  const msg = String((e && e.message) || '')
  const code = String((e && e.errCode) || (e && e.code) || '')
  return /collection\s*not\s*exists/i.test(msg) || /-?50200\d/.test(msg) || /-?50200\d/.test(code)
}

function getOpenid() {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) throw err('UNAUTH', 'no openid')
  return OPENID
}

/** 核心：验证当前用户是否属于该账本（跨用户共享读写的唯一合法性依据） */
async function assertMember(ledgerId, openid) {
  if (!ledgerId || typeof ledgerId !== 'string') throw err('PARAM', 'ledgerId required')
  let r
  try {
    r = await db.collection('members')
      .where({ ledgerId, openid, status: 'active' })
      .limit(1)
      .get()
  } catch (e) {
    if (isCollectionMissing(e)) throw err('NO_COLLECTION', 'members collection not exists')
    throw e
  }
  if (!r.data.length) throw err('FORBIDDEN', 'not a member of this ledger')
  return r.data[0]
}

async function assertOwner(ledgerId, openid) {
  const m = await assertMember(ledgerId, openid)
  if (m.role !== 'owner') throw err('FORBIDDEN', 'owner only')
  return m
}

async function getLedgerOrThrow(ledgerId) {
  let r
  try {
    r = await db.collection('ledgers').doc(ledgerId).get()
  } catch (e) {
    if (isCollectionMissing(e)) throw err('NO_COLLECTION', 'ledgers collection not exists')
    throw err('NOT_FOUND', 'ledger not found')
  }
  return r.data
}

/** 金额：只允许正整数【分】，禁止浮点 */
function assertAmountFen(v) {
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0 || n > 999999999) throw err('PARAM', 'bad amountFen')
  return n
}

/** 日期：可解析 + 前后 10 年内，按 UTC 存储 */
function assertDate(v) {
  const d = v instanceof Date ? v : new Date(v)
  if (!v || isNaN(d.getTime())) throw err('PARAM', 'bad date')
  const now = Date.now()
  const span = 10 * 365 * 864e5
  if (d.getTime() < now - span || d.getTime() > now + 864e5) throw err('PARAM', 'date out of range')
  return d
}

/** ID 必须是字符串：对象 / 数组会被数据库当作查询操作符展开（如 {$ne: ''}），
 *  一旦拼进 where 条件就会命中全部文档，等同于守卫失效 */
function assertId(v, name) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(v)) {
    throw err('PARAM', 'bad ' + (name || 'id'))
  }
  return v
}

/** 文档 _id：genId() 生成的 24 位小写十六进制 */
function assertDocId(v, name) {
  if (typeof v !== 'string' || !/^[0-9a-f]{24}$/.test(v)) {
    throw err('PARAM', 'bad ' + (name || 'id'))
  }
  return v
}

/** 备注：截断 100 字，控制字符换成空格（否则会破坏 CSV 的单行结构） */
function assertNote(v) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .slice(0, 100)
}

/** 分类必须属于该账本，且 type 匹配，防止客户端传脏 categoryId */
function assertCategory(ledger, categoryId, type) {
  const cats = (ledger && ledger.categories) || []
  const hit = cats.find(c => c.id === categoryId && c.type === type)
  if (!hit) throw err('PARAM', 'bad category')
  return hit
}

function assertType(v) {
  if (v !== 'expense' && v !== 'income') throw err('PARAM', 'bad type')
  return v
}

const INVITE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ' // 剔除 0/O/1/I
function genInviteCode() {
  let s = ''
  for (let i = 0; i < 6; i++) {
    const n = crypto.randomInt
      ? crypto.randomInt(INVITE_CHARS.length)
      : crypto.randomBytes(1)[0] % INVITE_CHARS.length
    s += INVITE_CHARS[n]
  }
  return s
}

function genId() {
  return crypto.randomBytes(12).toString('hex')
}

const DEFAULT_CATEGORIES = [
  { id: 'food', name: '餐饮', emoji: '\uD83C\uDF5A', type: 'expense', sort: 1, builtin: true },
  { id: 'shopping', name: '购物', emoji: '\uD83D\uDED2', type: 'expense', sort: 2, builtin: true },
  { id: 'transport', name: '交通', emoji: '\uD83D\uDE97', type: 'expense', sort: 3, builtin: true },
  { id: 'housing', name: '居住', emoji: '\uD83C\uDFE0', type: 'expense', sort: 4, builtin: true },
  { id: 'fun', name: '娱乐', emoji: '\uD83C\uDFAE', type: 'expense', sort: 5, builtin: true },
  { id: 'medical', name: '医疗', emoji: '\u2695\uFE0F', type: 'expense', sort: 6, builtin: true },
  { id: 'education', name: '教育', emoji: '\uD83D\uDCDA', type: 'expense', sort: 7, builtin: true },
  { id: 'travel', name: '旅行', emoji: '\u2708\uFE0F', type: 'expense', sort: 8, builtin: true },
  { id: 'phone', name: '通讯', emoji: '\uD83D\uDCF1', type: 'expense', sort: 9, builtin: true },
  { id: 'salary', name: '工资', emoji: '\uD83D\uDCB0', type: 'income', sort: 10, builtin: true },
  { id: 'bonus', name: '红包', emoji: '\uD83E\uDDE7', type: 'income', sort: 11, builtin: true },
  { id: 'invest', name: '理财', emoji: '\uD83D\uDCC8', type: 'income', sort: 12, builtin: true }
]

module.exports = {
  db, _, $, crypto, MAX_LIMIT, MAX_MEMBERS, DEFAULT_CATEGORIES,
  getOpenid, assertMember, assertOwner, getLedgerOrThrow, isCollectionMissing,
  assertAmountFen, assertDate, assertNote, assertCategory, assertType,
  assertId, assertDocId,
  genInviteCode, genId, err
}
