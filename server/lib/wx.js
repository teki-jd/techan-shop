/**
 * 微信登录：code → openid
 * 只有服务器持有 AppSecret，绝不能放到小程序里。
 */
const https = require('https')

function get (url) {
  return new Promise(function (resolve, reject) {
    const req = https.get(url, { timeout: 8000 }, function (res) {
      let buf = ''
      res.setEncoding('utf8')
      res.on('data', function (c) { buf += c })
      res.on('end', function () {
        try { resolve(JSON.parse(buf)) } catch (e) { reject(new Error('微信接口返回异常：' + buf.slice(0, 200))) }
      })
    })
    req.on('timeout', function () { req.destroy(new Error('调用微信接口超时')) })
    req.on('error', reject)
  })
}

async function code2openid (code) {
  const appid = process.env.APPID
  const secret = process.env.APPSECRET
  if (!appid || !secret) throw new Error('服务器没配 APPID / APPSECRET')
  const url = 'https://api.weixin.qq.com/sns/jscode2session?appid=' + encodeURIComponent(appid) +
    '&secret=' + encodeURIComponent(secret) +
    '&js_code=' + encodeURIComponent(code) +
    '&grant_type=authorization_code'
  const r = await get(url)
  if (!r.openid) {
    throw new Error('微信登录失败：' + (r.errmsg || '未知错误') + '（' + (r.errcode || '') + '）')
  }
  return r.openid
}

module.exports = { code2openid: code2openid }
