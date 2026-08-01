#!/usr/bin/env bash
# stop-workbench.cmd 的 Linux/macOS 对应版本。
set -e
cd "$(dirname "$0")"
exec scripts/stop-workbench.sh "$@"
