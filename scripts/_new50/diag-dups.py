# -*- coding: utf-8 -*-
"""诊断：标题重复到底在代码底稿里，还是在覆盖层里。"""
import io, json, re, collections

raw = io.open('src/domain/prompts.ts', encoding='utf-8', newline='').read()
oc = json.load(io.open('src/data/library-items.json', encoding='utf-8'))

# ── 解析代码底稿：tag → [(序号, title, lead)]，按文件顺序 ──
# ⚠️ 条目有两种写法：单行 `{ title: '…', lead: '…', scenes: [...] },`
#    和多行（title / lead / scenes 各占一行，多图条目用的）。
TAG_RE = re.compile(r"^  '?([A-Za-z-]+)'?: \[$")
ONE_RE = re.compile(r"^    \{ title: '([^']*)', lead: '([^']*)'")
MULTI_TITLE_RE = re.compile(r"^      title: '([^']*)',$")
MULTI_LEAD_RE = re.compile(r"^      lead: '([^']*)',$")
draft = {}
cur = None
pending = None  # 多行条目里已读到的 title
for line in raw.split('\r\n'):
    m = TAG_RE.match(line)
    if m:
        cur = m.group(1)
        draft[cur] = []
        pending = None
        continue
    if cur is None:
        continue
    m = ONE_RE.match(line)
    if m:
        draft[cur].append((len(draft[cur]) + 1, m.group(1), m.group(2)))
        pending = None
        continue
    m = MULTI_TITLE_RE.match(line)
    if m:
        pending = m.group(1)
        continue
    m = MULTI_LEAD_RE.match(line)
    if m and pending is not None:
        draft[cur].append((len(draft[cur]) + 1, pending, m.group(1)))
        pending = None

total = sum(len(v) for v in draft.values())
print('解析到标签 %d 个 / 模板 %d 条' % (len(draft), total))
assert total == 370, '解析数量不对，先别信下面的结论'

base = {}
for t, items in draft.items():
    for i, ti, le in items:
        base['builtin-%s-%d' % (t, i)] = (ti, le, t)

# ── ① 代码底稿内部的标题重复（全 370）──
by_title = collections.defaultdict(list)
for k, (ti, le, t) in base.items():
    by_title[ti].append(k)
dups = {ti: ids for ti, ids in by_title.items() if len(ids) > 1}
print()
print('=== ① 代码底稿(370)内部标题重复：%d 组 ===' % len(dups))
for ti, ids in sorted(dups.items(), key=lambda x: -len(x[1])):
    print()
    print('  「%s」x%d' % (ti, len(ids)))
    for k in sorted(ids):
        ti2, le, t = base[k]
        ov = oc.get(k)
        print('     %-30s tag=%-14s lead=%s' % (k, t, le))
        if ov:
            print('        ↳ 在覆盖层：title=%s baseTitle=%s imageUrls=%d' % (
                repr(ov.get('title')), repr(ov.get('baseTitle')), len(ov.get('imageUrls') or [])))
        else:
            print('        ↳ 不在覆盖层')

# ── ② 覆盖层里的 title 改动造成的重复（只跟覆盖层比）──
print()
print('=== ② 只看覆盖层 243 条的标题重复 ===')
g = collections.defaultdict(list)
for k, v in oc.items():
    g[v.get('title') or v.get('baseTitle')].append(k)
d2 = {t: ids for t, ids in g.items() if len(ids) > 1}
print('  %d 组' % len(d2))
for t, ids in sorted(d2.items()):
    print('   x%d %s -> %s' % (len(ids), t, sorted(ids)))

# ── ③ 照片编号重复 ──
print()
print('=== ③ 照片编号重复 ===')
ph = collections.defaultdict(list)
for k, v in oc.items():
    for u in (v.get('imageUrls') or []):
        m = re.search(r'/photos/(\d+)/', u)
        if m:
            ph[m.group(1)].append(k)
for p, ids in ph.items():
    if len(ids) > 1:
        print('   %s -> %s' % (p, ids))
        for k in ids:
            print('      %-26s baseTitle=%s' % (k, oc[k].get('baseTitle')))

# ── ④ 标题 + 引导语**完全一样**的（真·重复题）──
print()
print('=== ④ title+lead 完全一致的（真重复）===')
by2 = collections.defaultdict(list)
for k, (ti, le, t) in base.items():
    ov = oc.get(k) or {}
    by2[(ov.get('title') or ti, ov.get('lead') or le)].append(k)
for (ti, le), ids in by2.items():
    if len(ids) > 1:
        print('   「%s」/「%s」 -> %s' % (ti, le, sorted(ids)))
