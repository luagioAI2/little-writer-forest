#!/usr/bin/env bash
# 独立复验 85 张图：真的下到盘上，再量字节。
#
# ⚠️⚠️ 两个坑，都是"看着像失败、其实是量错了"：
#   ① `-o /dev/null -w %{size_download}` 在 Windows Git Bash 上**永远报 ~160 字节**，
#      哪怕真文件 56762 字节 —— 那正是 Pexels "假 id" 的失败签名。➜ 判据用落盘后的 `wc -c`。
#   ② `file --mime-type` 这台机器上**没装**（返回空）→ 拿它判类型 = 全部假红。
#      ➜ 类型读 curl 自己的 `%{content_type}`。
set -u
cd "$(dirname "$0")/../.." || exit 1
OUT=scripts/_photo-pilot/verify
mkdir -p "$OUT"

ok=0; bad=0; n=0
while IFS=$'\t' read -r url id; do
  [ -z "$url" ] && continue
  n=$((n+1))
  f="$OUT/$(printf '%02d' "$n").jpg"
  try=0
  while :; do
    try=$((try+1))
    meta=$(curl -sL --max-time 30 -o "$f" -w "%{http_code} %{content_type}" "$url")
    code=${meta%% *}
    ct=${meta##* }
    sz=$(wc -c < "$f" | tr -d ' ')
    case "$ct" in image/*) isimg=1;; *) isimg=0;; esac
    if [ "$code" = "200" ] && [ "$isimg" = "1" ] && [ "$sz" -gt 10000 ]; then
      ok=$((ok+1)); break
    fi
    if [ "$try" -ge 2 ]; then
      bad=$((bad+1)); echo "FAIL  $id  http=$code type=$ct bytes=$sz"
      break
    fi
    sleep 2
  done
  sleep 0.5
done < scripts/_photo-pilot/urls.txt

echo "=== 独立复验：OK=$ok  FAIL=$bad  合计=$n ==="
