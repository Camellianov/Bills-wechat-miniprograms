/**
 * 本地轻量缓存：账本上下文（ledgerId / 分类 / 货币 / 角色 / 图标颜色）
 * 仅用于离线可用与首屏秒开，不做权限依据（权限一律云函数校验）
 */
const KEY_CTX = 'ledgerCtx'
const KEY_RECENT = 'recentBills'

function setCtx(ctx) {
  wx.setStorageSync(KEY_CTX, ctx)
  return ctx
}

function getCtx() {
  return wx.getStorageSync(KEY_CTX) || null
}

function getLedgerId() {
  const c = getCtx()
  return c ? c.ledgerId : ''
}

function getLedger() {
  const c = getCtx()
  return (c && c.ledger) || null
}

function getCategories() {
  const l = getLedger()
  return (l && l.categories) || []
}

function getCurrency() {
  const l = getLedger()
  return (l && l.currency) || '¥'
}

function getCategory(id) {
  return getCategories().find(c => c.id === id) || { id: id, name: '其他', emoji: '\u2753' }
}

/** 用服务端返回的最新分类覆盖本地缓存 */
function updateCategories(categories) {
  const c = getCtx()
  if (!c || !c.ledger) return
  c.ledger.categories = categories || []
  wx.setStorageSync(KEY_CTX, c)
  return c
}

function setRecent(list) {
  wx.setStorageSync(KEY_RECENT, list || [])
}

function getRecent() {
  return wx.getStorageSync(KEY_RECENT) || []
}

function clear() {
  wx.removeStorageSync(KEY_CTX)
  wx.removeStorageSync(KEY_RECENT)
}

module.exports = {
  setCtx, getCtx, getLedgerId, getLedger, getCategories,
  getCurrency, getCategory, updateCategories, setRecent, getRecent, clear
}
