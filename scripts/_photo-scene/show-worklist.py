# -*- coding: utf-8 -*-
"""把工单摊平成「人看得懂 + 子代理能执行」的一张表，并给出建议的英文检索词。

★ 关键词来自**插画自己的 hint**（画面里有什么），不是题目标题（它叫什么）。
   hint 里出现的颜色/具体物件是硬约束。
"""
import json, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

wl = json.load(open('scripts/_photo-scene/replace-worklist.json', encoding='utf-8'))

# 我按 hint 给的检索词（人工定，不自动生成 —— 自动生成会退化成"用标题搜"）
QUERY = {
    'wheat-field':        'golden wheat field harvest landscape',
    'sci-fi-fly':         'rocket launch night sky',
    'bird-window':        'bird on windowsill closeup',
    'spring-outing-bus':  'school bus children trip',
    'doctor':             'doctor with stethoscope hospital',
    'colorful-activity':  'outdoor group activity children running',
    'cleaning-class':     'students cleaning classroom sweeping',
    'spring-outing-play': 'children playing field picnic',
    'river-village':      'small river village countryside',
    'travel-visit':       'ancient chinese temple architecture',
    'cultural-heritage':  'chinese ancient city wall',
    'if-tiny':            'ant on grass macro',
    'book-store':         'bookstore shelves books interior',
    'mountain-climb':     'mountain trail hiking path',
    'deskmate':           'two students sitting desk classroom',
    'mom-cooking':        'mother cooking kitchen',
    'sewing-box':         'sewing kit thread needles box',
    'write-letter':       'writing letter by hand pen paper',
    'comic-inspiration':  'newspaper cartoon illustration closeup',
    'grandpa-garden':     'grandfather garden vegetables',
    'teacher-class':      'teacher writing blackboard classroom',
    'help-hand':          'helping hand reaching up',
    'mirror-self':        'child looking in mirror',
    'observe-diary':      'child observing plant notebook magnifier',
    'future-me':          'silhouette person looking at city skyline',
    'spring-outing-picnic': 'picnic blanket food outdoors children',
    'all-kinds-people':   'busy street crowd people walking',
}

for i, w in enumerate(wl, 1):
    q = QUERY.get(w['oldSceneKey'], '???')
    print('%2d. %-24s 第%d张  《%s》' % (i, w['id'], w['slot'] + 1, w['title']))
    print('    旧key=%-18s 插画名=%-14s' % (w['oldSceneKey'], w['sceneLabel']))
    print('    hint: %s' % (w['hint'] or '(无)'))
    print('    建议检索词: %s' % q)
    print()

missing = [w['oldSceneKey'] for w in wl if w['oldSceneKey'] not in QUERY]
print('没给检索词的 key:', sorted(set(missing)) or '无 ✓')
print('工单:', len(wl), '条')
