#!/usr/bin/env bash
# scripts/runtime/start-workbench.ps1 的 Linux/macOS 对应版本。
# 用法: scripts/runtime/start-workbench.sh [--port 4317] [--no-browser]
set -e
cd "$(dirname "$0")/../.."
PORT=4317
NO_BROWSER=0
while [ $# -gt 0 ]; do
  case "$1" in
    --port|-p) PORT="$2"; shift 2 ;;
    --no-browser) NO_BROWSER=1; shift ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

ADDRESS="http://127.0.0.1:$PORT/"
HEALTH="${ADDRESS}api/overview"

health_ok() { curl -fsS --max-time 2 "$HEALTH" >/dev/null 2>&1; }

# shellcheck source=scripts/runtime/ensure-node.sh
. "$(dirname "$0")/ensure-node.sh"
ensure_node || exit 1
node scripts/runtime/check-env.mjs || { echo "环境检测未通过，请根据上方提示处理（或运行 scripts/runtime/setup.mjs）。" >&2; exit 1; }

if ! health_ok; then
  if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":$PORT "; then
    echo "端口 $PORT 已被其他进程占用，请先停止该进程（旧工作台可运行 scripts/runtime/stop-workbench.sh）。" >&2
    exit 1
  fi
  mkdir -p logs
  nohup node --disable-warning=ExperimentalWarning server.mjs >>logs/workbench.log 2>>logs/workbench.error.log &
  echo "$!" > logs/workbench.pid
  deadline=$((SECONDS + 45))
  while [ $SECONDS -lt $deadline ] && ! health_ok; do sleep 0.5; done
  if ! health_ok; then
    echo "工作台 45 秒内未能启动。最近的错误日志：" >&2
    tail -20 logs/workbench.error.log 2>/dev/null >&2 || true
    exit 1
  fi
fi

if [ "$NO_BROWSER" -eq 0 ]; then
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$ADDRESS" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then open "$ADDRESS" >/dev/null 2>&1 &
  fi
fi
echo "工作台已就绪: $ADDRESS"
