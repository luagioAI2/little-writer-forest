# -*- coding: utf-8 -*-
"""从 App 真图标派生官网要用的图：favicon / apple-touch / PWA 尺寸 / OG 分享图。
OG 图用真 App 截图拼，不用 AI 生成图 —— 产品页放真界面比放插画更可信。"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'website', 'assets')
os.makedirs(OUT, exist_ok=True)

SRC_ICON = os.path.join(ROOT, 'assets', 'icon', 'icon-square.png')
src = Image.open(SRC_ICON).convert('RGBA')
print('源图标:', src.size)

# ---------- 1. 图标各尺寸 ----------
# 圆角方形（App 图标本身是 squircle，缩到小尺寸时再套一层圆角更干净）
for size, name in [(512, 'icon-512.png'), (192, 'icon-192.png'), (180, 'apple-touch-icon.png'), (32, 'favicon-32.png')]:
    im = src.resize((size, size), Image.LANCZOS)
    if size <= 192:
        # 小尺寸加一点锐化，否则糊
        im = im.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
    im.save(os.path.join(OUT, name), optimize=True)
    print('  ->', name, im.size)

# ---------- 2. OG 分享图 1200×630 ----------
W, H = 1200, 630
FONT_DIR = 'C:/Windows/Fonts'
def font(name, size):
    for f in (name, 'msyh.ttc', 'msyhbd.ttc'):
        p = os.path.join(FONT_DIR, f)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

F_BOLD = font('msyhbd.ttc', 76)
F_SUB = font('msyhbd.ttc', 40)
F_TAG = font('msyh.ttc', 27)
F_PILL = font('msyh.ttc', 24)

# 背景：深林绿渐变（跟 App 的 inkleaf-950/700 同族）
bg = Image.new('RGB', (W, H))
d = ImageDraw.Draw(bg)
top = (5, 39, 26)      # #05271a
bot = (10, 93, 60)     # #0a5d3c
for y in range(H):
    t = y / (H - 1)
    d.line([(0, y), (W, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))

# 右上角一片柔光，避免死板
glow = Image.new('L', (W, H), 0)
gd = ImageDraw.Draw(glow)
gd.ellipse([W - 520, -320, W + 260, 420], fill=70)
glow = glow.filter(ImageFilter.GaussianBlur(110))
bg = Image.composite(Image.new('RGB', (W, H), (41, 206, 137)), bg, glow)

# 真 App 截图（右侧，圆角 + 描边）
shot = Image.open(os.path.join(OUT, 'shot-home.png')).convert('RGB')
sh = 566
sw = int(shot.width * sh / shot.height)
shot = shot.resize((sw, sh), Image.LANCZOS)
px, py = W - sw - 78, (H - sh) // 2

shadow = Image.new('L', (W, H), 0)
ImageDraw.Draw(shadow).rounded_rectangle([px - 10, py + 12, px + sw + 10, py + sh + 18], radius=34, fill=120)
shadow = shadow.filter(ImageFilter.GaussianBlur(22))
bg = Image.composite(Image.new('RGB', (W, H), (2, 18, 12)), bg, shadow)

mask = Image.new('L', (sw, sh), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, sw, sh], radius=30, fill=255)
bg.paste(shot, (px, py), mask)

# 图标
ic = src.resize((104, 104), Image.LANCZOS)
imask = Image.new('L', (104, 104), 0)
ImageDraw.Draw(imask).rounded_rectangle([0, 0, 103, 103], radius=24, fill=255)
bg.paste(ic, (80, 92), imask)

# ⚠️ 必须在**所有** bg 重新赋值之后才建 ImageDraw —— 之前建早了，
#    文字全画在了一个已经被替换掉的旧对象上（图上只剩图标和截图、一个字都没有）。
d = ImageDraw.Draw(bg)

d.rounded_rectangle([px, py, px + sw - 1, py + sh - 1], radius=30, outline=(168, 238, 202), width=3)
d.text((80, 236), '小笔苗 · 作文森林', font=F_BOLD, fill=(255, 255, 255))
d.text((80, 340), '让孩子笑着把作文写出来', font=F_SUB, fill=(168, 238, 202))
d.text((80, 408), '看图作文 · 语音录入 · AI 点评 · 段位成长', font=F_TAG, fill=(207, 213, 208))

# 底部一行小药丸
x = 80
for txt in ['免费使用', '无广告', '不上传孩子数据']:
    tw = d.textlength(txt, font=F_PILL)
    d.rounded_rectangle([x, 480, x + tw + 40, 526], radius=23, fill=(7, 54, 35), outline=(12, 124, 79), width=2)
    d.text((x + 20, 492), txt, font=F_PILL, fill=(214, 248, 229))
    x += tw + 56

bg.save(os.path.join(OUT, 'og-cover.png'), optimize=True)
print('  -> og-cover.png', bg.size, os.path.getsize(os.path.join(OUT, 'og-cover.png')) // 1024, 'KB')
