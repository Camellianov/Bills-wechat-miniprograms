const api = require('../../utils/api.js')
const store = require('../../utils/store.js')
const bus = require('../../utils/bus.js')
const tip = require('../../utils/tip.js')

Page({
  data: {
    masked: false,
    loading: true,
    initError: '',
    ledgerName: '',
    role: '',
    isOwner: false,
    inviteCode: '',
    members: [],
    count: 0,
    max: 5,
    joinCode: ''
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
    const ledgerId = store.getLedgerId()
    if (!ledgerId) { this.setData({ loading: false, initError: '账本初始化中...' }); return }
    this.setData({ loading: true, initError: '' })

    const res = await api.call('member', 'listMembers', { ledgerId: ledgerId })
    if (!res.ok) {
      this.setData({ loading: false, initError: api.errorText(res, '加载失败') })
      return
    }

    // 出参里没有任何 openid，只有序号 / 角色 / 是否本人
    const members = (res.members || []).map(m => ({
      key: m.key,
      isMe: !!m.isMe,
      role: m.role,
      memberNo: m.memberNo,
      name: m.nickname || (m.role === 'owner' ? '房主' : '成员' + m.memberNo),
      roleText: m.role === 'owner' ? '房主' : '成员',
      canRemove: res.role === 'owner' && !m.isMe && m.role !== 'owner'
    }))

    const ledger = store.getLedger() || {}
    this.setData({
      loading: false,
      initError: '',
      ledgerName: ledger.name || '家庭账本',
      role: res.role,
      isOwner: res.role === 'owner',
      inviteCode: res.inviteCode || '',
      members: members,
      count: res.count || members.length,
      max: res.max || 5
    })
  },

  onCopyCode() {
    if (!this.data.inviteCode) return
    wx.setClipboardData({ data: this.data.inviteCode }) // 系统会提示“内容已复制”
  },

  // ---- 邀请码加入（不依赖分享能力，未认证小程序同样可用）----

  onJoinInput(e) {
    const v = String(e.detail.value || '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6)
    this.setData({ joinCode: v })
  },

  onJoinPaste() {
    wx.getClipboardData({
      success: r => {
        const v = String(r.data || '').toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6)
        this.setData({ joinCode: v })
      }
    })
  },

  onJoinSubmit() {
    const code = this.data.joinCode
    if (code.length !== 6) { wx.showToast({ title: '请输入 6 位邀请码', icon: 'none' }); return }

    wx.showLoading({ title: '加入中', mask: true })
    api.call('member', 'joinLedger', { inviteCode: code }).then(res => {
      if (!res.ok) { wx.hideLoading(); api.toastError(res); return }
      return api.call('ledger', 'initUser', {}).then(init => {
        wx.hideLoading()
        if (init.ok) store.setCtx({ ledgerId: init.ledgerId, role: init.role, ledger: init.ledger })
        this.setData({ joinCode: '' })
        wx.showToast({ title: res.alreadyMember ? '已在该账本' : '已加入', icon: 'success' })
        bus.emit('bill-changed')
        this.load()
      })
    })
  },

  onRotate() {
    wx.showModal({
      title: '刷新邀请码',
      content: '刷新后旧邀请码立即失效，确认刷新？',
      success: r => {
        if (!r.confirm) return
        wx.showLoading({ title: '刷新中', mask: true })
        api.call('member', 'rotateInvite', { ledgerId: store.getLedgerId() }).then(res => {
          wx.hideLoading()
          if (!res.ok) { api.toastError(res); return }
          this.setData({ inviteCode: res.inviteCode })
          wx.showToast({ title: '已刷新', icon: 'success' })
        })
      }
    })
  },

  onRemove(e) {
    const key = e.currentTarget.dataset.key
    const name = e.currentTarget.dataset.name
    wx.showModal({
      title: '移除成员',
      content: '移除后对方将无法查看本账本，确认移除（' + name + '）？',
      confirmColor: '#6b93d6',
      success: r => {
        if (!r.confirm) return
        wx.showLoading({ title: '处理中', mask: true })
        api.call('member', 'removeMember', { ledgerId: store.getLedgerId(), memberKey: key }).then(res => {
          wx.hideLoading()
          if (!res.ok) { api.toastError(res); return }
          wx.showToast({ title: '已移除', icon: 'success' })
          this.load()
        })
      }
    })
  },

  onLeave() {
    wx.showModal({
      title: '退出账本',
      content: '退出后将无法查看该账本的账单，确认退出？',
      confirmColor: '#6b93d6',
      success: r => {
        if (!r.confirm) return
        wx.showLoading({ title: '处理中', mask: true })
        api.call('member', 'leaveLedger', { ledgerId: store.getLedgerId() }).then(res => {
          if (!res.ok) { wx.hideLoading(); api.toastError(res); return }
          // 退出后重建上下文：有其它账本则切过去，没有则由 initUser 重建默认账本
          return api.call('ledger', 'initUser', {}).then(init => {
            wx.hideLoading()
            if (init.ok) store.setCtx({ ledgerId: init.ledgerId, role: init.role, ledger: init.ledger })
            wx.showToast({ title: '已退出', icon: 'success' })
            bus.emit('bill-changed')
            wx.switchTab({ url: '/pages/list/list' })
          })
        })
      }
    })
  },

  /** 分享卡片：对方点开即可无感加入（邀请码随 path 带入） */
  onShareAppMessage() {
    return {
      title: '邀请你一起记账',
      path: '/pages/record/record?invite=' + (this.data.inviteCode || '')
    }
  },

  /** 辅助说明收进「!」符号，点击才展开，界面不堆小字 */
  onTipTap(e) {
    tip.showTip(e.currentTarget.dataset.t)
  },

  noop() {}
})
