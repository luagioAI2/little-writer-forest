# -*- coding: utf-8 -*-
"""下载 50 道新题的首选图 + 备选图，量 HTTP 状态 / 类型 / 字节 / 宽高比。

判据（跟项目里 SceneArt 的渲染一致）：
  SceneArt 是 aspect-ratio: 4/3 + object-cover + 居中
  → 横图安全；ar < 1.33 会被裁掉上下；ar < 1.15 基本只剩一条缝
"""
import io
import json
import os
import struct
import sys
import urllib.request
import urllib.error

IMG = 'scripts/_new50/img'
os.makedirs(IMG, exist_ok=True)

# 本机有系统代理，必须绕开（项目里 curl 也要 --noproxy '*'）
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
OPENER.addheaders = [('User-Agent', 'Mozilla/5.0')]


def jpeg_size(path):
    """从 JPEG 的 SOF 段读宽高 —— 不用装 Pillow。"""
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
        # SOF0..SOF15（不含 DHT=C4 / JPG=C8 / DAC=CC）
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            h, w = struct.unpack('>HH', data[i + 5:i + 9])
            return w, h
        i += 2 + seg_len
    return None


def grab(url, dest):
    # 断点续传：已经下好的直接用（这个脚本会被 SIGTERM 打断过，别重下）
    if os.path.exists(dest) and os.path.getsize(dest) > 3000:
        size = jpeg_size(dest)
        return {
            'http': 200, 'ctype': 'image/jpeg', 'bytes': os.path.getsize(dest),
            'err': '', 'cached': True,
        }
    try:
        with OPENER.open(url, timeout=60) as r:
            body = r.read()
            ctype = r.headers.get('Content-Type', '')
            code = r.status
    except urllib.error.HTTPError as e:
        return {'http': e.code, 'ctype': '', 'bytes': 0, 'err': str(e)}
    except Exception as e:  # noqa: BLE001
        return {'http': 0, 'ctype': '', 'bytes': 0, 'err': str(e)}
    with io.open(dest, 'wb') as f:
        f.write(body)
    return {'http': code, 'ctype': ctype, 'bytes': len(body), 'err': ''}


from concurrent.futures import ThreadPoolExecutor  # noqa: E402

rows_by_n = {}
jobs = []
for b in range(1, 6):
    with io.open(f'scripts/_new50/out-{b:02d}.json', encoding='utf-8') as f:
        batch = json.load(f)
    for it in batch:
        row = {'n': it['n'], 'tag': it['tag'], 'title': it['title'], 'fail': it.get('fail')}
        rows_by_n[it['n']] = row
        for which in ('primary', 'fallback'):
            cand = it.get(which)
            if not cand:
                row[which] = None
                continue
            dest = f'{IMG}/{it["n"]:02d}-{which[0]}.jpg'
            jobs.append((row, which, cand, dest))

with ThreadPoolExecutor(max_workers=10) as ex:
    futs = []
    for row, which, cand, dest in jobs:
        futs.append((row, which, cand, ex.submit(grab, cand['url'], dest)))
    for row, which, cand, fut in futs:
        info = fut.result()
        dest = f'{IMG}/{row["n"]:02d}-{which[0]}.jpg'
        size = jpeg_size(dest) if info['bytes'] else None
        info.update({
            'id': cand['id'],
            'url': cand['url'],
            'page': cand.get('page', ''),
            'why': cand.get('why', ''),
            'w': size[0] if size else None,
            'h': size[1] if size else None,
            'ar': round(size[0] / size[1], 3) if size else None,
            'ok': (
                info['http'] == 200
                and info['ctype'].startswith('image/')
                and size is not None
                and size[0] / size[1] >= 1.33
                and info['bytes'] > 3000
            ),
        })
        row[which] = info

# ⚠️ 别在 jobs 循环里 append —— 一条题有两个候选，会在 rows 里出现两次
rows = [rows_by_n[k] for k in sorted(rows_by_n)]
assert len(rows) == 50, f'应该是 50 条，实际 {len(rows)}'

with io.open('scripts/_new50/verify.json', 'w', encoding='utf-8', newline='\n') as f:
    json.dump(rows, f, ensure_ascii=False, indent=2)

# ---- 汇报 ----
bad = []
for r in rows:
    for which in ('primary', 'fallback'):
        c = r.get(which)
        if c is None:
            bad.append((r['n'], r['title'], which, '缺失'))
        elif not c['ok']:
            bad.append((r['n'], r['title'], which,
                        f"http={c['http']} ctype={c['ctype']} bytes={c['bytes']} ar={c['ar']} {c['err']}"))
print(f'共 {len(rows)} 题，下载 {sum(1 for r in rows for w in ("primary","fallback") if r.get(w))} 张')
print(f'不合格 {len(bad)} 张：')
for b in bad:
    print('  ', b)

ids = [r[w]['id'] for r in rows for w in ('primary',) if r.get(w)]
print(f'\n首选 id 去重：{len(set(ids))}/{len(ids)}')
dups = [i for i in set(ids) if ids.count(i) > 1]
print('首选重复 id：', dups)
allids = [r[w]['id'] for r in rows for w in ('primary', 'fallback') if r.get(w)]
print(f'全部 id 去重：{len(set(allids))}/{len(allids)}')
print('全部重复 id：', [i for i in set(allids) if allids.count(i) > 1])
sys.exit(0)
