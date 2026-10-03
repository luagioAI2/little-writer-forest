# -*- coding: utf-8 -*-
"""把 30 条工单切成 3 批，每批带上子代理要的全部上下文。

★ 关键词的判据（逐条人工定的，不自动生成）：
   · 旧 sceneKey 的 hint 跟题目说的是同一件事 → 用 hint 里的具体物件
   · 明显是**复用**了别人的 sceneKey（hint 跟题目对不上）→ 用题目自己的话
     本批里有两处：builtin-water-3《雨后的山》、builtin-season-4《夏天的小院》
"""
import json, re, io, sys, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

wl = json.load(open('scripts/_photo-scene/replace-worklist.json', encoding='utf-8'))
overlay = json.load(open('src/data/library-items.json', encoding='utf-8'))

# 已经在用的 pexels id —— 新图一个都不许撞（撞了就是换汤不换药）
used = set()
for ov in overlay.values():
    for u in (ov.get('imageUrls') or []):
        m = re.search(r'/photos/(\d+)/', u or '')
        if m:
            used.add(m.group(1))

# 关键词 + 一句「画面里必须有什么」（子代理拿它当验收判据）
SPEC = {
    'builtin-season-6': ('golden wheat field harvest landscape',
                         '大片金黄的麦田/麦浪，远景最好有山或房子'),
    'builtin-sci-fi-3': ('rocket launch night sky',
                         '一枚火箭（升空或立在发射台），夜空/星空背景'),
    'builtin-pet-3': ('bird on windowsill',
                      '一只小鸟停在窗台或窗框上'),
    'builtin-unforgettable-2|0': ('yellow school bus children',
                                  '一辆校车（黄色最好）停在路边'),
    'builtin-dream-job-3': ('doctor with stethoscope hospital',
                            '一位穿白大褂、挂听诊器的医生（可以背影/侧脸）'),
    'builtin-activity-5': ('school sports day track field',
                           '运动场/跑道上有人在跑或跳，看得出是集体活动'),
    'builtin-campus-3': ('students cleaning classroom',
                         '教室里有孩子在扫地/擦窗/提水桶'),
    'builtin-unforgettable-2|2': ('children flying kite field',
                                  '草地上有孩子在放风筝，天上能看到风筝'),
    'builtin-water-1': ('small river village countryside',
                        '一条河从村子中间或旁边流过，两岸有房子/树'),
    'builtin-travel-2|0': ('chinese ancient pavilion temple',
                           '中式古亭/古建，有石阶或绿树'),
    'builtin-culture-2': ('chinese ancient city wall',
                          '一段中国古城墙，最好能看到城楼或城垛'),
    'builtin-travel-2|1': ('chinese ancient gate tower',
                           '另一处中式古迹（跟第 1 张不同的地方）'),
    'builtin-if-i-4': ('ant on grass macro',
                       '微距：一只蚂蚁在草叶/花瓣上'),
    'builtin-food-3': ('bookstore shelves books',
                       '书店或图书馆的书架，排满书脊'),
    'builtin-water-3': ('misty mountain after rain green',
                        '★ 雨后的山：山色深、有云雾或湿漉漉的绿，不要夜景、不要手电'),
    'builtin-classmate-2': ('child laughing smiling',
                            '★ 一个在笑的孩子（笑脸要看得见）'),
    'builtin-home-scene-2': ('cooking pot steam kitchen',
                             '灶上或锅里冒着热气，厨房台面有食材'),
    'builtin-warm-moment-3': ('vintage sewing box thread spools',
                              '一个打开的针线盒，里面有线轴/针/扣子'),
    'builtin-letter-2': ('writing letter by hand paper pen',
                         '手写信：信纸/信封 + 笔'),
    'builtin-comic-2': ('comic strip panels illustration',
                        '漫画/连环画的格子或翻开的一页'),
    'builtin-season-4': ('sunny summer courtyard tree shade',
                         '★ 夏天的小院：阳光很足的院子，有树荫/绿植，不要菜地喷壶'),
    'builtin-teacher-2': ('teacher blackboard classroom',
                          '一位老师在黑板前（可以背影），教室环境'),
    'builtin-warm-moment-1': ('helping hand reaching up',
                              '★ 一只要拉人起来的手 —— 手必须看得见'),
    'builtin-self-2': ('child looking in mirror',
                       '镜子里或镜子前有一个孩子'),
    'builtin-observe-3': ('plant sprout glass jar',
                          '一株小苗长在瓶/杯/盆里，看得出是在观察'),
    'builtin-dream-job-1': ('child looking up at sky',
                            '一个孩子抬头往上看（背影/剪影最好）'),
    'builtin-future-2': ('futuristic city skyline',
                         '未来感的城市天际线/科技感建筑'),
    'builtin-unforgettable-2|1': ('picnic blanket outdoors food',
                                  '野餐：草地上铺着布，上面有食物和篮子'),
    'builtin-people-around-1': ('diverse people walking street',
                                '街上/路上有各种不同的人'),
    'builtin-people-around-2': ('crowd of people street crowd',
                                '街头人多、神态各异'),
}

items = []
for w in wl:
    key = '%s|%d' % (w['id'], w['slot'])
    spec = SPEC.get(key) or SPEC.get(w['id'])
    if not spec:
        raise SystemExit('工单里这条没给检索词：%s' % key)
    kw, must = spec
    cur = (overlay[w['id']]['imageUrls'] or [])[w['slot']]
    items.append({
        'id': w['id'], 'slot': w['slot'],
        'title': w['title'], 'lead': w['lead'],
        'sceneLabel': w['sceneLabel'], 'hint': w['hint'],
        'query': kw, 'must': must,
        'replaceUrl': cur,
        'replaceId': re.search(r'/photos/(\d+)/', cur).group(1),
    })

N = 10
for b in range((len(items) + N - 1) // N):
    chunk = items[b * N:(b + 1) * N]
    out = {'batch': chr(65 + b), 'usedPexelsIds': sorted(used), 'items': chunk}
    p = 'scripts/_photo-scene/replace-batch-%02d.json' % (b + 1)
    json.dump(out, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('→ %s  %d 条' % (p, len(chunk)))

print('\n已用 pexels id 共', len(used), '个（子代理要避开）')
print('工单共', len(items), '条')
