# -*- coding: utf-8 -*-
"""生成 50 道新题配图的搜图清单，切成 5 批（每批 10 条）。"""
import io
import json
import os

# (序号, tag, 标题, 引导语, 英文搜索关键词, 额外要求)
ITEMS = [
    (1, 'season', '冬天的暖阳', '冬天的太阳晒在身上暖暖的。你最喜欢在哪儿晒？',
     'winter sunlight through window warm cozy room', '室内暖光/冬日阳光，不要雪景特写'),
    (2, 'weather', '刮风了', '风把树吹得哗哗响，晾着的衣服也飘起来了。',
     'strong wind blowing tree branches autumn', '要能看出"风很大"：树弯、叶飞'),
    (3, 'water', '山里的瀑布', '水从高处冲下来，声音老远就听得见。',
     'waterfall mountain rocks stream', '要有落差的水流，不要海景'),
    (4, 'campus', '教室的窗边', '上课的时候，你偷偷往窗外看过什么？',
     'classroom window desk sunlight school', '教室内的窗边视角，不要空房间'),
    (5, 'night', '路灯下的影子', '路灯把我的影子拉得老长。你踩得到它吗？',
     'street lamp night road light glow', '夜晚路灯，地面上最好有光影'),
    (6, 'home-scene', '客厅的沙发', '沙发上总有一个位置是你常坐的。为什么是那儿？',
     'cozy living room sofa cushion home', '居家客厅，暖调'),
    (7, 'travel', '古镇的早晨', '石板路还湿着，两边的店铺刚开门。你最先闻到什么？',
     'old town street morning alley ancient', '老街/石板路，清晨安静感'),
    (8, 'travel', '博物馆里的一天', '展柜里的东西都隔着玻璃。你最想凑近看哪一件？',
     'museum exhibition hall display visitors', '展厅/展柜，不要单件文物特写'),
    (9, 'culture', '故宫的红墙', '红墙很高，路很长，走过去要花不少时间。你在想什么？',
     'red wall chinese palace temple', '中式红墙/宫墙'),
    (10, 'culture', '桥上的石狮子', '老桥的栏杆上蹲着一排石狮子。你数得清吗？',
     'stone lion statue bridge chinese', '石狮子石雕，最好在桥/栏杆上'),
    (11, 'hometown', '回家的那条小路', '从村口到家要走过一条小路。路上有什么？',
     'countryside path village road field', '乡间小路'),
    (12, 'family', '爸爸的呼噜声', '夜里，爸爸的呼噜一阵一阵的。你被吵醒过吗？',
     'man sleeping on sofa living room', '睡觉的人（可侧脸/背影，不要正脸特写）'),
    (13, 'teacher', '老师嗓子哑了', '老师说话的声音变小了，还站在讲台上。那天你怎么做的？',
     'teacher standing classroom blackboard teaching', '讲台前的老师（背影/侧身更好）'),
    (14, 'classmate', '我们吵架了', '因为一件小事，我们俩谁也不理谁。后来呢？',
     'two children sitting apart back to back', '两个孩子背对背/分开坐，不要正脸'),
    (15, 'stranger', '公园里练字的老爷爷', '他提着一支大毛笔，在地上写字。你停下来看过吗？',
     'old man writing calligraphy brush water ground', '地书/练字，可只要笔与字迹'),
    (16, 'community-helper', '小区里的园丁', '花坛里的花开得正好，都是他种的。你注意过他的手吗？',
     'gardener planting flowers hands soil', '园丁的手/种花动作，不要花海特写'),
    (17, 'self', '我的名字', '你的名字是谁取的？它有什么来历？',
     'child hand writing name notebook pencil', '写字的手与纸，不要人脸'),
    (18, 'self', '我长高了', '门框上那道铅笔线，又往上挪了一格。',
     'measuring height wall pencil mark child', '身高刻度/墙上的铅笔线'),
    (19, 'people-around', '楼下下棋的爷爷们', '棋盘一摆，围过来一圈人。他们在争什么？',
     'old men playing chess park table', '下棋场景（俯拍/侧拍更好，避免正脸）'),
    (20, 'people-around', '广场上跳舞的奶奶', '音乐一响，她们就排好了队。你留意过谁？',
     'elderly women dancing outdoor square', '广场舞/集体舞（远景，避免正脸）'),
    (21, 'dream-job', '我想当一名老师', '站在讲台上，你会怎么讲第一节课？',
     'teacher in front of classroom students', '讲台与黑板，老师可背影'),
    (22, 'dream-job', '如果我是厨师', '灶台前围裙一系，你打算先做哪一道菜？',
     'chef cooking kitchen apron pan', '厨房烹饪动作'),
    (23, 'first-time', '第一次坐火车', '车窗外的树一棵接一棵往后跑。你数得过来吗？',
     'train window view countryside landscape', '火车窗外风景（从车窗里往外看）'),
    (24, 'unforgettable', '那一次我哭了', '有一件事让我掉了眼泪。现在想起来，是什么感觉？',
     'sad child crying comfort hug', '安慰/难过（不要脸部特写，背影或手更好）'),
    (25, 'warm-moment', '借我半块橡皮', '考试时我忘了带橡皮，同桌掰了一半递过来。',
     'pencil eraser desk school stationery', '橡皮与铅笔在课桌上'),
    (26, 'activity', '学校的读书节', '教室里摆满了书，大家挑得眼花缭乱。你挑了哪一本？',
     'children reading books classroom library', '孩子读书/挑书（远景，避免正脸）'),
    (27, 'mistake', '弄丢的那本书', '从图书馆借的书找不到了，我把书包翻了个底朝天。',
     'child looking inside backpack searching', '翻书包/找东西，不要正脸'),
    (28, 'lost-found', '突然停电了', '灯一下子全灭了，屋里黑得看不见手指。',
     'dark room candle blackout night', '昏暗/烛光，不要恐怖氛围'),
    (29, 'milestone', '我学会游泳了', '第一次不用浮板游到对岸，那是什么感觉？',
     'child swimming pool water learning', '泳池戏水（远景，避免正脸特写）'),
    (30, 'observe', '豆子发芽了', '泡在水里的豆子，第三天冒出了小白芽。',
     'bean sprouts growing jar germination', '发芽的豆子/水培'),
    (31, 'letter', '给老师的一封信', '快毕业了，有些话想写在信里告诉老师。',
     'writing letter paper pen envelope desk', '写信的桌面：信纸、笔'),
    (32, 'look-picture', '图上的那个下午', '图里的人都停在一瞬间。接下来会发生什么？',
     'children playing park afternoon bench', '公园午后有人活动（远景）'),
    (33, 'look-picture', '四幅图，一件事', '四幅图按顺序排好，把它们连成一件完整的事。',
     'four picture frames on wall gallery', '墙上并排的相框（数量感）'),
    (34, 'custom', '端午的粽子', '粽叶在手里一折，米就装进去了。你会包吗？',
     'zongzi rice dumpling bamboo leaves', '粽子/包粽子'),
    (35, 'custom', '元宵看花灯', '街上挂满了花灯，人挤着人往前挪。你猜中了哪个灯谜？',
     'chinese lanterns festival night red', '红灯笼/花灯夜景'),
    (36, 'comic', '等一等再摘', '漫画里的果子还没熟，有人已经伸手了。你看懂了什么？',
     'unripe green fruit on tree branch', '未熟的青果在枝头'),
    (37, 'comic', '各扫门前雪', '漫画里两个人各扫一段路，中间的雪谁也没动。这让你想到什么？',
     'person shoveling snow winter street', '扫雪（可只要雪与铁锹）'),
    (38, 'pet', '蚂蚁搬家', '一队蚂蚁排着长队往前爬。它们要去哪儿？',
     'ants marching in a line on ground', '蚂蚁队列（微距）'),
    (39, 'plant', '窗外的梧桐树', '它一年四季都在变。你见过它哪几种样子？',
     'large tree outside window branches', '从窗口看大树'),
    (40, 'stationery', '削笔刀', '转几圈，铅笔就尖了，下面堆着一层木屑。',
     'pencil sharpener wood shavings pencil', '削笔刀与木屑'),
    (41, 'treasure', '爸爸送的手表', '表带有点松了，可我一直戴着。它是什么时候送的？',
     'wristwatch on wrist close up', '戴在手腕上的表'),
    (42, 'food', '奶奶做的红烧肉', '一掀锅盖，满屋子都是香味。你等得及吗？',
     'braised pork belly chinese dish bowl', '红烧肉/中式炖肉'),
    (43, 'life-goods', '门口的擦鞋垫', '进门之前先在它上面踩两脚。你注意过它吗？',
     'doormat entrance front door welcome mat', '门口地垫'),
    (44, 'if-i', '假如我有一支神笔', '画什么就有什么。你第一笔会画什么？',
     'hand holding paintbrush painting paper', '握画笔的手与画纸'),
    (45, 'future', '未来的家', '一进门灯就自己亮了，饭也刚好做好。你还想要什么？',
     'futuristic smart home modern interior', '现代/未来感家居'),
    (46, 'fairy', '《狐狸和乌鸦》新编', '乌鸦这次没开口，狐狸又想出了什么办法？',
     'fox in forest wildlife', '狐狸（野外实拍或雕塑均可）'),
    (47, 'talking', '如果台灯会说话', '它每天晚上都亮着陪你，肯定有话想说。',
     'desk lamp on table warm light night', '桌上的台灯亮着'),
    (48, 'dream', '我梦见自己会飞', '梦里的风从耳边吹过去。你飞过了哪些地方？',
     'sky above clouds bird flying view', '云上天空/俯瞰视角'),
    (49, 'sci-fi', '会飞的汽车', '堵车时按一下按钮，它就升到了半空。',
     'futuristic flying car concept sky', '未来交通工具/飞行器'),
    (50, 'deform', '我变成了一棵树', '脚扎进土里，手臂变成了树枝。谁会在你身上做窝？',
     'tree trunk branches from below looking up', '从下往上看树冠'),
]

assert len(ITEMS) == 50, len(ITEMS)

os.makedirs('scripts/_new50', exist_ok=True)
with io.open('scripts/_new50/worklist.json', 'w', encoding='utf-8', newline='\n') as f:
    json.dump(
        [
            {'n': n, 'tag': t, 'title': ti, 'lead': ld, 'keyword': kw, 'note': note}
            for n, t, ti, ld, kw, note in ITEMS
        ],
        f, ensure_ascii=False, indent=2,
    )

for b in range(5):
    chunk = ITEMS[b * 10:(b + 1) * 10]
    with io.open(f'scripts/_new50/batch-{b+1:02d}.json', 'w', encoding='utf-8', newline='\n') as f:
        json.dump(
            [
                {'n': n, 'tag': t, 'title': ti, 'lead': ld, 'keyword': kw, 'note': note}
                for n, t, ti, ld, kw, note in chunk
            ],
            f, ensure_ascii=False, indent=2,
        )
    print(f'batch-{b+1:02d}.json  {len(chunk)} 条  n={chunk[0][0]}..{chunk[-1][0]}')
