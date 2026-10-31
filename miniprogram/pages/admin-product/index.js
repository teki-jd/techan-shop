const app = getApp()
const api = require('../../utils/api')

Page({
  data: {
    id: '',
    loading: true,
    saving: false,
    cats: [],
    catNames: [],
    catIndex: 0,
    p: {
      name: '',
      catId: '',
      price: '',
      unit: '份',
      stock: '',
      desc: '',
      cover: '',
      images: [],
      tagsText: '',
      sort: 0,
      onSale: true
    }
  },

  onLoad (q) {
    const self = this
    const id = q.id || ''
    this.setData({ id: id, loading: true })
    wx.setNavigationBarTitle({ title: id ? '编辑条目' : '新增条目' })

    api.call('adminListProducts')
      .then(function (d) {
        const cats = d.categories || []
        const catNames = cats.map(function (c) { return c.name })
        let p = self.data.p
        let idx = 0
        if (id) {
          const hit = (d.products || []).find(function (x) { return x._id === id })
          if (hit) {
            p = {
              name: hit.name || '',
              catId: hit.catId || '',
              price: hit.price === undefined ? '' : String(hit.price),
              unit: hit.unit || '份',
              stock: hit.stock === null || hit.stock === undefined ? '' : String(hit.stock),
              desc: hit.desc || '',
              cover: hit.cover || '',
              images: hit.images || [],
              tagsText: (hit.tags || []).join('，'),
              sort: hit.sort || 0,
              onSale: hit.onSale !== false
            }
            idx = Math.max(0, cats.findIndex(function (c) { return c._id === p.catId }))
          }
        }
        self.setData({ loading: false, cats: cats, catNames: catNames, catIndex: idx, p: p })
        // 新增时先替用户选上第一个分类，避免存成没有分类、切分类就看不到的条目
        if (!p.catId && cats.length) self.setData({ 'p.catId': cats[0]._id })
      })
      .catch(function (e) {
        self.setData({ loading: false })
        wx.showModal({ title: '加载失败', content: e.message, showCancel: false })
      })
  },

  onCat (e) {
    const i = Number(e.detail.value)
    const c = this.data.cats[i]
    this.setData({ catIndex: i, 'p.catId': c ? c._id : '' })
  },

  onInput (e) {
    const k = e.currentTarget.dataset.k
    const patch = {}
    patch['p.' + k] = e.detail.value
    this.setData(patch)
  },

  onSale (e) {
    this.setData({ 'p.onSale': e.detail.value })
  },

  pickCover () {
    const self = this
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: function (r) {
        const path = r.tempFiles[0].tempFilePath
        wx.showLoading({ title: '上传中', mask: true })
        api.uploadImages([path], 'products')
          .then(function (ids) {
            wx.hideLoading()
            self.setData({ 'p.cover': ids[0] })
          })
          .catch(function (e) {
            wx.hideLoading()
            wx.showModal({ title: '上传失败', content: e.message || '请检查云存储权限', showCancel: false })
          })
      }
    })
  },

  addImages () {
    const self = this
    const rest = 9 - this.data.p.images.length
    if (rest <= 0) return wx.showToast({ title: '最多 9 张', icon: 'none' })
    wx.chooseMedia({
      count: rest,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: function (r) {
        const paths = r.tempFiles.map(function (f) { return f.tempFilePath })
        wx.showLoading({ title: '上传中', mask: true })
        api.uploadImages(paths, 'products')
          .then(function (ids) {
            wx.hideLoading()
            self.setData({ 'p.images': self.data.p.images.concat(ids).slice(0, 9) })
          })
          .catch(function (e) {
            wx.hideLoading()
            wx.showModal({ title: '上传失败', content: e.message || '请检查云存储权限', showCancel: false })
          })
      }
    })
  },

  removeImage (e) {
    const i = e.currentTarget.dataset.i
    const imgs = this.data.p.images.slice()
    imgs.splice(i, 1)
    this.setData({ 'p.images': imgs })
  },

  useAsCover (e) {
    const i = e.currentTarget.dataset.i
    this.setData({ 'p.cover': this.data.p.images[i] })
    wx.showToast({ title: '已设为封面', icon: 'none' })
  },

  save () {
    const self = this
    const p = this.data.p
    if (!p.name.trim()) return wx.showToast({ title: '填条目名', icon: 'none' })
    if (String(p.price) === '' || isNaN(Number(p.price))) return wx.showToast({ title: '填价格', icon: 'none' })
    if (this.data.cats.length && !p.catId) return wx.showToast({ title: '先选个分类', icon: 'none' })

    const tags = String(p.tagsText || '')
      .split(/[,，\s]+/)
      .map(function (t) { return t.trim() })
      .filter(Boolean)
      .slice(0, 6)

    const payload = {
      _id: this.data.id || undefined,
      name: p.name,
      catId: p.catId,
      price: Number(p.price),
      unit: p.unit,
      stock: p.stock === '' ? null : Number(p.stock),
      desc: p.desc,
      cover: p.cover || p.images[0] || '',
      images: p.images,
      tags: tags,
      sort: Number(p.sort) || 0,
      onSale: p.onSale !== false
    }

    this.setData({ saving: true })
    wx.showLoading({ title: '保存中', mask: true })
    api.call('adminSaveProduct', { product: payload })
      .then(function () {
        wx.hideLoading()
        self.setData({ saving: false })
        wx.showToast({ title: '已保存', icon: 'success' })
        setTimeout(function () { wx.navigateBack() }, 600)
      })
      .catch(function (e) {
        wx.hideLoading()
        self.setData({ saving: false })
        wx.showModal({ title: '保存失败', content: e.message, showCancel: false })
      })
  },

  del () {
    const self = this
    if (!this.data.id) return wx.navigateBack()
    wx.showModal({
      title: '删除这个条目？',
      content: '删除后不可恢复，已有的登记记录不受影响。',
      confirmText: '删除',
      confirmColor: '#B4472E',
      success: function (r) {
        if (!r.confirm) return
        wx.showLoading({ title: '删除中', mask: true })
        api.call('adminDeleteProduct', { id: self.data.id })
          .then(function () {
            wx.hideLoading()
            wx.navigateBack()
          })
          .catch(function (e) {
            wx.hideLoading()
            wx.showModal({ title: '删除失败', content: e.message, showCancel: false })
          })
      }
    })
  }
})
