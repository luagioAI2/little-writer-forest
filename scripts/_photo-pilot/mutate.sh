#!/usr/bin/env bash
# 变异测试：把实现改坏，确认新守卫**真的会红**。
# ⚠️ 脚手架，不是产物。跑完自动还原。
# 跑法：bash scripts/_photo-pilot/mutate.sh
set -u
cd "$(dirname "$0")/../.." || exit 1

TC=src/domain/travelContents.ts
TE=src/domain/travelEvents.ts
PH=src/data/landmark-photos.json

BACKUP=.mutate-backup
mkdir -p "$BACKUP"
cp "$TC" "$BACKUP/$(basename $TC)"
cp "$TE" "$BACKUP/$(basename $TE)"
cp "$PH" "$BACKUP/$(basename $PH)"
restore() { cp "$BACKUP/$(basename $TC)" "$TC"; cp "$BACKUP/$(basename $TE)" "$TE"; cp "$BACKUP/$(basename $PH)" "$PH"; }
trap restore EXIT

run() { # run <名字> <期望红的测试文件>
  local name="$1" file="$2"
  local log="$BACKUP/run.log"
  npx vitest run "$file" > "$log" 2>&1
  local verdict
  # ⚠️⚠️ 别写成 `grep -E 'Tests +[0-9]+ (failed|passed)'` —— vitest 的汇总行**带 ANSI 颜色码**，
  #     实际是 `Tests  \x1b[31m1 failed`，数字前面是转义序列而不是空格 → 那个模式**永远匹配不到**，
  #     于是 6 个变异全部报"没读到汇总行"（看着像守卫坏了，其实是量错了）。
  verdict=$(grep -aE 'Tests .*(failed|passed)' "$log" | tail -1)
  if [ -z "$verdict" ]; then
    echo "   ?? 没读到 vitest 的汇总行 —— 看 $log"
  elif printf '%s' "$verdict" | grep -q failed; then
    echo "   ✔ 守卫变红了 →$verdict"
  else
    echo "   ✗✗ 没红！守卫是摆设 →$verdict"
  fi
}

echo "=============================================================="
echo "变异 1：把优先级倒过来（默认图盖过内容包）"
echo "  期望：travelContents.test.ts 红"
python - "$TC" <<'PY'
import sys
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
old="  return pickContentForLandmark(landmarkId, opts) ?? defaultContentForLandmark(landmarkId)"
new="  return defaultContentForLandmark(landmarkId) ?? pickContentForLandmark(landmarkId, opts)"
assert old in s, "锚点没找到（1）"
open(p,'w',encoding='utf-8').write(s.replace(old,new))
PY
run "变异1" src/domain/travelContents.test.ts
restore

echo "=============================================================="
echo "变异 2：不抄 match（顶替图会被当成真地方）"
echo "  期望：travelContents.test.ts 红"
python - "$TC" <<'PY'
import sys
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
old="    match: photo.match,"
new="    match: undefined,"
assert old in s, "锚点没找到（2）"
open(p,'w',encoding='utf-8').write(s.replace(old,new))
PY
run "变异2" src/domain/travelContents.test.ts
restore

echo "=============================================================="
echo "变异 3：只改一处出口（两处取图走不同的路）"
echo "  期望：travelContents.test.ts 红（源码级守卫）"
python - "$TE" <<'PY'
import sys
p=sys.argv[1]; s=open(p,encoding='utf-8').read()
# 只把**退回拍照**那一处改回旧的
old="""    photo: pickPhotoForLandmark(landmarkId, { exclude, rng }),
    rolled,
    fellBack: true,"""
new="""    photo: pickContentForLandmark(landmarkId, { exclude, rng }),
    rolled,
    fellBack: true,"""
assert old in s, "锚点没找到（3）"
open(p,'w',encoding='utf-8').write(s.replace(old,new))
PY
run "变异3" src/domain/travelContents.test.ts
restore

echo "=============================================================="
echo "变异 4：数据里 landmarkId 打错一个字"
echo "  期望：landmarkPhotos.test.ts 红（DROPPED_PHOTO_COUNT + 找不到）"
python - "$PH" <<'PY'
import sys, json
p=sys.argv[1]
d=json.load(open(p,encoding='utf-8'))
d['items'][0]['landmarkId']='tiananmen-typo'
json.dump(d,open(p,'w',encoding='utf-8'),ensure_ascii=False,indent=2)
PY
run "变异4" src/data/landmarkPhotos.test.ts
restore

echo "=============================================================="
echo "变异 5：match 写成 'Place'（大写，消费端的 === 会全落空）"
echo "  期望：landmarkPhotos.test.ts 红"
python - "$PH" <<'PY'
import sys, json
p=sys.argv[1]
d=json.load(open(p,encoding='utf-8'))
d['items'][0]['match']='Place'
json.dump(d,open(p,'w',encoding='utf-8'),ensure_ascii=False,indent=2)
PY
run "变异5" src/data/landmarkPhotos.test.ts
restore

echo "=============================================================="
echo "变异 6：把 credit.link 的编号改掉（出处与图片对不上）"
echo "  期望：landmarkPhotos.test.ts 红"
python - "$PH" <<'PY'
import sys, json
p=sys.argv[1]
d=json.load(open(p,encoding='utf-8'))
d['items'][0]['credit']['link']='https://www.pexels.com/photo/x-99999999/'
json.dump(d,open(p,'w',encoding='utf-8'),ensure_ascii=False,indent=2)
PY
run "变异6" src/data/landmarkPhotos.test.ts
restore

echo "=============================================================="
echo "还原完成。校验还原是否干净："
git diff --stat "$TC" "$TE" | tail -3
python - "$PH" <<'PY'
import sys, json
d=json.load(open(sys.argv[1],encoding='utf-8'))
print("   landmark-photos.json 条数:", d['count'], "首条:", d['items'][0]['landmarkId'])
PY
