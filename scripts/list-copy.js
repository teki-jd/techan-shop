#!/usr/bin/env node
/**
 * 扫描所有界面文案，生成 docs/06-文案清单.md
 * 用途：改文案时对照着找文件、找行号；改完重跑一次，行号自动更新。
 *
 * 用法： node scripts/list-copy.js
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const MP = path.join(ROOT, 'miniprogram')
const OUT = path.join(ROOT, 'docs', '06-文案清单.md')

const HAS_CN = /[\u4e00-\u9fa5]/
const rows = [] // { file, line, text, kind }

function rel (p) { return path.relative(ROOT, p) }
function push (file, line, text, kind) {
  const t = String(text).replace(/\s+/g, ' ').trim()
  if (!t || !HAS_CN.test(t)) return
  rows.push({ file: rel(file), line: line, text: t, kind: kind })
}

/** wxml：正文文字、placeholder、按钮文字 */
function scanWxml (file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  let inComment = false
  lines.forEach(function (line, i) {
    const ln = i + 1
    // 跳过 <!-- --> 注释（含多行）
    if (inComment) {
      if (line.indexOf('-->') >= 0) inComment = false
      return
    }
    if (line.indexOf('<!--') >= 0) {
      if (line.indexOf('-->') < 0) inComment = true
      return
    }
    // 去掉行内注释尾部
    let s = line.replace(/<!--[\s\S]*?-->/g, '')

    // placeholder / value 等属性里的提示语
    s.replace(/(placeholder|placeholder-class)\s*=\s*"([^"]*)"/g, function (_, k, v) {
      if (k === 'placeholder') push(file, ln, v, '输入框提示')
      return ''
    })

    // 标签之间的可见文字：>文字<
    const m = s.match(/>([^<>]*)</g) || []
    m.forEach(function (seg) {
      let t = seg.slice(1, -1).trim()
      if (!t) return
      // 纯表达式、纯符号的不算文案
      if (/^\{\{[\s\S]*\}\}$/.test(t) && t.indexOf('?') < 0) return
      if (!HAS_CN.test(t)) return
      push(file, ln, t, '页面文字')
    })
  })
}

/** js：toast / modal / 标题 */
function scanJs (file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  let pending = null
  lines.forEach(function (line, i) {
    const ln = i + 1
    if (/wx\.showToast|wx\.showModal|setNavigationBarTitle|navigationBarTitleText/.test(line)) {
      pending = ln
    }
    const re = /(['"])((?:(?!\1)[^\\]|\\.)*[\u4e00-\u9fa5](?:(?!\1)[^\\]|\\.)*)\1/g
    let m
    while ((m = re.exec(line))) {
      const kind = /setNavigationBarTitle|navigationBarTitleText/.test(line)
        ? '页面标题'
        : (pending === ln ? '提示/弹窗' : '代码内文案')
      push(file, ln, m[2].replace(/\\n/g, ' ⏎ '), kind)
    }
  })
}

/** 目录遍历 */
function walk (dir, exts, fn) {
  fs.readdirSync(dir).forEach(function (n) {
    const p = path.join(dir, n)
    const st = fs.statSync(p)
    if (st.isDirectory()) return walk(p, exts, fn)
    if (exts.some(function (e) { return n.endsWith(e) })) fn(p)
  })
}

/* ---------------------------------------------- 采集 */
const PAGES = fs.readdirSync(path.join(MP, 'pages')).sort()

PAGES.forEach(function (p) {
  const base = path.join(MP, 'pages', p)
  const wxml = path.join(base, 'index.wxml')
  const js = path.join(base, 'index.js')
  const json = path.join(base, 'index.json')
  if (fs.existsSync(wxml)) scanWxml(wxml)
  if (fs.existsSync(js)) scanJs(js)
  if (fs.existsSync(json)) scanJs(json)
})

// 全局
scanJs(path.join(MP, 'app.json'))
scanJs(path.join(MP, 'utils', 'fmt.js'))
scanJs(path.join(MP, 'app.js'))

// 后端默认值（初始化时写入数据库，只影响「清空数据后重新初始化」）
const backendFiles = [
  path.join(ROOT, 'server', 'actions.js'),
  path.join(ROOT, 'cloudfunctions', 'shopapi', 'index.js')
].filter(fs.existsSync)

/* ---------------------------------------------- 输出 */
function groupOf (f) {
  const m = f.match(/pages\/([^/]+)\//)
  if (m) return m[1]
  if (f.indexOf('app.json') >= 0) return '_global'
  if (f.indexOf('utils/') >= 0) return '_status'
  if (f.indexOf('app.js') >= 0) return '_global'
  return 'zzz'
}

const GROUP_NAME = {
  _global: '全局（底部导航、窗口标题）',
  _status: '登记状态文字（买家/卖家两侧共用）',
  index: '首页（目录）',
  detail: '条目详情',
  checkout: '确认登记',
  orders: '我的登记',
  mine: '我的',
  admin: '卖家工具（订单 / 商品 / 店铺设置）',
  'admin-product': '条目编辑'
}

const ORDER = ['_global', 'index', 'detail', 'checkout', 'orders', 'mine', 'admin', 'admin-product', '_status']

const groups = {}
rows.forEach(function (r) {
  const g = groupOf(r.file)
  ;(groups[g] = groups[g] || []).push(r)
})

let md = ''
md += '# 界面文案清单\n\n'
md += '> 本文件由 `node scripts/list-copy.js` 自动生成，**请不要手改这里的内容**。\n'
md += '> 改文案请直接改表里「文件」那一列指向的文件，改完重跑脚本，行号会自动更新。\n\n'
md += '当前共 **' + rows.length + '** 处含中文的界面文案。\n\n'

md += '## 改之前先看这三条\n\n'
md += '1. **90% 的文案在 7 个 `index.wxml` 里**（页面文字、按钮、输入框提示），直接改文字即可，不用动结构。\n'
md += '2. **弹窗和 toast 在对应的 `index.js` 里**，通常形如 `wx.showToast({ title: \'xxx\' })`。\n'
md += '3. **底部导航和页面标题不在这两处**：底部导航在 `miniprogram/app.json` 的 `tabBar.list[].text`，页面标题在各自目录的 `index.json` 的 `navigationBarTitleText`。\n\n'
md += '> 改完记得跑一次 `node scripts/check-copy.js`，它会检查有没有把「下单 / 订单 / 商品 / 上架」这类词又写回来（按工具类目提审时用）。\n\n'

ORDER.concat(Object.keys(groups).filter(function (k) { return ORDER.indexOf(k) < 0 })).forEach(function (g) {
  const list = groups[g]
  if (!list || !list.length) return
  md += '---\n\n## ' + (GROUP_NAME[g] || g) + '\n\n'
  md += '| 文件 | 行 | 类型 | 当前文案 |\n| --- | --- | --- | --- |\n'
  const seen = {}
  list.forEach(function (r) {
    const key = r.file + ':' + r.line + ':' + r.text
    if (seen[key]) return
    seen[key] = 1
    md += '| `' + r.file + '` | ' + r.line + ' | ' + r.kind + ' | ' + r.text.replace(/\|/g, '\\|') + ' |\n'
  })
  md += '\n'
})

md += '---\n\n## 不在小程序前端、但买家能看到的字\n\n'
md += '这几个是**后端初始化时写进数据库**的默认值，只有「清空数据重新初始化」才会用到。\n'
md += '正常改店名、公告、运费说明，直接在**卖家工具 → 店铺设置**里改，改完立即生效，不用动代码。\n\n'

md += '| 文件 | 行 | 字段 | 默认值 |\n| --- | --- | --- | --- |\n'
backendFiles.forEach(function (f) {
  const lines = fs.readFileSync(f, 'utf8').split('\n')
  lines.forEach(function (line, i) {
    const m = line.match(/^\s*(shopName|slogan|notice|freightNote|pickupNote)\s*:\s*['"]([^'"]+)['"]/)
    if (m) md += '| `' + rel(f) + '` | ' + (i + 1) + ' | ' + m[1] + ' | ' + m[2].replace(/\|/g, '\\|') + ' |\n'
  })
})

md += '\n> 示例条目的名字和介绍（野生黑木耳、土蜂蜜等）也在上面两个文件的 `prodSeed` 里，同样只在初始化时写入。\n'

if (fs.existsSync(path.join(ROOT, 'server', 'public', 'app.html'))) {
  md += '\n---\n\n## 网页版体验页（仅本地测试用，交付前可删）\n\n'
  md += '`server/public/app.html` + `server/public/app.js` 里另有一套页面文字，' +
    '和上面小程序的不共用。正式交付朋友部署时，删掉这三个 `app.*` 文件即可，不影响小程序。\n'
}

fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true })
fs.writeFileSync(OUT, md)
console.log('✅ 已生成 ' + rel(OUT) + '（' + rows.length + ' 处文案，' +
  Object.keys(groups).length + ' 个分组）')
