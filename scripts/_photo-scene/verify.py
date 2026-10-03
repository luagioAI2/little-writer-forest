"""主代理独立复验：不信子代理自述 —— 自己重新下载每个中选地址、量宽高比、查编号一致性。

用法：python scripts/_photo-scene/verify.py
输出：scripts/_photo-scene/img-verify/<key>.jpg + 一张表
"""
import glob
import io
import json
import os
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
D = os.path.join(ROOT, 'scripts/_photo-scene')
OUT = os.path.join(D, 'img-verify')
os.makedirs(OUT, exist_ok=True)

SOF = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}


def dims(b):
    if len(b) < 4 or b[0] != 0xFF or b[1] != 0xD8:
        return 0, 0
    i, n = 2, len(b)
    while i < n - 9:
        if b[i] != 0xFF:
            i += 1
            continue
        m = b[i + 1]
        if m in SOF:
            return int.from_bytes(b[i + 7:i + 9], 'big'), int.from_bytes(b[i + 5:i + 7], 'big')
        if m in (0xD8, 0xD9) or 0xD0 <= m <= 0xD7 or m == 0x01:
            i += 2
            continue
        i += 2 + int.from_bytes(b[i + 2:i + 4], 'big')
    return 0, 0


items = {}
for f in sorted(glob.glob(os.path.join(D, 'out-*.json'))):
    for it in json.load(io.open(f, encoding='utf-8'))['items']:
        items[it['key']] = it

# 应该覆盖的 key
expected = set()
for f in sorted(glob.glob(os.path.join(D, 'batch-*.json'))):
    for b in json.load(io.open(f, encoding='utf-8')):
        expected.add(b['key'])

print(f'期望 {len(expected)} 个 key，收到 {len(items)} 条')
missing = sorted(expected - set(items))
extra = sorted(set(items) - expected)
if missing:
    print('❌ 缺 key:', missing)
if extra:
    print('❌ 多出 key:', extra)

hdr = f'{"key":<22}{"ar":>6}{"尺寸":>11}{"字节":>9}  判定'
print()
print(hdr)
print('-' * len(hdr))

bad = []
for k in sorted(items):
    it = items[k]
    url = it['mediaUrl']
    dest = os.path.join(OUT, f'{k}.jpg')
    body = b''
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=25) as r:
                body = r.read()
            break
        except Exception as e:  # noqa: BLE001
            if attempt == 1:
                print(f'{k:<22}  下载失败: {e}')
            time.sleep(2)

    if not body:
        bad.append((k, '下载失败'))
        continue
    io.open(dest, 'wb').write(body)
    w, h = dims(body)
    ar = (w / h) if h else 0.0
    ok_size = len(body) > 10000
    ok_ar = ar >= 1.15
    # 编号一致性：credit.link 里必须含 pexelsId
    pid = str(it.get('pexelsId', ''))
    ok_credit = bool(pid) and pid in it.get('credit', {}).get('link', '')
    ok_url = f'/photos/{pid}/' in url

    flags = []
    if not ok_size:
        flags.append('字节太小')
    if not ok_ar:
        flags.append('竖图')
    if not ok_credit:
        flags.append('署名编号对不上')
    if not ok_url:
        flags.append('URL编号对不上')
    if flags:
        bad.append((k, ','.join(flags)))

    mark = '❌' + ','.join(flags) if flags else '✅'
    print(f'{k:<22}{ar:6.2f}{f"{w}x{h}":>11}{len(body):>9}  {mark}')
    time.sleep(0.25)

print()
print(f'复验 {len(items)} 条，问题 {len(bad)} 条')
for k, why in bad:
    print('  ❌', k, why)
sys.exit(1 if bad else 0)
