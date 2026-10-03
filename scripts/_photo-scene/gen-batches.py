"""一次性：生成子代理批次文件 scripts/_photo-scene/batch-NN.json。用完即删。

每条：{ key, hint, en, usedBy }
  hint   —— 来自 scenes.tsx 的插画说明（**画面里该有什么**，选图的唯一依据）
  en     —— 建议的英文检索词（Pexels 只吃英文）
  usedBy —— 哪些题会用到这张图（同一 key 的题共用一张，保持一致）
"""
import io
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
src = io.open(os.path.join(ROOT, 'src/assets/scenes.tsx'), encoding='utf-8').read()
inv = json.load(io.open(os.path.join(ROOT, 'scripts/_inventory.json'), encoding='utf-8'))

hints = {}
for m in re.finditer(r"key: '([^']+)',\s*\n\s*label: '([^']*)',\s*\n\s*hint: '([^']*)'", src):
    hints[m.group(1)] = m.group(3)

# key -> 建议英文词（我按 hint 里**具体画了什么**写的，不是按题目标题）
EN = {
    # ---- 单图 ----
    'school-garden': 'school garden flowers path',
    'playground': 'school playground running track',
    'cleaning-class': 'cleaning classroom broom floor',
    'snow-clear': 'snow covered roof blue sky',
    'book-store': 'cozy bookstore bookshelf',
    'pothos': 'pothos plant hanging window',
    'mom-cooking': 'kitchen cooking pot steam',
    'bird-window': 'bird on windowsill',
    'travel-visit': 'chinese pavilion garden stone',
    'cultural-heritage': 'great wall of china',
    'teacher-class': 'empty classroom blackboard',
    'comic-teacher': 'classroom desks chalkboard interior',
    'deskmate': 'school desk books pencils',
    'best-friend': 'two children playing outdoors grass',
    'mirror-self': 'round mirror on wall reflection',
    'all-kinds-people': 'crowd of people walking street',
    'help-hand': 'helping hand reaching out',
    'sewing-box': 'sewing kit thread scissors buttons',
    'play-game': 'tug of war rope',
    'colorful-activity': 'children running running track',
    'sick': 'thermometer medicine on table',
    'observe-diary': 'plant sprout in jar magnifying glass',
    'experiment': 'science experiment beaker liquid',
    'write-letter': 'envelope stamp letter on desk',
    'reading-notes': 'open book on desk',
    'look-picture-single': 'framed picture on wall',
    'look-picture-series': 'three picture frames on wall',
    'festival': 'chinese lanterns red festival',
    'hometown-custom': 'chinese lanterns old village street',
    'old-toy': 'old worn teddy bear',
    'old-photo': 'vintage photo frame on desk',
    'clock': 'twin bell alarm clock vintage',
    'my-room': 'cozy bedroom desk bookshelf',
    'introduce-thing': 'laptop on desk notebook',
    'my-paradise': 'treehouse garden swing',
    'dumplings': 'dumplings making flour board',
    'noodle-soup': 'noodle soup bowl chopsticks',
    'turtle-rabbit': 'tortoise on grass',
    'girl-visit': 'snowy street night warm window light',
    'talking-bag': 'blue backpack hanging chair',
    'sci-fi-fly': 'rocket launching space stars',
    'invention': 'blueprint sketch lightbulb idea',
    # ---- 连环图 ----
    'baby-arrive': 'baby crib nursery',
    'bike-fail': 'fallen bicycle on ground',
    'bike-ride': 'bicycle on path riding',
    'cook-done': 'family dinner table home cooking',
    'cook-mess': 'messy kitchen flour baking',
    'cook-start': 'kitchen counter vegetables cutting board',
    'found-mom': 'mother hugging child',
    'lost-crowd': 'crowd of people legs street',
    'mountain-climb': 'hiking mountain trail before dawn',
    'pencil-adventure': 'pencil on open book',
    'pencil-escape': 'pencil notebook on desk',
    'pencil-home': 'pencil case colored pencils',
    'play-with-baby': 'baby playing blocks on floor',
    'rain-window': 'rain drops on window glass',
    'rainbow': 'rainbow over field landscape',
    'snow-play': 'children playing snow winter',
    'snowman': 'snowman carrot scarf snow',
    'space': 'astronaut space rocket planet',
    'sports-day': 'school sports day race children',
    'spring-outing-bus': 'yellow school bus',
    'spring-outing-picnic': 'picnic blanket grass basket',
    'spring-outing-play': 'kite flying in sky',
    'sunrise-peak': 'sunrise mountain peak clouds',
    'winter-window': 'window view snow winter',
}

# 哪些题用到这个 key（单图题 + 连环图题）
used = {}
for t in inv:
    for it in t['items']:
        for k in it['scenes']:
            used.setdefault(k, []).append(it['id'])

keys = sorted(EN)
missing_hint = [k for k in keys if k not in hints]
if missing_hint:
    raise SystemExit('这些 key 在 scenes.tsx 里找不到 hint：' + ', '.join(missing_hint))

# 按 key 切 8 批
N = 8
batches = [[] for _ in range(N)]
for i, k in enumerate(keys):
    batches[i % N].append(k)

outdir = os.path.join(ROOT, 'scripts/_photo-scene')
for n, ks in enumerate(batches, 1):
    data = [
        {'key': k, 'hint': hints[k], 'en': EN[k], 'usedBy': used.get(k, [])}
        for k in ks
    ]
    p = os.path.join(outdir, f'batch-{n:02d}.json')
    io.open(p, 'w', encoding='utf-8', newline='\n').write(
        json.dumps(data, ensure_ascii=False, indent=2) + '\n'
    )
    print(f'batch-{n:02d}.json  {len(data)} 条')

print(f'\n共 {len(keys)} 个 key，切成 {N} 批')
print('用到这些 key 的题总数：', sum(len(v) for v in used.values()))
