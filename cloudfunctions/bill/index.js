const G = require('./guard')

exports.main = async (event) => {
  const e = event || {}
  try {
    switch (e.action) {
      case 'ping': return ping()
      case 'addBill': return await addBill(e)
      case 'listBills': return await listBills(e)
      case 'syncPending': return await syncPending(e)
      case 'monthSummary': return await monthSummary(e)
      case 'updateBill': return await updateBill(e)
      case 'deleteBill': return await deleteBill(e)
      case 'categoryStats': return await categoryStats(e)
      case 'monthlyTrends': return await monthlyTrends(e)
      default: return { ok: false, code: 'BAD_ACTION' }
    }
  } catch (err) {
    console.error('[bill]', e.action, err)
    return { ok: false, code: err.code || 'INTERNAL' } // 不回吐内部堆栈
  }
}

/** 环境自检：返回云函数实际所在的环境 ID，用于和 app.js 填写的 env 对比 */
function ping() {
  return {
    ok: true,
    pong: true,
    env: process.env.TCB_ENV || process.env.SCF_NAMESPACE || '',
    time: new Date().toISOString()
  }
}

/** 新增一笔：先验证当前用户是该账本成员，再校验分类/金额/日期，最后幂等写入 */
async function addBill(e) {
  const openid = G.getOpenid()
  const { ledgerId, clientTxnId } = e

  await G.assertMember(ledgerId, openid)                 // ① 成员校验（唯一的跨用户合法依据）
  const type = G.assertType(e.type)
  const amountFen = G.assertAmountFen(e.amountFen)       // ② 整数【分】
  const occuredAt = G.assertDate(e.occuredAt || new Date())
  const note = G.assertNote(e.note)

  const ledger = await G.getLedgerOrThrow(ledgerId)
  G.assertCategory(ledger, e.categoryId, type)           // ③ 分类白名单

  // ④ 幂等：离线重放不重复记账
  if (clientTxnId) {
    const dup = await G.db.collection('bills')
      .where({ ledgerId, clientTxnId: String(clientTxnId).slice(0, 64) })
      .limit(1).get()
    if (dup.data.length) return { ok: true, _id: dup.data[0]._id, duplicated: true }
  }

  const now = new Date()
  const r = await G.db.collection('bills').add({
    data: {
      _id: G.genId(),
      ledgerId,
      openid,                 // 创建者（协作时不作权限依据，仅留痕）
      updatedByOpenid: openid,
      type,
      amountFen,
      categoryId: e.categoryId,
      note,
      occuredAt,
      clientTxnId: clientTxnId ? String(clientTxnId).slice(0, 64) : null,
      createdAt: now,
      updatedAt: now
    }
  })
  return { ok: true, _id: r._id }
}

/** 账单列表：强制 ledgerId 条件 + 游标翻页 + 条数上限，永不全表扫描 */
async function listBills(e) {
  const openid = G.getOpenid()
  const { ledgerId, startAt, endAt, type, categoryId, cursor } = e

  await G.assertMember(ledgerId, openid)

  const w = { ledgerId }
  if (startAt || endAt) {
    w.occuredAt = {}
    if (startAt) w.occuredAt.$gte = new Date(startAt)
    if (endAt) w.occuredAt.$lt = new Date(endAt)
  }
  if (type) w.type = G.assertType(type)
  if (categoryId) w.categoryId = String(categoryId).slice(0, 32)
  if (cursor) w.occuredAt = Object.assign(w.occuredAt || {}, { $lt: new Date(cursor) })

  const size = Math.min(Number(e.limit) || 20, G.MAX_LIMIT)
  const res = await G.db.collection('bills').where(w)
    .orderBy('occuredAt', 'desc').orderBy('_id', 'desc')
    .limit(size).get()

  return {
    ok: true,
    list: res.data.map(b => ({
      _id: b._id,
      type: b.type,
      amountFen: b.amountFen,
      categoryId: b.categoryId,
      note: b.note,
      occuredAt: b.occuredAt,
      mine: b.openid === openid
    })),
    nextCursor: res.data.length === size ? res.data[res.data.length - 1].occuredAt : null
  }
}

/** 自然月合计：支出 / 收入 / 结余，全部整数分 */
async function monthSummary(e) {
  const openid = G.getOpenid()
  const { ledgerId } = e
  await G.assertMember(ledgerId, openid)

  // 用数据库聚合求和，避免分页上限（100 条）导致合计偏小
  const cond = { ledgerId }
  if (e.startAt || e.endAt) {
    cond.occuredAt = G._.and([
      G._.gte(new Date(e.startAt)),
      G._.lt(new Date(e.endAt))
    ])
  }

  const res = await G.db.collection('bills').aggregate()
    .match(cond)
    .group({ _id: '$type', total: G.$.sum('$amountFen') })
    .limit(2)
    .end()

  let expenseFen = 0
  let incomeFen = 0
  res.list.forEach(x => {
    if (x._id === 'expense') expenseFen = x.total
    else if (x._id === 'income') incomeFen = x.total
  })
  return { ok: true, expenseFen, incomeFen, balanceFen: incomeFen - expenseFen }
}

/** 修改一笔：update 强制带 _id + ledgerId，杜绝跨账本篡改 */
async function updateBill(e) {
  const openid = G.getOpenid()
  const { ledgerId, billId } = e
  G.assertDocId(billId, 'billId')

  await G.assertMember(ledgerId, openid)
  const type = G.assertType(e.type)
  const amountFen = G.assertAmountFen(e.amountFen)
  const occuredAt = G.assertDate(e.occuredAt)
  const note = G.assertNote(e.note)

  const ledger = await G.getLedgerOrThrow(ledgerId)
  G.assertCategory(ledger, e.categoryId, type)

  const r = await G.db.collection('bills').where({ _id: billId, ledgerId }).update({
    data: {
      type,
      amountFen,
      categoryId: e.categoryId,
      note,
      occuredAt,
      updatedByOpenid: openid,
      updatedAt: new Date()
    }
  })
  if (!r.stats || !r.stats.updated) throw G.err('NOT_FOUND', 'bill not found or no change')
  return { ok: true }
}

/** 删除一笔：同样强制带 _id + ledgerId */
async function deleteBill(e) {
  const openid = G.getOpenid()
  const { ledgerId, billId } = e
  G.assertDocId(billId, 'billId')

  await G.assertMember(ledgerId, openid)
  const r = await G.db.collection('bills').where({ _id: billId, ledgerId }).remove()
  if (!r.stats || !r.stats.removed) throw G.err('NOT_FOUND', 'bill not found')
  return { ok: true }
}

/** 分类占比（某自然月）：聚合 group by categoryId，按金额倒序 */
async function categoryStats(e) {
  const openid = G.getOpenid()
  const { ledgerId } = e
  await G.assertMember(ledgerId, openid)
  const type = G.assertType(e.type)

  // 用连续两个 match 代替 _.and：聚合管道里这样更稳，避免操作符兼容性问题
  const res = await G.db.collection('bills').aggregate()
    .match({ ledgerId: ledgerId, type: type, occuredAt: G._.gte(new Date(e.startAt)) })
    .match({ occuredAt: G._.lt(new Date(e.endAt)) })
    .group({ _id: '$categoryId', total: G.$.sum('$amountFen') })
    .limit(G.MAX_LIMIT)
    .end()

  const list = res.list.filter(x => x.total > 0)
  list.sort((a, b) => b.total - a.total)
  const totalFen = list.reduce((s, x) => s + x.total, 0)
  return { ok: true, list, totalFen }
}

/** 近 n 月趋势：每月按 type 分组求和，并行聚合 */
async function monthlyTrends(e) {
  const openid = G.getOpenid()
  const { ledgerId } = e
  await G.assertMember(ledgerId, openid)
  const months = Array.isArray(e.months) ? e.months.slice(0, 12) : []

  const tasks = months.map(m => {
    return G.db.collection('bills').aggregate()
      .match({ ledgerId: ledgerId, occuredAt: G._.gte(new Date(m.startAt)) })
      .match({ occuredAt: G._.lt(new Date(m.endAt)) })
      .group({ _id: '$type', total: G.$.sum('$amountFen') })
      .limit(2)
      .end()
      .then(r => {
        let expenseFen = 0
        let incomeFen = 0
        r.list.forEach(x => {
          if (x._id === 'expense') expenseFen = x.total
          else if (x._id === 'income') incomeFen = x.total
        })
        return { ym: m.ym, expenseFen, incomeFen }
      })
  })

  return { ok: true, list: await Promise.all(tasks) }
}

/** 离线队列批量同步：逐条走与 addBill 完全相同的校验，绝不因为是"本地数据"就放行 */
async function syncPending(e) {
  const openid = G.getOpenid()
  const bills = Array.isArray(e.bills) ? e.bills.slice(0, 20) : []
  if (!bills.length) return { ok: true, results: [] }

  const ledgerId = e.ledgerId
  await G.assertMember(ledgerId, openid)
  const ledger = await G.getLedgerOrThrow(ledgerId)

  const results = []
  for (const b of bills) {
    const txnId = b.clientTxnId ? String(b.clientTxnId).slice(0, 64) : null
    try {
      const type = G.assertType(b.type)
      const amountFen = G.assertAmountFen(b.amountFen)
      const occuredAt = G.assertDate(b.occuredAt)
      const note = G.assertNote(b.note)
      G.assertCategory(ledger, b.categoryId, type)

      if (txnId) {
        const dup = await G.db.collection('bills')
          .where({ ledgerId, clientTxnId: txnId }).limit(1).get()
        if (dup.data.length) {
          results.push({ clientTxnId: txnId, ok: true, _id: dup.data[0]._id, duplicated: true })
          continue
        }
      }
      const now = new Date()
      const r = await G.db.collection('bills').add({
        data: {
          _id: G.genId(),
          ledgerId,
          openid,
          updatedByOpenid: openid,
          type,
          amountFen,
          categoryId: b.categoryId,
          note,
          occuredAt,
          clientTxnId: txnId,
          createdAt: now,
          updatedAt: now
        }
      })
      results.push({ clientTxnId: txnId, ok: true, _id: r._id })
    } catch (err) {
      results.push({ clientTxnId: txnId, ok: false, code: err.code || 'INTERNAL' })
    }
  }
  return { ok: true, results }
}
