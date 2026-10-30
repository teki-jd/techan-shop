const config = require('../config')

const TOKEN_KEY = 'techan_token'
const WHO_KEY = 'techan_token_who'
// 本地联调时会改 devOpenid 来切换身份。身份变了，旧 token 必须作废，
// 否则改完重新编译还是在用上一个人的登录态，看起来像"切不过来"。
const WHO = config.devOpenid || 'wx'
let tokenCache = wx.getStorageSync(TOKEN_KEY) || ''
if (tokenCache && wx.getStorageSync(WHO_KEY) !== WHO) {
  tokenCache = ''
  wx.removeStorageSync(TOKEN_KEY)
}

function saveToken (t) {
  tokenCache = t
  wx.setStorageSync(TOKEN_KEY, t)
  wx.setStorageSync(WHO_KEY, WHO)
}

/* =====================================================================
 * 云开发模式
 * =================================================================== */
function cloudCall (action, data) {
  return wx.cloud
    .callFunction({
      name: config.cloudFunction,
      data: Object.assign({ action: action }, data || {})
    })
    .then(function (res) {
      const r = res && res.result
      if (!r || r.ok !== true) throw new Error((r && r.msg) || '服务异常，请稍后重试')
      return r.data
    })
    .catch(function (e) {
      let msg = (e && e.message) || '网络异常'
      if (/FunctionName|not found|-501000|cloud function/i.test(msg)) {
        msg = '云函数未部署：请在开发者工具里右键 cloudfunctions/shopapi → 上传并部署'
      }
      throw new Error(msg)
    })
}

function cloudUpload (paths, dir) {
  const list = (paths || []).map(function (p, i) {
    const ext = (p.match(/\.(\w+)$/) || [, 'jpg'])[1]
    const name = (dir || 'products') + '/' + Date.now() + '-' + i + '.' + ext
    return wx.cloud.uploadFile({ cloudPath: name, filePath: p }).then(function (r) {
      return r.fileID
    })
  })
  return Promise.all(list)
}

/* =====================================================================
 * 自建服务器模式
 * =================================================================== */
function httpLogin (force) {
  if (tokenCache && !force) return Promise.resolve(tokenCache)

  if (config.devOpenid) {
    // 本地联调：服务器 DEV_MODE=1 时免 code 登录
    return request('/api/login', { devOpenid: config.devOpenid }).then(function (d) {
      saveToken(d.token)
      return d.token
    })
  }

  return new Promise(function (resolve, reject) {
    wx.login({
      success: function (r) {
        if (!r.code) return reject(new Error('微信登录失败：没拿到 code'))
        request('/api/login', { code: r.code }).then(function (d) {
          saveToken(d.token)
          resolve(d.token)
        }).catch(reject)
      },
      fail: function () { reject(new Error('微信登录失败')) }
    })
  })
}

/** 裸请求（不带 token），path 是 /api/xxx */
function request (path, data) {
  return new Promise(function (resolve, reject) {
    wx.request({
      url: config.httpBase.replace(/\/+$/, '') + path,
      method: 'POST',
      data: data || {},
      header: { 'content-type': 'application/json' },
      timeout: 15000,
      success: function (res) {
        const body = res.data || {}
        if (body.ok === true) return resolve(body.data)
        if (res.statusCode === 401) {
          const e = new Error(body.msg || '登录已过期')
          e.needLogin = true
          return reject(e)
        }
        reject(new Error(body.msg || ('服务异常（HTTP ' + res.statusCode + '）')))
      },
      fail: function (e) {
        const msg = (e && e.errMsg) || ''
        if (/domain list|not in domain/i.test(msg)) {
          return reject(new Error('域名没加到白名单：小程序后台 → 开发管理 → 服务器域名 → request 合法域名'))
        }
        if (/ssl|certificate/i.test(msg)) {
          return reject(new Error('HTTPS 证书有问题，检查服务器证书是否有效、是否过期'))
        }
        reject(new Error('网络不通：' + msg))
      }
    })
  })
}

function httpCall (action, data, retried) {
  return httpLogin().then(function (token) {
    return new Promise(function (resolve, reject) {
      wx.request({
        url: config.httpBase.replace(/\/+$/, '') + '/api',
        method: 'POST',
        data: Object.assign({ action: action }, data || {}),
        header: {
          'content-type': 'application/json',
          Authorization: 'Bearer ' + token
        },
        timeout: 15000,
        success: function (res) {
          const body = res.data || {}
          if (body.ok === true) return resolve(body.data)
          if (res.statusCode === 401) {
            const e = new Error(body.msg || '登录已过期')
            e.needLogin = true
            return reject(e)
          }
          reject(new Error(body.msg || ('服务异常（HTTP ' + res.statusCode + '）')))
        },
        fail: function (e) {
          const msg = (e && e.errMsg) || ''
          if (/domain list|not in domain/i.test(msg)) {
            return reject(new Error('域名没加到白名单：小程序后台 → 开发管理 → 服务器域名 → request 合法域名'))
          }
          if (/ssl|certificate/i.test(msg)) {
            return reject(new Error('HTTPS 证书有问题，检查证书是否有效、是否过期'))
          }
          reject(new Error('网络不通：' + msg))
        }
      })
    })
  }).catch(function (e) {
    if (e.needLogin && !retried) {
      tokenCache = ''
      wx.removeStorageSync(TOKEN_KEY)
      return httpLogin(true).then(function () { return httpCall(action, data, true) })
    }
    throw e
  })
}

function httpUpload (paths) {
  const fs = wx.getFileSystemManager()
  const base = config.httpBase.replace(/\/+$/, '')
  const list = (paths || []).map(function (p) {
    return new Promise(function (resolve, reject) {
      let b64
      try {
        b64 = fs.readFileSync(p, 'base64')
      } catch (e) {
        return reject(new Error('读取本地图片失败'))
      }
      const ext = (p.match(/\.(\w+)$/) || [, 'jpg'])[1].toLowerCase()
      httpCall('upload', { data: 'data:image/' + ext + ';base64,' + b64, ext: ext })
        .then(function (d) {
          const url = d.fileID || d.url
          resolve(/^https?:/.test(url) ? url : base + url)
        })
        .catch(reject)
    })
  })
  return Promise.all(list)
}

/* =====================================================================
 * 对外统一接口
 * =================================================================== */
const isHttp = config.backend === 'http'

module.exports = {
  backend: isHttp ? 'http' : 'cloud',
  call: function (action, data) {
    return isHttp ? httpCall(action, data) : cloudCall(action, data)
  },
  uploadImages: function (paths, dir) {
    return isHttp ? httpUpload(paths) : cloudUpload(paths, dir)
  },
  /** 退出登录态（切换身份测试时用） */
  resetAuth: function () {
    tokenCache = ''
    wx.removeStorageSync(TOKEN_KEY)
    wx.removeStorageSync(WHO_KEY)
  }
}
