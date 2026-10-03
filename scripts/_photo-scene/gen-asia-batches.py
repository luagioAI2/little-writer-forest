# -*- coding: utf-8 -*-
"""把 45 条「不符合亚洲/中国」的工单切成 5 批。

★ 每条的关键词是**人工定的**（照抄标题会搜回同样的欧美图）。
★ `must` 里**必须写死排除项** —— 上一轮就是只写"要什么"、没写"不要什么"，
  才会配回白人老人、美国校车、欧洲小镇（见 2026-09-28.md §5）。
"""
import json, re, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

audit = json.load(open('scripts/_photo-scene/asian-audit.json', encoding='utf-8'))
overlay = json.load(open('src/data/library-items.json', encoding='utf-8'))

used = set()
for ov in overlay.values():
    for u in (ov.get('imageUrls') or []):
        m = re.search(r'/photos/(\d+)/', u or '')
        if m:
            used.add(m.group(1))

# (query, must) —— key 是 (id, slot)
SPEC = {
    ('builtin-activity-1', 0): ('chinese school sports day running track',
        '中国小学运动会：红跑道 + 亚洲孩子跑步。不要韩服、不要白人'),
    ('builtin-activity-2', 0): ('china tour bus school trip',
        '中国的大巴/旅游车（不要美国黄色校车）。车或孩子要像中国'),
    ('builtin-comic-1', 0): ('chinese comic book page',
        '漫画书页（中文或中文风格最好）。不要纯英文漫画'),
    ('builtin-comic-2', 0): ('comic strip panels illustration',
        '漫画分格。画面里**不要出现英文大字**'),
    ('builtin-campus-3', 0): ('asian child sweeping floor broom',
        '亚洲孩子拿着扫帚在室内扫地。要彩色，不要黑白；不要白人孩子'),
    ('builtin-classmate-1', 0): ('asian students writing desk classroom',
        '亚洲学生坐在课桌前写字。不要浅色/金色头发'),
    ('builtin-classmate-2', 0): ('asian girl laughing smiling',
        '亚洲女孩在笑，笑脸看得见。不要中东/南亚面孔'),
    ('builtin-community-helper-2', 0): ('chinese police officer uniform',
        '中国警察（深蓝制服）。**不要美国 POLICE 背心**'),
    ('builtin-community-helper-3', 0): ('asian librarian library bookshelf',
        '亚洲图书馆员。不要中东/非洲面孔'),
    ('builtin-community-helper-4', 0): ('chinese bus driver steering wheel',
        '中国公交司机。不要白人男性'),
    ('builtin-dream-2', 0): ('astronaut helmet space suit',
        '宇航员/宇航服。★ **头盔上不许出现 CCCP / 苏联字样**'),
    ('builtin-dream-job-2', 0): ('asian children walking together',
        '亚洲孩子（和大人）走在路上。不要西方人'),
    ('builtin-family-1', 0): ('asian mother cooking kitchen wok',
        '亚洲妈妈在做饭（中式厨房更好）。不要欧式乡村厨房'),
    ('builtin-family-2', 0): ('chinese grandfather garden vegetables',
        '中国爷爷在菜园。不要白人老人'),
    ('builtin-family-3', 0): ('asian baby crib',
        '亚洲婴儿在婴儿床里。不要浅色头发/很白的皮肤'),
    ('builtin-family-3', 1): ('asian baby feet blanket',
        '亚洲婴儿的小脚。不要很白的皮肤'),
    ('builtin-family-5', 0): ('asian grandmother knitting wool',
        '亚洲奶奶在织毛衣（人要在画面里）。不要白人老人'),
    ('builtin-family-6', 0): ('asian elderly woman vegetables basket',
        '亚洲老奶奶拎着菜篮。不要南亚男性面孔'),
    ('builtin-first-time-1', 1): ('asian child bicycle park',
        '亚洲孩子骑车。不要西式公园小路'),
    ('builtin-first-time-3', 0): ('asian children stage performance costume',
        '亚洲孩子在台上表演。不要西方孩子'),
    ('builtin-future-1', 0): ('modern school building asia',
        '现代学校建筑。尽量亚洲/中国（不要纯欧美造型）'),
    ('builtin-hometown-3', 0): ('chinese village river stone bridge',
        '中国乡村的河 + 石桥。**不要欧洲小镇/尖塔**'),
    ('builtin-if-i-2', 0): ('asian girl field wind hair',
        '亚洲女孩在田野里。不要浅棕/金色头发'),
    ('builtin-letter-2', 0): ('chinese writing letter paper pen',
        '写信（中文/中式文具最好）。画面里**不要英文手写体**'),
    ('builtin-lost-found-1', 0): ('chinese street crowd city',
        '中国城市街景（中文招牌最好）。**不要 PARIS 之类的外文招牌**'),
    ('builtin-lost-found-1', 1): ('asian child grass park running',
        '亚洲孩子在草地/公园。不要金发孩子'),
    ('builtin-lost-found-2', 0): ('asian child helping classmate up',
        '亚洲孩子伸手拉同学起来。不要西方人、不要欧美街道'),
    ('builtin-milestone-4', 0): ('asian schoolchildren playground uniform',
        '亚洲小学生（中国校服最好）。不要非洲/南亚面孔'),
    ('builtin-mistake-1', 0): ('asian mother child talking',
        '亚洲妈妈和孩子。不要西方母子'),
    ('builtin-mistake-3', 0): ('chinese school gate children uniform',
        '中国校门/校服。不要西式校舍'),
    ('builtin-mistake-4', 0): ('asian boy studying desk lamp',
        '亚洲男孩在书桌前学习。不要浅色头发'),
    ('builtin-people-around-1', 0): ('asian people walking street crowd',
        '亚洲人群。不要一排外国国旗、不要浅肤色为主的画面'),
    ('builtin-people-around-2', 0): ('chinese city street pedestrians crowd',
        '中国城市街道 + 行人。不要美式高楼 + 国旗'),
    ('builtin-season-3', 1): ('chinese winter snow courtyard house',
        '中式院子/房子下雪。不要西式木屋'),
    ('builtin-stranger-1', 0): ('chinese street cleaner sweeping road',
        '中国环卫工扫地（橙色工装最好）。**不要伦敦红色双层巴士**'),
    ('builtin-stranger-2', 0): ('chinese food delivery rider rain scooter',
        '中国外卖骑手（黄/蓝工装最好）。不要东南亚街景'),
    ('builtin-teacher-1', 0): ('chinese teacher blackboard classroom students',
        '中国老师 + 黑板 + 学生。**黑板上不要出现德语/英文**'),
    ('builtin-teacher-2', 0): ('asian teacher classroom children',
        '亚洲老师 + 教室里的孩子。不要金发老师、不要西式教室'),
    ('builtin-treasure-7', 0): ('asian treehouse wooden garden',
        '亚洲院子里的树屋。不要西式木屋'),
    ('builtin-unforgettable-1', 0): ('asian mother children reading book',
        '亚洲妈妈和孩子一起看书。不要西方/拉美家庭'),
    ('builtin-unforgettable-2', 0): ('china tour bus school trip',
        '中国旅游大巴（不要美国黄色校车）'),
    ('builtin-water-1', 0): ('chinese village river houses boat',
        '中国水乡/村落的河。**不要欧洲红顶小镇 + 教堂尖塔**'),
    ('builtin-weather-2', 1): ('rainbow over chinese village houses',
        '彩虹 + 中式房子/村落。不要欧洲房子'),
    ('builtin-weather-3', 0): ('foggy morning chinese street',
        '雾天早晨的中国街道。不要欧洲雾天街景'),
    ('builtin-weather-4', 0): ('chinese street rain umbrella',
        '下雨的中国街道 + 打伞的人。不要欧洲雨天街景'),
}

items = []
for a in audit:
    key = (a['id'], a['slot'])
    spec = SPEC.get(key)
    if not spec:
        raise SystemExit('这条没给关键词：%s' % (key,))
    q, must = spec
    items.append({
        'id': a['id'], 'slot': a['slot'], 'title': a['title'],
        'level': a['level'], 'whyBad': a['why'],
        'query': q, 'must': must,
        'replaceUrl': a['url'], 'replaceId': a['pexelsId'],
    })

print('工单:', len(items))
N = 9
for b in range((len(items) + N - 1) // N):
    chunk = items[b * N:(b + 1) * N]
    out = {'batch': chr(65 + b), 'usedPexelsIds': sorted(used), 'items': chunk}
    p = 'scripts/_photo-scene/asia-batch-%02d.json' % (b + 1)
    json.dump(out, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    print('→ %s  %d 条' % (p, len(chunk)))
print('已用编号', len(used), '个（子代理要避开）')
