/**
 * 购物清单（本地存储，只存 productId + 数量，价格永远以服务端为准）
 */
const KEY = 'techan_cart'

function read () {
  const v = wx.getStorageSync(KEY)
  return Array.isArray(v) ? v : []
}

function write (list) {
  wx.setStorageSync(KEY, list)
  return list
}

function count () {
  return read().reduce(function (s, i) { return s + (i.qty || 0) }, 0)
}

function add (productId, qty) {
  const list = read()
  const hit = list.find(function (i) { return i.productId === productId })
  if (hit) {
    hit.qty = Math.min(999, (hit.qty || 1) + (qty || 1))
  } else {
    list.push({ productId: productId, qty: qty || 1 })
  }
  write(list)
  return count()
}

function remove (productId) {
  write(read().filter(function (i) { return i.productId !== productId }))
  return count()
}

function clear () {
  write([])
}

module.exports = { read: read, write: write, count: count, add: add, remove: remove, clear: clear }
