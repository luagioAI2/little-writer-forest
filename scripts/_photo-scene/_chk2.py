# -*- coding: utf-8 -*-
"""落地后的复核：题数、图位、插画引用次数、题号是否只增不改。"""
import re, json, io, sys, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

text = open('src/domain/prompts.ts', encoding='utf-8').read()
start = text.index('export const PROMPT_TEMPLATES')
end = re.search(r"\n\}\n", text[start:]).end() + start
block = text[start:end]

# 按标签切块
chunks = {}
cur = None
for line in block.split('\n'):
    m = re.match(r"^  '?([a-z0-9-]+)'?:\s*\[\s*$", line)
    if m:
        cur = m.group(1); chunks[cur] = []; continue
    if line == '  ],' and cur:
        cur = None; continue
    if cur is not None:
        chunks[cur].append(line)

entries = {}
for tag, lines in chunks.items():
    buf = '\n'.join(lines)
    # 每条题：title / lead / scenes
    for m in re.finditer(r"\{\s*title:\s*'((?:[^'\\]|\\.)*)',\s*lead:\s*'((?:[^'\\]|\\.)*)',\s*scenes:\s*\[([^\]]*)\]\s*,?\s*\}", buf, re.S):
        entries.setdefault(tag, []).append((m.group(1), m.group(3)))

total = sum(len(v) for v in entries.values())
slots = 0
photo_slots = 0
illus_refs = collections.Counter()
for tag, lst in entries.items():
    for title, sc in lst:
        keys = re.findall(r"'([^']*)'", sc)
        if not keys:
            keys = [k.strip() for k in sc.split(',') if k.strip()]
        slots += len(keys)
        for k in keys:
            if k == 'PHOTO_SLOT' or k == '':
                photo_slots += 1
            else:
                illus_refs[k] += 1

print('题数:', total)
print('图位总数:', slots, ' 其中纯照片位:', photo_slots, ' 其中插画位:', slots - photo_slots)
print('被引用的不同插画数:', len(illus_refs))
dup = {k: v for k, v in illus_refs.items() if v > 1}
print('被引用 >1 次的插画:', dup)
missing = {k: v for k, v in illus_refs.items() if v < 1}
print('PHOTO_SLOT 常量:', 'PHOTO_SLOT' in text.split('PROMPT_TEMPLATES')[0])

# 题号只增不改：前 N 条应与备份完全一致
bak = open('scripts/_photo-scene/prompts.before-270.ts', encoding='utf-8').read()
bstart = bak.index('export const PROMPT_TEMPLATES')
bend = re.search(r"\n\}\n", bak[bstart:]).end() + bstart
bb = bak[bstart:bend]
btitles = re.findall(r"title:\s*'((?:[^'\\]|\\.)*)'", bb)
atitles = re.findall(r"title:\s*'((?:[^'\\]|\\.)*)'", block)
print('备份题数:', len(btitles), ' 现在题数:', len(atitles))
print('前 144 条题名是否逐字一致:', btitles == atitles[:len(btitles)])
