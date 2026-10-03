# -*- coding: utf-8 -*-
"""把 36 组重复标题里的 38 条改名。

判据（跟家长交代过的规则一致）：
  · 两个同名的，改**引导语在描述画面**的那条（插画题，插画由引导语生成），
    让照片题保留大家熟悉的那个标题。
  · 「题面+引导语逐字一样」的 2 组（跨标签），改**跟本标签更不贴**的那条。

⚠️ 只改 title，**lead 一个字不动**；**绝不删条目**（删中间那条 = id 串位）。
⚠️ 覆盖层里若存了这条的 baseTitle（防串位锚点），必须**同步改成新标题**，否则锚点对不上。
"""
import io, json, re, sys

DRY = '--write' not in sys.argv

# id → 新标题
RENAME = {
    # ── A. 真重复（题面 + 引导语逐字一样，跨标签）──
    'builtin-home-scene-1': '悄悄长大的绿萝',
    'builtin-home-scene-3': '清晨的窗台',
    # ── B. 同名不同引导语 ──
    'builtin-comic-3': '四格漫画里的道理',
    'builtin-treasure-10': '相框里的老照片',
    'builtin-food-5': '面碗里的热气',
    'builtin-observe-6': '展示台前介绍它',
    'builtin-warm-moment-5': '伸过来的那只手',
    'builtin-if-i-4': '假如我只有蚂蚁大',
    'builtin-deform-5': '变小以后的世界',
    'builtin-pet-12': '竹林里的大熊猫',
    'builtin-treasure-8': '打开的针线盒',
    'builtin-activity-12': '操场上的活动',
    'builtin-weather-8': '雾里的小路',
    'builtin-sci-fi-3': '宇宙探险记',
    'builtin-family-12': '毛线团和摇椅',
    'builtin-custom-4': '过节时的老规矩',
    'builtin-pet-11': '水盆里的小乌龟',
    'builtin-people-around-4': '身边都有谁',
    'builtin-hometown-6': '藏着快乐的角落',
    'builtin-plant-8': '开花的仙人掌',
    'builtin-future-8': '我的发明设计图',
    'builtin-activity-13': '聚光灯下的琴声',
    'builtin-sci-fi-6': '方脑袋的机器人',
    'builtin-mistake-6': '花瓶碎了以后',
    'builtin-milestone-7': '新家的第一晚',
    'builtin-future-7': '跳到未来去看',
    'builtin-future-5': '飘在天上的学校',
    'builtin-plant-7': '荷叶上的蜻蜓',
    'builtin-sci-fi-4': '珊瑚丛里的小鱼',
    'builtin-teacher-5': '给老师画漫画',
    'builtin-activity-10': '擦窗还是扫地',
    'builtin-fairy-5': '笔尖冒出的小人',
    'builtin-first-time-9': '幕布拉开的时候',
    'builtin-observe-3': '它今天变了样',
    'builtin-observe-5': '蒜苗长到第七天',
    'builtin-milestone-11': '蜡烛和生日歌',
    'builtin-mistake-7': '跑进校门的那天',
    'builtin-unforgettable-5': '挥手告别那天',
}

PROMPTS = 'src/domain/prompts.ts'
OVERLAY = 'src/data/library-items.json'

TAG_RE = re.compile(r"^  '?([A-Za-z-]+)'?: \[$")
ONE_RE = re.compile(r"^    \{ title: '([^']*)', lead: '([^']*)'")
MT = re.compile(r"^      title: '([^']*)',$")

raw = io.open(PROMPTS, encoding='utf-8', newline='').read()
lines = raw.split('\r\n')

# ── 定位每条模板的 title 行 ──
pos = {}          # id -> (kind, line_no)
cur, idx = None, 0
for n, line in enumerate(lines):
    m = TAG_RE.match(line)
    if m:
        cur, idx = m.group(1), 0
        continue
    if cur is None:
        continue
    if ONE_RE.match(line):
        idx += 1
        pos['builtin-%s-%d' % (cur, idx)] = ('one', n)
    elif MT.match(line):
        idx += 1
        pos['builtin-%s-%d' % (cur, idx)] = ('multi', n)

print('定位到 %d 条模板' % len(pos))
assert len(pos) == 370, '定位数量不对'

# ── 自检：要改的 id 都存在；新标题合法 ──
bad = [k for k in RENAME if k not in pos]
assert not bad, '这些 id 找不到：%s' % bad
for k, t in RENAME.items():
    assert len(t) <= 20, '%s 新标题超 20 字：%s' % (k, t)
    assert ',' not in t and "'" not in t, '%s 新标题有半角逗号/单引号：%s' % (k, t)
    assert t == t.strip(), '%s 新标题首尾有空格' % k
print('要改 %d 条；新标题长度/标点自检通过' % len(RENAME))

# ── 改后全库标题不许重复（拿"改后的标题表"算，不靠感觉）──
allt = {}
for k, (kind, n) in pos.items():
    if kind == 'one':
        allt[k] = ONE_RE.match(lines[n]).group(1)
    else:
        allt[k] = MT.match(lines[n]).group(1)
for k, t in RENAME.items():
    allt[k] = t
import collections
c = collections.Counter(allt.values())
dups = {t: n for t, n in c.items() if n > 1}
if dups:
    print('✗ 改完仍有重复：')
    for t, n in sorted(dups.items()):
        print('   x%d %s -> %s' % (n, t, [k for k, v in allt.items() if v == t]))
    sys.exit(1)
print('✅ 改完 370 条标题互不重复')

if DRY:
    print()
    print('（dry-run，没写盘。加 --write 才落盘）')
    for k, t in list(RENAME.items())[:6]:
        kind, n = pos[k]
        old = ONE_RE.match(lines[n]).group(1) if kind == 'one' else MT.match(lines[n]).group(1)
        print('   %-28s %s → %s' % (k, old, t))
    sys.exit(0)

# ── 写 prompts.ts ──
for k, t in RENAME.items():
    kind, n = pos[k]
    if kind == 'one':
        lines[n] = re.sub(r"^    \{ title: '[^']*'", "    { title: '%s'" % t, lines[n], count=1)
    else:
        lines[n] = "      title: '%s'," % t
out = '\r\n'.join(lines)
assert out.count('\r\n') == raw.count('\r\n'), 'CRLF 数量变了'
assert out.count('\n') - out.count('\r\n') == 0, '混进了裸 LF'
io.open(PROMPTS, 'w', encoding='utf-8', newline='').write(out)
print('✓ 已写 prompts.ts')

# ── 同步覆盖层的 baseTitle 锚点 ──
ov = json.load(io.open(OVERLAY, encoding='utf-8'))
changed = []
for k, t in RENAME.items():
    if k in ov and ov[k].get('baseTitle') != t:
        changed.append((k, ov[k].get('baseTitle'), t))
        ov[k]['baseTitle'] = t
if changed:
    def serialize(obj):
        clean = {}
        for kk in sorted(obj):
            v = obj[kk]
            clean[kk] = {f: v[f] for f in ('baseTitle', 'baseLead', 'title', 'lead', 'imageUrls') if f in v}
        return json.dumps(clean, ensure_ascii=False, indent=2) + '\n'
    orig = io.open(OVERLAY, encoding='utf-8').read()
    assert serialize(json.loads(orig)) == orig, '覆盖层序列化器不同形'
    io.open(OVERLAY, 'w', encoding='utf-8', newline='').write(serialize(ov))
    print('✓ 覆盖层同步了 %d 条 baseTitle：' % len(changed))
    for k, a, b in changed:
        print('    %-28s %s → %s' % (k, a, b))
else:
    print('覆盖层无需改')
