#!/bin/bash
# 双击启动本地服务器（开发测试用）
# 作用：起后端 → 自动打开网页版
# 关掉：在这个终端窗口按 Ctrl+C

cd "$(dirname "$0")/server" || {
  echo "找不到 server 目录，确认这个文件放在 techan-shop 文件夹里"
  read -n 1 -s -r -p "按任意键关闭"
  exit 1
}

# ---- 找一个可用的 node ----
NODE=""
if command -v node >/dev/null 2>&1; then
  NODE="$(command -v node)"
else
  for p in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.nvm/versions/node"/*/bin/node; do
    if [ -x "$p" ]; then NODE="$p"; break; fi
  done
fi
if [ -z "$NODE" ]; then
  echo "❌ 没找到 Node.js。装一个再来：https://nodejs.org （选 LTS 版，一路下一步）"
  read -n 1 -s -r -p "按任意键关闭"
  exit 1
fi

# ---- 端口被占用就先提示 ----
if lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "⚠️  3000 端口已经有程序在跑了："
  lsof -nP -iTCP:3000 -sTCP:LISTEN | tail -n +2
  echo
  echo "如果就是上次开着的服务器，直接开浏览器就行：http://127.0.0.1:3000/app.html"
  echo "想重开：先关掉那个窗口（或 kill 上面显示的 PID），再双击本文件。"
  open "http://127.0.0.1:3000/app.html" 2>/dev/null
  read -n 1 -s -r -p "按任意键关闭"
  exit 0
fi

echo "Node: $NODE ($("$NODE" -v))"
echo "启动中… 起来后会自动打开浏览器"
echo "──────────────────────────────────────────────"

# 等服务起来再开浏览器（2 秒后试一次，起不来就算了，不挡启动）
( sleep 2; open "http://127.0.0.1:3000/app.html" 2>/dev/null ) &

DEV_MODE=1 "$NODE" index.js

echo
echo "服务器已停止。这个窗口可以直接关掉。"
read -n 1 -s -r -p "按任意键关闭"
