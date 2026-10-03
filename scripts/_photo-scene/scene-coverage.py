# -*- coding: utf-8 -*-
"""① prompts.ts 用到的 sceneKey 是不是每一个都能在 SCENES 目录里找到插图。
   ② 覆盖层里有没有空串 / 非法 URL（决定"清空地址能不能退回插画"）。
只读。
"""
import re, json, io, sys, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

SRC = open('src/domain/prompts.ts', encoding='utf-8').read()
SCN = open('src/assets/scenes.tsx', encoding='utf-8').read()

used = set()
for m in re.finditer(r"scenes:\s*\[([^\]]*)\]", SRC):
    used.update(re.findall(r"'([^']+)'", m.group(1)))
print('prompts.ts 用到的 sceneKey:', len(used))

m = re.search(r"export const SCENES: SceneMeta\[\] = \[([\s\S]*?)\n\]", SCN)
keys = set(re.findall(r"key:\s*'([^']+)'", m.group(1)))
print('scenes.tsx SCENES 目录:', len(keys))
print('  ✗ 用了但目录里没有:', sorted(used - keys) or '无（每个 sceneKey 都有插图）')
print('  · 目录里有但没题用:', len(keys - used))

# SCENE_MAP 是不是也齐（渲染走的是 SCENE_MAP，不是 SCENES）
mm = re.search(r"const SCENE_MAP[\s\S]{0,400}", SCN)
print()
print('SCENE_MAP 定义片段:')
print(mm.group(0)[:400])

# ---- 覆盖层里的空串 / 非 https -------------------------------------------
data = json.loads(open('src/data/library-items.json', encoding='utf-8').read())
empty, bad, nonstr = [], [], []
for iid, ov in data.items():
    us = ov.get('imageUrls')
    if us is None:
        continue
    for k, u in enumerate(us):
        if not isinstance(u, str):
            nonstr.append((iid, k, u))
        elif u == '':
            empty.append((iid, k))
        elif not u.startswith('https://'):
            bad.append((iid, k, u))
print()
print('imageUrls 里的空串:', len(empty), empty[:5])
print('imageUrls 里的非字符串:', len(nonstr), nonstr[:5])
print('imageUrls 里非 https:', len(bad), bad[:5])

# 有没有"整条 imageUrls 全空"的条目
allempty = [i for i, ov in data.items() if ov.get('imageUrls') and not any(ov['imageUrls'])]
print('整条 imageUrls 全空的条目:', len(allempty), allempty[:5])
