# -*- coding: utf-8 -*-
"""第二轮：把子代理找回来的 29 张图落进覆盖层（原来一张都没有的那 31 道题）。

跟第一轮 apply.py 的差别：
  · 这批题**都是单图**（0/1 张），所以只需写 imageUrls[0]
  · 大部分题**还不在覆盖层里** → 要新建条目（带 baseTitle/baseLead 防串位）
  · 只写 baseTitle / baseLead / imageUrls 三个键，键序跟落盘端点一致
  · 落盘后断言 canon === raw（逐字节同形）

用法：python scripts/_photo-scene/apply2.py
"""
import glob
import io
import json
import os
import re
from collections import OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
D = os.path.join(ROOT, 'scripts', '_photo-scene')
DATA = os.path.join(ROOT, 'src/data/library-items.json')
PEXELS = 'https://images.pexels.com/photos/{}/pexels-photo-{}.jpeg?auto=compress&cs=tinysrgb&w=640'

# 主代理复核后手工替换的（子代理交的是黑白抽象图，跟周围暖色插画不搭）
FIX2 = {
    'time-travel': {
        'pexelsId': 33002031,
        'link': 'https://www.pexels.com/photo/close-up-of-an-antique-clock-face-with-roman-numerals-33002031/',
        'author': 'lucaphoto',
        'note': '主代理替换：子代理那张是黑白抽象运动模糊，跟周围暖色卡通插画不搭',
    },
}


def rd(p):
    return io.open(p, encoding='utf-8').read()


# ---- id -> (title, lead, keys) ----
ptx = rd(os.path.join(ROOT, 'src/domain/prompts.ts'))
ptx = ptx[ptx.find('PROMPT_TEMPLATES'):]
heads = list(re.finditer(r"^  '?([a-z0-9-]+)'?:\s*\[\s*$", ptx, re.M))
items = OrderedDict()
for i, h in enumerate(heads):
    end = heads[i + 1].start() if i + 1 < len(heads) else len(ptx)
    body = ptx[h.end():end]
    pairs = re.findall(
        r"title:\s*'((?:[^'\\]|\\.)*)',\s*lead:\s*'((?:[^'\\]|\\.)*)'[\s\S]*?scenes:\s*\[([^\]]*)\]",
        body)
    for n, (t, l, s) in enumerate(pairs, 1):
        items['builtin-%s-%d' % (h.group(1), n)] = (t, l, re.findall(r"'([^']+)'", s))

# ---- 子代理的产出 ----
picks = {}
for f in sorted(glob.glob(os.path.join(D, 'out2-*.json'))):
    for it in json.load(io.open(f, encoding='utf-8'))['items']:
        picks[it['key']] = it
for k, fx in FIX2.items():
    if k not in picks:
        raise SystemExit('FIX2 的 key 不在子代理产出里：' + k)
    pid = fx['pexelsId']
    picks[k] = dict(picks[k], pexelsId=pid, mediaUrl=PEXELS.format(pid, pid),
                    credit={'link': fx['link'], 'author': fx['author']},
                    note=fx['note'], verdict='ok')

missing = json.load(io.open(os.path.join(D, 'missing-keys.json'), encoding='utf-8'))
overlay = json.load(io.open(DATA, encoding='utf-8'))
before = len(overlay)

added = fixed = 0
unresolved = []
for entry in missing:
    key = entry['key']
    pick = picks.get(key)
    if not pick:
        unresolved.append((key, entry['usedBy']))
        continue
    url = pick['mediaUrl']
    for iid in entry['usedBy']:
        t, l, keys = items[iid]
        if key not in keys:
            raise SystemExit('❌ %s 的 scenes 里没有 %s' % (iid, key))
        slot = keys.index(key)
        if iid in overlay:
            urls = overlay[iid].setdefault('imageUrls', [])
            while len(urls) <= slot:
                urls.append(None)
            urls[slot] = url
            fixed += 1
        else:
            if len(keys) != 1:
                raise SystemExit('❌ %s 是多图题（%d 张），这批脚本只处理单图' % (iid, len(keys)))
            e = OrderedDict()
            e['baseTitle'] = t
            e['baseLead'] = l
            e['imageUrls'] = [url]
            overlay[iid] = e
            added += 1

# ---- 规范化落盘 ----
ALLOWED = ['baseTitle', 'baseLead', 'title', 'lead', 'imageUrls']
clean = OrderedDict()
for k in sorted(overlay):
    o = overlay[k]
    e = OrderedDict()
    for kk in ALLOWED:
        if kk not in o:
            continue
        if kk == 'title' and o.get('title') == o.get('baseTitle'):
            continue
        if kk == 'lead' and o.get('lead') == o.get('baseLead'):
            continue
        e[kk] = o[kk]
    if 'title' not in e and 'lead' not in e and 'imageUrls' not in e:
        continue
    clean[k] = e

io.open(DATA, 'w', encoding='utf-8', newline='\n').write(
    json.dumps(clean, ensure_ascii=False, indent=2) + '\n')

raw = io.open(DATA, 'rb').read()
again = json.dumps(json.loads(raw.decode('utf-8')), ensure_ascii=False, indent=2) + '\n'
same = again.encode('utf-8') == raw

print('覆盖层 %d → %d 条（新建 %d、补槽位 %d）' % (before, len(clean), added, fixed))
print('逐字节同形（canon === raw）：%s' % same)
if not same:
    raise SystemExit('❌ 输出跟落盘端点的规范形不同形')

# ---- 断言：29 个 key 的图都在文件里，且每道题都有图了 ----
txt = io.open(DATA, encoding='utf-8').read()
for entry in missing:
    pid = picks[entry['key']]['pexelsId']
    if str(pid) not in txt:
        raise SystemExit('❌ %s 的图（%d）没写进去' % (entry['key'], pid))
still = []
for iid, (t, l, keys) in items.items():
    urls = (clean.get(iid) or {}).get('imageUrls') or []
    if not any(urls[:len(keys)]):
        still.append(iid)
print('✓ %d 个 key 的图都写进去了' % len(missing))
print('还没配图的题：%d 道 %s' % (len(still), still if still else ''))
if unresolved:
    print('⚠️ 没拿到图的 key：%s' % unresolved)
