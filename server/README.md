# 特产小铺后端 · 部署说明

一个给熟人卖特产的小程序后端。**零依赖**：只用 Node 自带模块，`npm install` 都不用跑，把目录传上去就能起。

接口和小程序端的云函数版完全一致，前端只需要改 `miniprogram/config.js` 里的 `backend: 'http'`。

---

## 0. 你需要准备什么

| 项 | 说明 | 备注 |
| --- | --- | --- |
| 服务器 | 1 核 1G 就够，Linux（Ubuntu/Debian/CentOS 都行） | 这个小店一天几十次请求，配置再高是浪费 |
| Node.js | ≥ 16，推荐 18 或 20 | `node -v` 确认 |
| 域名 | 一个二级域名，如 `api.example.com` | **必须 ICP 备案**，否则微信配不上 |
| HTTPS 证书 | Let's Encrypt 免费即可 | 必须配 fullchain，微信对证书链很挑 |
| 小程序的 AppID / AppSecret | 小程序管理员提供 | AppSecret **只能放服务器**，绝不能写进小程序代码 |
| nginx | 反代用 | 也可以用 Caddy，配置更短 |

磁盘占用：代码 ~200KB，`data/db.json` 几百 KB，图片看你传多少（一张压缩后 100~300KB）。10G 盘够用很久。

---

## 1. 本地先跑起来（3 步）

```bash
cd server
cp .env.example .env
# 编辑 .env：填 APPID、APPSECRET、TOKEN_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # 生成 TOKEN_SECRET
node index.js
```

看到 `特产小铺后端已启动：http://127.0.0.1:3000` 就成了。验证：

```bash
curl -s http://127.0.0.1:3000/api/health
# {"ok":true,"data":{"ts":...,"dev":false,"initialized":false}}
```

想在本地不接微信直接测完整流程（**只在本机做**）：

```bash
DEV_MODE=1 node index.js       # 允许用 devOpenid 免 code 登录
node test.js                   # 34 项自动化检查
```

---

## 2. 上线（6 步）

### 2.1 传代码

```bash
# 本地
rsync -avz --exclude node_modules --exclude .env --exclude data/db.json \
  server/ user@your-server:/var/www/techan-shop/
```

只需要 `server/` 这一个目录，小程序前端不用传到服务器。

### 2.2 配 .env

```bash
cd /var/www/techan-shop
cp .env.example .env
vim .env
```

```ini
PORT=3000
HOST=127.0.0.1          # 只监听本机，让 nginx 转发；不要 0.0.0.0
APPID=wx1234567890abcdef
APPSECRET=你的AppSecret
TOKEN_SECRET=刚生成的那串随机字符
DEV_MODE=0              # 线上必须是 0
```

```bash
chmod 600 .env          # 别让别的用户读到
```

### 2.3 pm2 守护

```bash
npm i -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup             # 按提示复制它输出的那行命令执行，实现开机自启
pm2 logs techan-shop    # 看日志
```

### 2.4 nginx 反代

```bash
cp nginx.conf.example /etc/nginx/conf.d/techan.conf
vim /etc/nginx/conf.d/techan.conf     # 改 server_name 和证书路径
nginx -t && systemctl reload nginx
```

注意两处：
- `client_max_body_size 10m;` —— 图片是 base64 传的，太小会 413
- `proxy_pass http://127.0.0.1:3000;` —— 和 .env 里的 PORT 对上

### 2.5 证书

```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d api.example.com
systemctl list-timers | grep certbot     # 确认自动续期
```

验证证书链完整（很关键，微信只认完整链）：

```bash
curl -vI https://api.example.com/api/health 2>&1 | grep -i "SSL certificate verify"
```

### 2.6 小程序后台配域名

小程序管理员操作：**开发管理 → 开发设置 → 服务器域名 → request 合法域名**，填：

```
https://api.example.com
```

保存后立即生效（每月可改 50 次，别乱改）。这一步做完，正式版才能调通。

---

## 3. 目录说明

```
server/
├── index.js              # HTTP 服务入口：路由、鉴权、静态文件
├── actions.js            # 全部业务逻辑（和云函数版一一对应）
├── lib/
│   ├── store.js          # JSON 文件存储（原子写，不会写坏）
│   ├── auth.js           # HMAC 签名的登录 token（30 天）
│   └── wx.js             # code → openid
├── public/uploads/       # 商品图片写这里（nginx 可直接托管）
├── data/db.json          # 全部数据（首次启动自动生成）
├── test.js               # 接口自动化测试
├── ecosystem.config.js   # pm2 配置
└── nginx.conf.example    # nginx 配置示例
```

**备份就备份两个东西**：`data/db.json` 和 `public/uploads/`。

```bash
# 每天凌晨 3 点打一个包，保留 30 天
0 3 * * * tar czf /backup/techan-$(date +\%F).tar.gz -C /var/www/techan-shop data public/uploads && find /backup -name "techan-*.tar.gz" -mtime +30 -delete
```

恢复：解压覆盖回去，`pm2 restart techan-shop`。

---

## 4. 接口一览

所有业务接口都是 `POST /api`，body 里带 `action`，header 带 `Authorization: Bearer <token>`。

```bash
# 登录（真机是 wx.login 拿 code，这里演示的是 DEV_MODE 方式）
TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/login \
  -H 'content-type: application/json' -d '{"code":"xxx"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.token))")

curl -s -X POST http://127.0.0.1:3000/api \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"action":"getHome"}' | head -c 400
```

| action | 权限 | 说明 |
| --- | --- | --- |
| `bootstrap` | 任何人（仅首次有效） | 建库 + 示例数据，把第一个调用者设为管理员 |
| `me` | 登录用户 | 身份、是否管理员、店铺公开信息 |
| `getHome` / `getProducts` | 登录用户 | 商品与店铺信息 |
| `createOrder` / `myOrders` / `cancelOrder` | 登录用户 | 金额按库价重算，只看/改自己的单 |
| `saveContact` | 登录用户 | 记住联系方式 |
| `admin*` | 仅 `settings.adminOpenids` | 订单、商品、设置 |
| `upload` | 仅管理员 | base64 图片，返回 `/uploads/xxx` |

管理员白名单在 `data/db.json` 的 `settings.adminOpenids` 数组里，改完不用重启（每次请求都会读文件）。加人时注意保留原来的 openid。

---

## 5. 安全红线

1. **AppSecret 只在服务器**。泄露了别人就能冒充你的小程序调微信接口。
2. **`DEV_MODE=0`**。开着它，任何人带个名字就能登录成任何身份。
3. **`TOKEN_SECRET` 必须改**。用默认值等于谁都能伪造 token。
4. **只开 443**。3000 端口只监听 `127.0.0.1`，不要对公网开。
5. **不要用 root 跑 Node**。建个普通用户，`chown -R www-data` 或专门用户。
6. `.env` 权限 600，别提交到 git、别发群里。
7. 服务器开自动安全更新：`apt install unattended-upgrades`。

---

## 6. 常见故障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 小程序报 `url not in domain list` | 后台没配域名 | 配 `request 合法域名` |
| 报 `ssl handshake failed` | 证书链不全 | nginx 用 `fullchain.pem`，`curl -vI` 验证 |
| 502 Bad Gateway | 后端没起 / 端口不对 | `pm2 status`、`pm2 logs` |
| 上传图片 413 | nginx body 太小 | `client_max_body_size 10m` |
| 上传报 500 | `public/uploads` 没写权限 | `chown -R <运行用户> public/uploads` |
| 登录一直失败 | APPID/APPSECRET 错，或小程序没勾"用户信息" | `pm2 logs` 看微信返回的 errcode |
| `data/db.json` 变成空 | 磁盘满或权限问题 | 检查 `df -h`，确认写权限；有备份就恢复 |

---

## 7. 升级 / 维护

```bash
# 升级代码（不覆盖数据和图片）
rsync -avz --exclude node_modules --exclude .env --exclude data --exclude public/uploads \
  server/ user@server:/var/www/techan-shop/
pm2 restart techan-shop
```

数据量真的涨起来（几千单）再考虑换 SQLite / MySQL，只需要重写 `lib/store.js`，`actions.js` 不用动。
