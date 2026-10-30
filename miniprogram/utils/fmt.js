/**
 * 展示格式化工具
 */
function money (n) {
  const v = Number(n || 0)
  const s = v.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
  return s
}

function pad (n) {
  return n < 10 ? '0' + n : '' + n
}

function time (v) {
  if (!v) return ''
  const d = new Date(v)
  if (isNaN(d.getTime())) return ''
  return (
    d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  )
}

const STATUS_TEXT = {
  pending: '待确认',
  quoted: '已报运费',
  paid: '已收款',
  shipped: '已发出',
  done: '已完成',
  cancelled: '已取消'
}

const STATUS_COLOR = {
  pending: '#B4472E',
  quoted: '#C08A47',
  paid: '#2F7A55',
  shipped: '#2F6BA6',
  done: '#8C8279',
  cancelled: '#B0A79C'
}

/** 给订单补充展示字段 */
function decorateOrder (o) {
  const items = (o.items || []).map(function (it) {
    return Object.assign({}, it, {
      priceText: money(it.price),
      lineText: money((it.price || 0) * (it.qty || 1))
    })
  })
  return Object.assign({}, o, {
    items: items,
    amountText: money(o.amount),
    freightText: o.freight ? money(o.freight) : '',
    totalText: money((o.amount || 0) + (o.freight || 0)),
    statusText: STATUS_TEXT[o.status] || o.status,
    statusColor: STATUS_COLOR[o.status] || '#8C8279',
    timeText: time(o.createdAt),
    summary: items.map(function (i) { return i.name + '×' + i.qty }).join('、')
  })
}

module.exports = {
  money: money,
  time: time,
  STATUS_TEXT: STATUS_TEXT,
  decorateOrder: decorateOrder
}
