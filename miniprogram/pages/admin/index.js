const app = getApp()
const api = require('../../utils/api')
const fmt = require('../../utils/fmt')

const FILTERS = [
  ['all', '全部'],
  ['pending', '待确认'],
  ['quoted', '已报运费'],
  ['paid', '已收款'],
  ['shipped', '已发出'],
  ['done', '已完成'],
  ['cancelled', '已取消']
]

Page({
  data: {
    tab: 'orders',
    filter: 'all',
    filters: [],
    orders: [],
    counts: {},
    loading: true,
    err: '',
    products: [],
    cats: [],
    catNames: {},
    newCat: '',
    catOpen: false,
    keyword: '',
    catFilter: 'all',
    catChips: [],
    groups: [],
    shownCount: 0,
    s: {}
  },

  onLoad () {
    this.loadOrders()
  },

  // 从编辑页回来时刷新，否则看到的是改之前的列表
  onShow () {
    if (this._inited) this.reload()
    this._inited = true
  },

  onPullDownRefresh () {
    const self = this
    this.reload().finally(function () { wx.stopPullDownRefresh() })
  },

  reload () {
    if (this.data.tab === 'orders') return this.loadOrders()
    if (this.data.tab === 'products') return this.loadProducts()
    return this.loadSettings()
  },

  switchTab (e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ tab: tab })
    this.reload()
  },

  /* ---------------------------------------------------- 登记单 */
  loadOrders () {
    const self = this
    this.setData({ loading: true, err: '' })
    return app.whenReady()
      .then(function () {
        return api.call('adminListOrders', { status: self.data.filter })
      })
      .then(function (d) {
        const counts = d.counts || {}
        const filters = FILTERS.map(function (f) {
          return { k: f[0], n: f[1], c: f[0] === 'all' ? null : counts[f[0]] }
        })
        self.setData({
          loading: false,
          orders: (d.list || []).map(fmt.decorateOrder),
          counts: counts,
          filters: filters
        })
      })
      .catch(function (e) {
        self.setData({ loading: false, err: e.message })
      })
  },

  onFilter (e) {
    this.setData({ filter: e.currentTarget.dataset.k })
    this.loadOrders()
  },

  update (payload, tip) {
    const self = this
    wx.showLoading({ title: '保存中', mask: true })
    return api.call('adminUpdateOrder', payload)
      .then(function () {
        wx.hideLoading()
        if (tip) wx.showToast({ title: tip, icon: 'none' })
        return self.loadOrders()
      })
      .catch(function (e) {
        wx.hideLoading()
        wx.showModal({ title: '失败', content: e.message, showCancel: false })
      })
  },

  // 填运费 → 状态变「已报运费」
  quote (e) {
    const self = this
    const id = e.currentTarget.dataset.id
    const old = e.currentTarget.dataset.freight
    wx.showModal({
      title: '运费报价',
      editable: true,
      placeholderText: '运费金额，例如 12；包邮填 0',
      content: old === '' || old === undefined ? '' : String(old),
      success: function (r) {
        if (!r.confirm) return
        const v = String(r.content || '').trim()
        const f = Number(v)
        if (v === '' || !isFinite(f) || f < 0) {
          return wx.showToast({ title: '填个数字', icon: 'none' })
        }
        self.update({ id: id, status: 'quoted', freight: f }, '已填运费，等他转账')
      }
    })
  },

  markPaid (e) {
    this.update({ id: e.currentTarget.dataset.id, status: 'paid' }, '已标记收款')
  },

  markShipped (e) {
    this.update({ id: e.currentTarget.dataset.id, status: 'shipped' }, '已标记发出')
  },

  markDone (e) {
    this.update({ id: e.currentTarget.dataset.id, status: 'done' }, '已完成')
  },

  cancelOrder (e) {
    const self = this
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '取消这条登记？',
      content: '取消后对方会在「我的登记」里看到已取消。',
      confirmColor: '#B4472E',
      success: function (r) {
        if (r.confirm) self.update({ id: id, status: 'cancelled' }, '已取消')
      }
    })
  },

  note (e) {
    const self = this
    const id = e.currentTarget.dataset.id
    const old = e.currentTarget.dataset.note || ''
    wx.showModal({
      title: '给对方的留言',
      editable: true,
      placeholderText: '比如：明天下午发出 / 柿子是脆的',
      content: old,
      success: function (r) {
        if (!r.confirm) return
        self.update({ id: id, adminNote: r.content || '' }, '已保存留言')
      }
    })
  },

  callBuyer (e) {
    const p = e.currentTarget.dataset.phone
    if (!p) return
    wx.makePhoneCall({ phoneNumber: String(p) })
  },

  copyText (e) {
    const v = e.currentTarget.dataset.v
    if (!v) return
    wx.setClipboardData({ data: String(v) })
  },

  /* ---------------------------------------------------- 条目 */
  loadProducts () {
    const self = this
    this.setData({ loading: true, err: '' })
    return api.call('adminListProducts')
      .then(function (d) {
        self.setData({
          loading: false,
          cats: d.categories || [],
          catNames: {},
          products: (d.products || []).map(function (p) {
            return Object.assign({}, p, {
              priceText: fmt.money(p.price),
              initial: (p.name || '特').slice(0, 1)
            })
          })
        }, function () { self.applyFilter() })
      })
      .catch(function (e) {
        self.setData({ loading: false, err: e.message })
      })
  },

  // 搜索关键字 + 分类条件 → 筛选条、分组列表。纯本地计算，不用请求
  applyFilter () {
    const self = this
    const all = self.data.products || []
    const cats = self.data.cats || []
    const kw = String(self.data.keyword || '').trim().toLowerCase()

    const catNameOf = {}
    cats.forEach(function (c) { catNameOf[c._id] = c.name })

    // 先按关键字过滤；分类上的数字也跟着变，免得搜出来的数量和列表对不上
    const base = kw ? all.filter(function (p) {
      const catName = p.catName || catNameOf[p.catId] || '未分类'
      const tags = (p.tags || []).join(' ')
      return (p.name || '').toLowerCase().indexOf(kw) > -1 ||
        catName.toLowerCase().indexOf(kw) > -1 ||
        tags.toLowerCase().indexOf(kw) > -1
    }) : all

    const chips = [
      { k: 'all', n: '全部', c: base.length },
      { k: 'none', n: '未分类', c: base.filter(function (p) { return !p.catId }).length }
    ]
    cats.forEach(function (c) {
      chips.push({ k: c._id, n: c.name, c: base.filter(function (p) { return p.catId === c._id }).length })
    })
    const hiddenCount = base.filter(function (p) { return p.onSale === false }).length
    if (hiddenCount) chips.push({ k: 'hidden', n: '已隐藏', c: hiddenCount })

    // 选中的分类被删掉时自动回到「全部」
    let active = self.data.catFilter || 'all'
    if (active !== 'all' && active !== 'none' && active !== 'hidden' && !catNameOf[active]) active = 'all'

    let list = base
    if (active === 'none') list = base.filter(function (p) { return !p.catId })
    else if (active === 'hidden') list = base.filter(function (p) { return p.onSale === false })
    else if (active !== 'all') list = base.filter(function (p) { return p.catId === active })

    // 按分类分组，顺序跟分类列表一致，没分类的排最后
    const groups = []
    const bucket = {}
    cats.forEach(function (c) {
      const g = { key: c._id, name: c.name, products: [] }
      bucket[c._id] = g
      groups.push(g)
    })
    const noneGroup = { key: '_none', name: '未分类', products: [] }
    list.forEach(function (p) {
      const g = bucket[p.catId] || noneGroup
      g.products.push(p)
    })
    if (noneGroup.products.length) groups.push(noneGroup)

    self.setData({
      catChips: chips,
      catFilter: active,
      groups: groups.filter(function (g) { return g.products.length }),
      shownCount: list.length
    })
  },

  toggleCatPanel () {
    this.setData({ catOpen: !this.data.catOpen })
  },

  onSearch (e) {
    const self = this
    this.setData({ keyword: e.detail.value }, function () { self.applyFilter() })
  },

  clearSearch () {
    const self = this
    this.setData({ keyword: '' }, function () { self.applyFilter() })
  },

  onCatFilter (e) {
    const self = this
    this.setData({ catFilter: e.currentTarget.dataset.k }, function () { self.applyFilter() })
  },

  // 让「在售」开关不触发行点击（整行点了是进编辑）
  stopTap () {},

  toggleSale (e) {
    const self = this
    const id = e.currentTarget.dataset.id
    const on = e.detail.value
    api.call('adminToggleProduct', { id: id, onSale: on })
      .then(function () {
        wx.showToast({ title: on ? '已在目录展示' : '已从目录隐藏', icon: 'none' })
        self.loadProducts()
      })
      .catch(function (err) {
        wx.showModal({ title: '失败', content: err.message, showCancel: false })
        self.loadProducts()
      })
  },

  editProduct (e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/admin-product/index?id=' + (id || '') })
  },

  /* ---------------------------------------------------- 分类管理 */
  onCatName (e) {
    const patch = {}
    patch['catNames.' + e.currentTarget.dataset.id] = e.detail.value
    this.setData(patch)
  },

  saveCat (e) {
    const self = this
    const id = e.currentTarget.dataset.id
    // 没改过输入框时 catNames 里没有这一项，回落到界面上原来的名字
    const name = String(this.data.catNames[id] || e.currentTarget.dataset.name || '').trim()
    if (!name) return wx.showToast({ title: '分类名不能为空', icon: 'none' })
    api.call('adminSaveCategory', { id: id, name: name })
      .then(function () {
        wx.showToast({ title: '已保存', icon: 'success' })
        self.loadProducts()
      })
      .catch(function (err) {
        wx.showModal({ title: '失败', content: err.message, showCancel: false })
      })
  },

  addCat () {
    const self = this
    const name = String(this.data.newCat || '').trim()
    if (!name) return wx.showToast({ title: '填一下分类名', icon: 'none' })
    api.call('adminSaveCategory', { name: name })
      .then(function () {
        self.setData({ newCat: '' })
        wx.showToast({ title: '已添加', icon: 'success' })
        self.loadProducts()
      })
      .catch(function (err) {
        wx.showModal({ title: '失败', content: err.message, showCancel: false })
      })
  },

  delCat (e) {
    const self = this
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除这个分类？',
      content: '分类下还有商品时会删不掉。',
      confirmColor: '#B4472E',
      success: function (r) {
        if (!r.confirm) return
        api.call('adminDeleteCategory', { id: id })
          .then(function () {
            wx.showToast({ title: '已删除', icon: 'success' })
            self.loadProducts()
          })
          .catch(function (err) {
            wx.showModal({ title: '删不了', content: err.message, showCancel: false })
          })
      }
    })
  },

  /* ---------------------------------------------------- 设置 */
  loadSettings () {
    const self = this
    this.setData({ loading: true, err: '' })
    return api.call('adminGetSettings')
      .then(function (d) {
        self.setData({ loading: false, s: d.settings || {} })
      })
      .catch(function (e) {
        self.setData({ loading: false, err: e.message })
      })
  },

  onSetInput (e) {
    const k = e.currentTarget.dataset.k
    const patch = {}
    patch['s.' + k] = e.detail.value
    this.setData(patch)
  },

  // 「新分类」输入框单独处理：不能走 onSetInput，那是给店铺设置（s.xxx）用的
  onCatInput (e) {
    this.setData({ newCat: e.detail.value })
  },

  saveSettings () {
    const self = this
    wx.showLoading({ title: '保存中', mask: true })
    api.call('adminSaveSettings', { settings: this.data.s })
      .then(function () {
        wx.hideLoading()
        wx.showToast({ title: '已保存', icon: 'success' })
        return app.refreshUser()
      })
      .then(function () { self.loadSettings() })
      .catch(function (e) {
        wx.hideLoading()
        wx.showModal({ title: '失败', content: e.message, showCancel: false })
      })
  }
})
