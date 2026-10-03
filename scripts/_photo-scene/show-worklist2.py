# -*- coding: utf-8 -*-
"""打印工单里每道题的题名 + 引导语 —— 判断"旧 key 的 hint 还算不算数"。

判据：hint 跟标题/引导语说的是同一件事 → 用 hint 的关键词；
      明显是**复用**了别人的 sceneKey（hint 跟题目对不上）→ 用题目自己的话定关键词。
"""
import json, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

wl = json.load(open('scripts/_photo-scene/replace-worklist.json', encoding='utf-8'))
for i, w in enumerate(wl, 1):
    print('%2d. %-24s 第%d张  《%s》' % (i, w['id'], w['slot'] + 1, w['title']))
    print('    引导语: %s' % w['lead'])
    print('    旧key=%s  插画hint: %s' % (w['oldSceneKey'], w['hint'] or '(无)'))
    print()
