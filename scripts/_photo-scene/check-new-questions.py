# -*- coding: utf-8 -*-
"""校验 new-questions.json：① 126 条、key 与插画目录一一对应；② tag 都是真实标签；
   ③ 标题不跟现有 144 道重名；④ 标题/引导语长度在闸门之内。只读。
"""
import re, json, io, sys, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

cat = json.load(open('scripts/_photo-scene/scene-catalog.json', encoding='utf-8'))
nq = json.load(open('scripts/_photo-scene/new-questions.json', encoding='utf-8'))
SRC = open('src/domain/prompts.ts', encoding='utf-8').read()

ok = True

# ① 覆盖
cat_keys = [e['key'] for e in cat]
nq_keys = [e['key'] for e in nq]
print('插画目录:', len(cat_keys), ' 新题:', len(nq_keys))
dup = [k for k, c in collections.Counter(nq_keys).items() if c > 1]
missing = sorted(set(cat_keys) - set(nq_keys))
extra = sorted(set(nq_keys) - set(cat_keys))
print('  重复的 key:', dup or '无')
print('  漏掉的 key:', missing or '无')
print('  多余的 key:', extra or '无')
if dup or missing or extra:
    ok = False

# ② 标签
tags = set(re.findall(r"\{ id: '([a-z0-9-]+)', category:", SRC))
bad = [(e['key'], e['tag']) for e in nq if e['tag'] not in tags]
print('  不存在的标签:', bad or '无')
if bad:
    ok = False
print('  用到的标签数:', len({e['tag'] for e in nq}), '/ 全部', len(tags))

# ③ 重名
existing = re.findall(r"title: '((?:[^'\\]|\\.)*)'", SRC)
exist_set = set(existing)
print('  现有题目标题:', len(exist_set))
clash = [(e['key'], e['title']) for e in nq if e['title'] in exist_set]
print('  跟现有重名的:', clash or '无')
selfclash = [t for t, c in collections.Counter(e['title'] for e in nq).items() if c > 1]
print('  新题之间重名的:', selfclash or '无')
if clash or selfclash:
    ok = False

# ④ 长度
mt = re.search(r"LIBRARY_TITLE_MAX\s*=\s*(\d+)", SRC)
ml = re.search(r"LIBRARY_LEAD_MAX\s*=\s*(\d+)", SRC)
print('  闸门（从 prompts.ts 找）: 标题', mt.group(1) if mt else '?', ' 引导语', ml.group(1) if ml else '?')
TMAX = int(mt.group(1)) if mt else 0
LMAX = int(ml.group(1)) if ml else 0
long_t = [(e['key'], len(e['title']), e['title']) for e in nq if TMAX and len(e['title']) > TMAX]
long_l = [(e['key'], len(e['lead']), e['lead']) for e in nq if LMAX and len(e['lead']) > LMAX]
print('  标题超长的:', long_t or '无')
print('  引导语超长的:', long_l or '无')
print('  标题长度范围:', min(len(e['title']) for e in nq), '-', max(len(e['title']) for e in nq))
print('  引导语长度范围:', min(len(e['lead']) for e in nq), '-', max(len(e['lead']) for e in nq))
if long_t or long_l:
    ok = False

# 分布
print()
print('按标签分布（现有 → 追加后）:')
cur = collections.Counter()
heads = list(re.finditer(r"^  '?([a-z0-9-]+)'?:\s*\[\s*$", SRC, re.M))
for hi, h in enumerate(heads):
    end = heads[hi + 1].start() if hi + 1 < len(heads) else len(SRC)
    n = len(re.findall(r"title:\s*'", SRC[h.end():end]))
    cur[h.group(1)] = n
add = collections.Counter(e['tag'] for e in nq)
for t in sorted(set(cur) | set(add)):
    if add[t]:
        print('  %-18s %2d → %2d  (+%d)' % (t, cur[t], cur[t] + add[t], add[t]))

print()
print('★ 结论:', '全部通过' if ok else '有问题，见上')
