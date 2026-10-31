const app = getApp()
const api = require('../../utils/api')
const config = require('../../config')

Page({
  data: {
    s: {},
    isAdmin: false,
    needInit: false,
    openid: '',
    // 仅本地联调时显示：当前假身份
    devWho: config.backend === 'http' ? (config.devOpenid || '') : ''
  },

  onShow () {
    const self = this
    app.whenReady().then(function (g) {
      self.setData({
        s: g.settings || {},
        isAdmin: !!g.isAdmin,
        needInit: !!g.needInit,
        openid: g.openid || ''
      })
    }).catch(function () {})
  },

  copyOpenid () {
    if (!this.data.openid) return
    wx.setClipboardData({
      data: this.data.openid,
      success: function () { wx.showToast({ title: '已复制，发给店主', icon: 'none' }) }
    })
  },

  goAdmin () {
    wx.navigateTo({ url: '/pages/admin/index' })
  },

  initShop () {
    const self = this
    wx.showModal({
      title: '初始化店铺',
      content: '建好店铺数据，当前微信会成为管理员。仅需执行一次。',
      success: function (r) {
        if (!r.confirm) return
        wx.showLoading({ title: '初始化中', mask: true })
        api.call('bootstrap')
          .then(function () {
            wx.hideLoading()
            return app.refreshUser()
          })
          .then(function () {
            wx.showToast({ title: '完成', icon: 'success' })
            self.onShow()
          })
          .catch(function (e) {
            wx.hideLoading()
            wx.showModal({ title: '失败', content: e.message, showCancel: false })
          })
      }
    })
  }
})
