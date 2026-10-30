const app = getApp()
const api = require('../../utils/api')
const cart = require('../../utils/cart')
const fmt = require('../../utils/fmt')

Page({
  data: {
    id: '',
    loading: true,
    err: '',
    p: null,
    imgs: [],
    qty: 1,
    cartCount: 0,
    s: {}
  },

  onLoad (q) {
    this.setData({ id: q.id || '' })
    this.setData({ s: app.globalData.settings || {} })
    this.load()
  },

  onShow () {
    this.setData({ cartCount: cart.count() })
  },

  load () {
    const self = this
    this.setData({ loading: true, err: '' })
    return app.whenReady()
      .then(function () { return api.call('getProducts', { ids: [self.data.id] }) })
      .then(function (list) {
        const p = list[0]
        if (!p) throw new Error('这一条不存在或已隐藏')
        const imgs = (p.images && p.images.length) ? p.images : (p.cover ? [p.cover] : [])
        self.setData({
          loading: false,
          p: Object.assign(p, { priceText: fmt.money(p.price), initial: (p.name || '特').slice(0, 1) }),
          imgs: imgs
        })
        wx.setNavigationBarTitle({ title: p.name })
      })
      .catch(function (e) {
        self.setData({ loading: false, err: e.message })
      })
  },

  minus () {
    if (this.data.qty <= 1) return
    this.setData({ qty: this.data.qty - 1 })
  },

  plus () {
    if (this.data.qty >= 999) return
    this.setData({ qty: this.data.qty + 1 })
  },

  onQtyInput (e) {
    let v = parseInt(e.detail.value, 10)
    if (!isFinite(v) || v < 1) v = 1
    if (v > 999) v = 999
    this.setData({ qty: v })
  },

  addCart () {
    const n = cart.add(this.data.id, this.data.qty)
    this.setData({ cartCount: n })
    wx.showToast({ title: '已加入清单', icon: 'none' })
  },

  buyNow () {
    app.globalData.checkoutDraft = [{ productId: this.data.id, qty: this.data.qty }]
    wx.navigateTo({ url: '/pages/checkout/index' })
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

  preview (e) {
    const i = e.currentTarget.dataset.i
    wx.previewImage({ current: this.data.imgs[i], urls: this.data.imgs })
  },

  onShareAppMessage () {
    return {
      title: this.data.p ? this.data.p.name : '老家特产',
      path: '/pages/detail/index?id=' + this.data.id,
      imageUrl: this.data.imgs[0] || ''
    }
  }
})
