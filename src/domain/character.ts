/**
 * 二次元角色立绘 —— 参数化规格
 * ------------------------------------------------------------
 * 一张卡 = 一个角色。角色不是"画出来的图"，而是一组参数，
 * 由 CharacterArt 渲染成纯矢量立绘。这样：
 *   · 零图片资源，APK 体积不受影响
 *   · 断网可用
 *   · 40 个角色靠"参数组合"产生差异，而不是 40 张位图
 *
 * 这个文件只放类型与常量，渲染实现在 components/CharacterArt.tsx。
 */

/** 发型（决定后发 + 侧发的整体轮廓） */
export type HairStyle =
  | 'long' // 长直发
  | 'wave' // 长卷发
  | 'twin' // 双马尾
  | 'bob' // 波波头
  | 'ponytail' // 高马尾
  | 'buns' // 双丸子
  | 'short' // 短发
  | 'braid' // 侧编发
  | 'hime' // 姬发式（齐刘海 + 两侧直发）
  | 'spiky' // 刺猬头（少年向）

/** 刘海 */
export type BangsStyle = 'straight' | 'split' | 'side' | 'curtain'

/** 服装 */
export type OutfitStyle =
  | 'uniform' // 水手服
  | 'hoodie' // 连帽卫衣
  | 'robe' // 长袍（古风）
  | 'cloak' // 斗篷
  | 'dress' // 连衣裙
  | 'kimono' // 和服
  | 'sweater' // 毛衣
  | 'armor' // 轻甲

/** 配饰（点睛，决定角色辨识度） */
export type AccentStyle =
  | 'none'
  | 'ribbon' // 发带
  | 'flower' // 花饰
  | 'glasses' // 眼镜
  | 'headphones' // 耳机
  | 'horns' // 兽角
  | 'catears' // 猫耳
  | 'hat' // 帽子
  | 'crown' // 小皇冠
  | 'goggles' // 护目镜
  | 'earring' // 耳饰

/** 表情 */
export type Expression = 'smile' | 'bright' | 'calm' | 'determined' | 'shy' | 'curious' | 'cool'

/** 背景装饰 */
export type Backdrop = 'soft' | 'burst' | 'night' | 'sakura' | 'bubble' | 'ray'

export interface CharacterSpec {
  hair: HairStyle
  bangs: BangsStyle
  /** [主色, 暗部色] */
  hairColor: [string, string]
  eyeColor: string
  /** 肤色，默认给一个健康的暖调 */
  skin?: string
  outfit: OutfitStyle
  /** [主色, 暗部色] */
  outfitColor: [string, string]
  accent: AccentStyle
  accentColor: string
  expression: Expression
  /** 背景渐变 [起, 止] */
  bg: [string, string]
  backdrop?: Backdrop
}

/** 默认肤色（东亚暖调，比纯白更有血色） */
export const DEFAULT_SKIN = '#f7dcc8'
/** 描线色：用暖褐而不是纯黑，纯黑会显脏 */
export const LINE = '#3b2f2a'
