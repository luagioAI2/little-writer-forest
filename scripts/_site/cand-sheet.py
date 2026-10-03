# -*- coding: utf-8 -*-
"""下载候选图 + 拼「一行一个题位、四列候选」的审查表（人眼过表才定图）。"""
import os, io, json, time, urllib.request
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(BASE, 'img-cand')
os.makedirs(DIR, exist_ok=True)
FONT = 'C:/Windows/Fonts/msyh.ttc'

import sys
PLAN_FILE = sys.argv[1] if len(sys.argv) > 1 else 'cand-plan.json'
PREFIX = sys.argv[2] if len(sys.argv) > 2 else '_cand-sheet'
PLAN = json.load(io.open(os.path.join(BASE, PLAN_FILE), encoding='utf-8'))

# ★ 少数老照片 CDN 文件名带 slug（不是 pexels-photo-<id>.jpeg），标准路径 404 —— 逐条查覆盖表
_ov_path = os.path.join(BASE, 'photo-url-overrides.json')
OVERRIDES = json.load(io.open(_ov_path, encoding='utf-8')) if os.path.exists(_ov_path) else {}


def url(pid):
    base = OVERRIDES.get(str(pid))
    if base is None:
        base = f'https://images.pexels.com/photos/{pid}/pexels-photo-{pid}.jpeg'
    return f'{base}?auto=compress&cs=tinysrgb&w=640'

def fetch(pid):
    p = os.path.join(DIR, f'{pid}.jpg')
    if os.path.exists(p) and os.path.getsize(p) > 3000:
        return p, 'cached'
    try:
        req = urllib.request.Request(url(pid), headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
        open(p, 'wb').write(data)
        Image.open(p).verify()
        return p, 'ok'
    except Exception as e:
        return None, str(e)[:80]

need = []
for slot in PLAN:
    for pid in slot['ids']:
        need.append(pid)
print('需要', len(set(need)), '张唯一候选')

fail = []
for pid in sorted(set(need)):
    p, st = fetch(pid)
    if not p:
        fail.append((pid, st))
        print('  ✗', pid, st)
    time.sleep(0.25)
print('下载完成，失败', len(fail))

def crop43(im):
    w, h = im.size
    t = 4 / 3
    if w / h > t:
        nw = int(h * t)
        return im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    nh = int(w / t)
    return im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))

CW, CH, LAB, COLS = 340, 255, 48, 4
f_t = ImageFont.truetype(FONT, 19)
f_s = ImageFont.truetype(FONT, 15)

def sheet(chunk, out, start):
    r = len(chunk)
    cv = Image.new('RGB', (COLS * CW, r * (CH + LAB)), (246, 246, 246))
    dr = ImageDraw.Draw(cv)
    for i, slot in enumerate(chunk):
        cy = i * (CH + LAB)
        for j, pid in enumerate(slot['ids']):
            cx = j * CW
            p = os.path.join(DIR, f'{pid}.jpg')
            if os.path.exists(p):
                im = crop43(Image.open(p).convert('RGB')).resize((CW - 6, CH - 6))
                cv.paste(im, (cx + 3, cy + 3))
            else:
                dr.rectangle([cx + 3, cy + 3, cx + CW - 3, cy + CH - 3], outline=(210, 60, 60), width=3)
                dr.text((cx + 16, cy + CH // 2), 'FAIL', font=f_t, fill=(190, 0, 0))
            dr.rectangle([cx + 3, cy + CH, cx + CW - 3, cy + CH + LAB - 3], fill=(255, 255, 255))
            dr.text((cx + 7, cy + CH + 3), f'[{chr(97+j)}] {pid}', font=f_s, fill=(40, 40, 40))
        dr.text((7, cy + CH + 26), f"#{start+i} {slot['slot']}", font=f_t, fill=(150, 60, 20))
    cv.save(out)
    print('saved', out, cv.size)

for k in range(0, len(PLAN), 8):
    sheet(PLAN[k:k + 8], os.path.join(BASE, f'{PREFIX}-{k//8+1}.png'), k + 1)
