#!/usr/bin/env bash
# 冷启动验收：从 git 跟踪文件重建全新目录，按公开文档执行安装、构建、测试、首次启动与停止
set -uo pipefail
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$REPO_ROOT"
TMP=$(mktemp -d /tmp/coldstart-XXXXXX)
echo "== 临时目录: $TMP"
git ls-files -z --cached --others --exclude-standard | while IFS= read -r -d '' f; do
  mkdir -p "$TMP/$(dirname "$f")"
  cp "$f" "$TMP/$f"
done
cd "$TMP"
echo "== npm ci"
npm ci --no-audit --no-fund 2>&1 | tail -3 || { echo '!! npm ci FAILED'; exit 1; }
echo "== npm run build"
npm run build 2>&1 | tail -5 || { echo '!! build FAILED'; exit 1; }
echo "== npm test"
npm test 2>&1 | tail -8 || { echo '!! test FAILED'; exit 1; }
echo "== 首次启动（无密钥，端口 4399）"
WORKBENCH_PORT=4399 nohup node --disable-warning=ExperimentalWarning server.mjs > server.log 2>&1 &
SERVER_PID=$!
for i in $(seq 1 30); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4399/api/overview --max-time 2 || true)
  [ "$CODE" = "200" ] && break
  sleep 1
done
echo "== /api/overview -> $CODE"
echo "== /api/models（无密钥降级视图）"
curl -s http://127.0.0.1:4399/api/models --max-time 3 | head -c 300; echo
echo "== /api/system/health（无外部服务）"
curl -s 'http://127.0.0.1:4399/api/system/health' --max-time 15 | head -c 300; echo
echo "== stop-workbench.ps1 -Port 4399"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/runtime/stop-workbench.ps1 -Port 4399 2>&1 | tr -d '\r'
sleep 1
CODE2=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4399/api/overview --max-time 2 || true)
echo "== 停止后 /api/overview -> ${CODE2:-000}（预期非 200）"
kill $SERVER_PID 2>/dev/null || true
echo "== server.log 尾部"
tail -5 server.log
echo "== 验收完成，清理 $TMP"
cd /
rm -rf "$TMP"
echo "== DONE"
