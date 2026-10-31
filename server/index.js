/**
 * 老家特产小铺 · 自建服务器版后端
 * 零依赖：只用 Node 自带模块，不需要 npm install。
 * 启动： node index.js          （先按 .env.example 建好 .env）
 * 开发测试： DEV_MODE=1 node index.js
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { URL } = require('url')

/* ---------------------------------------------------------------- 读 .env（零依赖） */
;(function loadEnv () {
  const f = path.join(__dirname, '.env')
  if (!fs.existsSync(f)) return
  fs.readFileSync(f, 'utf8').split('\n').forEach(function (line) {
    line = line.trim()
    if (!line || line[0] === '#') return
    const i = line.indexOf('=')
    if (i < 0) return
    const k = line.slice(0, i).trim()
    let v = line.slice(i + 1).trim()
    if ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'")) {
      v = v.slice(1, -1)
    }
    if (!process.env[k]) process.env[k] = v
  })
})()

const auth = require('./lib/auth')
const wx = require('./lib/wx')
const store = require('./lib/store')
const actions = require('./actions')

const PORT = Number(process.env.PORT || 3000)
const HOST = process.env.HOST || '0.0.0.0'
const DEV = process.env.DEV_MODE === '1'
const PUBLIC_DIR = path.join(__dirname, 'public')
const MAX_BODY = 8 * 1024 * 1024

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.css': 'text/css', '.js': 'application/javascript', '.html': 'text/html',
  '.json': 'application/json'
}

function sendJson (res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

const ok = function (res, data) { sendJson(res, 200, { ok: true, data: data }) }
const bad = function (res, code, msg) { sendJson(res, code, { ok: false, msg: msg }) }

function readBody (req) {
  return new Promise(function (resolve, reject) {
    let size = 0
    let over = false
    const chunks = []
    req.on('data', function (c) {
      size += c.length
      if (!over && size > MAX_BODY) {
        over = true
        chunks.length = 0 // 已经收的也丢掉，不留着占内存
        const err = new Error('内容太大（上限 8MB；图片转 base64 会放大约三分之一，原图请小于 6MB）')
        err.statusCode = 413
        reject(err)
      }
      if (over) {
        // 故意不掐连接：继续把客户端发来的数据读完丢弃，
        // 这样它才能收到上面那 413，而不是「连接被重置」。
        // 但设个上限，防止有人无限往里灌。
        if (size > MAX_BODY * 4) req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', function () {
      if (over) return
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (e) {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', function (e) {
      if (!over) reject(e)
    })
  })
}

function serveStatic (req, res, pathname) {
  if (pathname === '/') {
    const s = store.getSettings()
    // 网页版是可选的：public/app.html 在才显示入口（正式部署可以不带网页版）
    const hasWeb = fs.existsSync(path.join(PUBLIC_DIR, 'app.html'))
    const body = '<!doctype html><meta charset="utf-8"><title>特产小铺后端</title>' +
      '<style>body{font:14px/1.7 -apple-system,PingFang SC,sans-serif;padding:40px;color:#2c2723;background:#fbf7f0}' +
      'code{background:#f4e4dc;padding:2px 6px;border-radius:4px}' +
      'a.btn{display:inline-block;margin-top:14px;padding:10px 22px;background:#b4472e;color:#fff;border-radius:999px;text-decoration:none;font-weight:600}</style>' +
      '<h2>特产小铺后端在跑</h2>' +
      '<p>店铺：' + (s ? (s.shopName || '(未命名)') : '未初始化') + '</p>' +
      '<p>健康检查：<code>GET /api/health</code>　接口：<code>POST /api</code> （body 里带 action）</p>' +
      (hasWeb
        ? '<p><b>网页版体验入口：</b><a class="btn" href="/app.html">打开 /app.html</a>（顶栏可切换「我是谁」）</p>'
        : '<p>这个地址只提供接口，管理入口在小程序里。</p>')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(body)
  }

  const rel = pathname.replace(/^\/+/, '')
  const file = path.join(PUBLIC_DIR, rel)
  if (!file.startsWith(PUBLIC_DIR)) return bad(res, 403, 'forbidden')
  fs.readFile(file, function (err, buf) {
    if (err) return bad(res, 404, 'not found')
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': buf.length,
      'Cache-Control': 'public, max-age=31536000'
    })
    res.end(buf)
  })
}

const server = http.createServer(async function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.end()

  let u
  try {
    u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'))
  } catch (e) {
    return bad(res, 400, 'bad url')
  }
  const p = u.pathname

  if (p === '/api/health') {
    return ok(res, { ts: Date.now(), dev: DEV, initialized: !!store.getSettings() })
  }

  /* ---------------- 登录：code 换 openid，发一个 token ---------------- */
  if (p === '/api/login' && req.method === 'POST') {
    let body
    try { body = await readBody(req) } catch (e) { return bad(res, e.statusCode || 400, e.message) }
    try {
      let openid
      if (DEV && body.devOpenid) {
        openid = 'dev-' + String(body.devOpenid).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24)
        console.warn('[登录] DEV_MODE 绕过微信校验，openid =', openid)
      } else {
        if (!body.code) return bad(res, 400, '缺少 code')
        openid = await wx.code2openid(body.code)
      }
      return ok(res, { token: auth.issue(openid), dev: !!body.devOpenid })
    } catch (e) {
      return bad(res, 401, e.message)
    }
  }

  /* ---------------- 业务接口 ---------------- */
  if (p === '/api' && req.method === 'POST') {
    let body
    try { body = await readBody(req) } catch (e) { return bad(res, e.statusCode || 400, e.message) }

    const h = req.headers.authorization || ''
    const token = h.replace(/^Bearer\s+/i, '')
    const openid = auth.verify(token)
    if (!openid) return bad(res, 401, '登录已过期，请重新进入小程序')

    const action = body.action
    if (!action) return bad(res, 400, '缺少 action')
    delete body.action

    try {
      const data = await actions.dispatch(openid, action, body)
      return ok(res, data)
    } catch (e) {
      console.warn('[api]', action, (e && e.message) || e)
      return bad(res, 200, (e && e.message) || '服务异常')
    }
  }

  if (req.method === 'GET') return serveStatic(req, res, p)
  return bad(res, 404, 'not found')
})

server.listen(PORT, HOST, function () {
  console.log('特产小铺后端已启动：http://' + HOST + ':' + PORT)
  console.log('数据文件：' + store.FILE)
  if (DEV) console.log('⚠️  DEV_MODE 已开启：任何人不带 code 也能登录为指定 openid，只用于本地测试，上线前务必关掉')
  if (!process.env.APPID || !process.env.APPSECRET) {
    console.warn('⚠️  还没配 APPID / APPSECRET，真机的微信登录会失败（DEV_MODE 下可绕过）')
  }
  if (!process.env.TOKEN_SECRET) {
    console.warn('⚠️  还没配 TOKEN_SECRET，正在用默认值，上线前务必改成随机长字符串')
  }
})

process.on('SIGTERM', function () { server.close(function () { process.exit(0) }) })
