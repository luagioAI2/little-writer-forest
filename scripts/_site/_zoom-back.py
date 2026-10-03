# 临时：放大 top 候选，按 App 卡片实际比例（4:3 居中裁剪）看主体是否清楚
import os
from PIL import Image, ImageDraw

IDS = [("5240511", "2"), ("5036347", "4"), ("5240510", "7"),
       ("22690459", "10"), ("11892530", "11"), ("19860917", "12")]
CACHE = "scripts/_site/img-back"
CW, CH = 400, 300
sheet = Image.new("RGB", (CW * 3, (CH + 24) * 2), "white")
dr = ImageDraw.Draw(sheet)
for i, (pid, n) in enumerate(IDS):
    im = Image.open(os.path.join(CACHE, pid + ".jpg")).convert("RGB")
    w, h = im.size
    tw, th = w, w * 3 // 4
    if th > h:
        th, tw = h, h * 4 // 3
    im = im.crop(((w - tw) // 2, (h - th) // 2, (w + tw) // 2, (h + th) // 2)).resize((CW, CH))
    x, y = (i % 3) * CW, (i // 3) * (CH + 24)
    sheet.paste(im, (x, y))
    dr.text((x + 6, y + CH + 4), "#%s  %s (4:3 crop)" % (n, pid), fill="black")
sheet.save("scripts/_site/_back-zoom.png")
print("saved")
