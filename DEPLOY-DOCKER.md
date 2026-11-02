# 容器部署（推荐路线）

> 你现在不需要再接收 zip、也不需要 `git clone`。镜像已经在 GitHub 上构建好了，服务器上只要 `docker pull`。
>
> 另一条老路（传源码 + pm2 + nginx）在 `DEPLOY.md`，只在**服务器装不了 docker** 时才用。

域名：**mjd-tcd.tearth.cn**

镜像：`ghcr.io/teki-jd/techan-shop:latest`（同时有 amd64 和 arm64，docker 会自动挑）

**线上实际部署参数（下文命令都按这个来，改了要同步）**：

| 项 | 值 |
| --- | --- |
| 部署目录 | `/app/mjd-tcd`（`docker-compose.yml` 和 `.env` 都在这里） |
| 容器名 / 服务名 | `mjd-tcd-shop` |
| 宿主机端口 | `127.0.0.1:3001` → 容器 `3000` |
| 数据目录 | `/app/mjd-tcd/data`、`/app/mjd-tcd/uploads` |

---

## 0. 确认三件事

```bash
docker -v          # 有版本号就行，没有先装 docker
docker compose version
curl -s ifconfig.me   # 确认这台机器的公网 IP
```

- 域名 `mjd-tcd.tearth.cn` 的 A 记录指向这台机器
- 防火墙 / 安全组放开了 **80 和 443**（**3001 不用对外**，镜像只绑 127.0.0.1）
- 域名已备案（微信小程序硬性要求）

装 docker（如果还没有）：

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
```

---

## 1. 建目录

```bash
mkdir -p /app/mjd-tcd && cd /app/mjd-tcd
mkdir -p data uploads
chown -R 1000:1000 data uploads
```

`data/`（商品、订单、店铺设置）和 `uploads/`（图片）会挂在这个目录下，**必须留着**，删了数据就没了。

**这两行 `mkdir` + `chown` 不能省**：容器里的服务是用 `node` 用户（uid 1000）跑的，不是 root。如果这两个目录由 Docker 以 root 自动创建，容器就只能读、不能写，所有保存操作都会报 `EACCES: permission denied, open '/app/data/db.json.tmp'`——而且数据只留在内存里，容器一重启就全丢。

---

## 2. 写配置 `.env`

```bash
cat > /app/mjd-tcd/.env <<'EOF'
PORT=3000
HOST=0.0.0.0

APPID=换成小程序AppID
APPSECRET=换成AppSecret
TOKEN_SECRET=换成随机长字符串

DEV_MODE=0
EOF
chmod 600 /app/mjd-tcd/.env
```

| 变量 | 填什么 |
| --- | --- |
| `APPID` / `APPSECRET` | 小程序后台 → 开发管理 → 开发设置。AppSecret 只在生成时显示一次，丢了要重置 |
| `TOKEN_SECRET` | 随机串：`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`，服务器没 node 就用 `openssl rand -hex 32` |
| `DEV_MODE` | **必须 0**。写成 1 等于任何人可以冒充管理员 |
| `HOST` | **必须 0.0.0.0**。写 127.0.0.1 的话容器只监听自己的回环，宿主机连不上，表现为「容器在跑但 3001 端口拒绝连接」 |

---

## 3. 放编排文件

```bash
cd /app/mjd-tcd
curl -fLO https://raw.githubusercontent.com/teki-jd/techan-shop/main/docker-compose.yml
cat docker-compose.yml      # 看一眼，确认 image 是 ghcr.io/teki-jd/techan-shop:latest
```

拉不到 raw 文件也没关系，自己建一个，内容就是：

```yaml
services:
  mjd-tcd-shop:
    image: ghcr.io/teki-jd/techan-shop:latest
    container_name: mjd-tcd-shop
    restart: unless-stopped
    ports:
      - "127.0.0.1:3001:3000"
    env_file:
      - ./.env
    environment:
      HOST: 0.0.0.0
      PORT: "3000"
    volumes:
      - ./data:/app/data
      - ./uploads:/app/public/uploads
```

---

## 4. 起服务

```bash
docker compose up -d
docker compose ps          # STATUS 应该是 Up (healthy)，healthy 要等 30 秒左右
```

第一次会拉镜像，体积约 60~80MB，国内如果很慢，给 docker 配个镜像加速器再试。

看日志：

```bash
docker compose logs -f --tail 30
```

正常输出长这样：

```
特产小铺后端已启动：http://0.0.0.0:3000
数据文件：/app/data/db.json
```

---

## 5. 本机验证

```bash
curl http://127.0.0.1:3001/api/health
```

返回里应该看到 `"ok":true` 和 `"initialized":false`（还没初始化时是 false，正常）。

再看一眼服务是否按预期拒绝未登录请求：

```bash
curl -X POST http://127.0.0.1:3001/api/login -H 'content-type: application/json' -d '{}'
```

返回 `缺少 code` 是对的——说明它在正常校验微信登录，不是坏的。

打开浏览器访问 `http://127.0.0.1:3001/` 会看到一行「特产小铺后端在跑」。**没有网页后台是故意的**，管理都在小程序里。

---

## 6. 上 https

镜像只跑在 127.0.0.1:3001，对外还是靠宿主机 nginx。先只放 80 端口的反代：

```nginx
# /etc/nginx/conf.d/techan.conf
server {
    listen 80;
    server_name mjd-tcd.tearth.cn;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
nginx -t && systemctl reload nginx
certbot --nginx -d mjd-tcd.tearth.cn --redirect    # 证书自动加进 443 段
curl https://mjd-tcd.tearth.cn/api/health
```

装了宝塔面板的话，跳过这个文件：面板里加站点 → 反向代理到 `http://127.0.0.1:3001` → SSL 申请 Let's Encrypt。

---

## 7. 数据在哪、怎么备份

| 宿主机路径 | 容器内 | 内容 |
| --- | --- | --- |
| `/app/mjd-tcd/data/db.json` | `/app/data/db.json` | 商品、订单、店铺设置 |
| `/app/mjd-tcd/uploads/` | `/app/public/uploads/` | 上传的商品图 |

备份：

```bash
tar czf ~/techan-backup-$(date +%F).tar.gz -C /app/mjd-tcd data uploads
```

容器重建、升级镜像都不影响这两个目录。

---

## 8. 以后怎么更新

我这边改了代码推到 `main`，GitHub 会自动重建镜像（3~6 分钟）。你更新只要：

```bash
cd /app/mjd-tcd
docker compose pull
docker compose up -d
```

数据不动，几秒完成。

---

## 9. 常见问题

| 现象 | 原因 |
| --- | --- |
| `docker compose ps` 一直在 `restarting` | `.env` 里 `TOKEN_SECRET` 之类没填，或 `.env` 格式错（有中文引号、行首有空格）。看 `docker compose logs` |
| 容器 Up 但 `curl 127.0.0.1:3001` 连接被拒 | `HOST` 写成了 `127.0.0.1`，改成 `0.0.0.0` |
| `docker pull` 报 `denied` | 镜像还是私有。让我把它设成公开，或在服务器上 `docker login ghcr.io` |
| 域名打开 502 | nginx 反代没指向 `127.0.0.1:3001`，或容器没起 |
| 首页显示「店铺：未初始化」 | 正常，等店主在小程序里点「初始化店铺数据」 |
| 保存任何东西都报 `EACCES: permission denied, open '/app/data/db.json.tmp'` | 宿主机 `data` 目录属主不对。修：`docker exec -u 0 mjd-tcd-shop chown -R node:node /app/data /app/public/uploads && docker restart mjd-tcd-shop`。注意此时数据只在内存里，重启就没了，修完要重新录入 |
| 改完 `db.json` 没生效 | 服务把数据缓存在内存，光改文件不行，`docker restart mjd-tcd-shop` 才生效 |

---

## 10. 弄完回我这些

```bash
docker compose ps
docker compose logs --tail 30 --no-color
curl -s http://127.0.0.1:3001/api/health
curl -s https://mjd-tcd.tearth.cn/api/health
certbot certificates | grep -A2 tearth
```

四样都对上就是部署完成。有报错把**完整输出**贴回来，别自己猜。

`.env` 里有 AppSecret，别发群里、别截图。
