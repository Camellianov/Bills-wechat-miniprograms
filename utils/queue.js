/**
 * 弱网/离线队列：地铁、电梯里先落本地，联网后由云函数批量补写
 * 每条带 clientTxnId，云函数侧幂等去重，重放不会产生重复账单
 */
const bus = require('./bus.js')
const api = require('./api.js')
const store = require('./store.js')

const KEY = 'pendingBills'
const BATCH = 20

function all() {
  return wx.getStorageSync(KEY) || []
}

function save(list) {
  wx.setStorageSync(KEY, list || [])
  bus.emit('queue', (list || []).length)
}

function count() {
  return all().length
}

function enqueue(bill) {
  const list = all()
  list.push(bill)
  save(list)
  return list.length
}

function remove(txnIds) {
  save(all().filter(b => txnIds.indexOf(b.clientTxnId) < 0))
}

function netOk() {
  return new Promise(resolve => {
    wx.getNetworkType({
      success: r => resolve(r.networkType !== 'none'),
      fail: () => resolve(false)
    })
  })
}

let syncing = false

/** 联网后批量同步；失败保留队列，参数错误（服务端明确拒绝）则丢弃并提示 */
async function syncAll() {
  const list = all()
  if (!list.length) return { ok: true, synced: 0 }
  if (!(await netOk())) return { ok: false, code: 'NETWORK' }
  const ledgerId = store.getLedgerId()
  if (!ledgerId) return { ok: false, code: 'NO_LEDGER' }
  if (syncing) return { ok: false, code: 'SYNCING' }

  syncing = true
  try {
    const batch = list.slice(0, BATCH)
    const res = await api.call('bill', 'syncPending', { ledgerId: ledgerId, bills: batch })
    if (!res.ok) {
      syncing = false
      return res
    }
    const done = []
    const dropped = []
    ;(res.results || []).forEach((r, i) => {
      const txnId = batch[i] && batch[i].clientTxnId
      if (r.ok) done.push(txnId)
      else if (r.code !== 'NETWORK' && r.code !== 'INTERNAL') dropped.push(txnId) // 参数错误不再重试
    })
    remove(done.concat(dropped))
    syncing = false
    bus.emit('sync-done', { synced: done.length, dropped: dropped.length, left: count() })
    return { ok: true, synced: done.length, dropped: dropped.length, left: count() }
  } catch (e) {
    syncing = false
    return { ok: false, code: 'NETWORK' }
  }
}

module.exports = { all, count, enqueue, remove, save, syncAll }
