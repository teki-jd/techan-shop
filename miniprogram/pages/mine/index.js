const app = getApp()
const api = require('../../utils/api')
const config = require('../../config')

Page({
  data: {
    contact: { name: '', phone: '' },
    s: {},
    isAdmin: false,
    needInit: false,
    openid: '',
    saving: false,
    // 仅本地联调时显示：当前假身份 + 数据存在哪
    devWho: config.backend === 'http' ? (config.devOpenid || '') : '',
    storeWhere: api.backend === 'http' ? '自建服务器' : '微信云开发'
  },

  onShow () {
    const self = this
    app.whenReady().then(function (g) {
      const u = g.user || {}
      const local = wx.getStorageSync('techan_contact') || {}
      self.setData({
        s: g.settings || {},
        isAdmin: !!g.isAdmin,
        needInit: !!g.needInit,
        openid: g.openid || '',
        contact: {
          name: u.name || local.name || '',
          phone: u.phone || local.phone || ''
        }
      })
    }).catch(function () {})
  },

  onInput (e) {
    const k = e.currentTarget.dataset.k
    const patch = {}
    patch['contact.' + k] = e.detail.value
    this.setData(patch)
  },

  save () {
    const self = this
    const c = this.data.contact
    if (!String(c.name || '').trim()) return wx.showToast({ title: '填个姓名', icon: 'none' })
    if (!/^1\d{10}$/.test(String(c.phone || '').trim())) return wx.showToast({ title: '手机号不对', icon: 'none' })
    this.setData({ saving: true })
    api.call('saveContact', { contact: c })
      .then(function () {
        wx.setStorageSync('techan_contact', c)
        self.setData({ saving: false })
        wx.showToast({ title: '已保存', icon: 'success' })
      })
      .catch(function (e) {
        self.setData({ saving: false })
        wx.showModal({ title: '保存失败', content: e.message, showCancel: false })
      })
  },

  copy (e) {
    const v = e.currentTarget.dataset.v
    if (!v) return
    wx.setClipboardData({ data: String(v) })
  },

  call () {
    const p = this.data.s.phone
    if (!p) return wx.showToast({ title: '卖家还没填手机号', icon: 'none' })
    wx.makePhoneCall({ phoneNumber: p })
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
  },

  copyOpenid () {
    if (!this.data.openid) return
    wx.setClipboardData({ data: this.data.openid })
  }
})
