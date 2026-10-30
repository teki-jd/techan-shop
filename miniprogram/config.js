/**
 * 全局配置
 *
 * backend: 'http'  → 用自建服务器（server/，跑在你朋友的机器上）
 *          'cloud' → 用微信云开发（cloudfunctions/shopapi）
 *
 * ✅ 当前状态：正式上线配置（https 域名 + 真微信身份）
 * ⚠️ 改完这个文件必须重新编译；改了 httpBase 记得同步微信后台的「request 合法域名」
 */
module.exports = {
  backend: 'http',

  // ---------- 自建服务器模式 ----------
  // 必须 https 开头、结尾不要带斜杠
  httpBase: 'https://mjd-tcd.tearth.cn',

  // 本地联调时才填：服务器 DEV_MODE=1 时，填个名字就能免微信 code 登录
  // 'boss' = 你自己（卖家），'kehu1' = 另一个买家的身份
  // 线上必须为空字符串，否则前端会一直用假身份（服务器会直接 401）
  devOpenid: '',

  // ---------- 云开发模式 ----------
  // 留空 = 使用当前小程序的默认云环境；有多个环境时填环境 ID
  envId: '',
  cloudFunction: 'shopapi'
}
