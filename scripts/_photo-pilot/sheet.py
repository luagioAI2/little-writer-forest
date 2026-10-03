# 一次性脚本：把 85 张图拼成几张联系表（contact sheet），供人眼一次看完。
# ⚠️ 脚手架，不是产物。
# 跑法：<venv python> scripts/_photo-pilot/sheet.py
import json
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIR = os.path.join(ROOT, "scripts", "_photo-pilot")
IMG = os.path.join(DIR, "img")

items = json.load(open(os.path.join(DIR, "all.json"), encoding="utf-8"))
# ⚠️ 子代理的产出里**只有 landmarkId**（没有中文名）→ 跟 pilot 名单 join 一下拿名字
pilot = {p["id"]: p for p in json.load(open(os.path.join(ROOT, "scripts", "_pilot-list.json"), encoding="utf-8"))}
for it in items:
    it["name"] = pilot.get(it["landmarkId"], {}).get("name", it["landmarkId"])

# 每批按顺序对应 img/<batch>-NN.jpg
per_batch = {}
for it in items:
    b = it["batch"]
    n = per_batch.get(b, 0) + 1
    per_batch[b] = n
    it["_file"] = os.path.join(IMG, f"{b}-{n:02d}.jpg")
# ★ 用 verify/ 里那份（按最终 URL 重下过，两张替换图是对的）；img/ 是子代理当时下的，已过时
VERIFY = os.path.join(DIR, "verify")

COLS = 5
ROWS = 5
CW, CH = 320, 250   # 单元格
PAD = 8
LABEL_H = 46

FONT = "C:/Windows/Fonts/msyh.ttc"
try:
    f_name = ImageFont.truetype(FONT, 15)
    f_sub = ImageFont.truetype(FONT, 13)
except Exception:
    f_name = f_sub = ImageFont.load_default()

per_sheet = COLS * ROWS
sheets = [items[i:i + per_sheet] for i in range(0, len(items), per_sheet)]

for si, chunk in enumerate(sheets, 1):
    rows = (len(chunk) + COLS - 1) // COLS
    W = COLS * (CW + PAD) + PAD
    H = rows * (CH + PAD) + PAD
    sheet = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(sheet)

    for k, it in enumerate(chunk):
        c, r = k % COLS, k // COLS
        x = PAD + c * (CW + PAD)
        y = PAD + r * (CH + PAD)
        idx0 = items.index(it) + 1
        vf = os.path.join(VERIFY, f"{idx0:02d}.jpg")
        use = vf if os.path.exists(vf) else it["_file"]
        try:
            im = Image.open(use).convert("RGB")
            im.thumbnail((CW, CH - LABEL_H))
            ox = x + (CW - im.width) // 2
            sheet.paste(im, (ox, y))
        except Exception as e:
            d.rectangle([x, y, x + CW, y + CH - LABEL_H], outline=(255, 0, 0))
            d.text((x + 4, y + 4), f"ERR {e}", fill=(255, 0, 0), font=f_sub)
        idx = items.index(it) + 1
        label = f"{idx:02d}. {it['name']}  [{it['match']}]"
        d.text((x, y + CH - LABEL_H + 4), label, fill=(0, 0, 0), font=f_name)
        d.text((x, y + CH - LABEL_H + 24), it["landmarkId"], fill=(110, 110, 110), font=f_sub)

    out = os.path.join(DIR, f"sheet-{si}.png")
    sheet.save(out)
    print("wrote", out, sheet.size, f"({len(chunk)} 张)")
