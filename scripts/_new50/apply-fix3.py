# -*- coding: utf-8 -*-
"""把两张不合格的配图换掉（observe-7 豆子发芽了 / sci-fi-8 会飞的汽车）。

★ 铁律：写完必须跟 `normalizeLibraryItems()` 逐字节同形 —— 否则下次 dev server
  启动会重排整个文件，git 里就变成"全文件重写"，看不出改了什么。
  做法：先自证「盘上原文能被我的序列化器还原」，再动手。
"""
import io, json, re, sys

PATH = 'src/data/library-items.json'
SWAP = {
    # 原 8580767 被这两道题**共用**（重复照片）。8580767 是一整盒排列整齐的彩色铅笔
    # → 留给「我的文具盒」（"打开就像一个小房子"）；同桌那条换成"同学在课桌前翻开铅笔盒"。
    'builtin-classmate-6': '8423074',
}


def url_of(pid: str) -> str:
    return f'https://images.pexels.com/photos/{pid}/pexels-photo-{pid}.jpeg?auto=compress&cs=tinysrgb&w=640'


def serialize(obj) -> str:
    """必须和 vite.config.ts 的 normalizeLibraryItems() 同形。"""
    clean = {}
    for k in sorted(obj.keys()):
        v = obj[k]
        row = {}
        for f in ('baseTitle', 'baseLead', 'title', 'lead', 'imageUrls'):
            if f in v:
                row[f] = v[f]
        clean[k] = row
    return json.dumps(clean, ensure_ascii=False, indent=2) + '\n'


original = io.open(PATH, encoding='utf-8').read()
parsed = json.loads(original)

# ① 序列化器自证
if serialize(parsed) != original:
    sys.exit('✗ 序列化器跟 normalizeLibraryItems() 不同形 —— 先别写，回头对齐')
print('① 序列化器自证通过（重序列化盘上原文逐字节一致）')

# ② 换之前先查重
used = {}
for k, v in parsed.items():
    for u in (v.get('imageUrls') or []):
        m = re.search(r'/photos/(\d+)/', u)
        if m:
            used.setdefault(m.group(1), []).append(k)

for k, pid in SWAP.items():
    if k not in parsed:
        sys.exit(f'✗ 覆盖层里没有 {k}')
    old = (parsed[k].get('imageUrls') or [None])[0]
    m = re.search(r'/photos/(\d+)/', old or '')
    oldpid = m.group(1) if m else None
    print(f'   {k}: {oldpid} → {pid}')
    if pid in used and [x for x in used[pid] if x != k]:
        sys.exit(f'✗ {pid} 已被别的题占用：{used[pid]}')

# ③ 写
for k, pid in SWAP.items():
    parsed[k]['imageUrls'] = [url_of(pid)]

out = serialize(parsed)
io.open(PATH, 'w', encoding='utf-8', newline='').write(out)

# ④ 幂等自证
again = io.open(PATH, encoding='utf-8').read()
assert serialize(json.loads(again)) == again, '✗ 写完不自洽'
print('② 幂等自证通过')
print(f'③ 文件 {len(again.encode("utf-8"))} 字节，覆盖层 {len(parsed)} 条')
