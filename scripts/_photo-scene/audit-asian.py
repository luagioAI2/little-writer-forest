# -*- coding: utf-8 -*-
"""逐张审图的结果落盘（**别只留在对话里** —— 上下文一压缩就全没了）。

分三档：
  A 画面里的人明显不是亚洲人 → 必换
  B 明显不是中国/亚洲的场景或物件（可能没人）→ 必换
  C 偏西式但没人 / 人看不清 → 可选
判据来自 7 张 audit-*.png（全库）+ 1 张 zoom-sheet.png（拿不准的放大复核）。
"""
import json, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

A = {  # 编号: 理由
    11: '小孩是西方孩子（浅色卷发）',
    14: '学生浅色/姜黄色头发',
    15: '女孩是中东/南亚面孔',
    20: '美国警察（POLICE 背心）',
    21: '图书管理员是中东面孔',
    22: '公交司机是白人男性',
    36: '孩子与大人是西方人',
    40: '厨房是欧式乡村，人物偏欧洲',
    41: '爷爷是白人老人',
    42: '婴儿皮肤/头发很浅',
    43: '婴儿脚，皮肤很浅',
    45: '奶奶是白人老人',
    46: '邻居阿婆是南亚男性面孔',
    52: '台上孩子是西方孩子',
    68: '女孩浅棕头发',
    77: '金发孩子',
    78: '街头两人偏西方，且街景是西方街道',
    83: '孩子明显是非洲/南亚面孔',
    85: '母子是西方人',
    88: '男孩浅色头发',
    131: '西方教室，黑板上写着德语 Guten Morgen',
    132: '西方教室 + 金发老师',
    144: '母子偏西方/拉美',
}
B = {
    3: '美国黄色校车',
    66: '欧洲小镇（石桥 + 尖塔）',
    76: '街景里出现 PARIS 招牌',
    87: '西式校舍，孩子走进校园',
    96: '美式街景（高楼 + 旗）',
    125: '伦敦红色双层巴士',
    145: '美国黄色校车',
    152: '欧洲小镇（红顶 + 教堂尖塔）',
    161: '欧洲雨天街景',
}
C = {
    1: '前排女孩像穿韩服（朝鲜族），不是中国',
    17: '英文漫画',
    18: '西式英雄漫画',
    32: '宇航服上印着 CCCP（苏联）',
    48: '西式公园小路，人背对看不清',
    57: '西式未来建筑',
    72: '英文手写体 don\'t be',
    95: '人群里有浅肤色的人（混）',
    114: '西式木屋雪景',
    126: '东南亚街景（车牌/招牌）',
    143: '西式树屋',
    159: '欧洲房子',
    160: '欧洲雾天街景',
}

rows = json.load(open('scripts/_photo-scene/all-162.json', encoding='utf-8'))
byidx = {i + 1: r for i, r in enumerate(rows)}

out = []
for label, table in (('A', A), ('B', B), ('C', C)):
    for n, why in sorted(table.items()):
        r = byidx.get(n)
        if not r:
            print('✗ 编号', n, '找不到'); continue
        out.append({'n': n, 'level': label, 'why': why,
                    'id': r['id'], 'slot': r['slot'], 'title': r['title'],
                    'pexelsId': r['pexelsId'], 'url': r['url']})

json.dump(out, open('scripts/_photo-scene/asian-audit.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=2)

for lv in 'ABC':
    sub = [o for o in out if o['level'] == lv]
    print('%s 档 %d 条' % (lv, len(sub)))
    for o in sub:
        print('   %3d %-26s 第%d张 《%s》 —— %s' % (o['n'], o['id'], o['slot'] + 1, o['title'], o['why']))
print()
print('合计 %d / 162 张需要处理（A+B 必换 = %d，C 可选 = %d）'
      % (len(out), len(A) + len(B), len(C)))
print('→ scripts/_photo-scene/asian-audit.json')
