#!/usr/bin/env bash
# 逐条 curl 校验 src/data/landmark-photos.json 里的每一个图片地址，
# 并把**校验过的图**留在 verify/ 里（联系表要用"真的下过一遍"的那批，不用代理时代的）。
# 跑法：bash scripts/_photo-all/verify-urls.sh
#
# ⚠️ 判据是**落盘后的真实字节数**（wc -c），不是 curl 的 size_download ——
#    这台机器上 size_download 恒报 ~161 字节，会把全部成功误判成失败。
# ⚠️ -L 必须带：不带的话图床只回一个 160 字节的空壳。
set -u

cd "$(dirname "$0")/../.." || exit 1
OUT=scripts/_photo-all/url-report.tsv
VERIFY=scripts/_photo-all/verify
TMP=scripts/_photo-all/.urltmp

mkdir -p "$VERIFY" "$TMP"
: > "$OUT"

node -e "
const j=require('./src/data/landmark-photos.json');
for (const it of j.items) {
  const n=(it.mediaUrl.match(/photos\/(\d+)\//)||[])[1]||'?';
  const ext=(it.mediaUrl.match(/\.(jpeg|png)\?/)||[])[1]||'jpeg';
  console.log(n+'\t'+ext+'\t'+it.landmarkId+'\t'+it.mediaUrl);
}
" > "$TMP/list.txt"

total=$(wc -l < "$TMP/list.txt")
echo "要校验 $total 条"

i=0
bad=0
while IFS=$'\t' read -r num ext id url; do
  i=$((i + 1))
  f="$VERIFY/$num.$ext"
  code=$(curl -sL -o "$f" -w '%{http_code}|%{content_type}' "$url")
  bytes=$(wc -c < "$f")
  printf '%s\t%s\t%s\t%s\t%s\n' "$num" "$id" "$code" "$bytes" "$url" >> "$OUT"
  if [ "${code%%|*}" != "200" ] || [ "$bytes" -lt 10000 ]; then
    bad=$((bad + 1))
    echo "  ✗ [$i/$total] $id  $code  ${bytes}B"
  fi
  sleep 0.5
done < "$TMP/list.txt"

rm -rf "$TMP"

echo "----"
echo "校验 $i 条，不合格 $bad 条"
echo "报告：$OUT"
if [ "$bad" -eq 0 ]; then
  echo "✓ 全部 200 且 >10000 字节"
else
  exit 1
fi
