#!/usr/bin/env bash
# 从 icons/icon.svg 生成 PWA / iOS 所需 PNG 图标。
# 依次尝试：rsvg-convert → ImageMagick → macOS qlmanage + sips。
set -euo pipefail
cd "$(dirname "$0")/../icons"

SRC=icon.svg
SIZES=(512 192 180)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

render_master() {
  if command -v rsvg-convert >/dev/null 2>&1; then
    rsvg-convert -w 1024 -h 1024 "$SRC" -o "$TMP/master.png" && return 0
  fi
  if command -v magick >/dev/null 2>&1; then
    magick -background none -density 384 "$SRC" -resize 1024x1024 "$TMP/master.png" && return 0
  fi
  if command -v qlmanage >/dev/null 2>&1; then
    qlmanage -t -s 1024 -o "$TMP" "$SRC" >/dev/null 2>&1 && mv "$TMP/$SRC.png" "$TMP/master.png" && return 0
  fi
  return 1
}

if ! render_master; then
  echo "无法渲染 SVG：请安装 librsvg（brew install librsvg）或 ImageMagick" >&2
  exit 1
fi

# 经 JPEG 中转去掉 alpha 通道：iOS 会把透明区域填成黑色
sips -s format jpeg -s formatOptions best "$TMP/master.png" --out "$TMP/master.jpg" >/dev/null
for s in "${SIZES[@]}"; do
  sips -s format png -z "$s" "$s" "$TMP/master.jpg" --out "icon-$s.png" >/dev/null
done
# iOS 主屏幕图标（不透明、全出血，系统会自动加圆角）
cp icon-180.png apple-touch-icon.png
echo "已生成：$(ls icon-*.png apple-touch-icon.png | tr '\n' ' ')"
