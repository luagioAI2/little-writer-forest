# -*- coding: utf-8 -*-
"""把 42 道新增题的照片分配拼成联系表，供人眼审查。
★ 按 App 的真实显示方式裁：SceneArt 是 aspect-ratio 4/3 + object-cover + 居中
  → 这里就按 4:3 居中裁剪，看到的就是孩子看到的那一版。"""
import os, json, io, sys
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(BASE, sys.argv[1] if len(sys.argv) > 1 else 'img-exam')
PREFIX = sys.argv[2] if len(sys.argv) > 2 else '_exam-sheet'
FONT = 'C:/Windows/Fonts/msyh.ttc'

COLS, CW, CH, LAB = 4, 400, 300, 52
ass = json.load(io.open(os.path.join(BASE, 'photo-assignments.json'), encoding='utf-8'))

rows = []
for tag, items in ass.items():
    if tag.startswith('_'):
        continue
    for title, pid in items.items():
        rows.append((tag, title, pid))

f_big = ImageFont.truetype(FONT, 20)
f_sm = ImageFont.truetype(FONT, 16)

def crop43(im):
    w, h = im.size
    target = 4 / 3
    if w / h > target:          # 太宽 → 裁两边
        nw = int(h * target)
        return im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    nh = int(w / target)        # 太高 → 裁上下
    return im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))

def sheet(chunk, out, idx0):
    n = len(chunk)
    r = (n + COLS - 1) // COLS
    canvas = Image.new('RGB', (COLS * CW, r * (CH + LAB)), (245, 245, 245))
    dr = ImageDraw.Draw(canvas)
    for i, (tag, title, pid) in enumerate(chunk):
        cx, cy = (i % COLS) * CW, (i // COLS) * (CH + LAB)
        p = os.path.join(IMG, f'{pid}.jpg')
        if os.path.exists(p):
            im = crop43(Image.open(p).convert('RGB')).resize((CW - 8, CH - 8))
            canvas.paste(im, (cx + 4, cy + 4))
        else:
            dr.rectangle([cx + 4, cy + 4, cx + CW - 4, cy + CH - 4], outline=(220, 60, 60), width=3)
            dr.text((cx + 20, cy + CH // 2), 'MISSING', font=f_big, fill=(200, 0, 0))
        dr.rectangle([cx + 4, cy + CH, cx + CW - 4, cy + CH + LAB - 4], fill=(255, 255, 255))
        dr.text((cx + 8, cy + CH + 4), f'#{idx0+i} {title}', font=f_big, fill=(20, 20, 20))
        dr.text((cx + 8, cy + CH + 28), f'{tag}  ·  {pid}', font=f_sm, fill=(120, 120, 120))
    canvas.save(out)
    print('saved', out, canvas.size)

sheet(rows[:16],  os.path.join(BASE, f'{PREFIX}-1.png'), 1)
sheet(rows[16:32], os.path.join(BASE, f'{PREFIX}-2.png'), 17)
sheet(rows[32:],  os.path.join(BASE, f'{PREFIX}-3.png'), 33)
print('total rows:', len(rows))
