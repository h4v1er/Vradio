#!/usr/bin/env bash
# Vradio 一条命令启动:网易云 API + 本地服务(:8080)+ PWA 前端(:5173)
set -euo pipefail
cd "$(dirname "$0")/.."

# 网易云 API:优先 Docker 容器;无容器运行时回退到本地 checkout(node app.js)
start_netease() {
  if docker info >/dev/null 2>&1; then
    if docker ps --format '{{.Names}}' | grep -qx 'netease'; then
      echo "[dev] NeteaseCloudMusicApi 容器已在运行"
    else
      echo "[dev] 启动 NeteaseCloudMusicApi 容器(端口 3000)..."
      docker rm -f netease >/dev/null 2>&1 || true
      docker run -d --name netease -p 3000:3000 binaryify/netease_cloud_music_api >/dev/null
    fi
    return
  fi

  local dir="${NETEASE_NATIVE_DIR:-$HOME/ideaprojects/beginner/NeteaseCloudMusicApi}"
  if [ ! -f "$dir/app.js" ]; then
    echo "[dev] 未找到 Docker 运行时与本地网易云 checkout,请二选一:" >&2
    echo "      1) 安装容器运行时(如 colima)后重试" >&2
    echo "      2) 设置 NETEASE_NATIVE_DIR 指向 NeteaseCloudMusicApi 仓库目录" >&2
    exit 1
  fi
  if lsof -i :3000 >/dev/null 2>&1; then
    echo "[dev] 网易云 API 已在 :3000 运行"
  else
    echo "[dev] 启动本地 NeteaseCloudMusicApi(node, $dir)..."
    (cd "$dir" && node app.js >/dev/null 2>&1 &)
  fi
}

start_netease

# 后端 + 前端并行,退出时一并结束
trap 'kill 0' EXIT
(cd server && npm run dev) &
(cd frontend && npm run dev) &
wait
