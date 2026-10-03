# -*- coding: utf-8 -*-
"""把「一图一题」落进 src/domain/prompts.ts：
   ① 现有 144 道题的 scenes 全部换成同长度的 PHOTO_SLOT（保住图位个数）—— 它们变成纯照片题
   ② 把 126 道新题追加到各自题材标签数组的**末尾**（题号按下标拼，只能追加）
   ③ 插入 PHOTO_SLOT 常量
先备份，再改，改完自己验一遍。
"""
import re, json, io, sys, shutil, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

SRC = 'src/domain/prompts.ts'
BAK = 'scripts/_photo-scene/prompts.before-270.ts'

nq = json.load(open('scripts/_photo-scene/new-questions.json', encoding='utf-8'))
cat = {e['key']: e for e in json.load(open('scripts/_photo-scene/scene-catalog.json', encoding='utf-8'))}

text = open(SRC, encoding='utf-8').read()
shutil.copyfile(SRC, BAK)
print('备份 →', BAK)

# ---- 定位 PROMPT_TEMPLATES 块 -------------------------------------------
start = text.index('export const PROMPT_TEMPLATES')
# 块尾 = 从这个位置起第一个列 0 的 '}'
end = re.search(r"\n\}\n", text[start:]).end() + start
block = text[start:end]

# ---- ① 现有题：scenes 全部换成 PHOTO_SLOT -------------------------------
stripped = 0
slots_kept = 0

def to_photo(m):
    global stripped, slots_kept
    keys = re.findall(r"'([^']*)'", m.group(1))
    n = len(keys)
    stripped += 1
    slots_kept += n
    return 'scenes: [%s]' % ', '.join(['PHOTO_SLOT'] * n)

block2 = re.sub(r"scenes:\s*\[([^\]]*)\]", to_photo, block)
print('① 清空 sceneKey 的题:', stripped, ' 保住的图位:', slots_kept)

# ---- ② 追加 126 道新题 ---------------------------------------------------
def q(s):
    return "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"

by_tag = collections.defaultdict(list)
for e in nq:
    by_tag[e['tag']].append(e)

lines = block2.split('\n')
out = []
cur = None
appended = collections.Counter()
for line in lines:
    mt = re.match(r"^  '?([a-z0-9-]+)'?:\s*\[\s*$", line)
    if mt:
        cur = mt.group(1)
        out.append(line)
        continue
    if line == '  ],' and cur:
        for e in by_tag.get(cur, []):
            out.append("    { title: %s, lead: %s, scenes: ['%s'] },"
                       % (q(e['title']), q(e['lead']), e['key']))
            appended[cur] += 1
        cur = None
        out.append(line)
        continue
    out.append(line)
block3 = '\n'.join(out)
print('② 追加的新题:', sum(appended.values()), ' 落到', len(appended), '个标签')

missing = set(by_tag) - set(appended)
if missing:
    print('  ✗ 这些标签没找到，新题没落进去:', sorted(missing))
    sys.exit(1)

# ---- ③ PHOTO_SLOT 常量 ---------------------------------------------------
CONST = """/**
 * 「纯照片位」的占位 —— **这一格没有插画，只有照片**。
 *
 * 为什么要有它：`PromptTemplate.scenes` 的长度同时承担两个职责 ——
 *   ① 这道题有几个图位  ② 每个图位画哪张插画
 * 纯照片题只需要 ①，不需要 ②。所以用这个空串占位：
 *   · `builtinBaseItems()` 把它转成 `sceneKey: undefined`
 *   · `SceneArt(undefined, imageUrl)` → 画照片；照片没配/挂了 → 「暂无插图」占位框
 *   · `describeImages()` 会因为 `sceneKey` 是空而跳过它（不会给大模型编一段画面描述）
 *
 * ⚠️ 空串是**故意的**：任何真实 sceneKey 都不可能是空串，所以它不会跟插画撞车。
 * ⚠️ 别把它换成 `'photo'` 这类「看着更好懂」的字符串 —— 那就成了一个假 sceneKey，
 *    `builtinLibrary.test.ts` 的「sceneKey 必须真实存在」那条会认它、放它过去，
 *    以后真有人加一个叫 `photo` 的插画就会静默串味。
 */
export const PHOTO_SLOT = ''

/**
 * 一道题的图位长什么样：
 *   · `['spring-park']`        —— 一个图位，画「春天的公园」
 *   · `['', '']`               —— 两个图位，都是纯照片位
 *   · `['bike-fail', '']`      —— 第一个画插画，第二个放照片（连环图混着来）
 *
 * ⚠️ **长度 = 图位个数**，这个不变量别动：覆盖层的 `imageUrls` 按下标补位，
 *    长度一变，家长配过的图就会**静默错位**。
 */
"""
anchor = 'export const PROMPT_TEMPLATES'
block3 = block3.replace(anchor, CONST + anchor, 1)

text = text[:start] + block3 + text[end:]
open(SRC, 'w', encoding='utf-8').write(text)
print('③ PHOTO_SLOT 常量已插入，prompts.ts 已写回')
