/* ============================================================
   世界景点 —— 候选清单（人挑的）
   ============================================================
   ★ 这个文件只写「要哪些景点」。坐标和图片**不在这里编** ——
     由 `scripts/fetch-world-landmarks.mjs` 去 DBpedia 取真值。

   为什么是「人挑」而不是抓一份名录：
     DBpedia 里有 1,074 个世界遗产、全带坐标，但**没有可信的知名度字段**
     （试过用「标签语言数」当代理，全挤在 21-22，区分不出来；里面混着
      `Pannonhalma Archabbey`、`Baradla cave` 这种孩子不可能认识的地方）。
     ➜ 所以「哪个算知名」这个判断由人来做（跟 `landmarks.json` 手工精选 35 条同一个道理），
       DBpedia 只负责**补机器能算准的字段**：坐标、图片、外文名。

   字段：
     zh  简体中文名（给孩子看的）
     c   国家（中文）
     w   DBpedia / 英文维基的条目名 —— **必须能在 dbpedia.org/resource/ 下取到**
     s   画面类型（PhotoScene 十选一，palette 由它派生）
     b   一句话介绍，孩子看得懂

   ⚠️ `w` 写错的后果：那条会被抓取脚本报成「取不到」，**不会静默消失**
     （脚本最后会打印失败清单）。名字拿不准就先跑一遍看报告。

   ⚠️ 港澳台**不在这里** —— 它们是中国的一部分，已经在 `landmarks.json` 里了。
   ============================================================ */

/** 十种画面类型（与 types.ts 的 PhotoScene 一一对应） */
export const SCENES = [
  'mountain', 'water', 'city', 'desert', 'forest',
  'snow', 'temple', 'coast', 'grass', 'cave',
]

export const WORLD_SEED = [
  /* ---------------- 亚洲 ---------------- */
  { zh: '富士山', c: '日本', w: 'Mount_Fuji', s: 'mountain', b: '日本最高的山，山顶一年到头盖着雪，像戴了顶白帽子。' },
  { zh: '金阁寺', c: '日本', w: 'Kinkaku-ji', s: 'temple', b: '外墙贴满金箔的寺庙，倒映在池子里金光闪闪。' },
  { zh: '严岛神社', c: '日本', w: 'Itsukushima_Shrine', s: 'temple', b: '红色的大鸟居立在海里，涨潮时像浮在水面上。' },
  { zh: '浅草寺', c: '日本', w: 'Sensō-ji', s: 'temple', b: '东京最老的寺庙，门口挂着一只巨大的红灯笼。' },
  { zh: '东京塔', c: '日本', w: 'Tokyo_Tower', s: 'city', b: '红白相间的铁塔，晚上亮起来像一座灯塔。' },
  { zh: '奈良公园', c: '日本', w: 'Nara_Park', s: 'forest', b: '公园里的小鹿会向人点头要饼干吃。' },

  { zh: '景福宫', c: '韩国', w: 'Gyeongbokgung', s: 'city', b: '首尔最大的宫殿，屋檐一层一层往上翘。' },
  { zh: '南山首尔塔', c: '韩国', w: 'N_Seoul_Tower', s: 'city', b: '建在山顶的塔，晚上能看到整个首尔的灯。' },
  { zh: '济州岛', c: '韩国', w: 'Jeju_Island', s: 'coast', b: '火山喷出来的岛，海边全是黑黑的石头。' },

  { zh: '大皇宫', c: '泰国', w: 'Grand_Palace', s: 'temple', b: '泰国王宫，屋顶金灿灿的，尖角一直戳到天上。' },
  { zh: '郑王庙', c: '泰国', w: 'Wat_Arun', s: 'temple', b: '河边的塔贴满瓷片，太阳一照会反光。' },
  { zh: '皮皮岛', c: '泰国', w: 'Phi_Phi_Islands', s: 'coast', b: '海水清得能看见海底，两边是陡陡的石灰岩山。' },

  { zh: '泰姬陵', c: '印度', w: 'Taj_Mahal', s: 'temple', b: '白色大理石造的陵墓，倒影在长水池里像一幅画。' },
  { zh: '恒河', c: '印度', w: 'Ganges', s: 'water', b: '印度人心中最神圣的河，天没亮就有人在河边沐浴。' },
  { zh: '琥珀堡', c: '印度', w: 'Amber_Fort', s: 'city', b: '建在山上的黄色城堡，有镜子宫殿和水道。' },
  { zh: '金庙', c: '印度', w: 'Golden_Temple', s: 'temple', b: '屋顶镀金的庙，四面被水包围，谁都能进去吃免费饭。' },

  { zh: '吴哥窟', c: '柬埔寨', w: 'Angkor_Wat', s: 'temple', b: '藏在丛林里的巨大石头寺庙，墙上刻满了故事。' },
  { zh: '婆罗浮屠', c: '印度尼西亚', w: 'Borobudur', s: 'temple', b: '一座用石头垒成的金字塔，每一层都刻着佛像。' },
  { zh: '巴厘岛', c: '印度尼西亚', w: 'Bali', s: 'coast', b: '稻田一层层像台阶，海边有神庙立在礁石上。' },
  { zh: '下龙湾', c: '越南', w: 'Hạ_Long_Bay', s: 'water', b: '海面上立着上千座石头小山，船在中间穿来穿去。' },
  { zh: '双子塔', c: '马来西亚', w: 'Petronas_Towers', s: 'city', b: '两座一模一样的塔，中间用一座天桥连起来。' },
  { zh: '滨海湾金沙', c: '新加坡', w: 'Marina_Bay_Sands', s: 'city', b: '三座楼顶着一艘船，船头是个无边泳池。' },
  { zh: '鱼尾狮', c: '新加坡', w: 'Merlion', s: 'city', b: '狮头鱼身子的白雕像，嘴里整天往外喷水。' },
  { zh: '珠穆朗玛峰', c: '尼泊尔', w: 'Mount_Everest', s: 'snow', b: '世界上最高的地方，空气稀薄得让人喘不上气。' },
  { zh: '狮子岩', c: '斯里兰卡', w: 'Sigiriya', s: 'mountain', b: '一块巨大的石头山，顶上竟然藏着一座宫殿。' },
  { zh: '仰光大金塔', c: '缅甸', w: 'Shwedagon_Pagoda', s: 'temple', b: '整座塔贴满金箔，太阳底下亮得睁不开眼。' },
  { zh: '蒲甘', c: '缅甸', w: 'Bagan', s: 'temple', b: '平原上散落着两千多座佛塔，坐热气球看最壮观。' },
  { zh: '长滩岛', c: '菲律宾', w: 'Boracay', s: 'coast', b: '沙子白得像面粉，踩上去软软的。' },
  { zh: '哭墙', c: '以色列', w: 'Western_Wall', s: 'temple', b: '犹太人最神圣的墙，人们把心愿写在纸条塞进石缝。' },
  { zh: '死海', c: '以色列', w: 'Dead_Sea', s: 'water', b: '水咸得人沉不下去，躺着就能浮在水面上看书。' },
  { zh: '圣索菲亚大教堂', c: '土耳其', w: 'Hagia_Sophia', s: 'temple', b: '巨大的圆顶，做过教堂也做过清真寺。' },
  { zh: '棉花堡', c: '土耳其', w: 'Pamukkale', s: 'water', b: '温泉水流过山坡，结成一层层雪白的梯田。' },
  { zh: '卡帕多西亚', c: '土耳其', w: 'Cappadocia', s: 'desert', b: '到处是尖尖的石头烟囱，热气球早上一起升空。' },
  { zh: '哈利法塔', c: '阿联酋', w: 'Burj_Khalifa', s: 'city', b: '世界上最高的楼，站在顶上能看见沙漠和海的交界。' },
  { zh: '谢赫扎耶德大清真寺', c: '阿联酋', w: 'Sheikh_Zayed_Grand_Mosque', s: 'temple', b: '白色大理石的大清真寺，地上铺着世界上最大的地毯。' },
  { zh: '佩特拉', c: '约旦', w: 'Petra', s: 'desert', b: '玫瑰色的石头城，整座宫殿是从岩壁上凿出来的。' },
  { zh: '波斯波利斯', c: '伊朗', w: 'Persepolis', s: 'desert', b: '古波斯帝国的宫殿遗址，石阶上刻着各国来朝的人。' },
  { zh: '雷吉斯坦广场', c: '乌兹别克斯坦', w: 'Registan', s: 'city', b: '三座蓝色圆顶的神学院围成一个广场。' },
  { zh: '琅勃拉邦', c: '老挝', w: 'Luang_Prabang', s: 'temple', b: '清晨一队橙衣僧侣沿街化缘，安静得像画。' },
  { zh: '泰姬珊瑚礁', c: '马尔代夫', w: 'Maldives', s: 'coast', b: '一千多个小岛，房子直接架在清亮的海水上。' },
  { zh: '戈壁沙漠', c: '蒙古', w: 'Gobi_Desert', s: 'desert', b: '一望无际的石头和沙子，能找到恐龙蛋化石。' },
  { zh: '巴德夏希清真寺', c: '巴基斯坦', w: 'Badshahi_Mosque', s: 'temple', b: '红砂岩砌的大清真寺，能装下几万人一起祈祷。' },
  { zh: '阿拉木图', c: '哈萨克斯坦', w: 'Almaty', s: 'mountain', b: '城市背后就是雪山，苹果据说是从这里传遍世界的。' },
  { zh: '第比利斯老城', c: '格鲁吉亚', w: 'Tbilisi', s: 'city', b: '彩色的老房子挂在河岸上，还有硫磺温泉。' },

  /* ---------------- 欧洲 ---------------- */
  { zh: '埃菲尔铁塔', c: '法国', w: 'Eiffel_Tower', s: 'city', b: '铁做的塔，晚上整点会闪灯，是巴黎最高的地方。' },
  { zh: '卢浮宫', c: '法国', w: 'Louvre', s: 'city', b: '玻璃金字塔下面是世界最大的博物馆，蒙娜丽莎住这儿。' },
  { zh: '凡尔赛宫', c: '法国', w: 'Palace_of_Versailles', s: 'city', b: '宫殿里全是金子和镜子，后花园大得要走一整天。' },
  { zh: '圣米歇尔山', c: '法国', w: 'Mont-Saint-Michel', s: 'coast', b: '涨潮时变成孤岛，退潮后露出大片滩涂。' },
  { zh: '巴黎圣母院', c: '法国', w: 'Notre-Dame_de_Paris', s: 'temple', b: '塞纳河中间岛上的大教堂，两座钟楼爬上去能看怪兽雕像。' },
  { zh: '普罗旺斯薰衣草田', c: '法国', w: 'Provence', s: 'grass', b: '夏天整片山坡变成紫色，风一吹全是香味。' },
  { zh: '大本钟', c: '英国', w: 'Big_Ben', s: 'city', b: '伦敦的大钟楼，整点会敲响很沉的声音。' },
  { zh: '伦敦塔桥', c: '英国', w: 'Tower_Bridge', s: 'city', b: '桥面能像吊桥一样打开，让大船从中间过去。' },
  { zh: '巨石阵', c: '英国', w: 'Stonehenge', s: 'grass', b: '几千年前的巨大石头围成一圈，谁搬来的至今没人知道。' },
  { zh: '白金汉宫', c: '英国', w: 'Buckingham_Palace', s: 'city', b: '英国国王住的地方，卫兵戴着高高的黑帽子站岗。' },
  { zh: '爱丁堡城堡', c: '英国', w: 'Edinburgh_Castle', s: 'city', b: '建在死火山顶上的城堡，能俯瞰整个老城。' },
  { zh: '罗马斗兽场', c: '意大利', w: 'Colosseum', s: 'city', b: '两千年前的古罗马竞技场，能坐下五万人看比赛。' },
  { zh: '比萨斜塔', c: '意大利', w: 'Leaning_Tower_of_Pisa', s: 'city', b: '一座歪着的白塔，越往上越斜，就是不倒。' },
  { zh: '威尼斯', c: '意大利', w: 'Venice', s: 'water', b: '城里没有汽车，出门坐船，房子泡在水里。' },
  { zh: '圣彼得大教堂', c: '意大利', w: "St._Peter's_Basilica", s: 'temple', b: '世界上最大的教堂，圆顶能爬到顶看罗马全城。' },
  { zh: '庞贝古城', c: '意大利', w: 'Pompeii', s: 'city', b: '被火山灰埋掉的古城，街道和灶台都还留着。' },
  { zh: '新天鹅堡', c: '德国', w: 'Neuschwanstein_Castle', s: 'mountain', b: '白色城堡立在山崖上，迪士尼的城堡照它画的。' },
  { zh: '勃兰登堡门', c: '德国', w: 'Brandenburg_Gate', s: 'city', b: '柏林的大石门，顶上驾着四匹马的雕像。' },
  { zh: '科隆大教堂', c: '德国', w: 'Cologne_Cathedral', s: 'temple', b: '两座尖塔像针一样细，盖了六百多年才完工。' },
  { zh: '圣家堂', c: '西班牙', w: 'Sagrada_Família', s: 'temple', b: '高迪设计的教堂，像从地里长出来的石头森林。' },
  { zh: '阿尔罕布拉宫', c: '西班牙', w: 'Alhambra', s: 'city', b: '红墙宫殿，墙上刻满细细的花纹，水池安静得像镜子。' },
  { zh: '贝伦塔', c: '葡萄牙', w: 'Belém_Tower', s: 'coast', b: '河口的白色小塔，当年船队从这里出发去航海。' },
  { zh: '小孩堤防风车', c: '荷兰', w: 'Kinderdijk', s: 'grass', b: '十九座风车排成一排，专门用来把水抽走。' },
  { zh: '布鲁塞尔大广场', c: '比利时', w: 'Grand-Place', s: 'city', b: '四周全是金灿灿的古老行会楼，晚上亮灯最好看。' },
  { zh: '撒尿小童', c: '比利时', w: 'Manneken_Pis', s: 'city', b: '一个光屁股小男孩的铜像，只有半米高。' },
  { zh: '马特洪峰', c: '瑞士', w: 'Matterhorn', s: 'snow', b: '一个尖尖的三角，像被削过的雪糕。' },
  { zh: '少女峰', c: '瑞士', w: 'Jungfrau', s: 'snow', b: '坐火车能一直坐到雪线上面，欧洲最高的车站。' },
  { zh: '美泉宫', c: '奥地利', w: 'Schönbrunn_Palace', s: 'city', b: '黄色的皇宫，后花园里有个能玩捉迷藏的迷宫。' },
  { zh: '哈尔施塔特', c: '奥地利', w: 'Hallstatt', s: 'water', b: '小房子挤在湖边和山坡之间，倒影在水里。' },
  { zh: '雅典卫城', c: '希腊', w: 'Acropolis_of_Athens', s: 'city', b: '山上的神庙只剩柱子，却还是那么威风。' },
  { zh: '圣托里尼', c: '希腊', w: 'Santorini', s: 'coast', b: '白房子蓝圆顶，挂在悬崖上，下面是深蓝的海。' },
  { zh: '红场', c: '俄罗斯', w: 'Red_Square', s: 'city', b: '广场一头是彩色的洋葱头教堂，一头是红墙宫殿。' },
  { zh: '冬宫', c: '俄罗斯', w: 'Hermitage_Museum', s: 'city', b: '绿色的宫殿，里面收藏了几百万件宝贝。' },
  { zh: '贝加尔湖', c: '俄罗斯', w: 'Lake_Baikal', s: 'water', b: '世界上最深的湖，冬天冻成透明的蓝冰。' },
  { zh: '布拉格城堡', c: '捷克', w: 'Prague_Castle', s: 'city', b: '世界上最大的古堡之一，站在山上看着伏尔塔瓦河。' },
  { zh: '查理大桥', c: '捷克', w: 'Charles_Bridge', s: 'city', b: '桥两边站满石头雕像，早上有雾时像走进画里。' },
  { zh: '匈牙利国会大厦', c: '匈牙利', w: 'Hungarian_Parliament_Building', s: 'city', b: '河边的哥特式大楼，晚上灯光照在河面上。' },
  { zh: '维利奇卡盐矿', c: '波兰', w: 'Wieliczka_Salt_Mine', s: 'cave', b: '地下的盐矿，连教堂和吊灯都是盐做的。' },
  { zh: '松恩峡湾', c: '挪威', w: 'Sognefjord', s: 'water', b: '海水伸进山里，两边是笔直的千米悬崖。' },
  { zh: '瓦萨博物馆', c: '瑞典', w: 'Vasa_Museum', s: 'city', b: '一艘沉了三百多年的木船，捞上来还基本完好。' },
  { zh: '圣诞老人村', c: '芬兰', w: 'Santa_Claus_Village', s: 'snow', b: '北极圈上的村子，能寄出盖着北极邮戳的信。' },
  { zh: '小美人鱼', c: '丹麦', w: 'The_Little_Mermaid_(statue)', s: 'coast', b: '坐在港口石头上的小铜像，只有一米多高。' },
  { zh: '蓝湖', c: '冰岛', w: 'Blue_Lagoon_(geothermal_spa)', s: 'water', b: '奶蓝色的温泉，泡在里面脸上还可以抹白泥。' },
  { zh: '莫赫悬崖', c: '爱尔兰', w: 'Cliffs_of_Moher', s: 'coast', b: '两百米高的悬崖直插海里，风大得站不稳。' },
  { zh: '杜布罗夫尼克古城', c: '克罗地亚', w: 'Dubrovnik', s: 'coast', b: '橙顶白墙的老城，绕一圈城墙能看见整片海。' },
  { zh: '布朗城堡', c: '罗马尼亚', w: 'Bran_Castle', s: 'mountain', b: '山顶上的城堡，传说吸血鬼住在这里。' },
  { zh: '布莱德湖', c: '斯洛文尼亚', w: 'Lake_Bled', s: 'water', b: '湖心小岛上有座教堂，划船过去要敲钟许愿。' },
  { zh: '马耳他蓝洞', c: '马耳他', w: 'Blue_Grotto_(Malta)', s: 'coast', b: '岩洞里的海水蓝得发亮，小船能开进去。' },

  /* ---------------- 美洲 ---------------- */
  { zh: '自由女神像', c: '美国', w: 'Statue_of_Liberty', s: 'city', b: '举着火炬的绿铜像，站在纽约港的小岛上。' },
  { zh: '大峡谷', c: '美国', w: 'Grand_Canyon', s: 'desert', b: '大地被河切开一道巨大的口子，深得看不见底。' },
  { zh: '金门大桥', c: '美国', w: 'Golden_Gate_Bridge', s: 'coast', b: '红色的大吊桥，雾一吹过来只剩两座桥塔露在外面。' },
  { zh: '白宫', c: '美国', w: 'White_House', s: 'city', b: '美国总统办公和住的地方，白色的三层小楼。' },
  { zh: '黄石国家公园', c: '美国', w: 'Yellowstone_National_Park', s: 'forest', b: '地上到处冒热气，间歇泉会定时喷出几十米高。' },
  { zh: '尼亚加拉瀑布', c: '美国', w: 'Niagara_Falls', s: 'water', b: '巨大的水墙砸下来，声音像打雷，水雾能淋湿衣服。' },
  { zh: '拉什莫尔山', c: '美国', w: 'Mount_Rushmore', s: 'mountain', b: '四位总统的脸刻在山壁上，每张有十八米高。' },
  { zh: '班夫国家公园', c: '加拿大', w: 'Banff_National_Park', s: 'mountain', b: '湖水绿得像宝石，背后是尖尖的雪山。' },
  { zh: '加拿大国家电视塔', c: '加拿大', w: 'CN_Tower', s: 'city', b: '曾经世界上最高的塔，玻璃地板能看见脚下的城。' },
  { zh: '奇琴伊察', c: '墨西哥', w: 'Chichen_Itza', s: 'forest', b: '玛雅人的石头金字塔，春分那天影子会变成一条蛇。' },
  { zh: '特奥蒂瓦坎', c: '墨西哥', w: 'Teotihuacan', s: 'desert', b: '太阳金字塔和月亮金字塔排在一条大道两边。' },
  { zh: '马丘比丘', c: '秘鲁', w: 'Machu_Picchu', s: 'mountain', b: '建在云里的印加石头城，羊驼在草地上走来走去。' },
  { zh: '纳斯卡线条', c: '秘鲁', w: 'Nazca_Lines', s: 'desert', b: '沙漠上画着巨大的蜂鸟和猴子，只有从天上才看得全。' },
  { zh: '救世基督像', c: '巴西', w: 'Christ_the_Redeemer_(statue)', s: 'city', b: '张开双臂的大雕像，站在山顶望着里约的海湾。' },
  { zh: '亚马逊雨林', c: '巴西', w: 'Amazon_rainforest', s: 'forest', b: '世界上最大的雨林，树高得看不见天，河里还有粉红海豚。' },
  { zh: '伊瓜苏瀑布', c: '巴西', w: 'Iguazu_Falls', s: 'water', b: '两百多条瀑布排成一圈一起往下砸，彩虹整天都在。' },
  { zh: '佩里托莫雷诺冰川', c: '阿根廷', w: 'Perito_Moreno_Glacier', s: 'snow', b: '一面会走路的冰墙，时不时轰一声掉下大冰块。' },
  { zh: '复活节岛', c: '智利', w: 'Easter_Island', s: 'coast', b: '岛上立着近千尊大石头人，全都背朝大海。' },
  { zh: '阿塔卡马沙漠', c: '智利', w: 'Atacama_Desert', s: 'desert', b: '地球上最干的地方，有些地方一辈子没下过雨。' },
  { zh: '乌尤尼盐沼', c: '玻利维亚', w: 'Salar_de_Uyuni', s: 'desert', b: '下过雨以后地面变成一面镜子，人像走在天上。' },
  { zh: '哈瓦那', c: '古巴', w: 'Havana', s: 'city', b: '街上跑着五颜六色的老爷车，房子刷成各种颜色。' },
  { zh: '加拉帕戈斯群岛', c: '厄瓜多尔', w: 'Galápagos_Islands', s: 'coast', b: '岛上的大乌龟和大蜥蜴不怕人，达尔文在这里想通了进化。' },
  { zh: '天使瀑布', c: '委内瑞拉', w: 'Angel_Falls', s: 'water', b: '世界上落差最大的瀑布，水从近千米的悬崖直直落下。' },
  { zh: '蒂卡尔', c: '危地马拉', w: 'Tikal', s: 'forest', b: '丛林里冒出一座座玛雅金字塔，猴子在树顶叫。' },
  { zh: '巴拿马运河', c: '巴拿马', w: 'Panama_Canal', s: 'water', b: '挖通的一条水道，大船坐着"水电梯"翻过山。' },
  { zh: '哥斯达黎加雨林', c: '哥斯达黎加', w: 'Monteverde_Cloud_Forest_Reserve', s: 'forest', b: '云雾飘在树梢上，树懒挂在枝头慢慢挪。' },

  /* ---------------- 非洲 ---------------- */
  { zh: '吉萨金字塔', c: '埃及', w: 'Giza_pyramid_complex', s: 'desert', b: '四千多年前用巨石垒成的三角塔，是古代世界七大奇迹里唯一还在的。' },
  { zh: '狮身人面像', c: '埃及', w: 'Great_Sphinx_of_Giza', s: 'desert', b: '人面狮身的大石像，蹲在金字塔旁边守着。' },
  { zh: '卢克索神庙', c: '埃及', w: 'Luxor_Temple', s: 'desert', b: '巨大的石柱像一片石头森林，柱子上刻满象形文字。' },
  { zh: '阿布辛贝神庙', c: '埃及', w: 'Abu_Simbel', s: 'desert', b: '整座神庙是从山岩里凿出来的，门口坐着四尊巨大的拉美西斯。' },
  { zh: '桌山', c: '南非', w: 'Table_Mountain', s: 'mountain', b: '山顶平得像一张桌子，经常盖着一层"桌布"似的云。' },
  { zh: '好望角', c: '南非', w: 'Cape_of_Good_Hope', s: 'coast', b: '非洲最西南的角，大西洋和印度洋在这里碰头。' },
  { zh: '克鲁格国家公园', c: '南非', w: 'Kruger_National_Park', s: 'grass', b: '南非最大的野生动物园，狮子和大象就住在路边。' },
  { zh: '舍夫沙万', c: '摩洛哥', w: 'Chefchaouen', s: 'city', b: '整座小城刷成蓝色，墙、台阶、花盆全是蓝的。' },
  { zh: '马拉喀什', c: '摩洛哥', w: 'Marrakesh', s: 'city', b: '傍晚的广场上耍蛇的、敲鼓的、卖果汁的全挤在一起。' },
  { zh: '马赛马拉', c: '肯尼亚', w: 'Maasai_Mara', s: 'grass', b: '每年上百万头角马从这里跑过，后面跟着狮子。' },
  { zh: '乞力马扎罗山', c: '坦桑尼亚', w: 'Mount_Kilimanjaro', s: 'snow', b: '赤道边上的雪山，山脚下是热带，山顶却结着冰。' },
  { zh: '塞伦盖蒂', c: '坦桑尼亚', w: 'Serengeti', s: 'grass', b: '无边无际的草原，金合欢树孤零零地立着。' },
  { zh: '拉利贝拉岩石教堂', c: '埃塞俄比亚', w: 'Rock-Hewn_Churches,_Lalibela', s: 'temple', b: '十一座教堂全是从地下的整块岩石里凿出来的。' },
  { zh: '索苏斯维利', c: '纳米比亚', w: 'Sossusvlei', s: 'desert', b: '红色沙丘有三百米高，中间是白色的干盐湖。' },
  { zh: '维多利亚瀑布', c: '津巴布韦', w: 'Victoria_Falls', s: 'water', b: '当地人叫它"轰隆作响的烟雾"，水雾几十公里外都看得见。' },
  { zh: '奥卡万戈三角洲', c: '博茨瓦纳', w: 'Okavango_Delta', s: 'water', b: '河水不流进海里，而是在沙漠中间散成一片水乡。' },
  { zh: '猴面包树大道', c: '马达加斯加', w: 'Avenue_of_the_Baobabs', s: 'grass', b: '路边立着一排胖胖的猴面包树，夕阳下像剪影。' },
  { zh: '戈雷岛', c: '塞内加尔', w: 'Gorée', s: 'coast', b: '小岛上的彩色房子，曾经是大西洋奴隶贸易的中转站。' },

  /* ---------------- 大洋洲 ---------------- */
  { zh: '悉尼歌剧院', c: '澳大利亚', w: 'Sydney_Opera_House', s: 'coast', b: '屋顶像一排张开的白色贝壳，就在海港边上。' },
  { zh: '大堡礁', c: '澳大利亚', w: 'Great_Barrier_Reef', s: 'water', b: '世界上最大的珊瑚礁，从太空都看得见。' },
  { zh: '乌鲁鲁', c: '澳大利亚', w: 'Uluru', s: 'desert', b: '沙漠中间一块巨大的红石头，傍晚会烧成橘红色。' },
  { zh: '十二门徒石', c: '澳大利亚', w: 'Twelve_Apostles_Marine_National_Park', s: 'coast', b: '海边的石灰岩柱子一根根站在浪里，被水冲了几百万年。' },
  { zh: '米尔福德峡湾', c: '新西兰', w: 'Milford_Sound', s: 'water', b: '陡峭的山壁直接落进水里，瀑布从几百米高处挂下来。' },
  { zh: '霍比屯', c: '新西兰', w: 'Hobbiton_Movie_Set', s: 'grass', b: '山坡上一个个圆门的矮房子，是拍电影留下的村子。' },
  { zh: '皇后镇', c: '新西兰', w: 'Queenstown,_New_Zealand', s: 'mountain', b: '湖和雪山围成的小镇，很多人从这里蹦极。' },
  { zh: '大溪地', c: '法属波利尼西亚', w: 'Tahiti', s: 'coast', b: '海水从浅绿渐变到深蓝，房子建在水上木桩上。' },

  /* ---------------- 补：把主要国家铺到 5~8 条 ---------------- */
  { zh: '时代广场', c: '美国', w: 'Times_Square', s: 'city', b: '晚上全是巨大的电子广告牌，亮得像白天。' },
  { zh: '帝国大厦', c: '美国', w: 'Empire_State_Building', s: 'city', b: '灰色的摩天大楼，顶上的灯会跟着节日换颜色。' },
  { zh: '优胜美地国家公园', c: '美国', w: 'Yosemite_National_Park', s: 'mountain', b: '垂直的巨型花岗岩壁，瀑布从高处直直挂下来。' },
  { zh: '大烟山国家公园', c: '美国', w: 'Great_Smoky_Mountains_National_Park', s: 'forest', b: '早上山间飘着一层蓝白色的雾，像烟一样。' },
  { zh: '拉斯维加斯大道', c: '美国', w: 'Las_Vegas_Strip', s: 'city', b: '沙漠中间的一条街，晚上灯亮得看不见星星。' },

  { zh: '大阪城', c: '日本', w: 'Osaka_Castle', s: 'city', b: '绿色屋顶配金色装饰，外面围着护城河。' },
  { zh: '岚山竹林', c: '日本', w: 'Arashiyama', s: 'forest', b: '小路两边全是高高的竹子，风一吹沙沙响。' },
  { zh: '广岛和平纪念碑', c: '日本', w: 'Hiroshima_Peace_Memorial', s: 'city', b: '只剩一个圆顶的废墟，提醒人们不要再打仗。' },

  { zh: '凯旋门', c: '法国', w: 'Arc_de_Triomphe', s: 'city', b: '巨大的拱门，底下点着无名烈士墓的长明火。' },
  { zh: '蔚蓝海岸', c: '法国', w: 'French_Riviera', s: 'coast', b: '地中海边的海岸线，沙滩和游艇排成一排。' },
  { zh: '香波堡', c: '法国', w: 'Château_de_Chambord', s: 'city', b: '河谷里的城堡，屋顶上全是小塔尖，像童话里的。' },

  { zh: '温莎城堡', c: '英国', w: 'Windsor_Castle', s: 'city', b: '英国国王周末住的城堡，世界上还有人住的最大古堡。' },
  { zh: '湖区', c: '英国', w: 'Lake_District', s: 'water', b: '山和湖挤在一起，彼得兔的故事就发生在这儿。' },

  { zh: '佛罗伦萨大教堂', c: '意大利', w: 'Florence_Cathedral', s: 'temple', b: '巨大的红砖圆顶，文艺复兴就是从这里开始的。' },
  { zh: '五渔村', c: '意大利', w: 'Cinque_Terre', s: 'coast', b: '五个彩色小村子贴在悬崖上，下面就是海。' },
  { zh: '阿马尔菲海岸', c: '意大利', w: 'Amalfi_Coast', s: 'coast', b: '柠檬树和彩色房子挂在陡峭的海岸上。' },
  { zh: '特莱维喷泉', c: '意大利', w: 'Trevi_Fountain', s: 'city', b: '往池子里扔一枚硬币，据说以后还会再回罗马。' },

  { zh: '红堡', c: '印度', w: 'Red_Fort', s: 'city', b: '红砂岩砌的城堡，印度总理每年在这儿讲话。' },
  { zh: '埃洛拉石窟', c: '印度', w: 'Ellora_Caves', s: 'cave', b: '整座山被凿成寺庙，连柱子都雕满了花纹。' },
  { zh: '果阿海滩', c: '印度', w: 'Goa', s: 'coast', b: '椰林和沙滩，以前是葡萄牙的殖民地。' },

  { zh: '帝王谷', c: '埃及', w: 'Valley_of_the_Kings', s: 'desert', b: '沙漠山谷里埋着六十多位法老，墙上画满彩色壁画。' },
  { zh: '尼罗河', c: '埃及', w: 'Nile', s: 'water', b: '世界上最长的河之一，两岸窄窄的绿带外全是沙漠。' },

  { zh: '大洋路', c: '澳大利亚', w: 'Great_Ocean_Road', s: 'coast', b: '海边公路一路都是石灰岩柱子，开车看最过瘾。' },
  { zh: '蓝山国家公园', c: '澳大利亚', w: 'Blue_Mountains_National_Park', s: 'mountain', b: '满山的桉树会放出蓝色的雾，远看山真的是蓝的。' },
  { zh: '菲利普岛', c: '澳大利亚', w: 'Phillip_Island', s: 'coast', b: '傍晚小企鹅排着队从海里摇摇摆摆走回窝。' },

  { zh: '北村韩屋村', c: '韩国', w: 'Bukchon_Hanok_Village', s: 'city', b: '一片传统黑瓦房，小巷窄窄的，现在还住着人。' },
  { zh: '大城遗址', c: '泰国', w: 'Ayutthaya_Historical_Park', s: 'temple', b: '古都留下的红砖佛塔，很多佛像的头都不见了。' },
  { zh: '素可泰历史公园', c: '泰国', w: 'Sukhothai_Historical_Park', s: 'temple', b: '泰国最早的首都，佛像安静地坐在莲花座上。' },
  { zh: '以弗所', c: '土耳其', w: 'Ephesus', s: 'city', b: '古罗马城市的街道还在，图书馆的立面特别气派。' },

  { zh: '柏林墙', c: '德国', w: 'Berlin_Wall', s: 'city', b: '剩下的墙段上画满涂鸦，最长的一段叫东边画廊。' },
  { zh: '黑森林', c: '德国', w: 'Black_Forest', s: 'forest', b: '密密的针叶林，黑森林蛋糕上的樱桃就产在这儿。' },
  { zh: '海德堡城堡', c: '德国', w: 'Heidelberg_Castle', s: 'city', b: '红砂岩城堡的废墟立在山坡上，脚下是红顶老城。' },

  { zh: '圣瓦西里大教堂', c: '俄罗斯', w: "Saint_Basil's_Cathedral", s: 'temple', b: '九个洋葱头圆顶，每个的颜色和花纹都不一样。' },
  { zh: '科帕卡巴纳海滩', c: '巴西', w: 'Copacabana,_Rio_de_Janeiro', s: 'coast', b: '四公里长的海滩，人行道上全是波浪花纹。' },
  { zh: '潘塔纳尔湿地', c: '巴西', w: 'Pantanal', s: 'water', b: '世界上最大的湿地，鳄鱼和金刚鹦鹉到处都是。' },
  { zh: '克尼斯纳', c: '南非', w: 'Knysna', s: 'coast', b: '花园大道上最有名的小镇，湖口两座石岬把海挡在外面。' },
  { zh: '罗托鲁瓦', c: '新西兰', w: 'Rotorua', s: 'water', b: '城里到处冒地热蒸汽，空气里有一股硫磺味。' },
  { zh: '库克山', c: '新西兰', w: 'Aoraki_/_Mount_Cook', s: 'snow', b: '新西兰最高的山，冰川一直伸到山脚下。' },
  { zh: '科莫多岛', c: '印度尼西亚', w: 'Komodo_(island)', s: 'coast', b: '岛上有世界上最大的蜥蜴，叫科莫多龙。' },
  { zh: '耶路撒冷老城', c: '以色列', w: 'Old_City_of_Jerusalem', s: 'temple', b: '老城分成四个区，石板路窄得只能走人。' },
  { zh: '棕榈岛', c: '阿联酋', w: 'Palm_Jumeirah', s: 'coast', b: '填海造出来的岛，形状像一棵棕榈树。' },

  { zh: '塞维利亚大教堂', c: '西班牙', w: 'Seville_Cathedral', s: 'temple', b: '世界上最大的哥特式教堂，旁边立着一座钟楼。' },
  { zh: '古埃尔公园', c: '西班牙', w: 'Park_Güell', s: 'city', b: '高迪设计的公园，长椅弯弯曲曲还贴着碎瓷片。' },
  { zh: '圣地亚哥朝圣教堂', c: '西班牙', w: 'Santiago_de_Compostela_Cathedral', s: 'temple', b: '朝圣路的终点，有人走几百公里就为了到这儿。' },

  { zh: '卢塞恩湖', c: '瑞士', w: 'Lake_Lucerne', s: 'water', b: '湖光山色围着小城，还有一座画满画的木头老桥。' },
  { zh: '维也纳国家歌剧院', c: '奥地利', w: 'Vienna_State_Opera', s: 'city', b: '世界有名的歌剧院，门口的大屏幕会免费直播演出。' },
  { zh: '德尔斐', c: '希腊', w: 'Delphi', s: 'temple', b: '古希腊人认为这里是世界的中心，都来求神谕。' },
  { zh: '克鲁姆洛夫', c: '捷克', w: 'Český_Krumlov', s: 'city', b: '河拐了个弯把老城抱在怀里，一片红屋顶。' },

  { zh: '魁北克老城', c: '加拿大', w: 'Old_Quebec', s: 'city', b: '北美的法语老城，城墙和石板路都是几百年前的。' },
  { zh: '路易斯湖', c: '加拿大', w: 'Lake_Louise,_Alberta', s: 'water', b: '湖水是绿的，背后是雪山，冬天冻住能滑冰。' },
  { zh: '宪法广场', c: '墨西哥', w: 'Zócalo', s: 'city', b: '巨大的广场，四周是宫殿和大教堂。' },
  { zh: '库斯科', c: '秘鲁', w: 'Cusco', s: 'city', b: '印加古都，墙是石头垒的，缝里连刀片都插不进去。' },
  { zh: '百内国家公园', c: '智利', w: 'Torres_del_Paine_National_Park', s: 'mountain', b: '三座花岗岩尖塔直插云霄，风大得能把人吹歪。' },
  { zh: '撒哈拉沙漠', c: '摩洛哥', w: 'Sahara', s: 'desert', b: '沙丘一望无际，晚上星空亮得吓人。' },
  { zh: '布宜诺斯艾利斯', c: '阿根廷', w: 'Buenos_Aires', s: 'city', b: '探戈的发源地，街边随时有人当场跳起来。' },

  /* ---------------- 补：再铺一批国家 ---------------- */
  { zh: '迦太基', c: '突尼斯', w: 'Carthage', s: 'city', b: '古代地中海最强的城邦之一，现在只剩石柱和浴场。' },
  { zh: '阿尔及尔卡斯巴', c: '阿尔及利亚', w: 'Casbah_of_Algiers', s: 'city', b: '白色的老城一层层堆在山坡上。' },
  { zh: '祖马岩', c: '尼日利亚', w: 'Zuma_Rock', s: 'mountain', b: '一整块巨大的独石，比周围平原高出七百多米。' },
  { zh: '海岸角城堡', c: '加纳', w: 'Cape_Coast_Castle', s: 'coast', b: '白色的海边城堡，曾经是奴隶贸易的据点。' },
  { zh: '火山国家公园', c: '卢旺达', w: 'Volcanoes_National_Park', s: 'forest', b: '云雾里的雨林，运气好能遇到山地大猩猩。' },
  { zh: '南卢安瓜国家公园', c: '赞比亚', w: 'South_Luangwa_National_Park', s: 'grass', b: '可以走着看野生动物的国家公园。' },
  { zh: '埃斯特角城', c: '乌拉圭', w: 'Punta_del_Este', s: 'coast', b: '沙滩上从地里伸出来五根巨大的手指。' },
  { zh: '巴拉那耶稣会传教区', c: '巴拉圭', w: 'La_Santísima_Trinidad_de_Paraná', s: 'forest', b: '丛林里的红砖教堂废墟，是电影取景地。' },
  { zh: '邓斯河瀑布', c: '牙买加', w: "Dunn's_River_Falls", s: 'water', b: '像台阶一样的瀑布，大家手拉手往上爬。' },
  { zh: '圣多明各殖民城', c: '多米尼加', w: 'Ciudad_Colonial_(Santo_Domingo)', s: 'city', b: '美洲最老的欧洲人城市，有第一座大教堂。' },
  { zh: '科潘', c: '洪都拉斯', w: 'Copán', s: 'forest', b: '玛雅古城，石阶上刻着密密麻麻的象形文字。' },
  { zh: '玛玛努卡群岛', c: '斐济', w: 'Mamanuca_Islands', s: 'coast', b: '三百多个小岛，海水是透明的浅蓝色。' },
  { zh: '拉洛马努海滩', c: '萨摩亚', w: 'Lalomanu', s: 'coast', b: '细细的白沙滩，椰子树斜斜地伸到海面上。' },
  { zh: '科科达小径', c: '巴布亚新几内亚', w: 'Kokoda_Track', s: 'forest', b: '穿过雨林的山路，二战时在这里打过仗。' },
  { zh: '奥马尔阿里赛义夫丁清真寺', c: '文莱', w: 'Omar_Ali_Saifuddien_Mosque', s: 'temple', b: '金顶清真寺建在水上，倒影特别好看。' },
  { zh: '孙德尔本斯', c: '孟加拉', w: 'Sundarbans', s: 'forest', b: '世界上最大的红树林，孟加拉虎住在里面。' },
  { zh: '巴勒贝克', c: '黎巴嫩', w: 'Baalbek', s: 'temple', b: '古罗马最大的神庙遗址，石柱粗得几个人抱不过来。' },
  { zh: '伊斯兰艺术博物馆', c: '卡塔尔', w: 'Museum_of_Islamic_Art,_Doha', s: 'city', b: '海边的白色博物馆，是贝聿铭设计的。' },
  { zh: '苏丹卡布斯大清真寺', c: '阿曼', w: 'Sultan_Qaboos_Grand_Mosque', s: 'temple', b: '巨大的水晶吊灯，地上铺着世界上最大的手工地毯。' },
  { zh: '帕福斯', c: '塞浦路斯', w: 'Paphos', s: 'coast', b: '海边有古罗马的马赛克地板画，颜色还很鲜艳。' },
  { zh: '卢森堡市', c: '卢森堡', w: 'Luxembourg_City', s: 'city', b: '建在峡谷两边，好多桥把上下两座城连起来。' },
  { zh: '塔林老城', c: '爱沙尼亚', w: 'Tallinn', s: 'city', b: '中世纪的老城，塔楼和红屋顶保存得特别好。' },
  { zh: '里加老城', c: '拉脱维亚', w: 'Riga', s: 'city', b: '老城里有世界上最多的新艺术风格房子。' },
  { zh: '特拉凯城堡', c: '立陶宛', w: 'Trakai_Island_Castle', s: 'water', b: '红砖城堡建在湖心小岛上，靠一座木桥过去。' },
  { zh: '斯皮什城堡', c: '斯洛伐克', w: 'Spiš_Castle', s: 'city', b: '东欧最大的城堡遗址，孤零零立在山头上。' },
  { zh: '里拉修道院', c: '保加利亚', w: 'Rila_Monastery', s: 'temple', b: '山里的修道院，墙上画满彩色的壁画。' },
  { zh: '贝尔格莱德要塞', c: '塞尔维亚', w: 'Belgrade_Fortress', s: 'city', b: '两条大河交汇的地方，白色的要塞守着老城。' },
  { zh: '培拉特', c: '阿尔巴尼亚', w: 'Berat', s: 'city', b: '白房子一层层叠在山坡上，人家叫它"千窗之城"。' },
  { zh: '莫斯塔尔老桥', c: '波黑', w: 'Stari_Most', s: 'city', b: '一座拱桥横跨碧绿的河，跳桥是当地的老传统。' },
  { zh: '圣索菲亚大教堂（基辅）', c: '乌克兰', w: "Saint_Sophia_Cathedral,_Kyiv", s: 'temple', b: '绿顶白墙，里面的马赛克拼画有一千年了。' },
  { zh: '格加尔德修道院', c: '亚美尼亚', w: 'Geghard', s: 'cave', b: '一半是从山岩里凿出来的修道院，里面很凉。' },
  { zh: '少女塔', c: '阿塞拜疆', w: 'Maiden_Tower_(Baku)', s: 'city', b: '巴库老城里的圆柱形石塔，谁建的至今说不清。' },
]
