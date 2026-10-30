const config = require('./config')
const api = require('./utils/api')

App({
  globalData: {
    ready: false,
    isAdmin: false,
    backend: config.backend,
    user: null,
    settings: {},
    needInit: false,
    // 结算草稿：[{productId, qty}]
    checkoutDraft: null
  },

  onLaunch () {
    if (config.backend === 'cloud') {
      if (!wx.cloud) {
        console.error('请使用 2.2.3 及以上的基础库以使用云能力')
        return
      }
      const opt = { traceUser: true }
      opt.env = config.envId || wx.cloud.DYNAMIC_CURRENT_ENV
      wx.cloud.init(opt)
    }
    this.readyPromise = this.refreshUser()
    this.readyPromise.catch(function () {})
  },

  /** 拉取当前用户身份 / 店铺设置 */
  refreshUser () {
    const self = this
    return api
      .call('me')
      .then(function (d) {
        self.globalData.openid = d.openid || ''
        self.globalData.user = d.user || null
        self.globalData.isAdmin = !!d.isAdmin
        self.globalData.needInit = !!d.needInit
        if (d.settings) self.globalData.settings = d.settings
        if (d.settings && d.settings.shopName) {
          try {
            wx.setNavigationBarTitle({ title: d.settings.shopName })
          } catch (err) { /* 页面还没准备好，忽略 */ }
        }
        self.globalData.ready = true
        return d
      })
      .catch(function (e) {
        self.globalData.ready = true
        self.globalData.error = e.message
        throw e
      })
  },

  /** 页面统一用这个等待身份就绪（只会请求一次） */
  whenReady () {
    if (this.globalData.ready) return Promise.resolve(this.globalData)
    if (!this.readyPromise) this.readyPromise = this.refreshUser()
    return this.readyPromise
  }
})
