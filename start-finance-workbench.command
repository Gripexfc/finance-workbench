#!/bin/zsh
set -u
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-4180}"
URL="http://127.0.0.1:${PORT}/"

if command -v lsof >/dev/null 2>&1; then
  while lsof -iTCP:"$PORT" -sTCP:LISTEN -n >/dev/null 2>&1; do PORT=$((PORT + 1)); URL="http://127.0.0.1:${PORT}/"; done
fi

cd "$APP_DIR"
if command -v node >/dev/null 2>&1; then
  PORT="$PORT" node local-server.mjs >/tmp/finance-workbench-offline.log 2>&1 &
  SERVER_PID=$!
elif command -v python3 >/dev/null 2>&1; then
  python3 -m http.server "$PORT" --bind 127.0.0.1 >/tmp/finance-workbench-offline.log 2>&1 &
  SERVER_PID=$!
else
  echo "未找到可用的本地运行时。请安装 Python 3 或 Node.js 后重新双击启动器。"
  read -r "?按回车键关闭窗口："
  exit 1
fi

trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM
sleep 1
open "$URL"
echo "财务工作台已启动：$URL"
echo "关闭此窗口会停止本地服务。"
wait "$SERVER_PID"
