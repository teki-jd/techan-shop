#!/usr/bin/env node
/**
 * 把 data/products.template.csv 转成云开发数据库可以「导入」的 JSONL 文件
 *
 * 用法：
 *   node scripts/csv2jsonl.js                      # 读 data/products.template.csv
 *   node scripts/csv2jsonl.js 我的商品.csv 输出.jsonl
 *
 * 导入前注意：
 *   1) 先在云开发控制台 → 数据库 → categories 集合导入 data/categories.import.jsonl
 *   2) 再把生成的 JSONL 导入 products 集合
 *   3) 图片不需要写在 CSV 里，导入后在小程序「管理后台 → 商品 → 编辑」里传图
 */

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const csvPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'data/products.template.csv')
const outPath = process.argv[3] ? path.resolve(process.argv[3]) : path.join(root, 'data/products.import.jsonl')
const catPath = path.join(root, 'data/categories.import.jsonl')

/* ---------------------------------------------------- 极简 CSV 解析（支持引号与换行） */
function parseCsv (text) {
  text = text.replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else { quoted = false }
      } else {
        cell += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(cell); cell = ''
    } else if (ch === '\n') {
      row.push(cell); rows.push(row); row = []; cell = ''
    } else if (ch === '\r') {
      // 忽略
    } else {
      cell += ch
    }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== '' }) })
}

/* ---------------------------------------------------- 分类名 → catId */
const catMap = {}
if (fs.existsSync(catPath)) {
  fs.readFileSync(catPath, 'utf8').split('\n').forEach(function (line) {
    line = line.trim()
    if (!line) return
    try {
      const o = JSON.parse(line)
      catMap[o.name] = o._id
    } catch (e) { /* ignore */ }
  })
}

if (!fs.existsSync(csvPath)) {
  console.error('找不到 CSV：' + csvPath)
  process.exit(1)
}

const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'))
if (!rows.length) {
  console.error('CSV 是空的')
  process.exit(1)
}

const header = rows.shift().map(function (h) { return h.trim() })
const need = ['商品名', '分类', '价格', '单位']
need.forEach(function (k) {
  if (header.indexOf(k) === -1) {
    console.error('CSV 缺少列：' + k + '，当前列：' + header.join(' / '))
    process.exit(1)
  }
})

const idx = {}
header.forEach(function (h, i) { idx[h] = i })
const pick = function (r, k) {
  const i = idx[k]
  return i === undefined ? '' : String(r[i] === undefined ? '' : r[i]).trim()
}

const out = []
const unknownCats = {}
const seenNames = {}

rows.forEach(function (r, i) {
  const name = pick(r, '商品名')
  if (!name) return
  if (seenNames[name]) console.warn('⚠️ 重复商品名：' + name)
  seenNames[name] = true

  const catName = pick(r, '分类')
  let catId = catMap[catName] || ''
  if (catName && !catId) unknownCats[catName] = true

  const price = Number(pick(r, '价格').replace(/[^\d.\-]/g, ''))
  const stockRaw = pick(r, '库存')
  const stock = stockRaw === '' ? null : Number(stockRaw.replace(/[^\d\-]/g, ''))

  const tags = pick(r, '标签')
    .split(/[|,，、\s]+/)
    .map(function (t) { return t.trim() })
    .filter(Boolean)
    .slice(0, 6)

  out.push({
    name: name,
    catId: catId,
    catName: catName,
    price: isFinite(price) ? price : 0,
    unit: pick(r, '单位') || '份',
    desc: pick(r, '介绍'),
    cover: '',
    images: [],
    stock: isFinite(stock) && stock !== null ? stock : null,
    tags: tags,
    sort: (rows.length - i) * 10,
    onSale: true
  })
})

fs.writeFileSync(outPath, out.map(function (o) { return JSON.stringify(o) }).join('\n') + '\n', 'utf8')

console.log('✅ 转换完成：' + out.length + ' 个商品 → ' + outPath)
if (Object.keys(unknownCats).length) {
  console.warn('⚠️ 这些分类在 categories.import.jsonl 里找不到，catId 会是空的：' + Object.keys(unknownCats).join('、'))
  console.warn('   解决：先在 data/categories.import.jsonl 里加一行 {"_id":"cat-xxx","name":"分类名","sort":1}')
}
console.log('下一步：云开发控制台 → 数据库 → products → 导入 → 选这个文件（JSON 格式，每行一条）')
