const api = require('../../utils/api.js')
const store = require('../../utils/store.js')
const bus = require('../../utils/bus.js')
const fen = require('../../utils/fen.js')
const sh = require('../../utils/shanghai.js')

// 环形图配色（固定调色板，不依赖图片资源）
const PALETTE = ['#2b6cff', '#17b26a', '#ff9500', '#8e5cf6', '#ff5b4a', '#ff7eb6', '#34c759', '#8a8f99', '#e54d4d', '#00b5ad']

Page({
  data: {
    masked: false,
    initError: '',
    currency: '¥',
    monthIdx: 0,
    monthLabel: '',
    type: 'expense',
    totalText: '0.00',
    empty: false,
    legends: [],
    trends: [],
    loading: false
  },

  onLoad() {
    this._dirty = true
    this._active = false
    this._slices = []

    this._mask = v => this.setData({ masked: v })
    this._chg = () => { this._dirty = true; if (this._active) this.load() }
    bus.on('mask', this._mask)
    bus.on('bill-changed', this._chg)
    bus.on('sync-done', this._chg)

    this.setData({ currency: store.getCurrency(), masked: !!getApp().globalData.masked })
  },

  onShow() {
    this._active = true
    const lg = store.getLedger() || {}
    this.setData({
      masked: !!getApp().globalData.masked,
      currency: lg.currency || '¥' // 货币符号在设置页可能已改，进页面就同步
    })
    if (!store.getLedgerId()) { this.initCtx(); return }
    if (this._dirty) this.load()
  },

  onHide() {
    this._active = false
  },

  onUnload() {
    bus.off('mask', this._mask)
    bus.off('bill-changed', this._chg)
    bus.off('sync-done', this._chg)
  },

  async initCtx() {
    const res = await api.call('ledger', 'initUser', {})
    if (res.ok) {
      store.setCtx({ ledgerId: res.ledgerId, role: res.role, ledger: res.ledger })
      this.setData({ currency: store.getCurrency(), initError: '' })
      this.load()
    } else {
      console.error('[stats] initUser failed:', res)
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
    this.setData({ monthIdx: this.data.monthIdx - 1 }, () => this.load())
  },

  onNextMonth() {
    if (this.data.monthIdx >= 0) return
    this.setData({ monthIdx: this.data.monthIdx + 1 }, () => this.load())
  },

  onSwitchType(e) {
    const t = e.currentTarget.dataset.type
    if (t === this.data.type) return
    this.setData({ type: t }, () => this.load())
  },

  async load() {
    this._dirty = false
    const ledgerId = store.getLedgerId()
    if (!ledgerId) { this.initCtx(); return }
    this.setData({ loading: true })

    const pair = this.monthOf(this.data.monthIdx)
    const y = pair[0], m = pair[1]
    this.setData({ monthLabel: sh.fmtMonth(y, m) })

    const r = sh.monthRange(y, m)
    const res = await api.call('bill', 'categoryStats', {
      ledgerId: ledgerId,
      type: this.data.type,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString()
    })

    if (!res.ok) {
      this.setData({ loading: false })
      api.toastError(res)
      return
    }

    const totalFen = res.totalFen || 0
    const list = res.list || []
    const legends = list.map((x, i) => {
      const cat = store.getCategory(x._id)
      return {
        id: x._id,
        emoji: cat.emoji,
        name: cat.name,
        amountText: fen.fen2yuan(x.total),
        percent: totalFen ? Math.round((x.total / totalFen) * 100) : 0,
        color: PALETTE[i % PALETTE.length]
      }
    })
    this._slices = list.map((x, i) => ({ total: x.total, color: PALETTE[i % PALETTE.length] }))
    this._total = totalFen

    this.setData({
      loading: false,
      legends: legends,
      totalText: fen.fen2yuan(totalFen),
      empty: !legends.length
    })
    this.drawPie()

    // 近半年趋势
    const months = sh.recentMonths(6).map(pair2 => {
      const rr = sh.monthRange(pair2[0], pair2[1])
      return { ym: pair2[1] + '月', startAt: rr.startAt.toISOString(), endAt: rr.endAt.toISOString() }
    })
    const tr = await api.call('bill', 'monthlyTrends', { ledgerId: ledgerId, months: months })
    if (tr.ok) {
      const listData = tr.list || []
      const max = Math.max(1, ...listData.map(x => Math.max(x.expenseFen, x.incomeFen)))
      this.setData({
        trends: listData.map(x => ({
          ym: x.ym,
          expenseH: Math.round((x.expenseFen / max) * 100),
          incomeH: Math.round((x.incomeFen / max) * 100),
          expenseText: x.expenseFen ? fen.fen2yuan(x.expenseFen) : '',
          incomeText: x.incomeFen ? fen.fen2yuan(x.incomeFen) : ''
        }))
      })
    }
  },

  /** 环形图：canvas 2d 手绘，无第三方库 */
  drawPie() {
    wx.createSelectorQuery().in(this).select('#pie').fields({ node: true, size: true }).exec(res => {
      const info = res && res[0]
      if (!info || !info.node) return
      const canvas = info.node
      const ctx = canvas.getContext('2d')
      const dpr = (wx.getSystemInfoSync && wx.getSystemInfoSync().pixelRatio) || 2
      canvas.width = info.width * dpr
      canvas.height = info.height * dpr
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, info.width, info.height)

      const cx = info.width / 2
      const cy = info.height / 2
      const R = Math.min(cx, cy) - 4
      const r = R * 0.62
      let start = -Math.PI / 2

      if (!this._total || !this._slices.length) {
        ctx.beginPath()
        ctx.arc(cx, cy, R, 0, Math.PI * 2)
        ctx.arc(cx, cy, r, 0, Math.PI * 2, true)
        ctx.fillStyle = '#eceef2'
        ctx.fill()
        return
      }
      this._slices.forEach(s => {
        const angle = (s.total / this._total) * Math.PI * 2
        ctx.beginPath()
        ctx.arc(cx, cy, R, start, start + angle)
        ctx.arc(cx, cy, r, start + angle, start, true)
        ctx.closePath()
        ctx.fillStyle = s.color
        ctx.fill()
        start += angle
      })
    })
  },

  noop() {}
})
