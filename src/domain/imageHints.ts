/* ============================================================
   配图 → 文字
   ============================================================

   为什么要单独一个文件：这件事**两个地方都要用**，而且以前只有一处做了。

     · 大模型那条路（ai.ts）—— 把配图翻成文字进提示词
     · 本地引擎那条路（modelEssay.ts）—— 以前**完全没看图**

   本地那条尤其要命：家长没配密钥时走的就是它，
   而它收到的 `images` 从来没被读过，所以孩子写「看图作文」，
   改写出来的东西**跟图一点关系都没有**。

   为什么是文字而不是把图片本身发过去：
     · 内置配图是程序化 SVG，**没有 URL 可以传**；
     · `deepseek-chat` 这类文本模型也不吃图；
     · 而 `SceneMeta.hint` 本来就是为这件事准备的 ——
       它的注释写着「一句话中文描述：画面里有什么，作为 AI 提示」。
   ============================================================ */

import { sceneMeta } from '../assets/scenes'
import type { PromptImage } from './types'

/** 「第 1 幅」这种只是位置标记，不是画面描述 —— 别把它当描述用 */
const POSITION_ONLY = /^第\s*[一二三四五六七八九十\d]+\s*[幅张]$/

export interface ImageHint {
  /** 「配图」或「第 N 幅」 */
  pos: string
  /** 场景中文名，如「雨后的彩虹」 */
  label?: string
  /** 画面里有什么 */
  desc: string
}

/**
 * 每张配图 → 一条描述。
 *
 * 描述来源优先级：手写的 caption（若真是描述）→ 场景自带 hint → 场景名。
 * `hint` 优先于「第 N 幅」这种位置标记 —— 后者是 builtinLibrary
 * 给多图题自动填的 caption，拿它当描述会得到「第 1 幅：第 1 幅」。
 */
export function describeImages(images: PromptImage[] | undefined): ImageHint[] {
  if (!images || images.length === 0) return []

  const out: ImageHint[] = []
  images.forEach((img, i) => {
    const meta = img.sceneKey ? sceneMeta(img.sceneKey) : undefined
    const cap = img.caption?.trim() ?? ''
    const capIsReal = cap.length > 0 && !POSITION_ONLY.test(cap)
    const desc = (capIsReal ? cap : '') || meta?.hint || meta?.label || ''
    if (!desc) return

    out.push({
      pos: images.length > 1 ? `第 ${i + 1} 幅` : '配图',
      label: meta?.label && meta.label !== desc ? meta.label : undefined,
      desc,
    })
  })
  return out
}

/** 给大模型看的多行文本 */
export function imageHintText(images: PromptImage[] | undefined): string {
  return describeImages(images)
    .map((h) => `- ${h.pos}${h.label ? `「${h.label}」` : ''}：${h.desc}`)
    .join('\n')
}

/** 只要画面描述本身 —— 本地引擎拿它当"该出现哪些东西"的依据 */
export function imageWords(images: PromptImage[] | undefined): string[] {
  return describeImages(images).map((h) => h.desc)
}
