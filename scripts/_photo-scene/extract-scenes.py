# -*- coding: utf-8 -*-
"""把 scenes.tsx 的 SCENES 目录抽成一份清单：key / label / hint / 分组 / fits。
输出 scripts/_photo-scene/scene-catalog.json + 一份人能读的列表。
只读源码，只写这份中间产物。
"""
import re, json, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

SRC = open('src/assets/scenes.tsx', encoding='utf-8').read()
m = re.search(r"export const SCENES: SceneMeta\[\] = \[(.*?)\n\]", SRC, re.S)
block = m.group(1)

entries = []
group = ''
pos = 0
for mt in re.finditer(r"/\* -+ ([^-]+?) -+ \*/|\{\s*key: '([^']+)',([\s\S]*?)\n  \},", block):
    if mt.group(1):
        group = mt.group(1).strip()
        continue
    key = mt.group(2)
    body = mt.group(3)
    def field(name):
        f = re.search(r"%s:\s*'((?:[^'\\]|\\.)*)'" % name, body)
        return f.group(1) if f else ''
    fits = re.search(r"fits:\s*\[([^\]]*)\]", body)
    entries.append({
        'key': key,
        'label': field('label'),
        'hint': field('hint'),
        'group': group,
        'fits': re.findall(r"'([^']+)'", fits.group(1)) if fits else [],
    })

print('抽到插画:', len(entries))
by_group = {}
for e in entries:
    by_group.setdefault(e['group'], []).append(e)
for g, items in by_group.items():
    print('  %-8s %d' % (g, len(items)))

json.dump(entries, open('scripts/_photo-scene/scene-catalog.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=2)
print()
print('写好了 scripts/_photo-scene/scene-catalog.json')
print()
for e in entries:
    print('%-24s %-12s %-6s %s' % (e['key'], e['label'], ','.join(e['fits']), e['hint'][:44]))
