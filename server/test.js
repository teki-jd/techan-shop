/**
 * 自建服务器版后端测试（不需要微信、不需要网络）
 * 用法：
 *   终端 1： DEV_MODE=1 PORT=3100 DATA_FILE=/tmp/tc-test.json node index.js
 *   终端 2： node test.js
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3100'

let pass = 0
let fail = 0

function ok (cond, name, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name) } else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')) }
}

async function login (name) {
  const r = await fetch(BASE + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ devOpenid: name })
  })
  const j = await r.json()
  if (!j.ok) throw new Error('登录失败：' + j.msg)
  return j.data.token
}

async function call (token, action, data) {
  const r = await fetch(BASE + '/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(Object.assign({ action }, data || {}))
  })
  const j = await r.json()
  return { ok: j.ok === true, data: j.data, msg: j.msg, status: r.status }
}

;(async function () {
  console.log('\n[0] 服务与鉴权')
  const h = await fetch(BASE + '/api/health').then(function (r) { return r.json() })
  ok(h.ok && h.data.dev === true, 'health 正常，DEV_MODE 已开')

  let r = await fetch(BASE + '/api', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'me' })
  })
  ok(r.status === 401, '没 token 被拒（401）')

  let boss = await login('boss')
  let buyer = await login('kehu1')
  ok(!!boss && !!buyer && boss !== buyer, '两个身份拿到不同 token')

  console.log('\n[1] 初始化')
  r = await call(boss, 'me')
  ok(r.ok && r.data.needInit === true, '新库 needInit=true')
  r = await call(boss, 'bootstrap')
  ok(r.ok && r.data.already === false, '初始化成功', r)

  // 正式版初始化是空店铺（不写示例数据），测试自己造：3 分类 + 4 商品
  r = await call(buyer, 'getHome')
  ok(r.ok && r.data.products.length === 0 && r.data.categories.length === 0,
    '初始化后没有示例商品，是空店铺', r.data && (r.data.products || []).length)
  const catIds = {}
  for (const name of ['山货干货', '时令鲜货', '手工吃食']) {
    const rc = await call(boss, 'adminSaveCategory', { name })
    catIds[name] = rc.data && rc.data._id
  }
  let seedOk = true
  for (const g of [
    ['野生黑木耳', '山货干货', 38, '袋(250g)'],
    ['土蜂蜜', '手工吃食', 88, '瓶(500g)'],
    ['手工红薯粉条', '手工吃食', 26, '袋(500g)'],
    ['当季脆柿', '时令鲜货', 45, '箱(5斤)']
  ]) {
    const rp = await call(boss, 'adminSaveProduct', { product: { name: g[0], catId: catIds[g[1]], price: g[2], unit: g[3], stock: 20 } })
    seedOk = seedOk && rp.ok
  }
  ok(seedOk, '测试数据：3 分类 + 4 商品已建好')
  r = await call(buyer, 'bootstrap')
  ok(r.ok && r.data.already === true, '重复初始化被拦')
  r = await call(boss, 'me')
  ok(r.ok && r.data.isAdmin === true, 'boss 是管理员')
  r = await call(buyer, 'me')
  ok(r.ok && r.data.isAdmin === false, 'kehu1 不是管理员')

  r = await call(buyer, 'getHome')
  ok(r.ok && r.data.products.length === 4, '首页 4 个在售商品')
  const goods = r.data.products
  const cat = r.data.categories[0]

  r = await call(buyer, 'getProducts', { ids: [goods[0]._id, goods[1]._id] })
  ok(r.ok && r.data.length === 2 && r.data[0].name === goods[0].name, '按 id 批量取商品（结算页核价用）', r)

  r = await call(buyer, 'saveContact', { contact: { name: '小王', phone: '13800138000' } })
  ok(r.ok, '保存默认联系方式')
  r = await call(buyer, 'me')
  ok(r.ok && r.data.user && r.data.user.phone === '13800138000', '下次进来能带出联系方式', r.data && r.data.user)

  console.log('\n[2] 下单')
  const payload = {
    items: [{ productId: goods[0]._id, qty: 2 }, { productId: goods[1]._id, qty: 1 }],
    contact: { name: '小王', phone: '13800138000' },
    mode: 'express',
    address: '广东省深圳市南山区科技园 1 号',
    remark: '周三前要'
  }
  r = await call(buyer, 'createOrder', payload)
  ok(r.ok && r.data.orderNo, '下单成功', r)
  const expect = goods[0].price * 2 + goods[1].price
  ok(r.ok && Math.abs(r.data.amount - expect) < 0.01, '金额按库价重算 = ' + expect, r.data)
  const orderId = r.data.orderId

  r = await call(buyer, 'createOrder', { items: [{ productId: goods[0]._id, qty: 1, price: 0.01 }], contact: payload.contact, mode: 'pickup' })
  ok(r.ok && Math.abs(r.data.amount - goods[0].price) < 0.01, '伪造 price 无效', r.data)

  r = await call(buyer, 'createOrder', Object.assign({}, payload, { address: '' }))
  ok(!r.ok && /地址/.test(r.msg), '快递必须填地址', r)
  r = await call(buyer, 'createOrder', Object.assign({}, payload, { mode: 'pickup', address: '' }))
  ok(r.ok, '自取不要求地址')

  console.log('\n[3] 权限隔离')
  r = await call(buyer, 'myOrders')
  ok(r.ok && r.data.length === 3, '买家看到自己 3 单', r.data && r.data.length)
  r = await call(buyer, 'adminListOrders')
  ok(!r.ok && /权限/.test(r.msg), '非管理员进不了后台')
  r = await call(boss, 'adminListOrders')
  ok(r.ok && r.data.list.length === 3 && r.data.counts.pending === 3, '管理员看到 3 单 + 计数', r.data && r.data.counts)

  console.log('\n[4] 订单流转')
  r = await call(boss, 'adminUpdateOrder', { id: orderId, status: 'quoted', freight: 12 })
  ok(r.ok, '报价 12 元')
  r = await call(buyer, 'myOrders')
  const o1 = r.data.find(function (x) { return x._id === orderId })
  ok(o1.status === 'quoted' && o1.freight === 12, '买家侧同步')
  r = await call(boss, 'adminUpdateOrder', { id: orderId, status: 'paid', adminNote: '明天发出' })
  ok(r.ok, '标记收款 + 留言')
  r = await call(buyer, 'cancelOrder', { id: orderId })
  ok(!r.ok && /已经处理/.test(r.msg), '已付款不能自助取消', r)

  console.log('\n[5] 商品管理')
  r = await call(boss, 'adminSaveProduct', { product: { name: '新到板栗', catId: cat._id, price: 19.9, unit: '袋(500g)', stock: 10, tags: ['当季'] } })
  ok(r.ok && r.data._id, '新增商品')
  const newId = r.data._id
  r = await call(boss, 'adminToggleProduct', { id: newId, onSale: false })
  ok(r.ok, '下架')
  r = await call(buyer, 'createOrder', { items: [{ productId: newId, qty: 1 }], contact: payload.contact, mode: 'pickup' })
  ok(!r.ok && /下架/.test(r.msg), '下架商品不能下单', r)
  r = await call(boss, 'adminListProducts')
  ok(r.ok && r.data.products.some(function (p) { return p._id === newId }), '后台仍可见')
  r = await call(boss, 'adminDeleteProduct', { id: newId })
  ok(r.ok, '删除商品')

  console.log('\n[5.5] 分类管理')
  r = await call(boss, 'adminSaveCategory', { name: '限时尝鲜' })
  ok(r.ok && r.data._id, '新增分类')
  const newCatId = r.data._id
  r = await call(boss, 'adminSaveCategory', { name: '限时尝鲜' })
  ok(!r.ok && /同名/.test(r.msg), '重名分类被拦', r)
  r = await call(boss, 'adminSaveCategory', { id: newCatId, name: '时令好物' })
  ok(r.ok, '分类改名')
  r = await call(boss, 'adminSaveProduct', { product: { name: '改名分类下的商品', catId: newCatId, price: 9.9 } })
  ok(r.ok, '在新分类下建商品')
  const pidInCat = r.data._id
  r = await call(boss, 'adminDeleteCategory', { id: newCatId })
  ok(!r.ok && /还有商品/.test(r.msg), '分类下有商品时删除被拦', r)
  r = await call(boss, 'adminSaveProduct', { product: { _id: pidInCat, name: '改名分类下的商品', catId: '', price: 9.9 } })
  ok(r.ok, '商品移出分类')
  r = await call(boss, 'adminDeleteCategory', { id: newCatId })
  ok(r.ok, '空分类删除成功')
  r = await call(buyer, 'adminSaveCategory', { name: '越权分类' })
  ok(!r.ok, '非管理员不能改分类')
  // 清理
  await call(boss, 'adminDeleteProduct', { id: pidInCat })

  console.log('\n[6] 设置与图片')
  r = await call(boss, 'adminSaveSettings', { settings: { shopName: '老李山货' } })
  ok(r.ok, '保存店铺设置')
  r = await call(buyer, 'getHome')
  ok(r.data.settings.shopName === '老李山货', '买家侧看到新店名')
  ok(!('wechatId' in r.data.settings), '店铺设置里不再有微信号字段')

  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  r = await call(boss, 'upload', { data: png })
  ok(r.ok && /^\/uploads\//.test(r.data.url), '上传图片返回路径', r)
  if (r.ok) {
    const img = await fetch(BASE + r.data.url)
    ok(img.status === 200 && /image\/png/.test(img.headers.get('content-type')), '图片能访问，Content-Type 正确')
  }
  r = await call(buyer, 'upload', { data: png })
  ok(!r.ok, '非管理员不能上传')

  // 超过 8MB 请求体：要能收到 413 的明确提示，而不是连接被掐断（客户端只会看到「网络不通」）
  let bigRes = null
  try {
    bigRes = await fetch(BASE + '/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + boss },
      body: JSON.stringify({ action: 'upload', data: 'data:image/jpeg;base64,' + 'A'.repeat(8 * 1024 * 1024) })
    })
  } catch (e) {
    bigRes = null
  }
  ok(bigRes && bigRes.status === 413, '超大请求返回 413，不是连接被断', bigRes && bigRes.status)
  if (bigRes) {
    const j = await bigRes.json().catch(function () { return {} })
    ok(/上限/.test(j.msg || ''), '413 里带能看懂的提示', j)
  }

  console.log('\n============================')
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项')
  process.exit(fail ? 1 : 0)
})().catch(function (e) { console.error('测试崩了：', e); process.exit(1) })
