# 交接说明（部署方 / 部署方的 AI 请先读这一页）

## 一、这个项目里有什么、没有什么

这是一个**微信小程序 + 一个只提供接口的 Node 服务**，没有网页版前端。

| 目录 | 内容 |
| --- | --- |
| `miniprogram/` | 小程序全部界面代码（7 个页面） |
| `server/` | 服务器端接口，零依赖，只对外提供 JSON 接口 |
| `.github/workflows/docker.yml` | 推到 `main` 就自动构建 Docker 镜像 |

**没有** `pages/` 之外的网页工程、没有 React/Vue、没有管理后台网页版。域名打开只能看到一个「后端在跑」的提示页，**那是对的**。不要为此加登录页、加管理后台网页版 —— 店主明确不要，加了也白加。

小程序界面代码只认**该小程序的开发者身份**上传，所以它放在仓库里是给你编译和上传用的，不是给服务器跑的前端。

## 二、分工

| 范围 | 谁做 | 具体 |
| --- | --- | --- |
| 服务器 | **你（部署方）** | 拉镜像起容器 + nginx 反代 + https 证书 |
| 小程序发布 | **你（部署方）** | 导入项目、上传代码、真机自测、提交审核、发布 |
| 商品与订单 | 店主 | 全部在小程序里操作，不碰服务器 |
| 代码改动 | 店主那边维护 | 你只负责跑起来和发布，不改逻辑 |

你交付的东西：**一个能访问的 https 域名**、**一份自检输出**、**小程序提审后能发布**。

## 三、你要做的

### 服务器（详细命令在 `DEPLOY-DOCKER.md`）

镜像已经构建好，不用编译、不用 `npm install`：

1. `mkdir -p /app/mjd-tcd && cd /app/mjd-tcd`（线上已按此目录部署，容器名 `mjd-tcd-shop`，宿主机端口 `3001`）
2. 写 `.env`：`APPID` / `APPSECRET` / `TOKEN_SECRET`，`DEV_MODE=0`，`HOST=0.0.0.0`
3. 下载仓库里的 `docker-compose.yml`
4. `docker compose up -d` → `curl http://127.0.0.1:3001/api/health`
5. nginx 反代 `127.0.0.1:3001` + `certbot --nginx -d mjd-tcd.tearth.cn --redirect`
6. 逐条核对第十节的回执清单

服务器装不了 docker 才走 `DEPLOY.md`（传源码 + pm2），那条路多几步，结果一样。

### 小程序（详细命令看 `dist/techan-miniprogram/HANDOVER.md`）

导入 `miniprogram/` → 填 AppID → 配 request 合法域名 `https://mjd-tcd.tearth.cn` → 编译 → 真机预览 → 上传提审。

## 四、不要做的事

| 别做 | 为什么 |
| --- | --- |
| 改 `index.js` / `actions.js` / `lib/*` | 接口契约和前端配套，改了就对不上，前端报错还查不出来 |
| 改 `miniprogram/utils/api.js` 的 action 名 | 同上 |
| 点「初始化店铺数据」 | 谁先点谁是管理员。店主点，你别占位 |
| 把 `DEV_MODE` 设成 `1` | 开着等于任何人能冒充管理员，只在本地测接口时短暂开 |
| 加网页后台 / 登录页 / SPA | 没有网页版，店主明确不要 |
| 动 `data/` 里的文件 | 那是真实数据，`db.json` 手工改会坏 |
| 把 `.env` 发群里或截图 | 里面有 AppSecret |

## 五、自检

容器方式：

```bash
docker compose ps
docker compose logs --tail 30 --no-color
curl -s http://127.0.0.1:3001/api/health
curl -s https://mjd-tcd.tearth.cn/api/health
```

源码方式（走 `DEPLOY.md` 时）：

```bash
sh verify.sh
```

只读脚本：不启停进程、不改文件、不碰 pm2。会检查运行环境、配置文件、本机接口、域名接口，最后给通过/失败统计。**全 ✅ 就是部署成功**；有 ❌ 就把整段输出贴回给店主。

## 六、回给店主的信息（照这个格式）

```
1. docker compose ps 的输出
2. docker compose logs --tail 30 --no-color 的输出
3. curl -s http://127.0.0.1:3001/api/health 的返回
4. curl -s https://mjd-tcd.tearth.cn/api/health 的返回
5. certbot certificates | grep -A2 tearth
```

## 七、接口契约（只读，供你判断「服务是否完整」）

所有业务接口都走同一个入口：

```
POST /api
Header: Authorization: Bearer <token>
Body:   { "action": "<名字>", ...其他参数 }
```

`actions.js` 里必须有这 19 个 action，少一个说明文件不全：

```
bootstrap  me  saveContact  getHome  getProducts  createOrder  myOrders
cancelOrder  adminListOrders  adminUpdateOrder  adminListProducts
adminSaveProduct  adminToggleProduct  adminDeleteProduct
adminSaveCategory  adminDeleteCategory  adminGetSettings  adminSaveSettings  upload
```

## 八、几个「看着像坏了，其实是正常」的现象

| 现象 | 真相 |
| --- | --- |
| 域名打开只有一个提示页，没有登录框 | 正常，没有网页版 |
| `POST /api/login {}` 返回「缺少 code」 | 正常，这是在等微信登录凭证，说明服务活着 |
| `/api/health` 里 `initialized: false` | 正常，店主还没在小程序里点初始化 |
| 首页打开是空白/没商品 | 正常，初始化不带示例商品，店主自己加 |
| `/app.html` 返回 404 | 正常，这个文件故意不进镜像 |

## 九、两件只有店主能做、你替不了的事

1. **ICP 备案**：域名在境内服务器上必须备案，人脸核身是主体本人。
2. **微信认证 / 提审主体确认**：涉及主体身份的操作只能店主账号完成。

没备案就提审，必被拒。所以先把这两件的前置条件跟店主确认掉。

## 十、镜像说明

```
ghcr.io/teki-jd/techan-shop:latest
ghcr.io/teki-jd/techan-shop:main      # 跟随 main 分支
ghcr.io/teki-jd/techan-shop:sha-<7位>  # 具体某次提交，回滚用
```

同时有 `linux/amd64` 和 `linux/arm64`，`docker pull` 自动挑。代码推到 `main` 后 GitHub 自动重建，3~6 分钟出新镜像。
