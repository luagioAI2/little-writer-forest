"""一次性：把子代理找回来的 66 张图落成 src/data/library-items.json 的覆盖层。

规则（都是踩过坑的）：
  · 单图题 → imageUrls 一个
  · 连环图 → **整组换**，槽位数必须一模一样（覆盖层只能从第一张起连着换）
  · 只写 baseTitle / baseLead / imageUrls 三个键，键序跟落盘端点一致
  · 排序、缩进、结尾换行都跟 normalizeLibraryItems() 同形 → 家长第一次点保存不会整份重排
"""
import glob
import io
import json
import os
from collections import OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
D = os.path.join(ROOT, 'scripts/_photo-scene')
DATA = os.path.join(ROOT, 'src/data/library-items.json')

PEXELS = 'https://images.pexels.com/photos/{}/pexels-photo-{}.jpeg?auto=compress&cs=tinysrgb&w=640'

# ---- 主代理复核后手工替换的两处（子代理那两张：一张有孩子正脸、一张是空相框）----
FIX = {
    'cook-mess': {
        'pexelsId': 6287260,
        'link': 'https://www.pexels.com/photo/dough-on-table-with-flour-6287260/',
        'author': 'Klaus Nielsen',
        'note': '主代理替换：原子代理那张有孩子正脸，违反「不画人脸」约定',
    },
    'look-picture-series': {
        'pexelsId': 139764,
        'link': 'https://www.pexels.com/photo/four-paintings-on-wall-139764/',
        'author': 'punttim',
        'note': '主代理替换：原子代理那张是空白相框，对不上「并排挂着几幅小图」',
    },
}

inv = json.load(io.open(os.path.join(ROOT, 'scripts/_inventory.json'), encoding='utf-8'))

# key -> 中选条目
picks = {}
for f in sorted(glob.glob(os.path.join(D, 'out-*.json'))):
    for it in json.load(io.open(f, encoding='utf-8'))['items']:
        picks[it['key']] = it
for k, fx in FIX.items():
    if k not in picks:
        raise SystemExit('FIX 的 key 不在子代理产出里：' + k)
    pid = fx['pexelsId']
    picks[k] = dict(picks[k], pexelsId=pid, mediaUrl=PEXELS.format(pid, pid),
                    credit={'link': fx['link'], 'author': fx['author']},
                    note=fx['note'], verdict='ok')

# 原覆盖层（上一轮那 31 条）
overlay = json.load(io.open(DATA, encoding='utf-8'))
before = len(overlay)

added_single = added_multi = 0
skipped_no_pick = []
all_ids = []
for t in inv:
    for it in t['items']:
        all_ids.append(it['id'])
        keys = it['scenes']
        if not all(k in picks for k in keys):
            missing = [k for k in keys if k not in picks]
            skipped_no_pick.append((it['id'], missing))
            continue
        urls = [picks[k]['mediaUrl'] for k in keys]
        entry = OrderedDict()
        entry['baseTitle'] = it['title']
        entry['baseLead'] = it['lead']
        entry['imageUrls'] = urls
        if it['id'] in overlay:
            # 已经有图的（上一轮配过）不动
            continue
        overlay[it['id']] = entry
        if len(urls) > 1:
            added_multi += 1
        else:
            added_single += 1

# ---- 规范化输出（跟 normalizeLibraryItems() 同形）----
ALLOWED = ['baseTitle', 'baseLead', 'title', 'lead', 'imageUrls']
clean = OrderedDict()
for k in sorted(overlay):
    o = overlay[k]
    e = OrderedDict()
    for key in ALLOWED:
        if key not in o:
            continue
        if key == 'title' and o.get('title') == o.get('baseTitle'):
            continue
        if key == 'lead' and o.get('lead') == o.get('baseLead'):
            continue
        e[key] = o[key]
    if 'title' not in e and 'lead' not in e and 'imageUrls' not in e:
        continue
    clean[k] = e

text = json.dumps(clean, ensure_ascii=False, indent=2) + '\n'
io.open(DATA, 'w', encoding='utf-8', newline='\n').write(text)

# ---- 断言：写出去的字节 == 再规范化一次的结果（逐字节同形）----
raw = io.open(DATA, 'rb').read()
again = json.dumps(json.loads(raw.decode('utf-8')), ensure_ascii=False, indent=2) + '\n'
same = again.encode('utf-8') == raw

configured = len(clean)
total = len(all_ids)
print(f'覆盖层：{before} → {configured} 条（新增单图 {added_single}、新增连环图 {added_multi}）')
print(f'题库总数 {total}，已配图 {configured}，还没配 {total - configured}')
print(f'逐字节同形（canon === raw）：{same}')
if not same:
    raise SystemExit('❌ 输出跟落盘端点的规范形不同形')
if skipped_no_pick:
    print(f'\n没配上图的题 {len(skipped_no_pick)} 道（缺这些 key）：')
    for qid, miss in skipped_no_pick:
        print('  ', qid, '缺', ','.join(miss))
