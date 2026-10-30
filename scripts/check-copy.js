#!/usr/bin/env node
/**
 * 提审前自查：扫小程序里所有会被用户/审核员看到的文案，
 * 找出容易让审核判定为「电商/交易」的词。
 *
 * 用法： node scripts/check-copy.js
 * 有命中时退出码为 1（方便接到 git hook 里）
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', 'miniprogram')

// 一出现就可能被判成电商的词：必须清零
const HARD = [
  '下单', '订单', '购买', '购物车', '结算', '付款', '支付成功',
  '商城', '店铺入口', '发货', '买家', '促销', '秒杀', '拼团', '折扣',
  '立即购买', '加入购物车', '去支付', '在线支付',
  '上架', '下架'
]

// 只是提醒：这些词本身没问题，但别和上面那些搭配
const SOFT = ['支付', '价格', '运费', '库存', '在售', '商品']

// 允许出现的例外（明确表达「不收钱」的句子）
const ALLOW = [
  '不涉及线上支付',
  '也不走线上支付',
  '不收钱'
]

function walk (dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(wxml|json|js|wxss)$/.test(name)) out.push(p)
  }
  return out
}

function isComment (line) {
  const t = line.trim()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--')
}

const files = walk(ROOT, [])
const hard = []
const soft = []

files.forEach(function (f) {
  const rel = path.relative(ROOT, f)
  const lines = fs.readFileSync(f, 'utf8').split('\n')
  lines.forEach(function (line, i) {
    if (isComment(line)) return
    const allowed = ALLOW.some(function (a) { return line.indexOf(a) > -1 })
    HARD.forEach(function (w) {
      if (allowed) return
      if (line.indexOf(w) > -1) hard.push({ file: rel, line: i + 1, word: w, text: line.trim().slice(0, 90) })
    })
    SOFT.forEach(function (w) {
      if (line.indexOf(w) > -1) soft.push({ file: rel, line: i + 1, word: w })
    })
  })
})

console.log('扫描 ' + files.length + ' 个文件\n')

if (hard.length) {
  console.log('❌ 这些地方还带着交易感，提审前建议改掉：\n')
  hard.forEach(function (h) {
    console.log('  ' + h.file + ':' + h.line + '  [' + h.word + ']')
    console.log('    ' + h.text)
  })
  console.log('')
} else {
  console.log('✅ 没有发现「下单/订单/购买/购物车/结算/付款/发货/买家」这类词\n')
}

if (soft.length) {
  const byWord = {}
  soft.forEach(function (s) { byWord[s.word] = (byWord[s.word] || 0) + 1 })
  console.log('ℹ️  这些词出现了，属于正常用法，确认一下上下文即可：')
  Object.keys(byWord).forEach(function (w) {
    console.log('  ' + w + ' × ' + byWord[w])
  })
  console.log('')
}

process.exit(hard.length ? 1 : 0)
