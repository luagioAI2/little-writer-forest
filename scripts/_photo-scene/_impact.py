# -*- coding: utf-8 -*-
"""影响面：pictureFirst 只在 event 类分支起作用。
   数一下 144 道纯照片题里有多少落在 event 类。"""
import re, io, sys, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

text = open('src/domain/prompts.ts', encoding='utf-8').read()
tags = re.findall(r"\{ id: '([a-z0-9-]+)', category: '([a-z]+)'", text)
cat_of = dict(tags)
print('标签数:', len(cat_of))
print('大类分布:', collections.Counter(cat_of.values()))
print()

nq = __import__('json').load(open('scripts/_photo-scene/new-questions.json', encoding='utf-8'))
new_by_tag = collections.Counter(e['tag'] for e in nq)

# 每个标签的新题数 → 老题数
def counts(path):
    t = open(path, encoding='utf-8').read()
    s = t.index('export const PROMPT_TEMPLATES')
    e = re.search(r"\n\}\n", t[s:]).end() + s
    block = t[s:e]
    res, cur = {}, None
    for line in block.split('\n'):
        m = re.match(r"^  '?([a-z0-9-]+)'?:\s*\[\s*$", line)
        if m:
            cur = m.group(1); res[cur] = 0; continue
        if line == '  ],' and cur:
            cur = None; continue
        if cur is not None:
            res[cur] += len(re.findall(r"title:", line))
    return res

after = counts('src/domain/prompts.ts')
old = {t: after[t] - new_by_tag.get(t, 0) for t in after}

old_by_cat = collections.Counter()
new_by_cat = collections.Counter()
for t, n in old.items():
    old_by_cat[cat_of.get(t, '?')] += n
for t, n in new_by_tag.items():
    new_by_cat[cat_of.get(t, '?')] += n

print('老题（=纯照片题）按大类:', dict(old_by_cat), '共', sum(old_by_cat.values()))
print('新题（=插画题）按大类:', dict(new_by_cat), '共', sum(new_by_cat.values()))
print()
print('★ 受影响面（本地兜底引擎的 pictureFirst）：只有 event 类的纯照片题 =',
      old_by_cat.get('event', 0), '道')
