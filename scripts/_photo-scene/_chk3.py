# -*- coding: utf-8 -*-
"""真正的题号不变量：每个标签下，前 N 条必须与备份逐字一致（新题只准排在后面）。"""
import re, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def parse(path):
    text = open(path, encoding='utf-8').read()
    start = text.index('export const PROMPT_TEMPLATES')
    end = re.search(r"\n\}\n", text[start:]).end() + start
    block = text[start:end]
    out, cur = {}, None
    for line in block.split('\n'):
        m = re.match(r"^  '?([a-z0-9-]+)'?:\s*\[\s*$", line)
        if m:
            cur = m.group(1); out[cur] = []; continue
        if line == '  ],' and cur:
            cur = None; continue
        if cur is not None:
            out[cur].append(line)
    res = {}
    for tag, lines in out.items():
        buf = '\n'.join(lines)
        res[tag] = re.findall(r"title:\s*'((?:[^'\\]|\\.)*)'", buf)
    return res

before = parse('scripts/_photo-scene/prompts.before-270.ts')
after = parse('src/domain/prompts.ts')

bad = []
for tag, old in before.items():
    new = after.get(tag, [])
    if new[:len(old)] != old:
        bad.append((tag, len(old), len(new)))
print('标签数 before/after:', len(before), '/', len(after))
print('前缀被破坏的标签:', bad)
print()
for tag in before:
    o, n = len(before[tag]), len(after[tag])
    if n > o:
        print('  %-20s %3d → %3d  (+%d)' % (tag, o, n, n - o))
print()
print('新增总数:', sum(len(after[t]) - len(before[t]) for t in before))
