# -*- coding: utf-8 -*-
"""列出**还没有外链图**的题，以及它们缺的是哪些 sceneKey。
用法：python scripts/_photo-scene/list-missing.py
"""
import io
import json
import os
import re
from collections import OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def rd(p):
    return io.open(os.path.join(ROOT, p), encoding='utf-8').read()


# ---- prompts.ts: id -> (title, keys) ----
ptx = rd('src/domain/prompts.ts')
ptx = ptx[ptx.find('PROMPT_TEMPLATES'):]
heads = list(re.finditer(r"^  '?([a-z0-9-]+)'?:\s*\[\s*$", ptx, re.M))
tpl = OrderedDict()
for i, h in enumerate(heads):
    end = heads[i + 1].start() if i + 1 < len(heads) else len(ptx)
    body = ptx[h.end():end]
    pairs = re.findall(r"title:\s*'((?:[^'\\]|\\.)*)'[\s\S]*?scenes:\s*\[([^\]]*)\]", body)
    tpl[h.group(1)] = [(t, re.findall(r"'([^']+)'", s)) for t, s in pairs]

items = OrderedDict()
for tag, arr in tpl.items():
    for n, (t, keys) in enumerate(arr, 1):
        items['builtin-%s-%d' % (tag, n)] = (tag, t, keys)

ov = json.load(io.open(os.path.join(ROOT, 'src/data/library-items.json'), encoding='utf-8'))

# ---- scenes.tsx: key -> hint ----
stx = rd('src/assets/scenes.tsx')
hint = {}
for m in re.finditer(r"key:\s*'([^']+)',\s*\n\s*label:\s*'([^']*)',\s*\n\s*hint:\s*'((?:[^'\\]|\\.)*)'", stx):
    hint[m.group(1)] = (m.group(2), m.group(3))

full = partial = missing = 0
missing_keys = OrderedDict()
rows = []
for iid, (tag, title, keys) in items.items():
    urls = (ov.get(iid) or {}).get('imageUrls') or []
    have = [k for k, u in zip(keys, urls) if u]
    if len(have) == len(keys):
        full += 1
    elif have:
        partial += 1
        rows.append((iid, tag, title, keys, urls))
    else:
        missing += 1
        rows.append((iid, tag, title, keys, urls))
    for k in keys:
        idx = keys.index(k)
        if idx >= len(urls) or not urls[idx]:
            missing_keys.setdefault(k, []).append(iid)

print('题库 %d 道：整组配齐 %d / 只配了一部分 %d / 一张没有 %d'
      % (len(items), full, partial, missing))
print()
print('=== 缺图的题（%d 道）===' % len(rows))
for iid, tag, title, keys, urls in rows:
    got = sum(1 for u in urls if u)
    print('  %-26s %-10s %-12s  %d/%d 张  %s'
          % (iid, tag, title, got, len(keys), '、'.join(keys)))
print()
print('=== 缺的 sceneKey（%d 个）===' % len(missing_keys))
for k, ids in missing_keys.items():
    lb, h = hint.get(k, ('?', '?'))
    print('  %-22s %-12s 被 %d 道题用' % (k, lb, len(ids)))
    print('      hint: %s' % h[:70])

# 落一份工作清单给下一步
out = os.path.join(ROOT, 'scripts/_photo-scene/missing-keys.json')
json.dump([{'key': k, 'label': hint.get(k, ('?', '?'))[0], 'hint': hint.get(k, ('?', '?'))[1],
            'usedBy': v} for k, v in missing_keys.items()],
          io.open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print()
print('写出 %s（%d 个 key）' % (out, len(missing_keys)))
