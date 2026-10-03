# -*- coding: utf-8 -*-
"""把 missing-keys.json 切成几个批次，给并行子代理。
关键词（EN）是**按 hint 里的具体物件**手写的，不是按题目名字。
用法：python scripts/_photo-scene/gen-batches2.py
"""
import io
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
D = os.path.join(ROOT, 'scripts', '_photo-scene')

# key -> 检索词（取自 hint 里画出来的东西）
EN = {
    'spring-park':      'spring park blooming trees path',
    'grandpa-garden':   'grandfather watering vegetable garden',
    'school-autumn':    'ginkgo tree autumn leaves path',
    'fog-morning':      'foggy road morning mist',
    'umbrella-rain':    'umbrella rain street walking',
    'fireflies':        'fireflies glowing night field',
    'starry-night':     'starry night sky milky way',
    'neighbor':         'woman carrying shopping basket smiling',
    'police':           'traffic police officer directing traffic',
    'sleep-alone':      'child sleeping in bed night',
    'memory-album':     'open photo album on table',
    'lie-truth':        'mother talking to child at home',
    'late':             'child running to school backpack',
    'exam-nervous':     'student studying desk lamp night',
    'moving':           'cardboard moving boxes empty room',
    'farewell-school':  'children waving goodbye school',
    'my-talent':        'child playing piano',
    'turtle':           'small turtle on stone',
    'dandelion':        'dandelion seeds blowing wind',
    'lotus':            'lotus flower pond',
    'eraser-talking':   'eraser and pencil on desk',
    'pencil-case':      'pencil case stationery pens ruler',
    'wind-travel':      'wind blowing tall grass',
    'talk-animals':     'cat dog bird together',
    'if-tiny':          'tiny figurine among flowers macro',
    'weird-dream':      'surreal dream sky balloons',
    'time-travel':      'spiral clock future city',
    'adventure-trip':   'cave entrance flashlight adventure',
    'pen-story':        'notebook and pencil on desk',
}

keys = json.load(io.open(os.path.join(D, 'missing-keys.json'), encoding='utf-8'))
by_key = {k['key']: k for k in keys}
order = list(EN.keys())
missing = [k for k in by_key if k not in EN]
extra = [k for k in EN if k not in by_key]
if missing:
    raise SystemExit('❌ 这些 key 还没写检索词：' + ','.join(missing))
if extra:
    raise SystemExit('❌ EN 里有已经不缺图的 key：' + ','.join(extra))

PER = 5
batches = [order[i:i + PER] for i in range(0, len(order), PER)]
for n, group in enumerate(batches, start=1):
    rows = [{'key': k, 'hint': by_key[k]['hint'], 'en': EN[k], 'usedBy': by_key[k]['usedBy']}
            for k in group]
    p = os.path.join(D, 'batch2-%02d.json' % n)
    with io.open(p, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
    print('batch2-%02d.json  %d 个 key：%s' % (n, len(rows), '、'.join(group)))

print()
print('共 %d 个 key / %d 个批次' % (len(order), len(batches)))
