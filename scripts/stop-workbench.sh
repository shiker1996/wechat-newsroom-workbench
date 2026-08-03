#!/usr/bin/env bash
# scripts/stop-workbench.ps1 的 Linux/macOS 对应版本。
# 用法: scripts/stop-workbench.sh [--port 4317]
set -e
cd "$(dirname "$0")/.."
PORT=4317
while [ $# -gt 0 ]; do
  case "$1" in
    --port|-p) PORT="$2"; shift 2 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

stopped=0
# 优先用启动脚本记录的 pid 文件
if [ -f logs/workbench.pid ]; then
  PID=$(cat logs/workbench.pid)
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" && echo "已停止工作台服务 (PID $PID)。" && stopped=1
  fi
  rm -f logs/workbench.pid
fi

# 兜底：查找监听该端口的 node 进程
if [ "$stopped" -eq 0 ]; then
  PIDS=""
  if command -v lsof >/dev/null 2>&1; then
    PIDS=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
  elif command -v ss >/dev/null 2>&1; then
    PIDS=$(ss -ltnp 2>/dev/null | grep ":$PORT " | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)
  fi
  if [ -z "$PIDS" ]; then
    echo "端口 $PORT 上没有监听的进程，工作台未在运行。"
    exit 0
  fi
  for PID in $PIDS; do
    if [ "$(ps -p "$PID" -o comm= 2>/dev/null)" != "node" ]; then
      echo "端口 $PORT 被 PID $PID（非 node 进程）占用，跳过。"
      continue
    fi
    kill "$PID" && echo "已停止工作台服务 (PID $PID)。"
  done
fi
