const api = require('../../utils/api.js')
const store = require('../../utils/store.js')
const bus = require('../../utils/bus.js')
const colors = require('../../utils/colors.js')

Page({
  data: {
    masked: false,
    loading: true,
    initError: '',
    ledgers: [],
    dlg: false,
    dlgName: '',
    dlgColor: colors.DEFAULT_COLOR, // 默认黄色
    dlgColorName: '黄',
    colors: colors.LEDGER_COLORS
  },

  onLoad() {
    this._mask = v => this.setData({ masked: v })
    bus.on('mask', this._mask)
    this.setData({ masked: !!getApp().globalData.masked })
  },

  onShow() {
    this.setData({ masked: !!getApp().globalData.masked })
    this.load()
  },

  onUnload() {
    bus.off('mask', this._mask)
  },

  onRetry() {
    this.load()
  },

  async load() {
    this.setData({ loading: true, initError: '' })
    const res = await api.call('ledger', 'listMyLedgers', {})
    if (!res.ok) {
      this.setData({ loading: false, initError: api.errorText(res, '加载失败') })
      return
    }
    const list = (res.ledgers || []).map(l => ({
      ledgerId: l.ledgerId,
      name: l.name,
      iconColor: l.iconColor || colors.DEFAULT_COLOR,
      role: l.role,
      isCurrent: !!l.isCurrent,
      roleText: l.role === 'owner' ? '房主' : '成员',
      canDelete: l.role === 'owner' // 仅房主可删除账本
    }))
    this.setData({ loading: false, initError: '', ledgers: list })
  },

  onSwitch(e) {
    const id = e.currentTarget.dataset.id
    const cur = e.currentTarget.dataset.current === true || e.currentTarget.dataset.current === 'true'
    if (cur) { wx.navigateBack(); return }

    wx.showLoading({ title: '切换中', mask: true })
    api.call('ledger', 'switchLedger', { ledgerId: id }).then(res => {
      wx.hideLoading()
      if (!res.ok) { api.toastError(res); return }
      this.applyCtx(res)
      wx.showToast({ title: '已切换', icon: 'success' })
      bus.emit('bill-changed') // 通知账单 / 统计 / 记一笔刷新
      this.load()
    })
  },

  onAddTap() {
    this.setData({ dlg: true, dlgName: '', dlgColor: colors.DEFAULT_COLOR, dlgColorName: '黄' })
  },

  onDlgClose() {
    this.setData({ dlg: false })
  },

  onDlgName(e) {
    this.setData({ dlgName: e.detail.value })
  },

  onDlgColor(e) {
    const v = e.currentTarget.dataset.c
    const hit = colors.LEDGER_COLORS.filter(x => x.v === v)[0]
    this.setData({ dlgColor: v, dlgColorName: hit ? hit.n : '' })
  },

  onDlgSave() {
    const name = String(this.data.dlgName || '').trim()
    if (!name) { wx.showToast({ title: '请输入账本名称', icon: 'none' }); return }

    wx.showLoading({ title: '创建中', mask: true })
    api.call('ledger', 'createLedger', { name: name, iconColor: this.data.dlgColor }).then(res => {
      wx.hideLoading()
      if (!res.ok) { api.toastError(res); return }
      this.applyCtx(res) // 新建后服务端已自动切为当前账本
      this.setData({ dlg: false, dlgName: '', dlgColor: colors.DEFAULT_COLOR })
      wx.showToast({ title: '已创建', icon: 'success' })
      bus.emit('bill-changed')
      this.load()
    })
  },

  onDelete(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name
    wx.showModal({
      title: '删除账本',
      content: '删除后该账本的全部账单将一并删除且不可恢复，其他成员也会失去访问，确认删除（' + name + '）？',
      confirmColor: '#6b93d6',
      success: r => {
        if (!r.confirm) return
        wx.showLoading({ title: '删除中', mask: true })
        api.call('ledger', 'deleteLedger', { ledgerId: id }).then(res => {
          wx.hideLoading()
          if (!res.ok) { api.toastError(res); return }
          this.applyCtx(res) // 服务端已切到剩余账本
          wx.showToast({ title: '已删除', icon: 'success' })
          bus.emit('bill-changed')
          this.load()
        })
      }
    })
  },

  /** 云函数返回的都是统一上下文，直接覆盖本地缓存 */
  applyCtx(res) {
    store.setCtx({ ledgerId: res.ledgerId, role: res.role, ledger: res.ledger })
  },

  /** 辅助说明收进「!」符号，点击才展开，界面不堆小字 */
  onTipTap(e) {
    const t = e.currentTarget.dataset.t
    if (!t) return
    wx.showModal({
      content: t,
      showCancel: false,
      confirmText: '知道了',
      confirmColor: '#6b93d6'
    })
  },

  noop() {}
})
