# -*- coding: utf-8 -*-
"""这 126 道插画新题，跟"原来占着这张插画的那道题"重复到什么程度？

背景：老 144 道题的 sceneKey 就是从这 126 张插画里来的 ——
也就是说老题的文字**本来就是在描述这些插画**。现在拆成两半之后，
会不会出现「同一张图配两道几乎一样的题」？这份报告量一下。
"""
import re, json, io, sys, difflib, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def parse(path):
    text = open(path, encoding='utf-8').read()
    s = text.index('export const PROMPT_TEMPLATES')
    e = re.search(r"\n\}\n", text[s:]).end() + s
    block = text[s:e]
    res, cur = {}, None
    for line in block.split('\n'):
        m = re.match(r"^  '?([a-z0-9-]+)'?:\s*\[\s*$", line)
        if m:
            cur = m.group(1); res[cur] = []; continue
        if line == '  ],' and cur:
            cur = None; continue
        if cur is not None:
            res[cur].append(line)
    out = {}
    for tag, lines in res.items():
        buf = '\n'.join(lines)
        out[tag] = re.findall(
            r"\{\s*title:\s*'((?:[^'\\]|\\.)*)',\s*lead:\s*'((?:[^'\\]|\\.)*)',\s*scenes:\s*\[([^\]]*)\]\s*,?\s*\}",
            buf, re.S)
    return out

before = parse('scripts/_photo-scene/prompts.before-270.ts')
after = parse('src/domain/prompts.ts')

# 老题：key → [(title, lead)]
old_by_key = collections.defaultdict(list)
old_titles = set()
for tag, rows in before.items():
    for title, lead, sc in rows:
        old_titles.add(title)
        for k in re.findall(r"'([^']*)'", sc):
            old_by_key[k].append((title, lead))

new_qs = json.load(open('scripts/_photo-scene/new-questions.json', encoding='utf-8'))
print('新题数:', len(new_qs))
print('新题里、题名跟老题**完全一样**的:', sum(1 for q in new_qs if q['title'] in old_titles))
print()

# 逐题：跟"原来用这张插画的老题"比文字相似度
rows = []
for q in new_qs:
    olds = old_by_key.get(q['key'], [])
    if not olds:
        rows.append((q, None, 0.0, 0.0)); continue
    best = None
    for t, l in olds:
        ts = difflib.SequenceMatcher(None, q['title'], t).ratio()
        ls = difflib.SequenceMatcher(None, q['lead'], l).ratio()
        if best is None or (ls + ts) > (best[2] + best[1]):
            best = ((t, l), ts, ls)
    rows.append((q, best[0], best[1], best[2]))

same_title = [r for r in rows if r[1] and r[1][0] == r[0]['title']]
print('★ 题名与"原主人"完全相同的:', len(same_title))
for q, o, ts, ls in same_title:
    print('   %-24s %-22s  原: %s' % (q['key'], q['title'], o[0]))
print()

print('★ 引导语相似度 ≥0.55（意思比较近）的:', sum(1 for r in rows if r[3] >= 0.55))
for q, o, ts, ls in sorted(rows, key=lambda r: -r[3])[:15]:
    if ls < 0.45: break
    print('   %.2f  %-22s 新:「%s」' % (ls, q['key'], q['lead'][:26]))
    print('         %-22s 原:「%s」' % ('', o[1][:26] if o else ''))
print()

# 没有原主人的（新插画？）
orphan = [r[0] for r in rows if r[1] is None]
print('找不到"原主人"的插画:', len(orphan), [o['key'] for o in orphan][:10])
