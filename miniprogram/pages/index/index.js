const app = getApp()
const api = require('../../utils/api')
const cart = require('../../utils/cart')
const fmt = require('../../utils/fmt')

Page({
  data: {
    loading: true,
    err: '',
    cats: [],
    active: 'all',
    all: [],
    list: [],
    cartCount: 0,
    s: {},
    needInit: false,
    isAdmin: false
  },

  onLoad () {
    this.load()
  },

  onShow () {
    this.setData({ cartCount: cart.count() })
  },

  onPullDownRefresh () {
    this.load().finally(function () { wx.stopPullDownRefresh() })
  },

  load () {
    const self = this
    this.setData({ loading: true, err: '' })
    return app
      .whenReady()
      .then(function () { return api.call('getHome') })
      .then(function (d) {
        const all = (d.products || []).map(function (p) {
          return Object.assign({}, p, {
            priceText: fmt.money(p.price),
            initial: (p.name || '特').slice(0, 1)
          })
        })
        self.setData({
          loading: false,
          all: all,
          cats: (d.categories || []),
          s: d.settings || {},
          needInit: !!d.needInit,
          isAdmin: !!d.isAdmin
        })
        self.apply()
      })
      .catch(function (e) {
        self.setData({ loading: false, err: e.message || '加载失败' })
      })
  },

  apply () {
    const active = this.data.active
    const list = active === 'all'
      ? this.data.all
      : this.data.all.filter(function (p) { return p.catId === active })
    this.setData({ list: list })
  },

  onCat (e) {
    const id = e.currentTarget.dataset.id
    this.setData({ active: id })
    this.apply()
  },

  goDetail (e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/detail/index?id=' + id })
  },

  addCart (e) {
    const id = e.currentTarget.dataset.id
    const n = cart.add(id, 1)
    this.setData({ cartCount: n })
    wx.showToast({ title: '已加入清单', icon: 'none' })
  },

  goCheckout () {
    const list = cart.read()
    if (!list.length) {
      wx.showToast({ title: '清单还是空的', icon: 'none' })
      return
    }
    app.globalData.checkoutDraft = list
    wx.navigateTo({ url: '/pages/checkout/index' })
  },

  initShop () {
    const self = this
    wx.showModal({
      title: '初始化店铺',
      content: '会建好店铺数据，并把当前微信设为管理员。仅需执行一次。',
      confirmText: '开始初始化',
      success: function (r) {
        if (!r.confirm) return
        wx.showLoading({ title: '初始化中', mask: true })
        api.call('bootstrap')
          .then(function (res) {
            wx.hideLoading()
            wx.showModal({
              title: '完成',
              content: res.already ? '已经初始化过了' : '已建好店铺，可以去「我的 → 卖家工具」里加商品了。',
              showCancel: false,
              success: function () { self.load() }
            })
          })
          .catch(function (e) {
            wx.hideLoading()
            wx.showModal({ title: '初始化失败', content: e.message, showCancel: false })
          })
      }
    })
  },

  /** 公告在顶部只显示一行，点一下看全文 */
  showNotice () {
    const t = this.data.s.notice
    if (!t) return
    wx.showModal({ title: '公告', content: t, showCancel: false, confirmText: '知道了' })
  },

  onShareAppMessage () {
    return {
      title: (this.data.s.shopName || '老家特产') + '：' + (this.data.s.slogan || ''),
      path: '/pages/index/index'
    }
  }
})
