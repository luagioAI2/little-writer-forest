# -*- coding: utf-8 -*-
"""
找出「题目/插画里明明有人，配图却没人」的那一类（家长投诉的第 3 条就是这个类）。
判据：SCENES[key].hint 里提到人 → 该 key 的照片必须看得到人。
用法：python scripts/_photo-scene/audit-person.py
"""
import io, json, os, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
P_PROMPTS = os.path.join(ROOT, 'src', 'domain', 'prompts.ts')
P_SCENES  = os.path.join(ROOT, 'src', 'assets', 'scenes.tsx')
P_OVERLAY = os.path.join(ROOT, 'src', 'data', 'library-items.json')

def rd(p):
    return io.open(p, encoding='utf-8').read()

# ---------- 1. SCENES: key -> (label, hint) ----------
stx = rd(P_SCENES)
scenes = {}
for m in re.finditer(
        r"key:\s*'([^']+)',\s*\n\s*label:\s*'([^']*)',\s*\n\s*hint:\s*'((?:[^'\\]|\\.)*)'",
        stx):
    scenes[m.group(1)] = (m.group(2), m.group(3))

# ---------- 2. PROMPT_TEMPLATES: tagId -> [ (title, scenes) ] ----------
ptx = rd(P_PROMPTS)
# 从 'export const PROMPT_TEMPLATES' 开始截，避免把 TOPIC_TAGS 里的东西算进来
i = ptx.find('PROMPT_TEMPLATES')
ptx = ptx[i:] if i >= 0 else ptx

# ⚠️ 这个文件里 tag 名**有的带引号有的不带**（season: / 'home-scene':），
#    而且有的模板条目**跨多行**（title/lead/scenes 各占一行）—— 两个坑都得兜。
templates = {}
# 先按 tag 头切开
heads = list(re.finditer(r"^  '?([a-z0-9-]+)'?:\s*\[\s*$", ptx, re.M))
for idx, h in enumerate(heads):
    tag = h.group(1)
    end = heads[idx + 1].start() if idx + 1 < len(heads) else len(ptx)
    body = ptx[h.end():end]
    # 每个 title 配它后面最近的一个 scenes
    pairs = re.findall(
        r"title:\s*'((?:[^'\\]|\\.)*)'[\s\S]*?scenes:\s*\[([^\]]*)\]",
        body)
    templates[tag] = [(t, re.findall(r"'([^']+)'", s)) for t, s in pairs]

n_tpl = sum(len(v) for v in templates.values())
print('模板总数 %d（%d 个 tag）' % (n_tpl, len(templates)))
print('SCENES  %d 个 key' % len(scenes))

# ---------- 3. overlay: id -> imageUrls ----------
ov = json.loads(rd(P_OVERLAY))
print('overlay %d 条' % len(ov))

# ---------- 4. 组装 id -> 题目 ----------
PREFIX = 'builtin-'
rows = []
for tag, arr in templates.items():
    for n, (title, keys) in enumerate(arr, start=1):
        iid = '%s%s-%d' % (PREFIX, tag, n)
        if iid not in ov:
            continue
        urls = ov[iid].get('imageUrls') or []
        if not urls:
            continue
        for slot, (k, u) in enumerate(zip(keys, urls)):
            rows.append({'id': iid, 'title': title, 'key': k, 'url': u, 'slot': slot,
                         'label': scenes.get(k, ('?', '?'))[0],
                         'hint': scenes.get(k, ('?', '?'))[1]})

print('带图槽位 %d 个（%d 道题）' % (len(rows), len(set(r['id'] for r in rows))))

# ---------- 5. 人味判据 ----------
# ★ 真正的缺陷类是「**题目名字里就是一个人**」→ 配图必须有这个人。
#   （hint 里提到人只能算弱信号：太空旅行/堆雪人 的 hint 也有「小人」，但配图是火箭/雪人，
#     没有人才对。所以主判据用 title，hint 只作参考。）
TITLE_PERSON = re.compile(
    r'妈妈|爸爸|奶奶|爷爷|老师|叔叔|阿姨|管理员|医生|护士|警察|司机|工人|环卫|邮递|售货|'
    r'农民|大夫|同桌|同学|朋友|邻居|妹妹|弟弟|姐姐|哥哥|宝宝|孩子|老人|'
    r'这个人|的人|我是|这就是我|形形色色|众生|理想|成为'
)
# 明显不是人名的白名单（免得「漫画老师」这种其实要画物件的被算进来）
TITLE_NOT_PERSON = re.compile(r'^漫画老师$')

by_key = {}
for r in rows:
    by_key.setdefault(r['key'], []).append(r)

suspects = []
for k, rs in by_key.items():
    titles = sorted(set(x['title'] for x in rs))
    hit = [t for t in titles if TITLE_PERSON.search(t) and not TITLE_NOT_PERSON.search(t)]
    if not hit:
        continue
    for r in rs:
        suspects.append(dict(r, why='题目就是人：%s' % '、'.join(hit)))

print()
print('=== 题目名字里就是「一个人」→ 配图必须看得到人 ===')
seen = set()
for r in suspects:
    if r['key'] in seen:
        continue
    seen.add(r['key'])
    ts = sorted(set(x['title'] for x in suspects if x['key'] == r['key']))
    print('  %-20s %-12s %s' % (r['key'], r['label'], '、'.join(ts)))
print('  共 %d 个 key' % len(seen))

# ---------- 5b. 弱信号（hint 提到人）单独列一份，只作参考 ----------
WEAK = re.compile(
    r'奶奶|爷爷|妈妈|爸爸|老师|叔叔|阿姨|管理员|医生|护士|警察|司机|工人|环卫|邮递|售货|'
    r'农民|大夫|孩子|女孩|男孩|老人|同学|同桌|家人|一个人|两个人|几个人|大人|小人|人群|有人'
)
weak = sorted(set(r['key'] for r in rows if WEAK.search(r['hint'])))
extra = [k for k in weak if k not in seen]
print()
print('  （弱信号：hint 里有人但题目不是人的，%d 个，暂不处理）' % len(extra))
print('   ' + ' '.join(extra))

# ---------- 6. 落一份待查清单 ----------
out = os.path.join(os.path.dirname(__file__), 'audit-person.json')
json.dump(suspects, io.open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print()
print('写出 %s（%d 行）' % (out, len(suspects)))

# key -> 已配的那张图的地址（去重用）
kurl = {}
for r in suspects:
    kurl.setdefault(r['key'], r['url'])
kf = os.path.join(os.path.dirname(__file__), 'audit-person-keys.txt')
with io.open(kf, 'w', encoding='utf-8', newline='\n') as fh:
    for k in sorted(kurl):
        fh.write('%s\t%s\n' % (k, kurl[k]))
print('写出 %s（%d 个 key）' % (kf, len(kurl)))
