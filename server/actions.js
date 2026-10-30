/**
 * 业务逻辑：和小程序云函数版（cloudfunctions/shopapi）一一对应，
 * 只是数据存取换成了 JSON 文件。前端调用的 action 名字完全不变。
 */
const fs = require('fs')
const path = require('path')
const store = require('./lib/store')

const STATUS = ['pending', 'quoted', 'paid', 'shipped', 'done', 'cancelled']
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads')

const num = function (v, dft) {
  const n = Number(v)
  return isFinite(n) ? n : (dft === undefined ? 0 : dft)
}
const round2 = function (n) { return Math.round(n * 100) / 100 }
const now = function () { return new Date().toISOString() }
const pad2 = function (n) { return n < 10 ? '0' + n : '' + n }

function publicSettings (s) {
  s = s || {}
  return {
    shopName: s.shopName || '家乡特产',
    slogan: s.slogan || '',
    notice: s.notice || '',
    phone: s.phone || '',
    freightNote: s.freightNote || '提交登记后我联系你确认运费',
    pickupNote: s.pickupNote || '同城/公司可自取'
  }
}

function isAdmin (openid) {
  const s = store.getSettings()
  return !!s && (s.adminOpenids || []).indexOf(openid) > -1
}

function requireAdmin (openid) {
  if (!isAdmin(openid)) {
    throw new Error('没有管理权限（管理员 openid 白名单在 data/db.json 的 settings.adminOpenids 里）')
  }
}

function slim (p) {
  return {
    _id: p._id,
    name: p.name,
    catId: p.catId || '',
    catName: p.catName || '',
    price: p.price || 0,
    unit: p.unit || '份',
    desc: p.desc || '',
    cover: p.cover || (p.images && p.images[0]) || '',
    stock: (p.stock === undefined || p.stock === null) ? null : p.stock,
    onSale: p.onSale !== false,
    tags: p.tags || []
  }
}

/* ------------------------------------------------------------ 初始化 */
function bootstrap (openid) {
  const exist = store.getSettings()
  if (exist) return { already: true, shopName: exist.shopName }

  store.setSettings({
    shopName: '老家特产小铺',
    slogan: '老家直发 · 熟人小单',
    notice: '看货 + 登记，运费和总额微信确认，小程序不收钱。',
    phone: '',
    freightNote: '满138元包邮，部分地区需补差价',
    adminOpenids: [openid],
    createdAt: now(),
    updatedAt: now()
  })

  // 只建店铺本身，不写示例商品和分类：商品、分类都由店主自己在后台加
  return { already: false }
}

/* ------------------------------------------------------------ 身份 */
function me (openid) {
  const s = store.getSettings()
  const u = store.getUser(openid)
  return {
    openid: openid,
    isAdmin: isAdmin(openid),
    needInit: !s,
    settings: publicSettings(s),
    user: u ? { name: u.name || '', phone: u.phone || '' } : null,
    backend: 'http'
  }
}

function saveContact (openid, e) {
  const c = (e && e.contact) || {}
  store.setUser(openid, {
    name: String(c.name || '').trim(),
    phone: String(c.phone || '').trim()
  })
  return { ok: true }
}

/* ------------------------------------------------------------ 首页 / 商品 */
function getHome (openid) {
  const s = store.getSettings()
  if (!s) {
    return { needInit: true, isAdmin: false, categories: [], products: [], settings: publicSettings(null) }
  }
  const cats = store.list('categories').slice()
    .sort(function (a, b) { return (b.sort || 0) - (a.sort || 0) })
    .map(function (c) { return { _id: c._id, name: c.name } })
  const prods = store.list('products').slice()
    .filter(function (p) { return p.onSale !== false })
    .sort(function (a, b) { return (b.sort || 0) - (a.sort || 0) })
    .map(slim)
  return {
    needInit: false,
    isAdmin: isAdmin(openid),
    categories: cats,
    products: prods,
    settings: publicSettings(s)
  }
}

function getProducts (openid, e) {
  const list = Array.isArray(e && e.ids) ? e.ids : []
  return list.map(function (id) {
    const p = store.findById('products', id)
    if (!p) return null
    return Object.assign(slim(p), { images: p.images || [] })
  }).filter(Boolean)
}

/* ------------------------------------------------------------ 下单 */
function createOrder (openid, e) {
  const items = Array.isArray(e.items) ? e.items : []
  if (!items.length) throw new Error('还没有选择商品')

  const contact = e.contact || {}
  const name = String(contact.name || '').trim()
  const phone = String(contact.phone || '').trim()
  if (!name) throw new Error('请填写你的姓名')
  if (!/^1\d{10}$/.test(phone)) throw new Error('手机号像是填错了')

  const mode = e.mode === 'pickup' ? 'pickup' : 'express'
  const address = String(e.address || '').trim()
  if (mode === 'express' && address.length < 5) throw new Error('请填写收货地址（方便我算运费）')

  const lines = []
  let amount = 0
  items.forEach(function (it) {
    const p = store.findById('products', it.productId)
    if (!p) throw new Error('有商品已下架，请返回重新选择')
    if (p.onSale === false) throw new Error('「' + p.name + '」已经下架了，换一个吧')
    const qty = Math.max(1, Math.min(999, parseInt(it.qty, 10) || 1))
    amount += num(p.price) * qty
    lines.push({ productId: p._id, name: p.name, unit: p.unit || '份', price: num(p.price), qty: qty, cover: p.cover || '' })
  })
  amount = round2(amount)

  const d = new Date()
  const orderNo = 'TC' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
    '-' + String(Math.floor(Math.random() * 9000) + 1000)

  const order = store.insert('orders', {
    orderNo: orderNo,
    openid: openid,
    items: lines,
    amount: amount,
    freight: 0,
    contact: { name: name, phone: phone },
    mode: mode,
    address: address,
    remark: String(e.remark || '').trim().slice(0, 200),
    status: 'pending',
    adminNote: '',
    logs: [{ status: 'pending', at: now(), by: 'user' }],
    createdAt: now(),
    updatedAt: now()
  })

  try { store.setUser(openid, { name: name, phone: phone }) } catch (err) {}

  return { orderId: order._id, orderNo: orderNo, amount: amount, status: 'pending' }
}

function myOrders (openid) {
  return store.list('orders')
    .filter(function (o) { return o.openid === openid })
    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)) })
    .slice(0, 50)
}

function cancelOrder (openid, e) {
  const id = e && e.id
  const o = store.findById('orders', id)
  if (!o) throw new Error('订单不存在')
  if (o.openid !== openid) throw new Error('只能取消自己的订单')
  if (['pending', 'quoted'].indexOf(o.status) === -1) throw new Error('这个订单已经处理了，不能自助取消，直接微信找我吧')
  const log = { status: 'cancelled', at: now(), by: 'user' }
  store.update('orders', id, { status: 'cancelled', updatedAt: now(), logs_push: [log] })
  return { ok: true }
}

/* ------------------------------------------------------------ 管理端：订单 */
function adminListOrders (openid, e) {
  requireAdmin(openid)
  const status = e && e.status
  let rows = store.list('orders').slice()
  const counts = {}
  STATUS.forEach(function (k) {
    counts[k] = rows.filter(function (o) { return o.status === k }).length
  })
  counts.all = rows.length
  if (status && status !== 'all') rows = rows.filter(function (o) { return o.status === status })
  rows.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)) })
  return { list: rows.slice(0, 100), counts: counts }
}

function adminUpdateOrder (openid, e) {
  requireAdmin(openid)
  if (!e.id) throw new Error('缺少订单号')
  const o = store.findById('orders', e.id)
  if (!o) throw new Error('订单不存在')

  const patch = { updatedAt: now() }
  const log = { at: now(), by: openid }

  if (e.status) {
    if (STATUS.indexOf(e.status) === -1) throw new Error('未知状态')
    patch.status = e.status
    log.status = e.status
  }
  if (e.freight !== undefined && e.freight !== null && e.freight !== '') {
    const f = num(e.freight, 0)
    if (f < 0) throw new Error('运费不能是负数')
    patch.freight = round2(f)
    log.freight = patch.freight
  }
  if (e.adminNote !== undefined) patch.adminNote = String(e.adminNote || '').slice(0, 300)
  if (log.status || log.freight !== undefined) patch.logs_push = [log]

  store.update('orders', e.id, patch)
  return { ok: true }
}

/* ------------------------------------------------------------ 管理端：商品 */
function adminListProducts (openid) {
  requireAdmin(openid)
  const products = store.list('products').slice()
    .sort(function (a, b) { return (b.sort || 0) - (a.sort || 0) })
  const categories = store.list('categories').slice()
    .sort(function (a, b) { return (b.sort || 0) - (a.sort || 0) })
    .map(function (c) { return { _id: c._id, name: c.name } })
  return { products: products, categories: categories }
}

function adminSaveProduct (openid, e) {
  requireAdmin(openid)
  const p = e.product || {}
  const name = String(p.name || '').trim()
  if (!name) throw new Error('请填写商品名')
  const price = num(p.price, -1)
  if (price < 0) throw new Error('请填写正确的价格')

  const cat = p.catId ? store.findById('categories', p.catId) : null

  const data = {
    name: name,
    catId: p.catId || '',
    catName: (cat && cat.name) || p.catName || '',
    price: round2(price),
    unit: String(p.unit || '份').trim(),
    desc: String(p.desc || '').slice(0, 2000),
    cover: p.cover || '',
    images: Array.isArray(p.images) ? p.images.slice(0, 9) : [],
    stock: (p.stock === '' || p.stock === undefined || p.stock === null) ? null : num(p.stock, null),
    tags: Array.isArray(p.tags) ? p.tags.slice(0, 6) : [],
    sort: num(p.sort, 0),
    onSale: p.onSale !== false,
    updatedAt: now()
  }

  if (p._id) {
    if (!store.findById('products', p._id)) throw new Error('商品不存在')
    store.update('products', p._id, data)
    return { _id: p._id }
  }
  data.createdAt = now()
  const row = store.insert('products', data)
  return { _id: row._id }
}

function adminToggleProduct (openid, e) {
  requireAdmin(openid)
  if (!e.id) throw new Error('缺少商品 id')
  if (!store.findById('products', e.id)) throw new Error('商品不存在')
  store.update('products', e.id, { onSale: e.onSale !== false, updatedAt: now() })
  return { ok: true }
}

function adminDeleteProduct (openid, e) {
  requireAdmin(openid)
  if (!e.id) throw new Error('缺少商品 id')
  store.remove('products', e.id)
  return { ok: true }
}

/* ------------------------------------------------------------ 管理端：分类 */
function adminSaveCategory (openid, e) {
  requireAdmin(openid)
  const name = String((e && e.name) || '').trim()
  if (!name) throw new Error('请填写分类名')
  if (name.length > 10) throw new Error('分类名别超过 10 个字')
  const dup = store.list('categories').some(function (c) {
    return c.name === name && c._id !== (e && e.id)
  })
  if (dup) throw new Error('已有同名分类')

  if (e && e.id) {
    const old = store.findById('categories', e.id)
    if (!old) throw new Error('分类不存在')
    store.update('categories', e.id, { name: name })
    // 同步商品上的冗余分类名
    store.list('products').forEach(function (p) {
      if (p.catId === e.id) store.update('products', p._id, { catName: name })
    })
    return { _id: e.id }
  }
  const maxSort = store.list('categories').reduce(function (m, c) { return Math.max(m, c.sort || 0) }, 0)
  const row = store.insert('categories', { name: name, sort: maxSort + 1, createdAt: now() })
  return { _id: row._id }
}

function adminDeleteCategory (openid, e) {
  requireAdmin(openid)
  if (!e || !e.id) throw new Error('缺少分类 id')
  const used = store.list('products').some(function (p) { return p.catId === e.id })
  if (used) throw new Error('这个分类下还有商品，先移走或删除商品')
  store.remove('categories', e.id)
  return { ok: true }
}

/* ------------------------------------------------------------ 管理端：设置 */
function adminGetSettings (openid) {
  requireAdmin(openid)
  const s = store.getSettings() || {}
  return {
    settings: {
      shopName: s.shopName || '',
      slogan: s.slogan || '',
      notice: s.notice || '',
      phone: s.phone || '',
      freightNote: s.freightNote || '',
      pickupNote: s.pickupNote || '',
      adminOpenids: s.adminOpenids || []
    }
  }
}

function adminSaveSettings (openid, e) {
  requireAdmin(openid)
  const p = e.settings || {}
  const s = store.getSettings() || {}
  const merged = Object.assign({}, s, {
    shopName: String(p.shopName || '').slice(0, 30) || '家乡特产',
    slogan: String(p.slogan || '').slice(0, 40),
    notice: String(p.notice || '').slice(0, 200),
    phone: String(p.phone || '').slice(0, 20),
    freightNote: String(p.freightNote || '').slice(0, 100),
    pickupNote: String(p.pickupNote || '').slice(0, 100),
    updatedAt: now()
  })
  store.setSettings(merged)
  return { ok: true }
}

/* ------------------------------------------------------------ 图片上传（base64） */
function upload (openid, e) {
  requireAdmin(openid)
  const data = String(e.data || '')
  const m = data.match(/^data:image\/(\w+);base64,(.+)$/)
  const raw = m ? m[2] : data
  const ext = (m && m[1] === 'jpeg') ? 'jpg' : ((m && m[1]) || String(e.ext || 'jpg').replace(/[^a-z0-9]/gi, ''))
  if (!raw) throw new Error('没有收到图片数据')
  const buf = Buffer.from(raw, 'base64')
  if (buf.length > 6 * 1024 * 1024) throw new Error('图片太大（上限 6MB）')
  const name = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf)
  return { url: '/uploads/' + name, fileID: '/uploads/' + name }
}

/* ------------------------------------------------------------ 路由 */
const HANDLERS = {
  bootstrap: bootstrap,
  me: function (openid) { return me(openid) },
  saveContact: saveContact,
  getHome: function (openid) { return getHome(openid) },
  getProducts: getProducts,
  createOrder: createOrder,
  myOrders: function (openid) { return myOrders(openid) },
  cancelOrder: cancelOrder,
  adminListOrders: adminListOrders,
  adminUpdateOrder: adminUpdateOrder,
  adminListProducts: function (openid) { return adminListProducts(openid) },
  adminSaveProduct: adminSaveProduct,
  adminToggleProduct: adminToggleProduct,
  adminDeleteProduct: adminDeleteProduct,
  adminSaveCategory: adminSaveCategory,
  adminDeleteCategory: adminDeleteCategory,
  adminGetSettings: function (openid) { return adminGetSettings(openid) },
  adminSaveSettings: adminSaveSettings,
  upload: upload
}

function dispatch (openid, action, payload) {
  const fn = HANDLERS[action]
  if (!fn) throw new Error('未知操作：' + action)
  return fn(openid, payload || {})
}

module.exports = { dispatch: dispatch, HANDLERS: HANDLERS }
