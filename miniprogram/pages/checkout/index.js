const app = getApp()
const api = require('../../utils/api')
const cart = require('../../utils/cart')
const fmt = require('../../utils/fmt')

Page({
  data: {
    loading: true,
    err: '',
    items: [],
    total: '0',
    count: 0,
    topPad: 20,
    contact: { name: '', phone: '' },
    address: '',
    remark: '',
    submitting: false,
    s: {}
  },

  onLoad () {
    const draft = app.globalData.checkoutDraft || cart.read()
    this.setData({ s: app.globalData.settings || {}, topPad: this.calcTopPad() })
    this.load(draft)
    this.fillContact()
  },

  /** 沉浸式导航：顶部留出状态栏高度，返回箭头画在清单卡片里 */
  calcTopPad () {
    let statusBar = 20
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      statusBar = info.statusBarHeight || 20
    } catch (e) { /* 拿不到就用默认值 */ }
    return statusBar + 8
  },

  goBack () {
    if (getCurrentPages().length > 1) {
      wx.navigateBack()
    } else {
      wx.switchTab({ url: '/pages/index/index' })
    }
  },

  fillContact () {
    const u = app.globalData.user || {}
    const local = wx.getStorageSync('techan_contact') || {}
    this.setData({
      contact: {
        name: u.name || local.name || '',
        phone: u.phone || local.phone || ''
      },
      address: wx.getStorageSync('techan_address') || ''
    })
  },

  load (draft) {
    const self = this
    const ids = (draft || []).map(function (d) { return d.productId })
    if (!ids.length) {
      this.setData({ loading: false, err: '清单是空的' })
      return
    }
    this.setData({ loading: true, err: '' })
    api.call('getProducts', { ids: ids })
      .then(function (list) {
        const map = {}
        list.forEach(function (p) { map[p._id] = p })
        const items = (draft || []).map(function (d) {
          const p = map[d.productId]
          if (!p) return null
          return {
            productId: p._id,
            name: p.name,
            unit: p.unit,
            weight: p.weight || '',
            price: p.price,
            priceText: fmt.money(p.price),
            cover: p.cover,
            initial: (p.name || '特').slice(0, 1),
            qty: d.qty || 1
          }
        }).filter(Boolean)
        self.setData({ loading: false, items: items })
        self.recalc()
      })
      .catch(function (e) {
        self.setData({ loading: false, err: e.message })
      })
  },

  recalc () {
    let total = 0
    let count = 0
    this.data.items.forEach(function (i) {
      total += i.price * i.qty
      count += i.qty
    })
    const items = this.data.items.map(function (i) {
      return Object.assign({}, i, { lineText: fmt.money(i.price * i.qty) })
    })
    this.setData({ items: items, total: fmt.money(Math.round(total * 100) / 100), count: count })
  },

  plus (e) {
    const i = e.currentTarget.dataset.i
    const items = this.data.items
    if (items[i].qty >= 999) return
    items[i].qty += 1
    this.setData({ items: items })
    this.recalc()
  },

  minus (e) {
    const i = e.currentTarget.dataset.i
    const items = this.data.items
    if (items[i].qty <= 1) return
    items[i].qty -= 1
    this.setData({ items: items })
    this.recalc()
  },

  remove (e) {
    const self = this
    const i = e.currentTarget.dataset.i
    const items = this.data.items.slice()
    items.splice(i, 1)
    if (!items.length) {
      wx.showToast({ title: '清单空了', icon: 'none' })
      setTimeout(function () { wx.navigateBack() }, 600)
      return
    }
    this.setData({ items: items })
    this.recalc()
    cart.write(items.map(function (x) { return { productId: x.productId, qty: x.qty } }))
  },

  /** 从微信收货地址一键填入（顺带补姓名和手机号，如果还没填） */
  importAddress () {
    const self = this
    wx.chooseAddress({
      success: function (r) {
        const addr = [r.provinceName, r.cityName, r.countyName, r.detailInfo]
          .filter(Boolean).join('')
        const patch = { address: addr }
        if (!String(self.data.contact.name || '').trim() && r.userName) {
          patch['contact.name'] = r.userName
        }
        if (!String(self.data.contact.phone || '').trim() && r.telNumber) {
          patch['contact.phone'] = r.telNumber
        }
        self.setData(patch)
      },
      fail: function (e) {
        const msg = (e && e.errMsg) || ''
        if (/cancel/i.test(msg)) return
        wx.showModal({
          title: '暂时用不了',
          content: '微信地址没取到（可能还没在后台声明「收货地址」权限），手动填一下就行，不影响提交。',
          showCancel: false
        })
      }
    })
  },

  onInput (e) {
    const k = e.currentTarget.dataset.k
    const patch = {}
    if (k === 'address' || k === 'remark') {
      patch[k] = e.detail.value
    } else {
      patch['contact.' + k] = e.detail.value
    }
    this.setData(patch)
  },

  submit () {
    const self = this
    if (this.data.submitting) return
    const c = this.data.contact

    if (!String(c.name || '').trim()) return this.warn('请填写你的姓名')
    if (!/^1\d{10}$/.test(String(c.phone || '').trim())) return this.warn('手机号像是填错了')
    if (String(this.data.address || '').trim().length < 5) {
      return this.warn('请填写收货地址')
    }

    const payload = {
      items: this.data.items.map(function (i) { return { productId: i.productId, qty: i.qty } }),
      contact: {
        name: String(c.name).trim(),
        phone: String(c.phone).trim()
      },
      address: String(this.data.address).trim(),
      remark: this.data.remark
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中', mask: true })
    api.call('createOrder', payload)
      .then(function (res) {
        wx.hideLoading()
        self.setData({ submitting: false })
        cart.clear()
        wx.setStorageSync('techan_contact', payload.contact)
        wx.setStorageSync('techan_address', payload.address || '')
        app.globalData.checkoutDraft = null
        app.refreshUser().catch(function () {})
        wx.showModal({
          title: '登记成功',
          content: '编号 ' + res.orderNo + '\n我会尽快给你打电话确认运费，确认后再转账。',
          confirmText: '看我的登记',
          cancelText: '好的',
          success: function () {
            wx.switchTab({ url: '/pages/orders/index' })
          }
        })
      })
      .catch(function (e) {
        wx.hideLoading()
        self.setData({ submitting: false })
        wx.showModal({ title: '提交失败', content: e.message, showCancel: false })
      })
  },

  warn (msg) {
    wx.showToast({ title: msg, icon: 'none' })
  }
})
