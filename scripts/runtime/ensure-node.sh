# Node.js 引导（被 setup-workbench.sh / start-workbench.sh source）。
# 系统没有 node>=24 时，自动下载官方运行时到 .node-runtime/ 并临时加入 PATH，
# 不改动系统环境；可用环境变量覆盖：NODE_BOOTSTRAP_VERSION / NODE_BOOTSTRAP_DIST（镜像）。
# 支持 Linux/macOS（tar.gz）与 Windows Git Bash/MSYS（zip，借 PowerShell 解压）。
NODE_BOOTSTRAP_VERSION="${NODE_BOOTSTRAP_VERSION:-24.12.0}"
NODE_BOOTSTRAP_DIST="${NODE_BOOTSTRAP_DIST:-https://nodejs.org/dist}"

_node_bootstrap_major() {
  command -v node >/dev/null 2>&1 || return 1
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null
}

_node_bootstrap_download() { # url dest
  if command -v curl >/dev/null 2>&1; then curl -fSL --retry 2 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then wget -O "$2" "$1"
  else echo "需要 curl 或 wget 才能自动下载 Node.js。" >&2; return 1; fi
}

_node_bootstrap_sha256() { # file
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else echo ""; fi
}

# 把已就位的运行时目录加入 PATH 并返回 0；未就位返回 1。
_node_bootstrap_use() { # runtime_dir
  if [ -x "$1/bin/node" ]; then export PATH="$1/bin:$PATH"; return 0; fi
  if [ -x "$1/node.exe" ]; then export PATH="$1:$PATH"; return 0; fi
  return 1
}

ensure_node() {
  local major
  major="$(_node_bootstrap_major || true)"
  if [ -n "$major" ] && [ "$major" -ge 24 ] 2>/dev/null; then return 0; fi

  local runtime_dir="$PWD/.node-runtime/node-v$NODE_BOOTSTRAP_VERSION"
  if _node_bootstrap_use "$runtime_dir"; then return 0; fi

  local os arch ext
  case "$(uname -s)" in
    Linux) os=linux; ext=tar.gz ;;
    Darwin) os=darwin; ext=tar.gz ;;
    MINGW*|MSYS*|CYGWIN*) os=win; ext=zip ;;
    *) echo "未找到 Node.js 24 或更高版本，且当前系统不支持自动安装，请手动安装: https://nodejs.org/" >&2; return 1 ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) echo "未找到 Node.js 24 或更高版本，且当前 CPU 架构不支持自动安装，请手动安装: https://nodejs.org/" >&2; return 1 ;;
  esac

  local name="node-v${NODE_BOOTSTRAP_VERSION}-${os}-${arch}"
  local base="$NODE_BOOTSTRAP_DIST/v$NODE_BOOTSTRAP_VERSION"
  local tmp=".node-runtime/.download-$name"
  echo "未检测到 Node.js 24+，自动下载 $name 到 .node-runtime/（不改动系统环境）……"
  rm -rf "$tmp"; mkdir -p "$tmp"
  if ! _node_bootstrap_download "$base/$name.$ext" "$tmp/node.$ext" \
    || ! _node_bootstrap_download "$base/SHASUMS256.txt" "$tmp/SHASUMS256.txt"; then
    echo "Node.js 运行时下载失败（可检查网络或设置 NODE_BOOTSTRAP_DIST 镜像后重试）。" >&2
    rm -rf "$tmp"; return 1
  fi
  local expected actual
  expected="$(grep " $name\.$ext\$" "$tmp/SHASUMS256.txt" | cut -d' ' -f1)"
  actual="$(_node_bootstrap_sha256 "$tmp/node.$ext")"
  if [ -n "$expected" ] && [ -n "$actual" ] && [ "$expected" != "$actual" ]; then
    echo "Node.js 运行时校验和不匹配，已中止。" >&2
    rm -rf "$tmp"; return 1
  fi
  if [ "$ext" = zip ]; then
    # Git Bash 通常没有 unzip；借 Windows 自带 PowerShell 解压。
    local win_tmp win_zip
    win_tmp="$(cd "$tmp" && pwd -W 2>/dev/null || pwd)"
    win_zip="$win_tmp\\node.zip"
    if command -v unzip >/dev/null 2>&1; then unzip -q "$tmp/node.zip" -d "$tmp"
    elif command -v powershell.exe >/dev/null 2>&1; then
      powershell.exe -NoProfile -Command "Expand-Archive -Path '$win_zip' -DestinationPath '$win_tmp' -Force" || { echo "Node.js 运行时解压失败。" >&2; rm -rf "$tmp"; return 1; }
    else
      echo "需要 unzip 或 powershell.exe 才能解压 Node.js 运行时。" >&2; rm -rf "$tmp"; return 1
    fi
  else
    tar -xzf "$tmp/node.tar.gz" -C "$tmp" || { echo "Node.js 运行时解压失败。" >&2; rm -rf "$tmp"; return 1; }
  fi
  rm -rf "$runtime_dir"; mv "$tmp/$name" "$runtime_dir"
  rm -rf "$tmp"
  if ! _node_bootstrap_use "$runtime_dir"; then
    echo "Node.js 运行时目录结构异常，自动安装失败。" >&2; return 1
  fi
  echo "Node.js $(node -v) 已就绪（.node-runtime/）。"
}
