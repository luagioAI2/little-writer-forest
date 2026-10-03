# -*- coding: utf-8 -*-
"""把 50 道新题的配图写进覆盖层 `src/data/library-items.json`。

★ 序列化必须跟 `vite.config.ts` 的 `normalizeLibraryItems()` **逐字节同形**：
    · 键按 JS 的 `Object.keys().sort()` 升序（我们的键全是 ASCII，跟 Python sorted 一致）
    · 字段顺序固定 `baseTitle, baseLead, title, lead, imageUrls`
    · `JSON.stringify(clean, null, 2)` + 结尾一个 `\n`
  脚本自己会拿"盘上那份原始文件"重序列化一遍做**自证**，对不上就直接退出。
"""
import io
import json
import os
import re
import sys

TARGET = 'src/data/library-items.json'
BEFORE = 'scripts/_new50/library-items.before.json'
DUMP_BEFORE = 'scripts/_tmp-dump.txt'

FIELD_ORDER = ['baseTitle', 'baseLead', 'title', 'lead', 'imageUrls']


def serialize(obj: dict) -> str:
    out = {}
    for k in sorted(obj.keys()):
        e = obj[k]
        row = {}
        for f in FIELD_ORDER:
            if f in e:
                row[f] = e[f]
        out[k] = row
    return json.dumps(out, ensure_ascii=False, indent=2) + '\n'


def read(path: str) -> str:
    with io.open(path, 'r', encoding='utf-8', newline='') as f:
        return f.read()


# ---------- ① 自证：我的序列化器跟盘上那份一致 ----------
original = read(BEFORE)
assert serialize(json.loads(original)) == original, (
    '序列化器跟 normalizeLibraryItems() 不同形 —— 先别写，回头对齐'
)
print('① 序列化器自证通过（重序列化盘上原文逐字节一致）')

existing = json.loads(original)
print(f'   盘上原有 {len(existing)} 条')

# ---------- ② 老题数从开工前的 dump 算，不手抄 ----------
old_len: dict[str, int] = {}
cur = None
for line in io.open(DUMP_BEFORE, encoding='utf-8'):
    m = re.match(r'### (\S+) \(', line)
    if m:
        cur = m.group(1)
        old_len[cur] = 0
        continue
    if cur and re.match(r'  \d+\. \[', line):
        old_len[cur] += 1
assert sum(old_len.values()) == 320, f'开工前不是 320 道，是 {sum(old_len.values())}'
print(f'② 开工前 {len(old_len)} 个标签 / 320 道题')

# ---------- ③ 新题（tag, title, lead）—— 用 worklist.json，别去 exec append.py ----------
#    （exec 会把 50 条**再插一遍**，虽然有还原，但没必要冒这个险）
worklist = json.loads(read('scripts/_new50/worklist.json'))
assert len(worklist) == 50, f'worklist 不是 50 条，是 {len(worklist)}'

# 交叉验证：worklist 里的每条，必须真的是**改后底稿里该标签的最后 N 条**
after: dict[str, list[tuple[str, str]]] = {}
cur_tag = None
for line in io.open('scripts/_tmp-dump-after.txt', encoding='utf-8'):
    m = re.match(r'### (\S+) \(', line)
    if m:
        cur_tag = m.group(1)
        after[cur_tag] = []
        continue
    m = re.match(r'  \d+\. \[[^\]]*\] (.*?) ｜ (.*)$', line.rstrip('\n'))
    if m and cur_tag:
        after[cur_tag].append((m.group(1), m.group(2)))

NEW: dict[str, list[tuple[str, str]]] = {}
for row in worklist:
    NEW.setdefault(row['tag'], []).append((row['title'], row['lead']))

for tag, items in NEW.items():
    got = after[tag][old_len[tag]:]
    assert got == items, f'{tag} 的新题跟底稿对不上：\n  底稿 {got}\n  清单 {items}'
print('③ worklist 与改后的底稿逐条对齐')

# ---------- ④ 配图 ----------
verify = {r['n']: r for r in json.loads(read('scripts/_new50/verify.json'))}
# 补搜的那批（人眼过完第一轮联系表后重新找的）也进同一个 id 索引
fix_cands = json.loads(read('scripts/_new50/fix-verify.json'))
by_id: dict[str, dict] = {}
for r in verify.values():
    for w in ('primary', 'fallback'):
        if r.get(w):
            by_id[r[w]['id']] = r[w]
for c in fix_cands:
    by_id[c['id']] = c
# 个别"撞图/不合意"后单独特意找的（人眼过完联系表、又核过 id 不跟老覆盖层撞）
for c in json.loads(read('scripts/_new50/extra.json')):
    by_id[c['id']] = c

# 人眼过完联系表后定下的：n -> 'primary' / 'fallback' / 'id:12345'
# ⚠️ 环境变量是 JSON，键是**字符串**；下面按 int 取，所以要转一次 ——
#    不转的话 `.get(1)` 永远取不到，12 条改选会静默失效（只会在去重守卫那里露馅）
OVERRIDE: dict[int, str] = {
    int(k): v for k, v in json.loads(os.environ.get('NEW50_OVERRIDE', '{}')).items()
}
print(f'④ 覆盖 {len(OVERRIDE)} 条人眼改选：{OVERRIDE}')

added: dict[str, dict] = {}
order: list[tuple[int, str, str]] = []   # (n, tag, id)
for row in worklist:
    n, tag, title, lead = row['n'], row['tag'], row['title'], row['lead']
    pos = NEW[tag].index((title, lead)) + 1
    r = verify[n]
    assert (r['tag'], r['title']) == (tag, title), f'{n} 对不上：{r["tag"]}/{r["title"]}'

    pick = OVERRIDE.get(n, 'primary')
    if pick.startswith('id:'):
        cand = by_id.get(pick[3:])
        assert cand is not None, f'{title} 找不到 id {pick[3:]}'
    else:
        cand = r[pick]
    assert cand and cand['ok'], f'{title} 的 {pick} 不合格：{cand}'

    new_id = f'builtin-{tag}-{old_len[tag] + pos}'
    assert new_id not in existing, f'{new_id} 已经存在'
    added[new_id] = {
        'baseTitle': title,
        'baseLead': lead,
        'imageUrls': [cand['url']],
    }
    order.append((n, tag, new_id))

assert len(added) == 50, f'只生成了 {len(added)} 条'

# ---------- ④b 配图去重：新图之间、以及跟老覆盖层之间，都不许撞 pexels id ----------
def pexels_id(url: str):
    m = re.search(r'/photos/(\d+)/', url)
    return m.group(1) if m else None


old_ids = set()
for v in existing.values():
    for u in v.get('imageUrls') or []:
        pid = pexels_id(u)
        if pid:
            old_ids.add(pid)

new_ids = [pexels_id(added[k]['imageUrls'][0]) for k in added]
assert all(new_ids), '有配图抠不出 pexels id'
assert len(set(new_ids)) == len(new_ids), (
    f'新配图内部撞图：{sorted(i for i in set(new_ids) if new_ids.count(i) > 1)}'
)
clash = sorted(set(new_ids) & old_ids)
assert not clash, f'新配图跟老覆盖层撞图：{clash}'
print(f'④b 配图去重：新 {len(new_ids)} 张互不相同，跟老覆盖层 {len(old_ids)} 张零重叠')

merged = dict(existing)
merged.update(added)
text = serialize(merged)

# ---------- ⑤ 写盘前再自证一次幂等 ----------
assert serialize(json.loads(text)) == text, '写出来的内容自己都不幂等'
with io.open(TARGET, 'w', encoding='utf-8', newline='') as f:
    f.write(text)

print(f'④ 覆盖层 {len(existing)} → {len(merged)} 条（+{len(added)}）')
print(f'   文件 {len(text.encode("utf-8"))} 字节')
print('⑤ 幂等自证通过')
print('\n新增条目：')
for n, tag, new_id in order:
    print(f'  {n:2d}  {new_id:28s} {added[new_id]["imageUrls"][0]}')
