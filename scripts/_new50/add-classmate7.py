# -*- coding: utf-8 -*-
"""给 `builtin-classmate-7 一起值日` 补图（覆盖层 243 → 244 条）。

★ baseTitle / baseLead **从代码底稿现读**，不手抄 —— 手抄一个标点错了，
  锚点就对不上，`checkLibraryOverrides()` 会报「可能被挪位了」。
"""
import io, json, re, sys

PATH = 'src/data/library-items.json'
TARGET = 'builtin-classmate-7'
PID = '36041981'


def serialize(obj):
    clean = {}
    for k in sorted(obj.keys()):
        v = obj[k]
        clean[k] = {f: v[f] for f in ('baseTitle', 'baseLead', 'title', 'lead', 'imageUrls') if f in v}
    return json.dumps(clean, ensure_ascii=False, indent=2) + '\n'


# ── 从底稿取锚点 ──
raw = io.open('src/domain/prompts.ts', encoding='utf-8', newline='').read()
TAG_RE = re.compile(r"^  '?([A-Za-z-]+)'?: \[$")
ONE_RE = re.compile(r"^    \{ title: '([^']*)', lead: '([^']*)'")
MT = re.compile(r"^      title: '([^']*)',$")
ML = re.compile(r"^      lead: '([^']*)',$")
cur, idx, pend, anchor = None, 0, None, None
for line in raw.split('\r\n'):
    m = TAG_RE.match(line)
    if m:
        cur, idx, pend = m.group(1), 0, None
        continue
    if cur is None:
        continue
    m = ONE_RE.match(line)
    if m:
        idx += 1
        if 'builtin-%s-%d' % (cur, idx) == TARGET:
            anchor = (m.group(1), m.group(2))
        continue
    m = MT.match(line)
    if m:
        idx += 1
        pend = m.group(1)
        continue
    m = ML.match(line)
    if m and pend is not None:
        if 'builtin-%s-%d' % (cur, idx) == TARGET:
            anchor = (pend, m.group(1))
        pend = None

assert anchor, '底稿里没找到 %s' % TARGET
print('底稿锚点：%s | %s' % anchor)

original = io.open(PATH, encoding='utf-8').read()
parsed = json.loads(original)
assert serialize(parsed) == original, '✗ 序列化器跟 normalizeLibraryItems() 不同形'
print('① 序列化器自证通过（%d 条）' % len(parsed))

assert TARGET not in parsed, '%s 已经在覆盖层里了 —— 这不是新增，改用换图脚本' % TARGET

# 照片去重
for k, v in parsed.items():
    for u in (v.get('imageUrls') or []):
        m = re.search(r'/photos/(\d+)/', u)
        if m and m.group(1) == PID:
            sys.exit('✗ %s 已被 %s 占用' % (PID, k))

parsed[TARGET] = {
    'baseTitle': anchor[0],
    'baseLead': anchor[1],
    'imageUrls': ['https://images.pexels.com/photos/%s/pexels-photo-%s.jpeg?auto=compress&cs=tinysrgb&w=640' % (PID, PID)],
}
out = serialize(parsed)
io.open(PATH, 'w', encoding='utf-8', newline='').write(out)
again = io.open(PATH, encoding='utf-8').read()
assert serialize(json.loads(again)) == again, '✗ 写完不自洽'
print('② 幂等自证通过')
print('③ 覆盖层 %d → %d 条，文件 %d 字节' % (len(parsed) - 1, len(parsed), len(again.encode('utf-8'))))
