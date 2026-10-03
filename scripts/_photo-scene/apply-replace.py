# -*- coding: utf-8 -*-
"""把 30 张新图写进覆盖层 `src/data/library-items.json`。

★★ 写盘格式必须跟 App 的 `normalizeLibraryItems()`（vite.config.ts）逐字节同形，
   否则家长第一次点「保存」整个文件会重排一遍 diff。

   做法：先**证明**我的序列化器跟盘上现文件逐字节一样（拿现文件当基准），
   证明过了再改内容 —— 这样改完必然还是同形。
"""
import json, re, io, sys, shutil, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

SRC = 'src/data/library-items.json'
BAK = 'scripts/_photo-scene/library-items.before-replace.json'


def normalize(parsed):
    """照抄 vite.config.ts 的 normalizeLibraryItems"""
    out = {}
    for k in sorted(parsed.keys()):
        v = parsed[k]
        if v is None or not isinstance(v, dict):
            continue
        entry = {'baseTitle': v.get('baseTitle'), 'baseLead': v.get('baseLead')}
        t = v.get('title')
        t = t.strip() if isinstance(t, str) else ''
        if t and t != v.get('baseTitle'):
            entry['title'] = t
        l = v.get('lead')
        l = l.strip() if isinstance(l, str) else ''
        if l and l != v.get('baseLead'):
            entry['lead'] = l
        iu = v.get('imageUrls')
        if isinstance(iu, list) and len(iu) > 0:
            entry['imageUrls'] = [str(u).strip() for u in iu]
        if 'title' not in entry and 'lead' not in entry and 'imageUrls' not in entry:
            continue
        out[k] = entry
    return out


def dump(o):
    return json.dumps(o, ensure_ascii=False, indent=2) + '\n'


raw = open(SRC, encoding='utf-8').read()
parsed = json.loads(raw)
canon = dump(normalize(parsed))

print('现文件字节:', len(raw.encode('utf-8')))
print('规范化后字节:', len(canon.encode('utf-8')))
if canon != raw:
    print('✗ 我的序列化器跟盘上现文件**不是**逐字节一样 —— 停下来，别写！')
    # 找出第一处差异，方便定位
    for i, (a, b) in enumerate(zip(raw, canon)):
        if a != b:
            print('  第一处差异 @', i, repr(raw[max(0, i - 60):i + 60]), '||', repr(canon[max(0, i - 60):i + 60]))
            break
    sys.exit(1)
print('✓ 序列化器与 App 的同形（逐字节一致）—— 可以放心改内容\n')

# ---- 应用 30 条替换 -------------------------------------------------------
merged = json.load(open('scripts/_photo-scene/replace-merged.json', encoding='utf-8'))

# 人工复核后否掉的两张，换成重挑的
OVERRIDE = {
    ('builtin-campus-3', 0): 'https://images.pexels.com/photos/4867978/pexels-photo-4867978.jpeg?auto=compress&cs=tinysrgb&w=640',
    ('builtin-people-around-1', 0): 'https://images.pexels.com/photos/33999099/pexels-photo-33999099.jpeg?auto=compress&cs=tinysrgb&w=640',
}

changed = 0
for it in merged:
    key = (it['id'], it['slot'])
    url = OVERRIDE.get(key, it['mediaUrl'])
    urls = parsed[it['id']]['imageUrls']
    if urls[it['slot']] == url:
        continue
    urls[it['slot']] = url
    changed += 1
print('替换了', changed, '个图位')

shutil.copyfile(SRC, BAK)
print('备份 →', BAK)

out = dump(normalize(parsed))
open(SRC, 'w', encoding='utf-8', newline='').write(out)
print('已写回', SRC, len(out.encode('utf-8')), '字节')

# ---- 写后自查 -------------------------------------------------------------
after = open(SRC, encoding='utf-8').read()
print('幂等自检:', '✓ 再规范化一次还是一样' if dump(normalize(json.loads(after))) == after else '✗ 不是幂等！')

ids = collections.defaultdict(list)
for qid, ov in json.loads(after).items():
    for u in (ov.get('imageUrls') or []):
        m = re.search(r'/photos/(\d+)/', u)
        ids[m.group(1) if m else u].append(qid)
dups = {k: v for k, v in ids.items() if len(v) > 1}
print('图位总数:', sum(len(v.get('imageUrls') or []) for v in json.loads(after).values()))
print('不同 pexels id:', len(ids))
print('★ 还重复的 id:', dups or '无 ✓')
