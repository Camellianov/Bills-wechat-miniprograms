const G = require('./guard')

exports.main = async (event) => {
  const e = event || {}
  try {
    switch (e.action) {
      case 'ping': return ping()
      case 'initUser': return await initUser(e)
      case 'listMyLedgers': return await listMyLedgers(e)
      case 'addCategory': return await addCategory(e)
      case 'updateCategory': return await updateCategory(e)
      case 'deleteCategory': return await deleteCategory(e)
      case 'restoreDefaults': return await restoreDefaults(e)
      case 'createLedger': return await createLedger(e)
      case 'switchLedger': return await switchLedger(e)
      case 'deleteLedger': return await deleteLedger(e)
      default: return { ok: false, code: 'BAD_ACTION' }
    }
  } catch (err) {
    console.error('[ledger]', e.action, err)
    return { ok: false, code: err.code || 'INTERNAL' } // 不回吐内部堆栈
  }
}

/**
 * 分类图标白名单（服务端强校验，客户端传其它 emoji 一律拒绝）
 * = 内置 12 分类图标 + 记一笔页快捷三个 + 扩展库
 * 必须与 miniprogram/utils/emoji.js 的 EMOJI_LIB 保持一致
 */
const ALLOWED_EMOJI = [
  // 内置 12 分类
  '\uD83C\uDF5A', '\uD83D\uDED2', '\uD83D\uDE97', '\uD83C\uDFE0', '\uD83C\uDFAE',
  '\u2695\uFE0F', '\uD83D\uDCDA', '\u2708\uFE0F', '\uD83D\uDCF1', '\uD83D\uDCB0',
  '\uD83E\uDDE7', '\uD83D\uDCC8',
  // 记一笔页快捷三个（礼物 / 星星 / 花朵）
  '\uD83C\uDF81', '\u2B50', '\uD83C\uDF38',
  // 扩展库
  '\uD83C\uDF5C', '\uD83C\uDF54', '\u2615', '\uD83C\uDF7A', '\uD83D\uDECD\uFE0F', '\uD83D\uDC55',
  '\uD83D\uDC84', '\uD83C\uDFE5', '\uD83D\uDC8A', '\uD83D\uDCA1', '\uD83E\uDDF9', '\uD83D\uDE95',
  '\u26FD\uFE0F', '\u270F\uFE0F', '\uD83C\uDFAC', '\uD83C\uDFB5', '\uD83D\uDC31', '\uD83C\uDF7C',
  '\uD83C\uDFAB', '\uD83C\uDFE6', '\uD83D\uDCE6', '\uD83D\uDCBC', '\uD83D\uDC8E', '\uD83E\uDDFE'
]
const MAX_CATEGORIES = 30
const MAX_LEDGERS = 10

/**
 * 账本图标颜色白名单（服务端强校验，客户端传其它颜色一律回退默认）
 * 顺序与 miniprogram/utils/colors.js 的 LEDGER_COLORS 保持一致
 */
const LEDGER_COLORS = [
  '#e54d4d', // 红
  '#34c759', // 绿
  '#2b6cff', // 蓝
  '#8e5cf6', // 紫
  '#ff7eb6', // 粉
  '#8b5e34', // 褐
  '#1a1a1a', // 黑
  '#ffffff', // 白
  '#f7c948', // 黄（默认）
  '#ff9500', // 橙
  '#8a8f99'  // 灰
]
const DEFAULT_COLOR = '#f7c948'

// ---- 分类管理 ----

/** 新增自定义分类：本账本成员均可新增，追加到数组末尾 */
async function addCategory(e) {
  const openid = G.getOpenid()
  const { ledgerId } = e

  await G.assertMember(ledgerId, openid)
  const type = G.assertType(e.type)
  const name = String(e.name || '').trim().slice(0, 8)
  if (!name) throw G.err('PARAM', 'name required')

  const emoji = String(e.emoji || '')
  if (ALLOWED_EMOJI.indexOf(emoji) < 0) throw G.err('PARAM', 'bad emoji')

  const ledger = await G.getLedgerOrThrow(ledgerId)
  const cats = ledger.categories || []
  if (cats.length >= MAX_CATEGORIES) throw G.err('LIMIT', 'too many categories')
  if (cats.some(c => c.name === name && c.type === type)) throw G.err('DUP', 'duplicate name')

  const cat = {
    id: 'c_' + G.genId().slice(0, 10),
    name: name,
    emoji: emoji,
    type: type,
    sort: cats.length + 1,
    builtin: false
  }
  const next = cats.concat([cat])

  const r = await G.db.collection('ledgers').where({ _id: ledgerId }).update({
    data: { categories: next, updatedAt: new Date() }
  })
  if (!r.stats || !r.stats.updated) throw G.err('INTERNAL', 'update failed')
  return { ok: true, category: cat, categories: next }
}

/** 修改分类：内置分类同样可改（名称 + 图标），emoji 走白名单 */
async function updateCategory(e) {
  const openid = G.getOpenid()
  const { ledgerId, categoryId } = e
  if (!categoryId) throw G.err('PARAM', 'categoryId required')

  await G.assertMember(ledgerId, openid)
  const name = String(e.name || '').trim().slice(0, 8)
  if (!name) throw G.err('PARAM', 'name required')

  const emoji = String(e.emoji || '')
  if (ALLOWED_EMOJI.indexOf(emoji) < 0) throw G.err('PARAM', 'bad emoji')

  const ledger = await G.getLedgerOrThrow(ledgerId)
  const cats = ledger.categories || []
  const i = cats.findIndex(c => c.id === categoryId)
  if (i < 0) throw G.err('NOT_FOUND', 'category not found')

  if (cats.some((c, idx) => idx !== i && c.name === name && c.type === cats[i].type)) {
    throw G.err('DUP', 'duplicate name')
  }

  const next = cats.slice()
  next[i] = Object.assign({}, cats[i], { name: name, emoji: emoji })
  const r = await G.db.collection('ledgers').where({ _id: ledgerId }).update({
    data: { categories: next, updatedAt: new Date() }
  })
  if (!r.stats || !r.stats.updated) throw G.err('INTERNAL', 'update failed')
  return { ok: true, category: next[i], categories: next }
}

/** 删除分类：内置分类同样可删，但已产生账单的分类一律拒绝，避免账单变成孤儿 */
async function deleteCategory(e) {
  const openid = G.getOpenid()
  const { ledgerId, categoryId } = e
  if (!categoryId) throw G.err('PARAM', 'categoryId required')

  await G.assertMember(ledgerId, openid)
  const ledger = await G.getLedgerOrThrow(ledgerId)
  const cats = ledger.categories || []
  const i = cats.findIndex(c => c.id === categoryId)
  if (i < 0) throw G.err('NOT_FOUND', 'category not found')

  const used = await G.db.collection('bills')
    .where({ ledgerId: ledgerId, categoryId: categoryId })
    .limit(1)
    .get()
  if (used.data.length) throw G.err('IN_USE', 'category in use')

  const next = cats.filter(c => c.id !== categoryId)
  const r = await G.db.collection('ledgers').where({ _id: ledgerId }).update({
    data: { categories: next, updatedAt: new Date() }
  })
  if (!r.stats || !r.stats.updated) throw G.err('INTERNAL', 'update failed')
  return { ok: true, categories: next }
}

/**
 * 恢复内置默认分类：按内置模板补齐数量、重置名称与图标
 * 只动内置分类（builtin:true），用户自定义分类原样保留
 */
async function restoreDefaults(e) {
  const openid = G.getOpenid()
  const { ledgerId } = e
  await G.assertMember(ledgerId, openid)
  const type = e.type === 'expense' || e.type === 'income' ? e.type : null // 不传则恢复全部

  const ledger = await G.getLedgerOrThrow(ledgerId)
  const cats = (ledger.categories || []).slice()

  const templates = G.DEFAULT_CATEGORIES.filter(c => !type || c.type === type)
  templates.forEach(t => {
    const i = cats.findIndex(c => c.id === t.id)
    if (i >= 0) {
      // 已存在：重置为默认名称 / 图标 / 排序，并恢复内置标记
      cats[i] = Object.assign({}, cats[i], {
        name: t.name, emoji: t.emoji, type: t.type, sort: t.sort, builtin: true
      })
    } else {
      cats.push(Object.assign({}, t)) // 被删掉的：按原 id 补回，账单引用自动恢复
    }
  })

  // 内置分类按 sort 排在前，自定义分类保持原有相对顺序
  const builtin = cats.filter(c => c.builtin).sort((a, b) => (a.sort || 0) - (b.sort || 0))
  const custom = cats.filter(c => !c.builtin)
  const next = builtin.concat(custom)

  const r = await G.db.collection('ledgers').where({ _id: ledgerId }).update({
    data: { categories: next, updatedAt: new Date() }
  })
  if (!r.stats || !r.stats.updated) throw G.err('INTERNAL', 'update failed')
  return { ok: true, categories: next, restored: templates.length }
}

// ---- 账本管理 ----

/** 环境自检：返回云函数实际所在的环境 ID，用于和 app.js 填写的 env 对比 */
function ping() {
  return {
    ok: true,
    pong: true,
    env: process.env.TCB_ENV || process.env.SCF_NAMESPACE || '',
    time: new Date().toISOString()
  }
}

/** 首次进入：无感创建默认账本 + 内置 12 分类 + owner 成员（幂等） */
async function initUser() {
  const openid = G.getOpenid()

  let m
  try {
    m = await G.db.collection('members').where({ openid, status: 'active' }).limit(G.MAX_LIMIT).get()
  } catch (e) {
    // 最常见故障：控制台尚未创建 members 集合
    if (G.isCollectionMissing(e)) throw G.err('NO_COLLECTION', 'members collection not exists')
    throw e
  }
  if (m.data.length) return { ok: true, fresh: false, ...(await buildContext(openid, m.data)) }

  // 事务防并发重复创建；_id 自行生成，避免依赖事务内 add 的返回值
  try {
    await G.db.runTransaction(async tx => {
      const exist = await tx.collection('members').where({ openid, status: 'active' }).limit(1).get()
      if (exist.data.length) return // 已存在，直接退出事务
      const now = new Date()
      const ledgerId = G.genId()
      await tx.collection('ledgers').add({
        data: {
          _id: ledgerId,
          name: '家庭账本',
          ownerOpenid: openid,
          iconColor: DEFAULT_COLOR,
          inviteCode: G.genInviteCode(),
          inviteCodeUpdatedAt: now,
          currency: '\uFFE5',
          monthlyBudgetFen: null,
          categories: G.DEFAULT_CATEGORIES,
          createdAt: now,
          updatedAt: now
        }
      })
      await tx.collection('members').add({
        data: {
          _id: G.genId(),
          ledgerId,
          openid,
          role: 'owner',
          nickname: '',
          isCurrent: true,
          status: 'active',
          joinedAt: now,
          createdAt: now
        }
      })
    })
  } catch (txErr) {
    console.error('[ledger] initUser tx', txErr)
    if (G.isCollectionMissing(txErr)) throw G.err('NO_COLLECTION', 'collection not exists')
  }

  m = await G.db.collection('members').where({ openid, status: 'active' }).limit(G.MAX_LIMIT).get()
  if (!m.data.length) throw G.err('INTERNAL', 'init failed')
  return { ok: true, fresh: true, ...(await buildContext(openid, m.data)) }
}

async function listMyLedgers() {
  const openid = G.getOpenid()
  const m = await G.db.collection('members').where({ openid, status: 'active' }).limit(G.MAX_LIMIT).get()
  return { ok: true, ...(await buildContext(openid, m.data)) }
}

/** 取出当前用户全部有效成员关系，供上下文重建 */
async function myMembers(openid) {
  return (await G.db.collection('members')
    .where({ openid, status: 'active' })
    .limit(G.MAX_LIMIT)
    .get()).data
}

/** 把某账本设为当前：先清掉其它账本的 isCurrent，再置位（均带 openid 条件） */
async function setCurrent(openid, ledgerId) {
  await G.db.collection('members')
    .where({ openid, ledgerId: G._.neq(ledgerId), isCurrent: true })
    .update({ data: { isCurrent: false } })
  await G.db.collection('members')
    .where({ openid, ledgerId })
    .update({ data: { isCurrent: true } })
}

/** 新建账本：创建者为 owner，并自动切换为当前账本 */
async function createLedger(e) {
  const openid = G.getOpenid()
  const name = String(e.name || '').trim().slice(0, 12) || '新账本'
  const color = LEDGER_COLORS.indexOf(String(e.iconColor || '')) >= 0 ? String(e.iconColor) : DEFAULT_COLOR

  const mine = await myMembers(openid)
  if (mine.length >= MAX_LEDGERS) throw G.err('LIMIT_LEDGER', 'too many ledgers')

  const now = new Date()
  const ledgerId = G.genId()
  await G.db.collection('ledgers').add({
    data: {
      _id: ledgerId,
      name: name,
      ownerOpenid: openid,
      iconColor: color,
      inviteCode: G.genInviteCode(),
      inviteCodeUpdatedAt: now,
      currency: '\uFFE5',
      monthlyBudgetFen: null,
      categories: G.DEFAULT_CATEGORIES,
      createdAt: now,
      updatedAt: now
    }
  })
  await G.db.collection('members').add({
    data: {
      _id: G.genId(),
      ledgerId: ledgerId,
      openid: openid,
      role: 'owner',
      nickname: '',
      isCurrent: true,
      status: 'active',
      joinedAt: now,
      createdAt: now
    }
  })
  await setCurrent(openid, ledgerId)

  return { ok: true, ...(await buildContext(openid, await myMembers(openid))) }
}

/** 切换当前账本：必须先确认本人是该账本成员 */
async function switchLedger(e) {
  const openid = G.getOpenid()
  const { ledgerId } = e
  await G.assertMember(ledgerId, openid) // 非本人账本直接拒绝
  await setCurrent(openid, ledgerId)
  return { ok: true, ...(await buildContext(openid, await myMembers(openid))) }
}

/** 删除账本：仅 owner；最后一个账本不允许删除 */
async function deleteLedger(e) {
  const openid = G.getOpenid()
  const { ledgerId } = e
  const me = await G.assertMember(ledgerId, openid)
  if (me.role !== 'owner') throw G.err('FORBIDDEN', 'owner only')

  const mine = await myMembers(openid)
  if (mine.length <= 1) throw G.err('LAST_LEDGER', 'cannot delete last ledger')

  const now = new Date()
  // 1. 该账本全部成员标记移除
  await G.db.collection('members')
    .where({ ledgerId })
    .update({ data: { status: 'removed', isCurrent: false, updatedAt: now } })
  // 2. 该账本全部账单删除（按 ledgerId 分批，非全表）
  await removeBillsOfLedger(ledgerId)
  // 3. 删除账本本身
  await G.db.collection('ledgers').where({ _id: ledgerId }).remove()
  // 4. 把自己切到剩余账本中的第一个
  const rest = await myMembers(openid)
  if (rest.length) await setCurrent(openid, rest[0].ledgerId)

  return { ok: true, ...(await buildContext(openid, await myMembers(openid))) }
}

/** 分批删除账单：单次上限 100 条，循环至清空 */
async function removeBillsOfLedger(ledgerId) {
  for (let i = 0; i < 200; i++) {
    const r = await G.db.collection('bills').where({ ledgerId }).limit(100).remove()
    const n = (r && r.stats && r.stats.removed) || 0
    if (n < 100) break
  }
}

/** 统一上下文：当前账本 + 分类 + 角色 + 账本列表（不返回任何他人 openid） */
async function buildContext(openid, members) {
  const cur = members.find(x => x.isCurrent) || members[0]
  const ids = members.map(x => x.ledgerId)
  let ls
  try {
    ls = await G.db.collection('ledgers').where({ _id: G._.in(ids) }).limit(G.MAX_LIMIT).get()
  } catch (e) {
    if (G.isCollectionMissing(e)) throw G.err('NO_COLLECTION', 'ledgers collection not exists')
    throw e
  }
  const map = {}
  ls.data.forEach(l => { map[l._id] = l })
  const curLedger = map[cur.ledgerId]
  return {
    ledgerId: cur.ledgerId,
    role: cur.role,
    ledger: curLedger ? {
      _id: curLedger._id,
      name: curLedger.name,
      currency: curLedger.currency || '\uFFE5',
      monthlyBudgetFen: curLedger.monthlyBudgetFen == null ? null : curLedger.monthlyBudgetFen,
      categories: curLedger.categories || G.DEFAULT_CATEGORIES,
      iconColor: curLedger.iconColor || DEFAULT_COLOR,
      inviteCode: cur.role === 'owner' ? curLedger.inviteCode : '' // 邀请码仅 owner 可见
    } : null,
    ledgers: members.map(x => ({
      ledgerId: x.ledgerId,
      name: map[x.ledgerId] ? map[x.ledgerId].name : '账本',
      iconColor: map[x.ledgerId] ? (map[x.ledgerId].iconColor || DEFAULT_COLOR) : DEFAULT_COLOR,
      role: x.role,
      isCurrent: !!x.isCurrent
    }))
  }
}
