# -*- coding: utf-8 -*-
"""生成「改名对照表」——给家长看结果。"""
import io, json, re

TAG_RE = re.compile(r"^  '?([A-Za-z-]+)'?: \[$")
ONE_RE = re.compile(r"^    \{ title: '([^']*)', lead: '([^']*)'")
MT = re.compile(r"^      title: '([^']*)',$")


def parse(p):
    raw = io.open(p, encoding='utf-8', newline='').read()
    d, cur, idx = {}, None, 0
    for line in raw.split('\r\n'):
        m = TAG_RE.match(line)
        if m:
            cur, idx = m.group(1), 0
            continue
        if cur is None:
            continue
        m = ONE_RE.match(line)
        if m:
            idx += 1
            d['builtin-%s-%d' % (cur, idx)] = (cur, m.group(1))
            continue
        m = MT.match(line)
        if m:
            idx += 1
            d['builtin-%s-%d' % (cur, idx)] = (cur, m.group(1))
    return d


old = parse('scripts/_new50/prompts.before-rename.ts')
new = parse('src/data/../domain/prompts.ts')
rows = []
for k in new:
    if old.get(k, (None, None))[1] != new[k][1]:
        rows.append({'id': k, 'tag': new[k][0], 'old': old[k][1], 'new': new[k][1]})
rows.sort(key=lambda r: (r['tag'], int(r['id'].rsplit('-', 1)[1])))
io.open('scripts/_new50/renames.json', 'w', encoding='utf-8').write(
    json.dumps(rows, ensure_ascii=False, indent=1))
print('改动', len(rows), '条')
for r in rows[:5]:
    print('  %-30s %s → %s' % (r['id'], r['old'], r['new']))
