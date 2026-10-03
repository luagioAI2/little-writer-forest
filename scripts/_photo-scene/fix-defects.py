# -*- coding: utf-8 -*-
"""一次性：修家长点名的两处 + 同一类的两处。

  ① grandma-knit  奶奶织毛衣   39326745（只有毛线，没人）→ 5585242（奶奶戴着老花镜在织）
  ② librarian     图书管理员   9572664（只有书架，没人）  → 6344226（抱着书的人）
  ③ bus-driver    公交司机     → 39639904（笑眯眯的司机，对得上「司机叔叔总是笑眯眯的」）
  ④ builtin-weather-2 雨后的彩虹：把**彩虹那张挪到第 0 张** —— 卡片缩略图取的是 images[0]，
     原来第 0 张是「下雨的窗户」，所以卡片上永远看不到彩虹。

为什么④要**同时**改覆盖层的 imageUrls 和 prompts.ts 的 scenes 顺序：
  · 卡片缩略图取的是 images[0]，原来第 0 张是「下雨的窗户」→ 卡片上永远看不到彩虹
  · 但覆盖层只能按下标换 imageUrl，**sceneKey 是原样留着的**（见 libraryItems.ts:88-96）
    → 只翻 imageUrls 的话，第 0 张会变成「sceneKey=rain-window 却是一张彩虹照片」
  · 而 sceneKey 不是死字段：`scenes.tsx:6680` 拿它当图片的 **alt**，
    `imageHints.ts:48` 拿它拼发给 AI 的画面描述 —— 对不上就是悄悄错
  · 所以两处一起翻，让「第 1 幅 = 彩虹」在 imageUrl / sceneKey / caption / alt 上全部自洽
  · 顺序翻转也**不违背原文**：lead 开头就是「雨停了」，第 1 幅给彩虹才是当下正在发生的事
  · 安全：scenes 顺序不影响 id（id 只看模板在数组里的下标），
    `allTemplateScenes()` 是 Set 与顺序无关，测试也只钉 caption 的**形状**不钉帧数

用法：python scripts/_photo-scene/fix-defects.py
"""
import io
import json
import os
import re
from collections import OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
D = os.path.join(ROOT, 'scripts', '_photo-scene')
DATA = os.path.join(ROOT, 'src', 'data', 'library-items.json')
P_PROMPTS = os.path.join(ROOT, 'src', 'domain', 'prompts.ts')

PEXELS = 'https://images.pexels.com/photos/{}/pexels-photo-{}.jpeg?auto=compress&cs=tinysrgb&w=640'

# key -> (新编号, 说明)
REPLACE = {
    'grandma-knit': (5585242, '原图只有毛线和棒针，一个人都没有（家长点名）'),
    'librarian':    (6344226, '原图只有书架，一个人都没有（同一类缺陷）'),
    'bus-driver':   (39639904, '原图是空车厢，没有司机（同一类缺陷）'),
    'rain-delivery': (25048304, '原图有快递员但**没在下雨**，而题目是「雨很大」（同一类缺陷）'),
    'cactus':       (2132753, '原图有刺但**没开花**，而题目是「却开出了小花」（同一类缺陷）'),
}
# 要翻转配图顺序的题（让彩虹出现在第 0 张 = 卡片缩略图）
FLIP_SLOT0 = {'builtin-weather-2': (1, 0)}   # 新第0张取旧第1张
# ★ 翻转必须幂等：再跑一次不能把它翻回去。判据 = 彩虹那张已经在第 0 位。
FLIP_MARK = {'builtin-weather-2': '12346066'}


def rd(p):
    return io.open(p, encoding='utf-8').read()


# ---------- id -> scenes（跟 audit-person.py 同一套解析） ----------
ptx = rd(P_PROMPTS)
ptx = ptx[ptx.find('PROMPT_TEMPLATES'):]
templates = {}
heads = list(re.finditer(r"^  '?([a-z0-9-]+)'?:\s*\[\s*$", ptx, re.M))
for idx, h in enumerate(heads):
    end = heads[idx + 1].start() if idx + 1 < len(heads) else len(ptx)
    body = ptx[h.end():end]
    pairs = re.findall(r"title:\s*'((?:[^'\\]|\\.)*)'[\s\S]*?scenes:\s*\[([^\]]*)\]", body)
    templates[h.group(1)] = [(t, re.findall(r"'([^']+)'", s)) for t, s in pairs]

id2scenes = {}
for tag, arr in templates.items():
    for n, (_t, keys) in enumerate(arr, start=1):
        id2scenes['builtin-%s-%d' % (tag, n)] = keys

overlay = json.load(io.open(DATA, encoding='utf-8'))
before = len(overlay)

# ---------- ① ② ③ 换图：所有用到这个 key 的题一起换（保持「同 key 同图」不变式） ----------
log = []
for key, (pid, why) in REPLACE.items():
    url = PEXELS.format(pid, pid)
    hits = [(i, keys.index(key)) for i, keys in id2scenes.items() if key in keys]
    if not hits:
        raise SystemExit('❌ 没有任何题的 scenes 里用到 ' + key)
    for iid, slot in hits:
        ov = overlay.get(iid)
        if not ov or 'imageUrls' not in ov:
            raise SystemExit('❌ %s 没配过图，换不了 %s' % (iid, key))
        old = ov['imageUrls'][slot]
        ov['imageUrls'][slot] = url
        log.append('  %-22s 第%d张  %s → %s' % (iid, slot, old.split('/photos/')[1].split('/')[0], pid))
    log.append('  （%s：%s）' % (key, why))

# ---------- ④ 彩虹挪到第 0 张（幂等：已经在第 0 位就跳过） ----------
for iid, (src, dst) in FLIP_SLOT0.items():
    ov = overlay[iid]
    urls = ov['imageUrls']
    if len(urls) < 2:
        raise SystemExit('❌ %s 只有 %d 张图，没法翻转' % (iid, len(urls)))
    if FLIP_MARK[iid] in urls[dst]:
        log.append('  %-22s 配图顺序**已经是**目标顺序，跳过（幂等）' % iid)
        continue
    a, b = urls[src].split('/photos/')[1].split('/')[0], urls[dst].split('/photos/')[1].split('/')[0]
    urls[dst], urls[src] = urls[src], urls[dst]
    log.append('  %-22s 配图顺序翻转：第0张 %s → %s（彩虹上卡片）' % (iid, b, a))

# ---------- 规范化落盘（跟 normalizeLibraryItems() 同形） ----------
ALLOWED = ['baseTitle', 'baseLead', 'title', 'lead', 'imageUrls']
clean = OrderedDict()
for k in sorted(overlay):
    o = overlay[k]
    e = OrderedDict()
    for kk in ALLOWED:
        if kk not in o:
            continue
        if kk == 'title' and o.get('title') == o.get('baseTitle'):
            continue
        if kk == 'lead' and o.get('lead') == o.get('baseLead'):
            continue
        e[kk] = o[kk]
    if 'title' not in e and 'lead' not in e and 'imageUrls' not in e:
        continue
    clean[k] = e

text = json.dumps(clean, ensure_ascii=False, indent=2) + '\n'
io.open(DATA, 'w', encoding='utf-8', newline='\n').write(text)

raw = io.open(DATA, 'rb').read()
again = json.dumps(json.loads(raw.decode('utf-8')), ensure_ascii=False, indent=2) + '\n'
same = again.encode('utf-8') == raw

print('改动：')
for line in log:
    print(line)
print()
print('覆盖层 %d → %d 条' % (before, len(clean)))
print('逐字节同形（canon === raw）：%s' % same)
if not same:
    raise SystemExit('❌ 输出跟落盘端点的规范形不同形')

# ---------- 断言：三张新图真的在里面，彩虹真的在第 0 张 ----------
check = json.loads(io.open(DATA, encoding='utf-8').read())
for key, (pid, _w) in REPLACE.items():
    want = PEXELS.format(pid, pid)
    got = [i for i, keys in id2scenes.items() if key in keys
           and want in check.get(i, {}).get('imageUrls', [])]
    if not got:
        raise SystemExit('❌ %s 的新图（%d）没写进去' % (key, pid))
for iid, (src, _dst) in FLIP_SLOT0.items():
    keys = id2scenes[iid]
    urls = check[iid]['imageUrls']
    # 彩虹那张的编号必须落在第 0 位
    if '12346066' not in urls[0]:
        raise SystemExit('❌ %s 的第 0 张不是彩虹：%s' % (iid, urls[0]))
print('✓ %d 张新图都在文件里，%s 的第 0 张已经是彩虹（彩虹=%s / 雨窗=%s）'
      % (len(REPLACE), '、'.join(FLIP_SLOT0), urls[0].split('/photos/')[1].split('/')[0],
         urls[1].split('/photos/')[1].split('/')[0]))
