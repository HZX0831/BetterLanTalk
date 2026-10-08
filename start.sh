#!/bin/bash
# BetterLanTalk 内网聊天室 一键启动脚本 (Linux / macOS)

cd "$(dirname "$0")/server" || exit 1

echo "================================"
echo "  BetterLanTalk 内网聊天室 一键启动"
echo "================================"
echo

if ! command -v node >/dev/null 2>&1; then
    echo "[错误] 未检测到 Node.js，请先安装：https://nodejs.org/"
    exit 1
fi
echo "[信息] Node.js 版本: $(node -v)"

if [ ! -d node_modules ]; then
    echo "[信息] 首次运行，正在安装依赖..."
    npm install --no-audit --no-fund || { echo "[错误] 依赖安装失败"; exit 1; }
else
    echo "[信息] 依赖已存在，跳过安装"
fi

echo
echo "[信息] 正在启动服务器... 按 Ctrl+C 可停止"
echo

# 自动打开浏览器：服务器启动后用本机内网 IP 打开（设置 LANTALK_NO_BROWSER=1 可跳过）
if [ "$LANTALK_NO_BROWSER" != "1" ]; then
    export LANTALK_OPEN_BROWSER=1
fi

node server.js
