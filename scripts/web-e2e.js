/* 用无头 Chrome 真点一遍网页版，验证整条链路。仅开发期使用。
   流程按真实顺序：卖家初始化 → 换成买家登记 → 切回卖家报价/收款/发出 → 再切回买家看状态。 */
const path = require('path')
const fs = require('fs')
const puppeteer = require('puppeteer-core')

const BASE = process.env.BASE || 'http://127.0.0.1:3300'
const SHOTS = '/tmp/shots'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failed = 0
function check (ok, label, extra) {
  console.log((ok ? '✅ ' : '❌ ') + label + (extra ? '  → ' + extra : ''))
  if (!ok) failed++
}

async function clickText (page, sel, text) {
  const ok = await page.evaluate((s, t) => {
    const els = Array.from(document.querySelectorAll(s))
    const el = els.find((e) => (e.textContent || '').trim().includes(t))
    if (!el) return false
    el.click()
    return true
  }, sel, text)
  if (!ok) throw new Error('找不到可点元素：' + sel + ' / ' + text)
  await sleep(400)
  return ok
}

async function shot (page, name) {
  await page.screenshot({ path: path.join(SHOTS, name + '.png') })
  console.log('   📸 ' + name)
}

async function who (page, v) {
  await page.select('#whoSel', v)
  await page.waitForFunction(() => document.querySelectorAll('.item, .empty, .card').length > 0)
  await sleep(500)
}

/* 正式版初始化是空店铺，这里用接口造测试数据（DEV_MODE 下可直接用 devOpenid 登录） */
async function seedData () {
  const login = await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ devOpenid: 'boss' })
  }).then((r) => r.json())
  const token = login.data.token
  const call = (action, data) => fetch(BASE + '/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(Object.assign({ action }, data || {}))
  }).then((r) => r.json())

  const catIds = {}
  for (const name of ['山货干货', '时令鲜货', '手工吃食']) {
    const r = await call('adminSaveCategory', { name })
    catIds[name] = r.data._id
  }
  for (const g of [
    ['野生黑木耳', '山货干货', 38, '袋(250g)'],
    ['土蜂蜜', '手工吃食', 88, '瓶(500g)'],
    ['手工红薯粉条', '手工吃食', 26, '袋(500g)'],
    ['当季脆柿', '时令鲜货', 45, '箱(5斤)']
  ]) {
    await call('adminSaveProduct', { product: { name: g[0], catId: catIds[g[1]], price: g[2], unit: g[3], stock: 20 } })
  }
}

;(async () => {
  fs.mkdirSync(SHOTS, { recursive: true })
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 430, height: 900, deviceScaleFactor: 2 })

  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  page.on('dialog', async (d) => {
    await (d.type() === 'prompt' ? d.accept('12') : d.accept())
    await sleep(250)
  })

  /* ---------- 1. 卖家初始化 ---------- */
  await page.goto(BASE + '/app.html', { waitUntil: 'networkidle2' })
  await page.waitForFunction(() => document.body.innerText.length > 40)
  await shot(page, '01-need-init')
  await clickText(page, 'button', '初始化店铺数据')
  await page.waitForSelector('#shopName')
  await sleep(600)
  check(await page.$$eval('.item', (n) => n.length) === 0, '初始化后是空店铺（没有示例商品）')
  check((await page.$eval('#shopName', (e) => e.textContent)).includes('老家特产'), '店铺名已生效')

  // 初始化不写示例数据，脚本自己造，后面才有商品可点
  await seedData()
  await page.reload({ waitUntil: 'networkidle2' })
  await page.waitForSelector('.item')
  check(await page.$$eval('.item', (n) => n.length) === 4, '造完数据后首页 4 个条目')
  await shot(page, '02-home')

  /* ---------- 2. 买家登记 ---------- */
  await who(page, 'kehu1')
  check(!(await page.evaluate(() => !!document.querySelector('[data-act="admin"]'))), '买家进不到卖家工具')
  await page.evaluate(() => document.querySelectorAll('.item .plus')[0].click())
  await sleep(250)
  await page.evaluate(() => document.querySelectorAll('.item .plus')[1].click())
  await sleep(450)
  const bar = await page.$eval('.cartbar', (e) => e.innerText.replace(/\n/g, ' '))
  check(bar.includes('2 件'), '清单栏显示 2 件', bar)
  await shot(page, '03-cart')

  await clickText(page, '.cartbar-btn', '清单')
  await page.waitForSelector('#f-name')
  await page.type('#f-name', '市场部小王')
  await page.type('#f-phone', '13800001111')
  await clickText(page, 'button', '提交登记')
  const t1 = await page.$eval('#toast', (e) => e.textContent)
  check(t1.includes('收货地址'), '快递不填地址被拦住', t1)
  await shot(page, '04-checkout')

  await page.type('#f-addr', '北京市朝阳区建国路 88 号 3 号楼 1201')
  await clickText(page, 'button', '提交登记')
  await page.waitForFunction(() => document.querySelectorAll('.order').length > 0)
  const badge1 = await page.$eval('.order .badge', (e) => e.textContent)
  check(badge1 === '待确认', '提交后状态为待确认', badge1)
  check((await page.$eval('.order .o-meta', (e) => e.innerText)).includes('运费待确认'), '买家侧显示运费待确认')
  await shot(page, '05-my-orders')

  /* ---------- 3. 卖家处理 ---------- */
  await who(page, 'boss')
  await clickText(page, '.tab', '我的')
  await page.waitForSelector('[data-act="admin"]')
  check(true, '卖家能看到「进入卖家工具」')
  await clickText(page, 'button', '进入卖家工具')
  await page.waitForSelector('.order')
  const adminText = await page.$eval('.order', (e) => e.innerText)
  check(adminText.includes('13800001111'), '后台能看到手机号')
  check(!adminText.includes('wang_xiaowang'), '后台不再收集/显示微信号')
  check(adminText.includes('建国路'), '后台能看到收货地址')
  await shot(page, '06-admin-orders')

  await clickText(page, '.o-acts button', '报价运费')
  await sleep(600)
  check((await page.$eval('.order .badge', (e) => e.textContent)) === '已报运费', '报价后变已报运费')
  await clickText(page, '.o-acts button', '已收款')
  await sleep(600)
  check((await page.$eval('.order .badge', (e) => e.textContent)) === '已收款', '收款后变已收款')
  await clickText(page, '.o-acts button', '已发出')
  await sleep(600)
  check((await page.$eval('.order .badge', (e) => e.textContent)) === '已发出', '发出后变已发出')
  await shot(page, '07-admin-shipped')

  await clickText(page, 'button', '商品')
  await page.waitForSelector('[data-act="editProduct"]')
  check(await page.$$eval('.order', (n) => n.length) === 4, '商品列表 4 条')

  /* 分类管理：新增 → 改名 → 删除（分类名在 input value 里，innerText 看不到） */
  const catVal = (v) => Array.from(document.querySelectorAll('.cat-name')).some((i) => i.value === v)
  await page.type('#newCat', '测试分类')
  await clickText(page, 'button', '添加')
  await page.waitForFunction((fn) => eval(fn), { timeout: 5000 }, '(' + catVal.toString() + ')("测试分类")')
  check(true, '新增分类成功')
  await page.evaluate(() => {
    const i = Array.from(document.querySelectorAll('.cat-name')).find((x) => x.value === '测试分类')
    i.value = '改名分类'
    Array.from(document.querySelectorAll('[data-act="saveCat"]')).find((b) => b.dataset.id === i.dataset.id).click()
  })
  await page.waitForFunction((fn) => eval(fn), { timeout: 5000 }, '(' + catVal.toString() + ')("改名分类")')
  check(true, '分类改名成功')
  const catId = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.cat-name')).find((x) => x.value === '改名分类').dataset.id
  })
  await page.evaluate((cid) => {
    Array.from(document.querySelectorAll('[data-act="delCat"]')).find((b) => b.dataset.id === cid).click()
  }, catId)
  await page.waitForFunction((fn) => eval(fn), { timeout: 5000 }, '!(' + catVal.toString() + ')("改名分类")')
  check(true, '删除空分类成功')
  await shot(page, '08-admin-products')

  await clickText(page, 'button', '店铺设置')
  await page.waitForSelector('#s-shopName')
  await page.evaluate(() => { document.querySelector('#s-shopName').value = '' })
  await page.type('#s-shopName', '小王家乡味')
  await clickText(page, 'button', '保存设置')
  await sleep(800)
  check((await page.$eval('#shopName', (e) => e.textContent)).includes('小王家乡味'), '改店名后顶栏跟着变')
  await shot(page, '09-admin-settings')

  /* ---------- 4. 买家回看 ---------- */
  await who(page, 'kehu1')
  await clickText(page, '.tab', '登记')
  await page.waitForSelector('.order')
  const b2 = await page.$eval('.order .badge', (e) => e.textContent)
  const meta = await page.$eval('.order .o-meta', (e) => e.innerText)
  check(b2 === '已发出', '买家侧状态同步', b2)
  check(/含运费/.test(meta), '买家侧看到运费已计入', meta.split('\n')[0])
  await shot(page, '10-buyer-after')

  /* ---------- 5. 取消规则 ---------- */
  check(!(await page.evaluate(() => !!document.querySelector('[data-act="cancel"]'))), '已处理的单不显示「取消登记」')

  await browser.close()
  console.log('\n' + (failed ? '❌ 失败 ' + failed + ' 项' : '✅ 全部通过'))
  console.log('页面错误：', errors.length ? errors : '无')
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error('❌ 中断：', e.message); process.exit(1) })
