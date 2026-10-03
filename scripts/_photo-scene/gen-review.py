# -*- coding: utf-8 -*-
"""生成一份可读的审阅页：126 道新题，按题材分组，标出跟现有题重名的。
输出 library-new-questions.html（项目根目录，跟 library-browse.html 并排）。
"""
import re, json, io, sys, collections, html
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

cat = {e['key']: e for e in json.load(open('scripts/_photo-scene/scene-catalog.json', encoding='utf-8'))}
nq = json.load(open('scripts/_photo-scene/new-questions.json', encoding='utf-8'))
SRC = open('src/domain/prompts.ts', encoding='utf-8').read()

# id -> label / category / emoji / hint
tags = {}
for m in re.finditer(r"\{ id: '([a-z0-9-]+)', category: '([a-z-]+)', label: '([^']+)', emoji: '([^']+)', minGrade: (\d+)", SRC):
    tags[m.group(1)] = {'cat': m.group(2), 'label': m.group(3), 'emoji': m.group(4), 'min': int(m.group(5))}

CAT = {'scene': '写景', 'person': '写人', 'event': '写事', 'object': '状物', 'imagine': '想象'}

existing = set(re.findall(r"title: '((?:[^'\\]|\\.)*)'", SRC))

def esc(s):
    return html.escape(s, quote=True)

by_tag = collections.defaultdict(list)
for e in nq:
    by_tag[e['tag']].append(e)

rows = []
for tag in sorted(by_tag, key=lambda t: (CAT.get(tags.get(t, {}).get('cat', ''), 'zz'), -len(by_tag[t]))):
    info = tags.get(tag, {'label': tag, 'emoji': '?', 'cat': '', 'min': 0})
    items = by_tag[tag]
    clash = sum(1 for e in items if e['title'] in existing)
    rows.append('<h2>%s %s <span class="sub">%s · %d 道%s</span></h2>' % (
        info['emoji'], esc(info['label']), CAT.get(info['cat'], ''),
        len(items), ' · <b class="warn">%d 道跟现有题重名</b>' % clash if clash else ''))
    rows.append('<table><thead><tr><th class="c1">插画</th><th class="c2">新题标题</th><th>引导语</th></tr></thead><tbody>')
    for e in items:
        k = e['key']
        label = cat.get(k, {}).get('label', k)
        hint = cat.get(k, {}).get('hint', '')
        dup = e['title'] in existing
        rows.append(
            '<tr%s><td class="c1"><span class="key">%s</span><br><b>%s</b></td>'
            '<td class="c2">%s%s</td><td>%s<br><span class="hint">%s</span></td></tr>' % (
                ' class="dup"' if dup else '',
                esc(k), esc(label),
                esc(e['title']),
                ' <span class="badge">重名</span>' if dup else '',
                esc(e['lead']), esc(hint)))

clashes = [(e['key'], e['title']) for e in nq if e['title'] in existing]
clash_html = ''.join('<li><b>%s</b> <span class="key">%s</span></li>' % (esc(t), esc(k)) for k, t in clashes)

doc = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>看图作文 · 126 道新题（审阅稿）</title>
<style>
 :root { --bg:#fdf8ef; --panel:#fff; --ink:#3b3228; --sub:#8a7c68; --line:#e8ddc9;
         --accent:#c96a3a; --warn:#b4552a; --dupbg:#fdf1e6; }
 * { box-sizing:border-box; }
 body { margin:0; padding:28px 20px 60px; background:var(--bg); color:var(--ink);
        font:15px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif; }
 .wrap { max-width:1080px; margin:0 auto; }
 h1 { font-size:24px; margin:0 0 6px; }
 .lead { color:var(--sub); margin:0 0 22px; }
 .lead b { color:var(--ink); }
 .box { background:var(--panel); border:1px solid var(--line); border-radius:12px;
        padding:16px 18px; margin:0 0 24px; }
 .box h3 { margin:0 0 8px; font-size:16px; color:var(--warn); }
 .box ul { margin:6px 0 0; padding-left:20px; columns:3; column-gap:26px; }
 .box li { break-inside:avoid; }
 h2 { font-size:17px; margin:30px 0 10px; padding-bottom:6px; border-bottom:2px solid var(--line); }
 .sub { font-weight:400; font-size:13px; color:var(--sub); }
 .warn { color:var(--warn); }
 table { width:100%; border-collapse:collapse; background:var(--panel);
         border:1px solid var(--line); border-radius:10px; overflow:hidden; }
 th, td { padding:9px 12px; text-align:left; vertical-align:top; border-top:1px solid var(--line); }
 th { background:#f6efe2; font-size:13px; color:var(--sub); font-weight:600; }
 tbody tr:first-child td { border-top:none; }
 tr.dup { background:var(--dupbg); }
 .c1 { width:150px; } .c2 { width:170px; }
 .key { font-family:ui-monospace,Menlo,monospace; font-size:11px; color:var(--sub); }
 .hint { font-size:12px; color:var(--sub); }
 .badge { display:inline-block; font-size:11px; padding:1px 6px; border-radius:20px;
          background:#f6d9c4; color:var(--warn); vertical-align:1px; }
 code { background:#f6efe2; padding:1px 5px; border-radius:4px; font-size:12px; }
</style></head><body><div class="wrap">
<h1>看图作文 · 126 道新题（审阅稿）</h1>
<p class="lead">每张插画配一道题，<b>一道题只有一张图</b>。下面是全部 126 道，按题材分组，
灰字是插画自带的画面说明（写引导语时照着它写的，不凭空加画面里没有的东西）。<br>
 ⚠️ <b>__N__ 道</b>的标题跟现有 144 道题撞了 —— 因为它们本来就是从同一张插画来的，已标黄。</p>
<div class="box"><h3>__N__ 道标题跟现有题重名</h3><ul>__CLASH__</ul></div>
__ROWS__
</div></body></html>"""
# ⚠️ 不能用 % 格式化 —— CSS 里有 `width:100%`，会把 % 当成占位符
doc = (doc.replace('__N__', str(len(clashes)))
          .replace('__CLASH__', clash_html)
          .replace('__ROWS__', '\n'.join(rows)))

open('library-new-questions.html', 'w', encoding='utf-8').write(doc)
print('写好了 library-new-questions.html')
print('新题:', len(nq), ' 分组:', len(by_tag), ' 重名:', len(clashes))
