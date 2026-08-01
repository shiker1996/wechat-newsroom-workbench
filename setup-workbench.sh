#!/usr/bin/env bash
# setup-workbench.cmd 的 Linux/macOS 对应版本：进入项目根目录并运行安装引导。
set -e
cd "$(dirname "$0")"
node scripts/setup.mjs "$@"
