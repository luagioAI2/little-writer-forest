/* ============================================================
   场景图片提示词 —— 126 场景 × 3 风格 = 378 条 AI 绘图提示词
   ============================================================
   ★ 这里每条 prompt 都可以直接复制到 AI 绘图工具使用。 ★

   ------------------------------------------------------------
   为什么有三种风格

   你可能用不同的 AI 工具、不同的风格来生成图片。
   一套 prompt 管不了所有工具 —— DALL-E 画卡通好，Midjourney
   画水彩好，有的工具甚至能出实景照片风。
   所以每个场景给三种风格的 prompt，你按自己用的工具和偏好选一组。

   三种风格：
   - **cartoon**（卡通绘本）：扁平、暖色、线条柔和，跟 SVG 风格最接近
   - **watercolor**（水彩手绘）：柔和笔触、晕染、温馨，适合写景写物
   - **photo**（实景照片风）：真实场景、自然光，适合写景状物（不画人脸）

   ★ 建议选一种风格做到底，别混着用 ★
   混用的话，同一篇文章的配图一会卡通一会照片，看着很乱。
   如果一定要混，至少同一类（比如全是写景）用同一种风格。

   ------------------------------------------------------------
   怎么用

   1. 找到你想要生成图片的场景 key（和 scenes.tsx 的 SCENES 对应）
   2. 选一种风格（cartoon / watercolor / photo）
   3. 复制对应的 prompt
   4. 贴到 DALL-E / Midjourney / Stable Diffusion 等工具里生成
   5. 把图片上传到图床，拿到 https 链接
   6. 填到 sceneImages.ts 的 SCENE_IMAGES 里
      （别忘了填 style 字段，跟用的风格对应）

   ------------------------------------------------------------
   注意

   - prompt 用英文写，因为大部分 AI 绘图工具对英文 prompt 效果更好
   - 每条都根据 scenes.tsx 的 hint 改写，画面内容一一对应
   - 如果生成的图不满意，可以在 prompt 基础上加自己的修饰词
   - photo 风格不画人脸：用实景 / 静物 / 风景，人物用背影或远景

   ============================================================ */

/** 图片风格 */
export type ImageStyle = 'cartoon' | 'watercolor' | 'photo'

/** 三种风格的统一前缀 */
const STYLE_PREFIX: Record<ImageStyle, string> = {
  cartoon:
    'Flat cartoon illustration, picture book style, warm color palette, soft lines, ' +
    '4:3 aspect ratio, three layers of depth (foreground, midground, background), ' +
    'no text, no speech bubbles, cartoon characters (no realistic faces). ',
  watercolor:
    'Soft watercolor painting, hand-painted style, warm and gentle colors, ' +
    'delicate brush strokes, paper texture, 4:3 aspect ratio, ' +
    'three layers of depth (foreground, midground, background), ' +
    'no text, no speech bubbles, cartoon characters (no realistic faces). ',
  photo:
    'Realistic photograph, natural lighting, shallow depth of field, ' +
    '4:3 aspect ratio, three layers of depth (foreground, midground, background), ' +
    'no text, no people facing camera (use back views or distant figures only). ',
}

/** 一条场景的 AI 绘图提示词 */
export interface SceneImagePrompt {
  /** 对应 scenes.tsx 的 sceneKey */
  sceneKey: string
  /** 中文名，方便查找 */
  label: string
  /** 卡通绘本风提示词 */
  cartoon: string
  /** 水彩手绘风提示词 */
  watercolor: string
  /** 实景照片风提示词 */
  photo: string
}

/* ============================================================
   126 条提示词
   ============================================================

   每条 = sceneKey + label + 3 种风格的 prompt。
   场景描述部分不变，只是前缀不同。
   ============================================================ */

export const SCENE_IMAGE_PROMPTS: SceneImagePrompt[] = [
  /* ---------------- 写景（20） ---------------- */
  {
    sceneKey: 'spring-park',
    label: '春天的公园',
    cartoon: STYLE_PREFIX.cartoon +
      'A spring park scene. In the foreground, a small path winds through green grass with colorful tiny flowers. In the midground, two trees full of pink blossoms. In the background, soft green hills and white clouds. A cartoon girl walking a small dog on the path.',
    watercolor: STYLE_PREFIX.watercolor +
      'A spring park scene. In the foreground, a small path winds through green grass with colorful tiny flowers. In the midground, two trees full of pink blossoms. In the background, soft green hills and white clouds. A cartoon girl walking a small dog on the path.',
    photo: STYLE_PREFIX.photo +
      'A spring park in early morning light. Foreground: a winding path through green grass with tiny wildflowers. Midground: two cherry blossom trees in full bloom. Background: soft green hills and white clouds. A child seen from behind walking a small dog.',
  },
  {
    sceneKey: 'autumn-leaves',
    label: '秋天的落叶',
    cartoon: STYLE_PREFIX.cartoon +
      'An autumn scene with golden fallen leaves covering a small path. Two golden-leaved trees swaying in the wind. Two cartoon children chasing after falling leaves in the air.',
    watercolor: STYLE_PREFIX.watercolor +
      'An autumn scene with golden fallen leaves covering a small path. Two golden-leaved trees swaying in the wind. Two cartoon children chasing after falling leaves in the air.',
    photo: STYLE_PREFIX.photo +
      'An autumn path covered in golden fallen leaves. Two maple trees with golden foliage. Leaves falling in the breeze. Two children seen from a distance running and catching leaves.',
  },
  {
    sceneKey: 'winter-window',
    label: '冬天的窗户',
    cartoon: STYLE_PREFIX.cartoon +
      'A cozy winter scene viewed from inside through a window. Outside: snow falling, bare trees and small houses. On the windowsill: a potted green plant and a steaming cup.',
    watercolor: STYLE_PREFIX.watercolor +
      'A cozy winter scene viewed from inside through a window. Outside: snow falling, bare trees and small houses. On the windowsill: a potted green plant and a steaming cup.',
    photo: STYLE_PREFIX.photo +
      'A cozy winter scene viewed from inside through a frosted window. Outside: snow falling on bare trees and small houses. On the windowsill: a potted green plant and a steaming cup of tea.',
  },
  {
    sceneKey: 'snow-play',
    label: '玩雪',
    cartoon: STYLE_PREFIX.cartoon +
      'Two cartoon children having a snowball fight on a snowy field. Snowballs flying through the air. Bare trees in the background.',
    watercolor: STYLE_PREFIX.watercolor +
      'Two cartoon children having a snowball fight on a snowy field. Snowballs flying through the air. Bare trees in the background.',
    photo: STYLE_PREFIX.photo +
      'A snowy field with two children seen from a distance having a snowball fight. Snowballs flying through the air. Bare trees in the background. Overcast winter sky.',
  },
  {
    sceneKey: 'snowman',
    label: '堆雪人',
    cartoon: STYLE_PREFIX.cartoon +
      'A snowman wearing a red scarf and carrot nose standing in the center of a snowy field. Two cartoon children on either side. Snowflakes gently falling from the sky.',
    watercolor: STYLE_PREFIX.watercolor +
      'A snowman wearing a red scarf and carrot nose standing in the center of a snowy field. Two cartoon children on either side. Snowflakes gently falling from the sky.',
    photo: STYLE_PREFIX.photo +
      'A snowman with a red scarf and carrot nose in the center of a snowy field. Two children seen from behind on either side. Gentle snowfall. Soft winter light.',
  },
  {
    sceneKey: 'rain-window',
    label: '下雨的窗户',
    cartoon: STYLE_PREFIX.cartoon +
      'A rainy window scene. Rain streaming down the glass, trees and small houses outside look grey-blue through the rain. A cartoon cat sitting on the windowsill watching the rain. Raindrops on the glass.',
    watercolor: STYLE_PREFIX.watercolor +
      'A rainy window scene. Rain streaming down the glass, trees and small houses outside look grey-blue through the rain. A cartoon cat sitting on the windowsill watching the rain. Raindrops on the glass.',
    photo: STYLE_PREFIX.photo +
      'Rain streaming down a window glass. Through the rain: blurred trees and small houses in grey-blue tones. A cat sitting on the windowsill watching the rain. Close-up of raindrops on glass.',
  },
  {
    sceneKey: 'rainbow',
    label: '雨后的彩虹',
    cartoon: STYLE_PREFIX.cartoon +
      'A six-color rainbow arching across the sky after rain. Green grass with two puddles below. Rolling hills and clouds in the distance. A cartoon child with arms raised in joy.',
    watercolor: STYLE_PREFIX.watercolor +
      'A six-color rainbow arching across the sky after rain. Green grass with two puddles below. Rolling hills and clouds in the distance. A cartoon child with arms raised in joy.',
    photo: STYLE_PREFIX.photo +
      'A vivid rainbow arching across the sky after rain. Green grass with puddles reflecting the sky. Rolling hills and clouds in the distance. A child seen from behind with arms raised.',
  },
  {
    sceneKey: 'fog-morning',
    label: '大雾的早晨',
    cartoon: STYLE_PREFIX.cartoon +
      'A foggy morning scene. Only the nearby path and two small figures are clear. Trees and lamp posts in the distance are faintly visible through the fog. A street lamp still lit.',
    watercolor: STYLE_PREFIX.watercolor +
      'A foggy morning scene. Only the nearby path and two small figures are clear. Trees and lamp posts in the distance are faintly visible through the fog. A street lamp still lit.',
    photo: STYLE_PREFIX.photo +
      'A foggy morning scene. The nearby path and two distant figures are the only clear elements. Trees and lamp posts faintly visible through the fog. A street lamp still glowing.',
  },
  {
    sceneKey: 'river-village',
    label: '家乡的小河',
    cartoon: STYLE_PREFIX.cartoon +
      'A small river flowing through a village. A stone arch bridge crosses the river. White-walled red-roofed houses and green trees on both banks. A small boat on the water.',
    watercolor: STYLE_PREFIX.watercolor +
      'A small river flowing through a village. A stone arch bridge crosses the river. White-walled red-roofed houses and green trees on both banks. A small boat on the water.',
    photo: STYLE_PREFIX.photo +
      'A small river flowing through a rural village. A stone arch bridge crosses the river. White-walled houses with red roofs and green trees on both banks. A wooden boat on the calm water.',
  },
  {
    sceneKey: 'mountain-climb',
    label: '摸黑上山',
    cartoon: STYLE_PREFIX.cartoon +
      'A pre-dawn mountain hiking scene. Dark blue sky with moon and stars. Two large mountains in silhouette. Two cartoon people with flashlights walking up a mountain path.',
    watercolor: STYLE_PREFIX.watercolor +
      'A pre-dawn mountain hiking scene. Dark blue sky with moon and stars. Two large mountains in silhouette. Two cartoon people with flashlights walking up a mountain path.',
    photo: STYLE_PREFIX.photo +
      'A pre-dawn mountain scene. Dark blue sky with moon and stars. Two large mountains in silhouette. Two hikers with flashlight beams walking up a mountain path.',
  },
  {
    sceneKey: 'sunrise-peak',
    label: '日出山顶',
    cartoon: STYLE_PREFIX.cartoon +
      'A sunrise scene between two mountain peaks. The sun rising, a sea of white clouds filling the valley. Two cartoon children standing on the summit with arms raised in triumph.',
    watercolor: STYLE_PREFIX.watercolor +
      'A sunrise scene between two mountain peaks. The sun rising, a sea of white clouds filling the valley. Two cartoon children standing on the summit with arms raised in triumph.',
    photo: STYLE_PREFIX.photo +
      'A golden sunrise between two mountain peaks. A sea of white clouds filling the valley below. Two figures seen from behind standing on the summit with arms raised.',
  },
  {
    sceneKey: 'school-garden',
    label: '学校的小花园',
    cartoon: STYLE_PREFIX.cartoon +
      'A school building with a small garden in front. A path with a wooden fence. Flower beds with colorful flowers. Two cartoon students strolling. A small bird flying across.',
    watercolor: STYLE_PREFIX.watercolor +
      'A school building with a small garden in front. A path with a wooden fence. Flower beds with colorful flowers. Two cartoon students strolling. A small bird flying across.',
    photo: STYLE_PREFIX.photo +
      'A school building entrance with a small garden. A stone path with a wooden fence. Flower beds with colorful flowers in bloom. Two students seen from a distance walking. A bird in flight.',
  },
  {
    sceneKey: 'playground',
    label: '热闹的操场',
    cartoon: STYLE_PREFIX.cartoon +
      'A busy school playground. Red running track around a green field. A white soccer goal on the left, a soccer ball in the center. Several cartoon children running and jumping. School building in the background.',
    watercolor: STYLE_PREFIX.watercolor +
      'A busy school playground. Red running track around a green field. A white soccer goal on the left, a soccer ball in the center. Several cartoon children running and jumping. School building in the background.',
    photo: STYLE_PREFIX.photo +
      'A school playground. Red running track around a green field. A white soccer goal on one side, a soccer ball in the center. Children running and playing. School building in the background.',
  },
  {
    sceneKey: 'starry-night',
    label: '数星星的晚上',
    cartoon: STYLE_PREFIX.cartoon +
      'A deep blue night sky filled with stars and a crescent moon. A cartoon child lying on the grass looking up at the sky. Two pine trees and grass nearby.',
    watercolor: STYLE_PREFIX.watercolor +
      'A deep blue night sky filled with stars and a crescent moon. A cartoon child lying on the grass looking up at the sky. Two pine trees and grass nearby.',
    photo: STYLE_PREFIX.photo +
      'A deep blue night sky filled with stars and a crescent moon. A child lying on the grass looking up at the sky. Two pine trees silhouetted nearby. Milky way visible.',
  },
  {
    sceneKey: 'fireflies',
    label: '萤火虫之夜',
    cartoon: STYLE_PREFIX.cartoon +
      'A nighttime grassy field with many glowing fireflies. A cartoon child holding a glass jar trying to catch them. Moon and tree silhouettes in the distance.',
    watercolor: STYLE_PREFIX.watercolor +
      'A nighttime grassy field with many glowing fireflies. A cartoon child holding a glass jar trying to catch them. Moon and tree silhouettes in the distance.',
    photo: STYLE_PREFIX.photo +
      'A nighttime grassy field with glowing fireflies. A child holding a glass jar reaching for them. Moon and tree silhouettes in the distance. Long exposure, warm glow.',
  },
  {
    sceneKey: 'summer-pond',
    label: '夏日荷塘',
    cartoon: STYLE_PREFIX.cartoon +
      'A summer pond covered with green lotus leaves. Two pink lotus flowers blooming. A blue dragonfly hovering above. Fish shadows visible under the water surface.',
    watercolor: STYLE_PREFIX.watercolor +
      'A summer pond covered with green lotus leaves. Two pink lotus flowers blooming. A blue dragonfly hovering above. Fish shadows visible under the water surface.',
    photo: STYLE_PREFIX.photo +
      'A summer pond covered with green lotus leaves. Two pink lotus flowers in full bloom. A blue dragonfly hovering above. Fish shadows visible under the clear water surface.',
  },
  {
    sceneKey: 'beach',
    label: '海边沙滩',
    cartoon: STYLE_PREFIX.cartoon +
      'A golden sandy beach with scattered seashells. A red beach umbrella planted in the sand. Blue ocean with white waves in the distance. A cartoon child sitting on the sand.',
    watercolor: STYLE_PREFIX.watercolor +
      'A golden sandy beach with scattered seashells. A red beach umbrella planted in the sand. Blue ocean with white waves in the distance. A cartoon child sitting on the sand.',
    photo: STYLE_PREFIX.photo +
      'A golden sandy beach with scattered seashells. A red beach umbrella planted in the sand. Blue ocean with white waves in the distance. A child sitting on the sand seen from behind.',
  },
  {
    sceneKey: 'wheat-field',
    label: '金色麦田',
    cartoon: STYLE_PREFIX.cartoon +
      'A vast golden wheat field with ripe grain ears swaying in the wind. Small hills and a farmhouse in the distance. A dirt path through the field.',
    watercolor: STYLE_PREFIX.watercolor +
      'A vast golden wheat field with ripe grain ears swaying in the wind. Small hills and a farmhouse in the distance. A dirt path through the field.',
    photo: STYLE_PREFIX.photo +
      'A vast golden wheat field with ripe grain ears swaying in the wind. Small hills and a farmhouse in the distance. A dirt path through the field. Golden hour lighting.',
  },
  {
    sceneKey: 'school-autumn',
    label: '校园的秋天',
    cartoon: STYLE_PREFIX.cartoon +
      'A school campus in autumn. Two ginkgo trees with golden leaves in front of the school building. Ground covered with fallen leaves. A cartoon girl walking on a leaf-covered path.',
    watercolor: STYLE_PREFIX.watercolor +
      'A school campus in autumn. Two ginkgo trees with golden leaves in front of the school building. Ground covered with fallen leaves. A cartoon girl walking on a leaf-covered path.',
    photo: STYLE_PREFIX.photo +
      'A school campus in autumn. Two ginkgo trees with golden leaves in front of the school building. Ground carpeted with fallen leaves. A girl seen from behind walking on a leaf-covered path.',
  },
  {
    sceneKey: 'sunset',
    label: '日落',
    cartoon: STYLE_PREFIX.cartoon +
      'An orange-red sunset scene. The sun sinking behind mountains. Distant hills and trees as dark silhouettes. A cartoon child standing and watching the sunset.',
    watercolor: STYLE_PREFIX.watercolor +
      'An orange-red sunset scene. The sun sinking behind mountains. Distant hills and trees as dark silhouettes. A cartoon child standing and watching the sunset.',
    photo: STYLE_PREFIX.photo +
      'An orange-red sunset. The sun sinking behind mountains. Distant hills and trees as dark silhouettes. A child standing and watching the sunset, seen from behind.',
  },
  {
    sceneKey: 'snow-clear',
    label: '雪后晴空',
    cartoon: STYLE_PREFIX.cartoon +
      'A clear blue sky after snow. Roofs with icicles. Distant snow-capped mountains. A snowman with a scarf. A cartoon child waving.',
    watercolor: STYLE_PREFIX.watercolor +
      'A clear blue sky after snow. Roofs with icicles. Distant snow-capped mountains. A snowman with a scarf. A cartoon child waving.',
    photo: STYLE_PREFIX.photo +
      'A clear blue sky after snow. House roofs with icicles. Distant snow-capped mountains. A snowman with a scarf in the foreground. Bright winter sunlight.',
  },

  /* ---------------- 写人（19） ---------------- */
  {
    sceneKey: 'mom-cooking',
    label: '妈妈做饭',
    cartoon: STYLE_PREFIX.cartoon +
      'A kitchen scene. A cartoon mother wearing an apron standing behind a counter. A pot on the stove steaming. Chopped vegetables and a bowl on the counter.',
    watercolor: STYLE_PREFIX.watercolor +
      'A kitchen scene. A cartoon mother wearing an apron standing behind a counter. A pot on the stove steaming. Chopped vegetables and a bowl on the counter.',
    photo: STYLE_PREFIX.photo +
      'A kitchen scene. A person seen from behind wearing an apron standing at a counter. A pot on the stove steaming. Chopped vegetables and a bowl on the counter. Warm kitchen lighting.',
  },
  {
    sceneKey: 'grandpa-garden',
    label: '爷爷的花园',
    cartoon: STYLE_PREFIX.cartoon +
      'A vegetable garden with neat rows of seedlings. A cartoon grandfather wearing a straw hat holding a blue watering can. Wooden fence and a small house behind him.',
    watercolor: STYLE_PREFIX.watercolor +
      'A vegetable garden with neat rows of seedlings. A cartoon grandfather wearing a straw hat holding a blue watering can. Wooden fence and a small house behind him.',
    photo: STYLE_PREFIX.photo +
      'A vegetable garden with neat rows of seedlings. An elderly person seen from behind wearing a straw hat, holding a watering can. Wooden fence and a small house in the background.',
  },
  {
    sceneKey: 'baby-arrive',
    label: '妹妹来了',
    cartoon: STYLE_PREFIX.cartoon +
      'A room with a baby crib. A small baby lying inside. Two cartoon family members looking over the crib. Three balloons floating on the wall.',
    watercolor: STYLE_PREFIX.watercolor +
      'A room with a baby crib. A small baby lying inside. Two cartoon family members looking over the crib. Three balloons floating on the wall.',
    photo: STYLE_PREFIX.photo +
      'A room with a baby crib. A baby sleeping inside. Two family members seen from behind looking over the crib. Three balloons floating on the wall. Soft window light.',
  },
  {
    sceneKey: 'play-with-baby',
    label: '一起玩',
    cartoon: STYLE_PREFIX.cartoon +
      'A floor mat with a baby sitting on it. Two older cartoon children playing with the baby. A toy bear and building blocks scattered on the floor.',
    watercolor: STYLE_PREFIX.watercolor +
      'A floor mat with a baby sitting on it. Two older cartoon children playing with the baby. A toy bear and building blocks scattered on the floor.',
    photo: STYLE_PREFIX.photo +
      'A floor mat with a baby sitting on it. Two older children seen from behind playing with the baby. A toy bear and building blocks scattered on the floor. Warm indoor lighting.',
  },
  {
    sceneKey: 'teacher-class',
    label: '我的老师',
    cartoon: STYLE_PREFIX.cartoon +
      'A classroom scene. Chalk writing on the blackboard. A cartoon teacher standing next to the board pointing. Rows of desks with seated students below.',
    watercolor: STYLE_PREFIX.watercolor +
      'A classroom scene. Chalk writing on the blackboard. A cartoon teacher standing next to the board pointing. Rows of desks with seated students below.',
    photo: STYLE_PREFIX.photo +
      'A classroom scene. Chalk writing on the blackboard. A teacher seen from behind standing next to the board. Rows of desks with seated students below. Fluorescent lighting.',
  },
  {
    sceneKey: 'deskmate',
    label: '我的同桌',
    cartoon: STYLE_PREFIX.cartoon +
      'Two cartoon students sitting at a shared desk. Books and pens on the desk. A speech bubble above. Blackboard in the background.',
    watercolor: STYLE_PREFIX.watercolor +
      'Two cartoon students sitting at a shared desk. Books and pens on the desk. A speech bubble above. Blackboard in the background.',
    photo: STYLE_PREFIX.photo +
      'Two students sitting at a shared desk, seen from the side. Books and pens on the desk. Blackboard in the background blurred. Classroom lighting.',
  },
  {
    sceneKey: 'street-cleaner',
    label: '清晨的环卫工',
    cartoon: STYLE_PREFIX.cartoon +
      'A street at dawn. A cartoon sanitation worker in an orange uniform sweeping fallen leaves. A green garbage cart nearby. Buildings in the distance.',
    watercolor: STYLE_PREFIX.watercolor +
      'A street at dawn. A cartoon sanitation worker in an orange uniform sweeping fallen leaves. A green garbage cart nearby. Buildings in the distance.',
    photo: STYLE_PREFIX.photo +
      'A street at dawn. A sanitation worker in an orange uniform seen from behind, sweeping fallen leaves. A green garbage cart nearby. Buildings in the distance. Early morning light.',
  },
  {
    sceneKey: 'rain-delivery',
    label: '雨天的快递员',
    cartoon: STYLE_PREFIX.cartoon +
      'A rainy street scene. A cartoon delivery rider on an electric scooter with a large cardboard box strapped to the back. A red umbrella by the road. Water splashing on the ground.',
    watercolor: STYLE_PREFIX.watercolor +
      'A rainy street scene. A cartoon delivery rider on an electric scooter with a large cardboard box strapped to the back. A red umbrella by the road. Water splashing on the ground.',
    photo: STYLE_PREFIX.photo +
      'A rainy street scene. A delivery rider on an electric scooter seen from behind, with a large cardboard box strapped to the back. A red umbrella by the road. Water splashing on the ground.',
  },
  {
    sceneKey: 'mirror-self',
    label: '这就是我',
    cartoon: STYLE_PREFIX.cartoon +
      'A round wall mirror reflecting a cartoon child. The same child standing outside the mirror. A potted green plant nearby.',
    watercolor: STYLE_PREFIX.watercolor +
      'A round wall mirror reflecting a cartoon child. The same child standing outside the mirror. A potted green plant nearby.',
    photo: STYLE_PREFIX.photo +
      'A round wall mirror reflecting a room. A potted green plant on the vanity. Soft natural light from a window. No person visible, just the room reflection.',
  },
  {
    sceneKey: 'bike-fail',
    label: '摔倒了',
    cartoon: STYLE_PREFIX.cartoon +
      'A park path scene. A bicycle fallen on its side. A cartoon child sitting on the ground holding their knee. Another cartoon child reaching out to help.',
    watercolor: STYLE_PREFIX.watercolor +
      'A park path scene. A bicycle fallen on its side. A cartoon child sitting on the ground holding their knee. Another cartoon child reaching out to help.',
    photo: STYLE_PREFIX.photo +
      'A park path scene. A bicycle fallen on its side on the ground. A child sitting on the ground, another child bending down to help. Seen from a distance, soft afternoon light.',
  },
  {
    sceneKey: 'bike-ride',
    label: '学会了骑车',
    cartoon: STYLE_PREFIX.cartoon +
      'A cartoon child riding a red bicycle fast along a small path. Speed lines trailing behind. A cartoon father running after them.',
    watercolor: STYLE_PREFIX.watercolor +
      'A cartoon child riding a red bicycle fast along a small path. Speed lines trailing behind. A cartoon father running after them.',
    photo: STYLE_PREFIX.photo +
      'A child riding a red bicycle along a park path, seen from behind. An adult running after them in the distance. Motion blur, golden afternoon light.',
  },
  {
    sceneKey: 'dad-repair',
    label: '爸爸修东西',
    cartoon: STYLE_PREFIX.cartoon +
      'A yard scene. A cartoon father crouching beside an overturned bicycle, holding a wrench. A wooden toolbox on the ground nearby.',
    watercolor: STYLE_PREFIX.watercolor +
      'A yard scene. A cartoon father crouching beside an overturned bicycle, holding a wrench. A wooden toolbox on the ground nearby.',
    photo: STYLE_PREFIX.photo +
      'A yard scene. A person crouching beside an overturned bicycle, holding a wrench, seen from behind. A wooden toolbox on the ground nearby. Afternoon light.',
  },
  {
    sceneKey: 'grandma-knit',
    label: '奶奶织毛衣',
    cartoon: STYLE_PREFIX.cartoon +
      'An indoor scene. A cartoon grandmother sitting in a rocking chair knitting a sweater. Two balls of yarn on her lap. Reading glasses on her nose.',
    watercolor: STYLE_PREFIX.watercolor +
      'An indoor scene. A cartoon grandmother sitting in a rocking chair knitting a sweater. Two balls of yarn on her lap. Reading glasses on her nose.',
    photo: STYLE_PREFIX.photo +
      'An indoor scene. An elderly person seen from the side, sitting in a rocking chair knitting. Two balls of yarn on their lap. Warm lamp light.',
  },
  {
    sceneKey: 'best-friend',
    label: '我的好朋友',
    cartoon: STYLE_PREFIX.cartoon +
      'Two cartoon children standing shoulder to shoulder on grass. One in blue clothes, one in yellow. Trees and flowers nearby. A speech bubble above.',
    watercolor: STYLE_PREFIX.watercolor +
      'Two cartoon children standing shoulder to shoulder on grass. One in blue clothes, one in yellow. Trees and flowers nearby. A speech bubble above.',
    photo: STYLE_PREFIX.photo +
      'Two children standing shoulder to shoulder on grass, seen from behind. Trees and flowers nearby. Sunny day, soft bokeh background.',
  },
  {
    sceneKey: 'doctor',
    label: '看病的医生',
    cartoon: STYLE_PREFIX.cartoon +
      'A clinic scene. A cartoon doctor in a white coat standing by a desk. A stethoscope around the neck. A cartoon child sitting in front of the counter.',
    watercolor: STYLE_PREFIX.watercolor +
      'A clinic scene. A cartoon doctor in a white coat standing by a desk. A stethoscope around the neck. A cartoon child sitting in front of the counter.',
    photo: STYLE_PREFIX.photo +
      'A clinic scene. A doctor in a white coat seen from behind, standing by a desk. A stethoscope on the desk. A child sitting in front of the counter. Clinical lighting.',
  },
  {
    sceneKey: 'police',
    label: '警察叔叔',
    cartoon: STYLE_PREFIX.cartoon +
      'A traffic intersection scene. A cartoon police officer in blue uniform and cap, pointing to direct traffic. Traffic lights and crosswalk nearby.',
    watercolor: STYLE_PREFIX.watercolor +
      'A traffic intersection scene. A cartoon police officer in blue uniform and cap, pointing to direct traffic. Traffic lights and crosswalk nearby.',
    photo: STYLE_PREFIX.photo +
      'A traffic intersection scene. A police officer in uniform seen from behind, directing traffic. Traffic lights and crosswalk nearby. Urban setting.',
  },
  {
    sceneKey: 'librarian',
    label: '图书管理员',
    cartoon: STYLE_PREFIX.cartoon +
      'A library scene. Bookshelves filled with colorful book spines. A cartoon librarian with glasses standing behind the checkout counter. A cartoon child reaching to borrow a book.',
    watercolor: STYLE_PREFIX.watercolor +
      'A library scene. Bookshelves filled with colorful book spines. A cartoon librarian with glasses standing behind the checkout counter. A cartoon child reaching to borrow a book.',
    photo: STYLE_PREFIX.photo +
      'A library scene. Bookshelves filled with colorful book spines. A librarian seen from behind the checkout counter. A child reaching to borrow a book. Soft library lighting.',
  },
  {
    sceneKey: 'neighbor',
    label: '邻居阿姨',
    cartoon: STYLE_PREFIX.cartoon +
      'A front porch scene. A cartoon woman holding a vegetable basket, smiling and waving. A fence and flowers nearby.',
    watercolor: STYLE_PREFIX.watercolor +
      'A front porch scene. A cartoon woman holding a vegetable basket, smiling and waving. A fence and flowers nearby.',
    photo: STYLE_PREFIX.photo +
      'A front porch scene. A person holding a vegetable basket, seen from the side, waving. A fence and flowers nearby. Warm afternoon light.',
  },
  {
    sceneKey: 'bus-driver',
    label: '公交司机',
    cartoon: STYLE_PREFIX.cartoon +
      'A yellow bus stopped by the road. A cartoon driver behind the steering wheel. A fare box and bus stop sign at the front of the bus.',
    watercolor: STYLE_PREFIX.watercolor +
      'A yellow bus stopped by the road. A cartoon driver behind the steering wheel. A fare box and bus stop sign at the front of the bus.',
    photo: STYLE_PREFIX.photo +
      'A yellow bus stopped by the road, seen from the side. A driver visible through the window. A bus stop sign at the front. Urban street setting.',
  },

  /* ---------------- 写事（37） ---------------- */
  {
    sceneKey: 'cook-start',
    label: '准备开始',
    cartoon: STYLE_PREFIX.cartoon +
      'A kitchen counter scene. A cutting board, vegetables, eggs, and bowls laid out. A cartoon child wearing an apron standing ready. A recipe posted on the wall.',
    watercolor: STYLE_PREFIX.watercolor +
      'A kitchen counter scene. A cutting board, vegetables, eggs, and bowls laid out. A cartoon child wearing an apron standing ready. A recipe posted on the wall.',
    photo: STYLE_PREFIX.photo +
      'A kitchen counter scene. A cutting board, vegetables, eggs, and bowls neatly laid out. An apron hanging nearby. A recipe card on the wall. Warm kitchen lighting.',
  },
  {
    sceneKey: 'cook-mess',
    label: '手忙脚乱',
    cartoon: STYLE_PREFIX.cartoon +
      'A chaotic kitchen scene. White flour dust everywhere. A cartoon child with hands spread wide, surprised expression. A bowl tipped over, pot contents overflowing.',
    watercolor: STYLE_PREFIX.watercolor +
      'A chaotic kitchen scene. White flour dust everywhere. A cartoon child with hands spread wide, surprised expression. A bowl tipped over, pot contents overflowing.',
    photo: STYLE_PREFIX.photo +
      'A chaotic kitchen scene. Flour dust in the air. A tipped over bowl, pot contents overflowing on the stove. Messy counter. No person visible, just the chaos.',
  },
  {
    sceneKey: 'cook-done',
    label: '端上桌了',
    cartoon: STYLE_PREFIX.cartoon +
      'A family dinner table scene. A cartoon family seated around the table. A steaming dish in the center. Small plates in front of each person.',
    watercolor: STYLE_PREFIX.watercolor +
      'A family dinner table scene. A cartoon family seated around the table. A steaming dish in the center. Small plates in front of each person.',
    photo: STYLE_PREFIX.photo +
      'A family dinner table seen from above. A steaming dish in the center. Small plates and bowls around. Warm dining room lighting. Hands visible holding chopsticks.',
  },
  {
    sceneKey: 'stage-nervous',
    label: '第一次上台',
    cartoon: STYLE_PREFIX.cartoon +
      'A stage scene with red curtains pulled open. A spotlight illuminating a single cartoon child standing center stage. A dark audience visible below.',
    watercolor: STYLE_PREFIX.watercolor +
      'A stage scene with red curtains pulled open. A spotlight illuminating a single cartoon child standing center stage. A dark audience visible below.',
    photo: STYLE_PREFIX.photo +
      'A stage scene with red curtains pulled open. A spotlight illuminating center stage. A dark audience visible below. Dramatic stage lighting, seen from the back of the auditorium.',
  },
  {
    sceneKey: 'memory-album',
    label: '那一次，我很难忘',
    cartoon: STYLE_PREFIX.cartoon +
      'A table with an open thick photo album. Two pages each with a photo. A cartoon child sitting beside, flipping through.',
    watercolor: STYLE_PREFIX.watercolor +
      'A table with an open thick photo album. Two pages each with a photo. A cartoon child sitting beside, flipping through.',
    photo: STYLE_PREFIX.photo +
      'A table with an open photo album. Two pages each with a photo. A child seen from behind sitting beside, flipping through. Warm desk lamp light.',
  },
  {
    sceneKey: 'lost-crowd',
    label: '找不到妈妈了',
    cartoon: STYLE_PREFIX.cartoon +
      'A busy street scene with many tall adult figures walking. A small cartoon child in the middle looking up with a worried expression. A speech bubble above their head.',
    watercolor: STYLE_PREFIX.watercolor +
      'A busy street scene with many tall adult figures walking. A small cartoon child in the middle looking up with a worried expression. A speech bubble above their head.',
    photo: STYLE_PREFIX.photo +
      'A busy street scene with many adults walking, seen from above. A small child in the middle looking up. Crowded urban setting, motion blur on the crowd.',
  },
  {
    sceneKey: 'found-mom',
    label: '终于找到了',
    cartoon: STYLE_PREFIX.cartoon +
      'A reunion scene. A cartoon mother crouching with open arms. A cartoon child running into her embrace. A small heart between them. Surrounding crowd blurred.',
    watercolor: STYLE_PREFIX.watercolor +
      'A reunion scene. A cartoon mother crouching with open arms. A cartoon child running into her embrace. A small heart between them. Surrounding crowd blurred.',
    photo: STYLE_PREFIX.photo +
      'A reunion scene. An adult crouching with open arms. A child running into the embrace. Surrounding crowd blurred with shallow depth of field.',
  },
  {
    sceneKey: 'help-hand',
    label: '他扶了我一把',
    cartoon: STYLE_PREFIX.cartoon +
      'A playground scene. A cartoon child sitting on the ground holding their knee. Another cartoon child bending down, reaching out to pull them up. Action lines.',
    watercolor: STYLE_PREFIX.watercolor +
      'A playground scene. A cartoon child sitting on the ground holding their knee. Another cartoon child bending down, reaching out to pull them up. Action lines.',
    photo: STYLE_PREFIX.photo +
      'A playground scene. A child sitting on the ground holding their knee. Another child bending down, reaching out to help. Seen from a distance, soft afternoon light.',
  },
  {
    sceneKey: 'umbrella-rain',
    label: '雨中送伞',
    cartoon: STYLE_PREFIX.cartoon +
      'A rainy street scene. Two cartoon people sharing an orange umbrella. Puddles on the ground. Grey-blue buildings in the distance.',
    watercolor: STYLE_PREFIX.watercolor +
      'A rainy street scene. Two cartoon people sharing an orange umbrella. Puddles on the ground. Grey-blue buildings in the distance.',
    photo: STYLE_PREFIX.photo +
      'A rainy street scene. Two people sharing an orange umbrella, seen from behind. Puddles on the ground reflecting light. Grey-blue buildings in the distance. Rainy atmosphere.',
  },
  {
    sceneKey: 'sports-day',
    label: '热闹的运动会',
    cartoon: STYLE_PREFIX.cartoon +
      'A school sports day scene. Colorful flags hung across the top. Four cartoon children racing on a track. A row of cheering classmates on the inside. School building in the background.',
    watercolor: STYLE_PREFIX.watercolor +
      'A school sports day scene. Colorful flags hung across the top. Four cartoon children racing on a track. A row of cheering classmates on the inside. School building in the background.',
    photo: STYLE_PREFIX.photo +
      'A school sports day. Colorful flags hung across. Four children racing on a track, seen from the side. A row of cheering classmates. School building in the background. Sunny day.',
  },
  {
    sceneKey: 'spring-outing-bus',
    label: '春游·大巴',
    cartoon: STYLE_PREFIX.cartoon +
      'A yellow tour bus stopped by the road. Several cartoon children lining up to board. A teacher waving nearby. Pink flowering trees along the road.',
    watercolor: STYLE_PREFIX.watercolor +
      'A yellow tour bus stopped by the road. Several cartoon children lining up to board. A teacher waving nearby. Pink flowering trees along the road.',
    photo: STYLE_PREFIX.photo +
      'A yellow tour bus stopped by the road. Children lining up to board, seen from behind. Pink flowering trees along the road. Spring morning light.',
  },
  {
    sceneKey: 'spring-outing-picnic',
    label: '春游·野餐',
    cartoon: STYLE_PREFIX.cartoon +
      'A picnic scene on grass. A pink checkered cloth with a basket and food. Three cartoon children sitting in a circle. Flowering trees nearby.',
    watercolor: STYLE_PREFIX.watercolor +
      'A picnic scene on grass. A pink checkered cloth with a basket and food. Three cartoon children sitting in a circle. Flowering trees nearby.',
    photo: STYLE_PREFIX.photo +
      'A picnic scene on grass. A checkered cloth with a basket and food. Three children sitting in a circle, seen from above. Flowering trees nearby. Dappled sunlight.',
  },
  {
    sceneKey: 'spring-outing-play',
    label: '春游·游戏',
    cartoon: STYLE_PREFIX.cartoon +
      'A grassy field scene. A cartoon child flying a kite with the kite high in the air. Two other cartoon children running. Bubbles and petals floating in the sky.',
    watercolor: STYLE_PREFIX.watercolor +
      'A grassy field scene. A cartoon child flying a kite with the kite high in the air. Two other cartoon children running. Bubbles and petals floating in the sky.',
    photo: STYLE_PREFIX.photo +
      'A grassy field. A child flying a kite, seen from behind, the kite high in the air. Two other children running in the distance. Spring sky with clouds.',
  },
  {
    sceneKey: 'cleaning-class',
    label: '大扫除',
    cartoon: STYLE_PREFIX.cartoon +
      'A classroom cleaning scene. One cartoon child wiping windows, one sweeping, one carrying a bucket. Desks pushed to one side. Chalk writing still on the blackboard.',
    watercolor: STYLE_PREFIX.watercolor +
      'A classroom cleaning scene. One cartoon child wiping windows, one sweeping, one carrying a bucket. Desks pushed to one side. Chalk writing still on the blackboard.',
    photo: STYLE_PREFIX.photo +
      'A classroom cleaning scene. One child wiping windows seen from behind, one sweeping, one carrying a bucket. Desks pushed to one side. Chalk writing on the blackboard. Morning light.',
  },
  {
    sceneKey: 'lie-truth',
    label: '说谎与承认',
    cartoon: STYLE_PREFIX.cartoon +
      'An indoor scene. A cartoon child standing with head bowed. An adult crouching to meet the child at eye level, listening. A vase with flowers on the table.',
    watercolor: STYLE_PREFIX.watercolor +
      'An indoor scene. A cartoon child standing with head bowed. An adult crouching to meet the child at eye level, listening. A vase with flowers on the table.',
    photo: STYLE_PREFIX.photo +
      'An indoor scene. A child standing with head bowed seen from the side. An adult crouching to meet the child at eye level. A vase with flowers on the table. Soft indoor light.',
  },
  {
    sceneKey: 'broken-vase',
    label: '打碎花瓶',
    cartoon: STYLE_PREFIX.cartoon +
      'A floor scene with scattered blue-green vase fragments and flowers. A cartoon child standing nearby with mouth wide open in surprise. A cat in the corner.',
    watercolor: STYLE_PREFIX.watercolor +
      'A floor scene with scattered blue-green vase fragments and flowers. A cartoon child standing nearby with mouth wide open in surprise. A cat in the corner.',
    photo: STYLE_PREFIX.photo +
      'A floor scene with scattered ceramic vase fragments and flowers. A child standing nearby, seen from behind. A cat in the corner. Indoor lighting.',
  },
  {
    sceneKey: 'late',
    label: '迟到了',
    cartoon: STYLE_PREFIX.cartoon +
      'A school gate scene in the morning. A cartoon child with a backpack running fast. A clock showing 8:10 above. School gate in the distance.',
    watercolor: STYLE_PREFIX.watercolor +
      'A school gate scene in the morning. A cartoon child with a backpack running fast. A clock showing 8:10 above. School gate in the distance.',
    photo: STYLE_PREFIX.photo +
      'A school gate scene in the morning. A child with a backpack running, seen from behind. A clock tower showing 8:10 above. School gate in the distance. Morning light.',
  },
  {
    sceneKey: 'award',
    label: '得奖了',
    cartoon: STYLE_PREFIX.cartoon +
      'A podium scene. A cartoon child on the podium raising a golden trophy. Classmates applauding below. Colorful flags hanging above.',
    watercolor: STYLE_PREFIX.watercolor +
      'A podium scene. A cartoon child on the podium raising a golden trophy. Classmates applauding below. Colorful flags hanging above.',
    photo: STYLE_PREFIX.photo +
      'A podium scene. A child on the podium raising a golden trophy, seen from behind. Classmates applauding below. Colorful flags hanging above. Stage lighting.',
  },
  {
    sceneKey: 'sick',
    label: '生病了',
    cartoon: STYLE_PREFIX.cartoon +
      'A bedroom scene. A cartoon child lying in bed under a blue blanket. A thermometer and medicine cup on the nightstand. A cartoon mother sitting by the bed.',
    watercolor: STYLE_PREFIX.watercolor +
      'A bedroom scene. A cartoon child lying in bed under a blue blanket. A thermometer and medicine cup on the nightstand. A cartoon mother sitting by the bed.',
    photo: STYLE_PREFIX.photo +
      'A bedroom scene. A child lying in bed under a blue blanket, seen from the side. A thermometer and medicine cup on the nightstand. A chair beside the bed. Soft window light.',
  },
  {
    sceneKey: 'moving',
    label: '搬新家',
    cartoon: STYLE_PREFIX.cartoon +
      'An empty new room with several large cardboard boxes. A cartoon child holding a small box. Pink curtains on the window.',
    watercolor: STYLE_PREFIX.watercolor +
      'An empty new room with several large cardboard boxes. A cartoon child holding a small box. Pink curtains on the window.',
    photo: STYLE_PREFIX.photo +
      'An empty new room with several large cardboard boxes. Bright natural light from a window with pink curtains. Scattered packing materials.',
  },
  {
    sceneKey: 'exam-nervous',
    label: '考试前夜',
    cartoon: STYLE_PREFIX.cartoon +
      'A study desk scene at night. A cartoon child sitting at the desk. Textbooks and a desk lamp on the desk. A clock on the wall. The child has a nervous expression.',
    watercolor: STYLE_PREFIX.watercolor +
      'A study desk scene at night. A cartoon child sitting at the desk. Textbooks and a desk lamp on the desk. A clock on the wall. The child has a nervous expression.',
    photo: STYLE_PREFIX.photo +
      'A study desk scene at night. Textbooks and a desk lamp on the desk, lamp glowing. A clock on the wall. A child seen from behind studying. Dark room, warm lamp light.',
  },
  {
    sceneKey: 'graduation',
    label: '毕业告别',
    cartoon: STYLE_PREFIX.cartoon +
      'Three cartoon children in school uniforms wearing graduation caps, standing in a row. Some holding flower bouquets. Colorful flags hanging above.',
    watercolor: STYLE_PREFIX.watercolor +
      'Three cartoon children in school uniforms wearing graduation caps, standing in a row. Some holding flower bouquets. Colorful flags hanging above.',
    photo: STYLE_PREFIX.photo +
      'Three children in school uniforms wearing graduation caps, standing in a row, seen from behind. Some holding flower bouquets. Colorful flags hanging above. Sunny day.',
  },
  {
    sceneKey: 'sleep-alone',
    label: '第一次独睡',
    cartoon: STYLE_PREFIX.cartoon +
      'A nighttime bedroom scene with blue moonlight. Moon and stars visible through the window. The blanket on the bed is bunched up, only a pair of eyes peeking out.',
    watercolor: STYLE_PREFIX.watercolor +
      'A nighttime bedroom scene with blue moonlight. Moon and stars visible through the window. The blanket on the bed is bunched up, only a pair of eyes peeking out.',
    photo: STYLE_PREFIX.photo +
      'A nighttime bedroom scene with blue moonlight. Moon and stars visible through the window. The blanket on the bed is bunched up. Dark, moody atmosphere.',
  },
  {
    sceneKey: 'birthday',
    label: '过生日',
    cartoon: STYLE_PREFIX.cartoon +
      'A birthday scene. A cake with five lit candles on a table. Family members standing on both sides. Colorful flags and balloons decorating the room.',
    watercolor: STYLE_PREFIX.watercolor +
      'A birthday scene. A cake with five lit candles on a table. Family members standing on both sides. Colorful flags and balloons decorating the room.',
    photo: STYLE_PREFIX.photo +
      'A birthday cake with five lit candles on a table, seen from above. Balloons and colorful flags in the background. Warm candlelit glow.',
  },
  {
    sceneKey: 'book-store',
    label: '书店',
    cartoon: STYLE_PREFIX.cartoon +
      'A cozy bookstore scene. Warm-toned bookshelves filled with colorful book spines. A cartoon child standing at the counter looking at books. A store sign hanging at the entrance.',
    watercolor: STYLE_PREFIX.watercolor +
      'A cozy bookstore scene. Warm-toned bookshelves filled with colorful book spines. A cartoon child standing at the counter looking at books. A store sign hanging at the entrance.',
    photo: STYLE_PREFIX.photo +
      'A cozy bookstore interior. Warm-toned bookshelves filled with colorful book spines. A child seen from behind at the counter looking at books. Warm ambient lighting.',
  },
  {
    sceneKey: 'look-picture-single',
    label: '看图作文（单图）',
    cartoon: STYLE_PREFIX.cartoon +
      'A large picture of a spring park scene hanging on a wall. A cartoon child leaning over a desk looking at it carefully. A pencil and paper on the desk.',
    watercolor: STYLE_PREFIX.watercolor +
      'A large picture of a spring park scene hanging on a wall. A cartoon child leaning over a desk looking at it carefully. A pencil and paper on the desk.',
    photo: STYLE_PREFIX.photo +
      'A large framed picture of a spring park scene hanging on a wall. A child leaning over a desk looking at it, seen from behind. A pencil and paper on the desk. Desk lamp light.',
  },
  {
    sceneKey: 'look-picture-series',
    label: '看图作文（连环图）',
    cartoon: STYLE_PREFIX.cartoon +
      'Three small framed pictures hanging on a wall in a row, connected by arrows, showing three scenes of a story. A pencil and paper on the desk below.',
    watercolor: STYLE_PREFIX.watercolor +
      'Three small framed pictures hanging on a wall in a row, connected by arrows, showing three scenes of a story. A pencil and paper on the desk below.',
    photo: STYLE_PREFIX.photo +
      'Three small framed pictures hanging on a wall in a row, connected by arrows. A pencil and paper on the desk below. Indoor lighting, shallow depth of field.',
  },
  {
    sceneKey: 'festival',
    label: '传统节日',
    cartoon: STYLE_PREFIX.cartoon +
      'A traditional festival scene. Lanterns and fireworks in the sky. Two red-roofed houses with mooncakes and dumplings on a table between them. A cartoon child in red waving.',
    watercolor: STYLE_PREFIX.watercolor +
      'A traditional festival scene. Lanterns and fireworks in the sky. Two red-roofed houses with mooncakes and dumplings on a table between them. A cartoon child in red waving.',
    photo: STYLE_PREFIX.photo +
      'A traditional Chinese festival night scene. Red lanterns glowing. Two houses with mooncakes and dumplings on a table. Fireworks in the sky. Warm festive atmosphere.',
  },
  {
    sceneKey: 'experiment',
    label: '小实验',
    cartoon: STYLE_PREFIX.cartoon +
      'A science experiment scene. A beaker with bubbles on a table, a dropper dripping pink liquid above. A notebook nearby. A cartoon child observing carefully. A large question mark above.',
    watercolor: STYLE_PREFIX.watercolor +
      'A science experiment scene. A beaker with bubbles on a table, a dropper dripping pink liquid above. A notebook nearby. A cartoon child observing carefully. A large question mark above.',
    photo: STYLE_PREFIX.photo +
      'A science experiment scene. A glass beaker with bubbles on a table, a dropper dripping colored liquid above. A notebook nearby. A child seen from behind observing. Lab lighting.',
  },
  {
    sceneKey: 'observe-diary',
    label: '观察日记',
    cartoon: STYLE_PREFIX.cartoon +
      'A desk scene. A diary notebook and pencil on the desk. A glass jar with garlic bulbs sprouting three green shoots. A magnifying glass above. A wall calendar showing "Day 7 of observation".',
    watercolor: STYLE_PREFIX.watercolor +
      'A desk scene. A diary notebook and pencil on the desk. A glass jar with garlic bulbs sprouting three green shoots. A magnifying glass above. A wall calendar showing "Day 7 of observation".',
    photo: STYLE_PREFIX.photo +
      'A desk scene. A diary notebook and pencil on the desk. A glass jar with garlic bulbs sprouting green shoots. A magnifying glass on the desk. A wall calendar. Natural window light.',
  },
  {
    sceneKey: 'write-letter',
    label: '写信',
    cartoon: STYLE_PREFIX.cartoon +
      'A desk scene with an envelope, stamp, and letter paper. A pencil lying diagonally. A cartoon child writing. A red heart floating above.',
    watercolor: STYLE_PREFIX.watercolor +
      'A desk scene with an envelope, stamp, and letter paper. A pencil lying diagonally. A cartoon child writing. A red heart floating above.',
    photo: STYLE_PREFIX.photo +
      'A desk scene with an envelope, stamp, and letter paper. A pencil lying diagonally. A child seen from behind writing. Warm desk lamp light.',
  },
  {
    sceneKey: 'play-game',
    label: '游戏',
    cartoon: STYLE_PREFIX.cartoon +
      'A tug-of-war game on grass. Two teams of cartoon children pulling a rope with a red ribbon in the middle. Children bending and straining. Spectators cheering on the sides.',
    watercolor: STYLE_PREFIX.watercolor +
      'A tug-of-war game on grass. Two teams of cartoon children pulling a rope with a red ribbon in the middle. Children bending and straining. Spectators cheering on the sides.',
    photo: STYLE_PREFIX.photo +
      'A tug-of-war game on grass. Two teams of children pulling a rope, seen from the side. Children bending and straining. Spectators on the sides. Sunny day.',
  },
  {
    sceneKey: 'reading-notes',
    label: '读后感',
    cartoon: STYLE_PREFIX.cartoon +
      'A bookshelf full of books. An open pink book on the desk. A notebook labeled "reading notes" beside it. A thought bubble above.',
    watercolor: STYLE_PREFIX.watercolor +
      'A bookshelf full of books. An open pink book on the desk. A notebook labeled "reading notes" beside it. A thought bubble above.',
    photo: STYLE_PREFIX.photo +
      'A bookshelf full of books. An open book on the desk. A notebook beside it. Warm reading lamp light. Cozy reading nook atmosphere.',
  },
  {
    sceneKey: 'comic-teacher',
    label: '漫画老师',
    cartoon: STYLE_PREFIX.cartoon +
      'A classroom scene. A cartoon teacher with glasses standing in front of the blackboard, holding a pointer. Two cartoon students sitting at desks below.',
    watercolor: STYLE_PREFIX.watercolor +
      'A classroom scene. A cartoon teacher with glasses standing in front of the blackboard, holding a pointer. Two cartoon students sitting at desks below.',
    photo: STYLE_PREFIX.photo +
      'A classroom scene. A teacher with glasses seen from behind, standing in front of the blackboard. Two students sitting at desks below. Classroom lighting.',
  },
  {
    sceneKey: 'introduce-thing',
    label: '介绍一种事物',
    cartoon: STYLE_PREFIX.cartoon +
      'A presentation scene. A laptop on a display table. Annotation lines pointing to "shape", "function", and "use". A cartoon child presenting.',
    watercolor: STYLE_PREFIX.watercolor +
      'A presentation scene. A laptop on a display table. Annotation lines pointing to "shape", "function", and "use". A cartoon child presenting.',
    photo: STYLE_PREFIX.photo +
      'A presentation scene. A laptop on a display table. A child seen from behind presenting. Clean background. Presentation lighting.',
  },
  {
    sceneKey: 'all-kinds-people',
    label: '形形色色的人',
    cartoon: STYLE_PREFIX.cartoon +
      'A row of cartoon children in different poses and colors standing on grass. Speech bubbles above each labeled "classmate", "passerby", "neighbor".',
    watercolor: STYLE_PREFIX.watercolor +
      'A row of cartoon children in different poses and colors standing on grass. Speech bubbles above each labeled "classmate", "passerby", "neighbor".',
    photo: STYLE_PREFIX.photo +
      'A diverse group of people in different clothing seen from behind, standing on a street. Urban setting. Various heights and postures.',
  },
  {
    sceneKey: 'adventure-trip',
    label: '探险之旅',
    cartoon: STYLE_PREFIX.cartoon +
      'A cave entrance scene. A cartoon child with a backpack holding a flashlight walking in. The beam of light illuminating a treasure chest inside.',
    watercolor: STYLE_PREFIX.watercolor +
      'A cave entrance scene. A cartoon child with a backpack holding a flashlight walking in. The beam of light illuminating a treasure chest inside.',
    photo: STYLE_PREFIX.photo +
      'A dark cave entrance. A child with a backpack holding a flashlight, seen from behind, walking in. The beam of light illuminating the cave interior. Dramatic lighting.',
  },
  {
    sceneKey: 'comic-inspiration',
    label: '漫画的启示',
    cartoon: STYLE_PREFIX.cartoon +
      'Four-panel comic frames hanging on a wall. Each frame has a cartoon figure in a different pose. A cartoon child at the desk below looking at comics.',
    watercolor: STYLE_PREFIX.watercolor +
      'Four-panel comic frames hanging on a wall. Each frame has a cartoon figure in a different pose. A cartoon child at the desk below looking at comics.',
    photo: STYLE_PREFIX.photo +
      'Four framed comic panels hanging on a wall. A child at the desk below looking at them, seen from behind. Indoor lighting.',
  },
  {
    sceneKey: 'colorful-activity',
    label: '多彩的活动',
    cartoon: STYLE_PREFIX.cartoon +
      'An oval running track scene. Cartoon children running and jumping rope. Spectators waving on both sides. A banner reading "Sports Day" across the top.',
    watercolor: STYLE_PREFIX.watercolor +
      'An oval running track scene. Cartoon children running and jumping rope. Spectators waving on both sides. A banner reading "Sports Day" across the top.',
    photo: STYLE_PREFIX.photo +
      'An oval running track. Children running and jumping rope. Spectators on both sides. A banner across the top. Sunny day, wide angle.',
  },
  {
    sceneKey: 'pen-story',
    label: '笔尖流出的故事',
    cartoon: STYLE_PREFIX.cartoon +
      'A large open notebook on a desk. A pencil writing diagonally. A tiny figure and sparkles emerging from the pencil tip. A thought bubble nearby.',
    watercolor: STYLE_PREFIX.watercolor +
      'A large open notebook on a desk. A pencil writing diagonally. A tiny figure and sparkles emerging from the pencil tip. A thought bubble nearby.',
    photo: STYLE_PREFIX.photo +
      'A large open notebook on a desk. A pencil lying diagonally on the page. Hand writing. Warm desk lamp light. Shallow depth of field.',
  },
  {
    sceneKey: 'my-talent',
    label: '我的拿手好戏',
    cartoon: STYLE_PREFIX.cartoon +
      'A spotlight scene. A piano under the light. A cartoon child sitting on a bench playing. Purple musical notes floating nearby.',
    watercolor: STYLE_PREFIX.watercolor +
      'A spotlight scene. A piano under the light. A cartoon child sitting on a bench playing. Purple musical notes floating nearby.',
    photo: STYLE_PREFIX.photo +
      'A grand piano under a spotlight. A child seen from behind sitting on a bench playing. Dark stage background. Dramatic spotlight lighting.',
  },
  {
    sceneKey: 'hometown-custom',
    label: '家乡的风俗',
    cartoon: STYLE_PREFIX.cartoon +
      'A traditional hometown scene. Two old-style houses with lanterns and firecrackers hanging between them. Bowls and tangyuan on a table. A cartoon child in red waving.',
    watercolor: STYLE_PREFIX.watercolor +
      'A traditional hometown scene. Two old-style houses with lanterns and firecrackers hanging between them. Bowls and tangyuan on a table. A cartoon child in red waving.',
    photo: STYLE_PREFIX.photo +
      'A traditional Chinese hometown alley. Two old-style houses with red lanterns hanging between them. Bowls of tangyuan on a table. Festive warm atmosphere.',
  },
  {
    sceneKey: 'farewell-school',
    label: '难忘小学生活',
    cartoon: STYLE_PREFIX.cartoon +
      'A school building entrance scene. Four cartoon children in different colored clothes waving. A school flag and a "Farewell" banner at the gate.',
    watercolor: STYLE_PREFIX.watercolor +
      'A school building entrance scene. Four cartoon children in different colored clothes waving. A school flag and a "Farewell" banner at the gate.',
    photo: STYLE_PREFIX.photo +
      'A school building entrance. Four children in different colored clothes, seen from behind, waving. A school flag and a banner at the gate. Sunny day.',
  },

  /* ---------------- 状物（20） ---------------- */
  {
    sceneKey: 'cat-sun',
    label: '晒太阳的猫',
    cartoon: STYLE_PREFIX.cartoon +
      'A floor scene with a diagonal beam of sunlight. An orange cartoon cat napping in the sun with eyes closed. A ball of yarn and a potted pothos nearby.',
    watercolor: STYLE_PREFIX.watercolor +
      'A floor scene with a diagonal beam of sunlight. An orange cartoon cat napping in the sun with eyes closed. A ball of yarn and a potted pothos nearby.',
    photo: STYLE_PREFIX.photo +
      'A wooden floor with a diagonal beam of sunlight. An orange cat napping in the sun with eyes closed. A ball of yarn and a potted pothos nearby. Warm afternoon light.',
  },
  {
    sceneKey: 'dog-welcome',
    label: '小狗迎接',
    cartoon: STYLE_PREFIX.cartoon +
      'An open door scene. A cartoon puppy with wagging tail running toward the entrance. A cartoon child standing at the door with open arms. Speed lines on the floor.',
    watercolor: STYLE_PREFIX.watercolor +
      'An open door scene. A cartoon puppy with wagging tail running toward the entrance. A cartoon child standing at the door with open arms. Speed lines on the floor.',
    photo: STYLE_PREFIX.photo +
      'An open door scene. A puppy with wagging tail running toward the entrance, motion blur. Bright daylight from outside. Seen from inside the hallway.',
  },
  {
    sceneKey: 'bird-window',
    label: '窗边的小鸟',
    cartoon: STYLE_PREFIX.cartoon +
      'A windowsill scene. A small blue bird perched on the sill. A potted plant nearby. A cartoon child quietly watching from inside.',
    watercolor: STYLE_PREFIX.watercolor +
      'A windowsill scene. A small blue bird perched on the sill. A potted plant nearby. A cartoon child quietly watching from inside.',
    photo: STYLE_PREFIX.photo +
      'A windowsill. A small blue bird perched on the sill. A potted plant nearby. Soft natural light through the window. Shallow depth of field.',
  },
  {
    sceneKey: 'pothos',
    label: '绿萝',
    cartoon: STYLE_PREFIX.cartoon +
      'A bookshelf with a potted pothos plant. Heart-shaped leaves cascading down from the pot edge. A bright window nearby.',
    watercolor: STYLE_PREFIX.watercolor +
      'A bookshelf with a potted pothos plant. Heart-shaped leaves cascading down from the pot edge. A bright window nearby.',
    photo: STYLE_PREFIX.photo +
      'A bookshelf with a potted pothos plant. Heart-shaped leaves cascading down from the pot edge. Bright natural light from a window nearby.',
  },
  {
    sceneKey: 'dandelion',
    label: '蒲公英',
    cartoon: STYLE_PREFIX.cartoon +
      'A grassy patch with several dandelions. One white puffball dispersing, seeds floating up into the sky on the wind.',
    watercolor: STYLE_PREFIX.watercolor +
      'A grassy patch with several dandelions. One white puffball dispersing, seeds floating up into the sky on the wind.',
    photo: STYLE_PREFIX.photo +
      'A grassy patch with several dandelions. One white puffball dispersing, seeds floating up into the sky. Soft natural light, shallow depth of field.',
  },
  {
    sceneKey: 'backpack',
    label: '我的书包',
    cartoon: STYLE_PREFIX.cartoon +
      'A classroom scene. A blue backpack hanging on a chair back. Books and a pencil on the desk. Blackboard in the background.',
    watercolor: STYLE_PREFIX.watercolor +
      'A classroom scene. A blue backpack hanging on a chair back. Books and a pencil on the desk. Blackboard in the background.',
    photo: STYLE_PREFIX.photo +
      'A classroom desk. A blue backpack hanging on a chair back. Books and a pencil on the desk. Blackboard in the background blurred. Classroom lighting.',
  },
  {
    sceneKey: 'eraser-talking',
    label: '会说话的橡皮',
    cartoon: STYLE_PREFIX.cartoon +
      'A desk scene. A pink eraser with a cartoon smiley face. A pencil lying next to it. A speech bubble above the eraser.',
    watercolor: STYLE_PREFIX.watercolor +
      'A desk scene. A pink eraser with a cartoon smiley face. A pencil lying next to it. A speech bubble above the eraser.',
    photo: STYLE_PREFIX.photo +
      'A desk scene. A pink eraser and a pencil lying on a notebook. Close-up, shallow depth of field. Warm desk lighting.',
  },
  {
    sceneKey: 'sewing-box',
    label: '针线盒',
    cartoon: STYLE_PREFIX.cartoon +
      'An open sewing box with five spools of colorful thread. Scissors, a thimble, needles, and buttons nearby.',
    watercolor: STYLE_PREFIX.watercolor +
      'An open sewing box with five spools of colorful thread. Scissors, a thimble, needles, and buttons nearby.',
    photo: STYLE_PREFIX.photo +
      'An open sewing box with spools of colorful thread. Scissors, a thimble, needles, and buttons arranged inside. Close-up, natural light.',
  },
  {
    sceneKey: 'old-toy',
    label: '旧玩具',
    cartoon: STYLE_PREFIX.cartoon +
      'A shelf scene. An old worn-out teddy bear with a missing ear and a patch. A photo frame and a small wooden box nearby. Warm lighting.',
    watercolor: STYLE_PREFIX.watercolor +
      'A shelf scene. An old worn-out teddy bear with a missing ear and a patch. A photo frame and a small wooden box nearby. Warm lighting.',
    photo: STYLE_PREFIX.photo +
      'A shelf with an old worn-out teddy bear with a missing ear and a patch. A photo frame and a small wooden box nearby. Warm, nostalgic lighting.',
  },
  {
    sceneKey: 'dumplings',
    label: '包饺子',
    cartoon: STYLE_PREFIX.cartoon +
      'A cutting board with a row of freshly made dumplings. A rolling pin, flour, and a steaming pot nearby. Two cartoon hands shaping a dumpling.',
    watercolor: STYLE_PREFIX.watercolor +
      'A cutting board with a row of freshly made dumplings. A rolling pin, flour, and a steaming pot nearby. Two cartoon hands shaping a dumpling.',
    photo: STYLE_PREFIX.photo +
      'A wooden cutting board with a row of freshly made dumplings. A rolling pin, flour, and a steaming pot nearby. Hands shaping a dumpling. Warm kitchen lighting.',
  },
  {
    sceneKey: 'noodle-soup',
    label: '一碗面',
    cartoon: STYLE_PREFIX.cartoon +
      'A white bowl on a table with steaming hot noodles, egg, and green vegetables. A pair of chopsticks resting beside the bowl. Sunlight from a window.',
    watercolor: STYLE_PREFIX.watercolor +
      'A white bowl on a table with steaming hot noodles, egg, and green vegetables. A pair of chopsticks resting beside the bowl. Sunlight from a window.',
    photo: STYLE_PREFIX.photo +
      'A white bowl on a wooden table with steaming hot noodles, egg, and green vegetables. A pair of chopsticks resting beside the bowl. Natural window light.',
  },
  {
    sceneKey: 'goldfish',
    label: '金鱼缸',
    cartoon: STYLE_PREFIX.cartoon +
      'A transparent glass fishbowl with two goldfish swimming. Colorful pebbles at the bottom. Water plants growing. A string of small bubbles rising.',
    watercolor: STYLE_PREFIX.watercolor +
      'A transparent glass fishbowl with two goldfish swimming. Colorful pebbles at the bottom. Water plants growing. A string of small bubbles rising.',
    photo: STYLE_PREFIX.photo +
      'A transparent glass fishbowl with two goldfish swimming. Colorful pebbles at the bottom. Water plants growing. Bubbles rising. Close-up, natural light.',
  },
  {
    sceneKey: 'pencil-case',
    label: '文具盒',
    cartoon: STYLE_PREFIX.cartoon +
      'An open pencil case with a pen, pencil, ruler, and eraser neatly arranged in compartments. All items in order.',
    watercolor: STYLE_PREFIX.watercolor +
      'An open pencil case with a pen, pencil, ruler, and eraser neatly arranged in compartments. All items in order.',
    photo: STYLE_PREFIX.photo +
      'An open pencil case with a pen, pencil, ruler, and eraser neatly arranged in compartments. Close-up, shallow depth of field. Natural light.',
  },
  {
    sceneKey: 'my-room',
    label: '我的房间',
    cartoon: STYLE_PREFIX.cartoon +
      'A small room with a bed, desk, and bookshelf. Window with curtains. A desk lamp and books on the desk. Pictures on the wall.',
    watercolor: STYLE_PREFIX.watercolor +
      'A small room with a bed, desk, and bookshelf. Window with curtains. A desk lamp and books on the desk. Pictures on the wall.',
    photo: STYLE_PREFIX.photo +
      'A cozy small bedroom with a bed, desk, and bookshelf. Window with curtains. A desk lamp and books on the desk. Pictures on the wall. Natural light.',
  },
  {
    sceneKey: 'lotus',
    label: '荷花',
    cartoon: STYLE_PREFIX.cartoon +
      'A pond surface with round lotus leaves. A pink lotus flower in full bloom. A bud nearby. A dragonfly perched on the flower tip.',
    watercolor: STYLE_PREFIX.watercolor +
      'A pond surface with round lotus leaves. A pink lotus flower in full bloom. A bud nearby. A dragonfly perched on the flower tip.',
    photo: STYLE_PREFIX.photo +
      'A pond surface with round green lotus leaves. A pink lotus flower in full bloom. A bud nearby. A dragonfly perched on the flower tip. Natural light.',
  },
  {
    sceneKey: 'cactus',
    label: '仙人掌',
    cartoon: STYLE_PREFIX.cartoon +
      'A potted green cactus with round stems and branches. Covered in small spines. A small red flower blooming on top.',
    watercolor: STYLE_PREFIX.watercolor +
      'A potted green cactus with round stems and branches. Covered in small spines. A small red flower blooming on top.',
    photo: STYLE_PREFIX.photo +
      'A potted green cactus with round stems and branches. Covered in small spines. A small red flower blooming on top. Close-up, natural window light.',
  },
  {
    sceneKey: 'old-photo',
    label: '旧照片',
    cartoon: STYLE_PREFIX.cartoon +
      'A framed yellowed landscape photo standing on a desk. A book and a fountain pen resting beside the frame.',
    watercolor: STYLE_PREFIX.watercolor +
      'A framed yellowed landscape photo standing on a desk. A book and a fountain pen resting beside the frame.',
    photo: STYLE_PREFIX.photo +
      'A framed vintage yellowed landscape photo standing on a wooden desk. A book and a fountain pen resting beside the frame. Warm nostalgic lighting.',
  },
  {
    sceneKey: 'turtle',
    label: '小乌龟',
    cartoon: STYLE_PREFIX.cartoon +
      'A shallow water basin with a small turtle. Hexagonal pattern on the shell. Head and four legs stretched out. A few pellets of turtle food nearby.',
    watercolor: STYLE_PREFIX.watercolor +
      'A shallow water basin with a small turtle. Hexagonal pattern on the shell. Head and four legs stretched out. A few pellets of turtle food nearby.',
    photo: STYLE_PREFIX.photo +
      'A shallow water basin with a small turtle. Hexagonal pattern on the shell. Head and four legs stretched out. A few pellets of turtle food nearby. Close-up, natural light.',
  },
  {
    sceneKey: 'clock',
    label: '闹钟',
    cartoon: STYLE_PREFIX.cartoon +
      'A double-bell alarm clock on a nightstand. Clock face with twelve marks and two hands. Two small bells on top, two feet at the bottom.',
    watercolor: STYLE_PREFIX.watercolor +
      'A double-bell alarm clock on a nightstand. Clock face with twelve marks and two hands. Two small bells on top, two feet at the bottom.',
    photo: STYLE_PREFIX.photo +
      'A vintage double-bell alarm clock on a wooden nightstand. Clock face with twelve marks and two hands. Close-up, warm bedside lamp light.',
  },
  {
    sceneKey: 'panda',
    label: '国宝大熊猫',
    cartoon: STYLE_PREFIX.cartoon +
      'A green bamboo forest. A chubby panda sitting and eating bamboo. Black and white fur, black eye patches, round ears. A sign reading "Giant Panda" nearby.',
    watercolor: STYLE_PREFIX.watercolor +
      'A green bamboo forest. A chubby panda sitting and eating bamboo. Black and white fur, black eye patches, round ears. A sign reading "Giant Panda" nearby.',
    photo: STYLE_PREFIX.photo +
      'A lush green bamboo forest. A giant panda sitting and eating bamboo. Black and white fur, black eye patches, round ears. Natural wildlife photography lighting.',
  },

  /* ---------------- 想象（20） ---------------- */
  {
    sceneKey: 'fly-sky',
    label: '假如我会飞',
    cartoon: STYLE_PREFIX.cartoon +
      'A cartoon child with white wings flying in the sky. Small houses and green trees below. Clouds and small birds floating around.',
    watercolor: STYLE_PREFIX.watercolor +
      'A cartoon child with white wings flying in the sky. Small houses and green trees below. Clouds and small birds floating around.',
    photo: STYLE_PREFIX.photo +
      'A dreamy sky scene with white clouds and small birds. Small houses and green trees visible far below. No person, just the perspective of flying.',
  },
  {
    sceneKey: 'wind-travel',
    label: '假如我是风',
    cartoon: STYLE_PREFIX.cartoon +
      'White wind streaks blowing across a grassy field. Two trees bending. Leaves flying in the air. A cartoon child standing in the wind.',
    watercolor: STYLE_PREFIX.watercolor +
      'White wind streaks blowing across a grassy field. Two trees bending. Leaves flying in the air. A cartoon child standing in the wind.',
    photo: STYLE_PREFIX.photo +
      'Trees bending in strong wind. Leaves flying in the air. Grass rippling. A stormy, windy atmosphere. Motion blur on the leaves.',
  },
  {
    sceneKey: 'talk-animals',
    label: '会说话的动物',
    cartoon: STYLE_PREFIX.cartoon +
      'A forest clearing. A cartoon cat, dog, and small bird sitting together. Each has a speech bubble above their head.',
    watercolor: STYLE_PREFIX.watercolor +
      'A forest clearing. A cartoon cat, dog, and small bird sitting together. Each has a speech bubble above their head.',
    photo: STYLE_PREFIX.photo +
      'A forest clearing. A cat, a dog, and a small bird sitting near each other in a sunlit clearing. Dappled light through trees.',
  },
  {
    sceneKey: 'future-school',
    label: '未来的学校',
    cartoon: STYLE_PREFIX.cartoon +
      'A futuristic sky scene with floating semicircular buildings, light rings, and a dashed-line sky corridor. Abstract geometric shapes throughout.',
    watercolor: STYLE_PREFIX.watercolor +
      'A futuristic sky scene with floating semicircular buildings, light rings, and a dashed-line sky corridor. Abstract geometric shapes throughout.',
    photo: STYLE_PREFIX.photo +
      'A futuristic architectural concept with floating semicircular buildings connected by sky bridges. Abstract geometric forms. Golden hour lighting.',
  },
  {
    sceneKey: 'future-me',
    label: '未来的我',
    cartoon: STYLE_PREFIX.cartoon +
      'A cartoon child standing and looking up. A large thought bubble above showing an astronaut wearing a helmet.',
    watercolor: STYLE_PREFIX.watercolor +
      'A cartoon child standing and looking up. A large thought bubble above showing an astronaut wearing a helmet.',
    photo: STYLE_PREFIX.photo +
      'A space scene with stars and a planet. An astronaut helmet floating in space, reflecting the cosmos in the visor. No person, just the helmet.',
  },
  {
    sceneKey: 'turtle-rabbit',
    label: '龟兔赛跑',
    cartoon: STYLE_PREFIX.cartoon +
      'A racing track scene. A turtle slowly crawling forward. A rabbit asleep leaning against a tree. A red flag at the finish line.',
    watercolor: STYLE_PREFIX.watercolor +
      'A racing track scene. A turtle slowly crawling forward. A rabbit asleep leaning against a tree. A red flag at the finish line.',
    photo: STYLE_PREFIX.photo +
      'A forest path. A turtle slowly crawling forward. A rabbit resting near a tree. A red flag at the finish line in the distance. Natural lighting.',
  },
  {
    sceneKey: 'girl-visit',
    label: '雪夜的小女孩',
    cartoon: STYLE_PREFIX.cartoon +
      'A snowy night street scene. A cartoon girl standing, holding a glowing match. A window nearby with warm yellow light coming through.',
    watercolor: STYLE_PREFIX.watercolor +
      'A snowy night street scene. A cartoon girl standing, holding a glowing match. A window nearby with warm yellow light coming through.',
    photo: STYLE_PREFIX.photo +
      'A snowy night street scene. A glowing match light in the foreground. A window nearby with warm yellow light coming through. Dark, cold atmosphere.',
  },
  {
    sceneKey: 'talking-bag',
    label: '会说话的书包',
    cartoon: STYLE_PREFIX.cartoon +
      'A blue backpack with a cartoon smiley face hanging on a chair back. A speech bubble above. An open homework book on the desk.',
    watercolor: STYLE_PREFIX.watercolor +
      'A blue backpack with a cartoon smiley face hanging on a chair back. A speech bubble above. An open homework book on the desk.',
    photo: STYLE_PREFIX.photo +
      'A blue backpack hanging on a chair back. An open homework book on the desk. Warm desk lamp light. No face on the bag.',
  },
  {
    sceneKey: 'pencil-escape',
    label: '铅笔逃跑',
    cartoon: STYLE_PREFIX.cartoon +
      'A pencil jumping off a desk and running toward a door. Speed lines behind it. An eraser and notebook on the desk.',
    watercolor: STYLE_PREFIX.watercolor +
      'A pencil jumping off a desk and running toward a door. Speed lines behind it. An eraser and notebook on the desk.',
    photo: STYLE_PREFIX.photo +
      'A pencil on the edge of a desk, motion blur suggesting movement. An eraser and notebook on the desk. Close-up, dramatic angle.',
  },
  {
    sceneKey: 'pencil-adventure',
    label: '铅笔历险',
    cartoon: STYLE_PREFIX.cartoon +
      'A large pencil standing on an open giant book. Book pages undulating like hills. Clouds and a sun around it.',
    watercolor: STYLE_PREFIX.watercolor +
      'A large pencil standing on an open giant book. Book pages undulating like hills. Clouds and a sun around it.',
    photo: STYLE_PREFIX.photo +
      'A pencil standing on an open book, dramatic macro photography. The pages undulate like hills. Soft natural light.',
  },
  {
    sceneKey: 'pencil-home',
    label: '铅笔回家',
    cartoon: STYLE_PREFIX.cartoon +
      'An open red pencil case with several colored pens and an eraser inside. The runaway pencil has returned to the lineup.',
    watercolor: STYLE_PREFIX.watercolor +
      'An open red pencil case with several colored pens and an eraser inside. The runaway pencil has returned to the lineup.',
    photo: STYLE_PREFIX.photo +
      'An open red pencil case with several colored pens and an eraser neatly inside. Close-up, shallow depth of field. Natural light.',
  },
  {
    sceneKey: 'weird-dream',
    label: '奇怪的梦',
    cartoon: STYLE_PREFIX.cartoon +
      'A purple sky scene. Houses growing upside down, fish swimming in clouds. A cartoon child sleeping on a cloud. Balloons and a kite floating around.',
    watercolor: STYLE_PREFIX.watercolor +
      'A purple sky scene. Houses growing upside down, fish swimming in clouds. A cartoon child sleeping on a cloud. Balloons and a kite floating around.',
    photo: STYLE_PREFIX.photo +
      'A surreal purple-tinted sky with clouds. Dreamlike atmosphere with floating elements. Abstract, impressionistic.',
  },
  {
    sceneKey: 'if-tiny',
    label: '假如我变小了',
    cartoon: STYLE_PREFIX.cartoon +
      'Giant flowers and grass blades surrounding a tiny cartoon figure. An ant crawling nearby. A dewdrop as large as a lake.',
    watercolor: STYLE_PREFIX.watercolor +
      'Giant flowers and grass blades surrounding a tiny cartoon figure. An ant crawling nearby. A dewdrop as large as a lake.',
    photo: STYLE_PREFIX.photo +
      'Macro photography of giant flowers and grass blades from a tiny perspective. An ant crawling nearby. A dewdrop glistening. Extreme close-up.',
  },
  {
    sceneKey: 'underwater',
    label: '海底探险',
    cartoon: STYLE_PREFIX.cartoon +
      'A blue underwater scene. Coral and seaweed growing. Schools of small fish swimming. Bubbles rising. A diving helmet in the distance.',
    watercolor: STYLE_PREFIX.watercolor +
      'A blue underwater scene. Coral and seaweed growing. Schools of small fish swimming. Bubbles rising. A diving helmet in the distance.',
    photo: STYLE_PREFIX.photo +
      'A blue underwater scene. Coral and seaweed growing. Schools of small fish swimming. Bubbles rising. Underwater photography, natural light filtering from above.',
  },
  {
    sceneKey: 'space',
    label: '太空旅行',
    cartoon: STYLE_PREFIX.cartoon +
      'A black starry space scene. A planet with a ring. A rocket with a flame trail flying. A small astronaut floating nearby.',
    watercolor: STYLE_PREFIX.watercolor +
      'A black starry space scene. A planet with a ring. A rocket with a flame trail flying. A small astronaut floating nearby.',
    photo: STYLE_PREFIX.photo +
      'A black starry space scene. A planet with a ring visible. Stars scattered across the void. Dramatic cosmic lighting.',
  },
  {
    sceneKey: 'robot-friend',
    label: '机器人朋友',
    cartoon: STYLE_PREFIX.cartoon +
      'A square-headed robot with an antenna and gear joints, waving at a cartoon child. Screws and batteries scattered on the ground.',
    watercolor: STYLE_PREFIX.watercolor +
      'A square-headed robot with an antenna and gear joints, waving at a cartoon child. Screws and batteries scattered on the ground.',
    photo: STYLE_PREFIX.photo +
      'A small toy robot with an antenna on a desk. Screws and batteries scattered around. Close-up, studio lighting.',
  },
  {
    sceneKey: 'time-travel',
    label: '时间快进',
    cartoon: STYLE_PREFIX.cartoon +
      'A large clock with a spiral pattern. A futuristic city skyline silhouette ahead. Lights twinkling in the buildings.',
    watercolor: STYLE_PREFIX.watercolor +
      'A large clock with a spiral pattern. A futuristic city skyline silhouette ahead. Lights twinkling in the buildings.',
    photo: STYLE_PREFIX.photo +
      'A large vintage clock face with a spiral pattern. A city skyline silhouette in the background at dusk. Lights twinkling in the buildings.',
  },
  {
    sceneKey: 'invention',
    label: '奇思妙想',
    cartoon: STYLE_PREFIX.cartoon +
      'A design blueprint on a desk showing shoes with wings and gears. A glowing lightbulb nearby. A cartoon child leaning over the desk drawing.',
    watercolor: STYLE_PREFIX.watercolor +
      'A design blueprint on a desk showing shoes with wings and gears. A glowing lightbulb nearby. A cartoon child leaning over the desk drawing.',
    photo: STYLE_PREFIX.photo +
      'A design blueprint on a desk showing shoes with wings and gears. A glowing lightbulb nearby. A child seen from behind leaning over the desk drawing. Warm desk light.',
  },
  {
    sceneKey: 'travel-visit',
    label: '游记参观',
    cartoon: STYLE_PREFIX.cartoon +
      'A traditional Chinese pavilion with stone steps and green trees. A cartoon child holding a camera taking photos.',
    watercolor: STYLE_PREFIX.watercolor +
      'A traditional Chinese pavilion with stone steps and green trees. A cartoon child holding a camera taking photos.',
    photo: STYLE_PREFIX.photo +
      'A traditional Chinese pavilion with stone steps and green trees. A child seen from behind holding a camera. Natural daylight.',
  },
  {
    sceneKey: 'cultural-heritage',
    label: '文化遗产',
    cartoon: STYLE_PREFIX.cartoon +
      'A city wall scene with a gatehouse and battlements. Two cartoon children visiting in front. A sign reading "World Cultural Heritage" nearby.',
    watercolor: STYLE_PREFIX.watercolor +
      'A city wall scene with a gatehouse and battlements. Two cartoon children visiting in front. A sign reading "World Cultural Heritage" nearby.',
    photo: STYLE_PREFIX.photo +
      'An ancient city wall with a gatehouse and battlements. Two children seen from behind visiting. Golden hour lighting, wide angle.',
  },
  {
    sceneKey: 'deformation',
    label: '变形记',
    cartoon: STYLE_PREFIX.cartoon +
      'A giant ant standing in grass with antennae and six legs. A tiny human figure in the distance is the person before transformation.',
    watercolor: STYLE_PREFIX.watercolor +
      'A giant ant standing in grass with antennae and six legs. A tiny human figure in the distance is the person before transformation.',
    photo: STYLE_PREFIX.photo +
      'Macro photography of a large ant on grass blades. Dramatic close-up perspective. Natural lighting, shallow depth of field.',
  },
  {
    sceneKey: 'sci-fi-fly',
    label: '插上科学的翅膀飞',
    cartoon: STYLE_PREFIX.cartoon +
      'A deep blue outer space scene. A rocket with a flame trail flying. A planet with a ring in the distance. A small astronaut floating alongside.',
    watercolor: STYLE_PREFIX.watercolor +
      'A deep blue outer space scene. A rocket with a flame trail flying. A planet with a ring in the distance. A small astronaut floating alongside.',
    photo: STYLE_PREFIX.photo +
      'A deep blue outer space scene. A rocket trail visible. A planet with a ring in the distance. Stars scattered. Cosmic lighting.',
  },
  {
    sceneKey: 'my-paradise',
    label: '我的乐园',
    cartoon: STYLE_PREFIX.cartoon +
      'A large tree with a treehouse. A swing hanging nearby. Colorful flowers covering the ground. A cartoon child waving from above.',
    watercolor: STYLE_PREFIX.watercolor +
      'A large tree with a treehouse. A swing hanging nearby. Colorful flowers covering the ground. A cartoon child waving from above.',
    photo: STYLE_PREFIX.photo +
      'A large tree with a treehouse. A swing hanging from a branch. Colorful wildflowers covering the ground. Golden hour lighting, dreamy atmosphere.',
  },
]

/* ============================================================
   查询
   ============================================================ */

const PROMPT_BY_KEY = new Map<string, SceneImagePrompt>(
  SCENE_IMAGE_PROMPTS.map((p): [string, SceneImagePrompt] => [p.sceneKey, p]),
)

/**
 * 按 sceneKey 取提示词条目（含三种风格）；不存在返回 undefined。
 */
export function getSceneImagePrompt(sceneKey: string): SceneImagePrompt | undefined {
  return PROMPT_BY_KEY.get(sceneKey)
}

/**
 * 按 sceneKey + 风格取一条提示词字符串；不存在返回 undefined。
 */
export function getSceneImagePromptText(sceneKey: string, style: ImageStyle): string | undefined {
  const entry = PROMPT_BY_KEY.get(sceneKey)
  return entry?.[style]
}
