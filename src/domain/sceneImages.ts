/* ============================================================
   场景外链图片库 —— AI 生成的或图库找的插画替换/补充 SVG 配图
   ============================================================
   ★ 这是「放很多图片地址」的存储文件。以后往里加条目就行。 ★

   ------------------------------------------------------------
   为什么需要这个文件

   scenes.tsx 里的 126 张 SVG 是纯代码画的，风格统一但细节有限。
   你可以用 AI 生成插画，也可以从图库网站找图片，然后把地址填到这里，
   App 渲染时会优先用外链图片，加载失败时自动退回 SVG。

   ------------------------------------------------------------
   一条数据长什么样

     {
       sceneKey: 'spring-park',          // 必须和 scenes.tsx 里 SCENES 的 key 一致
       imageUrl: 'https://…',            // 图片地址（https 外链）
       alt: '春天的公园，女孩牵着狗散步',  // 给屏幕阅读器 / 加载失败时看
       style: 'cartoon',                 // 风格：cartoon / watercolor / photo
       source: 'DALL-E 3 生成',           // 来源（可选，一句话写清就行）
     }

   ------------------------------------------------------------
   三种风格

   不管是 AI 生成的还是图库找的，都需要标 style，
   App 渲染时按风格做微调（photo 风格自动加暖色柔光）。

   - **cartoon**（卡通绘本）：扁平、暖色、线条柔和，跟 SVG 风格最接近
   - **watercolor**（水彩手绘）：柔和笔触、晕染、温馨
   - **photo**（实景照片风）：真实场景、自然光，适合写景状物

   photo 风格不画人脸：用实景 / 静物 / 风景，人物用背影或远景。
   这是为了避免 AI 生成的人脸看着违和，也避免图库照片里的人脸肖像权问题。

   ------------------------------------------------------------
   四条约定

   1. **sceneKey 必须真实存在。**
      写错一个字母，图片永远不会被用上 —— 而且不报错，
      只是安静地退回 SVG。

   2. **一个 sceneKey 一条。**
      同一个 key 写两条，后面的盖掉前面的。

   3. **图片只存外链地址，不下载、不打包进 APK。**
      跟 travelStories 的 photoUrl 一样。断网 / 加载失败时
      自动退回 scenes.tsx 里的 SVG 插画，孩子看到的是同一幅画
      的代码版本，不会出现空白。

   4. **imageUrl 必须是 https。**
      APK 里是 file:// 协议，http 会被混合内容策略挡住。

   ------------------------------------------------------------
   怎么用

   方式一：AI 生成
   1. 打开 sceneImagePrompts.ts，找到你要生成图片的场景
   2. 选一种风格（cartoon / watercolor / photo），复制对应的 prompt
   3. 贴到你的 AI 绘图工具里生成
   4. 把图片上传到图床，拿到 https 链接
   5. 填到下面 SCENE_IMAGES 里，sceneKey 和 style 写对

   方式二：图库找图
   1. 去 Unsplash / Pexels / 其他图库网站搜图
   2. 找到合适的图片，拿到 https 链接
   3. 填到下面 SCENE_IMAGES 里，style 一般填 'photo'

   不管哪种方式，保存后 App 下次渲染就会优先用你的图。

   ============================================================ */

import type { SceneImageEntry } from './types'

/* ============================================================
   图片注册表 —— 在这里填地址
   ============================================================

   没有填的 sceneKey 会自动用 scenes.tsx 里的 SVG。
   不用一次性全填满，填一张用一张。

   示例（删掉注释换成真实的就行）：

   export const SCENE_IMAGES: SceneImageEntry[] = [
     // AI 生成的
     {
       sceneKey: 'spring-park',
       imageUrl: 'https://example.com/your-image.png',
       alt: '春天的公园，女孩牵着狗散步',
       style: 'cartoon',
       source: 'DALL-E 3 生成',
     },
     // 图库找的
     {
       sceneKey: 'river-village',
       imageUrl: 'https://images.unsplash.com/photo-xxx',
       alt: '家乡的小河',
       style: 'photo',
       source: 'Unsplash',
     },
     // 自己拍的
     {
       sceneKey: 'school-garden',
       imageUrl: 'https://…',
       alt: '学校的小花园',
       style: 'photo',
       source: '自己拍的',
     },
     // source 不填也行
     {
       sceneKey: 'autumn-leaves',
       imageUrl: 'https://…',
       alt: '秋天的落叶',
       style: 'watercolor',
     },
   ]

   ============================================================ */

export const SCENE_IMAGES: SceneImageEntry[] = []

/* ============================================================
   内部索引 —— 不用手动维护
   ============================================================ */

const IMAGE_BY_KEY = new Map<string, SceneImageEntry>(
  SCENE_IMAGES.map((e): [string, SceneImageEntry] => [e.sceneKey, e]),
)

/**
 * 按 sceneKey 取外链图片；没有就返回 undefined（调用方退回 SVG）。
 */
export function getSceneImage(sceneKey: string): SceneImageEntry | undefined {
  return IMAGE_BY_KEY.get(sceneKey)
}

/**
 * 有多少个场景已经填了外链图片。
 */
export function sceneImageCount(): number {
  return SCENE_IMAGES.length
}
