/* 网页版体验端：跟小程序共用同一套 /api，只是把界面用 HTML 重画一遍。
   用途：不装开发者工具、不开微信，也能把整条流程点完。
   身份切换靠顶栏下拉框（本质是换 devOpenid 重新登录），所以服务器必须 DEV_MODE=1 启动。 */

const $ = (s) => document.querySelector(s)
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const STATUS = {
  pending: '待确认', quoted: '已报运费', paid: '已收款',
  shipped: '已发出', done: '已完成', cancelled: '已取消'
}
const FILTERS = [
  ['all', '全部'], ['pending', '待确认'], ['quoted', '已报运费'],
  ['paid', '已收款'], ['shipped', '已发出'], ['done', '已完成'], ['cancelled', '已取消']
]

const money = (n) => '¥' + (Math.round(Number(n || 0) * 100) / 100).toFixed(2)
const timeText = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (x) => (x < 10 ? '0' + x : x)
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

/* ------------------------------------------------------------ 接口层 */
const API = {
  token: '',
  who: localStorage.getItem('tc_who') || 'boss',

  async login (force) {
    if (this.token && !force) return
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ devOpenid: this.who })
    })
    const d = await r.json().catch(() => ({}))
    if (!d.ok) throw new Error(d.msg || '登录失败')
    this.token = d.data.token
  },

  async call (action, payload, retried) {
    await this.login()
    const r = await fetch('/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + this.token },
      body: JSON.stringify(Object.assign({ action }, payload || {}))
    })
    const d = await r.json().catch(() => ({}))
    if (d.ok) return d.data
    if (r.status === 401 && !retried) {
      this.token = ''
      return this.call(action, payload, true)
    }
    throw new Error(d.msg || '请求失败')
  }
}

/* ------------------------------------------------------------ 状态 */
const state = {
  tab: 'home',
  view: '',
  catId: '',
  pid: '',
  filter: 'all',
  adminTab: 'orders',
  cart: JSON.parse(localStorage.getItem('tc_cart') || '{}'),
  me: null,
  home: null,
  orders: null,
  admin: null
}

function saveCart () { localStorage.setItem('tc_cart', JSON.stringify(state.cart)) }
function cartCount () { return Object.keys(state.cart).reduce((s, k) => s + state.cart[k], 0) }
function cartLines () {
  const map = {}
  ;((state.home && state.home.products) || []).forEach((p) => { map[p._id] = p })
  return Object.keys(state.cart).map((id) => ({ p: map[id], qty: state.cart[id] })).filter((x) => x.p)
}

/* ------------------------------------------------------------ 小工具 */
let toastTimer = null
function toast (msg) {
  const el = $('#toast')
  el.textContent = msg
  el.classList.add('on')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('on'), 2200)
}

function openModal (html) {
  $('#modalBox').innerHTML = html
  $('#modal').classList.add('on')
}
function closeModal () { $('#modal').classList.remove('on') }

$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal() })

/* ------------------------------------------------------------ 渲染入口 */
async function boot () {
  try {
    await API.login(true)
    state.me = await API.call('me')
    state.home = await API.call('getHome')
    $('#shopName').textContent = state.home.settings.shopName || '老家特产'
    $('#shopSlogan').textContent = state.home.settings.slogan || ''
    $('#whoSel').value = API.who
    render()
  } catch (e) {
    $('#view').innerHTML = errorCard(e.message)
  }
}

function errorCard (msg) {
  const devHint = /登录失败|缺少 code|401/.test(msg)
    ? '<p class="p">网页版靠 <b>devOpenid</b> 免微信登录，服务器必须用 <code>DEV_MODE=1 node index.js</code> 启动。看下终端是不是漏了 <code>DEV_MODE=1</code>。</p>'
    : '<p class="p">确认终端里的 <code>node index.js</code> 还开着（Ctrl+C 关掉就会这样）。</p>'
  return '<div class="card"><h2>连不上后端</h2><p class="p">' + esc(msg) + '</p>' + devHint + '</div>'
}

function render () {
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('on', t.dataset.tab === state.tab && !state.view)
  })

  if (state.view === 'detail') return renderDetail()
  if (state.view === 'checkout') return renderCheckout()
  if (state.view === 'admin') return renderAdmin()

  if (state.tab === 'home') return renderHome()
  if (state.tab === 'orders') return renderOrders()
  return renderMine()
}

/* ------------------------------------------------------------ 首页 */
function renderHome () {
  if (!state.home || state.home.needInit) {
    $('#view').innerHTML = '<div class="card"><h2>还没初始化</h2>' +
      '<p class="p">点下面按钮会建出 3 个商品分类、4 个示例商品，并把当前身份（' + esc(API.who) + '）设为卖家。</p>' +
      '<button class="btn block" style="margin-top:14px" data-act="bootstrap">初始化店铺数据</button></div>'
    return
  }
  const s = state.home.settings
  const cats = state.home.categories
  const list = state.home.products.filter((p) => !state.catId || p.catId === state.catId)

  let html = s.notice ? '<div class="notice">' + esc(s.notice) + '</div>' : ''
  html += '<div class="cats"><button class="cat ' + (state.catId ? '' : 'on') + '" data-act="cat" data-id="">全部</button>' +
    cats.map((c) => '<button class="cat ' + (state.catId === c._id ? 'on' : '') + '" data-act="cat" data-id="' + c._id + '">' + esc(c.name) + '</button>').join('') +
    '</div>'

  if (!list.length) {
    html += '<div class="empty">这个分类下还没有在售的东西</div>'
  } else {
    html += '<div class="grid">' + list.map(itemCard).join('') + '</div>'
  }

  const n = cartCount()
  if (n > 0) {
    const sum = cartLines().reduce((a, x) => a + x.p.price * x.qty, 0)
    html += '<div class="cartbar"><div>清单 <b>' + n + '</b> 件 · 参考 ' + money(sum) + '</div>' +
      '<button class="cartbar-btn" data-act="checkout">清单</button></div>'
  }
  $('#view').innerHTML = html
}

function itemCard (p) {
  const cover = p.cover
    ? '<div class="thumb"><img src="' + esc(p.cover) + '" alt=""></div>'
    : '<div class="thumb">' + esc(p.name.slice(0, 1)) + '</div>'
  return '<div class="item" data-act="detail" data-id="' + p._id + '">' + cover +
    '<div class="item-body"><div class="item-name">' + esc(p.name) + '</div>' +
    '<div class="item-desc">' + esc(p.desc || '') + '</div>' +
    '<div class="item-foot"><div><div class="price">' + money(p.price) + '<small>/' + esc(p.unit) + (p.weight ? ' · ' + esc(p.weight) : '') + '</small></div></div>' +
    '<button class="plus" data-act="add" data-id="' + p._id + '">+</button></div></div></div>'
}

/* ------------------------------------------------------------ 详情 */
function renderDetail () {
  const p = (state.home.products || []).find((x) => x._id === state.pid)
  if (!p) { state.view = ''; return render() }
  const hero = p.cover
    ? '<div class="hero"><img src="' + esc(p.cover) + '" alt=""></div>'
    : '<div class="hero">' + esc(p.name.slice(0, 1)) + '</div>'
  $('#view').innerHTML =
    '<button class="btn gray sm" data-act="back" style="margin-bottom:12px">← 返回目录</button>' +
    hero +
    '<div class="card"><div class="item-name" style="font-size:17px">' + esc(p.name) + '</div>' +
    '<div class="row" style="margin-top:8px"><div class="bigprice">' + money(p.price) + '</div>' +
    '<div class="sub" style="margin-left:4px">/ ' + esc(p.unit) + (p.weight ? ' · ' + esc(p.weight) : '') + '</div></div>' +
    (p.tags && p.tags.length ? '<div style="margin-top:8px">' + p.tags.map((t) => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' : '') +
    '<div class="p" style="white-space:pre-wrap">' + esc(p.desc || '') + '</div>' +
    (p.weight ? '<div class="sub" style="margin-top:10px">每' + esc(p.unit) + ' ' + esc(p.weight) + '</div>' : '') + '</div>' +

    '<div class="card"><h2>怎么登记</h2><div class="steps">' +
    '<div class="step"><i>1</i><span>选好数量，加进清单</span></div>' +
    '<div class="step"><i>2</i><span>留下姓名、手机号、收货地址，提交登记</span></div>' +
    '<div class="step"><i>3</i><span>我联系你确认运费和总额，微信转账，然后寄出</span></div>' +
    '</div><div class="sub" style="margin-top:10px">这里不收钱，也没有线上支付。</div></div>' +

    '<div class="card row"><div class="qty"><button data-act="qminus">−</button><span id="dqty">1</span><button data-act="qplus">+</button></div>' +
    '<button class="btn grow" data-act="addqty" data-id="' + p._id + '">加进清单</button></div>' +
    '<button class="btn block ghost" data-act="buynow" data-id="' + p._id + '">只登记这一件</button>'
}

/* ------------------------------------------------------------ 登记 */
function renderCheckout () {
  const lines = cartLines()
  if (!lines.length) { state.view = ''; state.tab = 'home'; return render() }
  const sum = lines.reduce((a, x) => a + x.p.price * x.qty, 0)
  const c = state.me.user || {}
  const last = JSON.parse(localStorage.getItem('tc_addr') || '{}')
  const mode = 'express'

  $('#view').innerHTML =
    '<div class="card"><div class="chd">' +
    '<button class="btn gray sm chd-back" data-act="back">←</button>' +
    '<div class="chd-t">清单</div><div class="chd-hold"></div></div>' +
    lines.map((x) =>
      '<div class="li"><div class="li-t"><div class="li-n">' + esc(x.p.name) + '</div>' +
      '<div class="li-s">' + money(x.p.price) + ' / ' + esc(x.p.unit) + (x.p.weight ? ' · ' + esc(x.p.weight) : '') + '</div></div>' +
      '<div class="qty"><button data-act="cminus" data-id="' + x.p._id + '">−</button><span>' + x.qty + '</span>' +
      '<button data-act="cplus" data-id="' + x.p._id + '">+</button></div>' +
      '<button class="del" data-act="cdel" data-id="' + x.p._id + '">×</button></div>').join('') +
    '<div class="hr"></div><div class="total"><span class="sub">共 ' + cartCount() + ' 件，参考合计</span>' +
    '<span class="total-n">' + money(sum) + '</span></div>' +
    '<div class="sub" style="margin-top:6px">' + esc(state.home.settings.freightNote || '') + '</div></div>' +

    '<div class="card"><h2>怎么联系你</h2>' +
    '<label class="f"><span>姓名 *</span><input id="f-name" value="' + esc(c.name || '') + '" placeholder="收货人姓名"></label>' +
    '<label class="f"><span>手机号 *</span><input id="f-phone" value="' + esc(c.phone || '') + '" placeholder="11 位手机号"></label>' +
    '<label class="f"><span>收货地址 *</span><textarea id="f-addr" placeholder="省市区 + 详细地址">' + esc(last.address || '') + '</textarea></label>' +
    '<label class="f"><span>备注</span><textarea id="f-remark" placeholder="其他要求写到这里">' + esc(last.remark || '') + '</textarea></label>' +
    '</div>' +

    '<button class="btn block" data-act="submit">提交登记</button>' +
    '<div class="sub" style="text-align:center;margin-top:10px">提交后我会收到，小程序里不涉及任何付款</div>'
}

/* ------------------------------------------------------------ 我的登记 */
async function renderOrders () {
  $('#view').innerHTML = '<div class="empty">加载中…</div>'
  let rows
  try {
    rows = await API.call('myOrders')
  } catch (e) {
    $('#view').innerHTML = errorCard(e.message); return
  }
  if (!rows.length) {
    $('#view').innerHTML = '<div class="empty">还没有提交过登记<br><br>' +
      '<button class="btn ghost sm" data-act="go" data-tab="home">去看看特产</button></div>'
    return
  }
  $('#view').innerHTML = rows.map(orderCard).join('') +
    '<div class="dev">状态由卖家更新，转账请在微信里直接进行</div>'
}

function orderCard (o) {
  const items = (o.items || []).map((it) =>
    '<div class="o-line"><span>' + esc(it.name) + ' × ' + it.qty + '</span><span>' + money(it.price * it.qty) + '</span></div>').join('')
  const total = Number(o.amount || 0) + Number(o.freight || 0)
  return '<div class="order"><div class="o-top"><span class="o-no">' + esc(o.orderNo) + '</span>' +
    '<span class="badge ' + o.status + '">' + STATUS[o.status] + '</span></div>' +
    '<div class="o-lines">' + items + '</div>' +
    '<div class="o-meta"><div><em>合计</em><span>' + money(total) +
    (Number(o.freight) ? '（含运费 ' + money(o.freight) + '）' : '（运费待确认）') + '</span></div>' +
    '<div><em>取货</em><span>' + (o.mode === 'pickup' ? '自取' : '快递 · ' + esc(o.address || '')) + '</span></div>' +
    '<div><em>时间</em><span>' + timeText(o.createdAt) + '</span></div></div>' +
    (o.adminNote ? '<div class="note">卖家留言：' + esc(o.adminNote) + '</div>' : '') +
    '<div class="o-acts"><button class="btn gray sm" data-act="copy" data-v="' + esc(o.orderNo) + '">复制编号</button>' +
    (['pending', 'quoted'].indexOf(o.status) > -1
      ? '<button class="btn ghost sm" data-act="cancel" data-id="' + o._id + '">取消登记</button>' : '') +
    '<button class="btn ghost sm" data-act="call">联系卖家</button></div></div>'
}

/* ------------------------------------------------------------ 我的 */
function renderMine () {
  const c = (state.me && state.me.user) || {}
  const s = (state.home && state.home.settings) || {}
  const isAdmin = !!(state.me && state.me.isAdmin)
  $('#view').innerHTML =
    '<div class="card"><h2>我的联系方式</h2><div class="sub" style="margin-bottom:10px">填一次，登记时自动带出来</div>' +
    '<label class="f"><span>姓名</span><input id="m-name" value="' + esc(c.name || '') + '"></label>' +
    '<label class="f"><span>手机号</span><input id="m-phone" value="' + esc(c.phone || '') + '"></label>' +
    '<button class="btn block ghost" data-act="saveContact">保存</button></div>' +

    (isAdmin
      ? '<div class="card"><h2>卖家后台</h2><div class="sub" style="margin-bottom:12px">只有你能看到这个入口：登记单、商品、店铺设置</div>' +
        '<button class="btn block" data-act="admin">进入卖家工具</button></div>'
      : '<div class="card"><h2>身份说明</h2><p class="p">当前身份 <b>' + esc(whoName(API.who)) +
        '</b> 不是管理员，所以看不到卖家入口。把顶栏「体验身份」切回<b>我（卖家）</b>就能看到。</p></div>') +

    '<div class="card"><h2>这个小程序做什么</h2>' +
    '<p class="p">只做三件事：陈列我老家有哪些特产、让你登记你想要什么、把这份登记给我。</p>' +
    '<p class="p">这里不收钱、也没有线上支付。提交后我加你微信或打电话确认运费和总额，转账在微信里直接给我。</p></div>' +

    '<div class="card"><h2>测试用</h2>' +
    '<div class="row"><button class="btn gray sm grow" data-act="clearCart">清空清单</button>' +
    '<button class="btn gray sm grow" data-act="reload">重新拉数据</button></div>' +
    '<div class="dev">网页版 · 数据存在服务器 data/db.json</div></div>'
}

/* ------------------------------------------------------------ 卖家工具 */
async function renderAdmin () {
  if (!state.me.isAdmin) { state.view = ''; state.tab = 'mine'; return render() }
  $('#view').innerHTML =
    '<button class="btn gray sm" data-act="back" style="margin-bottom:12px">← 返回我的</button>' +
    '<div class="seg" style="margin-bottom:12px">' +
    ['orders|登记单', 'products|商品', 'settings|店铺设置'].map((x) => {
      const [k, t] = x.split('|')
      return '<button class="' + (state.adminTab === k ? 'on' : '') + '" data-act="admintab" data-v="' + k + '">' + t + '</button>'
    }).join('') + '</div><div id="adminBody"><div class="empty">加载中…</div></div>'

  if (state.adminTab === 'orders') return renderAdminOrders()
  if (state.adminTab === 'products') return renderAdminProducts()
  return renderAdminSettings()
}

async function renderAdminOrders () {
  const body = $('#adminBody')
  if (!body) return
  let d
  try { d = await API.call('adminListOrders', { status: state.filter }) }
  catch (e) { body.innerHTML = errorCard(e.message); return }

  let html = '<div class="filters">' + FILTERS.map(([k, t]) =>
    '<button class="' + (state.filter === k ? 'on' : '') + '" data-act="filter" data-v="' + k + '">' + t +
    ' <b>' + (d.counts[k] || 0) + '</b></button>').join('') + '</div>'

  if (!d.list.length) html += '<div class="empty">这一栏还没有登记</div>'
  else html += d.list.map(adminOrderCard).join('')
  body.innerHTML = html
}

function adminOrderCard (o) {
  const c = o.contact || {}
  const items = (o.items || []).map((it) =>
    '<div class="o-line"><span>' + esc(it.name) + ' × ' + it.qty + '</span><span>' + money(it.price * it.qty) + '</span></div>').join('')
  const total = Number(o.amount || 0) + Number(o.freight || 0)
  const acts = []
  acts.push('<button class="btn ghost sm" data-act="note" data-id="' + o._id + '">留言</button>')
  acts.push('<button class="btn ghost sm" data-act="quote" data-id="' + o._id + '" data-freight="' + (o.freight || '') + '">' +
    (o.status === 'pending' ? '报价运费' : '改运费') + '</button>')
  if (o.status === 'quoted') acts.push('<button class="btn sm" data-act="paid" data-id="' + o._id + '">已收款</button>')
  if (o.status === 'paid') acts.push('<button class="btn sm" data-act="ship" data-id="' + o._id + '">已发出</button>')
  if (o.status === 'shipped') acts.push('<button class="btn sm" data-act="done" data-id="' + o._id + '">完成</button>')
  if (['pending', 'quoted', 'paid'].indexOf(o.status) > -1) {
    acts.push('<button class="btn gray sm" data-act="adminCancel" data-id="' + o._id + '">取消这条登记</button>')
  }

  return '<div class="order"><div class="o-top"><span class="o-no">' + esc(o.orderNo) + '</span>' +
    '<span class="badge ' + o.status + '">' + STATUS[o.status] + '</span></div>' +
    '<div class="o-lines">' + items + '</div>' +
    '<div class="o-meta">' +
    '<div><em>合计</em><span>' + money(total) + (Number(o.freight) ? '（含运费 ' + money(o.freight) + '）' : '') + '</span></div>' +
    '<div><em>姓名</em><span>' + esc(c.name) + '</span></div>' +
    '<div><em>电话</em><a href="tel:' + esc(c.phone) + '" style="color:#B4472E">' + esc(c.phone) + '</a></div>' +
    '<div><em>地址</em><span>' + esc(o.address || '—') + '</span></div>' +
    (o.remark ? '<div><em>备注</em><span>' + esc(o.remark) + '</span></div>' : '') +
    '<div><em>时间</em><span>' + timeText(o.createdAt) + '</span></div></div>' +
    (o.adminNote ? '<div class="note">你的留言：' + esc(o.adminNote) + '</div>' : '') +
    '<div class="o-acts">' + acts.join('') + '</div></div>'
}

async function renderAdminProducts () {
  const body = $('#adminBody')
  if (!body) return
  let d
  try { d = await API.call('adminListProducts') }
  catch (e) { body.innerHTML = errorCard(e.message); return }
  state.admin = d

  let html = '<button class="btn block" data-act="editProduct" data-id="" style="margin-bottom:12px">＋ 新增商品</button>'

  /* 分类管理 */
  html += '<div class="card" style="margin-bottom:12px"><h2>商品分类</h2>' +
    '<div class="sub" style="margin-bottom:8px">改名后点「存」；删除前要先把分类下的商品移走</div>' +
    (d.categories.length ? d.categories.map((c) =>
      '<div class="row" style="gap:8px;margin-bottom:8px">' +
      '<input class="grow cat-name" data-id="' + c._id + '" value="' + esc(c.name) + '">' +
      '<button class="btn ghost sm" data-act="saveCat" data-id="' + c._id + '">存</button>' +
      '<button class="btn gray sm" data-act="delCat" data-id="' + c._id + '">删</button></div>').join('')
      : '<div class="sub">还没有分类</div>') +
    '<div class="row" style="gap:8px"><input id="newCat" class="grow" placeholder="新分类名">' +
    '<button class="btn sm" data-act="addCat">添加</button></div></div>'

  html += d.products.map((p) =>
    '<div class="order"><div class="o-top"><div><div class="item-name">' + esc(p.name) + '</div>' +
    '<div class="sub">' + money(p.price) + ' / ' + esc(p.unit) + (p.weight ? ' · ' + esc(p.weight) : '') + ' · ' + esc(p.catName || '未分类') + '</div></div>' +
    '<span class="badge ' + (p.onSale === false ? 'cancelled' : 'paid') + '">' + (p.onSale === false ? '已隐藏' : '在售展示') + '</span></div>' +
    '<div class="o-acts"><button class="btn ghost sm" data-act="editProduct" data-id="' + p._id + '">编辑</button>' +
    '<button class="btn gray sm" data-act="toggle" data-id="' + p._id + '" data-on="' + (p.onSale === false ? '1' : '0') + '">' +
    (p.onSale === false ? '恢复展示' : '隐藏') + '</button>' +
    '<button class="btn gray sm" data-act="delProduct" data-id="' + p._id + '">删除</button></div></div>').join('')
  body.innerHTML = html
}

async function renderAdminSettings () {
  const body = $('#adminBody')
  if (!body) return
  let d
  try { d = await API.call('adminGetSettings') }
  catch (e) { body.innerHTML = errorCard(e.message); return }
  const s = d.settings
  body.innerHTML = '<div class="card">' +
    '<label class="f"><span>店铺名</span><input id="s-shopName" value="' + esc(s.shopName) + '"></label>' +
    '<label class="f"><span>一句话介绍</span><input id="s-slogan" value="' + esc(s.slogan) + '"></label>' +
    '<label class="f"><span>首页公告</span><textarea id="s-notice">' + esc(s.notice) + '</textarea></label>' +
    '<label class="f"><span>你的手机号</span><input id="s-phone" value="' + esc(s.phone) + '"></label>' +
    '<label class="f"><span>运费说明</span><input id="s-freightNote" value="' + esc(s.freightNote) + '"></label>' +
    '<button class="btn block" data-act="saveSettings">保存设置</button></div>' +
    '<div class="card"><h2>管理员 openid</h2><div class="sub" style="word-break:break-all">' +
    esc((s.adminOpenids || []).join('、')) + '</div>' +
    '<p class="p">换身份后如果看不到卖家入口，把新 openid 加进这个数组（data/db.json 里的 settings）。</p></div>'
}

/* ------------------------------------------------------------ 商品编辑弹层 */
function openProductEditor (id) {
  const d = state.admin || { products: [], categories: [] }
  const p = d.products.find((x) => x._id === id) || { name: '', price: '', unit: '袋', weight: '', desc: '', catId: '', cover: '', onSale: true, tags: [] }
  const cats = d.categories.map((c) =>
    '<option value="' + c._id + '"' + (p.catId === c._id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('')
  openModal(
    '<div class="modal-h"><h2>' + (id ? '编辑商品' : '新增商品') + '</h2><button class="modal-x" data-act="closeModal">×</button></div>' +
    '<input type="hidden" id="p-id" value="' + esc(id || '') + '">' +
    '<label class="f"><span>名称 *</span><input id="p-name" value="' + esc(p.name) + '" placeholder="比如 野生黑木耳"></label>' +
    '<label class="f"><span>分类</span><select id="p-cat"><option value="">未分类</option>' + cats + '</select></label>' +
    '<div class="row" style="gap:10px"><label class="f grow"><span>参考价 *</span><input id="p-price" value="' + esc(p.price) + '" placeholder="38"></label>' +
    '<label class="f grow"><span>单位</span><input id="p-unit" value="' + esc(p.unit) + '" placeholder="袋 / 盒 / 瓶"></label>' +
    '<label class="f grow"><span>重量</span><input id="p-weight" value="' + esc(p.weight || '') + '" placeholder="250g / 5斤"></label></div>' +
    '<label class="f"><span>介绍</span><textarea id="p-desc">' + esc(p.desc) + '</textarea></label>' +
    '<label class="f"><span>图片（选一张本地图，自动上传）</span><input type="file" id="p-file" accept="image/*"></label>' +
    '<label class="f"><span>或直接填图片地址</span><input id="p-cover" value="' + esc(p.cover) + '" placeholder="/uploads/xxx.jpg"></label>' +
    '<label class="f row" style="gap:8px"><input type="checkbox" id="p-onSale" style="width:auto"' + (p.onSale === false ? '' : ' checked') + '><span style="margin:0">在售展示</span></label>' +
    '<button class="btn block" data-act="saveProduct">保存</button>'
  )
}

/* ------------------------------------------------------------ 事件 */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]')
  if (!el) return
  const act = el.dataset.act
  const id = el.dataset.id

  try {
    switch (act) {
      /* --- 导航 --- */
      case 'cat': state.catId = id || ''; render(); break
      case 'detail': state.pid = id; state.view = 'detail'; render(); break
      case 'back': state.view = ''; render(); break
      case 'go': state.tab = el.dataset.tab; state.view = ''; render(); break
      case 'closeModal': closeModal(); break

      /* --- 清单 --- */
      case 'add': state.cart[id] = (state.cart[id] || 0) + 1; saveCart(); toast('已加进清单'); render(); break
      case 'qplus': case 'qminus': {
        const q = $('#dqty')
        q.textContent = Math.max(1, Number(q.textContent) + (act === 'qplus' ? 1 : -1))
        break
      }
      case 'addqty': {
        const q = Number($('#dqty').textContent)
        state.cart[id] = (state.cart[id] || 0) + q
        saveCart(); toast('已加 ' + q + ' 件'); render(); break
      }
      case 'buynow':
        state.cart = { [id]: 1 }; saveCart(); state.view = 'checkout'; render(); break
      case 'checkout': state.view = 'checkout'; render(); break
      case 'cplus': state.cart[id] = (state.cart[id] || 0) + 1; saveCart(); render(); break
      case 'cminus':
        state.cart[id] = (state.cart[id] || 0) - 1
        if (state.cart[id] <= 0) delete state.cart[id]
        saveCart(); render(); break
      case 'cdel': delete state.cart[id]; saveCart(); render(); break
      case 'clearCart': state.cart = {}; saveCart(); toast('清单已清空'); render(); break

      /* --- 登记 --- */
      case 'submit': await submitOrder(); break
      case 'cancel': {
        if (!confirm('取消这条登记？')) return
        await API.call('cancelOrder', { id })
        toast('已取消')
        render(); break
      }
      case 'copy': {
        const v = el.dataset.v
        if (!v) return toast('卖家还没填')
        await navigator.clipboard.writeText(v).catch(() => {})
        toast('已复制：' + v); break
      }
      case 'call': {
        const p = state.home.settings.phone
        if (!p) return toast('卖家还没填手机号')
        location.href = 'tel:' + p; break
      }
      case 'saveContact': {
        const contact = {
          name: $('#m-name').value.trim(),
          phone: $('#m-phone').value.trim()
        }
        if (!contact.name) return toast('填个姓名')
        if (!/^1\d{10}$/.test(contact.phone)) return toast('手机号不对')
        await API.call('saveContact', { contact })
        state.me.user = contact
        toast('已保存'); render(); break
      }
      case 'reload': await boot(); toast('已刷新'); break

      /* --- 初始化 --- */
      case 'bootstrap': {
        await API.call('bootstrap')
        toast('初始化完成')
        await boot(); break
      }

      /* --- 卖家工具 --- */
      case 'admin': state.view = 'admin'; state.adminTab = 'orders'; render(); break
      case 'admintab': state.adminTab = el.dataset.v; render(); break
      case 'filter': state.filter = el.dataset.v; renderAdminOrders(); break
      case 'quote': {
        const v = prompt('运费多少钱？（只填数字）', el.dataset.freight || '12')
        if (v === null) return
        await API.call('adminUpdateOrder', { id, status: 'quoted', freight: Number(v) || 0 })
        toast('已报价'); renderAdminOrders(); break
      }
      case 'paid': await API.call('adminUpdateOrder', { id, status: 'paid' }); toast('已标收款'); renderAdminOrders(); break
      case 'ship': await API.call('adminUpdateOrder', { id, status: 'shipped' }); toast('已标发出'); renderAdminOrders(); break
      case 'done': await API.call('adminUpdateOrder', { id, status: 'done' }); toast('已完成'); renderAdminOrders(); break
      case 'adminCancel': {
        if (!confirm('取消这条登记？')) return
        await API.call('adminUpdateOrder', { id, status: 'cancelled' })
        toast('已取消'); renderAdminOrders(); break
      }
      case 'note': {
        const v = prompt('给对方的留言（比如“明天下午发出”）', '')
        if (v === null) return
        await API.call('adminUpdateOrder', { id, adminNote: v })
        toast('已留言'); renderAdminOrders(); break
      }

      /* --- 商品 --- */
      case 'editProduct': openProductEditor(id); break
      case 'toggle':
        await API.call('adminToggleProduct', { id, onSale: el.dataset.on === '1' })
        toast('已更新'); renderAdminProducts(); break
      case 'delProduct': {
        if (!confirm('删除这个商品？历史登记里的记录不受影响。')) return
        await API.call('adminDeleteProduct', { id })
        toast('已删除'); renderAdminProducts(); break
      }
      case 'saveProduct': await saveProduct(); break

      /* --- 分类 --- */
      case 'saveCat': {
        const input = document.querySelector('.cat-name[data-id="' + id + '"]')
        const name = input ? input.value.trim() : ''
        if (!name) return toast('分类名不能为空')
        await API.call('adminSaveCategory', { id, name })
        toast('已保存'); renderAdminProducts(); break
      }
      case 'delCat': {
        if (!confirm('删除这个分类？分类下还有商品时会删不掉。')) return
        await API.call('adminDeleteCategory', { id })
        toast('已删除'); renderAdminProducts(); break
      }
      case 'addCat': {
        const el2 = $('#newCat')
        const name = el2 ? el2.value.trim() : ''
        if (!name) return toast('填一下分类名')
        await API.call('adminSaveCategory', { name })
        toast('已添加'); renderAdminProducts(); break
      }

      /* --- 设置 --- */
      case 'saveSettings': {
        const settings = {}
        ;['shopName', 'slogan', 'notice', 'phone', 'freightNote'].forEach((k) => {
          settings[k] = $('#s-' + k).value
        })
        await API.call('adminSaveSettings', { settings })
        toast('已保存')
        await boot(); state.view = 'admin'; state.adminTab = 'settings'; render(); break
      }
    }
  } catch (err) {
    toast(err.message || '出错了')
  }
})

async function submitOrder () {
  const lines = cartLines()
  if (!lines.length) return toast('清单是空的')
  const contact = {
    name: ($('#f-name') ? $('#f-name').value : '').trim(),
    phone: ($('#f-phone') ? $('#f-phone').value : '').trim()
  }
  const mode = 'express'
  const address = $('#f-addr') ? $('#f-addr').value.trim() : ''
  const remark = $('#f-remark') ? $('#f-remark').value.trim() : ''

  if (!contact.name) return toast('请填姓名')
  if (!/^1\d{10}$/.test(contact.phone)) return toast('手机号像是填错了')
  if (address.length < 5) return toast('请填收货地址')

  const btn = document.querySelector('[data-act="submit"]')
  if (btn) btn.disabled = true
  try {
    const r = await API.call('createOrder', {
      items: lines.map((x) => ({ productId: x.p._id, qty: x.qty })),
      contact, mode, address, remark
    })
    localStorage.setItem('tc_addr', JSON.stringify({ address, remark }))
    state.cart = {}; saveCart(); state.view = ''; state.tab = 'orders'
    state.me = await API.call('me')
    toast('已提交，编号 ' + r.orderNo)
    render()
  } finally {
    if (btn) btn.disabled = false
  }
}

async function saveProduct () {
  const id = $('#p-id').value
  const cover = $('#p-cover').value.trim()
  const file = $('#p-file').files[0]
  let finalCover = cover

  if (file) {
    const b64 = await new Promise((res, rej) => {
      const fr = new FileReader()
      fr.onload = () => res(fr.result)
      fr.onerror = rej
      fr.readAsDataURL(file)
    })
    const up = await API.call('upload', { data: b64, ext: (file.name.split('.').pop() || 'jpg') })
    finalCover = up.url
  }

  const product = {
    _id: id || undefined,
    name: $('#p-name').value.trim(),
    catId: $('#p-cat').value,
    price: Number($('#p-price').value),
    unit: $('#p-unit').value.trim() || '袋',
    weight: $('#p-weight').value.trim(),
    desc: $('#p-desc').value,
    cover: finalCover,
    images: finalCover ? [finalCover] : [],
    onSale: $('#p-onSale').checked
  }
  if (!product.name) return toast('请填名称')
  if (!(product.price >= 0)) return toast('请填参考价')

  await API.call('adminSaveProduct', { product })
  closeModal()
  toast('已保存')
  await API.call('getHome').then((h) => { state.home = h })
  renderAdminProducts()
}

const WHO_NAME = { boss: '我（卖家）', kehu1: '同事小王', kehu2: '同事小李' }
const whoName = (v) => WHO_NAME[v] || v

$('#whoSel').addEventListener('change', async (e) => {
  API.who = e.target.value
  localStorage.setItem('tc_who', API.who)
  API.token = ''
  state.view = ''; state.tab = 'home'; state.orders = null
  await boot()
  toast('已切换为：' + whoName(API.who))
})

document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    state.tab = t.dataset.tab
    state.view = ''
    render()
  })
})

boot()
