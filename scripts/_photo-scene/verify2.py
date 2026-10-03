# -*- coding: utf-8 -*-
"""主代理**独立复核**：把子代理交的每一张图重新下回来，自己量字节 / 宽高比，
并核对 pexelsId 跟 mediaUrl、credit.link 里的是不是同一个编号。
用法：python scripts/_photo-scene/verify2.py
"""
import glob
import io
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
D = os.path.join(ROOT, 'scripts', '_photo-scene')
OUT = os.path.join(D, 'verify2')
SOF = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}


def dims(b):
    n = len(b)
    i = 2
    while i < n - 9:
        if b[i] != 0xFF:
            i += 1
            continue
        m = b[i + 1]
        if m in SOF:
            h = int.from_bytes(b[i + 5:i + 7], 'big')
            w = int.from_bytes(b[i + 7:i + 9], 'big')
            return w, h
        if m in (0xD8, 0xD9) or 0xD0 <= m <= 0xD7 or m == 0x01:
            i += 2
            continue
        i += 2 + int.from_bytes(b[i + 2:i + 4], 'big')
    return None, None


os.makedirs(OUT, exist_ok=True)
items = []
for f in sorted(glob.glob(os.path.join(D, 'out2-*.json'))):
    for it in json.load(io.open(f, encoding='utf-8'))['items']:
        items.append(it)

print('子代理共交了 %d 条' % len(items))
print()
print('%-22s %-9s %7s %8s %5s  %s' % ('key', 'pexelsId', '字节', '尺寸', 'ar', '判定'))
print('-' * 78)

bad = []
for it in items:
    k = it['key']
    pid = it['pexelsId']
    url = it['mediaUrl']
    link = (it.get('credit') or {}).get('link', '')
    probs = []
    # ① 编号自洽
    if '/photos/%d/' % pid not in url:
        probs.append('mediaUrl 里的编号不是 %d' % pid)
    if str(pid) not in link:
        probs.append('credit.link 里没有编号 %d' % pid)
    # ② 自己下回来
    p = os.path.join(OUT, '%s.jpg' % k)
    subprocess.run(['curl', '-sL', '-o', p, url], check=False)
    if not os.path.exists(p):
        probs.append('下载失败')
        bad.append((k, probs))
        print('%-22s %-9s %7s %8s %5s  ❌ %s' % (k, pid, '-', '-', '-', '；'.join(probs)))
        continue
    b = io.open(p, 'rb').read()
    w, h = dims(b)
    ar = round(w / h, 2) if w and h else 0
    if len(b) < 10000:
        probs.append('只有 %d 字节（<10000，可能是死链）' % len(b))
    if ar and ar < 1.15:
        probs.append('ar=%.2f 偏窄' % ar)
    if ar and ar < 1.33:
        probs.append('ar=%.2f 需人工看裁切' % ar)
    verdict = '✅' if not probs else '⚠️ ' + '；'.join(probs)
    if probs:
        bad.append((k, probs))
    print('%-22s %-9s %7d %4dx%-4d %5s  %s'
          % (k, pid, len(b), w or 0, h or 0, ar, verdict))

print()
print('结论：%d 条里 %d 条完全干净，%d 条要看一眼' % (len(items), len(items) - len(bad), len(bad)))
for k, p in bad:
    print('   ⚠️ %s：%s' % (k, '；'.join(p)))
