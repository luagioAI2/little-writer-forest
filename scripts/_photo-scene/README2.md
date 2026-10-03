# 给作文库内置题配外链图 —— 作业说明（给并行子代理看）

工作目录：`E:\plan\test25\little-writer-forest`
你负责**一个**批次：`scripts/_photo-scene/batch-<NN>.json` → 产出 `scripts/_photo-scene/out-<NN>.json`

## 你的输入

`batch-<NN>.json` 是一个数组，每条：

```json
{ "key": "clock",
  "hint": "床头柜上放着一个双铃闹钟，钟面上有十二个刻度和两根指针，顶上两个小铃铛，底下有两只脚。",
  "en": "twin bell alarm clock vintage",
  "usedBy": ["builtin-treasure-4"] }
```

- **`hint` 是唯一判据** —— 它描述的是这幅插画里**画了什么**。
  你要找的是**跟 hint 画面对得上**的照片，**不是**跟题目名字对得上。
- `en` 是建议检索词，**可以改**。搜不到就用更短更通用的词。
- `usedBy` 只是告诉你这张图会被哪些题用（同一个 key 的题**共用一张图**），**别改它**。

## ★★★ 第一步：搜之前先把 `?orientation=landscape` 加上

```
https://www.pexels.com/search/<url-encoded 英文词>/?orientation=landscape
```

**这个参数是整条流水线里性价比最高的一步，务必先加。**
不加的话搜索结果**约七成是竖图**，而 App 的容器是写死的 **`aspect-ratio: 4/3` + `object-cover`（居中裁）**
—— 竖图会被上下各砍掉一大截。实测（同一个词）：

| 搜法 | 横图命中 |
|---|---|
| 默认 `grandmother knitting` | **1 / 10** |
| 加 `?orientation=landscape` | librarian **7/7** · bus driver **7/7** · knitting **6/6** |

★ 加了参数**不等于免检**（图库偶尔分类错），但能把下一步"量 ar"从**筛选**降级成**抽检**。

## ★★★ 第二步：题目点名的主体，图里**必须找得到**

**这是上一轮最大的教训 —— 有 5 张图因此被打回重做。**

| 题 | 主体是什么 | 上一轮交的 | 结果 |
|---|---|---|---|
| 奶奶织毛衣 | **奶奶** | 毛线团 + 棒针，没有人 | ❌ 打回 |
| 图书管理员 | **人** | 一排书架，没有人 | ❌ 打回 |
| 公交司机 | **司机** | 空车厢 | ❌ 打回 |
| 雨天的快递员 | **雨很大** + 快递员 | 有快递员但没下雨 | ❌ 打回 |
| 我的仙人掌 | **开出了小花** | 有刺但没开花 | ❌ 打回 |

规则：

1. **hint 里写了的主体，照片里就得有。** 找不到就换词、换参数继续找，
   **不要交一张"只有道具"的图**。
2. ⚠️ **「不画人脸」≠「宁可选物件」。** 项目确实希望避免正脸特写
   （优先**背影 / 远景 / 侧脸 / 低头**），但**这条永远排在"主体得在"后面**。
   把两条并列就会推出"拿不到"的错误结论 —— 实测加了 landscape 之后，"横图 + 有人"很好找。
3. 分清**缺的是装饰还是题眼**：hint 里那个**被强调的**要素（"雨很大"、"却开出了小花"）
   没了，这张图就是废的；只是少了点缀才可以商量。

## 四步流水线

### ① 搜网页（不是图片 API）

`WebFetch` 抓 `https://www.pexels.com/search/<英文词>/?orientation=landscape`，
**要求它只回一个清单**：

> 列出本页所有 `https://www.pexels.com/photo/<slug>-<数字>/` 形式的链接，
> 给出末尾的数字编号 + 标题/alt 文字。**不要整页内容。**

- ⚠️ **必须明确说：跳过 `/r/eyJ…` 和 `istockphoto` 的链接** —— 那些是赞助广告位，编号拼不出地址。
- ⚠️ **Pexels 搜索只吃英文关键词**，中文搜不到东西。
- ⚠️ 页面没给出可用数字编号 → 换一个更短/更通用的词再抓一次（**试 2–3 个变体**）。
- ⚠️ 目标容器是**正方形**时，`?orientation=square` 比 `landscape` 更贴。

### ② 抠编号

详情页形如 `https://www.pexels.com/photo/<slug>-18549556/` → 编号 `18549556`。
**只认 `/photo/<纯数字>/`。**
⚠️ 搜索页上那个 "Download" 链接是 `…pexels-photo-7558424.jpeg?…&dl=pexels-某人-7571842.jpg` ——
**别拿 `dl=` 后面那个数字当编号**（那是摄影师的作品编号，不是照片 id）。**只从页面 URL 取。**

### ③ 拼 CDN 直链 + 下载一批候选

```
https://images.pexels.com/photos/{编号}/pexels-photo-{编号}.jpeg?auto=compress&cs=tinysrgb&w=640
```

⚠️ 结尾**必须**是 `?auto=compress&cs=tinysrgb&w=640`（项目统一尺寸）。

**每个 key 下 5–8 个候选**，下到 `scripts/_photo-scene/img2/<NN>/<key>/<编号>.jpg`：

```bash
mkdir -p "scripts/_photo-scene/img2/<NN>/clock"
curl -sL -o "scripts/_photo-scene/img2/<NN>/clock/123456.jpg" "https://images.pexels.com/photos/123456/pexels-photo-123456.jpeg?auto=compress&cs=tinysrgb&w=640"
sleep 0.5
# …尽量把多条 curl 合并进一条命令跑，省时间
```

- ⚠️ **`-L` 必须带**。不带的话图床只回一个 160 字节的空壳，看着像"编号是假的"。
- ⚠️⚠️ **绝对不要用 `curl -o /dev/null -w '%{size_download}'` 量尺寸** ——
  这台机器上它**恒报 ~161 字节**，哪怕真文件是 56 KB。用它 = 全部误判成失败。
- ⚠️ 图床对密集请求会限流（502/522）。**每条之间 `sleep 0.5`**，失败的隔 2 秒重试一次。
- 合格判据：**HTTP 200** + **字节数 > 10000**。
  想看类型就加 `-w '%{content_type}'`（期望 `image/jpeg`），**别用 `file` 命令**（这台机器没装）。
- ⚠️ **很老的编号**（如 `41005`、`23795`）会回一个 **21 字节**的文本 `Source is unreachable` ——
  那不是图，**别当"下载失败"重试，直接换新编号**。

### ④ 量宽高比 → 拼联系表 → **人眼看一遍**

```bash
python scripts/_photo-scene/measure.py "scripts/_photo-scene/img2/<NN>/clock"
```

它会按宽高比排序，标出 ✅安全 / 🟡可接受 / ❌竖图丢掉。

| 宽高比 ar | 处理 |
|---|---|
| ≥ 1.33 | ✅ 首选，基本不裁 |
| 1.15 – 1.33 | 🟡 可以收，`note` 里写一句「偏窄」 |
| < 1.15 | ❌ 默认丢 —— ⚠️ 但**先拼联系表看一眼再决定**（见下）|

⚠️ **ar 只是代理指标，不是判决**：实测一张 ar=0.75 的竖图，主体坐在**中下带**、
上面 40% 是墙 → 4:3 居中裁保留中间 56%，**头 + 手 全留下，完全可用**。
**最终判据是"按 4:3 裁完还剩下什么"** —— 而联系表正好就是这个预览。

```bash
node scripts/_photo-scene/sheet.mjs "scripts/_photo-scene/img2/<NN>/clock" --title "clock 双铃闹钟"
```

生成一张 PNG（每格 `320×240` + `object-fit: cover` —— **跟 App 里的裁法是同一个**，
所以联系表本身就是"上屏之后长什么样"）。然后**用 Read 工具打开这张 PNG 真的看一眼**：

- 画面跟 `hint` 对得上吗？（对不上就回到 ① 换词重来）
- **hint 里的主体在不在？**（人 / 雨 / 花 / 特定物件 —— 见上面那条铁律）
- 有没有糊 / 水印 / 大文字牌 / 明显是别的东西？
- ⚠️ 格子只有 320×240，**主体小的时候要放大看**（上一轮把一盆仙人掌看成了"空白粉墙"）。
- ⚠️ 优先**暖调**（夕阳 / 木质 / 暖光）：真照片默认**不加暖色滤镜**，
  在偏暖的卡通插画旁边会显得偏冷、跳出来。

## 输出（**必须写文件**，不要只回复）

⚠️⚠️ **每处理完一个 key，就把 `out-<NN>.json` 整个重写一次**（把"已完成的全部条目"都写进去）。
不要攒到最后一次性写 —— 上一轮有 5 个批次把图都下完了，
却在收尾前被打断，**一条元数据都没留下，100 次下载全白费**。
中途写出来的**不完整文件也完全可用**，别怕写坏。

写 `scripts/_photo-scene/out-<NN>.json`（UTF-8、2 空格缩进、结尾换行）：

```json
{
  "batch": "<NN>",
  "items": [
    {
      "key": "clock",
      "pexelsId": 123456,
      "mediaUrl": "https://images.pexels.com/photos/123456/pexels-photo-123456.jpeg?auto=compress&cs=tinysrgb&w=640",
      "title": "Vintage twin bell alarm clock",
      "credit": { "link": "https://www.pexels.com/photo/vintage-alarm-clock-123456/", "author": "Some Name" },
      "verified": { "http": 200, "bytes": 48321 },
      "size": { "w": 640, "h": 427, "ar": 1.5 },
      "verdict": "ok",
      "note": ""
    }
  ]
}
```

- `key` **原样抄** batch 里的 `key`，一个字都不许改。
- `items` 必须包含**你这个批次的全部 key**，一个都不许少。
- `credit.link` 必须是你实际取编号的那个详情页，**且里面要含那个数字编号**（`…/photo/<slug>-<编号>/`）。
- `credit.author` 找不到就写 `"Unknown"`，**别编**。
- `verdict`：
  - `"ok"` —— 看过、对得上、**主体在**、ar 合格
  - `"poor"` —— 凑合（`note` 里说清差在哪，比如"偏窄 ar=1.20"或"缺了 hint 里的 X"）
  - `"none"` —— **真的找不到**（`note` 里写清你试过哪几个词）。
    ⚠️ **`none` 不是失败**，如实填就行 —— **别为了结果好看硬塞一张不对题的图**。

## 规矩

- **除了 `scripts/_photo-scene/` 里的文件，别改任何东西。** 不碰源码、不 git、不 build、不 commit。
- 不许改 `batch-*.json`。
- 尽量把 `curl` 合并成一条命令跑（一条 shell 里写多行 `curl` + `sleep`），省时间。
- WebFetch 失败就换个更简单的词重试一次。

## 最后回我（150 字以内）

完成几个 key、`ok` / `poor` / `none` 各几个、哪些是 `poor` 或 `none` 及一句话原因。
**不要把 JSON 贴回来**（已经在文件里了）。
