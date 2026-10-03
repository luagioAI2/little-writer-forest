# -*- coding: utf-8 -*-
"""按 sceneKey 查出：哪几道题用到它、第几个槽位、现在配的是哪张图。
用法：python scripts/_photo-scene/find-key.py rain-delivery cactus
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ptx = io.open(os.path.join(ROOT, 'src/domain/prompts.ts'), encoding='utf-8').read()
ptx = ptx[ptx.find('PROMPT_TEMPLATES'):]
heads = list(re.finditer(r"^  '?([a-z0-9-]+)'?:\s*\[\s*$", ptx, re.M))
tpl = {}
for i, h in enumerate(heads):
    end = heads[i + 1].start() if i + 1 < len(heads) else len(ptx)
    body = ptx[h.end():end]
    pairs = re.findall(r"title:\s*'((?:[^'\\]|\\.)*)'[\s\S]*?scenes:\s*\[([^\]]*)\]", body)
    tpl[h.group(1)] = [(t, re.findall(r"'([^']+)'", s)) for t, s in pairs]

id2 = {}
for tag, arr in tpl.items():
    for n, (t, keys) in enumerate(arr, 1):
        id2['builtin-%s-%d' % (tag, n)] = (t, keys)

ov = json.load(io.open(os.path.join(ROOT, 'src/data/library-items.json'), encoding='utf-8'))

for want in sys.argv[1:]:
    print('=== %s ===' % want)
    hit = False
    for iid, (t, keys) in sorted(id2.items()):
        if want not in keys:
            continue
        hit = True
        slot = keys.index(want)
        urls = (ov.get(iid) or {}).get('imageUrls') or []
        u = urls[slot] if slot < len(urls) else '(没配)'
        print('  %-26s %s' % (iid, t))
        print('     槽位 %d/%d   %s' % (slot, len(keys), u))
    if not hit:
        print('  （没有任何题用到这个 key）')
