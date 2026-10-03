# -*- coding: utf-8 -*-
"""★ 最关键的一条：覆盖层是按 id 落的，id 又按下标拼。
   如果哪条覆盖层 id 的下标 > 该标签"原来的题数"，它现在就落到了**新题**头上 —— 静默错位。
"""
import re, json, io, sys, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def counts(path):
    text = open(path, encoding='utf-8').read()
    start = text.index('export const PROMPT_TEMPLATES')
    end = re.search(r"\n\}\n", text[start:]).end() + start
    block = text[start:end]
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

before = counts('scripts/_photo-scene/prompts.before-270.ts')
after = counts('src/domain/prompts.ts')

overlay = json.load(open('src/data/library-items.json', encoding='utf-8'))
print('覆盖层条数:', len(overlay))

ids = overlay.keys() if isinstance(overlay, dict) else [e['id'] for e in overlay]
collide = []
unknown_tag = []
for i in sorted(ids):
    m = re.match(r'^builtin-(.+)-(\d+)$', i)
    if not m:
        unknown_tag.append(i); continue
    tag, n = m.group(1), int(m.group(2))
    if tag not in before:
        unknown_tag.append(i); continue
    if n > before[tag]:
        collide.append((i, '旧题数 %d，下标 %d → 现在是新题' % (before[tag], n)))

print('★ 落到新题头上的覆盖层 id:', collide if collide else '无 ✓')
print('覆盖层里对不上任何标签的 id:', unknown_tag if unknown_tag else '无 ✓')

# 反向：每条新题是否被覆盖层意外命中
print()
print('各标签 旧→新:')
for t in before:
    if after[t] != before[t]:
        print('  %-20s %d → %d' % (t, before[t], after[t]))

# 覆盖层里那些"图位个数"与新版是否还对得上（图位个数没变才对）
print()
print('覆盖层 imageUrls 长度分布:', collections.Counter(
    len(v.get('imageUrls') or []) for v in (overlay.values() if isinstance(overlay, dict) else overlay)))
