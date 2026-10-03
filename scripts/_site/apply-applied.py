# -*- coding: utf-8 -*-
"""把新增标签 applied-writing（应用文 8 道）的配图写进覆盖层 `src/data/library-items.json`。

与 apply-exam.py 同一套规矩：
★ 序列化必须跟 `vite.config.ts` 的 `normalizeLibraryItems()` **逐字节同形**：
    键按 JS `Object.keys().sort()` 升序 · 字段顺序 `baseTitle, baseLead, title, lead, imageUrls`
    · `JSON.stringify(clean, null, 2)` + 结尾一个 `\n`
  先拿"开工前那份原始文件"重序列化一遍做**自证**，对不上直接退出。
★ 锚点从 `base-items.json`（走真代码 dump）现读，按 `(tag, title)` 定位，**不手抄**。
★ 去重守卫：新图之间、新图 vs 老覆盖层，都不许撞 pexels 编号。

用法: python scripts/_site/apply-applied.py [--write]
"""
import io, json, os, re, sys

BASE = 'scripts/_site'
TARGET = 'src/data/library-items.json'
BEFORE = f'{BASE}/library-items.before-applied.json'
BASEDUMP = f'{BASE}/base-items.json'
ASSIGN = f'{BASE}/photo-applied.json'
OVERRIDES_FILE = f'{BASE}/photo-url-overrides.json'
NEW_TAGS = ['applied-writing']
EXPECT = 8
FIELD_ORDER = ['baseTitle', 'baseLead', 'title', 'lead', 'imageUrls']

# ★ 少数老照片 CDN 文件名带 slug，标准路径 404 —— 逐条查覆盖表
_OVERRIDES = json.load(io.open(OVERRIDES_FILE, encoding='utf-8')) if os.path.exists(OVERRIDES_FILE) else {}


def photo_url(pid):
    base = _OVERRIDES.get(str(pid))
    if base is None:
        base = f'https://images.pexels.com/photos/{pid}/pexels-photo-{pid}.jpeg'
    return f'{base}?auto=compress&cs=tinysrgb&w=640'


def serialize(obj):
    out = {}
    for k in sorted(obj.keys()):
        e = obj[k]
        row = {}
        for f in FIELD_ORDER:
            if f in e:
                row[f] = e[f]
        out[k] = row
    return json.dumps(out, ensure_ascii=False, indent=2) + '\n'


def read(p):
    return io.open(p, encoding='utf-8', newline='').read()


# ---------- ① 序列化器自证 ----------
original = read(BEFORE)
assert serialize(json.loads(original)) == original, '序列化器跟 normalizeLibraryItems() 不同形'
existing = json.loads(original)
print(f'① 序列化器自证通过；盘上原有 {len(existing)} 条')

# ---------- ② 从真代码 dump 的底稿里取新标签的题（按顺序定 id） ----------
base = json.loads(read(BASEDUMP))
new_items = []          # (id, tag, title, lead)
for tag in NEW_TAGS:
    rows = [it for it in base if it['tagId'] == tag]
    assert rows, f'底稿里没有标签 {tag}'
    for i, it in enumerate(rows, 1):
        new_items.append((f'builtin-{tag}-{i}', tag, it['title'], it['lead']))
print(f'② 新标签 {NEW_TAGS} 共 {len(new_items)} 道')
assert len(new_items) == EXPECT, f'新题不是 {EXPECT} 道，是 {len(new_items)}'

by_key = {(t, title): (i, lead) for i, t, title, lead in new_items}

# ---------- ③ 配图分配 ----------
ass = json.loads(read(ASSIGN))
added = {}
for tag, items in ass.items():
    if tag.startswith('_'):
        continue
    assert tag in NEW_TAGS, f'分配表里有不认识的标签 {tag}'
    for title, pid in items.items():
        assert (tag, title) in by_key, f'{tag} / {title} 在底稿里找不到（标题改过？）'
        item_id, lead = by_key[(tag, title)]
        assert item_id not in existing, f'{item_id} 已存在'
        assert item_id not in added, f'{item_id} 重复'
        added[item_id] = {
            'baseTitle': title,
            'baseLead': lead,
            'imageUrls': [photo_url(pid)],
        }
missing = [i for i, t, _, _ in new_items if i not in added]
assert not missing, f'这些新题没有配图：{missing}'
print(f'③ 配图分配 {len(added)}/{len(new_items)} 条')


# ---------- ④ 去重守卫 ----------
def pexels_id(u):
    m = re.search(r'/photos/(\d+)/', u)
    return m.group(1) if m else None


old_ids = set()
for v in existing.values():
    for u in v.get('imageUrls') or []:
        p = pexels_id(u)
        if p:
            old_ids.add(p)
# 老覆盖层之外，底稿里可能也有外链图 —— 一起算进"已用"
for it in base:
    for u in it.get('imageUrls') or []:
        p = pexels_id(u)
        if p:
            old_ids.add(p)
new_ids = [pexels_id(added[k]['imageUrls'][0]) for k in added]
assert all(new_ids), '有配图抠不出 pexels 编号'
assert len(set(new_ids)) == len(new_ids), \
    f'新配图内部撞图：{sorted(i for i in set(new_ids) if new_ids.count(i) > 1)}'
clash = sorted(set(new_ids) & old_ids)
assert not clash, f'新配图跟已用图撞图：{clash}'
print(f'④ 配图去重：新 {len(new_ids)} 张互不相同，跟已用 {len(old_ids)} 张零重叠')

merged = dict(existing)
merged.update(added)
text = serialize(merged)
assert serialize(json.loads(text)) == text, '写出来的内容自己都不幂等'

if '--write' not in sys.argv:
    print('干跑完成；加 --write 才写盘')
    sys.exit(0)

io.open(TARGET, 'w', encoding='utf-8', newline='').write(text)
print(f'⑤ 覆盖层 {len(existing)} → {len(merged)} 条（+{len(added)}）；{len(text.encode("utf-8"))} 字节')
print('   幂等自证通过')
