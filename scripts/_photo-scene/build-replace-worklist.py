# -*- coding: utf-8 -*-
"""重挑照片的工单。

重复的根源：覆盖层是「按 sceneKey 配图」那轮生成的 —— 同一个 sceneKey 的题
拿到了同一张照片。现在 sceneKey 删了，但覆盖层没跟着重新派生，重复就留在盘上。

本脚本：
  ① 按 pexels id 分组，找出被 ≥2 个图位共用的照片
  ② 每组留一个图位（第一个），其余的列进工单
  ③ 每条工单带上「原 sceneKey」+ 该插画的 hint —— 关键词要从这里出，不是从标题出
"""
import re, json, io, sys, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

SRC = 'src/data/library-items.json'
BAK = 'scripts/_photo-scene/prompts.before-270.ts'
CAT = 'scripts/_photo-scene/scene-catalog.json'

overlay = json.load(open(SRC, encoding='utf-8'))
cat = {e['key']: e for e in json.load(open(CAT, encoding='utf-8'))}


def parse(path):
    t = open(path, encoding='utf-8').read()
    s = t.index('export const PROMPT_TEMPLATES')
    e = re.search(r"\n\}\n", t[s:]).end() + s
    block = t[s:e]
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


before = parse(BAK)
# id → (title, lead, [旧 sceneKey])
byid = {}
for tag, rows in before.items():
    for i, (title, lead, sc) in enumerate(rows):
        keys = re.findall(r"'([^']*)'", sc)
        byid['builtin-%s-%d' % (tag, i + 1)] = (title, lead, keys)

# 槽位 → (id, k, url, 旧 sceneKey)
slots = []
for qid, ov in overlay.items():
    urls = ov.get('imageUrls') or []
    t, l, keys = byid.get(qid, ('?', '?', []))
    for k, u in enumerate(urls):
        slots.append((qid, k, u, keys[k] if k < len(keys) else ''))

def pid(u):
    m = re.search(r'/photos/(\d+)/', u or '')
    return m.group(1) if m else u

groups = collections.defaultdict(list)
for s in slots:
    groups[pid(s[2])].append(s)

dups = {p: g for p, g in groups.items() if len(g) > 1}
print('照片槽位:', len(slots), ' 不同 pexels id:', len(groups), ' 重复 id:', len(dups))
print('受影响槽位:', sum(len(g) for g in dups.values()),
      ' → 要重挑:', sum(len(g) - 1 for g in dups.values()))
print()

worklist = []
for p, g in sorted(dups.items()):
    keep = g[0]
    print('── id %s  ×%d' % (p, len(g)))
    for qid, k, u, key in g:
        t, l, _ = byid.get(qid, ('?', '?', []))
        mark = '留' if (qid, k) == (keep[0], keep[1]) else '★换'
        hint = cat.get(key, {}).get('hint', '')
        print('   %s %-22s 第%d张  旧key=%-16s 《%s》' % (mark, qid, k + 1, key or '(无)', t))
        if mark == '★换':
            worklist.append({
                'id': qid, 'slot': k, 'dupOf': p,
                'title': t, 'lead': l,
                'oldSceneKey': key,
                'sceneLabel': cat.get(key, {}).get('label', ''),
                'hint': hint,
            })
    print()

print('★ 工单条数:', len(worklist))
print('★ 涉及题目数:', len({w['id'] for w in worklist}))
json.dump(worklist, open('scripts/_photo-scene/replace-worklist.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=2)
print('→ scripts/_photo-scene/replace-worklist.json')
