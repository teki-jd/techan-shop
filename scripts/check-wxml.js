/** 简易 WXML 标签配对自检：node scripts/check-wxml.js */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', 'miniprogram')
const files = []
;(function walk (d) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n)
    if (fs.statSync(p).isDirectory()) walk(p)
    else if (n.endsWith('.wxml')) files.push(p)
  }
})(root)

const TAGS = ['view', 'block', 'scroll-view', 'swiper', 'swiper-item', 'picker', 'textarea', 'button', 'text', 'image', 'input']
let bad = 0

for (const f of files) {
  const t = fs.readFileSync(f, 'utf8')
  for (const tag of TAGS) {
    // (?=[\s>/]) 是必须的：不加的话 <textarea ... /> 会被算成 <text ... />
    const open = (t.match(new RegExp('<' + tag + '(?=[\\s>/])', 'g')) || []).length
    const selfClose = (t.match(new RegExp('<' + tag + '(?=[\\s/])[^>]*/>', 'g')) || []).length
    const close = (t.match(new RegExp('</' + tag + '>', 'g')) || []).length
    if (tag === 'image' || tag === 'input') continue // 这两个常写成自闭合
    if (open - selfClose !== close) {
      bad++
      console.log('❌ ' + path.relative(root, f) + ' <' + tag + '> 开' + open + ' 自闭' + selfClose + ' 闭' + close)
    }
  }
}

console.log(bad ? '\n有 ' + bad + ' 处标签不配对' : '✅ WXML 标签配对正常（' + files.length + ' 个文件）')
process.exit(bad ? 1 : 0)
