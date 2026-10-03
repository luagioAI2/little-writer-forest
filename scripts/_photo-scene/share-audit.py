# -*- coding: utf-8 -*-
"""共用图审计：确认「共用的 27 个 URL」是不是就是「共用同一个 sceneKey」的那些题。

只读，不写任何文件。
"""
import re, json, collections, io, sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

SRC = open('src/domain/prompts.ts', encoding='utf-8').read()

# ---- 解析 PROMPT_TEMPLATES ----------------------------------------------
heads = list(re.finditer(r"^  '?([a-z0-9-]+)'?:\s*\[\s*$", SRC, re.M))
tpl = {}
for hi, h in enumerate(heads):
    tag = h.group(1)
    end = heads[hi + 1].start() if hi + 1 < len(heads) else len(SRC)
    body = SRC[h.end():end]
    arr = []
    for m in re.finditer(r"title:\s*'((?:[^'\\]|\\.)*)'[\s\S]*?scenes:\s*\[([^\]]*)\]", body):
        arr.append((m.group(1), re.findall(r"'([^']+)'", m.group(2))))
    if arr:
        tpl[tag] = arr

scenes_of = {}
for tag, arr in tpl.items():
    for i, (title, sc) in enumerate(arr):
        scenes_of['builtin-%s-%d' % (tag, i + 1)] = (title, sc)

print('tags: %d   questions: %d' % (len(tpl), len(scenes_of)))

# ---- sceneKey -> questions ----------------------------------------------
by_scene = collections.defaultdict(list)
for iid, (t, sc) in scenes_of.items():
    for k in sc:
        by_scene[k].append(iid)
multi = {k: v for k, v in by_scene.items() if len(v) > 1}
print('sceneKeys: %d   shared by >1 question: %d   questions touched: %d'
      % (len(by_scene), len(multi), len({q for v in multi.values() for q in v})))
print()
print('=== 被多道题共用的 sceneKey（按题数降序，前 25）===')
for k, v in sorted(multi.items(), key=lambda kv: -len(kv[1]))[:25]:
    print('  %-22s x%-2d %s' % (k, len(v), ', '.join(x.replace('builtin-', '') for x in v)))

# ---- overlay ------------------------------------------------------------
data = json.loads(open('src/data/library-items.json', encoding='utf-8').read())
urls = collections.Counter()
for iid, ov in data.items():
    for u in (ov.get('imageUrls') or []):
        urls[u] += 1
shared = {u: c for u, c in urls.items() if c > 1}
slots = sum(len(ov.get('imageUrls') or []) for ov in data.values())
print()
print('overlay: entries=%d slots=%d distinct=%d shared_urls=%d slots_shared=%d'
      % (len(data), slots, len(urls), len(shared), sum(shared.values())))

print()
print('=== 共用的 URL -> 涉及的题 / 各自的 sceneKey ===')
for u, c in sorted(shared.items(), key=lambda kv: -kv[1]):
    pid = re.search(r'/photos/(\d+)/', u).group(1)
    ids = [i for i in data if u in (data[i].get('imageUrls') or [])]
    scs = [tuple(scenes_of.get(i, ('?', []))[1]) for i in ids]
    same = len(set(scs)) == 1
    print('  %-9s x%d  %s' % (pid, c, '★同一个 sceneKey 列表' if same else '不同 sceneKey!'))
    for i in ids:
        t, sc = scenes_of.get(i, ('?', []))
        print('        %-32s %-34s 《%s》' % (i, sc, t))

# ---- 反例：共用 sceneKey 但图**不**共用的题 --------------------------------
print()
print('=== 反向检查：共用 sceneKey、但图已经不一样的题（说明不是运行时按 key 取图）===')
cnt = 0
for k, v in multi.items():
    picks = []
    for q in v:
        sc = scenes_of[q][1]
        idx = sc.index(k) if k in sc else -1
        us = data.get(q, {}).get('imageUrls') or []
        picks.append(us[idx] if 0 <= idx < len(us) else None)
    distinct = len(set(x for x in picks if x))
    if distinct > 1:
        cnt += 1
        if cnt <= 12:
            print('  %-22s %s' % (k, [ (q.replace('builtin-',''), (u or '')[-40:]) for q, u in zip(v, picks) ]))
print('  ... 共 %d 个 sceneKey 下的题已经拿到了各不相同的图' % cnt)
