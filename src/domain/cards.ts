/* ============================================================
   套卡系统 —— 「文心卡」
   ============================================================

   设计逻辑：
   - 5 个卡组（世界），每组 8 位角色，共 40 张
   - 5 档稀有度：普通 / 优秀 / 稀有 / 史诗 / 传说
   - 每张卡 = 一位二次元角色（立绘由 CharacterArt 按参数现画，零图片资源）
   - 属性直接对应作文的五个评分维度 —— 这样"攒卡"和"写作能力"
     在孩子心里是同一件事，而不是两套互不相干的系统
   - 每个卡组有一条"专精维度"：整组在该维度上普遍偏高，
     集齐一组就相当于把某一项能力练起来
   - 掉落由「分数 + 行为 + Buff」共同决定，绝不只是随机
   - 重复卡可以叠星，不会白给
   ============================================================ */

import type {
  CardDef,
  CardDrop,
  CardSet,
  CardStats,
  DropSource,
  OwnedCard,
  Rarity,
  RarityMeta,
} from './types'
import { RARITIES } from './types'
import type {
  AccentStyle,
  Backdrop,
  BangsStyle,
  CharacterSpec,
  Expression,
  HairStyle,
  OutfitStyle,
} from './character'

/* ============================================================
   背景渐变 —— 全部取自 theme.css 的扁平色板
   ------------------------------------------------------------
   浅色留给四个"白天"卡组；神兽契灵用宝石深色，
   让整组在网格里一眼可辨（也压得住"契约"的重量感）。
   ============================================================ */

const BG_GREEN: [string, string] = ['#f2f7f3', '#e0ede5'] // 森绿
const BG_CREAM: [string, string] = ['#fdf9ef', '#f9eed6'] // 琥珀奶白
const BG_BLUE: [string, string] = ['#f1f6fa', '#deecf5'] // 雾蓝
const BG_LILAC: [string, string] = ['#f3f0fa', '#e4ddf5'] // 星紫
const BG_PINK: [string, string] = ['#fbecee', '#f6d7db'] // 樱粉
const BG_PEACH: [string, string] = ['#fcf0e7', '#f7dfca'] // 焦糖奶
const BG_DARK_GREEN: [string, string] = ['#24543e', '#1c4231']
const BG_DARK_GOLD: [string, string] = ['#3b2f2a', '#1c211e']
const BG_DARK_BLUE: [string, string] = ['#2a4d66', '#1b3446']
const BG_DARK_PLUM: [string, string] = ['#4a3b52', '#2a4d66']
const BG_CRIMSON: [string, string] = ['#8f3f4a', '#6d2a3a']

/* ============================================================
   卡组
   ============================================================ */

export const CARD_SETS: CardSet[] = [
  {
    id: 'forest',
    name: '林间学园',
    emoji: '🌿',
    desc: '在一座会长书的森林里上学，每个学生都守护一种文字',
    world: '在一座会长书的森林里上学，每个学生都守护一种文字',
    color: '#3e7f5e',
    reward: { coins: 300, title: '林间读者', frame: 'leaf' },
  },
  {
    id: 'star',
    name: '星海旅团',
    emoji: '✨',
    desc: '乘着纸飞船在星海间收集失落的句子',
    world: '乘着纸飞船在星海间收集失落的句子',
    color: '#7058a9',
    reward: { coins: 400, title: '拾句旅人', frame: 'star' },
  },
  {
    id: 'scroll',
    name: '古卷文阁',
    emoji: '📜',
    desc: '守着千年古卷的小书生与剑客',
    world: '守着千年古卷的小书生与剑客',
    color: '#ca7c46',
    reward: { coins: 500, title: '文阁执笔', frame: 'scroll' },
  },
  {
    id: 'sweets',
    name: '甜点茶屋',
    emoji: '🍰',
    desc: '把心情做成点心的温柔茶屋',
    world: '把心情做成点心的温柔茶屋',
    color: '#c5636f',
    reward: { coins: 400, title: '心事甜品师', frame: 'sweet' },
  },
  {
    id: 'beast',
    name: '神兽契灵',
    emoji: '🐉',
    desc: '与神兽缔结契约的孩子们',
    world: '与神兽缔结契约的孩子们',
    color: '#24543e',
    reward: { coins: 800, title: '契约之主', frame: 'beast' },
  },
]

export function cardSet(id: string): CardSet {
  return CARD_SETS.find((s) => s.id === id) ?? CARD_SETS[0]
}

/* ============================================================
   属性维度 —— 卡面与详情页共用一份标签表
   ------------------------------------------------------------
   glyph 是给卡面上的迷你属性条用的单字（两字标签在窄卡上放不下）。
   ============================================================ */

export const CARD_STATS: { key: keyof CardStats; label: string; glyph: string }[] = [
  { key: 'observation', label: '观察力', glyph: '观' },
  { key: 'structure', label: '条理性', glyph: '理' },
  { key: 'vocabulary', label: '词汇量', glyph: '词' },
  { key: 'imagination', label: '想象力', glyph: '想' },
  { key: 'emotion', label: '真情实感', glyph: '情' },
]

/* ============================================================
   造卡小工具
   ------------------------------------------------------------
   40 张卡如果都手写完整对象，字段一多必然出现漏填和错位；
   用两个具名参数的构造器收口，既能一眼看出差异，也保证
   每张卡的五维属性都是完整、显式的。
   ============================================================ */

function s(
  observation: number,
  structure: number,
  vocabulary: number,
  imagination: number,
  emotion: number,
): CardStats {
  return { observation, structure, vocabulary, imagination, emotion }
}

/** 立绘参数：只写"这张卡和别人不一样的地方"，其余给合理默认 */
function art(a: {
  hair: HairStyle
  bangs: BangsStyle
  hc: [string, string]
  eye: string
  outfit: OutfitStyle
  oc: [string, string]
  exp: Expression
  bg: [string, string]
  accent?: AccentStyle
  ac?: string
  backdrop?: Backdrop
}): CharacterSpec {
  return {
    hair: a.hair,
    bangs: a.bangs,
    hairColor: a.hc,
    eyeColor: a.eye,
    outfit: a.outfit,
    outfitColor: a.oc,
    accent: a.accent ?? 'none',
    accentColor: a.ac ?? '#c98a2e',
    expression: a.exp,
    bg: a.bg,
    backdrop: a.backdrop ?? 'soft',
  }
}

function c(a: {
  id: string
  setId: string
  name: string
  title: string
  emoji: string
  rarity: Rarity
  stats: CardStats
  flavor: string
  character: CharacterSpec
  skill?: string
}): CardDef {
  return {
    id: a.id,
    setId: a.setId,
    name: a.name,
    title: a.title,
    emoji: a.emoji,
    rarity: a.rarity,
    // 史诗 / 传说必然是"特殊卡"（带技能），其余是属性卡
    kind: a.rarity === 'epic' || a.rarity === 'legend' ? 'special' : 'attribute',
    stats: a.stats,
    flavor: a.flavor,
    skill: a.skill,
    character: a.character,
  }
}

/* ============================================================
   40 位角色
   ------------------------------------------------------------
   每组的稀有度构成固定为：3 普通 · 2 优秀 · 1 稀有 · 1 史诗 · 1 传说。
   数值上，战力（五维之和）随稀有度阶梯上升，肉眼可见。
   ============================================================ */

export const CARDS: CardDef[] = [
  /* ==========================================================
     🌿 林间学园 —— 专精：观察力
     在一座会长书的森林里上学，每个学生都守护一种文字
     ========================================================== */
  c({
    id: 'forest-1',
    setId: 'forest',
    name: '青芜',
    title: '晨读的观察者',
    emoji: '🌱',
    rarity: 'common',
    stats: s(52, 38, 36, 34, 40),
    flavor: '天没亮我就来了——叶子上的露珠，每一颗我都数过。',
    character: art({
      hair: 'long',
      bangs: 'straight',
      hc: ['#3e7f5e', '#24543e'],
      eye: '#2f6b4f',
      outfit: 'uniform',
      oc: ['#2f6b4f', '#1c4231'],
      accent: 'ribbon',
      ac: '#e5c073',
      exp: 'calm',
      bg: BG_GREEN,
    }),
  }),
  c({
    id: 'forest-2',
    setId: 'forest',
    name: '阿箬',
    title: '抄书的小书虫',
    emoji: '🌿',
    rarity: 'common',
    stats: s(46, 44, 42, 30, 38),
    flavor: '抄到第三本的时候，我发现字的影子会跟着光走。',
    character: art({
      hair: 'bob',
      bangs: 'curtain',
      hc: ['#4a3b52', '#2e2436'],
      eye: '#609f7d',
      outfit: 'sweater',
      oc: ['#609f7d', '#3e7f5e'],
      accent: 'glasses',
      ac: '#3b2f2a',
      exp: 'curious',
      bg: BG_GREEN,
      backdrop: 'bubble',
    }),
  }),
  c({
    id: 'forest-3',
    setId: 'forest',
    name: '小满',
    title: '会听风的孩子',
    emoji: '🌾',
    rarity: 'common',
    stats: s(55, 34, 33, 36, 42),
    flavor: '风拐弯的地方，一定藏着一条没写进地图的小路。',
    character: art({
      hair: 'short',
      bangs: 'side',
      hc: ['#c98a2e', '#85551b'],
      eye: '#c98a2e',
      outfit: 'hoodie',
      oc: ['#93c0a6', '#3e7f5e'],
      exp: 'smile',
      bg: BG_CREAM,
      backdrop: 'ray',
    }),
  }),
  c({
    id: 'forest-4',
    setId: 'forest',
    name: '苔生',
    title: '苔藓记事的学徒',
    emoji: '🍃',
    rarity: 'fine',
    stats: s(66, 50, 48, 44, 50),
    flavor: '石头上的绿，是树写给时间的信，我替它读出来。',
    character: art({
      hair: 'braid',
      bangs: 'split',
      hc: ['#24543e', '#1c4231'],
      eye: '#3e7f5e',
      outfit: 'kimono',
      oc: ['#609f7d', '#24543e'],
      accent: 'flower',
      ac: '#ecb3bb',
      exp: 'bright',
      bg: BG_GREEN,
      backdrop: 'sakura',
    }),
  }),
  c({
    id: 'forest-5',
    setId: 'forest',
    name: '听澜',
    title: '溪边的速写师',
    emoji: '💧',
    rarity: 'fine',
    stats: s(70, 52, 46, 48, 52),
    flavor: '水面每天都在重画同一片天，可没有一次是一样的。',
    character: art({
      hair: 'ponytail',
      bangs: 'curtain',
      hc: ['#42779a', '#2a4d66'],
      eye: '#6195b7',
      outfit: 'uniform',
      oc: ['#6195b7', '#345f7c'],
      accent: 'goggles',
      ac: '#c98a2e',
      exp: 'determined',
      bg: BG_BLUE,
      backdrop: 'bubble',
    }),
  }),
  c({
    id: 'forest-6',
    setId: 'forest',
    name: '竹青',
    title: '校林巡夜的学姐',
    emoji: '🎋',
    rarity: 'rare',
    stats: s(80, 62, 58, 60, 62),
    flavor: '我守的这片林子，每一棵都记得自己第一次开花的样子。',
    character: art({
      hair: 'hime',
      bangs: 'straight',
      hc: ['#2f6b4f', '#1c4231'],
      eye: '#3e7f5e',
      outfit: 'robe',
      oc: ['#c0dbc9', '#609f7d'],
      accent: 'earring',
      ac: '#c98a2e',
      exp: 'cool',
      bg: BG_GREEN,
      backdrop: 'ray',
    }),
  }),
  c({
    id: 'forest-7',
    setId: 'forest',
    name: '司墨',
    title: '墨脉的契约者',
    emoji: '📖',
    rarity: 'epic',
    stats: s(82, 72, 70, 74, 68),
    flavor: '我掌管的字，是这座森林最老的根。',
    skill: '墨脉共鸣 · 落笔前先看见整片森林，写景时的观察力大幅提升。',
    character: art({
      hair: 'wave',
      bangs: 'side',
      hc: ['#1c4231', '#0f2b20'],
      eye: '#e5c073',
      outfit: 'cloak',
      oc: ['#24543e', '#1c4231'],
      accent: 'horns',
      ac: '#c98a2e',
      exp: 'determined',
      bg: BG_DARK_GREEN,
      backdrop: 'burst',
    }),
  }),
  c({
    id: 'forest-8',
    setId: 'forest',
    name: '森罗',
    title: '长书森林的守望',
    emoji: '🌳',
    rarity: 'legend',
    stats: s(95, 86, 84, 88, 90),
    flavor: '我合上眼，整座森林就开始朗读。',
    skill: '万叶成书 · 站在林中人可听见每一片叶子的私语，观察与情感同时抵达顶点。',
    character: art({
      hair: 'long',
      bangs: 'split',
      hc: ['#609f7d', '#24543e'],
      eye: '#e5c073',
      outfit: 'robe',
      oc: ['#e5c073', '#c98a2e'],
      accent: 'crown',
      ac: '#e5c073',
      exp: 'bright',
      bg: BG_GREEN,
      backdrop: 'burst',
    }),
  }),

  /* ==========================================================
     ✨ 星海旅团 —— 专精：想象力
     乘着纸飞船在星海间收集失落的句子
     ========================================================== */
  c({
    id: 'star-1',
    setId: 'star',
    name: '拾一',
    title: '捡句子的见习生',
    emoji: '✨',
    rarity: 'common',
    stats: s(40, 36, 38, 54, 34),
    flavor: '我在流星尾巴后面捡到过一句话，可惜它只亮了三秒。',
    character: art({
      hair: 'twin',
      bangs: 'straight',
      hc: ['#8c73c5', '#5c47a0'],
      eye: '#aa96d9',
      outfit: 'hoodie',
      oc: ['#8c73c5', '#5c47a0'],
      accent: 'headphones',
      ac: '#6195b7',
      exp: 'curious',
      bg: BG_LILAC,
      backdrop: 'night',
    }),
  }),
  c({
    id: 'star-2',
    setId: 'star',
    name: '纸鸢',
    title: '折飞船的学徒',
    emoji: '🛩️',
    rarity: 'common',
    stats: s(42, 42, 36, 50, 36),
    flavor: '折痕越直，飞船飞得越远——这是我自己试出来的。',
    character: art({
      hair: 'short',
      bangs: 'side',
      hc: ['#345f7c', '#2a4d66'],
      eye: '#6195b7',
      outfit: 'uniform',
      oc: ['#42779a', '#345f7c'],
      accent: 'goggles',
      ac: '#c98a2e',
      exp: 'determined',
      bg: BG_BLUE,
      backdrop: 'ray',
    }),
  }),
  c({
    id: 'star-3',
    setId: 'star',
    name: '阿泠',
    title: '数星星的值夜人',
    emoji: '🌙',
    rarity: 'common',
    stats: s(52, 34, 36, 48, 40),
    flavor: '少了一颗星，我就知道今晚有人没睡好。',
    character: art({
      hair: 'bob',
      bangs: 'curtain',
      hc: ['#4a3b52', '#2e2436'],
      eye: '#8c73c5',
      outfit: 'sweater',
      oc: ['#ccbfea', '#8c73c5'],
      exp: 'calm',
      bg: BG_LILAC,
      backdrop: 'night',
    }),
  }),
  c({
    id: 'star-4',
    setId: 'star',
    name: '陨声',
    title: '听陨石唱歌的人',
    emoji: '☄️',
    rarity: 'fine',
    stats: s(54, 48, 50, 66, 48),
    flavor: '它们落下来的时候都在唱歌，只是没人肯安静地听完。',
    character: art({
      hair: 'wave',
      bangs: 'split',
      hc: ['#7058a9', '#5c47a0'],
      eye: '#e5c073',
      outfit: 'cloak',
      oc: ['#42779a', '#2a4d66'],
      accent: 'earring',
      ac: '#e5c073',
      exp: 'calm',
      bg: BG_BLUE,
      backdrop: 'burst',
    }),
  }),
  c({
    id: 'star-5',
    setId: 'star',
    name: '星垂',
    title: '舷窗边的记录员',
    emoji: '🔭',
    rarity: 'fine',
    stats: s(62, 54, 50, 64, 46),
    flavor: '我把见过的每一片星云都编了号，可它们自己并不在乎编号。',
    character: art({
      hair: 'ponytail',
      bangs: 'straight',
      hc: ['#6195b7', '#345f7c'],
      eye: '#aa96d9',
      outfit: 'uniform',
      oc: ['#7058a9', '#5c47a0'],
      accent: 'headphones',
      ac: '#c98a2e',
      exp: 'bright',
      bg: BG_LILAC,
      backdrop: 'bubble',
    }),
  }),
  c({
    id: 'star-6',
    setId: 'star',
    name: '穹顶',
    title: '领航的星图师',
    emoji: '🌌',
    rarity: 'rare',
    stats: s(68, 62, 60, 82, 58),
    flavor: '星图不是用来认路的，是用来记住我们曾经想去哪。',
    character: art({
      hair: 'hime',
      bangs: 'curtain',
      hc: ['#2a4d66', '#1b3446'],
      eye: '#e5c073',
      outfit: 'robe',
      oc: ['#345f7c', '#2a4d66'],
      accent: 'crown',
      ac: '#e5c073',
      exp: 'cool',
      bg: BG_DARK_BLUE,
      backdrop: 'night',
    }),
  }),
  c({
    id: 'star-7',
    setId: 'star',
    name: '流萤',
    title: '句海的摆渡者',
    emoji: '🪐',
    rarity: 'epic',
    stats: s(74, 70, 72, 88, 70),
    flavor: '每一颗流星，都是一句没写完的话掉了下来。',
    skill: '星轨拾遗 · 在空白处看见星轨，想象力的分数额外上扬。',
    character: art({
      hair: 'twin',
      bangs: 'split',
      hc: ['#aa96d9', '#7058a9'],
      eye: '#e5c073',
      outfit: 'cloak',
      oc: ['#7058a9', '#4a3b52'],
      accent: 'goggles',
      ac: '#6195b7',
      exp: 'curious',
      bg: BG_LILAC,
      backdrop: 'burst',
    }),
  }),
  c({
    id: 'star-8',
    setId: 'star',
    name: '归墟',
    title: '纸船尽头的引路人',
    emoji: '💫',
    rarity: 'legend',
    stats: s(88, 84, 86, 96, 88),
    flavor: '所有走丢的句子，最后都会漂回我这里。',
    skill: '万句归航 · 把散落的句子拼回原来的故事，想象力与条理同时登顶。',
    character: art({
      hair: 'wave',
      bangs: 'side',
      hc: ['#e4ddf5', '#aa96d9'],
      eye: '#e5c073',
      outfit: 'kimono',
      oc: ['#5c47a0', '#2a4d66'],
      accent: 'crown',
      ac: '#e5c073',
      exp: 'bright',
      bg: BG_DARK_BLUE,
      backdrop: 'night',
    }),
  }),

  /* ==========================================================
     📜 古卷文阁 —— 专精：词汇量
     守着千年古卷的小书生与剑客
     ========================================================== */
  c({
    id: 'scroll-1',
    setId: 'scroll',
    name: '墨砚',
    title: '磨墨的小书童',
    emoji: '🖌️',
    rarity: 'common',
    stats: s(38, 42, 54, 32, 36),
    flavor: '墨磨到第七圈，字才会听话。',
    character: art({
      hair: 'short',
      bangs: 'straight',
      hc: ['#3b2f2a', '#1c211e'],
      eye: '#85551b',
      outfit: 'robe',
      oc: ['#df9b6b', '#ca7c46'],
      exp: 'calm',
      bg: BG_CREAM,
    }),
  }),
  c({
    id: 'scroll-2',
    setId: 'scroll',
    name: '朱砂',
    title: '点朱的描红生',
    emoji: '🔴',
    rarity: 'common',
    stats: s(42, 46, 50, 34, 38),
    flavor: '一点朱砂落下去，错字就红了脸。',
    character: art({
      hair: 'buns',
      bangs: 'curtain',
      hc: ['#c5636f', '#8f3f4a'],
      eye: '#c5636f',
      outfit: 'kimono',
      oc: ['#c5636f', '#8f3f4a'],
      accent: 'flower',
      ac: '#e5c073',
      exp: 'smile',
      bg: BG_PINK,
      backdrop: 'sakura',
    }),
  }),
  c({
    id: 'scroll-3',
    setId: 'scroll',
    name: '阿砚',
    title: '抄经的夜猫子',
    emoji: '🐈',
    rarity: 'common',
    stats: s(40, 40, 52, 36, 34),
    flavor: '抄完最后一页，灯芯刚好烧完——像约好的一样。',
    character: art({
      hair: 'bob',
      bangs: 'split',
      hc: ['#4c544e', '#333a35'],
      eye: '#85551b',
      outfit: 'sweater',
      oc: ['#df9b6b', '#ca7c46'],
      accent: 'glasses',
      ac: '#3b2f2a',
      exp: 'shy',
      bg: BG_PEACH,
      backdrop: 'bubble',
    }),
  }),
  c({
    id: 'scroll-4',
    setId: 'scroll',
    name: '抱朴',
    title: '山门下的抄书人',
    emoji: '📜',
    rarity: 'fine',
    stats: s(50, 56, 68, 48, 48),
    flavor: '我抄的书能堆到屋檐，可我记得每一页的味道。',
    character: art({
      hair: 'long',
      bangs: 'straight',
      hc: ['#85551b', '#5c3a12'],
      eye: '#c98a2e',
      outfit: 'robe',
      oc: ['#f1dba9', '#df9b6b'],
      accent: 'earring',
      ac: '#c98a2e',
      exp: 'calm',
      bg: BG_CREAM,
      backdrop: 'ray',
    }),
  }),
  c({
    id: 'scroll-5',
    setId: 'scroll',
    name: '问剑',
    title: '佩剑的读书人',
    emoji: '⚔️',
    rarity: 'fine',
    stats: s(52, 64, 62, 50, 46),
    flavor: '剑是给不听话的句子准备的，一般用不上。',
    character: art({
      hair: 'ponytail',
      bangs: 'side',
      hc: ['#1c211e', '#000000'],
      eye: '#42779a',
      outfit: 'armor',
      oc: ['#4c544e', '#333a35'],
      exp: 'cool',
      bg: BG_BLUE,
      backdrop: 'burst',
    }),
  }),
  c({
    id: 'scroll-6',
    setId: 'scroll',
    name: '砚秋',
    title: '掌灯的藏书阁主',
    emoji: '🏮',
    rarity: 'rare',
    stats: s(60, 66, 84, 58, 60),
    flavor: '书阁里的每一盏灯，都记得是谁把它点亮的。',
    character: art({
      hair: 'hime',
      bangs: 'curtain',
      hc: ['#5c3a12', '#3b2f2a'],
      eye: '#c98a2e',
      outfit: 'kimono',
      oc: ['#a96f22', '#85551b'],
      accent: 'crown',
      ac: '#e5c073',
      exp: 'determined',
      bg: BG_PEACH,
      backdrop: 'ray',
    }),
  }),
  c({
    id: 'scroll-7',
    setId: 'scroll',
    name: '无双',
    title: '一字断句的剑客',
    emoji: '🗡️',
    rarity: 'epic',
    stats: s(68, 76, 88, 70, 66),
    flavor: '我这一生只练一个字：准。',
    skill: '一字千钧 · 落笔如出剑，一个词就能定住整段文章的骨。',
    character: art({
      hair: 'spiky',
      bangs: 'side',
      hc: ['#3b2f2a', '#1c211e'],
      eye: '#c98a2e',
      outfit: 'armor',
      oc: ['#85551b', '#3b2f2a'],
      accent: 'earring',
      ac: '#c5636f',
      exp: 'determined',
      bg: BG_DARK_GOLD,
      backdrop: 'burst',
    }),
  }),
  c({
    id: 'scroll-8',
    setId: 'scroll',
    name: '文渊',
    title: '古卷尽头的执笔人',
    emoji: '🖋️',
    rarity: 'legend',
    stats: s(86, 90, 96, 86, 84),
    flavor: '你们写的每一个字，我都见过它们最初的样子。',
    skill: '落墨成章 · 千年古卷皆为其注脚，词汇与条理双双圆满。',
    character: art({
      hair: 'long',
      bangs: 'split',
      hc: ['#e5c073', '#c98a2e'],
      eye: '#85551b',
      outfit: 'robe',
      oc: ['#c98a2e', '#85551b'],
      accent: 'crown',
      ac: '#e5c073',
      exp: 'bright',
      bg: BG_CREAM,
      backdrop: 'ray',
    }),
  }),

  /* ==========================================================
     🍰 甜点茶屋 —— 专精：真情实感
     把心情做成点心的温柔茶屋
     ========================================================== */
  c({
    id: 'sweets-1',
    setId: 'sweets',
    name: '奶糖',
    title: '试味的小学徒',
    emoji: '🍬',
    rarity: 'common',
    stats: s(40, 36, 34, 38, 54),
    flavor: '尝一口就知道今天谁心里是酸的。',
    character: art({
      hair: 'twin',
      bangs: 'straight',
      hc: ['#db8693', '#a35563'],
      eye: '#c5636f',
      outfit: 'dress',
      oc: ['#f6d7db', '#db8693'],
      accent: 'ribbon',
      ac: '#c5636f',
      exp: 'bright',
      bg: BG_PINK,
      backdrop: 'bubble',
    }),
  }),
  c({
    id: 'sweets-2',
    setId: 'sweets',
    name: '焦糖',
    title: '熬糖的守夜人',
    emoji: '🍮',
    rarity: 'common',
    stats: s(44, 42, 34, 34, 48),
    flavor: '糖熬到发苦前一秒，才是最好吃的时候。',
    character: art({
      hair: 'short',
      bangs: 'side',
      hc: ['#ca7c46', '#85551b'],
      eye: '#ca7c46',
      outfit: 'sweater',
      oc: ['#f7dfca', '#df9b6b'],
      accent: 'hat',
      ac: '#c5636f',
      exp: 'calm',
      bg: BG_PEACH,
    }),
  }),
  c({
    id: 'sweets-3',
    setId: 'sweets',
    name: '小豆',
    title: '红豆馅的保管员',
    emoji: '🫘',
    rarity: 'common',
    stats: s(42, 38, 36, 34, 52),
    flavor: '红豆要煮到愿意自己裂开，急不来的。',
    character: art({
      hair: 'buns',
      bangs: 'curtain',
      hc: ['#8f3f4a', '#6d2a3a'],
      eye: '#c5636f',
      outfit: 'kimono',
      oc: ['#c5636f', '#8f3f4a'],
      accent: 'flower',
      ac: '#e5c073',
      exp: 'shy',
      bg: BG_PINK,
      backdrop: 'sakura',
    }),
  }),
  c({
    id: 'sweets-4',
    setId: 'sweets',
    name: '奶油',
    title: '裱花的手艺人',
    emoji: '🧁',
    rarity: 'fine',
    stats: s(54, 50, 48, 46, 68),
    flavor: '花挤歪了不要紧，歪有歪的好看。',
    character: art({
      hair: 'wave',
      bangs: 'split',
      hc: ['#f1dba9', '#df9b6b'],
      eye: '#ca7c46',
      outfit: 'dress',
      oc: ['#fbecee', '#ecb3bb'],
      accent: 'ribbon',
      ac: '#db8693',
      exp: 'smile',
      bg: BG_PEACH,
      backdrop: 'bubble',
    }),
  }),
  c({
    id: 'sweets-5',
    setId: 'sweets',
    name: '可可',
    title: '茶屋的记事板',
    emoji: '🍫',
    rarity: 'fine',
    stats: s(58, 54, 48, 44, 64),
    flavor: '客人说不出口的话，我都写在板子背面。',
    character: art({
      hair: 'braid',
      bangs: 'straight',
      hc: ['#5c3a12', '#3b2f2a'],
      eye: '#ca7c46',
      outfit: 'uniform',
      oc: ['#df9b6b', '#ca7c46'],
      accent: 'glasses',
      ac: '#3b2f2a',
      exp: 'calm',
      bg: BG_PEACH,
    }),
  }),
  c({
    id: 'sweets-6',
    setId: 'sweets',
    name: '蜜柚',
    title: '把心事做成糖的人',
    emoji: '🍯',
    rarity: 'rare',
    stats: s(64, 58, 58, 56, 84),
    flavor: '心里越酸的事，做出来的糖越亮。',
    character: art({
      hair: 'ponytail',
      bangs: 'side',
      hc: ['#eebf9c', '#ca7c46'],
      eye: '#c5636f',
      outfit: 'dress',
      oc: ['#db8693', '#a35563'],
      accent: 'flower',
      ac: '#f1dba9',
      exp: 'bright',
      bg: BG_PINK,
      backdrop: 'sakura',
    }),
  }),
  c({
    id: 'sweets-7',
    setId: 'sweets',
    name: '焦云',
    title: '暖炉旁的甜品师',
    emoji: '🍰',
    rarity: 'epic',
    stats: s(72, 68, 66, 66, 90),
    flavor: '凉了的点心我还能救，凉了的心事也行。',
    skill: '回温魔法 · 把凉掉的句子重新捂热，真情实感一栏直接拉满。',
    character: art({
      hair: 'hime',
      bangs: 'curtain',
      hc: ['#c5636f', '#8f3f4a'],
      eye: '#e5c073',
      outfit: 'kimono',
      oc: ['#ecb3bb', '#c5636f'],
      accent: 'ribbon',
      ac: '#e5c073',
      exp: 'smile',
      bg: BG_PINK,
      backdrop: 'ray',
    }),
  }),
  c({
    id: 'sweets-8',
    setId: 'sweets',
    name: '甘棠',
    title: '茶屋的看板娘',
    emoji: '🫖',
    rarity: 'legend',
    stats: s(88, 84, 84, 82, 96),
    flavor: '推门进来的人，我都记得他上一次点的什么。',
    skill: '一茶一世界 · 端上一杯茶，就能尝出整篇作文里藏着的情绪。',
    character: art({
      hair: 'long',
      bangs: 'split',
      hc: ['#f6d7db', '#db8693'],
      eye: '#ca7c46',
      outfit: 'dress',
      oc: ['#f1dba9', '#ca7c46'],
      accent: 'crown',
      ac: '#e5c073',
      exp: 'bright',
      bg: BG_PINK,
      backdrop: 'burst',
    }),
  }),

  /* ==========================================================
     🐉 神兽契灵 —— 专精：条理性
     与神兽缔结契约的孩子们
     ========================================================== */
  c({
    id: 'beast-1',
    setId: 'beast',
    name: '阿狼',
    title: '与犬神结契的少年',
    emoji: '🐺',
    rarity: 'common',
    stats: s(42, 54, 34, 36, 40),
    flavor: '它先闻了闻我，然后才肯听我说话。',
    character: art({
      hair: 'spiky',
      bangs: 'straight',
      hc: ['#4c544e', '#333a35'],
      eye: '#c98a2e',
      outfit: 'hoodie',
      oc: ['#333a35', '#1c211e'],
      accent: 'catears',
      ac: '#4c544e',
      exp: 'determined',
      bg: BG_DARK_GOLD,
      backdrop: 'burst',
    }),
  }),
  c({
    id: 'beast-2',
    setId: 'beast',
    name: '小鹿',
    title: '鹿灵的小跟班',
    emoji: '🦌',
    rarity: 'common',
    stats: s(48, 48, 34, 34, 42),
    flavor: '它走路没有声音，我练了三年才跟上。',
    character: art({
      hair: 'bob',
      bangs: 'curtain',
      hc: ['#85551b', '#5c3a12'],
      eye: '#c98a2e',
      outfit: 'robe',
      oc: ['#24543e', '#1c4231'],
      accent: 'horns',
      ac: '#e5c073',
      exp: 'shy',
      bg: BG_DARK_GREEN,
    }),
  }),
  c({
    id: 'beast-3',
    setId: 'beast',
    name: '岩鸦',
    title: '与石鸦契约的孩子',
    emoji: '🪨',
    rarity: 'common',
    stats: s(46, 52, 34, 38, 36),
    flavor: '它只在我要说错话的时候叫一声。',
    character: art({
      hair: 'short',
      bangs: 'side',
      hc: ['#1c211e', '#000000'],
      eye: '#6195b7',
      outfit: 'armor',
      oc: ['#345f7c', '#2a4d66'],
      accent: 'earring',
      ac: '#c98a2e',
      exp: 'cool',
      bg: BG_DARK_BLUE,
      backdrop: 'night',
    }),
  }),
  c({
    id: 'beast-4',
    setId: 'beast',
    name: '绛鳞',
    title: '养小龙的姑娘',
    emoji: '🐉',
    rarity: 'fine',
    stats: s(54, 68, 48, 50, 52),
    flavor: '它打喷嚏会烧掉我的作业，所以我学会了先备份。',
    character: art({
      hair: 'twin',
      bangs: 'split',
      hc: ['#c5636f', '#8f3f4a'],
      eye: '#e5c073',
      outfit: 'kimono',
      oc: ['#8f3f4a', '#6d2a3a'],
      accent: 'horns',
      ac: '#e5c073',
      exp: 'bright',
      bg: BG_CRIMSON,
      backdrop: 'burst',
    }),
  }),
  c({
    id: 'beast-5',
    setId: 'beast',
    name: '墨麒麟',
    title: '守卷的麒麟骑士',
    emoji: '🦄',
    rarity: 'fine',
    stats: s(58, 66, 54, 48, 50),
    flavor: '麒麟只跟在把它读懂的人身后。',
    character: art({
      hair: 'ponytail',
      bangs: 'straight',
      hc: ['#24543e', '#1c4231'],
      eye: '#e5c073',
      outfit: 'armor',
      oc: ['#1c4231', '#0f2b20'],
      accent: 'horns',
      ac: '#c98a2e',
      exp: 'determined',
      bg: BG_DARK_GREEN,
      backdrop: 'burst',
    }),
  }),
  c({
    id: 'beast-6',
    setId: 'beast',
    name: '玄鸟',
    title: '与神鸟同行的祭司',
    emoji: '🕊️',
    rarity: 'rare',
    stats: s(66, 84, 58, 62, 60),
    flavor: '它飞过的路线，就是一篇不用修改的文章。',
    character: art({
      hair: 'hime',
      bangs: 'curtain',
      hc: ['#1b3446', '#0f2230'],
      eye: '#e5c073',
      outfit: 'robe',
      oc: ['#345f7c', '#1b3446'],
      accent: 'crown',
      ac: '#e5c073',
      exp: 'calm',
      bg: BG_DARK_BLUE,
      backdrop: 'night',
    }),
  }),
  c({
    id: 'beast-7',
    setId: 'beast',
    name: '白泽',
    title: '知万物的契约者',
    emoji: '🦁',
    rarity: 'epic',
    stats: s(78, 88, 74, 72, 70),
    flavor: '它认得所有名字，包括那些你还没想出来的。',
    skill: '白泽通名 · 落笔前先理清万物关系，文章骨架坚不可摧。',
    character: art({
      hair: 'long',
      bangs: 'split',
      hc: ['#e4ddf5', '#aa96d9'],
      eye: '#8c73c5',
      outfit: 'cloak',
      oc: ['#5c47a0', '#2a4d66'],
      accent: 'horns',
      ac: '#e5c073',
      exp: 'determined',
      bg: BG_DARK_PLUM,
      backdrop: 'burst',
    }),
  }),
  c({
    id: 'beast-8',
    setId: 'beast',
    name: '烛龙',
    title: '执掌昼夜的契主',
    emoji: '🐲',
    rarity: 'legend',
    stats: s(88, 96, 88, 84, 86),
    flavor: '我睁眼是白天，闭眼是黑夜——中间那段，归你们写。',
    skill: '烛照九阴 · 一眼定文章的起承转合，条理与词汇同时登峰。',
    character: art({
      hair: 'wave',
      bangs: 'side',
      hc: ['#c98a2e', '#85551b'],
      eye: '#e5c073',
      outfit: 'armor',
      oc: ['#85551b', '#3b2f2a'],
      accent: 'horns',
      ac: '#c98a2e',
      exp: 'bright',
      bg: BG_DARK_GOLD,
      backdrop: 'burst',
    }),
  }),
]

/* ============================================================
   查询
   ============================================================ */

export function cardDef(id: string): CardDef | undefined {
  return CARDS.find((x) => x.id === id)
}

export function cardsInSet(setId: string): CardDef[] {
  return CARDS.filter((x) => x.setId === setId)
}

export function rarityMeta(r: Rarity): RarityMeta {
  return RARITIES.find((x) => x.key === r) ?? RARITIES[0]
}

/** 战力 = 五维之和。卡面上不直接写，但在详情页给个总览数字 */
export function totalPower(def: CardDef): number {
  return CARD_STATS.reduce((sum, d) => sum + def.stats[d.key], 0)
}

/* ============================================================
   掉落引擎
   ============================================================ */

export interface DropContext {
  /** 触发来源 */
  source: DropSource
  /** 本次作文总分（日记/背诵可为 0） */
  score?: number
  /** 本次获得的星级 */
  stars?: number
  /** 日记连续签到 Buff 提供的稀有度加成倍率（1 表示无加成） */
  rarityBoost?: number
  /** 一次抽几张 */
  count?: number
  /** 已拥有的卡，用于判断是否新卡 */
  owned?: OwnedCard[]
  /** 是否必定给一张新卡（如升段奖励） */
  guaranteedNew?: boolean
}

/**
 * 计算基础抽卡次数。
 *
 * 掉落不是纯随机 —— 孩子写得越好、坚持得越久，抽得越多。
 * 但即使写得很一般，也保证至少抽 1 张，绝不空手。
 */
export function baseDrawCount(ctx: DropContext): number {
  const score = ctx.score ?? 0
  switch (ctx.source) {
    case 'composition': {
      let n = 1 // 保底
      if (score >= 60) n = 2
      if (score >= 78) n = 3
      if (score >= 90) n = 4
      if ((ctx.stars ?? 0) >= 5) n += 1
      return n
    }
    case 'high_score':
      return 1
    case 'recitation':
      return score >= 80 ? 2 : 1
    case 'diary':
      return 1
    case 'streak':
      return 1
    case 'level_up':
      return 2
    case 'set_complete':
      return 3
    // 这三种是"顺手回来看看"的轻产出，一张就够，别喧宾夺主
    case 'tree':
    case 'travel':
    case 'hollow':
      return 1
  }
}

/** 按权重抽一个稀有度 */
function rollRarity(boost: number): Rarity {
  // boost 只作用于稀有以上，让它"更容易出好东西"而不是直接给
  const weighted = RARITIES.map((r) => {
    let w = r.weight
    if (r.key === 'rare') w *= boost
    if (r.key === 'epic') w *= Math.pow(boost, 1.35)
    if (r.key === 'legend') w *= Math.pow(boost, 1.7)
    return { key: r.key, w }
  })
  const total = weighted.reduce((a, b) => a + b.w, 0)
  let roll = Math.random() * total
  for (const item of weighted) {
    roll -= item.w
    if (roll <= 0) return item.key
  }
  return 'common'
}

/**
 * 执行一次掉落。
 *
 * 优先给「还没拥有的卡」—— 集卡游戏最怕的就是一直抽重复，
 * 那会让孩子觉得努力没用。所以我们把重复概率压到很低。
 */
export function rollDrops(ctx: DropContext): CardDrop[] {
  const count = ctx.count ?? baseDrawCount(ctx)
  const boost = Math.max(1, ctx.rarityBoost ?? 1)
  const ownedIds = new Set((ctx.owned ?? []).map((o) => o.defId))
  const drops: CardDrop[] = []
  const pickedThisRound = new Set<string>()

  for (let i = 0; i < count; i++) {
    let rarity = rollRarity(boost)

    // 确定候选池
    let pool = CARDS.filter((x) => x.rarity === rarity)

    // 非传说卡：优先还没集齐的
    const wantNew = i === 0 || ctx.guaranteedNew
    if (wantNew && rarity !== 'legend') {
      const unowned = pool.filter(
        (x) => !ownedIds.has(x.id) && !pickedThisRound.has(x.id),
      )
      if (unowned.length > 0) {
        pool = unowned
      } else {
        // 该稀有度全齐了，退而求其次往上找没集齐的
        const anyUnowned = CARDS.filter(
          (x) => !ownedIds.has(x.id) && !pickedThisRound.has(x.id) && x.rarity !== 'legend',
        )
        if (anyUnowned.length > 0) {
          pool = anyUnowned
          rarity = anyUnowned[0].rarity
        }
      }
    } else {
      // 允许重复，但排除本轮已抽到的
      const notThisRound = pool.filter((x) => !pickedThisRound.has(x.id))
      if (notThisRound.length > 0) pool = notThisRound
    }

    if (pool.length === 0) pool = CARDS
    const chosen = pool[Math.floor(Math.random() * pool.length)]

    pickedThisRound.add(chosen.id)
    drops.push({
      defId: chosen.id,
      rarity: chosen.rarity,
      isNew: !ownedIds.has(chosen.id),
      source: ctx.source,
    })
  }

  // 按稀有度排序，让好东西在后面出场，有递进的爽感
  const order: Rarity[] = ['common', 'fine', 'rare', 'epic', 'legend']
  return drops.sort((a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity))
}

/* ============================================================
   背包操作
   ============================================================ */

/** 把掉落并入背包 */
export function addDrops(owned: OwnedCard[], drops: CardDrop[], now: number): OwnedCard[] {
  const map = new Map(owned.map((o) => [o.defId, { ...o }]))
  for (const d of drops) {
    const existing = map.get(d.defId)
    if (existing) {
      existing.count += 1
      // 集满 3 张叠星
      if (existing.count >= 3) existing.starred = true
    } else {
      map.set(d.defId, { defId: d.defId, count: 1, firstAt: now, starred: false })
    }
  }
  return [...map.values()]
}

export interface SetProgress {
  set: CardSet
  owned: number
  total: number
  percent: number
  complete: boolean
  /** 已拥有的卡 id */
  ownedIds: string[]
}

export function setProgress(owned: OwnedCard[], setId: string): SetProgress {
  const set = cardSet(setId)
  const defs = cardsInSet(setId)
  const ownedIds = defs.filter((d) => owned.some((o) => o.defId === d.id)).map((d) => d.id)
  return {
    set,
    owned: ownedIds.length,
    total: defs.length,
    percent: defs.length === 0 ? 0 : Math.round((ownedIds.length / defs.length) * 100),
    complete: ownedIds.length === defs.length && defs.length > 0,
    ownedIds,
  }
}

export function allSetProgress(owned: OwnedCard[]): SetProgress[] {
  return CARD_SETS.map((s) => setProgress(owned, s.id))
}

/** 收集总进度 */
export function collectionStats(owned: OwnedCard[]) {
  const total = CARDS.length
  const got = CARDS.filter((c) => owned.some((o) => o.defId === c.id)).length
  const byRarity = RARITIES.map((r) => ({
    rarity: r.key,
    label: r.label,
    got: CARDS.filter(
      (c) => c.rarity === r.key && owned.some((o) => o.defId === c.id),
    ).length,
    total: CARDS.filter((c) => c.rarity === r.key).length,
  }))
  return { total, got, percent: Math.round((got / total) * 100), byRarity }
}

/* ============================================================
   寄语
   ============================================================ */

/**
 * 鼓励寄语库。
 *
 * 原则：只夸努力和具体进步，不夸"你真聪明"。
 * 也偶尔玩一下"清华苗子"这类家长爱听的马屁，
 * 但主体要是孩子看得懂、会心一笑的话。
 */
export const BLESSINGS = {
  high: [
    '这写得也太好了吧！小笔苗都看呆了 👀',
    '你这段话，老师念给全班听都不亏 📣',
    '清华的招生老师要是看见了，得偷偷记你名字 📝',
    '你的笔尖上是不是蘸了星星？✨',
    '这篇看完，森林里的树都鼓掌了 🌳👏',
    '不得了，这是要出书的水平 📚',
    '小笔苗偷偷说：这是我今年读到最好的故事 🤫',
  ],
  mid: [
    '稳稳的！照这个劲头写下去，很快就能升级 🚀',
    '好词越来越多了，你的本子在偷偷变厚 📖',
    '这一篇比上一篇顺多了，你自己发现了吗？👏',
    '这个开头我喜欢，很像一个会讲故事的人 😎',
    '进步就藏在你每一次认真的修改里 🔍',
    '小树又长高了那么一点点 🌱',
  ],
  low: [
    '你已经动笔了，这就比昨天强 👍',
    '不着急，好文章都是改出来的 ✍️',
    '今天的你只跟昨天的你比，前进了就行 🐢',
    '这颗小种子还在土里使劲呢，别急 🌰',
    '写下来的每一个字，都在帮你长大 🌿',
    '要不咱们先挑一句最喜欢的改改？😊',
  ],
  streak: [
    '连着好几天啦！这个习惯正在长成大树 🌳',
    '小笔苗都记着呢，你一次都没落下 ✅',
    '坚持的孩子最可怕，因为没人追得上 🏃',
    '你的日记本越来越厚，你的世界也越来越大 🌍',
  ],
  recitation: [
    '背得一字不差！这个记性不得了 🧠✨',
    '开口就是全文，闭上眼睛都能背 🎤',
    '你把范文吃到肚子里啦，以后就是你自己的了 🍽️',
  ],
  diary: [
    '把今天存起来啦，等以后翻出来看会笑 😊',
    '这个秘密只有你和小笔苗知道 🤫',
    '日记是写给未来的自己的信，今天又寄出一封 💌',
  ],
} as const

export function pickBlessing(tier: keyof typeof BLESSINGS): string {
  const pool = BLESSINGS[tier]
  return pool[Math.floor(Math.random() * pool.length)]
}

/** 按分数自动挑一档寄语 */
export function blessingForScore(score: number): string {
  if (score >= 82) return pickBlessing('high')
  if (score >= 60) return pickBlessing('mid')
  return pickBlessing('low')
}

/* ============================================================
   每日 Buff
   ============================================================ */

/**
 * 日记连续签到 = Buff。
 * 这是需求里「连续签到会有奖励 buff 加成，增加稀有概率」的落实。
 */
export const STREAK_BUFFS = [
  { tier: 0, days: 0, label: '还没有加成', rarityBoost: 1, coinBoost: 1 },
  { tier: 1, days: 2, label: '小露珠 · 稀有度 +25%', rarityBoost: 1.25, coinBoost: 1.1 },
  { tier: 2, days: 4, label: '阳光普照 · 稀有度 +55%', rarityBoost: 1.55, coinBoost: 1.25 },
  { tier: 3, days: 7, label: '春雨魔法 · 稀有度 +100%', rarityBoost: 2, coinBoost: 1.5 },
]

export function buffForStreak(days: number) {
  let best = STREAK_BUFFS[0]
  for (const b of STREAK_BUFFS) {
    if (days >= b.days) best = b
  }
  return best
}

/** 距离下一档 Buff 还差几天 */
export function nextBuffInfo(days: number) {
  const next = STREAK_BUFFS.find((b) => days < b.days)
  if (!next) return null
  return { daysNeeded: next.days - days, next }
}
