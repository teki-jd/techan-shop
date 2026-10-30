/**
 * 云函数端到端冒烟测试（内存数据库，不需要真实云环境）
 * 运行： node scripts/smoke-test.js
 */
const path = require('path')
const Module = require('module')

// 把 wx-server-sdk 指向本地内存模拟器
const mockPath = path.join(__dirname, 'mocks', 'wx-server-sdk.js')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request) {
  if (request === 'wx-server-sdk') return mockPath
  return origResolve.apply(this, arguments)
}

const sdk = require('wx-server-sdk')
const api = require(path.join(__dirname, '..', 'cloudfunctions', 'shopapi', 'index.js'))

let pass = 0
let fail = 0

function ok (cond, name, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name) } else { fail++; console.log('  ❌ ' + name + (extra ? ' → ' + JSON.stringify(extra) : '')) }
}

async function call (action, data, openid) {
  if (openid) sdk.__setOpenid(openid)
  const r = await api.main(Object.assign({ action }, data || {}), {})
  return r
}

;(async function () {
  console.log('\n[1] 初始化 / 身份')
  let r = await call('me', {}, 'openid-buyer')
  ok(r.ok && r.data.needInit === true, '新环境 needInit=true')

  r = await call('bootstrap', {}, 'openid-boss')
  ok(r.ok && r.data.already === false, '初始化成功', r)

  // 正式版初始化是空店铺（不写示例数据），测试自己造：3 分类 + 4 商品
  r = await call('getHome', {}, 'openid-buyer')
  ok(r.ok && r.data.products.length === 0 && r.data.categories.length === 0,
    '初始化后没有示例商品，是空店铺', r.data && (r.data.products || []).length)
  const catIds = {}
  for (const name of ['山货干货', '时令鲜货', '手工吃食']) {
    const rc = await call('adminSaveCategory', { name }, 'openid-boss')
    catIds[name] = rc.data && rc.data._id
  }
  let seedOk = true
  for (const g of [
    ['野生黑木耳', '山货干货', 38, '袋(250g)'],
    ['土蜂蜜', '手工吃食', 88, '瓶(500g)'],
    ['手工红薯粉条', '手工吃食', 26, '袋(500g)'],
    ['当季脆柿', '时令鲜货', 45, '箱(5斤)']
  ]) {
    const rp = await call('adminSaveProduct', { product: { name: g[0], catId: catIds[g[1]], price: g[2], unit: g[3], stock: 20 } }, 'openid-boss')
    seedOk = seedOk && rp.ok
  }
  ok(seedOk, '测试数据：3 分类 + 4 商品已建好')

  r = await call('bootstrap', {}, 'openid-buyer')
  ok(r.ok && r.data.already === true, '重复初始化被拦截')

  r = await call('me', {}, 'openid-boss')
  ok(r.ok && r.data.isAdmin === true, '第一个初始化的人是管理员')

  r = await call('me', {}, 'openid-buyer')
  ok(r.ok && r.data.isAdmin === false, '其他人不是管理员')

  r = await call('getHome', {}, 'openid-buyer')
  ok(r.ok && r.data.products.length === 4 && r.data.settings.shopName, '首页拿到 4 个在售商品 + 店铺信息')
  const goods = r.data.products
  const cat = r.data.categories[0]

  console.log('\n[2] 下单')
  const payload = {
    items: [{ productId: goods[0]._id, qty: 2 }, { productId: goods[1]._id, qty: 1 }],
    contact: { name: '小王', phone: '13800138000' },
    mode: 'express',
    address: '广东省深圳市南山区科技园 1 号',
    remark: '周三前要'
  }
  r = await call('createOrder', payload, 'openid-buyer')
  ok(r.ok && r.data.orderNo && r.data.status === 'pending', '下单成功，状态 pending', r)
  const expectAmount = goods[0].price * 2 + goods[1].price
  ok(r.ok && Math.abs(r.data.amount - expectAmount) < 0.01, '金额按数据库价格重算 = ' + expectAmount, r.data)

  // 前端传假价格应该被忽略
  r = await call('createOrder', Object.assign({}, payload, {
    items: [{ productId: goods[0]._id, qty: 1, price: 0.01 }]
  }), 'openid-buyer')
  ok(r.ok && Math.abs(r.data.amount - goods[0].price) < 0.01, '前端伪造 price 无效', r.data)

  r = await call('createOrder', Object.assign({}, payload, { contact: { name: '', phone: '123' } }), 'openid-buyer')
  ok(r.ok === false && /姓名/.test(r.msg), '缺姓名被拦', r)
  r = await call('createOrder', Object.assign({}, payload, { contact: { name: 'a', phone: '123' } }), 'openid-buyer')
  ok(r.ok === false && /手机号/.test(r.msg), '手机号格式校验', r)
  r = await call('createOrder', Object.assign({}, payload, { address: '' }), 'openid-buyer')
  ok(r.ok === false && /地址/.test(r.msg), '快递必须填地址', r)
  r = await call('createOrder', Object.assign({}, payload, { mode: 'pickup', address: '' }), 'openid-buyer')
  ok(r.ok === true, '自取不要求地址', r)

  console.log('\n[3] 买家视角')
  r = await call('myOrders', {}, 'openid-buyer')
  ok(r.ok && r.data.length === 3, '买家看到自己的 3 单', r.data && r.data.length)
  r = await call('myOrders', {}, 'openid-other')
  ok(r.ok && r.data.length === 0, '别人看不到他人订单')
  const orderId = (await call('myOrders', {}, 'openid-buyer')).data[0]._id

  console.log('\n[4] 权限')
  r = await call('adminListOrders', {}, 'openid-buyer')
  ok(r.ok === false && /权限/.test(r.msg), '非管理员不能看后台订单', r)
  r = await call('adminListOrders', {}, 'openid-boss')
  ok(r.ok && r.data.list.length === 3 && r.data.counts.pending === 3, '管理员看到 3 单 + 状态计数', r.data && r.data.counts)
  r = await call('adminSaveProduct', { product: { name: 'hack', price: 1 } }, 'openid-buyer')
  ok(r.ok === false, '非管理员不能改商品')
  r = await call('adminUpdateOrder', { id: orderId, status: 'paid' }, 'openid-buyer')
  ok(r.ok === false, '非管理员不能改订单状态')

  console.log('\n[5] 卖家处理订单')
  r = await call('adminUpdateOrder', { id: orderId, status: 'quoted', freight: 12 }, 'openid-boss')
  ok(r.ok, '报价 12 元运费 → quoted', r)
  r = await call('myOrders', {}, 'openid-buyer')
  const o1 = r.data.find((x) => x._id === orderId)
  ok(o1.status === 'quoted' && o1.freight === 12, '买家侧同步看到运费与状态', o1.status + '/' + o1.freight)

  r = await call('adminUpdateOrder', { id: orderId, status: 'paid' }, 'openid-boss')
  ok(r.ok, '标记已收款')
  r = await call('adminUpdateOrder', { id: orderId, status: 'cancelled' }, 'openid-buyer')
  ok(r.ok === false, '买家不能自己把已付款订单改成取消')
  r = await call('cancelOrder', { id: orderId }, 'openid-buyer')
  ok(r.ok === false && /已经处理/.test(r.msg), '已付款订单买家不能自助取消', r)

  const pending = (await call('myOrders', {}, 'openid-buyer')).data.find((x) => x.status === 'pending')
  r = await call('cancelOrder', { id: pending._id }, 'openid-buyer')
  ok(r.ok === true, '待确认订单买家可自助取消')
  r = await call('cancelOrder', { id: pending._id }, 'openid-other')
  ok(r.ok === false, '不能取消别人的订单')

  console.log('\n[6] 商品管理')
  r = await call('adminSaveProduct', {
    product: { name: '新到板栗', catId: cat._id, price: 19.9, unit: '袋(500g)', desc: '刚下树', stock: 10, tags: ['当季'] }
  }, 'openid-boss')
  ok(r.ok && r.data._id, '新增商品成功')
  const newId = r.data._id
  r = await call('getHome', {}, 'openid-buyer')
  ok(r.data.products.some((p) => p._id === newId), '新商品出现在首页')

  r = await call('adminToggleProduct', { id: newId, onSale: false }, 'openid-boss')
  ok(r.ok, '下架')
  r = await call('getHome', {}, 'openid-buyer')
  ok(!r.data.products.some((p) => p._id === newId), '下架后首页不显示')
  r = await call('adminListProducts', {}, 'openid-boss')
  ok(r.data.products.some((p) => p._id === newId), '下架后后台仍可见')

  r = await call('createOrder', { items: [{ productId: newId, qty: 1 }], contact: payload.contact, mode: 'pickup' }, 'openid-buyer')
  ok(r.ok === false && /下架/.test(r.msg), '已下架商品不能下单', r)

  r = await call('adminDeleteProduct', { id: newId }, 'openid-boss')
  ok(r.ok, '删除商品')

  console.log('\n[7] 店铺设置')
  r = await call('adminGetSettings', {}, 'openid-boss')
  ok(r.ok && r.data.settings.shopName, '读取设置')
  r = await call('adminSaveSettings', { settings: { shopName: '老李山货', notice: '周三五发货' } }, 'openid-boss')
  ok(r.ok, '保存设置')
  r = await call('getHome', {}, 'openid-buyer')
  ok(r.data.settings.shopName === '老李山货' && r.data.settings.notice === '周三五发货', '买家侧看到新店铺信息', r.data.settings)

  console.log('\n============================')
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项')
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error('测试崩了：', e); process.exit(1) })
