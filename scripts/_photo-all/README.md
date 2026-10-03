# 找默认图 —— 作业说明（给并行子代理看）

工作目录：`E:\plan\test25\little-writer-forest`
你负责**一个**批次：`scripts/_photo-all/batch-<NN>.json` → 产出 `scripts/_photo-all/out-<NN>.json`

## 你的输入

`batch-<NN>.json` 是一个数组，每条：
```json
{ "id": "cn-安徽-黄山风景区", "name": "黄山风景区", "province": "安徽", "country": "中国",
  "city": "黄山市", "rating": "5A", "scene": "mountain", "en": "Huangshan Yellow Mountain China" }
```
- `en` **可能为空** —— 空的话**你自己组英文检索词**（见下）。
- `scene` 是备用检索方向（`mountain|water|city|desert|forest|snow|temple|coast|grass|cave`）。

## 四步流水线（一步都不能省）

### ① 搜网页
`WebFetch` 抓 `https://www.pexels.com/search/<url-encoded 英文词>/`，
要求它**只回一个清单**：本页所有 `https://www.pexels.com/photo/<slug>-<数字>/` 链接
+ 末尾数字编号 + 标题/alt 文字。**不要整页内容。**

- ⚠️ **必须明确说：跳过 `/r/eyJ…` 和 `istockphoto` 的链接** —— 那些是赞助广告位，编号拼不出地址。
- ⚠️ **Pexels 搜索只吃英文关键词**，中文搜不到东西。
- ⚠️ 页面没给出可用数字编号时，**换一个更短/更通用的词再抓一次**。

**`en` 为空时怎么组词**（中国的景区）：先试它公认的英文名
（黄山 → `Huangshan Yellow Mountain`、九寨沟 → `Jiuzhaigou valley`、
武陵源 → `Wulingyuan Zhangjiajie`、石林 → `Stone Forest Yunnan Shilin`）。
拿不准就 `"<英文名> <省拼音> China"`，或者 `"<名字拼音> China scenery"`。
**试 2–3 个变体**；实在搜不到就走下面的 `scene` 兜底。**别编造。**

### ② 抠编号
详情页形如 `https://www.pexels.com/photo/<slug>-18549556/` → 编号 `18549556`。
**只认 `/photo/<纯数字>/`。**

### ③ 拼 CDN 直链
```
https://images.pexels.com/photos/{编号}/pexels-photo-{编号}.jpeg?auto=compress&cs=tinysrgb&w=640
```
⚠️ 结尾**必须**是 `?auto=compress&cs=tinysrgb&w=640`（项目统一尺寸）。

### ④ 验证 + 下载 + **真看一遍**
```bash
curl -sL -o "scripts/_photo-all/img/<NN>-01.jpg" "<cdn url>"
wc -c < "scripts/_photo-all/img/<NN>-01.jpg"      # ← 判据是**落盘后的真实字节数**
```
- ⚠️ **`-L` 必须带**。不带的话图床只回一个 160 字节的空壳，看着像"编号是假的"。
- ⚠️⚠️ **绝对不要用 `curl -o /dev/null -w '%{size_download}'` 量尺寸** ——
  这台机器上它**恒报 ~161 字节**，哪怕真文件是 56 KB。用它 = 全部误判成失败。
- 合格判据：**HTTP 200** + **字节数 > 10000**。
  想看类型就加 `-w '%{content_type}'`（期望 `image/jpeg`），**别用 `file` 命令**（这台机器没装）。
- ⚠️ 图床对密集请求会限流（502/522）。**每条之间 `sleep 0.5`**，失败的隔 2 秒重试一次。
- 文件名用 `<批次号>-<两位序号>.jpg`，序号按你处理批次的顺序从 `01` 开始。
- 然后**用 Read 工具打开那张 jpg 真的看一眼**：画面是不是**那个地方**？
  有没有糊 / 水印 / 大文字牌 / 人像挡主体 / 明显是别的地方？
- 不满意就回到 ① 换个词或换个编号重来。

## 兜底：真的搜不到 → `match: "scene"`

小地方/县级景区在 Pexels 上可能什么都没有
（**中文 5A 景区里这种情况大约占 2/3**，很正常，不是你的问题）。那时：
- `match` 填 `"scene"`，`note` 里写清你试过哪几个词
- ⚠️ **这一轮不用再去找替代的同类风景图**，也**不用下载、不用看图** ——
  上层**只收 `place`**，`scene` 的会被丢掉。
  所以 `mediaUrl` 写 `""`、`credit` 写 `null`、`verified` 写 `null` 就行。
- ⚠️⚠️ **但 `match` 必须诚实填。** `scene` **不是失败**，只是"这条没有本体照片"。
  上层正是拿这个比例去决定策略 —— **你为了让结果好看而放宽判定，等于把整份数据毁掉**。
  `place` 的**唯一**意思是"我看过图，确认这真的就是那个地方"。

## 输出（**必须写文件**，不要只回复）

⚠️⚠️ **每处理完一条，就把 `out-<NN>.json` 整个重写一次**（把"已完成的全部条目"都写进去）。
不要攒到最后一次性写 —— 上一轮有 5 个批次把 20 张图都下完了，
却在收尾前被打断，**一条元数据都没留下，100 次下载全白费**。
中途写出来的**不完整文件也完全可用**，别怕写坏。

写 `scripts/_photo-all/out-<NN>.json`（UTF-8、2 空格缩进、结尾换行）：

```json
{
  "batch": "<NN>",
  "items": [
    {
      "landmarkId": "cn-安徽-黄山风景区",
      "match": "place",
      "query": "Huangshan Yellow Mountain China",
      "mediaUrl": "https://images.pexels.com/photos/18549556/pexels-photo-18549556.jpeg?auto=compress&cs=tinysrgb&w=640",
      "title": "Sea of clouds over Huangshan",
      "credit": { "source": "Pexels", "link": "https://www.pexels.com/photo/sea-of-clouds-18549556/", "author": "Yan Zhang" },
      "verified": { "http": 200, "type": "image/jpeg", "bytes": 48321 },
      "verdict": "ok",
      "note": ""
    }
  ]
}
```

- `landmarkId` **原样抄** batch 里的 `id`，一个字都不许改。
- `items` 必须包含**你这个批次的全部条目**，一条都不许少。
- `credit.link` 必须是你实际取编号的那个详情页，**且里面要含那个数字编号**
  （`…/photo/<slug>-<编号>/`）—— 少了编号会被生成侧的守卫挡下。
- `credit.author` 找不到就写 `"Unknown"`，**别编**。
- `verdict`：`"ok"`（看过、对得上）/ `"poor"`（凑合，`note` 里说明为什么）。

## 规矩

- **除了 `scripts/_photo-all/` 里的文件，别改任何东西。** 不碰源码、不 git、不 build、不 commit。
- 尽量把 `curl` 合并成一条命令跑（一条 shell 里写多行 `curl` + `sleep`），省时间。
- WebFetch 失败就换个更简单的词重试一次。

## 最后回我（150 字以内）

完成几条、`place` / `scene` 各几条、有哪些 `poor` 及一句话原因。
**不要把 JSON 贴回来**（已经在文件里了）。
