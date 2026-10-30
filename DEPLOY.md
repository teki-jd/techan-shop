# 部署说明（源码 + pm2 方式）

> **推荐先看 `DEPLOY-DOCKER.md`**：镜像已经在 GitHub 上构建好，服务器只要 `docker pull`，比这个文件少一半步骤。
> 只有服务器装不了 docker 时，才用本文的传源码 + pm2 方式。
>
> 先读 `HANDOFF.md`（一页）：这个仓库**没有独立的网页前端**，小程序前端在 `miniprogram/`，是故意的。别找 `pages/` 之外的网页工程。

域名：**mjd-tcd.tearth.cn**（配置文件里已经填好了，不用改域名）

只有一个后端服务（只有接口，没有网页界面），零依赖，Node ≥ 16 直接跑，**不用 npm install**。

## 0. 先确认三件事

- 域名 `mjd-tcd.tearth.cn` 的解析已经指向这台服务器
- 安全组 / 防火墙放开了 **80 和 443**（3000 不用对外）
- 域名已备案（微信小程序要求）

## 1. 放代码

```bash
scp -r techan-server /var/www/ && cd /var/www/techan-server
```

## 2. 填配置

```bash
cp .env.example .env
vi .env
```

必填三行：

| 变量 | 填什么 |
| --- | --- |
| `APPID` / `APPSECRET` | 小程序后台 → 开发管理 → 开发设置（AppSecret 只在生成时显示一次，丢了要重置） |
| `TOKEN_SECRET` | 跑一句生成：`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DEV_MODE` | 必须是 `0` |

`PORT=3000`、`HOST=127.0.0.1` 保持默认，后端不直接对外。

## 3. 试跑

```bash
node index.js
curl http://127.0.0.1:3000/api/health     # 返回 ok 就通了
```

## 4. 常驻

```bash
pm2 start ecosystem.config.js && pm2 save && pm2 startup
```

## 5. 上 https

把 `nginx.conf.example` 复制成 `/etc/nginx/conf.d/techan.conf`（里面就是 mjd-tcd.tearth.cn，不用改），然后：

```bash
nginx -t && systemctl reload nginx
certbot --nginx -d mjd-tcd.tearth.cn --redirect
curl https://mjd-tcd.tearth.cn/api/health
```

证书是 certbot 自动加进配置的，不用手写 443。装了宝塔面板的话，直接在面板加站点 → 反向代理到 `http://127.0.0.1:3000` → SSL 申请 Let's Encrypt，就不用手动改这个文件。

## 6. 验证

```bash
sh verify.sh
```

这脚本只读，不启停进程、不动 pm2。它会把「Node 版本、文件是否传全、19 个接口是否都在、`.env` 四项、DEV_MODE 是否关、本机接口、域名 https」逐条查一遍，最后给通过/失败统计。

**全 ✅ 就是部署成功**。有 ❌ 的话把整段输出贴回给我，别自己猜。

手工最小验证也还是这一句：

```bash
curl https://mjd-tcd.tearth.cn/api/health
```

返回 `{"ok":true,...}` 就说明域名、证书、反代、服务全通了。

再拿浏览器打开 `https://mjd-tcd.tearth.cn/`，能看到一行「特产小铺后端在跑、店铺：未初始化」就对了。这个地址只是个接口服务，没有管理界面——所有操作都在小程序里，小程序那边由我来弄。

如果你想自己再确认一下接口真能通，可以试登录：

```bash
curl -X POST https://mjd-tcd.tearth.cn/api/login -H 'content-type: application/json' -d '{}'
```

返回 `缺少 code` 是对的（说明服务在正常校验微信登录，不是坏的）。

## 7. 首次初始化由我来做

小程序上传后，我在小程序里点「初始化店铺数据」，第一个点的人自动成为管理员。**你不用点**，你没点过就不会占掉管理员名额。

初始化只建店铺本身，**不带任何示例商品**，商品和图片我自己在后台加。所以你打开网页看到首页是空的，是正常的。

之后我加商品、传图、改店铺设置，都在小程序里做，不用改代码、也不用动服务器。

## 8. 数据在哪

- `data/db.json`：商品、订单、店铺设置
- `public/uploads/`：上传的图片

备份就打包这两个目录，重启不丢。`data/` 和 `public/uploads/` 首次启动自动创建。

## 9. 弄完回我这些

```bash
sh verify.sh
node -v && pm2 list
pm2 logs techan-shop --lines 30 --nostream
```

1. `verify.sh` 的**完整输出**（有 ❌ 就说明卡在哪一步）
2. `pm2 list` 里 `techan-shop` 是不是 `online`
3. `pm2 logs` 有没有报错

证书这块顺带确认一句：`certbot certificates` 能看到 `mjd-tcd.tearth.cn` 就行。

`.env` 里有 AppSecret，别发群里、别截图。
