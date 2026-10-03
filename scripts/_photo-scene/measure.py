"""量一批 jpg 的宽高比（读 JPEG 的 SOF 段，不需要解码库）。

用法：
    python scripts/_photo-scene/measure.py <目录> [--min 1.15]

为什么非要量：目标容器的外链图是 `aspect-ratio: 4/3` + `object-cover`，
竖图会被上下各裁掉一大截。ar < 1.15 的直接丢，别用。
"""
import io
import os
import sys

# 带 SOF 的标记段（都含真实宽高）
SOF = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}


def dims(path):
    b = io.open(path, 'rb').read()
    if len(b) < 4 or b[0] != 0xFF or b[1] != 0xD8:
        return 0, 0
    i = 2
    n = len(b)
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
    return 0, 0


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        print(__doc__)
        return 1
    d = args[0]
    min_ar = 1.15
    if '--min' in sys.argv:
        min_ar = float(sys.argv[sys.argv.index('--min') + 1])

    rows = []
    for name in sorted(os.listdir(d)):
        if not name.lower().endswith(('.jpg', '.jpeg')):
            continue
        p = os.path.join(d, name)
        size = os.path.getsize(p)
        w, h = dims(p)
        ar = (w / h) if h else 0.0
        rows.append((ar, name, size, w, h))

    rows.sort(reverse=True)
    print(f'{"宽高比":>6}  {"尺寸":>11}  {"字节":>8}  判定  文件')
    ok = bad = 0
    for ar, name, size, w, h in rows:
        if w == 0:
            verdict = '❌不是JPEG'
        elif ar >= 1.33:
            verdict = '✅安全'
            ok += 1
        elif ar >= min_ar:
            verdict = '🟡可接受'
            ok += 1
        else:
            verdict = '❌竖图丢掉'
            bad += 1
        print(f'{ar:6.2f}  {w:>5}x{h:<5}  {size:>8}  {verdict}  {name}')

    print(f'\n共 {len(rows)} 张：可用 {ok}，要丢 {bad}')
    if rows:
        print(f'最大 ar {rows[0][0]:.2f}（{rows[0][1]}）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
