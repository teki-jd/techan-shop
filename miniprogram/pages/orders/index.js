const app = getApp()
const api = require('../../utils/api')
const fmt = require('../../utils/fmt')

Page({
  data: { loading: true, err: '', list: [], s: {}, isAdmin: false },

  onShow () {
    this.setData({ s: app.globalData.settings || {}, isAdmin: !!app.globalData.isAdmin })
    this.load()
  },

  onPullDownRefresh () {
    this.load().finally(function () { wx.stopPullDownRefresh() })
  },

  load () {
    const self = this
    this.setData({ loading: true, err: '' })
    return app.whenReady()
      .then(function (g) {
        self.setData({ s: g.settings || {}, isAdmin: !!g.isAdmin })
        return api.call('myOrders')
      })
      .then(function (list) {
        self.setData({
          loading: false,
          list: (list || []).map(fmt.decorateOrder)
        })
      })
      .catch(function (e) {
        self.setData({ loading: false, err: e.message })
      })
  },

  cancel (e) {
    const self = this
    const id = e.currentTarget.dataset.id
    const no = e.currentTarget.dataset.no
    wx.showModal({
      title: '取消这条登记？',
      content: '登记 ' + no + ' 会被取消，之后可以重新登记。',
      confirmText: '取消登记',
      confirmColor: '#B4472E',
      success: function (r) {
        if (!r.confirm) return
        wx.showLoading({ title: '处理中', mask: true })
        api.call('cancelOrder', { id: id })
          .then(function () {
            wx.hideLoading()
            wx.showToast({ title: '已取消', icon: 'none' })
            self.load()
          })
          .catch(function (err) {
            wx.hideLoading()
            wx.showModal({ title: '取消失败', content: err.message, showCancel: false })
          })
      }
    })
  },

  copyNo (e) {
    wx.setClipboardData({ data: e.currentTarget.dataset.no })
  },

  callSeller () {
    const p = this.data.s.phone
    if (!p) return wx.showToast({ title: '卖家还没留电话', icon: 'none' })
    wx.makePhoneCall({ phoneNumber: p })
  },

  goShop () {
    wx.switchTab({ url: '/pages/index/index' })
  }
})
