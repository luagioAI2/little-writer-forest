# -*- coding: utf-8 -*-
"""补搜的候选也按同一标准验一遍（http / 类型 / 字节 / ar），产出 fix-verify.json。"""
import io
import json
import os
import struct
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor

DIR = 'scripts/_new50'
IMG = f'{DIR}/imgfix'
os.makedirs(IMG, exist_ok=True)

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
OPENER.addheaders = [('User-Agent', 'Mozilla/5.0')]


def jpeg_size(path):
    with io.open(path, 'rb') as f:
        data = f.read()
    if data[:2] != b'\xff\xd8':
        return None
    i = 2
    while i < len(data) - 9:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        seg_len = struct.unpack('>H', data[i + 2:i + 4])[0]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            h, w = struct.unpack('>HH', data[i + 5:i + 9])
            return w, h
        i += 2 + seg_len
    return None


def grab(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 3000:
        return {'http': 200, 'ctype': 'image/jpeg', 'bytes': os.path.getsize(dest), 'err': '', 'cached': True}
    try:
        with OPENER.open(url, timeout=60) as r:
            body, ctype, code = r.read(), r.headers.get('Content-Type', ''), r.status
    except urllib.error.HTTPError as e:
        return {'http': e.code, 'ctype': '', 'bytes': 0, 'err': str(e)}
    except Exception as e:  # noqa: BLE001
        return {'http': 0, 'ctype': '', 'bytes': 0, 'err': str(e)}
    with io.open(dest, 'wb') as f:
        f.write(body)
    return {'http': code, 'ctype': ctype, 'bytes': len(body), 'err': ''}


with io.open(f'{DIR}/out-fix.json', encoding='utf-8') as f:
    fixes = json.load(f)

out = []
jobs = []
for fx in fixes:
    for k, c in enumerate(fx.get('cands') or []):
        dest = f'{IMG}/{fx["n"]:02d}-{k+1}.jpg'
        jobs.append((fx['n'], k + 1, c, dest))

with ThreadPoolExecutor(max_workers=10) as ex:
    futs = [(n, k, c, dest, ex.submit(grab, c['url'], dest)) for n, k, c, dest in jobs]
    for n, k, c, dest, fut in futs:
        info = fut.result()
        size = jpeg_size(dest) if info['bytes'] else None
        info.update({
            'n': n, 'k': k, 'id': c['id'], 'url': c['url'], 'page': c.get('page', ''),
            'why': c.get('why', ''),
            'w': size[0] if size else None, 'h': size[1] if size else None,
            'ar': round(size[0] / size[1], 3) if size else None,
        })
        info['ok'] = (
            info['http'] == 200 and info['ctype'].startswith('image/')
            and size is not None and size[0] / size[1] >= 1.33 and info['bytes'] > 3000
        )
        out.append(info)

with io.open(f'{DIR}/fix-verify.json', 'w', encoding='utf-8', newline='\n') as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

bad = [o for o in out if not o['ok']]
print(f'补搜候选 {len(out)} 张，不合格 {len(bad)}：')
for o in bad:
    print('  ', o['n'], o['id'], f"http={o['http']} bytes={o['bytes']} ar={o['ar']}", o['err'])
print('id 唯一:', len({o['id'] for o in out}) == len(out))
