#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
if ! "$ROOT/Start.sh"; then
  echo
  echo "ChatToHarness 启动失败。请保留上面的提示，修正后重新双击 Start.command。"
  read -r -p "按回车关闭窗口…" _answer || true
  exit 1
fi
