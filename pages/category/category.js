const api = require('../../utils/api.js')
const store = require('../../utils/store.js')
const bus = require('../../utils/bus.js')
const emojiLib = require('../../utils/emoji.js')

const EMOJI_LIB = emojiLib.EMOJI_LIB

Page({
  data: {
    masked: false,
    initError: '',
    expenseCats: [],
    incomeCats: [],

    // 编辑弹层（新增 / 修改共用，内置分类同样可改）
    dlg: false,
    dlgMode: 'add',
    dlgId: '',
    dlgType: 'expense',
    dlgName: '',
    dlgEmoji: EMOJI_LIB[0],
    emojiLib: EMOJI_LIB
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

  load() {
    const ledger = store.getLedger()
    if (!ledger) { this.initCtx(); return }
    this.group(ledger.categories || [])
  },

  async initCtx() {
    const res = await api.call('ledger', 'initUser', {})
    if (res.ok) {
      store.setCtx({ ledgerId: res.ledgerId, role: res.role, ledger: res.ledger })
      this.setData({ initError: '' })
      this.group(res.ledger.categories || [])
    } else {
      console.error('[category] initUser failed:', res)
      this.setData({ initError: api.errorText(res, '初始化失败') })
    }
  },

  onRetry() {
    this.initCtx()
  },

  group(cats) {
    this.setData({
      expenseCats: cats.filter(c => c.type === 'expense'),
      incomeCats: cats.filter(c => c.type === 'income')
    })
  },

  allCats() {
    return this.data.expenseCats.concat(this.data.incomeCats)
  },

  /** 恢复内置默认分类：按所在分区只恢复该类型 */
  onRestore(e) {
    const type = e.currentTarget.dataset.type
    const label = type === 'expense' ? '支出' : '收入'
    wx.showModal({
      title: '恢复内置默认分类',
      content: '将补回缺失的内置' + label + '分类，并把已改名的内置' + label + '分类恢复为默认名称与图标；你新增的自定义分类不受影响。',
      confirmText: '恢复',
      success: r => {
        if (!r.confirm) return
        wx.showLoading({ title: '恢复中', mask: true })
        api.call('ledger', 'restoreDefaults', { ledgerId: store.getLedgerId(), type: type })
          .then(res => {
            wx.hideLoading()
            if (!res.ok) { api.toastError(res); return }
            store.updateCategories(res.categories)
            this.group(res.categories)
            wx.showToast({ title: '已恢复', icon: 'success' })
          })
      }
    })
  },

  onAdd(e) {
    const type = e.currentTarget.dataset.type
    this.setData({ dlg: true, dlgMode: 'add', dlgId: '', dlgType: type, dlgName: '', dlgEmoji: EMOJI_LIB[0] })
  },

  onEdit(e) {
    const id = e.currentTarget.dataset.id
    const cat = this.allCats().find(c => c.id === id)
    if (!cat) return
    this.setData({
      dlg: true,
      dlgMode: 'edit',
      dlgId: id,
      dlgType: cat.type,
      dlgName: cat.name,
      dlgEmoji: EMOJI_LIB.indexOf(cat.emoji) >= 0 ? cat.emoji : EMOJI_LIB[0]
    })
  },

  onDel(e) {
    const id = e.currentTarget.dataset.id
    const cat = this.allCats().find(c => c.id === id)
    if (!cat) return
    wx.showModal({
      title: '删除分类',
      content: '删除后不可恢复，确认删除（' + cat.name + '）？',
      confirmColor: '#6b93d6',
      success: r => {
        if (!r.confirm) return
        wx.showLoading({ title: '删除中', mask: true })
        api.call('ledger', 'deleteCategory', { ledgerId: store.getLedgerId(), categoryId: id })
          .then(res => {
            wx.hideLoading()
            if (!res.ok) { api.toastError(res); return }
            store.updateCategories(res.categories)
            this.group(res.categories)
            wx.showToast({ title: '已删除', icon: 'success' })
          })
      }
    })
  },

  onDlgClose() { this.setData({ dlg: false }) },
  onDlgName(e) { this.setData({ dlgName: e.detail.value }) },
  onDlgEmoji(e) { this.setData({ dlgEmoji: e.currentTarget.dataset.e }) },
  onDlgType(e) { this.setData({ dlgType: e.currentTarget.dataset.type }) },

  onDlgSave() {
    const name = String(this.data.dlgName || '').trim()
    if (!name) { wx.showToast({ title: '请输入分类名称', icon: 'none' }); return }
    const ledgerId = store.getLedgerId()
    if (!ledgerId) { wx.showToast({ title: '账本初始化中...', icon: 'none' }); return }

    const isEdit = this.data.dlgMode === 'edit'
    const payload = { ledgerId: ledgerId, type: this.data.dlgType, name: name, emoji: this.data.dlgEmoji }
    if (isEdit) payload.categoryId = this.data.dlgId

    wx.showLoading({ title: '保存中', mask: true })
    api.call('ledger', isEdit ? 'updateCategory' : 'addCategory', payload).then(res => {
      wx.hideLoading()
      if (!res.ok) { api.toastError(res); return }
      store.updateCategories(res.categories)
      this.group(res.categories)
      this.setData({ dlg: false, dlgName: '' })
      wx.showToast({ title: isEdit ? '已修改' : '已添加', icon: 'success' })
    })
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
