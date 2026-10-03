# -*- coding: utf-8 -*-
"""把 <topics.json> 里的新标签和新题追加进 prompts.ts（纯追加）。
规则：
  1. 新标签追加到 TOPIC_TAGS 数组末尾
  2. 新题追加到各自标签数组末尾（防 id 串位）；新标签 = 在最后一个标签数组后面新建
  3. 保持 CRLF、保持缩进、保持单行格式
  4. 写完后自校验：总数 = 原数 + 新增数；每个新标签既在 TOPIC_TAGS 里、又有数组

用法: python append-tags.py <topics.json> [--write]
★ 只认「新标签」——已存在的标签走这里会插重复数组，脚本会断言拦住。
"""
import json, io, re, sys, os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(SCRIPT_DIR, '..', '..')
SRC = os.path.join(ROOT, 'src', 'domain', 'prompts.ts')

JSON = sys.argv[1]
if not os.path.isabs(JSON) and not os.path.exists(JSON):
    cand = os.path.join(SCRIPT_DIR, JSON)
    if os.path.exists(cand):
        JSON = cand
assert os.path.exists(JSON), f'找不到 {JSON}'
raw = io.open(SRC, encoding='utf-8', newline='').read()
assert raw.count('\r\n') > 100, 'CRLF 丢了'
assert raw.count('\n') - raw.count('\r\n') == 0, '混进了裸 LF'
lines = raw.split('\r\n')

TAG_RE = re.compile(r"^  '?([A-Za-z][A-Za-z0-9-]*)'?: \[$")
ONE_RE = re.compile(r'^    \{ title: ')
MT = re.compile(r'^      title: ')
TAGLINE_RE = re.compile(r"hint: '[^']+'\s*\},?\s*$")

orig_count = sum(1 for l in lines if ONE_RE.match(l) or MT.match(l))
d = json.load(io.open(JSON, encoding='utf-8'))
new_tags, templates = d['newTags'], d['templates']
new_total = sum(len(v) for v in templates.values())

# 断言：要加的标签现在还不存在
for t in new_tags:
    assert not any(TAG_RE.match(l) and TAG_RE.match(l).group(1) == t['id'] for l in lines), \
        f"标签 {t['id']} 已经存在 —— 这个脚本只负责追加新标签"
print(f'原题数 {orig_count}｜新标签 {len(new_tags)} {[t["id"] for t in new_tags]}｜新题 {new_total}')


def tpl_key(tag_id):
    """沿用 prompts.ts 既有惯例：带连字符的 key 加引号，纯字母不加（现文件 36/36 与 11/11 一致）"""
    return f"'{tag_id}'" if '-' in tag_id else tag_id


def close_positions(src_lines):
    """每个标签数组的闭合 '  ],' 行号"""
    ends, cur = {}, None
    for i, line in enumerate(src_lines):
        m = TAG_RE.match(line)
        if m:
            cur = m.group(1)
            ends[cur] = None
            continue
        if line.rstrip() == '  ],' and None in ends.values():
            for t in ends:
                if ends[t] is None:
                    ends[t] = i
                    break
    for t, v in ends.items():
        assert v is not None, f'标签 {t} 没找到闭合位置'
    return ends


# ① 插新标签到 TOPIC_TAGS 末尾
idx = max(i for i, l in enumerate(lines) if TAGLINE_RE.search(l))
tag_lines = [f"  {{ id: '{t['id']}', category: '{t['category']}', label: '{t['label']}', "
             f"emoji: '{t['emoji']}', minGrade: {t['minGrade']}, hint: '{t['hint']}' }}," for t in new_tags]
lines = lines[:idx + 1] + tag_lines + lines[idx + 1:]

# ② 建新标签的题数组（插在最后一个标签数组之后）
for tag_id, items in templates.items():
    ends = close_positions(lines)
    last = max(ends, key=lambda k: ends[k])
    at = ends[last] + 1
    block = [f'  {tpl_key(tag_id)}: ['] + \
            [f"    {{ title: '{it['title']}', lead: '{it['lead']}', scenes: [PHOTO_SLOT] }}," for it in items] + \
            ['  ],']
    lines = lines[:at] + block + lines[at:]

out = '\r\n'.join(lines)
assert out.count('\n') - out.count('\r\n') == 0, '混进了裸 LF'
new_count = sum(1 for l in lines if ONE_RE.match(l) or MT.match(l))
assert new_count == orig_count + new_total, f'题数不对: {new_count} != {orig_count} + {new_total}'
for t in new_tags:
    assert f"id: '{t['id']}'" in out, f"标签 {t['id']} 没插进 TOPIC_TAGS"
    assert f"  {tpl_key(t['id'])}: [" in out, f"标签 {t['id']} 没建数组"
print(f'校验通过: {orig_count} + {new_total} = {new_count} 题；行数 {len(raw.split(chr(13)+chr(10)))} -> {len(lines)}')

if '--write' in sys.argv:
    io.open(SRC, 'w', encoding='utf-8', newline='').write(out)
    print('已写入', SRC)
else:
    io.open(SRC + '.new', 'w', encoding='utf-8', newline='').write(out)
    print('干跑完成（预览写到 prompts.ts.new），加 --write 才写盘')
