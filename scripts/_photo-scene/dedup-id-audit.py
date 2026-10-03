# -*- coding: utf-8 -*-
"""按 pexels 图片 id（不是整条 URL）重新算一遍重复 —— ?w=640 只是尺寸参数，同 id 就是同一张图。
另外查：同一道题自己的多个槽位有没有用同一张图。
只读。
"""
import json, re, io, sys, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

data = json.loads(open('src/data/library-items.json', encoding='utf-8').read())

def pid(u):
    m = re.search(r'/photos/(\d+)/', u or '')
    return m.group(1) if m else (u or '')

by_id = collections.defaultdict(list)   # pid -> [(iid, slot, url)]
for iid, ov in data.items():
    for k, u in enumerate(ov.get('imageUrls') or []):
        by_id[pid(u)].append((iid, k, u))

slots = sum(len(ov.get('imageUrls') or []) for ov in data.values())
print('槽位总数:', slots, ' 不同 pexels id:', len(by_id))

dup = {p: v for p, v in by_id.items() if len(v) > 1}
print('被重复使用的 id:', len(dup), ' 占槽位:', sum(len(v) for v in dup.values()))

# 同 id 不同 URL（尺寸参数不一致）
param_mismatch = {p: v for p, v in by_id.items() if len({x[2] for x in v}) > 1}
print('同 id 但 URL 字面不同的:', len(param_mismatch))
for p, v in list(param_mismatch.items())[:5]:
    print('   ', p, [x[2] for x in v])

# 同一道题内部重复
self_dup = []
for iid, ov in data.items():
    us = [pid(u) for u in (ov.get('imageUrls') or [])]
    if len(us) != len(set(us)):
        self_dup.append(iid)
print('同一道题内部自己重复用图的:', len(self_dup), self_dup[:10])

# 需要新挑几张：每个重复 id 留 1 个槽位
need = sum(len(v) - 1 for v in dup.values())
print()
print('★ 要新挑的照片数（每个重复 id 留 1 张）：', need)

# 哪些题会被动到
touch = sorted({iid for v in dup.values() for iid, k, u in v})
print('★ 会被动到的题:', len(touch))
print('   ', touch)
