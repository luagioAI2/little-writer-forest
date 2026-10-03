# -*- coding: utf-8 -*-
"""量 jpg 的真实宽高比（读 SOF 段，不用装 Pillow）。

用法:  python measure-ar.py <文件1> [文件2 ...]
输出:  每行  路径  宽x高  ar=1.50  [OK|WARN|REJECT]
判据（目标容器是 4/3 + object-cover，竖图会被砍掉一半）：
  ar >= 1.33  OK      基本不裁
  1.15~1.33   WARN    可接受，损失 <=13%
  < 1.15      REJECT  直接丢，别犹豫
"""
import sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')


def sof_size(b):
    i = 2
    while i < len(b) - 9:
        if b[i] != 0xFF:
            i += 1
            continue
        m = b[i + 1]
        if m in (0xC0, 0xC1, 0xC2):
            h = int.from_bytes(b[i + 5:i + 7], 'big')
            w = int.from_bytes(b[i + 7:i + 9], 'big')
            return w, h
        if m in (0xD8, 0xD9) or 0xD0 <= m <= 0xD7:
            i += 2
            continue
        if i + 4 > len(b):
            break
        i += 2 + int.from_bytes(b[i + 2:i + 4], 'big')
    return None


for p in sys.argv[1:]:
    if not os.path.exists(p):
        print('%-60s  (文件不存在)' % p)
        continue
    b = open(p, 'rb').read()
    if len(b) < 1000:
        print('%-60s  只有 %d 字节 —— 不是图（图床占位文字），换编号' % (p, len(b)))
        continue
    wh = sof_size(b)
    if not wh:
        print('%-60s  读不出 SOF（可能不是 jpg），字节=%d' % (p, len(b)))
        continue
    w, h = wh
    ar = w / h
    tag = 'OK' if ar >= 1.33 else ('WARN' if ar >= 1.15 else 'REJECT')
    print('%-60s  %dx%d  ar=%.2f  [%s]' % (p, w, h, ar, tag))
