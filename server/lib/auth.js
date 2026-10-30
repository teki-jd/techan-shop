/**
 * 登录态：自己签一个不重的 token（HMAC-SHA256），不用装 jsonwebtoken。
 * 格式：base64url(payload) + '.' + base64url(hmac)
 * payload = { o: openid, exp: 毫秒时间戳 }
 */
const crypto = require('crypto')

const SECRET = process.env.TOKEN_SECRET || 'change-me-please'
const TTL = 1000 * 60 * 60 * 24 * 30 // 30 天

function b64 (buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function unb64 (str) {
  str = String(str).replace(/-/g, '+').replace(/_/g, '/')
  while (str.length % 4) str += '='
  return Buffer.from(str, 'base64')
}

function sign (str) {
  return b64(crypto.createHmac('sha256', SECRET).update(str).digest())
}

function issue (openid) {
  const payload = b64(JSON.stringify({ o: openid, exp: Date.now() + TTL }))
  return payload + '.' + sign(payload)
}

/** 返回 openid，失败返回 null */
function verify (token) {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 2) return null
  if (sign(parts[0]) !== parts[1]) return null
  let p
  try {
    p = JSON.parse(unb64(parts[0]).toString('utf8'))
  } catch (e) {
    return null
  }
  if (!p || !p.o || !p.exp || p.exp < Date.now()) return null
  return String(p.o)
}

module.exports = { issue: issue, verify: verify }
