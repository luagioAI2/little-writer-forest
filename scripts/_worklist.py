"""一次性：把「需要找几张图、每张图对应哪些题」算出来（按 sceneKey 去重）。用完即删。"""
import io
import json
import re

inv = json.load(io.open('scripts/_inventory.json', encoding='utf-8'))
src = io.open('src/assets/scenes.tsx', encoding='utf-8').read()

hints = {}
for m in re.finditer(
    r"key: '([^']+)',\s*\n\s*label: '([^']*)',\s*\n\s*hint: '([^']*)'", src
):
    hints[m.group(1)] = m.group(3)

# sceneKey -> [题 id]
single = {}   # 单图题用到的 key
multi = {}    # 连环图用到的 key
multi_groups = []  # [(题 id, [keys])]
for t in inv:
    for it in t['items']:
        ks = it['scenes']
        if len(ks) > 1:
            multi_groups.append((it['id'], it['title'], ks))
            for k in ks:
                multi.setdefault(k, []).append(it['id'])
        else:
            single.setdefault(ks[0], []).append(it['id'])

# 只看「还没配图的题」用到的 key
uncov_ids = {it['id'] for t in inv if not t['covered'] for it in t['items']}

print('=== A. 未配图的单图题：去重后要几张图 ===')
need_single = {}
for k, users in single.items():
    u = [x for x in users if x in uncov_ids]
    if u:
        need_single[k] = u
print(f'需要 {len(need_single)} 张图，覆盖 {sum(len(v) for v in need_single.values())} 道题')
for k, u in need_single.items():
    print(f'  * {k}  ← {len(u)} 道: {", ".join(u)}')
    print(f'      {hints.get(k, "(无 hint)")}')

print()
print('=== B. 连环图（整组换，共 %d 道）===' % len(multi_groups))
keys_multi = set()
for qid, title, ks in multi_groups:
    keys_multi.update(ks)
print(f'涉及 {len(keys_multi)} 个 key：')
for k in sorted(keys_multi):
    print(f'  * {k}  ← {", ".join(multi.get(k, []))}')
    print(f'      {hints.get(k, "(无 hint)")}')

print()
print('=== 汇总 ===')
print(f'单图题需要 {len(need_single)} 张')
print(f'连环图涉及 {len(keys_multi)} 个 key（{len(multi_groups)} 道题）')
print(f'合计要找 {len(need_single | set())} + {len(keys_multi)} = {len(need_single) + len(keys_multi)} 张图（可能有重叠）')
overlap = set(need_single) & keys_multi
if overlap:
    print('单图/连环图共用同一 key 的：', sorted(overlap))
