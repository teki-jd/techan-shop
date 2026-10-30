/**
 * 本地内存版 wx-server-sdk 模拟器（仅用于自动化测试，不参与小程序运行）
 */
const store = {}
let currentOpenid = 'openid-admin'

function coll (name) {
  if (!store[name]) store[name] = new Map()
  return store[name]
}

function clone (o) {
  return JSON.parse(JSON.stringify(o))
}

const CMD = Symbol('cmd')
const cmd = (op, val) => ({ [CMD]: op, val })

const _ = {
  in: (arr) => cmd('in', arr),
  neq: (v) => cmd('neq', v),
  push: (arr) => cmd('push', arr),
  eq: (v) => cmd('eq', v)
}

function matchDoc (doc, cond) {
  for (const k in cond) {
    const c = cond[k]
    const v = doc[k]
    if (c && typeof c === 'object' && c[CMD]) {
      if (c[CMD] === 'in') {
        if (!c.val.map(String).includes(String(v))) return false
      } else if (c[CMD] === 'neq') {
        if (v === c.val) return false
      } else if (c[CMD] === 'eq') {
        if (v !== c.val) return false
      }
    } else if (String(v) !== String(c)) {
      return false
    }
  }
  return true
}

function applyUpdate (doc, data) {
  for (const k in data) {
    const v = data[k]
    if (v && typeof v === 'object' && v[CMD]) {
      if (v[CMD] === 'push') {
        if (!Array.isArray(doc[k])) doc[k] = []
        doc[k] = doc[k].concat(clone(v.val))
      }
      continue
    }
    doc[k] = clone(v)
  }
}

class Query {
  constructor (name) {
    this.name = name
    this._where = null
    this._order = []
    this._limit = 100
    this._skip = 0
  }
  where (cond) { this._where = cond; return this }
  orderBy (field, dir) { this._order.push([field, dir === 'desc' ? -1 : 1]); return this }
  limit (n) { this._limit = n; return this }
  skip (n) { this._skip = n; return this }
  _rows () {
    let rows = Array.from(coll(this.name).values()).map(clone)
    if (this._where) rows = rows.filter((d) => matchDoc(d, this._where))
    for (let i = this._order.length - 1; i >= 0; i--) {
      const [f, dir] = this._order[i]
      rows.sort((a, b) => {
        const av = a[f] === undefined ? null : a[f]
        const bv = b[f] === undefined ? null : b[f]
        if (av === bv) return 0
        if (av === null) return 1
        if (bv === null) return -1
        return av > bv ? dir : -dir
      })
    }
    return rows.slice(this._skip, this._skip + this._limit)
  }
  async get () { return { data: this._rows() } }
  async count () {
    let rows = Array.from(coll(this.name).values())
    if (this._where) rows = rows.filter((d) => matchDoc(d, this._where))
    return { total: rows.length }
  }
  async update (o) {
    let rows = Array.from(coll(this.name).values())
    if (this._where) rows = rows.filter((d) => matchDoc(d, this._where))
    rows.forEach((r) => applyUpdate(r, o.data))
    return { stats: { updated: rows.length } }
  }
  async remove () {
    let rows = Array.from(coll(this.name).values())
    if (this._where) rows = rows.filter((d) => matchDoc(d, this._where))
    rows.forEach((r) => coll(this.name).delete(r._id))
    return { stats: { removed: rows.length } }
  }
}

class Doc {
  constructor (name, id) { this.name = name; this.id = id }
  async get () {
    const d = coll(this.name).get(this.id)
    if (!d) {
      const e = new Error('document.get:fail document does not exist')
      e.errCode = -1
      throw e
    }
    return { data: clone(d) }
  }
  async set (o) {
    const doc = Object.assign({ _id: this.id }, clone(o.data))
    coll(this.name).set(this.id, doc)
    return { _id: this.id }
  }
  async update (o) {
    const d = coll(this.name).get(this.id)
    if (!d) throw new Error('document.update:fail document does not exist')
    applyUpdate(d, o.data)
    return { stats: { updated: 1 } }
  }
  async remove () {
    coll(this.name).delete(this.id)
    return { stats: { removed: 1 } }
  }
}

class Collection extends Query {
  doc (id) { return new Doc(this.name, id) }
  async add (o) {
    const id = 'id-' + Math.random().toString(36).slice(2, 10)
    coll(this.name).set(id, Object.assign({ _id: id }, clone(o.data)))
    return { _id: id }
  }
}

const db = {
  command: _,
  collection: (name) => new Collection(name),
  createCollection: async (name) => { coll(name); return { errMsg: 'ok' } }
}

module.exports = {
  init () {},
  DYNAMIC_CURRENT_ENV: 'DYNAMIC_CURRENT_ENV',
  getWXContext () { return { OPENID: currentOpenid, APPID: 'wxtest' } },
  database () { return db },
  __setOpenid (v) { currentOpenid = v },
  __store: store
}
