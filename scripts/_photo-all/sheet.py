# 把 366 张默认图拼成联系表（contact sheet），供人眼一次看完。
# ⚠️ 脚手架，不是产物。
# 跑法：C:/Users/admin/.workbuddy-ai/binaries/python/envs/default/Scripts/python.exe scripts/_photo-all/sheet.py
#
# ★ 用 verify/ 里那份 —— 那是**照着最终地址重新下过、并且校验过字节数**的，
#   而不是子代理当时下的（那批可能已经被我换掉过）。
import json
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIR = os.path.join(ROOT, "scripts", "_photo-all")
VERIFY = os.path.join(DIR, "verify")

photos = json.load(open(os.path.join(ROOT, "src", "data", "landmark-photos.json"), encoding="utf-8"))["items"]

# 名字：第一轮 85 条在 _pilot-list.json，第二轮 558 条在 _photo-list.json
names = {}
for f in ("_pilot-list.json", "_photo-list.json"):
    p = os.path.join(ROOT, "scripts", f)
    if os.path.exists(p):
        for x in json.load(open(p, encoding="utf-8")):
            names[x["id"]] = x.get("name") or x["id"]

rows_data = []
for it in photos:
    m = it["mediaUrl"].split("/photos/")[1].split("/")[0]
    ext = "png" if it["mediaUrl"].split("?")[0].endswith(".png") else "jpeg"
    path = os.path.join(VERIFY, f"{m}.{ext}")
    rows_data.append(
        {
            "id": it["landmarkId"],
            "name": names.get(it["landmarkId"], it["landmarkId"]),
            "match": it["match"],
            "file": path,
        }
    )

# 世界地标排前面（它们是主力、也更值得先看）
rows_data.sort(key=lambda r: (0 if r["id"].startswith("world-") else 1, r["id"]))

COLS, ROWS = 6, 6
CW, CH = 260, 215
PAD = 6
LABEL_H = 40

try:
    f_name = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 14)
    f_sub = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 12)
except Exception:
    f_name = f_sub = ImageFont.load_default()

per_sheet = COLS * ROWS
chunks = [rows_data[i : i + per_sheet] for i in range(0, len(rows_data), per_sheet)]
missing = 0

for si, chunk in enumerate(chunks, 1):
    nrows = (len(chunk) + COLS - 1) // COLS
    W = COLS * (CW + PAD) + PAD
    H = nrows * (CH + PAD) + PAD
    sheet = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(sheet)

    for k, it in enumerate(chunk):
        c, r = k % COLS, k // COLS
        x = PAD + c * (CW + PAD)
        y = PAD + r * (CH + PAD)
        try:
            im = Image.open(it["file"]).convert("RGB")
            im.thumbnail((CW, CH - LABEL_H))
            sheet.paste(im, (x + (CW - im.width) // 2, y))
        except Exception as e:
            missing += 1
            d.rectangle([x, y, x + CW, y + CH - LABEL_H], outline=(255, 0, 0))
            d.text((x + 4, y + 4), f"ERR {type(e).__name__}", fill=(255, 0, 0), font=f_sub)

        idx = rows_data.index(it) + 1
        tag = "" if it["match"] == "place" else f"  [{it['match']}]"
        d.text((x, y + CH - LABEL_H + 2), f"{idx}. {it['name'][:22]}{tag}", fill=(0, 0, 0), font=f_name)
        d.text((x, y + CH - LABEL_H + 20), it["id"][:40], fill=(120, 120, 120), font=f_sub)

    out = os.path.join(DIR, f"sheet-{si:02d}.png")
    sheet.save(out)
    print("wrote", os.path.basename(out), sheet.size, f"({len(chunk)} 张)")

print(f"\n共 {len(chunks)} 张联系表，{len(rows_data)} 条，缺图 {missing} 条")
