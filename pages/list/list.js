const api = require('../../utils/api.js')
const store = require('../../utils/store.js')
const bus = require('../../utils/bus.js')
const fen = require('../../utils/fen.js')
const sh = require('../../utils/shanghai.js')
const colors = require('../../utils/colors.js')

const PAGE_SIZE = 20

Page({
  data: {
    masked: false,
    initError: '',
    currency: '¥',
    todayStr: '',
    monthIdx: 0,                 // 0 = 本月，-1 = 上月，不允许大于 0
    monthLabel: '',
    ledgerName: '',
    ledgerIconColor: colors.DEFAULT_COLOR,
    sumExpenseText: '0.00',
    sumIncomeText: '0.00',
    sumBalanceText: '0.00',
    groups: [],
    loading: false,
    done: false,
    empty: false,

    // 月度预算进度
    hasBudget: false,
    budgetText: '',
    usedText: '',
    usedPct: 0,
    barPct: 0,
    isOver: false,
    budgetTip: '',

    // 编辑弹层
    editing: null,
    editCats: []
  },

  onLoad() {
    this._items = []
    this._cursor = null
    this._dirty = true
    this._active = false

    this._mask = v => this.setData({ masked: v })
    this._chg = () => { this._dirty = true; if (this._active) this.reload() }
    bus.on('mask', this._mask)
    bus.on('bill-changed', this._chg)
    bus.on('sync-done', this._chg)

    this.setData({
      currency: store.getCurrency(),
      todayStr: sh.todayStr(),
      masked: !!getApp().globalData.masked
    })
  },

  onShow() {
    this._active = true
    const lg = store.getLedger() || {}
    this._budgetFen = lg.monthlyBudgetFen || 0 // 预算随账本上下文刷新
    this.setData({
      masked: !!getApp().globalData.masked,
      currency: lg.currency || '¥', // 货币符号在设置页可能已改，进页面就同步
      ledgerName: lg.name || '',
      ledgerIconColor: lg.iconColor || colors.DEFAULT_COLOR
    })
    if (!store.getLedgerId()) { this.initCtx(); return }
    if (this._dirty) this.reload()
  },

  onHide() {
    this._active = false
  },

  onUnload() {
    bus.off('mask', this._mask)
    bus.off('bill-changed', this._chg)
    bus.off('sync-done', this._chg)
  },

  onGoMembers() {
    wx.navigateTo({ url: '/pages/member/member' })
  },

  onGoLedgers() {
    wx.navigateTo({ url: '/pages/ledger/ledger' })
  },

  onGoSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },

  async initCtx() {
    const res = await api.call('ledger', 'initUser', {})
    if (res.ok) {
      store.setCtx({ ledgerId: res.ledgerId, role: res.role, ledger: res.ledger })
      this.setData({ currency: store.getCurrency(), initError: '' })
      this.reload()
    } else {
      console.error('[list] initUser failed:', res)
      this.setData({ initError: api.errorText(res, '初始化失败') })
    }
  },

  onRetry() {
    this.setData({ initError: '' })
    this.initCtx()
  },

  monthOf(idx) {
    const t = sh.parts(new Date())
    const total = t.y * 12 + (t.m - 1) + idx
    return [Math.floor(total / 12), (total % 12) + 1]
  },

  onPrevMonth() {
    this.setData({ monthIdx: this.data.monthIdx - 1 }, () => this.reload())
  },

  onNextMonth() {
    if (this.data.monthIdx >= 0) return
    this.setData({ monthIdx: this.data.monthIdx + 1 }, () => this.reload())
  },

  async reload() {
    this._dirty = false
    this._items = []
    this._cursor = null
    this.setData({ groups: [], done: false, empty: false })
    const pair = this.monthOf(this.data.monthIdx)
    this.setData({ monthLabel: sh.fmtMonth(pair[0], pair[1]) })
    await this.loadSummary(pair[0], pair[1])
    await this.loadList(pair[0], pair[1])
  },

  async loadSummary(y, m) {
    const ledgerId = store.getLedgerId()
    if (!ledgerId) return
    const r = sh.monthRange(y, m)
    const res = await api.call('bill', 'monthSummary', {
      ledgerId: ledgerId,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString()
    })
    if (!res.ok) return
    this.setData({
      sumExpenseText: fen.fen2yuan(res.expenseFen || 0),
      sumIncomeText: fen.fen2yuan(res.incomeFen || 0),
      sumBalanceText: fen.fen2yuan(res.balanceFen || 0)
    })
    this.computeBudget(res.expenseFen || 0)
  },

  /** 预算进度：只对支出计，超支标红 */
  computeBudget(expenseFen) {
    const budget = this._budgetFen || 0
    if (!budget) { this.setData({ hasBudget: false }); return }

    const pct = Math.round((expenseFen / budget) * 100)
    const left = budget - expenseFen
    this.setData({
      hasBudget: true,
      budgetText: fen.fen2yuan(budget),
      usedText: fen.fen2yuan(expenseFen),
      usedPct: pct,
      barPct: Math.min(pct, 100),
      isOver: expenseFen > budget,
      budgetTip: expenseFen > budget
        ? '已超支 ' + this.data.currency + fen.fen2yuan(expenseFen - budget)
        : '剩余 ' + this.data.currency + fen.fen2yuan(left)
    })
  },

  async loadList(y, m) {
    const ledgerId = store.getLedgerId()
    if (!ledgerId || this.data.loading) return
    if (this._cursor === null && this._items.length) return // 已到底
    this.setData({ loading: true })

    const r = sh.monthRange(y, m)
    const res = await api.call('bill', 'listBills', {
      ledgerId: ledgerId,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
      limit: PAGE_SIZE,
      cursor: this._cursor || ''
    })
    if (!res.ok) {
      this.setData({ loading: false })
      api.toastError(res)
      return
    }

    const list = (res.list || []).map(b => this.toView(b))
    this._items = this._items.concat(list)
    this._cursor = res.nextCursor
    this.setData({
      groups: this.groupByDay(this._items),
      loading: false,
      done: !res.nextCursor,
      empty: this._items.length === 0
    })
  },

  /** Date -> 北京时间 "YYYY-MM-DD" */
  dayStrOf(d) {
    const t = sh.parts(d)
    const p = n => String(n).padStart(2, '0')
    return t.y + '-' + p(t.m) + '-' + p(t.d)
  },

  toView(b) {
    const cat = store.getCategory(b.categoryId)
    const inc = b.type === 'income'
    return {
      _id: b._id,
      type: b.type,
      categoryId: b.categoryId,
      amountFen: b.amountFen,
      amountText: fen.fen2yuan(b.amountFen),
      sign: inc ? '+' : '-',
      categoryName: cat.name,
      categoryEmoji: cat.emoji,
      note: b.note,
      occuredAt: b.occuredAt,
      dayText: sh.fmtShort(new Date(b.occuredAt)),
      noteOrCate: b.note || cat.name
    }
  },

  /** 按日分组：{ dayText, items, sumText } */
  groupByDay(items) {
    const map = {}
    const order = []
    items.forEach(it => {
      if (!map[it.dayText]) {
        map[it.dayText] = { dayText: it.dayText, items: [], expenseFen: 0, incomeFen: 0 }
        order.push(it.dayText)
      }
      const g = map[it.dayText]
      g.items.push(it)
      if (it.type === 'expense') g.expenseFen += it.amountFen
      else g.incomeFen += it.amountFen
    })
    return order.map(k => {
      const g = map[k]
      return {
        dayText: g.dayText,
        items: g.items,
        sumText: g.expenseFen ? '-' + this.data.currency + fen.fen2yuan(g.expenseFen)
          : '+' + this.data.currency + fen.fen2yuan(g.incomeFen)
      }
    })
  },

  onLoadMore() {
    if (this.data.done || this.data.loading) return
    const pair = this.monthOf(this.data.monthIdx)
    this.loadList(pair[0], pair[1])
  },

  // ---- 编辑 / 删除 ----

  onEditTap(e) {
    const id = e.currentTarget.dataset.id
    const raw = this._items.find(x => x._id === id)
    if (!raw) return
    const cats = (store.getCategories() || []).filter(c => c.type === raw.type)
    let categoryId = raw.categoryId
    if (!cats.some(c => c.id === categoryId)) categoryId = cats.length ? cats[0].id : ''
    this.setData({
      editing: {
        _id: raw._id,
        type: raw.type,
        categoryId: categoryId,
        amountText: raw.amountText,
        dateStr: this.dayStrOf(new Date(raw.occuredAt)),
        note: raw.note
      },
      editCats: cats
    })
  },

  onEditClose() {
    this.setData({ editing: null })
  },

  onEditType(e) {
    const type = e.currentTarget.dataset.type
    if (type === this.data.editing.type) return
    const cats = (store.getCategories() || []).filter(c => c.type === type)
    this.setData({
      'editing.type': type,
      'editing.categoryId': cats.length ? cats[0].id : '',
      editCats: cats
    })
  },

  onEditCat(e) {
    this.setData({ 'editing.categoryId': e.currentTarget.dataset.id })
  },

  onEditAmount(e) {
    const v = String(e.detail.value || '')
    if (!/^\d{0,9}(\.\d{0,2})?$/.test(v)) return
    this.setData({ 'editing.amountText': v })
  },

  onEditNote(e) {
    this.setData({ 'editing.note': e.detail.value })
  },

  onEditDate(e) {
    this.setData({ 'editing.dateStr': e.detail.value })
  },

  onEditSave() {
    const ed = this.data.editing
    const amountFen = fen.yuanStrToFen(ed.amountText)
    if (!amountFen) { wx.showToast({ title: '请输入大于 0 的金额', icon: 'none' }); return }
    if (!ed.categoryId) { wx.showToast({ title: '请选择分类', icon: 'none' }); return }

    wx.showLoading({ title: '保存中', mask: true })
    api.call('bill', 'updateBill', {
      ledgerId: store.getLedgerId(),
      billId: ed._id,
      type: ed.type,
      amountFen: amountFen,
      categoryId: ed.categoryId,
      note: ed.note,
      occuredAt: sh.dateToOccuredAt(ed.dateStr).toISOString()
    }).then(res => {
      wx.hideLoading()
      if (!res.ok) { api.toastError(res); return }
      this.setData({ editing: null })
      wx.showToast({ title: '已保存', icon: 'success' })
      bus.emit('bill-changed')
      this.reload()
    })
  },

  onEditDelete() {
    const ed = this.data.editing
    wx.showModal({
      title: '删除这笔',
      content: '删除后不可恢复，确认删除？',
      confirmColor: '#6b93d6',
      success: r => {
        if (!r.confirm) return
        wx.showLoading({ title: '删除中', mask: true })
        api.call('bill', 'deleteBill', { ledgerId: store.getLedgerId(), billId: ed._id }).then(res => {
          wx.hideLoading()
          if (!res.ok) { api.toastError(res); return }
          this.setData({ editing: null })
          wx.showToast({ title: '已删除', icon: 'success' })
          bus.emit('bill-changed')
          this.reload()
        })
      }
    })
  },

  noop() {}
})
