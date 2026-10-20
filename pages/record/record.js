const api = require('../../utils/api.js')
const store = require('../../utils/store.js')
const queue = require('../../utils/queue.js')
const bus = require('../../utils/bus.js')
const fen = require('../../utils/fen.js')
const sh = require('../../utils/shanghai.js')

// 删除键用转义序列定义：避免在 WXML 里直接写 U+232B 导致编译失败
const DEL = '\u232b'
const KB = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '.', DEL]

// 自定义分类可选的三个 emoji：礼物 / 星星 / 花朵
const EMOJI_CHOICES = ['\uD83C\uDF81', '\u2B50', '\uD83C\uDF38']

Page({
  data: {
    masked: false,
    ready: false,
    ledgerName: '',
    roleText: '',
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
    recent: [],
    pendingCount: 0,
    kbRows: KB,
    delKey: DEL,

    // 自定义分类弹层（新增 / 修改共用）
    catDlg: false,
    catMode: 'add',
    catId: '',
    catName: '',
    catEmoji: EMOJI_CHOICES[0],
    emojiChoices: EMOJI_CHOICES
  },

  onLoad() {
    this._mask = v => this.setData({ masked: v })
    this._q    = n => this.setData({ pendingCount: n })
    this._sd   = () => this.loadRecent()

    bus.on('mask', this._mask)
    bus.on('queue', this._q)
    bus.on('sync-done', this._sd)

    const todayStr = sh.todayStr()
    this.setData({
      todayStr,
      dateStr: todayStr,
      masked: !!getApp().globalData.masked,
      recent: (store.getRecent() || []).map(b => this.toView(b)),
      pendingCount: queue.count()
    })
    this.init()
  },

  onShow() {
    this.setData({
      masked: !!getApp().globalData.masked,
      pendingCount: queue.count()
    })
  },

  refreshCats() {
    const ledger = store.getLedger()
    if (!ledger) return
    const cats = this.filterCats(ledger.categories, this.data.type)
    let id = this.data.categoryId
    if (!cats.some(c => c.id === id)) id = cats.length ? cats[0].id : ''
    this.setData({ categories: cats, categoryId: id })
  },

  onGoCats() {
    wx.navigateTo({ url: '/pages/category/category' })
  },

  onUnload() {
    bus.off('mask', this._mask)
    bus.off('queue', this._q)
    bus.off('sync-done', this._sd)
  },

  async init() {
    const cached = store.getCtx()
    if (cached && cached.ledger) this.applyCtx(cached)
    const res = await api.call('ledger', 'initUser', {})
    if (res.ok) {
      store.setCtx({ ledgerId: res.ledgerId, role: res.role, ledger: res.ledger })
      this.applyCtx(store.getCtx())
      this.loadRecent()
    } else {
      // 停留在页面上的可见错误，避免只弹一次 toast 就没了线索
      const text = api.errorText(res, '初始化失败')
      console.error('[record] initUser failed:', res)
      this.setData({ initError: text })
      wx.showToast({ title: text, icon: 'none', duration: 2500 })
    }
  },

  applyCtx(ctx) {
    const cats = (ctx.ledger.categories || []).filter(c => c.type === this.data.type)
    this.setData({
      ready: true,
      ledgerName: ctx.ledger.name || '家庭账本',
      roleText: ctx.role === 'owner' ? '房主' : '成员',
      currency: ctx.ledger.currency || '¥',
      categories: cats,
      categoryId: cats.length ? cats[0].id : ''
    })
  },

  onSwitchType(e) {
    const t = e.currentTarget.dataset.type
    if (t === this.data.type) return
    const cats = (store.getLedger() || {}).categories || []
    const filtered = cats.filter(c => c.type === t)
    this.setData({ type: t, categories: filtered, categoryId: filtered.length ? filtered[0].id : '' })
  },

  toView(b) {
    const cat = store.getCategory(b.categoryId)
    return {
      _id: b._id,
      type: b.type,
      categoryId: b.categoryId,
      emoji: cat.emoji,
      categoryName: cat.name,
      note: b.note || '',
      occuredAt: b.occuredAt,            // 原始 ISO 串，用于本地持久化与回显
      timeText: sh.fmtShort(b.occuredAt),
      amountText: fen.fen2yuan(b.amountFen),
      sign: b.type === 'income' ? '+' : '-',
      pending: !!b.pending
    }
  },

  replaceTemp(tempId, realId) {
    const list = this.data.recent.slice()
    const i = list.findIndex(x => x._id === tempId)
    if (i >= 0) list[i] = Object.assign({}, list[i], { _id: realId, pending: false })
    this.setData({ recent: list })
    this.persistRecent()
  },

  removeTemp(tempId) {
    this.setData({ recent: this.data.recent.filter(x => x._id !== tempId) })
    this.persistRecent()
  },

  persistRecent() {
    // 仅持久化已落云的非 pending 项；pending 项由 queue 持有
    const list = this.data.recent
      .filter(x => !x.pending)
      .map(x => ({
        _id: x._id,
        type: x.type,
        amountFen: fen.yuanStrToFen(x.amountText),
        categoryId: x.categoryId,
        note: x.note,
        occuredAt: x.occuredAt
      }))
    store.setRecent(list)
  },

  onPickCategory(e) {
    this.setData({ categoryId: e.currentTarget.dataset.id })
  },

  // ---- 自定义分类 ----

  onAddTap() {
    this.setData({ catDlg: true, catMode: 'add', catId: '', catName: '', catEmoji: EMOJI_CHOICES[0] })
  },

  /** 长按分类：内置与自定义均可修改/删除（删除受“已有账单”约束） */
  onCatLongPress(e) {
    const d = e.currentTarget.dataset
    wx.showActionSheet({
      itemList: ['修改分类', '删除分类'],
      success: r => {
        if (r.tapIndex === 0) {
          this.setData({
            catDlg: true,
            catMode: 'edit',
            catId: d.id,
            catName: d.name,
            catEmoji: EMOJI_CHOICES.indexOf(d.emoji) >= 0 ? d.emoji : EMOJI_CHOICES[0]
          })
        } else if (r.tapIndex === 1) {
          this.confirmDeleteCat(d.id, d.name)
        }
      },
      fail: () => {}
    })
  },

    const isEdit = this.data.catMode === 'edit'
    const payload = { ledgerId: ledgerId, type: this.data.type, name: name, emoji: this.data.catEmoji }
    if (isEdit) payload.categoryId = this.data.catId

  confirmDeleteCat(id, name) {
    wx.showModal({
      title: '删除分类',
      content: '删除后不可恢复，确认删除（' + name + '）？',
      confirmColor: '#ff5b4a',
      success: r => {
        if (!r.confirm) return
        wx.showLoading({ title: '删除中', mask: true })
        api.call('ledger', 'deleteCategory', { ledgerId: store.getLedgerId(), categoryId: id })
          .then(res => {
            wx.hideLoading()
            if (!res.ok) { api.toastError(res); return }
            store.updateCategories(res.categories)
            const cats = this.filterCats(res.categories, this.data.type)
            const cur = this.data.categoryId === id ? (cats.length ? cats[0].id : '') : this.data.categoryId
            this.setData({ categories: cats, categoryId: cur })
            wx.showToast({ title: '已删除', icon: 'success' })
          })
      }
    })
  },

  onAddClose() {
    this.setData({ adding: false })
  },

  onAddName(e) {
    this.setData({ addName: e.detail.value })
  },

  onAddEmoji(e) {
    this.setData({ addEmoji: e.currentTarget.dataset.e })
  },

  onCatSave() {
    const name = String(this.data.catName || '').trim()
    if (!name) { wx.showToast({ title: '请输入分类名称', icon: 'none' }); return }
    const ledgerId = store.getLedgerId()
    if (!ledgerId) { wx.showToast({ title: '账本初始化中...', icon: 'none' }); return }

    wx.showLoading({ title: '保存中', mask: true })
    api.call('ledger', isEdit ? 'updateCategory' : 'addCategory', payload).then(res => {
      wx.hideLoading()
      if (!res.ok) { api.toastError(res); return }
      // 用服务端返回的最新分类刷新本地缓存，新分类自动排在列表末尾（自定义按钮之前）
      store.updateCategories(res.categories)
      const cats = this.filterCats(res.categories, this.data.type)
      this.setData({
        categories: cats,
        categoryId: isEdit ? this.data.catId : res.category.id,
        catDlg: false,
        catName: ''
      })
      wx.showToast({ title: isEdit ? '已修改' : '已添加', icon: 'success' })
    })
  },

  // ---- 金额键盘 ----

  onKey(e) {
    const k = e.currentTarget.dataset.k
    const next = fen.inputKey(this.data.amountStr, k)
    if (next === this.data.amountStr) return
    const text = next ? fen.fen2yuan(fen.yuanStrToFen(next)) : '0.00'
    this.setData({ amountStr: next, amountText: text })
  },

  onDateChange(e) {
    this.setData({ dateStr: e.detail.value })
  },

  onNoteInput(e) {
    this.setData({ note: e.detail.value })
  },

  onSave() {
    const amountFen = fen.yuanStrToFen(this.data.amountStr)
    if (amountFen <= 0) { wx.showToast({ title: '请输入金额', icon: 'none' }); return }
    const ledgerId = store.getLedgerId()
    if (!ledgerId) { wx.showToast({ title: '账本初始化中...', icon: 'none' }); return }
    if (!this.data.categoryId) { wx.showToast({ title: '请选择分类', icon: 'none' }); return }
    if (this.data.saving) return

    const clientTxnId = 'c' + Date.now() + Math.random().toString(36).slice(2, 8)
    const occuredAt = sh.dateToOccuredAt(this.data.dateStr)
    const bill = {
      ledgerId,
      type: this.data.type,
      amountFen,
      categoryId: this.data.categoryId,
      note: this.data.note,
      occuredAt: occuredAt.toISOString(),
      clientTxnId
    }
    const tempId = 'tmp' + clientTxnId
    const tempView = this.toView({ ...bill, _id: tempId, pending: true })
    const next = [tempView].concat(this.data.recent).slice(0, 10)

    this.setData({ saving: true, recent: next, amountStr: '', amountText: '0.00', note: '' })

    api.call('bill', 'addBill', bill).then(res => {
      this.setData({ saving: false })
      if (res.ok) {
        this.replaceTemp(tempId, res._id)
        wx.showToast({ title: '已记账', icon: 'success' })
        bus.emit('bill-changed') // 通知账单列表刷新
      } else if (res.code === 'NETWORK') {
        // 进离线队列；recent 中的 temp 项保留 pending 标记
        queue.enqueue(bill)
        wx.showToast({ title: '已存本地，联网后同步', icon: 'none' })
        this.setData({ pendingCount: queue.count() })
      } else {
        // 服务端明确拒绝（参数/权限），移除乐观项并提示
        this.removeTemp(tempId)
        api.toastError(res)
      }
    })
  },

  async loadRecent() {
    const ledgerId = store.getLedgerId()
    if (!ledgerId) return
    const res = await api.call('bill', 'listBills', { ledgerId: ledgerId, limit: 10 })
    if (!res.ok) return
    const list = (res.list || []).map(b => this.toView(b))
    // 将未同步的 pending 项前置并去重（以 categoryId+amountFen+timeText 简单去重）
    const pending = queue.all()
    const pendingViews = pending.map(b => this.toView({
      ...b, _id: 'tmp' + b.clientTxnId, pending: true
    }))
    const seen = new Set()
    const merged = pendingViews.concat(list).filter(v => {
      const k = v._id
      if (seen.has(k)) return false
      seen.add(k); return true
    }).slice(0, 10)
    this.setData({ recent: merged })

    store.setRecent((res.list || []).slice(0, 10))
  },

  noop() {}
})
