# 交接说明（部署方 / 部署方的 AI 请先读这一页）

## 一、这个包只有后端，没有前端 —— 这是设计如此，不是漏传

小程序前端（界面、页面、按钮）在**店主自己的微信开发者工具**里，绑的是店主本人的 AppID。

微信的机制决定了它交不出去：

- 代码上传只认该小程序开发者身份，必须在**店主本人扫码登录**的开发者工具里做
- 提审、发布也是店主账号的操作
- 换个人拿着这份前端代码，也传不进这个小程序

所以：**不要找前端代码，也不需要它。** 这个包里没有一行界面代码。域名打开只会看到一个「后端在跑」的提示页 —— 那是对的。**不要为此加登录页、不要加管理后台网页版**，店主不要，加了也白加。

## 二、分工

| 范围 | 谁做 | 具体 |
| --- | --- | --- |
| 服务器进程 | **你（部署方）** | Node 进程常驻 + nginx 反代 + https 证书 |
| 小程序前端 | **你（部署方）** | 上传代码、真机自测、提交审核、发布。代码在另一个包 `techan-miniprogram-20261030.zip`，操作看里面的 `HANDOVER.md` |
| 商品与订单 | 店主 | 全部在小程序里操作，不碰服务器 |
| 后端代码 | 店主那边维护 | 你只负责跑起来，不改 |

你交付的东西就两样：**一个能访问的 https 域名**，和**一份自检输出**。

> 你现在的活儿不止后端：小程序的编译、上传、提审、发布也在你这边，那部分看 `techan-miniprogram-20261030.zip` 里的 `HANDOVER.md`。

## 三、你要做的（详细命令在 DEPLOY.md）

1. 代码放到 `/var/www/techan-server`
2. `cp .env.example .env`，填 `APPID` / `APPSECRET` / `TOKEN_SECRET`，`DEV_MODE=0`
3. `node index.js` 试跑，`curl 127.0.0.1:3000/api/health` 通
4. `pm2 start ecosystem.config.js && pm2 save`
5. 配 nginx 反代（模板 `nginx.conf.example`）+ `certbot --nginx -d mjd-tcd.tearth.cn --redirect`
6. 跑 `sh verify.sh`，全 ✅ 就完事

**不用 `npm install`**，零依赖，只用 Node 自带模块。Node ≥ 16（建议 18/20）。

## 四、不要做的事

| 别做 | 为什么 |
| --- | --- |
| 改 `index.js` / `actions.js` / `lib/*` | 接口契约和前端是配套的，改了就对不上，前端报错还查不出来 |
| 点「初始化店铺数据」 | 那在小程序里，谁先点谁是管理员。店主点，你别占位 |
| 把 `DEV_MODE` 设成 `1` | 开着等于任何人能冒充管理员，只在本地测接口时短暂开 |
| 加网页后台 / 登录页 / SPA | 没有网页版，店主明确不要 |
| 动 `data/` 里的文件 | 那是真实数据，`db.json` 手工改会坏 |
| 把 `.env` 发群里或截图 | 里面有 AppSecret |

## 五、自检

```bash
sh verify.sh
```

只读脚本：不启停进程、不改文件、不碰 pm2。会检查运行环境、配置文件、本机接口、域名接口，最后给一个通过/失败统计。**全 ✅ 就是部署成功**；有 ❌ 就把整段输出贴回给店主。

## 六、回给店主的信息（照这个格式）

```
1. sh verify.sh 的完整输出
2. node -v && pm2 list
3. pm2 logs techan-shop --lines 30 --nostream   （有没有报错）
```

## 七、接口契约（只读，供你判断「服务是否完整」）

所有业务接口都走同一个入口：

```
POST /api
Header: Authorization: Bearer <token>
Body:   { "action": "<名字>", ...其他参数 }
```

`actions.js` 里必须有这 19 个 action，少一个说明文件没传全：

```
bootstrap  me  saveContact  getHome  getProducts  createOrder  myOrders
cancelOrder  adminListOrders  adminUpdateOrder  adminListProducts
adminSaveProduct  adminToggleProduct  adminDeleteProduct
adminSaveCategory  adminDeleteCategory  adminGetSettings  adminSaveSettings  upload
```

`verify.sh` 会自动核对这张清单。

## 八、几个「看着像坏了，其实是正常」的现象

| 现象 | 真相 |
| --- | --- |
| 域名打开只有一个提示页，没有登录框 | 正常，没有网页版 |
| `POST /api/login {}` 返回「缺少 code」 | 正常，这是在等微信登录凭证，说明服务活着 |
| `/api/health` 里 `initialized: false` | 正常，店主还没在小程序里点初始化 |
| 首页打开是空白/没商品 | 正常，初始化不带示例商品，店主自己加 |
| `/app.html` 返回 404 | 正常，这个文件故意不在包里 |
