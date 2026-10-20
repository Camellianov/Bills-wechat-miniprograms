const api = require('../../utils/api.js')
const store = require('../../utils/store.js')
const queue = require('../../utils/queue.js')
const bus = require('../../utils/bus.js')
const fen = require('../../utils/fen.js')
const sh = require('../../utils/shanghai.js')
const emojiLib = require('../../utils/emoji.js')

// 删除键统一由 utils/fen.js 提供（此处只做透传，避免两处定义不一致）
const KB = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '.', fen.DEL]

// 记一笔页新增分类时的快捷三选：礼物 / 星星 / 花朵（完整图标库在分类管理页）
const EMOJI_CHOICES = emojiLib.QUICK

function genTxnId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

Page({
  data: {
    masked: false,
    initError: '',
    ledgerName: '',
    type: 'expense',
    categories: [],
    categoryId: '',
    currency: '¥',
    amountStr: '',
    amountText: '0.00',
    dateStr: '',
    todayStr: '',
    note: '',
    saving: false,
    pendingCount: 0,
    kbRows: KB,
    delKey: fen.DEL,

    // 新增自定义分类弹层（修改 / 删除统一在“分类管理”页）
    catDlg: false,
    catName: '',
    catEmoji: EMOJI_CHOICES[0],
    emojiChoices: EMOJI_CHOICES
  },

  onLoad() {
    this._mask = v => this.setData({ masked: v })
    this._q = n => this.setData({ pendingCount: n })
    this._sd = () => this.setData({ pendingCount: queue.count() })

    bus.on('mask', this._mask)
    bus.on('queue', this._q)
    bus.on('sync-done', this._sd)

    const todayStr = sh.todayStr()
    this.setData({
      todayStr: todayStr,
      dateStr: todayStr,
      masked: !!getApp().globalData.masked,
      pendingCount: queue.count()
    })
    this.init()
  },

  onShow() {
    this.setData({
      masked: !!getApp().globalData.masked,
      pendingCount: queue.count()
    })
    this.refreshCats()   // 从分类管理页返回后同步最新分类
    this.tryJoinInvite() // 通过分享卡片进来时无感加入账本
  },

  onUnload() {
    bus.off('mask', this._mask)
    bus.off('queue', this._q)
    bus.off('sync-done', this._sd)
  },

  async init() {
    const cached = store.getCtx()
    if (cached && cached.ledger) this.applyCtx(cached)
    this.initCtx()
  },

  async initCtx() {
    const res = await api.call('ledger', 'initUser', {})
    if (res.ok) {
      store.setCtx({ ledgerId: res.ledgerId, role: res.role, ledger: res.ledger })
      this.setData({ initError: '' })
      this.applyCtx(store.getCtx())
    } else {
      // 停留在页面上的可见错误，避免只弹一次 toast 就没了线索
      console.error('[record] initUser failed:', res)
      this.setData({ initError: api.errorText(res, '初始化失败') })
    }
  },

  onRetry() {
    this.setData({ initError: '' })
    this.initCtx()
  },

  applyCtx(ctx) {
    const ledger = (ctx && ctx.ledger) || {}
    const cats = this.filterCats(ledger.categories, this.data.type)
    this.setData({
      currency: ledger.currency || '¥',
      ledgerName: ledger.name || '家庭账本',
      categories: cats,
      categoryId: cats.length ? cats[0].id : ''
    })
  },

  filterCats(cats, type) {
    return (cats || []).filter(c => c.type === type)
  },

  refreshCats() {
    const ledger = store.getLedger()
    if (!ledger) return
    const cats = this.filterCats(ledger.categories, this.data.type)
    let id = this.data.categoryId
    if (!cats.some(c => c.id === id)) id = cats.length ? cats[0].id : ''
    this.setData({
      categories: cats,
      categoryId: id,
      ledgerName: ledger.name || '家庭账本',
      currency: ledger.currency || '¥'
    })
  },

  /** 分享卡片带入邀请码时静默加入，重建上下文 */
  async tryJoinInvite() {
    const code = wx.getStorageSync('pendingInvite')
    if (!code) return
    wx.removeStorageSync('pendingInvite')

    wx.showLoading({ title: '加入中', mask: true })
    const res = await api.call('member', 'joinLedger', { inviteCode: code })
    if (!res.ok) {
      wx.hideLoading()
      api.toastError(res)
      return
    }
    const init = await api.call('ledger', 'initUser', {})
    wx.hideLoading()
    if (init.ok) {
      store.setCtx({ ledgerId: init.ledgerId, role: init.role, ledger: init.ledger })
      this.applyCtx(store.getCtx())
    }
    wx.showToast({ title: res.alreadyMember ? '已在该账本' : '已加入', icon: 'success' })
    bus.emit('bill-changed')
  },

  onSwitchType(e) {
    const t = e.currentTarget.dataset.type
    if (t === this.data.type) return
    const cats = this.filterCats((store.getLedger() || {}).categories, t)
    this.setData({ type: t, categories: cats, categoryId: cats.length ? cats[0].id : '' })
  },

  onPickCategory(e) {
    this.setData({ categoryId: e.currentTarget.dataset.id })
  },

  onGoCats() {
    wx.navigateTo({ url: '/pages/category/category' })
  },

  onKey(e) {
    const k = e.currentTarget.dataset.k
    const next = fen.inputKey(this.data.amountStr, k)
    if (next === this.data.amountStr) return
    this.setData({ amountStr: next, amountText: fen.formatInput(next) })
  },

  onDateChange(e) {
    this.setData({ dateStr: e.detail.value })
  },

  onNoteInput(e) {
    this.setData({ note: e.detail.value })
  },

  async onSave() {
    if (this.data.saving) return
    const amountFen = fen.yuanStrToFen(this.data.amountStr)
    if (!amountFen) { wx.showToast({ title: '请输入金额', icon: 'none' }); return }
    if (!this.data.categoryId) { wx.showToast({ title: '请选择分类', icon: 'none' }); return }
    const ledgerId = store.getLedgerId()
    if (!ledgerId) { wx.showToast({ title: '账本初始化中...', icon: 'none' }); return }

    const payload = {
      clientTxnId: genTxnId(),
      ledgerId: ledgerId,
      type: this.data.type,
      amountFen: amountFen,
      categoryId: this.data.categoryId,
      note: this.data.note,
      occuredAt: sh.dateToOccuredAt(this.data.dateStr).toISOString()
    }

    this.setData({ saving: true })
    const res = await api.call('bill', 'addBill', payload)
    this.setData({ saving: false })

    if (res.ok) {
      this.setData({ amountStr: '', amountText: '0.00', note: '' })
      wx.showToast({ title: '已保存', icon: 'success' })
      bus.emit('bill-changed')
      return
    }
    if (res.code === 'NETWORK') {
      queue.enqueue(payload) // 弱网/离线先落本地，联网后自动补写
      this.setData({ amountStr: '', amountText: '0.00', note: '', pendingCount: queue.count() })
      wx.showToast({ title: '网络不可用，已存入本地待同步', icon: 'none' })
      return
    }
    api.toastError(res)
  },

  // ---- 新增自定义分类（修改 / 删除统一在“分类管理”页）----

  onAddTap() {
    this.setData({ catDlg: true, catName: '', catEmoji: EMOJI_CHOICES[0] })
  },

  onCatClose() {
    this.setData({ catDlg: false })
  },

  onCatName(e) {
    this.setData({ catName: e.detail.value })
  },

  onCatEmoji(e) {
    this.setData({ catEmoji: e.currentTarget.dataset.e })
  },

  onCatSave() {
    const name = String(this.data.catName || '').trim()
    if (!name) { wx.showToast({ title: '请输入分类名称', icon: 'none' }); return }
    const ledgerId = store.getLedgerId()
    if (!ledgerId) { wx.showToast({ title: '账本初始化中...', icon: 'none' }); return }

    wx.showLoading({ title: '保存中', mask: true })
    api.call('ledger', 'addCategory', {
      ledgerId: ledgerId,
      type: this.data.type,
      name: name,
      emoji: this.data.catEmoji
    }).then(res => {
      wx.hideLoading()
      if (!res.ok) { api.toastError(res); return }
      // 用服务端返回的最新分类刷新本地缓存（新增项排在列表末尾，即“自定义”按钮之前）
      store.updateCategories(res.categories)
      const cats = this.filterCats(res.categories, this.data.type)
      this.setData({
        categories: cats,
        categoryId: res.category.id,
        catDlg: false,
        catName: ''
      })
      wx.showToast({ title: '已添加', icon: 'success' })
    })
  },

  noop() {}
})
