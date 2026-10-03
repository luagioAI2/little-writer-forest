# 临时：给「背影」挑替换图 —— 下载候选缩略图并拼成联系表
import io, json, os, urllib.request, sys
from PIL import Image, ImageDraw

IDS = [
    ("17527998", "father+son dirt road"),
    ("5240511", "backview father hand child toy bear"),
    ("3932687", "backview father child on shoulders"),
    ("5036347", "father+child rural road sunset"),
    ("34146079", "father+son beach sunset"),
    ("5240514", "above backview father boy toy bear"),
    ("5240510", "backview man holding child urban"),
    ("5094346", "backview mother+daughter strolling"),
    ("12940810", "father+child sunlit garden"),
    ("22690459", "father+daughter forest path"),
    ("11892530", "father+daughter dog dirt road"),
    ("19860917", "father+child sunlit forest trail"),
    ("9706131", "child+parents balloon sidewalk"),
    ("7856945", "mother+son cobblestone path"),
    ("13821255", "child holding parent hand"),
    ("9342154", "mother+child fall path"),
]

CACHE = "scripts/_site/img-back"
os.makedirs(CACHE, exist_ok=True)
url = "https://images.pexels.com/photos/%s/pexels-photo-%s.jpeg?auto=compress&cs=tinysrgb&w=640"
proxy = urllib.request.ProxyHandler({"http": "http://127.0.0.1:7897", "https": "http://127.0.0.1:7897"})
opener = urllib.request.build_opener(proxy)

ok = []
for pid, label in IDS:
    p = os.path.join(CACHE, pid + ".jpg")
    if not os.path.exists(p):
        try:
            req = urllib.request.Request(url % (pid, pid), headers={"User-Agent": "Mozilla/5.0"})
            data = opener.open(req, timeout=30).read()
            Image.open(io.BytesIO(data)).verify()
            open(p, "wb").write(data)
        except Exception as e:
            print("FAIL", pid, e)
            continue
    ok.append((pid, label))

CW, CH = 400, 300
COLS = 4
rows = (len(ok) + COLS - 1) // COLS
sheet = Image.new("RGB", (CW * COLS, (CH + 26) * rows), "white")
dr = ImageDraw.Draw(sheet)
for i, (pid, label) in enumerate(ok):
    im = Image.open(os.path.join(CACHE, pid + ".jpg")).convert("RGB")
    # 4:3 居中裁剪，跟 App 里 SceneArt 的 object-cover 一致
    w, h = im.size
    tw, th = w, w * 3 // 4
    if th > h:
        th = h
        tw = h * 4 // 3
    im = im.crop(((w - tw) // 2, (h - th) // 2, (w + tw) // 2, (h + th) // 2)).resize((CW, CH))
    x, y = (i % COLS) * CW, (i // COLS) * (CH + 26)
    sheet.paste(im, (x, y))
    dr.text((x + 6, y + CH + 5), "%d) %s  %s" % (i + 1, pid, label), fill="black")
out = "scripts/_site/_back-sheet.png"
sheet.save(out)
print("saved", out, "candidates", len(ok))
