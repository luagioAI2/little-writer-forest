# -*- coding: utf-8 -*-
"""应用文 8 道的定稿审查表：4 列 × 2 行，按 App 的真实 4:3 居中裁法。
用法: python scripts/_site/applied-final-sheet.py"""
import os, io, json
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(BASE, 'img-cand')
OUT = os.path.join(BASE, '_applied-final-sheet.png')
FONT = 'C:/Windows/Fonts/msyh.ttc'

ass = json.load(io.open(os.path.join(BASE, 'photo-applied.json'), encoding='utf-8'))['applied-writing']
rows = list(ass.items())

COLS, CW, CH, LAB = 4, 400, 300, 62
f_t = ImageFont.truetype(FONT, 21)
f_s = ImageFont.truetype(FONT, 15)


def crop43(im):
    w, h = im.size
    target = 4 / 3
    if w / h > target:
        nw = int(h * target)
        return im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    nh = int(w / target)
    return im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))


r = (len(rows) + COLS - 1) // COLS
cv = Image.new('RGB', (COLS * CW, r * (CH + LAB) + 8), (245, 245, 245))
dr = ImageDraw.Draw(cv)
for i, (title, pid) in enumerate(rows):
    cx, cy = (i % COLS) * CW, (i // COLS) * (CH + LAB) + 4
    p = os.path.join(IMG, f'{pid}.jpg')
    if os.path.exists(p):
        im = crop43(Image.open(p).convert('RGB')).resize((CW - 8, CH - 8))
        cv.paste(im, (cx + 4, cy + 4))
    else:
        dr.rectangle([cx + 4, cy + 4, cx + CW - 4, cy + CH - 4], outline=(220, 60, 60), width=3)
        dr.text((cx + 20, cy + CH // 2), 'MISSING', font=f_t, fill=(200, 0, 0))
    dr.rectangle([cx + 4, cy + CH, cx + CW - 4, cy + CH + LAB - 4], fill=(255, 255, 255))
    dr.text((cx + 8, cy + CH + 5), title, font=f_t, fill=(20, 20, 20))
    dr.text((cx + 8, cy + CH + 34), f'applied-writing  ·  {pid}', font=f_s, fill=(120, 120, 120))
cv.save(OUT)
print('saved', OUT, cv.size, len(rows), 'rows')
