/**
 * 极简 JSON 文件存储（零依赖）
 * 数据全在 data/db.json 里，写入用「临时文件 + rename」保证不写坏。
 * 这个体量（几十个商品、几百个订单）完全够用；哪天要上 MySQL 再换这一层就行。
 */
const fs = require('fs')
const path = require('path')

const FILE = process.env.DATA_FILE
  ? path.resolve(process.env.DATA_FILE)
  : path.join(__dirname, '..', 'data', 'db.json')

function empty () {
  return { settings: null, categories: [], products: [], orders: [], users: {} }
}

let db = null

function load () {
  if (db) return db
  try {
    db = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  } catch (e) {
    db = null
  }
  if (!db || typeof db !== 'object') db = empty()
  if (!Array.isArray(db.categories)) db.categories = []
  if (!Array.isArray(db.products)) db.products = []
  if (!Array.isArray(db.orders)) db.orders = []
  if (!db.users || typeof db.users !== 'object') db.users = {}
  if (db.settings === undefined) db.settings = null
  return db
}

function save () {
  const d = load()
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  const tmp = FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2), 'utf8')
  fs.renameSync(tmp, FILE)
}

let seq = 0
function id (prefix) {
  seq = (seq + 1) % 1000
  return (prefix || 'id') + '-' + Date.now().toString(36) + seq.toString(36) +
    Math.random().toString(36).slice(2, 5)
}

/* ---------------------------------------------------------------- settings */
function getSettings () {
  return load().settings
}

function setSettings (s) {
  load().settings = s
  save()
  return s
}

/* ---------------------------------------------------------------- 通用集合 */
function list (name) {
  return load()[name] || []
}

function find (name, fn) {
  return list(name).find(fn) || null
}

function findById (name, id0) {
  return list(name).find(function (x) { return x._id === id0 }) || null
}

function insert (name, doc) {
  const d = load()
  if (!d[name]) d[name] = []
  const row = Object.assign({ _id: doc._id || id(name.slice(0, 3)) }, doc)
  d[name].push(row)
  save()
  return row
}

function update (name, id0, patch) {
  const doc = findById(name, id0)
  if (!doc) return null
  Object.keys(patch).forEach(function (k) {
    if (k === 'logs_push') {
      if (!Array.isArray(doc.logs)) doc.logs = []
      doc.logs = doc.logs.concat(patch[k])
    } else {
      doc[k] = patch[k]
    }
  })
  save()
  return doc
}

function remove (name, id0) {
  const d = load()
  const before = d[name].length
  d[name] = d[name].filter(function (x) { return x._id !== id0 })
  save()
  return before !== d[name].length
}

/* ---------------------------------------------------------------- users */
function getUser (openid) {
  return load().users[openid] || null
}

function setUser (openid, u) {
  const d = load()
  d.users[openid] = Object.assign({ openid: openid }, u, { updatedAt: new Date().toISOString() })
  save()
  return d.users[openid]
}

module.exports = {
  FILE: FILE,
  load: load,
  save: save,
  id: id,
  getSettings: getSettings,
  setSettings: setSettings,
  list: list,
  find: find,
  findById: findById,
  insert: insert,
  update: update,
  remove: remove,
  getUser: getUser,
  setUser: setUser
}
