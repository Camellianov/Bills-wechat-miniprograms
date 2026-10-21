const bus = require('./utils/bus.js')
const queue = require('./utils/queue.js')

// 云环境 ID：在「云开发控制台 - 设置 - 环境ID」里复制，例如 'cloud1-8gxxxxxxx'
// 留空则使用默认环境；若调用时提示 errCode -501000，把 ID 填到这里
const CLOUD_ENV = 'cloud1-d3g9i94yg3ed5ee74'

App({
  globalData: {
    masked: false
  },

  onLaunch(options) {
    if (!wx.cloud) {
      wx.showModal({ title: '基础库过低', content: '请升级微信或使用 2.2.3 及以上基础库', showCancel: false })
      return
    }
    // traceUser: false —— 不在云开发侧留存用户访问记录
    wx.cloud.init({ env: CLOUD_ENV || undefined, traceUser: false })

    const query = (options && options.query) || {}
    if (query.invite) wx.setStorageSync('pendingInvite', String(query.invite).toUpperCase()) // M5 邀请模块消费
  },

  onShow(options) {
    this.setMasked(false)
    queue.syncAll() // 回到前台自动补同步离线账单
    // 通过分享卡片打开（小程序已在后台运行时走 onShow 而非 onLaunch）
    const query = (options && options.query) || {}
    if (query.invite) wx.setStorageSync('pendingInvite', String(query.invite).toUpperCase())
  },

  onHide() {
    this.setMasked(true) // 切后台立即遮罩，防多任务预览泄露
  },

  setMasked(v) {
    this.globalData.masked = v
    bus.emit('mask', v)
  }
})
