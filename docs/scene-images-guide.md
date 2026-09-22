# 场景图片替换指南

## 这是什么

小作家森林有 126 张 SVG 程序化插画（`src/assets/scenes.tsx`），覆盖了小学作文的全部常见主题。

SVG 插画风格统一、离线可用，但细节有限。如果你想要更精美的插画，可以用 AI 生成，也可以从图库网站找图片，把地址填进来，App 会**自动优先使用你的图片**，加载失败时退回 SVG。

## 三种风格

不管图片是 AI 生成的还是图库找的，都需要标 `style`：

| 风格 | 说明 | 适合 |
|------|------|------|
| **cartoon**（卡通绘本） | 扁平、暖色、线条柔和，跟 SVG 风格最接近 | DALL-E 3 生成 |
| **watercolor**（水彩手绘） | 柔和笔触、晕染、温馨 | Midjourney 生成 |
| **photo**（实景照片风） | 真实场景、自然光，适合写景状物 | 图库找图 / 自己拍 |

**建议选一种风格做到底**，别混着用。photo 风格的图片 App 会自动加暖色柔光，让实景照片和卡通 SVG 在同一篇文章里配着也不突兀。

photo 风格不画人脸：人物用背影或远景。避免 AI 生成的人脸看着违和，也避免图库照片的肖像权问题。

## 两种方式

### 方式一：AI 生成

1. 打开 `src/domain/sceneImagePrompts.ts`，找到你要的场景
2. 选一种风格（cartoon / watercolor / photo），复制对应的 prompt
3. 贴到 AI 绘图工具里生成（DALL-E 3 / Midjourney / SD 等）
4. 把图片上传到图床，拿到 https 链接
5. 填到 `src/domain/sceneImages.ts` 里

### 方式二：图库找图

1. 去 Unsplash / Pexels / 其他图库网站搜图
2. 找到合适的图片，拿到 https 链接
3. 填到 `src/domain/sceneImages.ts` 里，`style` 一般填 `photo`

## 怎么填

```ts
export const SCENE_IMAGES: SceneImageEntry[] = [
  // AI 生成的
  {
    sceneKey: 'spring-park',         // 对应 scenes.tsx 的 key
    imageUrl: 'https://…',           // 图片地址（https）
    alt: '春天的公园，女孩牵着狗散步', // 加载失败时显示
    style: 'cartoon',                // 风格
    source: 'DALL-E 3 生成',          // 来源（可选，一句话就行）
  },
  // 图库找的
  {
    sceneKey: 'river-village',
    imageUrl: 'https://images.unsplash.com/photo-xxx',
    alt: '家乡的小河',
    style: 'photo',
    source: 'Unsplash',
  },
  // source 不填也行
  {
    sceneKey: 'autumn-leaves',
    imageUrl: 'https://…',
    alt: '秋天的落叶',
    style: 'watercolor',
  },
]
```

保存后，App 下次渲染这个场景时就会优先用你的图片。

## 规则

1. **sceneKey 必须真实存在。** 写错一个字母，图片不会被使用，也不报错——只是安静地退回 SVG。

2. **一个 sceneKey 一条。** 同一个 key 写两条，后面的会盖掉前面的。

3. **imageUrl 必须是 https。** APK 里是 file:// 协议，http 链接会被混合内容策略挡住。

4. **style 必须填。** `cartoon` / `watercolor` / `photo` 三选一。

5. **source 可选。** 填了留个底，不填也行。一句话写清就行：`'DALL-E 3 生成'` / `'Unsplash'` / `'自己拍的'`。

6. **不填的 sceneKey 自动用 SVG。** 不用一次性全填满，填一张用一张。

7. **图片加载失败自动退回 SVG。** `onError` 触发后永久退回，不会每次渲染都重新加载。

## 文件说明

| 文件 | 作用 |
|------|------|
| `src/domain/sceneImages.ts` | **你填地址的地方。** 数据文件，空着等填。 |
| `src/domain/sceneImagePrompts.ts` | 126 场景 × 3 风格 = 378 条 AI 绘图提示词。只读参考，不用改。 |
| `src/domain/types.ts` | `SceneImageEntry` 类型定义。不用改。 |
| `src/assets/scenes.tsx` | 126 张 SVG 插画 + `SceneArt` 渲染逻辑。已接好外链图片优先 → SVG 兜底，photo 风格自动加暖色柔光。 |
