"""一次性：把 _inventory.json 和 scenes.tsx 的 hint 拼起来打印，供挑图用。用完即删。"""
import io
import json
import re

inv = json.load(io.open('scripts/_inventory.json', encoding='utf-8'))
src = io.open('src/assets/scenes.tsx', encoding='utf-8').read()

hints = {}
for m in re.finditer(
    r"key: '([^']+)',\s*\n\s*label: '([^']*)',\s*\n\s*hint: '([^']*)'", src
):
    hints[m.group(1)] = (m.group(2), m.group(3))
print('scenes.tsx 里解析到 hint:', len(hints))

unc = [t for t in inv if not t['covered']]
total = 0
multi_total = 0
for t in unc:
    print()
    print(f"### {t['tagId']} ｜ {t['label']} ｜ {t['category']} ｜ minGrade {t['minGrade']} ｜ {t['tagHint']}")
    for it in t['items']:
        total += 1
        n = len(it['scenes'])
        tag = f"  [连环图 {n} 张]" if n > 1 else ''
        if n > 1:
            multi_total += 1
        print(f"  - {it['id']}  {it['title']}{tag}")
        print(f"      lead: {it['lead']}")
        for s in it['scenes']:
            lb, h = hints.get(s, ('?', '(scenes.tsx 里没有这个 key)'))
            print(f"        * {s} → {h}")
print()
print(f'未配图题目 {total} 道，其中连环图 {multi_total} 道，单图 {total - multi_total} 道')
