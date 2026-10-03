# -*- coding: utf-8 -*-
"""把 exam-topics.json 里的新标签和新题追加进 prompts.ts。
规则：
  1. 新标签追加到 TOPIC_TAGS 数组末尾
  2. 新题追加到各自标签数组末尾（防 id 串位）
  3. 保持 CRLF、保持缩进、保持单行格式
  4. 写完后自校验：总数 = 原数 + 新增数"""
import json
import io
import re
import sys

import os
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(SCRIPT_DIR, '..', '..')
SRC = os.path.join(ROOT, 'src', 'domain', 'prompts.ts')
JSON = os.path.join(SCRIPT_DIR, 'exam-topics.json')

raw = io.open(SRC, encoding='utf-8', newline='').read()
assert raw.count('\r\n') > 100, 'CRLF 丢了'
assert raw.count('\n') - raw.count('\r\n') == 0, '混进了裸 LF'
lines = raw.split('\r\n')

# 统计原题数
TAG_RE = re.compile(r'^  ([A-Za-z-]+): \[$')
ONE_RE = re.compile(r'^    \{ title: ')
MT = re.compile(r'^      title: ')
orig_count = 0
for line in lines:
    if ONE_RE.match(line) or MT.match(line):
        orig_count += 1
print('原题数:', orig_count)

# 读取 JSON
d = json.load(io.open(JSON, encoding='utf-8'))
new_tags = d['newTags']
templates = d['templates']
new_total = sum(len(v) for v in templates.values())
print('新增标签:', len(new_tags), [t['id'] for t in new_tags])
print('新增题数:', new_total)

# 1. 找 TOPIC_TAGS 数组末尾（找到最后一个 '},' 后插新标签）
#    策略：从后往前找第一个匹配 TOPIC_TAG 条目的行，在它后面插
insert_tag_idx = None
for i in range(len(lines) - 1, -1, -1):
    if re.search(r"hint: '[^']+'\s*\},?\s*$", lines[i]):
        insert_tag_idx = i
        break
assert insert_tag_idx is not None, '找不到 TOPIC_TAGS 插入点'

# 2. 找 PROMPT_TEMPLATES 里每个标签数组的插入点
#    策略：对每个已有标签，找到它的 '  ],' 行，在前面插新题
#    对新标签，在最后一个标签数组的 '  ],' 后面新建数组

tag_block_ends = {}  # tag -> 闭合 '  ],' 的行号
for i, line in enumerate(lines):
    m = TAG_RE.match(line)
    if m:
        tag_block_ends[m.group(1)] = None
        continue
    if line.rstrip() == '  ],' and None in tag_block_ends.values():
        # 找到最近一个未闭合的标签
        for t in list(tag_block_ends.keys()):
            if tag_block_ends[t] is None:
                tag_block_ends[t] = i
                break

# 确认所有已有标签都找到了闭合位置
for t, v in tag_block_ends.items():
    assert v is not None, f'标签 {t} 没找到闭合位置'

# 3. 构造插入内容
new_tag_lines = []
for t in new_tags:
    comma = ',' if new_tag_lines else ''  # 第一个前面不加逗号，因为原最后一个已有逗号
    # 注意：原文件最后一个 TOPIC_TAG 条目末尾有没有逗号？从已有格式看是有的
    new_tag_lines.append(f"  {{ id: '{t['id']}', category: '{t['category']}', label: '{t['label']}', emoji: '{t['emoji']}', minGrade: {t['minGrade']}, hint: '{t['hint']}' }},{comma}")

# 4. 执行插入（从后往前，避免行号漂移）
new_lines = list(lines)

# 先插新标签到 TOPIC_TAGS
# 找到 TOPIC_TAGS 里最后一个条目的位置（从后往前找 hint: 行）
for i in range(len(new_lines) - 1, -1, -1):
    if re.search(r"hint: '[^']+'\s*\},?\s*$", new_lines[i]):
        # 在这行后面插入新标签
        new_lines = new_lines[:i+1] + new_tag_lines + new_lines[i+1:]
        break

# 再插新题到各标签数组（从后往前）
# 先处理已有标签的追加，再处理新标签的创建
# 重新计算行号（因为上面插了标签，行号变了）
# 简单做法：重新 split，重新找闭合位置
raw2 = '\r\n'.join(new_lines)
lines2 = raw2.split('\r\n')

tag_block_ends2 = {}
for i, line in enumerate(lines2):
    m = TAG_RE.match(line)
    if m:
        tag_block_ends2[m.group(1)] = None
        continue
    if line.rstrip() == '  ],' and None in tag_block_ends2.values():
        for t in list(tag_block_ends2.keys()):
            if tag_block_ends2[t] is None:
                tag_block_ends2[t] = i
                break

# 对每个要追加题的标签
for tag_id, items in templates.items():
    if tag_id in tag_block_ends2:
        # 追加到已有数组
        insert_at = tag_block_ends2[tag_id]
        q_lines = []
        for it in items:
            q_lines.append(f"    {{ title: '{it['title']}', lead: '{it['lead']}', scenes: [PHOTO_SLOT] }},")
        lines2 = lines2[:insert_at] + q_lines + lines2[insert_at:]
        # 更新后续行号（简单：重新算一遍）
        raw2 = '\r\n'.join(lines2)
        lines2 = raw2.split('\r\n')
        tag_block_ends2 = {}
        for i, line in enumerate(lines2):
            m = TAG_RE.match(line)
            if m:
                tag_block_ends2[m.group(1)] = None
                continue
            if line.rstrip() == '  ],' and None in tag_block_ends2.values():
                for t in list(tag_block_ends2.keys()):
                    if tag_block_ends2[t] is None:
                        tag_block_ends2[t] = i
                        break
    else:
        # 新标签：在最后一个数组后面新建
        last_tag = max(tag_block_ends2.keys(), key=lambda k: tag_block_ends2[k])
        insert_at = tag_block_ends2[last_tag] + 1  # 在 '  ],' 后面
        block = [f"  {tag_id}: ["]
        for it in items:
            block.append(f"    {{ title: '{it['title']}', lead: '{it['lead']}', scenes: [PHOTO_SLOT] }},")
        block.append("  ],")
        lines2 = lines2[:insert_at] + block + lines2[insert_at:]
        # 重新算
        raw2 = '\r\n'.join(lines2)
        lines2 = raw2.split('\r\n')
        tag_block_ends2 = {}
        for i, line in enumerate(lines2):
            m = TAG_RE.match(line)
            if m:
                tag_block_ends2[m.group(1)] = None
                continue
            if line.rstrip() == '  ],' and None in tag_block_ends2.values():
                for t in list(tag_block_ends2.keys()):
                    if tag_block_ends2[t] is None:
                        tag_block_ends2[t] = i
                        break

# 5. 校验
out = '\r\n'.join(lines2)
expected_crlf = raw.count('\r\n') + new_total + len(new_tags) + sum(2 for _ in templates)  # 每个新数组 +2 行（头尾）
assert out.count('\r\n') == expected_crlf, f'CRLF 数量不对: {out.count(chr(13)+chr(10))} != {expected_crlf}'
assert out.count('\n') - out.count('\r\n') == 0, '混进了裸 LF'

new_count = 0
for line in lines2:
    if ONE_RE.match(line) or MT.match(line):
        new_count += 1
assert new_count == orig_count + new_total, f'题数不对: {new_count} != {orig_count} + {new_total}'

# 检查新标签都在 TOPIC_TAGS 里
for t in new_tags:
    assert f"id: '{t['id']}'" in out, f"标签 {t['id']} 没插进 TOPIC_TAGS"
    assert f"  {t['id']}: [" in out, f"标签 {t['id']} 没建数组"

print(f'校验通过: {orig_count} + {new_total} = {new_count} 题')
print(f'行数: {len(lines)} -> {len(lines2)}')

# 6. 写盘
if '--write' in sys.argv:
    io.open(SRC, 'w', encoding='utf-8', newline='').write(out)
    print('已写入', SRC)
else:
    print('干跑完成，加 --write 才写盘')
    # 写一份到临时文件供检查
    io.open(SRC + '.new', 'w', encoding='utf-8', newline='').write(out)
    print('预览已写入', SRC + '.new')
