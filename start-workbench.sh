#!/usr/bin/env bash
# start-workbench.cmd 的 Linux/macOS 对应版本。
set -e
cd "$(dirname "$0")"
exec scripts/runtime/start-workbench.sh "$@"
