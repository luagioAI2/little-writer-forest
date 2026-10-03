# -*- coding: utf-8 -*-
"""这 33 组同名，是不是还在同一个标签下（那就是列表里挨着的两行）？"""
import re, json, io, sys, collections
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

old_title_tag = {}
for tag, rows in before.items():
    for t, l, sc in rows:
        old_title_tag.setdefault(t, []).append(tag)

nq = json.load(open('scripts/_photo-scene/new-questions.json', encoding='utf-8'))
same = [q for q in nq if q['title'] in old_title_tag]

same_tag = [q for q in same if q['tag'] in old_title_tag[q['title']]]
diff_tag = [q for q in same if q['tag'] not in old_title_tag[q['title']]]

print('同名总数:', len(same))
print('★ 同标签（列表里挨着）:', len(same_tag))
print('  跨标签:', len(diff_tag))
print()
for q in same_tag:
    print('  %-20s 《%s》  新标签=%s  老标签=%s' % (q['key'], q['title'], q['tag'], old_title_tag[q['title']]))
print()
for q in diff_tag:
    print('  %-20s 《%s》  新标签=%s  老标签=%s' % (q['key'], q['title'], q['tag'], old_title_tag[q['title']]))
