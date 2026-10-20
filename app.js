const bus = require('./utils/bus.js')
const queue = require('./utils/queue.js')

// 云环境 ID：在「云开发控制台 - 设置 - 环境ID」里复制，例如 'cloud1-8gxxxxxxx'
// 留空则使用默认环境；若调用时提示 errCode -501000，把 ID 填到这里
const CLOUD_ENV = 'cloud1-d3g9i94yg3ed5ee74'

// 环境自检开关：控制台会打印实际使用的 env 与各云函数可达性，定位问题后可改为 false
const DEBUG_CLOUD = false

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
    if (!CLOUD_ENV) console.warn('[app] 未显式指定云环境，使用默认环境；若调用报 -501000 请在 app.js 的 CLOUD_ENV 填入环境 ID')

    const query = (options && options.query) || {}
    if (query.invite) wx.setStorageSync('pendingInvite', String(query.invite).toUpperCase()) // M5 邀请模块消费

    if (DEBUG_CLOUD) this.checkCloud()
  },

  /** 环境自检：确认 env 是否可达、云函数是否部署在该环境 */
  async checkCloud() {
    console.log('[cloud] app.js 使用的 env =', CLOUD_ENV || '(未填写，走默认环境)')
    const names = ['ledger', 'bill', 'member']
    for (let i = 0; i < names.length; i++) {
      const name = names[i]
      try {
        const r = await wx.cloud.callFunction({ name: name, data: { action: 'ping' } })
        console.log('[cloud] ' + name + ' 调用成功 ->', r && r.result)
      } catch (e) {
        console.error('[cloud] ' + name + ' 调用失败 ->', (e && e.errMsg) || e)
      }
    }
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
