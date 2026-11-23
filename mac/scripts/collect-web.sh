#!/bin/sh
# TIP Mac 앱의 웹 자산 모으기 — 저장소 루트의 정적 파일을 mac/dist-web 로 복사한다.
# 웹(PWA)과 Mac 앱이 같은 index.html·js·css·vendor·modules 를 그대로 쓴다.
# mac/dist-web 은 .gitignore 대상이고, `tauri build` 전에 자동으로 실행된다.

set -eu

here=$(cd "$(dirname "$0")/.." && pwd)   # mac/
root=$(cd "$here/.." && pwd)             # 저장소 루트
out="$here/dist-web"

rm -rf "$out"
mkdir -p "$out"

for file in index.html radial.html notch.html search.html manifest.json; do
  cp "$root/$file" "$out/$file"
done

for dir in css js modules vendor icons; do
  cp -R "$root/$dir" "$out/$dir"
done

count=$(find "$out" -type f | wc -l | tr -d ' ')
echo "dist-web: ${count} files copied from ${root}"
