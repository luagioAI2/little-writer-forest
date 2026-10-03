# -*- coding: utf-8 -*-
"""列出全部 162 个照片槽位（题目 id / 第几张 / 题名 / 地址 / 旧 sceneKey），供逐张审。"""
import json, re, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

overlay = json.load(open('src/data/library-items.json', encoding='utf-8'))

text = open('src/domain/prompts.ts', encoding='utf-8').read()
s = text.index('export const PROMPT_TEMPLATES')
e = re.search(r"\n\}\n", text[s:]).end() + s
block = text[s:e]
titles, cur = {}, None
for line in block.split('\n'):
    m = re.match(r"^  '?([a-z0-9-]+)'?:\s*\[\s*$", line)
    if m:
        cur = m.group(1); titles[cur] = []; continue
    if line == '  ],' and cur:
        cur = None; continue
    if cur is not None:
        titles[cur] += re.findall(r"title:\s*'((?:[^'\\]|\\.)*)'", line)

rows = []
for qid in sorted(overlay):
    ov = overlay[qid]
    urls = ov.get('imageUrls') or []
    # ⚠️ 标签名自己带连字符（community-helper / people-around / home-scene…）
    #    → 只能从**末尾**剥掉 `-<n>`，不能用 split('-')[1]
    tail = qid[len('builtin-'):]
    tag, _, ns = tail.rpartition('-')
    n = int(ns) if ns.isdigit() else 0
    t = titles.get(tag, [])
    title = t[n - 1] if 0 < n <= len(t) else '?'
    for k, u in enumerate(urls):
        rows.append({
            'id': qid, 'slot': k, 'title': title,
            'pexelsId': re.search(r'/photos/(\d+)/', u).group(1),
            'url': u,
        })

print('照片槽位总数:', len(rows))
json.dump(rows, open('scripts/_photo-scene/all-162.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=2)
with open('scripts/_photo-scene/all-162.txt', 'w', encoding='utf-8', newline='') as f:
    for i, r in enumerate(rows, 1):
        f.write('%03d\t%s\t%d\t%s\t%s\n' % (i, r['id'], r['slot'], r['title'], r['url']))
print('→ all-162.json / all-162.txt')
