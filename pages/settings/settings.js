const api = require('../../utils/api.js')
const store = require('../../utils/store.js')
const bus = require('../../utils/bus.js')
const fen = require('../../utils/fen.js')
const currencyLib = require('../../utils/currency.js')
const sh = require('../../utils/shanghai.js')

Page({
  data: {
    masked: false,
    initError: '',
    ledgerName: '',
    roleText: '',
    isOwner: false,

    // 货币符号
    currency: currencyLib.DEFAULT_CURRENCY,
    currencies: currencyLib.CURRENCIES,

    // 月度预算
    budgetInput: '',
    hasBudget: false,
    budgetText: '',

    // 清空数据
    clearDlg: false,
    clearInput: '',

    // 导出（日期范围）
    exporting: false,
    expDlg: false,
    expFileName: '',
    expCount: 0,
    expFrom: '',
    expTo: '',
    expQuick: 'all',
    expHint: '全部',
    todayStr: '',

    // 切换货币确认
    curDlg: false,
    curPending: '',
    curPendingName: ''
  },

  onLoad() {
    this._mask = v => this.setData({ masked: v })
    bus.on('mask', this._mask)
    this.setData({ masked: !!getApp().globalData.masked, todayStr: sh.todayStr() })
  },

  onShow() {
    this.setData({ masked: !!getApp().globalData.masked })
    this.refresh()
  },

  onUnload() {
    bus.off('mask', this._mask)
  },

  refresh() {
    const ledger = store.getLedger()
    if (!ledger) { this.initCtx(); return }
    this.apply(ledger)
  },

  async initCtx() {
    const res = await api.call('ledger', 'initUser', {})
    if (res.ok) {
      store.setCtx({ ledgerId: res.ledgerId, role: res.role, ledger: res.ledger })
      this.setData({ initError: '' })
      this.apply(res.ledger)
    } else {
      console.error('[settings] initUser failed:', res)
      this.setData({ initError: api.errorText(res, '初始化失败') })
    }
  },

  onRetry() {
    this.setData({ initError: '' })
    this.initCtx()
  },

  apply(ledger) {
    const ctx = store.getCtx() || {}
    const hasBudget = !!ledger.monthlyBudgetFen
    this.setData({
      ledgerName: ledger.name || '家庭账本',
      roleText: ctx.role === 'owner' ? '房主' : '成员',
      isOwner: ctx.role === 'owner',
      currency: ledger.currency || currencyLib.DEFAULT_CURRENCY,
      hasBudget: hasBudget,
      budgetText: hasBudget ? fen.fen2yuan(ledger.monthlyBudgetFen) : ''
    })
  },

  // ---- 货币符号 ----

  onCurrencyPick(e) {
    const c = e.currentTarget.dataset.c
    if (c === this.data.currency) return
    // 换符号不换算金额，先讲清楚再改，避免历史金额被误当成新货币
    this.setData({ curDlg: true, curPending: c, curPendingName: e.currentTarget.dataset.n || '' })
  },

  onCurCancel() {
    this.setData({ curDlg: false, curPending: '', curPendingName: '' })
  },

  onCurConfirm() {
    const c = this.data.curPending
    if (!c) return
    this.setData({ curDlg: false, curPending: '', curPendingName: '' })

    wx.showLoading({ title: '保存中', mask: true })
    api.call('ledger', 'updateSettings', { ledgerId: store.getLedgerId(), currency: c }).then(res => {
      wx.hideLoading()
      if (!res.ok) { api.toastError(res); return }
      this.saveCtx(res)
      this.setData({ currency: c })
      wx.showToast({ title: '已切换', icon: 'success' })
      bus.emit('bill-changed') // 各页金额前缀随之更新
    })
  },

  // ---- 月度预算 ----

  onBudgetInput(e) {
    const v = String(e.detail.value || '')
    if (!/^\d{0,9}(\.\d{0,2})?$/.test(v)) return
    this.setData({ budgetInput: v })
  },

  onBudgetSave() {
    const raw = String(this.data.budgetInput || '').trim()
    const monthlyBudgetFen = raw ? fen.yuanStrToFen(raw) : 0
    if (raw && !monthlyBudgetFen) { wx.showToast({ title: '请输入正确的金额', icon: 'none' }); return }

    wx.showLoading({ title: '保存中', mask: true })
    api.call('ledger', 'updateSettings', {
      ledgerId: store.getLedgerId(),
      monthlyBudgetFen: monthlyBudgetFen || null
    }).then(res => {
      wx.hideLoading()
      if (!res.ok) { api.toastError(res); return }
      this.saveCtx(res)
      this.setData({ budgetInput: '' })
      wx.showToast({ title: monthlyBudgetFen ? '已设置' : '已清除', icon: 'success' })
      bus.emit('bill-changed')
    })
  },

  onBudgetClear() {
    wx.showLoading({ title: '清除中', mask: true })
    api.call('ledger', 'updateSettings', {
      ledgerId: store.getLedgerId(),
      monthlyBudgetFen: null
    }).then(res => {
      wx.hideLoading()
      if (!res.ok) { api.toastError(res); return }
      this.saveCtx(res)
      this.setData({ budgetInput: '' })
      wx.showToast({ title: '已清除', icon: 'success' })
      bus.emit('bill-changed')
    })
  },

  saveCtx(res) {
    store.setCtx({ ledgerId: res.ledgerId, role: res.role, ledger: res.ledger })
    if (res.ledger) this.apply(res.ledger)
  },

  // ---- 清空数据 ----

  onClearTap() {
    if (!this.data.isOwner) {
      wx.showToast({ title: '仅房主可清空账单', icon: 'none' })
      return
    }
    this.setData({ clearDlg: true, clearInput: '' })
  },

  onClearClose() {
    this.setData({ clearDlg: false, clearInput: '' })
  },

  onClearInput(e) {
    this.setData({ clearInput: e.detail.value })
  },

  onClearConfirm() {
    if (String(this.data.clearInput || '').trim() !== '删除') {
      wx.showToast({ title: '请准确输入“删除”二字', icon: 'none' })
      return
    }
    wx.showLoading({ title: '清空中', mask: true })
    api.call('ledger', 'clearBills', { ledgerId: store.getLedgerId() }).then(res => {
      wx.hideLoading()
      if (!res.ok) { api.toastError(res); return }
      this.setData({ clearDlg: false, clearInput: '' })
      wx.showToast({ title: '已清空 ' + (res.cleared || 0) + ' 笔', icon: 'success' })
      bus.emit('bill-changed')
    })
  },

  // ---- 导出 ----

  // ---- 导出日期范围 ----

  onExpFromChange(e) {
    this.setData({ expFrom: e.detail.value, expQuick: 'custom' }, () => this.updateExpHint())
  },

  onExpToChange(e) {
    this.setData({ expTo: e.detail.value, expQuick: 'custom' }, () => this.updateExpHint())
  },

  onExpQuick(e) {
    const q = e.currentTarget.dataset.q
    const t = sh.parts(new Date())
    const p = n => String(n).padStart(2, '0')
    const to = t.y + '-' + p(t.m) + '-' + p(t.d)

    if (q === 'all') {
      this.setData({ expFrom: '', expTo: '', expQuick: 'all' }, () => this.updateExpHint())
      return
    }
    // 近3个月 = 当月往前推 2 个月的 1 号起
    const idx = t.y * 12 + (t.m - 1) - (q === '3m' ? 2 : 0)
    const y = Math.floor(idx / 12)
    const m = (idx % 12) + 1
    this.setData({
      expFrom: y + '-' + p(m) + '-01',
      expTo: to,
      expQuick: q
    }, () => this.updateExpHint())
  },

  updateExpHint() {
    const f = this.data.expFrom
    const t = this.data.expTo
    this.setData({ expHint: (f || t) ? (f || '最早') + ' ~ ' + (t || '今天') : '全部' })
  },

  onExportTap() {
    if (this.data.exporting) return
    this.setData({ exporting: true })
    wx.showLoading({ title: '生成文件中', mask: true })

    // 结束日期取“次日零点”，这样当天 23:59 的记录也能包含进来
    const payload = { ledgerId: store.getLedgerId() }
    if (this.data.expFrom) payload.startAt = sh.dayStart(this.data.expFrom).toISOString()
    if (this.data.expTo) payload.endAt = new Date(sh.dayStart(this.data.expTo).getTime() + 86400000).toISOString()

    api.call('export', 'exportLedger', payload).then(res => {
      if (!res.ok) {
        wx.hideLoading()
        this.setData({ exporting: false })
        api.toastError(res)
        return
      }
      // 先落到本地临时文件，分享时微信要求的是本地路径
      wx.cloud.downloadFile({
        fileID: res.fileID,
        success: d => {
          wx.hideLoading()
          this.setData({
            exporting: false,
            expDlg: true,
            expFileName: res.fileName,
            expCount: res.count,
            _fileID: res.fileID,
            _tmpPath: d.tempFilePath
          })
        },
        fail: () => {
          wx.hideLoading()
          // 下载失败仍给出弹层，用户可改用复制链接
          this.setData({
            exporting: false,
            expDlg: true,
            expFileName: res.fileName,
            expCount: res.count,
            _fileID: res.fileID,
            _tmpPath: ''
          })
        }
      })
    })
  },

  onExpClose() {
    this.setData({ expDlg: false })
  },

  /** 发送到微信好友：在好友列表里选「文件传输助手」即可传到电脑 */
  onExpSend() {
    const path = this.data._tmpPath
    const name = this.data.expFileName
    if (!path) { this.onExpCopy(); return }
    if (!wx.shareFileMessage) { this.onExpCopy(); return } // 低版本基础库兜底

    wx.shareFileMessage({
      filePath: path,
      fileName: name,
      success: () => {
        this.setData({ expDlg: false })
      },
      fail: e => {
        console.error('[settings] shareFileMessage failed:', e)
        wx.showToast({ title: '发送已取消', icon: 'none' })
      }
    })
  },

  onExpCopy() {
    const fileID = this._fileID || this.data._fileID || ''
    if (!fileID) { wx.showToast({ title: '暂无可复制的链接', icon: 'none' }); return }
    wx.cloud.getTempFileURL({
      fileList: [fileID],
      success: r => {
        const item = r.fileList && r.fileList[0]
        if (!item || !item.tempFileURL) { wx.showToast({ title: '获取链接失败', icon: 'none' }); return }
        wx.setClipboardData({ data: item.tempFileURL }) // 系统会提示“内容已复制”
      },
      fail: () => wx.showToast({ title: '获取链接失败', icon: 'none' })
    })
  },

  noop() {}
})
