# -*- coding: utf-8 -*-
"""★ 不信子代理的自述，自己核一遍：
   ① 编号有没有撞"已用的 132 个"
   ② 30 个新编号彼此有没有重复
   ③ 有没有哪条跟它要替换的那个编号一样（= 没换）
   ④ mediaUrl 里的编号跟 pexelsId 对不对得上（张冠李戴）
   ⑤ mediaUrl / pageUrl 里的编号一不一致（skill §五 那条：出处链接必须带编号）
"""
import json, re, io, sys, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

overlay = json.load(open('src/data/library-items.json', encoding='utf-8'))
used = set()
for ov in overlay.values():
    for u in (ov.get('imageUrls') or []):
        m = re.search(r'/photos/(\d+)/', u or '')
        if m:
            used.add(m.group(1))

batches = {}
for b in 'ABC':
    batches[b] = json.load(open('scripts/_photo-scene/out-%s.json' % b, encoding='utf-8'))

items = [it for b in 'ABC' for it in batches[b]['items']]
print('合并后条数:', len(items))

ids = [it['pexelsId'] for it in items]
dup = [k for k, v in collections.Counter(ids).items() if v > 1]
print('① 新编号里彼此重复的:', dup or '无 ✓')

clash = [it for it in items if it['pexelsId'] in used]
print('② 撞已用编号的:', [(it['id'], it['pexelsId']) for it in clash] or '无 ✓')

wl = json.load(open('scripts/_photo-scene/replace-worklist.json', encoding='utf-8'))
same = []
for it in items:
    for w in wl:
        if w['id'] == it['id'] and w['slot'] == it['slot']:
            if it['pexelsId'] == w['dupOf']:
                same.append((it['id'], it['slot']))
print('③ 跟"要替换的那张"还是同一个编号（= 没换）:', same or '无 ✓')

bad_media = [it['id'] for it in items
             if not re.search(r'/photos/%s/' % it['pexelsId'], it['mediaUrl'])]
print('④ mediaUrl 编号跟 pexelsId 对不上:', bad_media or '无 ✓')

bad_page = [it['id'] for it in items
            if it.get('pageUrl') and not re.search(r'/%s/?' % it['pexelsId'], it['pageUrl'])]
print('⑤ pageUrl 编号跟 pexelsId 对不上:', bad_page or '无 ✓')

# 工单覆盖：30 条是否一一对上
key = lambda it: (it['id'], it['slot'])
want = {key(w) for w in wl}
got = {key(it) for it in items}
print('⑥ 工单缺的:', sorted(want - got) or '无 ✓')
print('   多出来的:', sorted(got - want) or '无 ✓')

print()
print('ar 分布:', sorted(round(float(it.get('ar') or 0), 2) for it in items))
print('字节数最小:', min(it.get('bytes') or 0 for it in items))

json.dump(items, open('scripts/_photo-scene/replace-merged.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=2)
print('→ scripts/_photo-scene/replace-merged.json')
