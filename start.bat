@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

cd /d "%~dp0server"

echo ========================================
echo   BetterLanTalk 内网聊天室 一键启动
echo ========================================
echo.

REM ---- 检查 Node.js ----
where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装：https://nodejs.org/
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node -v') do set NODEVER=%%v
echo [信息] Node.js 版本: %NODEVER%

REM ---- 首次运行自动安装依赖 ----
if not exist "node_modules" (
    echo [信息] 首次运行，正在安装依赖，请稍候...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo [错误] 依赖安装失败，请检查网络后重试
        echo.
        pause
        exit /b 1
    )
    echo [信息] 依赖安装完成
) else (
    echo [信息] 依赖已存在，跳过安装
)

echo.
echo [信息] 正在启动服务器... 按 Ctrl+C 可停止
echo.

REM ---- 自动打开浏览器：服务器启动后用本机内网 IP 打开（设置 LANTALK_NO_BROWSER=1 可跳过） ----
if not "%LANTALK_NO_BROWSER%"=="1" (
    set "LANTALK_OPEN_BROWSER=1"
)

REM ---- 启动服务器 ----
node server.js

echo.
echo [信息] 服务器已停止
pause
endlocal
