# -*- coding: utf-8 -*-
"""在「插画为主、照片补空」下算一遍可行性：
   - 每道题几个图位
   - 126 张插画要 1:1 分给 144 道题 —— 鸽笼原理下必然有 18 道题分不到
   - 给出一个「改动最小」的分配方案
只读，不写盘。
"""
import re, json, io, sys, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

SRC = open('src/domain/prompts.ts', encoding='utf-8').read()
heads = list(re.finditer(r"^  '?([a-z0-9-]+)'?:\s*\[\s*$", SRC, re.M))
tpl = {}
for hi, h in enumerate(heads):
    tag = h.group(1)
    end = heads[hi + 1].start() if hi + 1 < len(heads) else len(SRC)
    arr = []
    for m in re.finditer(r"title:\s*'((?:[^'\\]|\\.)*)'[\s\S]*?scenes:\s*\[([^\]]*)\]",
                         SRC[h.end():end]):
        arr.append((m.group(1), re.findall(r"'([^']+)'", m.group(2))))
    if arr:
        tpl[tag] = arr

Q = {}   # id -> (title, scenes, tag)
for tag, arr in tpl.items():
    for i, (title, sc) in enumerate(arr):
        Q['builtin-%s-%d' % (tag, i + 1)] = (title, sc, tag)

print('题:', len(Q))
dist = collections.Counter(len(v[1]) for v in Q.values())
print('每道题的图位分布:', dict(sorted(dist.items())))
print('图位总数:', sum(len(v[1]) for v in Q.values()))

by_key = collections.defaultdict(list)
for qid, (t, sc, tag) in Q.items():
    for k in sc:
        by_key[k].append((qid, sc.index(k)))

print('插画张数(被引用到的 sceneKey):', len(by_key))
unique_keys = {k: v for k, v in by_key.items() if len(v) == 1}
shared_keys = {k: v for k, v in by_key.items() if len(v) > 1}
print('  只用一次的:', len(unique_keys), ' 被共用的:', len(shared_keys))

# 鸽笼：144 道题，126 张插画 → 至少 18 道题分不到独有插画
print()
print('★ 144 道题 vs 126 张插画 → 至少有 144-126 = %d 道题拿不到独有插画' % (len(Q) - len(by_key)))

# 多图位的题
multi = {q: v for q, v in Q.items() if len(v[1]) > 1}
print('多图位（连环）的题:', len(multi))
for q, (t, sc, tag) in sorted(multi.items()):
    print('   %-30s %-46s 《%s》' % (q, sc, t))

# 候选方案：让"多图位的题"改走照片（它们本来就要给后续图位配照片）
print()
cand = sorted(multi.keys())
print('方案候选（多图位的题改走照片）: %d 道 —— 需要 %d 才够' % (len(cand), len(Q) - len(by_key)))
print('  候选:', [c.replace('builtin-', '') for c in cand])

# 这些题的 key 是否被别的单图位题用到（用到的话那些 key 就"空"出来了）
used_elsewhere = collections.defaultdict(list)
for q in cand:
    for k in Q[q][1]:
        others = [x for x, _ in by_key[k] if x != q]
        used_elsewhere[k] = others
print()
print('这些题用到的 key 是否还被别人用:')
for k, others in sorted(used_elsewhere.items()):
    print('   %-24s 还被 %s 用' % (k, [o.replace('builtin-', '') for o in others] or '没人用（空出来了）'))
