"""独立复验：把 out-*.json 里的每条地址重新下载一遍，量字节/类型/宽高比，查重复。"""
import json, glob, os, sys, time, urllib.request

OUT = 'scripts/_photo-life'
ALL = os.path.join(OUT, 'all')
os.makedirs(ALL, exist_ok=True)

items = []
for f in sorted(glob.glob(os.path.join(OUT, 'out-*.json'))):
    items += json.load(open(f, encoding='utf-8'))['items']

def ar_of(b):
    i = 2
    while i < len(b) - 9:
        if b[i] != 0xFF:
            i += 1
            continue
        m = b[i + 1]
        if m in (0xC0, 0xC1, 0xC2):
            h = int.from_bytes(b[i + 5:i + 7], 'big')
            w = int.from_bytes(b[i + 7:i + 9], 'big')
            return (w / h) if h else None
        if m in (0xD8, 0xD9) or 0xD0 <= m <= 0xD7:
            i += 2
            continue
        i += 2 + int.from_bytes(b[i + 2:i + 4], 'big')
    return None

rows = []
seen = {}
missing = [it for it in items if not it.get('mediaUrl')]
if missing:
    print('没有地址的条目：', [it['id'] for it in missing])

for it in items:
    if not it.get('mediaUrl'):
        continue
    url = it['mediaUrl']
    pid = it['pexelsId']
    dest = os.path.join(ALL, it['id'] + '.jpg')
    status, ctype, n = 0, '', 0
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=30) as r:
                b = r.read()
                status = r.status
                ctype = r.headers.get('Content-Type', '')
            open(dest, 'wb').write(b)
            n = len(b)
            break
        except Exception as e:
            status = str(e)[:60]
            time.sleep(2)
    ar = ar_of(open(dest, 'rb').read()) if n else None
    dup = seen.get(pid)
    seen[pid] = it['id']
    rows.append({'id': it['id'], 'title': it['title'], 'pid': pid, 'status': status,
                 'ctype': ctype, 'bytes': n, 'ar': ar, 'dup_of': dup})

bad = [r for r in rows if r['status'] != 200 or not str(r['ctype']).startswith('image/') or r['bytes'] < 10000]
lowar = [r for r in rows if r['ar'] is not None and r['ar'] < 1.15]
dup = [r for r in rows if r['dup_of']]
noar = [r for r in rows if r['ar'] is None]

print(f'下载 {len(rows)} 条')
print(f'坏地址(非200/非图片/<10KB)：{len(bad)}')
for r in bad:
    print('   ', r['id'], r['status'], r['ctype'], r['bytes'])
print(f'ar < 1.15：{len(lowar)}')
for r in lowar:
    print('   ', r['id'], r['ar'])
print(f'读不出 ar：{len(noar)}', [r['id'] for r in noar])
print(f'编号重复：{len(dup)}')
for r in dup:
    print('   ', r['id'], '与', r['dup_of'], '共用', r['pid'])
print(f'不同编号数：{len(set(seen))} / {len(rows)}')
json.dump(rows, open(os.path.join(OUT, 'verify.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
