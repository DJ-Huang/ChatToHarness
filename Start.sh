#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$ROOT/dist/mac-arm64/ChatToHarness.app"
STAMP="$ROOT/.cache/build-stamp"
NODE_VERSION="24.22.0"
NODE_SHA="6a9724d9b50a5f22b4816cded441b5a8d9ddae546191a5e5b7efa5a5e2ee26d5"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "ChatToHarness 目前支持 Apple 芯片 Mac。"
  exit 1
fi
if [[ "$(sw_vers -productVersion | cut -d. -f1)" -lt 14 ]]; then
  echo "ChatToHarness 需要 macOS 14 或更新版本。"
  exit 1
fi

build_current() {
  [[ -x "$APP/Contents/MacOS/ChatToHarness" && -f "$STAMP" ]] || return 1
  [[ -z "$(find "$ROOT/app" "$ROOT/scripts" "$ROOT/vendor" "$ROOT/assets" "$ROOT/native" \
    "$ROOT/package.json" "$ROOT/package-lock.json" "$ROOT/electron-builder.config.cjs" "$ROOT/Start.sh" "$ROOT/Start.command" \
    "$ROOT/README.md" "$ROOT/ARCHITECTURE.md" "$ROOT/LICENSE" "$ROOT/THIRD_PARTY_NOTICES.md" \
    -type f -newer "$STAMP" -print -quit)" ]]
}

if build_current; then
  open "$APP"
  exit 0
fi

mkdir -p "$ROOT/.cache"
LOCK="$ROOT/.cache/start.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  _owner="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [[ "$_owner" =~ ^[0-9]+$ ]] && kill -0 "$_owner" 2>/dev/null; then
    echo "另一个 ChatToHarness 启动窗口正在准备组件，请等待该窗口完成。"
    exit 0
  fi
  if [[ ! "$_owner" =~ ^[0-9]+$ ]]; then
    echo "ChatToHarness 的组件准备锁尚未就绪，请等待几秒后重新启动。"
    echo "若所有启动窗口均已关闭仍出现此提示，请仅删除工程中的 .cache/start.lock 文件夹后重试。"
    exit 1
  fi
  rm -rf "$LOCK"
  mkdir "$LOCK"
fi
echo "$$" > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

# The exact archive checksum is also recorded in scripts/versions.cjs.
NODE_ROOT="$ROOT/resources/node"
NODE="$NODE_ROOT/bin/node"
if [[ ! -x "$NODE" ]] || [[ "$("$NODE" --version)" != "v$NODE_VERSION" ]]; then
  echo "首次启动：正在准备经过校验的 Node.js 运行组件…"
  mkdir -p "$ROOT/.cache/downloads" "$ROOT/resources"
  ARCHIVE="$ROOT/.cache/downloads/node-v$NODE_VERSION-darwin-arm64.tar.gz"
  verify_node() { [[ -f "$ARCHIVE" ]] && [[ "$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')" == "$NODE_SHA" ]]; }
  if ! verify_node; then
    rm -f "$ARCHIVE"
    curl --ipv4 --fail --location --retry 3 --connect-timeout 20 \
      "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-darwin-arm64.tar.gz" \
      --output "$ARCHIVE.part"
    mv "$ARCHIVE.part" "$ARCHIVE"
  fi
  if ! verify_node; then
    rm -f "$ARCHIVE"
    echo "Node.js 下载校验失败，请重新启动重试。"
    exit 1
  fi
  rm -rf "$NODE_ROOT.prepare"
  mkdir -p "$NODE_ROOT.prepare"
  tar -xzf "$ARCHIVE" -C "$NODE_ROOT.prepare" --strip-components=1
  rm -rf "$NODE_ROOT"
  mv "$NODE_ROOT.prepare" "$NODE_ROOT"
fi

export PATH="$NODE_ROOT/bin:$PATH"
cd "$ROOT"
echo "正在准备 ChatToHarness 界面与工具组件，首次启动需要联网…"
if [[ ! -f node_modules/.localharness-lock ]] || ! cmp -s package-lock.json node_modules/.localharness-lock; then
  npm ci --no-audit --no-fund
  cp package-lock.json node_modules/.localharness-lock
fi
"$NODE" scripts/build.cjs
open "$APP"
