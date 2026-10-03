import { mkdirSync, writeFileSync } from 'node:fs'

/* ★ 关键词从**题目自己的话**里取（lead 里写了具体物件/颜色就是硬约束）—— 见 stock-photo-sourcing §10.6
   ★ must 里必须带**排除项**（彩色/不要黑白、主体必须在、别让无关元素占满）—— 见 §10.8④ */
const ITEMS = [
  { id: 'builtin-family-13', title: '妈妈的手', query: 'woman hands washing dishes sink', alts: ['mother hands chopping vegetables kitchen', 'hands kneading dough close up', 'woman hands sewing fabric close up'], must: '一双成年女性的手在**做家务**（洗碗/择菜/揉面/缝补都行），手是画面主体、看得清手本身；★ 只要彩色，不要黑白；★ 不要正脸特写（只拍手和手臂最好）' },
  { id: 'builtin-family-14', title: '爷爷的老花镜', query: 'elderly man reading glasses newspaper', alts: ['old man spectacles reading book', 'senior man glasses reading newspaper', 'grandpa reading glasses low on nose'], must: '一位老年男性戴着老花镜在看报纸或书；★ 人和眼镜都要看得见（不能只有一副眼镜放在桌上）；★ 彩色，不要黑白；★ 避免正脸大特写（侧脸/低头/背影都可以）' },
  { id: 'builtin-teacher-6', title: '老师的手', query: 'hand writing on blackboard with chalk close up', alts: ['teacher hand chalk blackboard writing', 'chalk writing on blackboard hand', 'asian teacher writing on blackboard'], must: '一只手拿着粉笔在**黑板上写字**，画面里要同时有手、粉笔、黑板；★★ 黑板上**不要出现英文/外文单词**（家长为「黑板上写着德语」退过一张），优先中文或空黑板；★ 彩色，不要黑白' },
  { id: 'builtin-teacher-7', title: '放学后的办公室', query: 'teacher grading papers at desk', alts: ['teacher desk marking homework', 'teacher correcting papers classroom desk', 'teacher working at desk with papers'], must: '老师坐在办公桌前**低头批改作业/备课**（桌上要有作业本或试卷）；★ 必须看得见老师本人，不能只有一堆本子；★ 彩色，不要黑白；★ 避免正脸大特写' },
  { id: 'builtin-classmate-6', title: '同桌的铅笔盒', query: 'open pencil case with stationery', alts: ['pencil box full of pens', 'open pencil pouch stationery', 'pencil case with school supplies'], must: '一个**打开的铅笔盒/笔袋**，里面装着文具（笔、橡皮、尺子），有点满、有点乱；★ 主体是铅笔盒本身；★ 彩色，不要黑白' },
  { id: 'builtin-classmate-7', title: '一起值日', query: 'child sweeping classroom floor broom', alts: ['students cleaning classroom blackboard', 'kid sweeping floor with broom', 'children doing chores in classroom'], must: '**看得见孩子在教室里劳动**（扫地/擦黑板/搬桌椅都行），必须有人；★ 彩色，不要黑白；★ 避免正脸大特写（背影/侧脸可以）' },
  { id: 'builtin-stranger-5', title: '修鞋的老人', query: 'old cobbler repairing shoes street', alts: ['shoemaker mending shoes by hand', 'cobbler sewing shoe workshop', 'old man repairing shoes'], must: '一位**修鞋的老人**在低头缝鞋 —— 人 + 鞋 + 工具都要看得见（不能只有一双鞋、也不能只有工具）；★ 彩色，不要黑白' },
  { id: 'builtin-stranger-6', title: '收废品的叔叔', query: 'man with cart full of cardboard boxes street', alts: ['recycling collector tricycle cardboard', 'scrap collector pushing cart', 'waste picker cart cardboard boxes'], must: '一位收废品的人和他的**三轮车/手推车**，车上堆着纸箱或废品；★ 必须同时看得见人和车；★ 彩色，不要黑白' },
  { id: 'builtin-community-helper-9', title: '楼下的保安叔叔', query: 'security guard uniform standing at gate', alts: ['guard in uniform near gate booth', 'security guard smiling at entrance', 'doorman uniform at building gate'], must: '一位**穿制服的保安/门卫**站在小区门口或岗亭旁；★ 必须看得见人；★ 彩色，不要黑白；★ 避免正脸大特写（侧身/半身/远景可以）' },
  { id: 'builtin-community-helper-10', title: '早餐摊的阿姨', query: 'asian breakfast street stall vendor morning', alts: ['breakfast stall vendor cooking steam', 'street food stall woman selling', 'morning food stall with steam'], must: '一个**早餐摊**：摊主在摊位后面做或卖早点（包子/煎饼/豆浆之类），摊主和摊子都要看得见；★ 彩色，不要黑白' },
  { id: 'builtin-pet-13', title: '我的小兔子', query: 'rabbit eating carrot', alts: ['bunny eating carrot close up', 'pet rabbit eating vegetable', 'white rabbit long ears eating'], must: '一只**兔子**（长耳朵看得清），最好正在啃胡萝卜或吃草；★ 彩色，不要黑白' },
  { id: 'builtin-pet-14', title: '学说话的鹦鹉', query: 'colorful parrot close up', alts: ['parrot perched on branch', 'pet parrot colorful bird', 'macaw close up head'], must: '一只**鹦鹉**（看得清羽毛和喙），最好张嘴/像在叫；★ 彩色，不要黑白' },

  { id: 'builtin-plant-9', title: '窗台上的多肉', query: 'succulent plant on windowsill sunlight', alts: ['potted succulent by window', 'succulents in pot window sill', 'small potted succulent sunlight'], must: '一盆**多肉植物**放在窗台上，叶子肥厚看得清；★ 彩色，不要黑白；★ 暖光更好' },
  { id: 'builtin-plant-10', title: '门口的桂花树', query: 'tree full of small yellow flowers', alts: ['blooming tree with tiny yellow flowers', 'osmanthus blossom tree', 'tree covered with small flowers autumn'], must: '一棵**开满小花的树**（小黄花，秋天感），要看得见满树的花；★ 彩色，不要黑白；★ 不要只有一朵花的特写' },
  { id: 'builtin-stationery-6', title: '越写越短的铅笔', query: 'short pencil stub on paper', alts: ['worn down pencil nub close up', 'used short pencil on notebook', 'tiny pencil leftover on desk'], must: '一支**很短的铅笔头**（短到快握不住那种），放在桌上或纸旁；★ 主体就是这支短铅笔；★ 彩色，不要黑白' },
  { id: 'builtin-stationery-7', title: '尺子上的刻度', query: 'ruler with markings on paper', alts: ['measuring ruler close up markings', 'ruler and pencil on notebook', 'steel ruler measuring paper'], must: '一把**尺子**，刻度清晰可见，最好正压在纸或本子上量东西；★ 彩色，不要黑白' },
  { id: 'builtin-treasure-11', title: '奶奶的顶针', query: 'thimble on finger sewing', alts: ['metal thimble with needle and thread', 'thimble close up sewing', 'hand with thimble sewing fabric'], must: '一个**顶针**（缝纫用的金属指套）戴在手指上、或放在针线旁；★ 顶针本身必须看得见；★ 彩色，不要黑白' },
  { id: 'builtin-treasure-12', title: '我的第一张奖状', query: 'certificate hanging on wall', alts: ['diploma certificate pinned on wall', 'paper certificate on wall', 'award certificate framed on wall'], must: '一张**贴在墙上的奖状/证书**（纸质、可以有点旧或卷边）；★ 彩色，不要黑白；⚠️ 纸上的字可以是外文，但**不要让别国国旗/国徽占满画面**' },
  { id: 'builtin-food-6', title: '妈妈煮的粥', query: 'bowl of porridge steam', alts: ['congee bowl with spoon hot', 'rice porridge breakfast table', 'bowl of porridge steaming'], must: '一碗**冒着热气的粥/稀饭**（白粥或加料都行），最好放在餐桌上；★ 彩色，不要黑白；★ 暖调' },
  { id: 'builtin-food-7', title: '一根冰棍', query: 'popsicle held in hand summer', alts: ['ice cream popsicle summer', 'ice lolly colorful summer', 'melting popsicle summer'], must: '一根**冰棍/雪糕**（拿在手里或插在棍上），夏天的感觉；★ 彩色，不要黑白' },
  { id: 'builtin-life-goods-1', title: '我的小台灯', query: 'desk lamp lit on desk warm light', alts: ['table lamp on desk warm glow', 'small desk lamp study room', 'lamp on desk at night'], must: '一盏**亮着的台灯**放在书桌上（暖光更好）；★ 主体是台灯本身；★ 彩色，不要黑白' },
  { id: 'builtin-life-goods-2', title: '我家的电风扇', query: 'electric fan standing in room', alts: ['floor fan in living room', 'standing fan summer room', 'desk fan close up'], must: '一台**电风扇**（立式或台式），看得清风扇本身（不是空调、不是吊扇）；★ 彩色，不要黑白' },
  { id: 'builtin-life-goods-3', title: '下雨天的雨伞', query: 'umbrella in rain street', alts: ['open umbrella rainy day', 'person holding umbrella in rain', 'umbrella with raindrops close up'], must: '一把**撑开的伞**，最好在下雨的场景里（看得见雨或水洼）；★ 彩色，不要黑白' },
  { id: 'builtin-life-goods-4', title: '叫我起床的闹钟', query: 'alarm clock on bedside table', alts: ['twin bell alarm clock on table', 'retro alarm clock bedside', 'alarm clock close up'], must: '一个**闹钟**（双铃老式闹钟更好），放在床头柜或桌上；★ 主体是闹钟；★ 彩色，不要黑白' },

  { id: 'builtin-life-goods-5', title: '我的水杯', query: 'water bottle on desk', alts: ['drinking bottle on table', 'glass of water on desk', 'kids water bottle'], must: '一个**水杯/水壶**（看得清杯身），放在桌上或拿在手里；★ 彩色，不要黑白' },
  { id: 'builtin-life-goods-6', title: '家里的冰箱', query: 'open refrigerator full of food', alts: ['fridge open with food inside', 'refrigerator shelves stocked', 'open fridge door kitchen'], must: '一个**打开的冰箱**，里面看得见食物（摆得整齐更好）；★ 彩色，不要黑白' },
  { id: 'builtin-life-goods-7', title: '洗衣机转起来了', query: 'washing machine laundry room', alts: ['front load washing machine', 'washing machine with laundry basket', 'laundry room washing machine'], must: '一台**洗衣机**（滚筒或波轮），最好旁边有衣服或洗衣篮；★ 彩色，不要黑白' },
  { id: 'builtin-life-goods-8', title: '墙角的扫帚', query: 'broom standing in corner', alts: ['broom leaning against wall', 'broom and dustpan corner', 'old broom on floor corner'], must: '一把**扫帚**立在墙角或靠着墙；★ 主体是扫帚本身；★ 彩色，不要黑白' },
  { id: 'builtin-life-goods-9', title: '墙上的挂钟', query: 'wall clock hanging on wall', alts: ['round wall clock', 'analog clock on wall', 'vintage wall clock home'], must: '一个**挂在墙上的钟**（看得清表盘和指针）；★ 彩色，不要黑白' },
  { id: 'builtin-life-goods-10', title: '家里的遥控器', query: 'tv remote control on table', alts: ['remote control on sofa', 'tv remote close up', 'remote controller on coffee table'], must: '一个**遥控器**（电视或空调的），放在桌上或沙发旁；★ 主体是遥控器；★ 彩色，不要黑白' },
  { id: 'builtin-life-goods-11', title: '门边的一串钥匙', query: 'bunch of keys hanging on hook', alts: ['keyring hanging by door', 'keys on hook by door', 'set of keys on nail wall'], must: '**一串钥匙**挂在门边挂钩上，或拿在手里；★ 彩色，不要黑白' },
  { id: 'builtin-life-goods-12', title: '洗手间的镜子', query: 'bathroom mirror on wall', alts: ['mirror above bathroom sink', 'washroom mirror on wall', 'bathroom mirror reflection'], must: '一面**挂在墙上的洗手间镜子**，镜面最好有倒影；★ 彩色，不要黑白；★ 避免正脸大特写（拍镜子/背影/局部都可以）' },
  { id: 'builtin-life-goods-13', title: '我的小拖鞋', query: 'slippers on floor by door', alts: ['pair of slippers at doorway', 'house slippers on mat', 'slippers on floor indoors'], must: '一双**拖鞋**放在门口地垫上或地上；★ 主体是拖鞋；★ 彩色，不要黑白' },
  { id: 'builtin-life-goods-14', title: '水开了', query: 'kettle boiling steam kitchen', alts: ['boiling kettle on stove steam', 'tea kettle steam close up', 'hot water kettle steaming'], must: '一把**冒白气的烧水壶**（灶上或桌上，看得见蒸汽）；★ 彩色，不要黑白；★ 暖调' },
  { id: 'builtin-life-goods-15', title: '电吹风呼呼地吹', query: 'hair dryer drying hair', alts: ['blow dryer at home', 'using hair dryer', 'hair dryer close up'], must: '一把**吹风机**在使用（看得见吹风机，最好还有头发）；★ 彩色，不要黑白；★ 避免正脸大特写（背影/侧脸/局部可以）' },
  { id: 'builtin-life-goods-16', title: '手电筒的光', query: 'flashlight beam in dark', alts: ['torch light beam dark room', 'hand holding flashlight dark', 'flashlight shining on wall'], must: '一把**亮着的手电筒**，最好在暗处、看得见光柱；★ 彩色，不要黑白' },
  { id: 'builtin-life-goods-17', title: '会唱歌的收音机', query: 'vintage radio on table', alts: ['old radio on shelf', 'retro radio close up', 'portable radio on table'], must: '一台**收音机**（老式更好），放在桌上或拿在手里；★ 主体是收音机；★ 彩色，不要黑白' },

  { id: 'builtin-life-goods-18', title: '门铃响了', query: 'doorbell on door frame', alts: ['hand pressing doorbell', 'doorbell button by door', 'visitor at front door'], must: '一个**门铃**（装在门框旁），或者有人站在门口按门铃；★ 彩色，不要黑白' },
  { id: 'builtin-life-goods-19', title: '阳台上的晾衣架', query: 'clothes hanging on drying rack', alts: ['laundry hanging on line balcony', 'clothes drying rack with clothes', 'washing hanging outside'], must: '**晾着的衣服**（晾衣架或晾衣绳上排着一排衣服），阳台或院子里；★ 彩色，不要黑白' },
  { id: 'builtin-life-goods-20', title: '我的保温杯', query: 'thermos flask on desk', alts: ['vacuum flask open steam', 'insulated water bottle on table', 'thermos cup close up'], must: '一个**保温杯**（看得清杯身），最好放在桌上或开着盖冒热气；★ 彩色，不要黑白' },
  { id: 'builtin-life-goods-21', title: '我的存钱罐', query: 'piggy bank with coins', alts: ['hand putting coin in piggy bank', 'coin bank with coins on table', 'saving money jar with coins'], must: '一个**存钱罐**（猪形或罐子都行），最好旁边有硬币或手在投币；★ 彩色，不要黑白' },
  { id: 'builtin-life-goods-22', title: '我的小牙刷', query: 'toothbrush in cup bathroom', alts: ['toothbrush and toothpaste on sink', 'toothbrush standing in holder', 'toothbrush cup bathroom counter'], must: '一把**牙刷**插在杯子里或放在洗手台上（旁边有牙膏更好）；★ 彩色，不要黑白' },
  { id: 'builtin-life-goods-23', title: '雨天的雨靴', query: 'rain boots in puddle', alts: ['child rain boots puddle', 'rubber boots by door', 'wellies splashing water'], must: '一双**雨靴**（最好踩在水洼里或放在门边），靴子本身看得清；★ 彩色，不要黑白' },
  { id: 'builtin-life-goods-24', title: '家里的窗帘', query: 'curtains with sunlight window', alts: ['curtain morning sunlight room', 'sheer curtains window light', 'pulling curtain open window'], must: '**窗帘**（最好有阳光透过窗帘、或拉开窗帘的画面）；★ 彩色，不要黑白；★ 暖调' },
  { id: 'builtin-life-goods-25', title: '鞋柜里的鞋', query: 'shoes on shoe rack shelf', alts: ['shoe cabinet with shoes', 'shoes lined up on rack', 'family shoes on shelf'], must: '**鞋柜里排着的鞋**（打开的状态，看得见好几双鞋）；★ 彩色，不要黑白' },
  { id: 'builtin-life-goods-26', title: '书包上的小挂件', query: 'backpack with keychain charm', alts: ['school bag with hanging charm', 'backpack keyring pendant', 'bag with small plush keychain'], must: '一个**书包**，上面挂着一个**小挂件/钥匙扣**（书包和挂件都要看得见）；★ 彩色，不要黑白' },
  { id: 'builtin-life-goods-27', title: '电饭煲冒气了', query: 'rice cooker with steam', alts: ['rice cooker open lid steam', 'electric rice cooker on counter', 'cooked rice in rice cooker'], must: '一个**电饭煲**（开着盖冒白气更好），放在厨房台面上；★ 彩色，不要黑白；★ 暖调' },
  { id: 'builtin-life-goods-28', title: '空调吹出来的风', query: 'air conditioner on wall indoor', alts: ['split air conditioner indoor unit', 'wall mounted air conditioner', 'air conditioner in room'], must: '一台**壁挂空调**（室内机）在墙上，或出风口的画面；★ 彩色，不要黑白' },
  { id: 'builtin-life-goods-29', title: '一把旧椅子', query: 'old wooden chair worn', alts: ['vintage wooden chair', 'old chair with worn wood', 'wooden chair against wall'], must: '一把**旧木椅子**（看得出年代感）；★ 主体是椅子；★ 彩色，不要黑白' },
  { id: 'builtin-life-goods-30', title: '我的小书桌', query: 'study desk with books and pencil', alts: ['wooden desk with notebooks', 'child desk with school supplies', 'writing desk with lamp and books'], must: '一张**书桌/写字台**（桌面上有书本文具，或看得出使用痕迹）；★ 彩色，不要黑白' },
]

mkdirSync('scripts/_photo-lib2', { recursive: true })

const SIZE = 13
const batches = []
for (let i = 0; i < ITEMS.length; i += SIZE) batches.push(ITEMS.slice(i, i + SIZE))

batches.forEach((items, k) => {
  const name = `batch-${String(k + 1).padStart(2, '0')}.json`
  writeFileSync(
    `scripts/_photo-lib2/${name}`,
    JSON.stringify({ batch: String(k + 1), items }, null, 1) + '\n',
  )
  console.log(name, items.length, items.map((i) => i.id.replace('builtin-', '')).join(' '))
})
console.log('total:', ITEMS.length, 'batches:', batches.length)
