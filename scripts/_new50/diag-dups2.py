# -*- coding: utf-8 -*-
"""重复标题：紧凑清单 + 分「真重复（题面+引导语都一样）」和「同名不同题」。"""
import io, json, re, collections

raw = io.open('src/domain/prompts.ts', encoding='utf-8', newline='').read()
oc = json.load(io.open('src/data/library-items.json', encoding='utf-8'))

TAG_RE = re.compile(r"^  '?([A-Za-z-]+)'?: \[$")
ONE_RE = re.compile(r"^    \{ title: '([^']*)', lead: '([^']*)'")
MT = re.compile(r"^      title: '([^']*)',$")
ML = re.compile(r"^      lead: '([^']*)',$")

draft, cur, pend = {}, None, None
for line in raw.split('\r\n'):
    m = TAG_RE.match(line)
    if m:
        cur = m.group(1); draft[cur] = []; pend = None; continue
    if cur is None: continue
    m = ONE_RE.match(line)
    if m:
        draft[cur].append((m.group(1), m.group(2))); pend = None; continue
    m = MT.match(line)
    if m: pend = m.group(1); continue
    m = ML.match(line)
    if m and pend is not None:
        draft[cur].append((pend, m.group(1))); pend = None

rows = []
for t, items in draft.items():
    for i, (ti, le) in enumerate(items, 1):
        k = 'builtin-%s-%d' % (t, i)
        ov = oc.get(k) or {}
        rows.append({'id': k, 'tag': t, 'title': ov.get('title') or ti,
                     'lead': ov.get('lead') or le, 'baseTitle': ti, 'baseLead': le,
                     'ov': k in oc})

byt = collections.defaultdict(list)
for r in rows:
    byt[r['title']].append(r)
dups = {t: v for t, v in byt.items() if len(v) > 1}

exact, same_title = [], []
for t, v in dups.items():
    leads = {r['lead'] for r in v}
    (exact if len(leads) == 1 else same_title).append((t, v))

print('模板总数 %d / 标题重复组 %d' % (len(rows), len(dups)))
print('  ├ 题面+引导语**完全一样**（真重复）：%d 组' % len(exact))
print('  └ 同名但引导语不同：%d 组' % len(same_title))

print()
print('=== A. 真重复（title + lead 逐字一样）===')
for t, v in sorted(exact, key=lambda x: -len(x[1])):
    print('  「%s」x%d' % (t, len(v)))
    for r in v:
        print('      %-30s tag=%-14s %s' % (r['id'], r['tag'], '有覆盖层' if r['ov'] else ''))

print()
print('=== B. 同名但引导语不同 ===')
for t, v in sorted(same_title):
    print('  「%s」x%d' % (t, len(v)))
    for r in v:
        print('      %-30s tag=%-14s %s' % (r['id'], r['tag'], r['lead'][:34]))
