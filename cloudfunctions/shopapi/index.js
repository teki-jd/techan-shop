const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const C = {
  settings: 'settings',
  categories: 'categories',
  products: 'products',
  orders: 'orders',
  users: 'users'
}

const ok = function (d) { return { ok: true, data: d } }
const bad = function (m) { return { ok: false, msg: m } }

const num = function (v, dft) {
  const n = Number(v)
  return isFinite(n) ? n : (dft === undefined ? 0 : dft)
}
const round2 = function (n) { return Math.round(n * 100) / 100 }

/** 集合不存在时自动创建（重复创建会报错，忽略即可） */
async function ensureCollections () {
  for (const k in C) {
    try { await db.createCollection(C[k]) } catch (e) { /* 已存在 或 不支持自动创建 */ }
  }
}

/** 兜底检查：确认集合真的存在，否则给一句人话提示 */
async function assertCollections () {
  const missing = []
  for (const k in C) {
    try {
      await db.collection(C[k]).limit(1).get()
    } catch (e) {
      const msg = (e && e.message) || ''
      const code = String((e && e.errCode) || '')
      if (code === '-502005' || /not exist|NOT_EXIST|collection/i.test(msg)) missing.push(C[k])
    }
  }
  if (missing.length) {
    throw new Error('云函数没有自动建集合的权限。请到 云开发控制台 → 数据库 手动新建这几个集合：' +
      missing.join('、') + '，然后再点一次「初始化店铺数据」。')
  }
}

async function getSettings () {
  try {
    const r = await db.collection(C.settings).doc('shop').get()
    return r.data || null
  } catch (e) {
    return null
  }
}

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

function requireAdmin (openid, s) {
  const list = (s && s.adminOpenids) || []
  if (list.indexOf(openid) === -1) {
    throw new Error('没有管理权限（如刚换过微信，请在云数据库 settings 的 adminOpenids 里加上你的 openid）')
  }
}

/* ------------------------------------------------------------------ 初始化 */
async function bootstrap (openid) {
  await ensureCollections()
  await assertCollections()
  const exist = await getSettings()
  if (exist) {
    return { already: true, shopName: exist.shopName }
  }

  await db.collection(C.settings).doc('shop').set({
    data: {
      shopName: '老家特产小铺',
      slogan: '老家直发 · 熟人小单',
      notice: '看货 + 登记，运费和总额微信确认，小程序不收钱。',
      phone: '',
      freightNote: '满138元包邮，部分地区需补差价',
      adminOpenids: [openid],
      createdAt: new Date(),
      updatedAt: new Date()
    }
  })

  // 只建店铺本身，不写示例商品和分类：商品、分类都由店主自己在后台加
  return { already: false }
}

/* ------------------------------------------------------------------ 首页 */
async function getHome (openid) {
  const s = await getSettings()
  if (!s) {
    return { needInit: true, isAdmin: false, categories: [], products: [], settings: publicSettings(null) }
  }
  const cats = await db.collection(C.categories).orderBy('sort', 'desc').limit(50).get()
    .then(function (r) { return r.data })
    .catch(function () { return [] })
  const prods = await db.collection(C.products).orderBy('sort', 'desc').limit(200).get()
    .then(function (r) { return r.data })
    .catch(function () { return [] })

  const list = prods
    .filter(function (p) { return p.onSale !== false })
    .map(function (p) { return slim(p) })

  return {
    needInit: false,
    isAdmin: ((s.adminOpenids) || []).indexOf(openid) > -1,
    categories: cats.map(function (c) { return { _id: c._id, name: c.name } }),
    products: list,
    settings: publicSettings(s)
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

/* ------------------------------------------------------------------ 商品详情 */
async function getProducts (openid, ids) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : []
  if (!list.length) return []
  const r = await db.collection(C.products).where({ _id: _.in(list) }).get()
  const map = {}
  r.data.forEach(function (p) { map[p._id] = p })
  return list.map(function (id) {
    const p = map[id]
    if (!p) return null
    return Object.assign(slim(p), { images: p.images || [] })
  }).filter(Boolean)
}

/* ------------------------------------------------------------------ 下单 */
async function createOrder (openid, e) {
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

  const ids = items.map(function (i) { return i.productId }).filter(Boolean)
  const prods = await getProducts(openid, ids)
  const map = {}
  prods.forEach(function (p) { map[p._id] = p })

  const lines = []
  let amount = 0
  for (const it of items) {
    const p = map[it.productId]
    if (!p) throw new Error('有商品已下架，请返回重新选择')
    if (p.onSale === false) throw new Error('「' + p.name + '」已经下架了，换一个吧')
    const qty = Math.max(1, Math.min(999, parseInt(it.qty, 10) || 1))
    amount += num(p.price) * qty
    lines.push({ productId: p._id, name: p.name, unit: p.unit, price: num(p.price), qty: qty, cover: p.cover || '' })
  }
  amount = round2(amount)

  const now = new Date()
  const ymd = now.getFullYear() + pad2(now.getMonth() + 1) + pad2(now.getDate())
  const rnd = String(Math.floor(Math.random() * 9000) + 1000)
  const orderNo = 'TC' + ymd + '-' + rnd

  const doc = {
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
    logs: [{ status: 'pending', at: now, by: 'user' }],
    createdAt: now,
    updatedAt: now
  }
  const r = await db.collection(C.orders).add({ data: doc })

  // 顺手记住联系方式
  try {
    await db.collection(C.users).doc(openid).set({
      data: { name: name, phone: phone, updatedAt: now }
    })
  } catch (err) { /* 不影响下单 */ }

  return { orderId: r._id, orderNo: orderNo, amount: amount, status: 'pending' }
}

function pad2 (n) { return n < 10 ? '0' + n : '' + n }

/* ------------------------------------------------------------------ 我的订单 */
async function myOrders (openid) {
  const r = await db.collection(C.orders).where({ openid: openid })
    .orderBy('createdAt', 'desc').limit(50).get()
  return r.data
}

async function cancelOrder (openid, id) {
  if (!id) throw new Error('缺少订单号')
  const r = await db.collection(C.orders).doc(id).get()
  const o = r.data
  if (!o) throw new Error('订单不存在')
  if (o.openid !== openid) throw new Error('只能取消自己的订单')
  if (['pending', 'quoted'].indexOf(o.status) === -1) throw new Error('这个订单已经处理了，不能自助取消，直接微信找我吧')
  await db.collection(C.orders).doc(id).update({
    data: {
      status: 'cancelled',
      updatedAt: new Date(),
      logs: _.push([{ status: 'cancelled', at: new Date(), by: 'user' }])
    }
  })
  return { ok: true }
}

/* ------------------------------------------------------------------ 身份 */
async function me (openid) {
  const s = await getSettings()
  let user = null
  try {
    const r = await db.collection(C.users).doc(openid).get()
    user = r.data || null
  } catch (e) { user = null }
  return {
    openid: openid,
    isAdmin: !!s && ((s.adminOpenids) || []).indexOf(openid) > -1,
    needInit: !s,
    settings: publicSettings(s),
    user: user
  }
}

async function saveContact (openid, contact) {
  const c = contact || {}
  await db.collection(C.users).doc(openid).set({
    data: {
      name: String(c.name || '').trim(),
      phone: String(c.phone || '').trim(),
      updatedAt: new Date()
    }
  })
  return { ok: true }
}

/* ------------------------------------------------------------------ 管理端：订单 */
async function adminListOrders (openid, e) {
  const s = await getSettings()
  requireAdmin(openid, s)
  const status = e && e.status
  let q = db.collection(C.orders)
  if (status && status !== 'all') {
    q = q.where({ status: status })
  }
  const r = await q.orderBy('createdAt', 'desc').limit(100).get()

  // 各状态数量（用于筛选栏角标）
  const counts = {}
  const keys = ['pending', 'quoted', 'paid', 'shipped', 'done', 'cancelled']
  await Promise.all(keys.map(function (k) {
    return db.collection(C.orders).where({ status: k }).count()
      .then(function (c) { counts[k] = c.total })
      .catch(function () { counts[k] = 0 })
  }))

  return { list: r.data, counts: counts, adminOpenids: s.adminOpenids || [] }
}

async function adminUpdateOrder (openid, e) {
  const s = await getSettings()
  requireAdmin(openid, s)
  const id = e.id
  if (!id) throw new Error('缺少订单号')

  const patch = { updatedAt: new Date() }
  const log = { at: new Date(), by: openid }

  if (e.status) {
    const allow = ['pending', 'quoted', 'paid', 'shipped', 'done', 'cancelled']
    if (allow.indexOf(e.status) === -1) throw new Error('未知状态')
    patch.status = e.status
    log.status = e.status
  }
  if (e.freight !== undefined && e.freight !== null && e.freight !== '') {
    const f = num(e.freight, 0)
    if (f < 0) throw new Error('运费不能是负数')
    patch.freight = round2(f)
    log.freight = patch.freight
  }
  if (e.adminNote !== undefined) {
    patch.adminNote = String(e.adminNote || '').slice(0, 300)
  }
  if (log.status || log.freight !== undefined) {
    patch.logs = _.push([log])
  }

  await db.collection(C.orders).doc(id).update({ data: patch })
  return { ok: true }
}

/* ------------------------------------------------------------------ 管理端：商品 */
async function adminListProducts (openid) {
  const s = await getSettings()
  requireAdmin(openid, s)
  const prods = await db.collection(C.products).orderBy('sort', 'desc').limit(200).get()
    .then(function (r) { return r.data }).catch(function () { return [] })
  const cats = await db.collection(C.categories).orderBy('sort', 'desc').limit(50).get()
    .then(function (r) { return r.data }).catch(function () { return [] })
  return { products: prods, categories: cats.map(function (c) { return { _id: c._id, name: c.name } }) }
}

async function adminSaveProduct (openid, e) {
  const s = await getSettings()
  requireAdmin(openid, s)
  const p = e.product || {}
  const name = String(p.name || '').trim()
  if (!name) throw new Error('请填写商品名')
  const price = num(p.price, -1)
  if (price < 0) throw new Error('请填写正确的价格')

  const cats = await db.collection(C.categories).where({ _id: p.catId }).limit(1).get()
    .then(function (r) { return r.data }).catch(function () { return [] })

  const data = {
    name: name,
    catId: p.catId || '',
    catName: (cats[0] && cats[0].name) || p.catName || '',
    price: round2(price),
    unit: String(p.unit || '份').trim(),
    desc: String(p.desc || '').slice(0, 2000),
    cover: p.cover || '',
    images: Array.isArray(p.images) ? p.images.slice(0, 9) : [],
    stock: (p.stock === '' || p.stock === undefined || p.stock === null) ? null : num(p.stock, null),
    tags: Array.isArray(p.tags) ? p.tags.slice(0, 6) : [],
    sort: num(p.sort, 0),
    onSale: p.onSale !== false,
    updatedAt: new Date()
  }

  if (p._id) {
    await db.collection(C.products).doc(p._id).update({ data: data })
    return { _id: p._id }
  }
  data.createdAt = new Date()
  const r = await db.collection(C.products).add({ data: data })
  return { _id: r._id }
}

async function adminToggleProduct (openid, e) {
  const s = await getSettings()
  requireAdmin(openid, s)
  if (!e.id) throw new Error('缺少商品 id')
  await db.collection(C.products).doc(e.id).update({
    data: { onSale: e.onSale !== false, updatedAt: new Date() }
  })
  return { ok: true }
}

async function adminDeleteProduct (openid, e) {
  const s = await getSettings()
  requireAdmin(openid, s)
  if (!e.id) throw new Error('缺少商品 id')
  await db.collection(C.products).doc(e.id).remove()
  return { ok: true }
}

/* ------------------------------------------------------------------ 管理端：分类 */
async function adminSaveCategory (openid, e) {
  const s = await getSettings()
  requireAdmin(openid, s)
  const name = String((e && e.name) || '').trim()
  if (!name) throw new Error('请填写分类名')
  if (name.length > 10) throw new Error('分类名别超过 10 个字')

  const all = await db.collection(C.categories).limit(100).get()
    .then(function (r) { return r.data }).catch(function () { return [] })
  if (all.some(function (c) { return c.name === name && c._id !== (e && e.id) })) {
    throw new Error('已有同名分类')
  }

  if (e && e.id) {
    if (!all.some(function (c) { return c._id === e.id })) throw new Error('分类不存在')
    await db.collection(C.categories).doc(e.id).update({ data: { name: name } })
    // 同步商品上的冗余分类名
    await db.collection(C.products).where({ catId: e.id }).update({ data: { catName: name } })
    return { _id: e.id }
  }
  const maxSort = all.reduce(function (m, c) { return Math.max(m, c.sort || 0) }, 0)
  const r = await db.collection(C.categories).add({
    data: { name: name, sort: maxSort + 1, createdAt: new Date() }
  })
  return { _id: r._id }
}

async function adminDeleteCategory (openid, e) {
  const s = await getSettings()
  requireAdmin(openid, s)
  if (!e || !e.id) throw new Error('缺少分类 id')
  const used = await db.collection(C.products).where({ catId: e.id }).limit(1).get()
    .then(function (r) { return r.data.length > 0 }).catch(function () { return false })
  if (used) throw new Error('这个分类下还有商品，先移走或删除商品')
  await db.collection(C.categories).doc(e.id).remove()
  return { ok: true }
}

/* ------------------------------------------------------------------ 管理端：店铺设置 */
async function adminGetSettings (openid) {
  const s = await getSettings()
  requireAdmin(openid, s)
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

async function adminSaveSettings (openid, e) {
  const s = await getSettings()
  requireAdmin(openid, s)
  const p = e.settings || {}
  const patch = {
    shopName: String(p.shopName || '').slice(0, 30) || '家乡特产',
    slogan: String(p.slogan || '').slice(0, 40),
    notice: String(p.notice || '').slice(0, 200),
    phone: String(p.phone || '').slice(0, 20),
    freightNote: String(p.freightNote || '').slice(0, 100),
    pickupNote: String(p.pickupNote || '').slice(0, 100),
    updatedAt: new Date()
  }
  await db.collection(C.settings).doc('shop').update({ data: patch })
  return { ok: true }
}

/* ------------------------------------------------------------------ 入口 */
exports.main = async function (event, context) {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const action = (event && event.action) || ''

  try {
    switch (action) {
      case 'bootstrap': return ok(await bootstrap(openid))
      case 'me': return ok(await me(openid))
      case 'saveContact': return ok(await saveContact(openid, event.contact))
      case 'getHome': return ok(await getHome(openid))
      case 'getProducts': return ok(await getProducts(openid, event.ids))
      case 'createOrder': return ok(await createOrder(openid, event))
      case 'myOrders': return ok(await myOrders(openid))
      case 'cancelOrder': return ok(await cancelOrder(openid, event.id))
      case 'adminListOrders': return ok(await adminListOrders(openid, event))
      case 'adminUpdateOrder': return ok(await adminUpdateOrder(openid, event))
      case 'adminListProducts': return ok(await adminListProducts(openid))
      case 'adminSaveProduct': return ok(await adminSaveProduct(openid, event))
      case 'adminToggleProduct': return ok(await adminToggleProduct(openid, event))
      case 'adminDeleteProduct': return ok(await adminDeleteProduct(openid, event))
      case 'adminSaveCategory': return ok(await adminSaveCategory(openid, event))
      case 'adminDeleteCategory': return ok(await adminDeleteCategory(openid, event))
      case 'adminGetSettings': return ok(await adminGetSettings(openid))
      case 'adminSaveSettings': return ok(await adminSaveSettings(openid, event))
      default: return bad('未知操作：' + action)
    }
  } catch (e) {
    console.warn('[shopapi]', action, (e && e.message) || e)
    return { ok: false, msg: (e && e.message) || '服务异常' }
  }
}
