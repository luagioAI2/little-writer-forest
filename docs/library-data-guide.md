# 作文库数据文件 —— 怎么写、怎么导

这一页写给「自己写题库数据、然后导进 App」的人。

题库页（顶栏那个文件夹图标）最下面有 **📥 导入题库**，点它选一个 `.json` 文件就行。

---

## 〇、先分清两条路（别搞混）

「作文库」里的题有两个来源，改法**完全不同**：

| | 改什么 | 怎么改 | 存在哪 |
|---|---|---|---|
| **A** | **内置的 136 道**（App 自带） | 开 `http://localhost:5190/library-browse.html`，点一道题改，按「保存全部改动」 | `src/data/library-items.json`（**覆盖层**，只记改过的那几笔） |
| **B** | **你自己的题**（AI 出的 / 从别处导入的） | 写一个 `.json`，用 App 里的「📥 导入题库」导进去 | App 的 IndexedDB（`localStorage` 隔壁那个） |

- **这一页下面讲的都是 B**（怎么写一份能导进去的题库文件）。
- 路线 A 的规则不在这里 —— 见 `src/domain/libraryItems.ts` 的文件头（为什么要有覆盖层、
  为什么每条都要存 `baseTitle` / `baseLead`、覆盖层**不能**做什么）。
  ⚠️ 一句话版：**路线 A 改的是"那道题长什么样"，改不了"哪些题存在"** ——
     加题、删题、挪标签都得走 B 或者改 `src/domain/prompts.ts`。
- ⚠️ 两条路的配图字段是**同一套**（下面「四、配图」那节两边都适用）：
  路线 A 只填 `imageUrl` 那一格，内置插画（`sceneKey`）会**原样留着**当兜底。

---

## 一、导入是累加的

这是最重要的一条约定：

> **导入只往题库里加，永远不会删掉或改掉已有的题。**

具体规则只有两条：

| 情况 | 结果 |
| --- | --- |
| 和库里某条**完全一样**（标题 + 类别 + 引导语 + 配图都相同） | 跳过。同一份文件导两次不会变成两倍 |
| 其余 | 追加到最前面 |

所以：

- 导文件 A（3 道题）→ 3 道题
- 再导文件 B（5 道题）→ 8 道题
- 再导一次文件 A → 还是 8 道题，提示「跳过 3 题」

**id 撞车也不会覆盖。** 文件 B 里写了 `"id": "a-1"`，而库里已经有 `a-1`，
新来的那条会自动改成 `a-1-2`，两条都留着。

> 为什么不做「同 id 就更新」：手写的数据文件常常都从 `1` 开始编号，
> 第二个文件的 `1` 会神不知鬼不觉盖掉第一个文件的 `1`，
> 你只会觉得「我明明导了两个文件」。**宁可多一条，不要少一条。**
>
> 想改一道题，就在题库里把它删掉，再重新导入。

导入完会告诉你结果：`新增 N 题`、`跳过 N 题`、`N 条数据有问题`。
有问题的数据不会被塞进题库，但**会把原因念出来**（比如
「第 3 条：category「写景文」不认识」），照着改就行。

---

## 二、文件长什么样

三种写法都认，随便挑一种：

**写法一：一个数组（最省事，推荐）**

```json
[
  { "category": "scene", "title": "雨后的校园", "lead": "下雨之后，校园里有什么不一样了？" },
  { "category": "person", "title": "我的妈妈", "lead": "妈妈最让你佩服的地方是什么？" }
]
```

**写法二：包一层 `items`**

```json
{ "items": [ { "category": "scene", "title": "雨后的校园" } ] }
```

**写法三：App 自己导出的完整格式**（用「导出 JSON」导出来的文件，原样导回去就行）

```json
{
  "format": "little-writer-forest.library",
  "version": 2,
  "items": [ ... ]
}
```

---

## 三、每道题的字段

除了 `images` 这一项，其余字段和 App 自己出的题**完全一样**。

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | ✅ | 题目标题。缺了就整条丢掉 |
| `category` | ✅ | `scene` 写景 / `person` 写人 / `event` 写事 / `object` 状物 / `imagine` 想象。**直接写中文也认** |
| `lead` | | 一句话引导，用孩子的口吻。如「下雨之后，校园里有什么不一样了？」 |
| `id` | | 不填会自动生成一个。填了的话要注意别和别的文件撞（撞了也不会覆盖，见上） |
| `tagId` | | 细分标签，可以留空。**写中文也认**（「天气」和 `weather` 等价，入库时自动归一） |
| `wordRange` | | 建议字数区间，如 `[100, 300]`。不填默认 `[60, 200]` |
| `minGrade` / `maxGrade` | | 适合几年级到几年级，如 `3` / `6`。不填默认 `1` / `1` |
| `focus` | | 评分侧重，可多选：`observation` 观察 / `structure` 结构 / `vocabulary` 词句 / `imagination` 想象 / `emotion` 情感 |
| `images` | | 配图，见下一节。没有配图就写 `[]` 或者不写 |

> ⚠️ **`category` 写错是最容易踩的坑**：整条会被丢掉。
> 好消息是导入时会明确告诉你「第 N 条：category「XX」不认识」。

---

## 四、配图：两种来源

一道题的配图有两种来源，可以只给一个，也可以两个都给。

### ① `sceneKey` —— 内置插画（本地 SVG）

对应 `src/assets/scenes.tsx` 里 126 张程序化 SVG 的 key。

```json
{ "sceneKey": "spring-park" }
```

- 不联网、不打包图片，**永远画得出来**，断网和 APK 里都一样。
- ⚠️ **key 写错是静默失败**：不报错，只是这张图永远用不上。
  列表在 `src/assets/scenes.tsx` 的 `SCENES` 里，或者看 `docs/scene-images-guide.md`。

### ② `imageUrl` —— 图片路径（外链 / 相对路径）

```json
{ "imageUrl": "https://cdn.example.com/rain-1.png" }
```

- 可以是 **https 外链**，也可以是**放在 `public/` 下的相对路径**
  （比如把图片放到 `public/photos/rain-1.png`，就写 `"/photos/rain-1.png"`）。
- 推荐 https 外链：**不下载、不打包进 APK**，包体积不会涨。
  放 `public/` 里的话图片会被打进包里，APK 会变大。
- ⚠️ **加载失败会退回 `sceneKey` 的 SVG**。所以重要的题建议两个都填：
  外链好看，SVG 保底。只填 `imageUrl` 的题，图挂了就只剩一张「暂无插图」的占位画。

### ③ 连环图 = 数组

多张图就是一个数组，**顺序就是翻页顺序**，写作台上会横向连排、滑着看。

```json
"images": [
  "https://cdn.example.com/1.png",
  "https://cdn.example.com/2.png",
  "https://cdn.example.com/3.png"
]
```

想给每张图加说明文字、或者想同时给 SVG 兜底，就写成对象：

```json
"images": [
  { "imageUrl": "https://cdn.example.com/1.png", "caption": "下雨了" },
  { "imageUrl": "/photos/2.png", "sceneKey": "rainbow", "caption": "雨停之后" }
]
```

`imageUrl` 的顺手写法 `url` / `src` / `path` 也认（都是同一个意思）。

> 一个既没有 `sceneKey` 也没有图片地址的图会被丢掉 ——
> 空图会在写作台上留一个白框，比没有图更难看。

---

## 五、完整例子

复制下面这段，改改就能用（`docs/library-data-example.json` 也是这份）：

```json
[
  {
    "id": "spring-rain-01",
    "category": "写景",
    "title": "雨后的校园",
    "lead": "下雨之后，校园里有什么不一样了？先说远处，再说近处。",
    "wordRange": [150, 350],
    "minGrade": 3,
    "maxGrade": 6,
    "focus": ["observation", "vocabulary"],
    "images": [
      "https://cdn.example.com/spring-rain-1.png",
      "https://cdn.example.com/spring-rain-2.png"
    ]
  },
  {
    "id": "grandpa-hands-01",
    "category": "person",
    "title": "爷爷的手",
    "lead": "看看爷爷的手，上面有什么？摸上去是什么感觉？",
    "wordRange": [200, 400],
    "minGrade": 4,
    "maxGrade": 6,
    "focus": ["observation", "emotion"],
    "images": [
      { "imageUrl": "https://cdn.example.com/hands.png", "sceneKey": "grandpa-garden", "caption": "爷爷在院子里" }
    ]
  },
  {
    "category": "scene",
    "title": "春天的公园（只用内置插画）",
    "lead": "春天的公园里，你能看到什么？听到什么？",
    "images": [{ "sceneKey": "spring-park" }]
  }
]
```

---

## 六、导进去之后

- 题库列表里点一下就能看到大图预览。
- 点「就用这题」或抽屉里的「就用这题写」→ **直接进写作台**，
  孩子可以立刻按下麦克风开始说。
- 这道题会被记一次「用过」，题库里能看到使用次数。

## 七、排错

| 现象 | 大概是 |
| --- | --- |
| 提示「这不是小笔苗的题库文件」 | 文件里写了别的 `format`（比如整机备份的 `.backup`） |
| 提示「第 N 条：category「XX」不认识」 | 类别拼错了，只能是那 5 个英文键或 5 个中文名 |
| 提示「第 N 条：缺少 title」 | 那条没写题目名字 |
| 导进去了但列表里看不到 | 检查一下筛选条件（年级 / 类别 / 只看收藏）是不是卡住了 |
| 图一直是占位画 | `imageUrl` 挂了，而这条又没有 `sceneKey` 兜底；或者地址是 `http://`（混合内容会被浏览器挡掉，必须是 https） |
| 有配图但列表缩略图是别的场景 | 那条的 `images` 是空的，缩略图用的是默认场景 |
