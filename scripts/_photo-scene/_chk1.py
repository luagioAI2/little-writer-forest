# -*- coding: utf-8 -*-
"""落地前的最后一道体检：标签名能不能被脚本的正则抓到、新题的标签是否都存在。"""
import re, json, io, sys, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

text = open('src/domain/prompts.ts', encoding='utf-8').read()
start = text.index('export const PROMPT_TEMPLATES')
end = re.search(r"\n\}\n", text[start:]).end() + start
block = text[start:end]

keys = [m.group(1) for m in re.finditer(r"^  '?([^':\s]+)'?:\s*\[\s*$", block, re.M)]
print('标签数:', len(keys))
bad = [k for k in keys if not re.match(r'^[a-z0-9-]+$', k)]
print('不合脚本正则的标签:', bad)

# 每个标签下有几道题（数 { title: 出现次数）
per = {}
cur = None
for line in block.split('\n'):
    m = re.match(r"^  '?([a-z0-9-]+)'?:\s*\[\s*$", line)
    if m:
        cur = m.group(1)
        per[cur] = 0
        continue
    if line == '  ],':
        cur = None
        continue
    if cur and re.search(r"\{\s*$|title:", line):
        pass
n_titles = len(re.findall(r"title:", block))
print('块内 title 出现次数（≈现有题数）:', n_titles)

nq = json.load(open('scripts/_photo-scene/new-questions.json', encoding='utf-8'))
tags = collections.Counter(e['tag'] for e in nq)
print('新题总数:', len(nq), ' 覆盖标签数:', len(tags))
miss = [t for t in tags if t not in keys]
print('新题里有、prompts 里没有的标签:', miss)
print('分布:', sorted(tags.items(), key=lambda kv: -kv[1]))
