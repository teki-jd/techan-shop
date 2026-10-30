#!/bin/sh
# 特产小铺 · 后端自检（只读）
#
# 不改任何文件、不启停进程、不动 pm2。只用 node/curl/grep/awk/sed。
#
# 用法：
#   sh verify.sh                       # 查本机 3000 端口 + https://mjd-tcd.tearth.cn
#   sh verify.sh https://别的域名      # 查本机 3000 端口 + 指定域名
#
# 输出全是 ✅ 就是部署完成了。有 ❌ 就把整段输出贴回给店主。

cd "$(dirname "$0")" || exit 1

PASS=0
FAIL=0
WARN=0

ok()   { printf '  ✅ %s\n' "$1"; PASS=$((PASS + 1)); }
ng()   { printf '  ❌ %s\n' "$1"; [ -n "$2" ] && printf '     → %s\n' "$2"; FAIL=$((FAIL + 1)); }
warn() { printf '  ⚠️  %s\n' "$1"; [ -n "$2" ] && printf '     → %s\n' "$2"; WARN=$((WARN + 1)); }
skip() { printf '  － %s\n' "$1"; }

# 发请求，结果放进 $CODE（HTTP 状态码）和 $BODY（响应体）
resp() {
  RAW=$(curl -s --noproxy '*' --max-time 10 -w '\n@@C@@%{http_code}' "$@" 2>/dev/null)
  CODE=${RAW##*@@C@@}
  BODY=${RAW%@@C@@*}
}

has() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac }

envval() {
  [ -f .env ] || return 0
  awk -F= -v k="$1" '$1==k {sub(/^[^=]*=/,""); gsub(/^["\047]|["\047]$/,""); print; exit}' .env
}

# 本机端口跟着 .env 里的 PORT 走（默认 3000）
PORT_CFG=$(envval PORT)
LOCAL="http://127.0.0.1:${PORT_CFG:-3000}"
TARGET=${1:-https://mjd-tcd.tearth.cn}

printf '\n特产小铺后端自检\n本机：%s\n域名：%s\n' "$LOCAL" "$TARGET"
printf '时间：%s\n' "$(date '+%Y-%m-%d %H:%M:%S')"

# ---------------------------------------------------------------- 1. 运行环境
printf '\n[1/5] 运行环境\n'

if command -v node >/dev/null 2>&1; then
  NV=$(node -v 2>/dev/null)
  MAJ=$(printf '%s' "$NV" | sed 's/^v//' | cut -d. -f1)
  if [ "$MAJ" -ge 16 ] 2>/dev/null; then
    ok "Node ${NV}（要求 ≥16）"
  else
    ng "Node $NV 版本过低" "需要 16 以上，建议 18 或 20"
  fi
else
  ng "找不到 node 命令" "先装 Node，再确认它在 PATH 里"
fi

if command -v curl >/dev/null 2>&1; then
  ok "curl 可用"
else
  ng "找不到 curl" "装一下：apt install curl / yum install curl"
fi

MISS=""
for f in index.js actions.js package.json .env.example DEPLOY.md HANDOFF.md lib/auth.js lib/store.js lib/wx.js; do
  [ -f "$f" ] || MISS="$MISS $f"
done
if [ -z "$MISS" ]; then
  ok "必需文件齐全（9 个）"
else
  ng "缺文件:$MISS" "包没传全，重新解压一次"
fi

MISS=""
for a in bootstrap me saveContact getHome getProducts createOrder myOrders cancelOrder \
         adminListOrders adminUpdateOrder adminListProducts adminSaveProduct adminToggleProduct \
         adminDeleteProduct adminSaveCategory adminDeleteCategory adminGetSettings \
         adminSaveSettings upload; do
  grep -q "^  $a:" actions.js 2>/dev/null || MISS="$MISS $a"
done
if [ -z "$MISS" ]; then
  ok "接口完整（19 个 action 都在）"
else
  ng "接口不全，缺:$MISS" "actions.js 没传全或版本不对"
fi

# ---------------------------------------------------------------- 2. 配置
printf '\n[2/5] 配置（.env）\n'

if [ -f .env ]; then
  ok ".env 存在"

  APPID=$(envval APPID)
  if has "$APPID" "填写" || [ -z "$APPID" ]; then
    ng "APPID 没填" "小程序后台 → 开发管理 → 开发设置"
  elif has "$APPID" "000000000000"; then
    ng "APPID 还是模板里的占位值" "填真实 AppID，wx 开头那串"
  else
    ok "APPID 已填（$(printf '%s' "$APPID" | cut -c1-6)…）"
  fi

  SECRET=$(envval APPSECRET)
  if has "$SECRET" "填写" || has "$SECRET" "不要外泄" || [ -z "$SECRET" ]; then
    ng "APPSECRET 没填" "只有生成时显示一次，丢了要去后台重置"
  else
    ok "APPSECRET 已填（长度 ${#SECRET}）"
  fi

  TS=$(envval TOKEN_SECRET)
  if has "$TS" "换成" || [ -z "$TS" ]; then
    ng "TOKEN_SECRET 没换" "生成一句：node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  elif [ ${#TS} -lt 16 ]; then
    ng "TOKEN_SECRET 太短（${#TS} 位）" "至少 32 位随机字符"
  else
    ok "TOKEN_SECRET 已设（${#TS} 位）"
  fi

  DEV=$(envval DEV_MODE)
  if [ "$DEV" = "1" ]; then
    ng "DEV_MODE=1，线上不能开" "改成 0 或删掉这一行，再 pm2 restart techan-shop"
  else
    ok "DEV_MODE 已关闭（${DEV:-未设置}）"
  fi

  PERM=$(ls -l .env 2>/dev/null | cut -c5-10)
  case "$PERM" in
    *r*|*w*|*x*) warn ".env 其他用户可读（权限 ${PERM}）" "建议：chmod 600 .env" ;;
    *) ok ".env 权限正常（600）" ;;
  esac
else
  ng ".env 不存在" "先 cp .env.example .env 再填三项"
fi

if [ -d data ] || [ -d public/uploads ]; then
  if [ -w . ]; then ok "工作目录可写（data/ 和 public/uploads/ 靠它创建）"
  else warn "工作目录不可写" "用 root 或 chown 给运行用户写权限"; fi
else
  ok "工作目录可写（首次启动会自动建 data/）"
fi

# ---------------------------------------------------------------- 3. 本机服务
printf '\n[3/5] 本机服务 %s\n' "$LOCAL"

resp "$LOCAL/api/health"
if [ "$CODE" = "200" ] && has "$BODY" '"ok":true'; then
  ok "健康检查 200"
  if has "$BODY" '"dev":false'; then
    ok "服务确认是正式模式（dev=false）"
  else
    ng "服务在开发模式跑（dev=true）" "DEV_MODE 改 0 后 pm2 restart techan-shop"
  fi
  if has "$BODY" '"initialized":true'; then
    ok "店铺已初始化"
  else
    warn "店铺还没初始化（initialized=false）" "正常，等店主在小程序里点「初始化店铺数据」"
  fi
else
  ng "本机 $LOCAL/api/health 不通" "服务没起？pm2 start ecosystem.config.js，再 pm2 logs 看报错"
fi

resp "$LOCAL/"
if [ "$CODE" = "200" ] && has "$BODY" '后端在跑'; then
  ok "首页提示页正常"
else
  ng "首页返回异常（HTTP ${CODE:-000}）" "服务在跑但静态页没出，检查 public 目录权限"
fi

resp "$LOCAL/app.html"
if [ "$CODE" = "404" ]; then
  ok "/app.html 返回 404（正常，没有网页版）"
else
  warn "/app.html 返回 HTTP ${CODE:-000}" "包里不该有 app.html，确认没多传文件"
fi

resp -X POST "$LOCAL/api/login" -H 'content-type: application/json' -d '{}'
if [ "$CODE" = "400" ] && has "$BODY" '缺少 code'; then
  ok "登录接口在正常校验微信凭证（返回「缺少 code」）"
else
  ng "登录接口返回异常（HTTP ${CODE:-000}）" "响应：$(printf '%s' "$BODY" | cut -c1-120)"
fi

resp -X POST "$LOCAL/api" -H 'content-type: application/json' -d '{"action":"getHome"}'
if [ "$CODE" = "401" ]; then
  ok "业务接口要求登录（未带 token 返回 401）"
else
  ng "业务接口鉴权异常（HTTP ${CODE:-000}）" "没带 token 应该 401"
fi

# ---------------------------------------------------------------- 4. 域名
printf '\n[4/5] 域名 %s\n' "$TARGET"

if [ "$TARGET" = "$LOCAL" ]; then
  skip "跳过（和本机地址相同）"
else
  resp "$TARGET/api/health"
  if [ "$CODE" = "200" ] && has "$BODY" '"ok":true'; then
    ok "https 全链路通（域名 → 证书 → 反代 → 服务）"
  else
    ng "域名访问失败（HTTP ${CODE:-000}）" "依次查：DNS 解析、80/443 放行、nginx -t、证书、反代端口"
    warn "如果证书报错，先看 certbot certificates 有没有这张证书"
  fi

  resp "$TARGET/"
  if [ "$CODE" = "200" ] && has "$BODY" '后端在跑'; then
    ok "域名首页正常"
  elif [ "$CODE" = "200" ]; then
    warn "域名首页能开但内容不对（HTTP 200）" "可能反代到了别的站点"
  else
    ng "域名首页异常（HTTP ${CODE:-000}）"
  fi
fi

# ---------------------------------------------------------------- 5. 结论
printf '\n[5/5] 结论\n'
printf '  通过 %d 项，失败 %d 项，提醒 %d 项\n' "$PASS" "$FAIL" "$WARN"

if [ "$FAIL" -gt 0 ]; then
  printf '\n  还有失败项，别急着交付。把上面整段输出贴回给店主。\n\n'
  exit 1
fi

printf '\n  部署完成。把上面整段输出贴回给店主，然后等他在小程序里点初始化。\n\n'
exit 0
