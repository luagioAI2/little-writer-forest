/* ============================================================
   旅行图 —— 小鸟飞出去，地图亮起来
   ============================================================

   这一个页面承担了整条"往外走"的循环：

     写作 ──→ 树长大了 ──→ 有新的鸟愿意来住
       ↑                        │
       │                        ↓
     想看更多照片 ←── 鸟飞回来带回照片 ──→ 种子落地图上发芽

   所以它是"写作"的远端奖励。孩子在这里看到的不是数据，
   是一张一点一点被点亮的地图，和一叠越来越厚的照片。

   ------------------------------------------------------------
   地图的合规与实现说明（重要）

     1. 底图用打包进 App 的简化省界几何（src/assets/china-map.ts），
        包含全部 34 个省级行政区（含中国台湾、中国香港、中国澳门），
        用 SVG 在本地投影绘制。
     2. 因此**不联网、不申请任何地图 key、不放瓦片** —— 打包成
        Android APK 之后离线也能正常显示，不会白屏。
     3. 南海诸岛按规范以「附图」形式单独画出，不与主图混在一起。
     4. 图上只标公众熟知的风景 / 人文地标，坐标取公开景区位置。
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../../store/useApp'
import { levelAt } from '../../domain/levels'
import { distanceToLandmark, LANDMARKS, landmarkById, mapProgress, pickDestination, sproutedIds } from '../../domain/travel'
import { contentsByLandmark } from '../../domain/travelContents'
import {
  BIRD_SPECIES,
  awayBirds,
  birdReady,
  bondLabel,
  homeBirds,
  nextSpeciesToUnlock,
  speciesById,
} from '../../domain/pets'
import { CHINA_REGIONS } from '../../assets/china-map'
import {
  VIEWS,
  landPath,
  landmarkInScope,
  makeProj,
  regionPath,
  type MapScope,
} from './mapProjection'
import type { Bird, Landmark, Sprout, TravelContent, TravelPhoto, TravelSouvenir, VisitedLandmark } from '../../domain/types'
import { RARITIES, gradeMeta } from '../../domain/types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  InkCard,
  ProgressBar,
  SectionTitle,
  Sheet,
  StatTile,
} from '../../components/ui'
import {
  IconBirdSitting,
  IconCheck,
  IconClock,
  IconCompass,
  IconEnvelopeOpen,
  IconGift,
  IconHourglass,
  IconMapOutline,
  IconMapPin,
  IconPhoto,
  IconRoute,
  IconSeedling,
  IconTreeHollow,
} from '../../components/icons'
import { recruitCost } from '../../domain/economy'
import { playSound } from '../../platform/sound'
import { celebrateFeedback, tapFeedback } from '../../platform/haptics'

/** 稀有度 → 元数据（标签 / 配色） */
function rarityMeta(r: string) {
  return RARITIES.find((x) => x.key === r) ?? RARITIES[0]
}

/* ============================================================
   一、投影：经纬度 → SVG 坐标
   ------------------------------------------------------------
   ★★ 2026-09-24 拆到 `./mapProjection.ts` 去了。

   原因：那里全是纯函数，而"坐标算到画布外面去了"属于
   **不会报错**的那一类 bug（界面上什么都没有、控制台也一声不吭），
   只能靠"把每一个地标都投影一遍再逐个断言"来防住 ——
   留在组件文件里就没法写这个测试。守卫在 `mapProjection.test.ts`。
   ============================================================ */

/* ============================================================
   二、地图本体
   ============================================================ */

/**
 * 旅行地图 —— **中国 / 世界两个档共用这一个组件**。
 *
 * 层次（从下到上）：
 *   1. 底图填充（中国档 = 省界；世界档 = 陆地轮廓）
 *   2. 底图描边（发丝线，绝不加粗）
 *   3. 已发芽地标的"光点"
 *   4. 地标圆点
 *   5. 正在飞的小鸟（一个会摆动的小三角 + 虚线轨迹）
 *
 * ★★ 为什么两个档要共用组件、而不是各写一张图：
 *    投影、地标点、小鸟轨迹、命中区域、发光滤镜这些**完全一样**，
 *    只有"底图数据 + 窗口 + 画哪些地标"三处不同。
 *    各写一张的话，以后改地标点的画法要改两遍 —— 而漏掉一处不报错，
 *    只是那张图上地标不动了。
 *
 * ⚠️ 只有点亮过的地标才画（例外：正在被选中的那颗）。
 *    原因见下面「没点亮的一颗都不画」那段。
 */
function TravelMap({
  scope,
  sprouts,
  flyingBirds,
  activeLandmarkId,
  onPickLandmark,
  revealed,
  visitedIds,
}: {
  /** 看中国还是看世界 */
  scope: MapScope
  sprouts: Sprout[]
  flyingBirds: Bird[]
  activeLandmarkId: string | null
  onPickLandmark: (l: Landmark) => void
  /** 已点亮（用于给底图上色） */
  revealed: boolean
  /** v6：到过的地标 id 集合。用来区分「去过」和「没去过」 */
  visitedIds: Set<string>
}) {
  /** 地标 → 发芽等级 */
  const stageOf = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of sprouts) m.set(s.landmarkId, Math.max(m.get(s.landmarkId) ?? 0, s.stage))
    return m
  }, [sprouts])

  const proj = useMemo(() => makeProj(VIEWS[scope]), [scope])
  const isWorld = scope === '世界'

  /**
   * ★★ 按 scope 过滤地标。判据是 `country`，不是 id 前缀、也不是坐标 ——
   *    为什么不那样判，见 `mapProjection.ts` 的 `landmarkInScope`。
   */
  const shown = useMemo(
    () => LANDMARKS.filter((l) => landmarkInScope(l.country, scope)),
    [scope],
  )

  /** 世界档的底图 path 只算一次（1800 个点，别每帧重算） */
  const worldD = useMemo(() => (isWorld ? landPath(proj) : ''), [isWorld, proj])

  /**
   * ★★ 正在飞的鸟也要按 scope 过滤 —— 否则会"飞到画布外面去"。
   *
   * 小鸟的落点可能在**另一档**（中国档里有一只飞往富士山的鸟）。
   * 拿中国 bbox 去投影富士山（lng 138.7 > 135.09）→ x 超出画布右缘，
   * 而 SVG **默认不裁剪** `overflow: hidden` 才裁，普通 svg 元素会画在框外
   * 或者干脆看不见 —— 又是一个"不报错、只是没了"的形态。
   * ➜ 只画落点落在当前这一档里的鸟。
   */
  const shownIds = useMemo(() => new Set(shown.map((l) => l.id)), [shown])

  return (
    <svg
      viewBox={`0 0 ${proj.view.w} ${proj.view.h}`}
      className="h-auto w-full"
      role="img"
      aria-label={isWorld ? '世界旅行地图' : '中国旅行地图'}
    >
      <defs>
        <linearGradient id="mapLit" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#69dda7" stopOpacity="0.34" />
          <stop offset="100%" stopColor="#10a368" stopOpacity="0.22" />
        </linearGradient>
        <filter id="mapGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* 底图 —— 中国档画省界；世界档画陆地轮廓（**没有国界**，见 world-map.ts 抬头） */}
      <g className={revealed ? 'anim-fade-in' : ''}>
        {isWorld ? (
          <>
            <path d={worldD} fill={revealed ? 'url(#mapLit)' : 'rgb(18 23 20 / 0.045)'} stroke="none" />
            <path
              d={worldD}
              fill="none"
              stroke="rgb(18 23 20 / 0.16)"
              strokeWidth={0.8}
              strokeLinejoin="round"
            />
          </>
        ) : (
          <>
            {CHINA_REGIONS.map((r) => (
              <path
                key={`fill-${r.n}`}
                d={regionPath(r, proj)}
                fill={revealed ? 'url(#mapLit)' : 'rgb(18 23 20 / 0.045)'}
                stroke="none"
              />
            ))}
            {CHINA_REGIONS.map((r) => (
              <path
                key={`line-${r.n}`}
                d={regionPath(r, proj)}
                fill="none"
                stroke="rgb(18 23 20 / 0.16)"
                strokeWidth={0.8}
                strokeLinejoin="round"
              />
            ))}
          </>
        )}
      </g>

      {/*
        南海诸岛附图 —— 按制图规范单独框出，不与主图混排。

        ★★ **只有中国档画，世界档绝不画**。
          它锚在画布右下角（`w-96, h-108`）。世界档那条横带只有
          约 270 高，这个框会直接压在**南太平洋**上 ——
          一张世界图里飘出一个"南海诸岛"的框，是**错标**，
          比不画严重得多。合规要点在"中国地图上南海诸岛必须出现"，
          而世界图不承担这个职责（详见 assets/world-map.ts 抬头）。
      */}
      {!isWorld && (
        <g transform={`translate(${proj.view.w - 96} ${proj.view.h - 108})`}>
          <rect
            x="0"
            y="0"
            width="82"
            height="94"
            rx="4"
            fill="rgb(255 255 255 / 0.5)"
            stroke="rgb(18 23 20 / 0.16)"
            strokeWidth={0.8}
          />
          {/* 简化的南海诸岛示意：若干小点，不表示具体岛礁位置 */}
          {[
            [22, 30], [34, 44], [46, 34], [58, 52], [30, 62], [48, 68], [62, 26], [40, 20],
            [24, 78], [54, 80],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={1.6} fill="rgb(18 23 20 / 0.28)" />
          ))}
          <text x="41" y="90" textAnchor="middle" fontSize="7" fill="rgb(18 23 20 / 0.42)">
            南海诸岛
          </text>
        </g>
      )}

      {/* 正在飞的鸟：从地标点向外画一条虚线，鸟挂在半途摆动 */}
      {flyingBirds.map((b) => {
        const dest = b.destinationId ? landmarkById(b.destinationId) : undefined
        if (!dest) return null
        /* 落点在另一档 → 这张图上不画（否则会被投影到画布外，静默消失） */
        if (!shownIds.has(dest.id)) return null
        const x = proj.x(dest.lng)
        const y = proj.y(dest.lat)
        return (
          <g key={`fly-${b.species}`} filter="url(#mapGlow)">
            <circle cx={x} cy={y} r="9" fill="none" stroke="rgb(254 187 50 / 0.5)" strokeWidth="0.9" strokeDasharray="2 3" />
            <g className="anim-dangle" style={{ transformOrigin: `${x}px ${y - 14}px` }}>
              <path
                d={`M${x} ${y - 20} l-4.5 -6 l9 0 Z`}
                fill="#febb32"
              />
            </g>
          </g>
        )
      })}

      {/* 地标点 */}
      {shown.map((l) => {
        /*
          落点优先用内容包钉的坐标（更准），没有就用地标自己的。
          这就是「小鸟落在哪儿」——不用另外给地图图片，
          坐标本来就在数据里。
        */
        const x = proj.x(l.lng)
        const y = proj.y(l.lat)
        const stage = stageOf.get(l.id) ?? 0
        const isVisited = visitedIds.has(l.id)
        const isLit = isVisited || stage > 0
        const active = activeLandmarkId === l.id
        const r = stage >= 3 ? 6 : stage === 2 ? 5 : stage === 1 ? 4 : 3.2

        /*
          ★ 没点亮的一颗都不画。
          以前是画成半透明灰点（fill #9ca3af / opacity .5）当"没去过"的占位；
          地标库从 35 条涨到 265 条之后，没去过的有 230 个 →
          整屏灰点，家长报「地图上出现了一堆黑圈，像是坏了」。
          去过的地方本来就会自己亮起来，所以地图仍然是"随孩子走过而长大"。
          ⚠️ 例外：正在被选中的那颗照画 —— 它可能来自小鸟的落点，
             不一定是去过的，藏起来会变成"选中了却看不见"。
        */
        if (!isLit && !active) return null

        return (
          <g
            key={l.id}
            className="cursor-pointer"
            onClick={() => {
              playSound('tap-soft')
              tapFeedback()
              onPickLandmark(l)
            }}
          >
            {/* 命中区域，手指也点得中 */}
            <circle cx={x} cy={y} r="13" fill="transparent" />

            <circle
              cx={x}
              cy={y}
              r={r + 5}
              fill="#29ce89"
              opacity="0.2"
              className="anim-pulse-ring"
              style={{ transformOrigin: `${x}px ${y}px` }}
            />

            {/* v6：到过的地方套一圈金环 */}
            {isVisited && (
              <circle
                cx={x}
                cy={y}
                r={r + 3.6}
                fill="none"
                stroke="#febb32"
                strokeWidth="1.6"
              />
            )}

            {active && (
              <circle cx={x} cy={y} r={r + 6} fill="none" stroke="#febb32" strokeWidth="1.4" />
            )}

            <circle cx={x} cy={y} r={r} fill="#29ce89" stroke="#10a368" strokeWidth={1} />
            {stage >= 2 && (
              <circle cx={x} cy={y} r={r * 0.42} fill="#eef6f1" opacity="0.9" />
            )}

            {/* 有种子发芽的地方挂一个小树苗角标 */}
            {stage > 0 && (
              <g transform={`translate(${x + 4.5} ${y - 12})`} pointerEvents="none">
                <rect
                  x="0"
                  y="0"
                  width="11"
                  height="9"
                  rx="1.6"
                  fill="#29ce89"
                  stroke="#fff"
                  strokeWidth="0.9"
                />
                <path d="M5.5 2 L5.5 7 M3.5 4.5 L5.5 2.5 L7.5 4.5" fill="none" stroke="#fff" strokeWidth="1" />
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/* ============================================================
   三、画出来的风景与小鸟
   ============================================================ */

/**
 * 地标风景 —— 用地标自带的配色 + 几条路径现画一张极简插画。
 *
 * 全项目**没有一张内置图片文件**，所以这张插画同时承担两个职责：
 *   1. 地标详情抽屉的头图；
 *   2. **真实照片加载不出来时的兜底**（离线、图床挂了、地址写错）。
 *
 * 第 2 条不是"以防万一"——App 是离线优先的，而内容包里的照片
 * 全是外部地址。没有这个兜底，相册里就会出现一个破图标或者白框。
 */
function LandscapeArt({
  landmark,
  className = '',
}: {
  landmark: Landmark
  className?: string
}) {
  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ background: landmark.palette[0] }}
    >
      <div
        className="absolute inset-x-0 bottom-0"
        style={{ height: '58%', background: landmark.palette[1] }}
      />
      <svg
        viewBox="0 0 300 140"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        {landmark.scene === 'mountain' && (
          <path d="M0 100 L60 46 L104 88 L150 34 L206 96 L250 58 L300 100 Z" fill="rgb(0 0 0 / 0.14)" />
        )}
        {landmark.scene === 'water' && (
          <>
            <path d="M0 92 L50 60 L96 92 Z" fill="rgb(0 0 0 / 0.12)" />
            <rect y="98" width="300" height="42" fill="rgb(255 255 255 / 0.32)" />
            <path d="M0 108 h300 M0 120 h300" stroke="rgb(0 0 0 / 0.09)" strokeWidth="1" />
          </>
        )}
        {landmark.scene === 'city' && (
          <>
            <rect x="24" y="52" width="26" height="66" fill="rgb(0 0 0 / 0.16)" />
            <rect x="58" y="34" width="22" height="84" fill="rgb(0 0 0 / 0.22)" />
            <rect x="88" y="62" width="34" height="56" fill="rgb(0 0 0 / 0.13)" />
            <rect x="132" y="42" width="24" height="76" fill="rgb(0 0 0 / 0.2)" />
            <rect x="168" y="70" width="30" height="48" fill="rgb(0 0 0 / 0.12)" />
            <rect x="210" y="50" width="22" height="68" fill="rgb(0 0 0 / 0.18)" />
          </>
        )}
        {landmark.scene === 'temple' && (
          <>
            <path d="M60 84 L150 44 L240 84 Z" fill="rgb(0 0 0 / 0.2)" />
            <rect x="86" y="84" width="128" height="34" fill="rgb(0 0 0 / 0.15)" />
            <path d="M46 88 L150 38 L254 88" fill="none" stroke="rgb(0 0 0 / 0.24)" strokeWidth="3" />
          </>
        )}
        {landmark.scene === 'desert' && (
          <>
            <path d="M0 110 Q70 72 140 104 Q210 132 300 96 L300 140 L0 140 Z" fill="rgb(0 0 0 / 0.12)" />
            <path d="M0 120 Q90 96 180 118 Q240 132 300 118" fill="none" stroke="rgb(0 0 0 / 0.1)" strokeWidth="1.5" />
          </>
        )}
        {landmark.scene === 'grass' && (
          <>
            <path d="M0 104 Q80 88 150 100 Q230 112 300 98 L300 140 L0 140 Z" fill="rgb(0 0 0 / 0.11)" />
            <ellipse cx="70" cy="106" rx="11" ry="5" fill="rgb(255 255 255 / 0.5)" />
            <ellipse cx="206" cy="102" rx="9" ry="4" fill="rgb(255 255 255 / 0.45)" />
          </>
        )}
        {landmark.scene === 'forest' && (
          <>
            {[30, 78, 126, 174, 222, 268].map((x, i) => (
              <path key={i} d={`M${x} 118 L${x + 17} 60 L${x + 34} 118 Z`} fill="rgb(0 0 0 / 0.18)" />
            ))}
          </>
        )}
        {landmark.scene === 'snow' && (
          <>
            <path d="M0 106 L54 50 L104 96 L154 40 L212 100 L262 56 L300 102 Z" fill="rgb(255 255 255 / 0.72)" />
            <path d="M0 118 L60 84 L120 114 L180 80 L240 112 L300 86 L300 140 L0 140 Z" fill="rgb(255 255 255 / 0.9)" />
          </>
        )}
        {landmark.scene === 'coast' && (
          <>
            <rect y="88" width="300" height="52" fill="rgb(255 255 255 / 0.35)" />
            <path d="M0 100 q40 -10 80 0 t80 0 t80 0 t60 0" fill="none" stroke="rgb(0 0 0 / 0.12)" strokeWidth="1.5" />
            <ellipse cx="234" cy="66" rx="16" ry="6" fill="rgb(0 0 0 / 0.1)" />
          </>
        )}
        {landmark.scene === 'cave' && (
          <>
            <path d="M0 30 Q40 62 80 30 Q120 66 160 30 Q200 62 240 30 Q272 60 300 34 L300 0 L0 0 Z" fill="rgb(0 0 0 / 0.3)" />
            <circle cx="150" cy="98" r="26" fill="rgb(255 255 255 / 0.22)" />
          </>
        )}
        <circle cx="252" cy="34" r="13" fill="rgb(255 255 255 / 0.6)" />
      </svg>
    </div>
  )
}

/**
 * 一张旅行照。
 *
 * 优先显示内容包里的真实照片（外链）；只要加载失败一次，
 * 就永久退回程序化插画 —— 相册里绝不能出现破图标或者白框。
 *
 * 为什么要 `referrerPolicy="no-referrer"`：图床（Unsplash 等）
 * 有时会对带 referrer 的请求限流，离线包里的地址尤其容易踩到。
 *
 * 相册和地标抽屉共用这一个组件，两条路径的兜底行为必须一致。
 */
function TravelPhotoFrame({
  url,
  alt,
  landmark,
  className = 'aspect-[16/10] w-full',
}: {
  url?: string
  alt: string
  landmark?: Landmark
  className?: string
}) {
  const [failed, setFailed] = useState(false)

  if (url && !failed) {
    return (
      <div className={`relative overflow-hidden bg-ink-100 ${className}`}>
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      </div>
    )
  }

  if (landmark) {
    return (
      <div className={`relative overflow-hidden ${className}`}>
        <LandscapeArt landmark={landmark} className="h-full w-full" />
      </div>
    )
  }

  return <div className={`bg-ink-100 ${className}`} />
}

/** 用参数化 SVG 画一只鸟 —— 全项目没有一张图片文件 */
function BirdGlyph({
  species,
  size = 44,
  flying,
}: {
  species: string
  size?: number
  flying?: boolean
}) {
  const sp = speciesById(species as never)
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <ellipse cx="24" cy="29" rx="11" ry="9.5" fill={sp.color} />
      <path
        d="M14 27 Q7 24 12 20 Q18 22 22 25 Z"
        fill={sp.color2}
        className={flying ? 'anim-flap' : ''}
        style={{ transformOrigin: '20px 26px' }}
      />
      <path
        d="M33 27 Q40 24 35 20 Q29 22 25 25 Z"
        fill={sp.color2}
        className={flying ? 'anim-flap' : ''}
        style={{ transformOrigin: '28px 26px' }}
      />
      <circle cx="29" cy="19" r="7" fill={sp.color} />
      <circle cx="31" cy="18" r="1.5" fill="#1a201c" />
      <path d="M35 19.5 l6 1.6 l-6 1.6 Z" fill="#febb32" />
      <path d="M24 38 l-3.5 5 M24 38 l3.5 5" stroke="#febb32" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function BirdRow({
  bird,
  onClick,
  onAct,
}: {
  bird: Bird
  onClick: () => void
  onAct?: () => void
}) {
  const sp = speciesById(bird.species)
  const away = bird.status === 'away'
  const canAct = !away || birdReady(bird, Date.now())
  return (
    <div className="flex items-center gap-2 rounded-card surface p-2.5 shadow-[var(--hair)]">
      <button
        type="button"
        onClick={() => {
          playSound('tap-soft')
          tapFeedback()
          onClick()
        }}
        className="btn-base active:btn-press flex min-w-0 flex-1 items-center gap-3 rounded-md text-left"
      >
        <BirdGlyph species={bird.species} flying={away} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-display text-sm font-bold text-ink-900">
              {bird.nickname}
            </span>
            {bird.hasLetter && (
              <span className="text-amber-leaf-500">
                <IconEnvelopeOpen size={13} />
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-2xs text-ink-500">
            {away
              ? birdReady(bird, Date.now())
                ? `从${bird.destinationId ? landmarkById(bird.destinationId)?.name ?? '远方' : '远方'}飞回来了`
                : `正在飞往 ${bird.destinationId ? landmarkById(bird.destinationId)?.name ?? '远方' : '远方'}…`
              : bird.trips > 0
                ? `${bondLabel(bird.bond)} · 出行 ${bird.trips} 次 · 拍了 ${bird.photos} 张`
                : sp.persona}
          </span>
        </span>
      </button>
      {onAct && canAct && (
        <Button
          size="sm"
          tone={away ? 'reward' : 'primary'}
          icon={away ? <IconGift size={13} /> : <IconRoute size={13} />}
          onClick={onAct}
        >
          {away ? '收鸟' : '出发'}
        </Button>
      )}
      {onAct && !canAct && <Badge tone="amber">在外</Badge>}
    </div>
  )
}

/* ============================================================
   四、地标详情抽屉
   ============================================================ */

function LandmarkSheet({
  landmark,
  stage,
  contents,
  collected,
  distanceKm,
  onClose,
  canSend,
  sending,
  onSend,
}: {
  landmark: Landmark | null
  stage: number
  /**
   * 这个景点的**全部**内容（可能好几条 = 好几张图）。
   *
   * ⚠️ 是数组，不是单条 —— 只传一条就等于把这个景点的其余照片藏了。
   */
  contents: TravelContent[]
  /** 小鸟是不是**真的**带回过内容 */
  collected: boolean
  distanceKm?: number
  onClose: () => void
  /** 有在家的鸟才能派出去 */
  canSend: boolean
  sending: boolean
  onSend: (landmarkId: string) => void
}) {
  /**
   * 正在看第几张图。
   *
   * ⚠️ 这个 `useState` 必须在 `if (!landmark) return null` **之前** ——
   *    放到后面就是"有时调用有时不调用"，React 会直接报 hook 顺序错。
   * ⚠️ 换地标时靠调用方的 `key={landmark.id}` 重挂载来重置；
   *    这里再 clamp 一次兜底（内容条数比下标少时不能越界）。
   */
  const [wantIdx, setWantIdx] = useState(0)
  if (!landmark) return null

  const idx = Math.min(wantIdx, Math.max(0, contents.length - 1))
  const current = contents[idx]
  const gm = gradeMeta(current?.grade)
  const hasContent = contents.length > 0

  return (
    <Sheet open onClose={onClose} title={landmark.name}>
      <div className="flex flex-col gap-3">
        {/*
          照片一进来就显示。

          它和散文的待遇**故意不一样**：
            · 照片 =「这个地方长什么样」的预告 —— 看得见才想派鸟过去；
              而且加了内容立刻能核对，不用真等一趟 25 分钟的飞行。
            · 散文 = 小鸟自己写的游记，只有真去过才给（见下面 collected 分支）。
          地图上的金环和相册里的记录，也仍然只认「真的带回来过」。
        */}
        <div className="relative">
          <TravelPhotoFrame
            url={current?.mediaUrl}
            alt={current ? `${current.place}的照片` : `${landmark.name}的风景`}
            landmark={landmark}
            className="h-36 w-full rounded-card"
          />
          <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
            {/*
              ★ 「评级」= 国家 A 级旅游景区等级（5A / 4A），来自官方名录
                （`scripts/gd-a-level.json`，生成侧写在 `landmark.rating`）。

              ⚠️ 只有**景区**才有评级 —— 山峰、海滩、步行街、古村本来就不是景区，
                 所以没评级时**不要**显示「暂无评级」：那会让孩子以为
                 "这个地方不好"，而它可能只是**不是景区**而已。
              ⚠️ 兜底显示 `Tier`：那是旧玩法的稀有度，生成侧一律缺省 1。
                 等 `tier` 彻底退役了，这个兜底也应该一起删（见 MEMORY §十五）。
            */}
            {landmark.rating ? (
              <Badge tone="amber">{landmark.rating} 景区</Badge>
            ) : (
              <Badge tone="neutral">Tier {landmark.tier}</Badge>
            )}
            {stage > 0 && <Badge tone="leaf">已点亮 · {stage} 级</Badge>}
          </div>

          {/*
            ★ 等级角标 —— 顺路 / 驻足 / 奇遇 / 绝景 / 传世。
            ⚠️ 这是**人标上去的**，不是掉落的稀有度（家长 09-24 定的：
               等级只做标注）。所以文案说「这张」而不是「抽到」。
            ⚠️ 颜色走内联 style，不走 class —— 等级色是数据，不是主题色，
               写在 class 里就得为五档各配一条 CSS，加第六档时会漏。
          */}
          {current && (
            <span
              className="absolute bottom-3 right-3 rounded-full px-2.5 py-1 text-2xs font-bold text-white shadow-sm"
              style={{ background: gm.color }}
            >
              {gm.key}
            </span>
          )}
        </div>

        {/*
          ★★ 多图：一个景点有好几张内容时，给一条可点的缩略条。
          ⚠️ 只有 1 条时不画 —— 一条的"相册"没有意义，
             而且会让孩子以为"是不是还有别的我没看到"。
        */}
        {contents.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-2xs text-ink-500">
              这个景点有 <span className="tnum font-bold text-ink-700">{contents.length}</span> 张
            </span>
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
              {contents.map((c, i) => {
                const g = gradeMeta(c.grade)
                const on = i === idx
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      playSound('tap-soft')
                      tapFeedback()
                      setWantIdx(i)
                    }}
                    aria-pressed={on}
                    title={c.title}
                    className={`btn-base active:btn-press relative h-14 w-14 shrink-0 overflow-hidden rounded-md ${
                      on ? 'ring-2 ring-ink-900' : 'ring-1 ring-ink-900/10'
                    }`}
                  >
                    {/* 缩略图用整张图铺满；没有图（笑话/格言）就用等级色垫底 */}
                    {c.mediaUrl ? (
                      <img
                        src={c.mediaUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                        onError={(e) => {
                          // 外链图挂掉是常态（离线、图床挂了）—— 藏掉 img，
                          // 露出底下那层等级色，而不是留一个破图标
                          e.currentTarget.style.display = 'none'
                        }}
                      />
                    ) : null}
                    <span
                      className="absolute inset-0 -z-10"
                      style={{ background: g.color, opacity: 0.22 }}
                    />
                    {/* 等级色条 —— 缩略图上也要能一眼看出等级 */}
                    <span
                      className="absolute inset-x-0 bottom-0 h-1"
                      style={{ background: g.color }}
                    />
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <IconMapOutline size={15} className="text-ink-400" />
          <span className="text-xs text-ink-500">{landmark.province}</span>
          {hasContent && distanceKm !== undefined && (
            <span className="inline-flex items-center gap-1 text-2xs text-amber-leaf-600">
              <IconRoute size={11} />
              飞了 {distanceKm} 公里
            </span>
          )}
        </div>

        {/*
          ★★ 公共简介优先，没有就退回那句 `blurb`（09-26）。
             `blurb` 是**数据源给的一句话**（8~29 字），`intro` 是**人写的公共简介**
             （≤`LANDMARK_INTRO_MAX`，见 `types.ts`）。两者是"有更好的就用更好的"，
             不是二选一。
             ⚠️ 09-27 起全库 643 条**都**写了简介（见 `data/landmark-intros.json`），
                所以兜底那句现在只在"新进来的地标还没写简介"时才用得上。
                **但 `|| blurb` 不能删** —— `intro` 是可选字段，新地标一定是空的；
                而且 `blurb` 是**模板**（按 `scene` 从 17 句里挑，会事实出错），
                所以它只能当兜底，**不能反过来当成"简介"显示**。
             ⚠️ 判空用 `||` 不用 `??`：编辑器里清空后可能留下空串 `''`，
                 用 `??` 的话空串会通过，这段就渲染成一片空白（跟"忘了写"看不出来）。
        */}
        <p className="font-prose text-sm leading-loose text-ink-700">
          {landmark.intro || landmark.blurb}
        </p>

        {/* 有内容：说清「拿到了没有」；没有内容：只说发芽 */}
        {hasContent ? (
          collected ? (
            <div className="flex flex-col gap-1 rounded-md bg-amber-leaf-50 px-3.5 py-2.5 shadow-[var(--hair-amber)]">
              <span className="flex items-center gap-1.5 text-xs font-bold text-amber-leaf-700">
                <IconPhoto size={13} />
                小鸟在这里带回过照片
              </span>
              <span className="text-2xs leading-relaxed text-amber-leaf-700">
                {current?.summary}完整的照片和散文收在「相册」里。
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-1 rounded-md bg-ink-50 px-3.5 py-2.5">
              <span className="flex items-center gap-1.5 text-xs font-bold text-ink-700">
                <IconPhoto size={13} />
                {contents.length > 1
                  ? `这里有 ${contents.length} 张照片等着小鸟去拍`
                  : '这里有一张照片等着小鸟去拍'}
              </span>
              <span className="text-2xs leading-relaxed text-ink-500">
                派一只小鸟飞过去，它会带回一张照片，还有一篇它自己写的游记。
              </span>
            </div>
          )
        ) : (
          stage === 0 && (
            <p className="rounded-md bg-ink-50 px-3.5 py-2.5 text-xs leading-relaxed text-ink-500">
              这里还没有发芽。让小鸟飞过去一趟，种子就会留在这里。
            </p>
          )
        )}

        {/* 派鸟 —— 让"想去哪儿"变成一次真实的点击 */}
        {canSend ? (
          <Button
            full
            tone="primary"
            size="lg"
            icon={<IconMapPin size={16} />}
            disabled={sending}
            onClick={() => onSend(landmark.id)}
          >
            {stage > 0 ? '再派一只去这里' : '派一只小鸟去这里'}
          </Button>
        ) : (
          <p className="rounded-md bg-amber-leaf-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-leaf-700 shadow-[var(--hair-amber)]">
            树上的小鸟都出门了。等它们飞回来，就能再派一只。
          </p>
        )}
      </div>
    </Sheet>
  )
}

/* ============================================================
   五、背包（v6 纪念品）
   ============================================================ */

/** 格式化倒计时 */
function formatCountdown(ms: number): string {
  if (ms <= 0) return '已过期'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  if (h > 0) return `${h}小时${m}分钟后消失`
  return `${m}分钟后消失`
}

/** 类型 → 中文标签 */
function typeLabel(type: string): string {
  return type === 'photo' ? '照片'
    : type === 'music' ? '音乐'
    : type === 'video' ? '视频'
    : type === 'joke' ? '笑话'
    : type === 'quote' ? '格言'
    : '故事'
}

/** 音频播放器 —— 简单的 controls */
function AudioPlayer({ url }: { url: string }) {
  return (
    <div className="bg-ink-50 p-3 rounded-card">
      <audio controls className="w-full" preload="metadata">
        <source src={url} />
        你的浏览器不支持音频播放
      </audio>
    </div>
  )
}

/** 视频播放器 */
function VideoPlayer({ url }: { url: string }) {
  return (
    <div className="bg-ink-900 rounded-card overflow-hidden">
      <video controls className="w-full max-h-64" preload="metadata">
        <source src={url} />
        你的浏览器不支持视频播放
      </video>
    </div>
  )
}

/** 格言卡片 —— 引用样式 */
function QuoteCard({ text }: { text: string }) {
  const lines = text.split('\n')
  const lastLine = lines[lines.length - 1]
  const isAttribution = lastLine.startsWith('——')
  const quoteLines = isAttribution ? lines.slice(0, -1) : lines
  const attribution = isAttribution ? lastLine.replace(/^——\s*/, '') : null

  return (
    <div className="flex flex-col gap-2 border-l-[3px] border-amber-leaf-400 pl-3.5 py-1">
      {quoteLines.map((line, i) => (
        <p key={i} className="font-prose text-sm leading-loose text-ink-800 italic">
          {line}
        </p>
      ))}
      {attribution && (
        <span className="text-2xs text-ink-500 not-italic">—— {attribution}</span>
      )}
    </div>
  )
}

/** 笑话卡片 —— 轻松样式 */
function JokeCard({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2">
      {text.split('\n\n').map((para, i) => (
        <p key={i} className="font-prose text-sm leading-loose text-ink-700">
          {para}
        </p>
      ))}
    </div>
  )
}

/** 纪念品卡片 —— 阅后即毁
 *
 *  ★ 导出是为了**能在单元测试里真的渲染它**（见 `SouvenirCard.test.tsx`）。
 *    相册里的「示意图」角标是**界面有没有在撒谎**的地方，
 *    只断言数据层（`souvenir.match`）不够 —— 那证明不了界面会去读它。
 */
export function SouvenirCard({
  souvenir,
  coins,
  onKeep,
}: {
  souvenir: TravelSouvenir
  coins: number
  onKeep: () => void
}) {
  const now = Date.now()
  const remaining = souvenir.expiresAt - now
  const expired = remaining <= 0 && !souvenir.kept
  const canKeep = !souvenir.kept && coins >= souvenir.keepCost

  return (
    <InkCard padded={false} className="overflow-hidden">
      {/* 媒体区：照片 / 音乐 / 视频 */}
      {souvenir.type === 'photo' && souvenir.mediaUrl && (
        <TravelPhotoFrame
          url={souvenir.mediaUrl}
          alt={`${souvenir.place}的照片`}
        />
      )}
      {souvenir.type === 'music' && souvenir.mediaUrl && (
        <div className="p-3">
          <AudioPlayer url={souvenir.mediaUrl} />
        </div>
      )}
      {souvenir.type === 'video' && souvenir.mediaUrl && (
        <div className="p-3">
          <VideoPlayer url={souvenir.mediaUrl} />
        </div>
      )}

      <div className="flex flex-col gap-2.5 p-3.5">
        {/* 标题行 */}
        <h3 className="font-display text-sm font-bold text-ink-900">
          {souvenir.title}
        </h3>

        {/* 标签行 */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <Badge tone={souvenir.kept ? 'leaf' : 'amber'}>
            {souvenir.kept ? '已保留' : typeLabel(souvenir.type)}
          </Badge>
          {/*
            ★ 「示意图」= 这张不是那个地方本人的样子（`match === 'scene'`）。

            ⚠️⚠️ **只认 `=== 'scene'`**。家长手挑的图**不写** `match`，
               那是"没声称过"，不是"顶替图" —— 把 `undefined` 也标出来
               等于替他声称了一件他没说过的事（见 `TravelContent.match`）。
          */}
          {souvenir.match === 'scene' && <Badge tone="mist">示意图</Badge>}
          {souvenir.distanceKm > 0 && (
            <span className="inline-flex items-center gap-1 rounded-pill bg-white/10 px-2 py-0.5 text-[10px] font-bold text-[var(--color-night-text-2)]">
              <IconRoute size={11} />
              飞了 {souvenir.distanceKm} 公里
            </span>
          )}
          <span className="text-2xs text-[var(--color-night-text-3)]">
            {new Date(souvenir.at).toLocaleDateString('zh-CN')}
          </span>
        </div>

        {/* 倒计时 */}
        {!souvenir.kept && (
          <div className="flex items-center gap-1.5 text-xs text-amber-leaf-600">
            <IconClock size={13} />
            {expired ? '已过期' : formatCountdown(remaining)}
          </div>
        )}

        {/* 内容区 —— 按类型不同样式 */}
        {souvenir.type === 'quote' && souvenir.textContent ? (
          <QuoteCard text={souvenir.textContent} />
        ) : souvenir.type === 'joke' && souvenir.textContent ? (
          <JokeCard text={souvenir.textContent} />
        ) : souvenir.type === 'story' && souvenir.textContent ? (
          <div className="flex flex-col gap-2">
            {souvenir.textContent.split('\n\n').map((para, i) => (
              <p key={i} className="font-prose text-sm leading-loose text-ink-700">
                {para}
              </p>
            ))}
          </div>
        ) : souvenir.essay ? (
          <div className="flex flex-col gap-2">
            {souvenir.essay.split('\n\n').map((para, i) => (
              <p key={i} className="font-prose text-sm leading-loose text-ink-700">
                {para}
              </p>
            ))}
          </div>
        ) : null}

        {/* 保留按钮 */}
        {!souvenir.kept && !expired && (
          <Button
            size="sm"
            tone="primary"
            disabled={!canKeep}
            onClick={onKeep}
          >
            {canKeep ? `${souvenir.keepCost} 金币永久保留` : '金币不够'}
          </Button>
        )}
      </div>
    </InkCard>
  )
}

/**
 * 稳定的空数组。
 *
 * 不要在 selector 里写 `?? []` —— 每次求值都会新建一个数组，
 * 引用一变，zustand 就认为状态变了，直接无限重渲染。
 */
const EMPTY_SPROUTS: Sprout[] = []
const EMPTY_BIRDS: Bird[] = []
const EMPTY_PHOTOS: TravelPhoto[] = []
const EMPTY_SOUVENIRS: TravelSouvenir[] = []
const EMPTY_VISITED: VisitedLandmark[] = []

/* ============================================================
   六、页面本体
   ============================================================ */

export default function MapPage() {
  const levelIndex = useApp((s) => s.level.levelIndex)
  const toast = useApp((s) => s.toast)
  /**
   * 距离基准点。没设置过就是 undefined —— 那时候 domain 会退回默认值（深圳）。
   * 这里不兜底、不判空，把「拿不到用什么」这条规则**只留在 domain 一处**。
   */
  const homePoint = useApp((s) => s.settings.homePoint)

  /**
   * ⚠️ 这里读的是「旅行进度」的三块数据。
   * 它们目前挂在 meta 上（见 db.ts）；为了让这一页先跑起来，
   * 用可选链兼容"还没有这些字段"的旧存档。
   *
   * ⚠️ 兜底必须用**模块级常量**，不能在 selector 里现写 `?? []`：
   * 每次返回一个新数组 = 每次都是新引用 = 无限重渲染（React error #185）。
   */
  const sprouts = useApp((s) => (s as unknown as { sprouts?: Sprout[] }).sprouts ?? EMPTY_SPROUTS)
  const birds = useApp((s) => (s as unknown as { birds?: Bird[] }).birds ?? EMPTY_BIRDS)
  const photos = useApp((s) => (s as unknown as { photos?: TravelPhoto[] }).photos ?? EMPTY_PHOTOS)
  const souvenirs = useApp((s) => (s as unknown as { souvenirs?: TravelSouvenir[] }).souvenirs ?? EMPTY_SOUVENIRS)
  const visited = useApp((s) => (s as unknown as { visited?: VisitedLandmark[] }).visited ?? EMPTY_VISITED)

  const syncBirds = useApp((s) => s.syncBirds)
  const dispatchBird = useApp((s) => s.dispatchBird)
  const settleBird = useApp((s) => s.settleBird)
  const keepSouvenir = useApp((s) => s.keepSouvenir)
  const recruitBird = useApp((s) => s.recruitBird)
  const coins = useApp((s) => s.wallet.coins)

  /**
   * 可以招募的鸟 = 段位已解锁 且 还没有 且 不是免费的（麻雀已经自动来了）。
   * 这是金币的第一个出口。
   */
  const recruitable = useMemo(
    () =>
      BIRD_SPECIES.filter(
        (s) =>
          s.unlockLevel <= levelIndex &&
          recruitCost(s.id) > 0 &&
          !birds.some((b) => b.species === s.id),
      ),
    [levelIndex, birds],
  )

  /** 花金币招募一只鸟 */
  const recruit = useCallback(
    async (species: (typeof BIRD_SPECIES)[number]) => {
      const got = await recruitBird(species)
      if (!got) {
        toast({
          kind: 'warn',
          title: '金币还不够',
          detail: `招募「${species.name}」需要 ${recruitCost(species.id)} 金币。多写一篇作文就有了。`,
        })
        return
      }
      playSound('coin')
      celebrateFeedback()
    },
    [recruitBird, toast],
  )

  const [picked, setPicked] = useState<Landmark | null>(null)
  const [tab, setTab] = useState<'map' | 'album' | 'birds'>('map')
  /**
   * 地图看哪一档。
   *
   * ⚠️ 存成**本地 state**，没进 settings —— 进 settings 就要配迁移
   *    （默认值改了老存档不跟着走，见 MEMORY §五），而这一项
   *    没有"记住"的必要：默认看中国，切到世界是一次主动动作。
   */
  const [scope, setScope] = useState<MapScope>('中国')
  /** 正在派鸟 / 收鸟 —— 防止连点重复结算 */
  const [busy, setBusy] = useState(false)
  const mountRef = useRef(false)

  /** 每次进来先把"该解锁的鸟"补上（升级后第一次进这一页） */
  useEffect(() => {
    void syncBirds(levelIndex)
  }, [syncBirds, levelIndex])

  /**
   * 派一只在家的鸟去某个地标。
   * 优先派从没出过门的 —— 让它先认认路，亲密度涨得快。
   */
  const sendTo = useCallback(
    async (landmarkId: string) => {
      if (busy) return
      const candidates = homeBirds(useApp.getState().birds)
      if (candidates.length === 0) {
        toast({ kind: 'info', title: '没有在家的鸟', detail: '等出门的那几只飞回来吧。' })
        return
      }
      const chosen = [...candidates].sort((a, b) => a.trips - b.trips)[0]
      setBusy(true)
      playSound('tap')
      const sent = await dispatchBird(chosen.species, landmarkId)
      setBusy(false)
      if (!sent) {
        toast({ kind: 'warn', title: '没能出发', detail: '再试一次看看。' })
        return
      }
      const lm = landmarkById(landmarkId)
      toast({
        kind: 'info',
        title: `${sent.nickname} 出发了`,
        detail: `飞往${lm?.name ?? '远方'}，要飞 ${Math.max(1, Math.round(((sent.returnsAt ?? Date.now()) - Date.now()) / 3600000))} 小时才回得来。`,
      })
    },
    [busy, dispatchBird, toast],
  )

  /** 收鸟：结算照片、种子、金币 */
  const collect = useCallback(
    async (species: Bird['species']) => {
      if (busy) return
      setBusy(true)
      playSound('coin')
      const res = await settleBird(species)
      setBusy(false)
      if (!res) {
        toast({ kind: 'info', title: '还没回来', detail: '再等一会儿。' })
        return
      }
      const bits: string[] = []
      if (res.souvenir) bits.push(`一条${res.souvenir.title}`)
      if (res.seed) bits.push('一颗种子')
      if (res.coins > 0) bits.push(`${res.coins} 金币`)
      toast({
        kind: 'reward',
        title: `${res.bird.nickname} 回来了`,
        detail: bits.length > 0 ? `带回了 ${bits.join('、')}。` : '它出去转了一圈，什么也没找到。',
      })
    },
    [busy, settleBird, toast],
  )

  /** 入场时给地图一个"展开"的动画 */
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    if (mountRef.current) return
    mountRef.current = true
    const t = window.setTimeout(() => setRevealed(true), 60)
    return () => window.clearTimeout(t)
  }, [])

  const meta = levelAt(levelIndex)
  const progress = useMemo(() => mapProgress(sprouts), [sprouts])

  /**
   * 有照片的地标 → 它们在地图上的落点。
   *
   * ⚠️ 关键：**只算小鸟真的带回过照片的地方**，不是「内容包里有内容的地方」。
   * 内容包从第一天起就躺在代码里，如果照它标记，地图上会提前亮出一堆
   * 金环 —— 孩子还没派鸟过去，就已经知道哪儿有照片了，探索感全没了。
   *
   * 落点优先用内容包钉的经纬度，没钉就用地标的。
   * 所以「小鸟落在哪儿」数据里本来就有，不需要额外给一张地图图片。
   */
  // v6：到过的地标 id 集合，传给地图做颜色区分
  const visitedIds = useMemo(() => {
    const set = new Set<string>()
    for (const v of visited) set.add(v.landmarkId)
    return set
  }, [visited])
  const home = useMemo(() => homeBirds(birds), [birds])
  const away = useMemo(() => awayBirds(birds), [birds])
  const nextBird = useMemo(() => nextSpeciesToUnlock(levelIndex), [levelIndex])

  const pickedStage = useMemo(() => {
    if (!picked) return 0
    return sprouts.find((s) => s.landmarkId === picked.id)?.stage ?? 0
  }, [picked, sprouts])

  /**
   * 抽屉里要展示的**全部**内容 —— 一个景点可能有好几张图。
   *
   * ★ 以前这里是 `storyFor(picked.id)`，只拿得到**一条**（v5 内容包
   *   「一个地标一条」）。现在改读 v6 内容包，一个景点几条都能拿到 ——
   *   这正是「一个景点多张图」的落点，不用另建结构。
   *
   * ⚠️ 别写成 `contentsByLandmark(id)[0]` —— 那会把其余几张静默藏起来，
   *    而界面上完全看不出"还有别的图"。
   */
  const pickedContents = useMemo(
    () => (picked ? contentsByLandmark(picked.id) : []),
    [picked],
  )

  /**
   * 抽屉里显示的距离。
   *
   * ★ 距离是**这个地点**的属性，不用等鸟真的回来 —— 所以直接从地标算。
   * ⚠️ 这里原来是「把该地标的每条内容都算一遍、取最近的」，
   *    因为同一个地标的不同条目坐标**略有差异**（八达岭两条写了两套）。
   *    2026-09-25 起坐标统一从地标派生，差异在结构上不可能再有，
   *    所以直接算地标 —— 少一次 map/min，也少一个"为什么取最近"的疑问。
   */
  const pickedDistance = useMemo(
    () => (picked ? distanceToLandmark(picked, homePoint) : undefined),
    [picked, homePoint],
  )

  /** v6：按 place 聚合纪念品，方便背包里按地方分组 */
  const souvenirsByPlace = useMemo(() => {
    const m = new Map<string, TravelSouvenir[]>()
    for (const s of souvenirs) {
      const arr = m.get(s.place) ?? []
      arr.push(s)
      m.set(s.place, arr)
    }
    return m
  }, [souvenirs])

  const hasBirds = birds.length > 0
  const hasHollow = useApp((s) => s.level.levelIndex >= 4)

  /* ---------------- 空状态：还没长出第一只鸟 ---------------- */
  if (!hasBirds && sprouts.length === 0) {
    return (
      <div className="px-4 py-6">
        <SectionTitle
          icon={<IconCompass size={17} />}
          title="旅行图"
          sub="树长大了，就会有鸟愿意来住"
        />
        <Card tone="tint" className="mt-2">
          <EmptyState
            mood="curious"
            title="还没有小鸟来"
            desc={`你现在是「${meta.name}」。长到「${levelAt(4).name}」，第一只小鸟就会落在你的树上。`}
            action={
              <div className="flex flex-col items-center gap-3">
                <ProgressBar
                  value={levelIndex}
                  max={4}
                  tone="leaf"
                  className="w-40"
                />
                <Button
                  tone="primary"
                  onClick={() => playSound('tap')}
                  className="pointer-events-none opacity-90"
                >
                  先去写一篇作文吧
                </Button>
              </div>
            }
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      {/* ---------------- 顶部：进度 ---------------- */}
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-inkleaf-100 text-inkleaf-700">
          <IconCompass size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-lg font-bold leading-tight tracking-tight text-ink-900">
            旅行图
          </h1>
          <p className="text-2xs leading-tight text-ink-500">
            小鸟替你飞出去，把树种撒到四面八方
          </p>
        </div>
      </div>

      {/* ---------------- 进度三格 ---------------- */}
      <div className="grid grid-cols-3 gap-2">
        <StatTile
          tone="leaf"
          icon={<IconSeedling size={15} />}
          value={progress.lit}
          label={`已点亮 / ${progress.total}`}
        />
        <StatTile
          tone="amber"
          icon={<IconBirdSitting size={15} />}
          value={birds.length}
          label={`只小鸟 / ${BIRD_SPECIES.length}`}
        />
        <StatTile
          tone="mist"
          icon={<IconPhoto size={15} />}
          value={photos.length}
          label="张旅行照"
        />
      </div>

      <ProgressBar value={progress.lit} max={progress.total} tone="leaf" height={6} />
      <p className="-mt-2 text-2xs text-ink-500">
        走遍 <span className="tnum font-bold text-ink-700">{progress.percent}%</span> 的中国
        {progress.percent >= 100 ? ' —— 整张地图都亮啦' : ''}
      </p>

      {/* ---------------- 分段 ---------------- */}
      <div className="flex gap-1.5">
        {(
          [
            ['map', '地图', IconMapOutline],
            ['birds', '小鸟', IconBirdSitting],
            ['album', '相册', IconPhoto],
          ] as const
        ).map(([key, label, Icon]) => {
          const on = tab === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                playSound('tap-soft')
                tapFeedback()
                setTab(key)
              }}
              className={`btn-base active:btn-press flex flex-1 items-center justify-center gap-1.5 rounded-btn py-2.5 text-xs font-bold ${
                on ? 'bg-ink-900 text-paper' : 'surface text-ink-600'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          )
        })}
      </div>

      {/* ============================================================
          地图
         ============================================================ */}
      {tab === 'map' && (
        <div className="flex flex-col gap-3">
          {/*
            中国 / 世界 切换
            ★ 两个档共用同一个 `TravelMap`，只有底图数据、窗口、画哪些地标不同。
              详见 `TravelMap` 的注释。
          */}
          <div className="flex gap-1.5">
            {(
              [
                ['中国', '中国'],
                ['世界', '世界'],
              ] as const
            ).map(([key, label]) => {
              const on = scope === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    playSound('tap-soft')
                    tapFeedback()
                    setScope(key)
                    /* 换了一张图，之前选中的点不一定在这张图上 —— 收起抽屉，
                       免得出现"抽屉里讲着富士山、图上找不到它" */
                    setPicked(null)
                  }}
                  aria-pressed={on}
                  className={`btn-base active:btn-press flex flex-1 items-center justify-center gap-1.5 rounded-btn py-2 text-xs font-bold ${
                    on ? 'bg-ink-900 text-paper' : 'surface text-ink-600'
                  }`}
                >
                  <IconCompass size={13} />
                  {label}
                </button>
              )
            })}
          </div>

          <Card padded={false} className="overflow-hidden" pad="p-2.5">
            <TravelMap
              scope={scope}
              sprouts={sprouts}
              flyingBirds={away}
              activeLandmarkId={picked?.id ?? null}
              onPickLandmark={setPicked}
              revealed={revealed}
              visitedIds={visitedIds}
            />
            {/*
              图例
              ⚠️ 这里**没有**「还没去过」那一项 —— 没点亮的地标现在整颗不画，
                 留一条图例会指向一个画不出来的东西。原因见上面「地标点」那段注释。
            */}
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 border-t border-ink-900/[0.06] px-2 pb-1 pt-2.5">
              <span className="flex items-center gap-1.5 text-2xs text-ink-500">
                <span className="h-2.5 w-2.5 rounded-full bg-inkleaf-500" /> 已发芽
              </span>
              <span className="flex items-center gap-1.5 text-2xs text-ink-500">
                <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-amber-leaf-500 bg-inkleaf-500" />{' '}
                到过的地方
              </span>
              <span className="flex items-center gap-1.5 text-2xs text-ink-500">
                <span className="h-2.5 w-2.5 rotate-45 bg-amber-leaf-400" /> 小鸟在路上
              </span>
            </div>
          </Card>

          {/* 在图上的鸟 */}
          {away.length > 0 && (
            <Card tone="reward">
              <div className="flex items-center gap-2">
                <span className="text-amber-leaf-500">
                  <IconHourglass size={15} />
                </span>
                <span className="font-display text-sm font-bold text-amber-leaf-700">
                  {away.length} 只小鸟正在路上
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-ink-600">
                {away
                  .map((b) => `${b.nickname} 去了${b.destinationId ? landmarkById(b.destinationId)?.name ?? '远方' : '远方'}`)
                  .join('；')}
              </p>
            </Card>
          )}

          {/* 下一只鸟 */}
          {nextBird && (
            <Card tone="tint" className="flex items-center gap-3">
              <BirdGlyph species={nextBird.id} size={38} />
              <div className="min-w-0 flex-1">
                <div className="font-display text-sm font-bold text-ink-900">
                  再长一级，「{nextBird.name}」就来了
                </div>
                <p className="mt-0.5 text-2xs leading-relaxed text-ink-500">{nextBird.desc}</p>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ============================================================
          小鸟
         ============================================================ */}
      {tab === 'birds' && (
        <div className="flex flex-col gap-3">
          {aviarySummary(birds.length, hasHollow, coins)}

          {home.length > 0 && (
            <div>
              <SectionTitle title="在家的" sub={`${home.length} 只`} />
              <div className="flex flex-col gap-2">
                {home.map((b) => (
                  <BirdRow
                    key={b.species}
                    bird={b}
                    onClick={() => {
                      toast({
                        kind: 'info',
                        title: b.nickname,
                        detail: `${speciesById(b.species).persona} · ${bondLabel(b.bond)}`,
                      })
                    }}
                    onAct={() => {
                      // 让它自己去一个没去过的地方 —— 地图才会铺开
                      const visited = sproutedIds(sprouts)
                      const dest = pickDestination({ exclude: visited, rng: Math.random })
                      void sendTo(dest.id)
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {away.length > 0 && (
            <div>
              <SectionTitle title="飞出去了" sub={`${away.length} 只`} tone="amber" />
              <div className="flex flex-col gap-2">
                {away.map((b) => (
                  <BirdRow
                    key={b.species}
                    bird={b}
                    onClick={() => {
                      toast({
                        kind: 'info',
                        title: `${b.nickname} 还在路上`,
                        detail: '等它回来，会带回照片和一颗种子。',
                      })
                    }}
                    onAct={() => {
                      void collect(b.species)
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 可以招募的鸟 —— 金币的第一个出口 */}
          {recruitable.length > 0 && (
            <div>
              <SectionTitle
                title="可以招募的鸟"
                tone="amber"
                sub="段位够了，再花金币就能请它来住"
              />
              <div className="flex flex-col gap-2">
                {recruitable.map((s) => {
                  const cost = recruitCost(s.id)
                  const canPay = coins >= cost
                  return (
                    <div
                      key={s.id}
                      className="flex items-center gap-3 rounded-card surface-2 p-3"
                    >
                      <BirdGlyph species={s.id} size={38} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-display text-sm font-bold text-ink-900">
                            {s.name}
                          </span>
                          <span
                            className="shrink-0 rounded-pill px-1.5 py-0.5 text-[10px] font-bold"
                            style={{
                              color: rarityMeta(s.rarity).color,
                              background: `${rarityMeta(s.rarity).color}1a`,
                            }}
                          >
                            {rarityMeta(s.rarity).label}
                          </span>
                        </div>
                        <p className="mt-0.5 line-clamp-1 text-2xs text-ink-500">
                          {s.persona}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={!canPay || busy}
                        onClick={() => void recruit(s)}
                        className={`btn-base active:btn-press shrink-0 rounded-pill px-3 py-2 text-2xs font-bold ${
                          canPay
                            ? 'bg-amber-leaf-100 text-amber-leaf-700 shadow-[var(--hair-amber)]'
                            : 'bg-ink-50 text-ink-300'
                        }`}
                      >
                        {canPay ? `${cost} 金币招募` : `还差 ${cost - coins}`}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 还没来的鸟 */}
          <div>
            <SectionTitle title="还没解锁的鸟" tone="moss" />
            <div className="grid grid-cols-2 gap-2">
              {BIRD_SPECIES.filter((s) => s.unlockLevel > levelIndex).map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2.5 rounded-card surface-2 p-2.5 opacity-55"
                >
                  <BirdGlyph species={s.id} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-display text-xs font-bold text-ink-700">
                      {s.name}
                    </div>
                    <div className="text-2xs text-ink-400">
                      {levelAt(s.unlockLevel).name}解锁 · {recruitCost(s.id)} 金币
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================
          背包（v6：纪念品，阅后即毁）
         ============================================================ */}
      {tab === 'album' && (
        <div className="flex flex-col gap-3">
          {souvenirs.length === 0 ? (
            <Card tone="tint">
              <EmptyState
                mood="happy"
                title="背包还是空的"
                desc="小鸟飞回来的时候会带回照片、音乐、故事。飞得越远，东西越稀奇。"
              />
            </Card>
          ) : (
            [...souvenirsByPlace.entries()].map(([place, list]) => {
              return (
                <div key={place}>
                  <SectionTitle
                    title={place}
                    sub={`${list.length} 件`}
                  />
                  <div className="flex flex-col gap-3">
                    {list.map((s) => (
                      <SouvenirCard
                        key={s.id}
                        souvenir={s}
                        coins={coins}
                        onKeep={() => keepSouvenir(s.id)}
                      />
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      <LandmarkSheet
        /*
          ⚠️ `key` 不能省：抽屉里「正在看第几张图」是组件内的 state，
             换一个地标时如果不重挂载，下标会**留在上一张的位置** ——
             点故宫可能一进来就显示第 2 张图，或者越界。
        */
        key={picked?.id ?? 'none'}
        landmark={picked}
        stage={pickedStage}
        /* 这个景点的**全部**内容（可能好几张图）；
           collected 只决定「散文和相册算不算拿到了」 */
        contents={pickedContents}
        collected={picked ? visitedIds.has(picked.id) : false}
        distanceKm={pickedDistance}
        canSend={home.length > 0}
        sending={busy}
        onSend={(id) => {
          setPicked(null)
          void sendTo(id)
        }}
        onClose={() => setPicked(null)}
      />
    </div>
  )
}

/* ============================================================
   七、小结卡片
   ============================================================ */

function aviarySummary(count: number, hasHollow: boolean, coins: number) {
  return (
    <Card className="flex items-center gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-amber-leaf-50 text-amber-leaf-600">
        <IconBirdSitting size={19} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-display text-sm font-bold text-ink-900">
          树上有 {count} 只小鸟
        </div>
        <p className="mt-0.5 text-2xs leading-relaxed text-ink-500">
          {/*
            ⚠️ 这里以前写的是「累计攒了 {coins} 颗种子币」——
            把金币说成了「种子币」，是孩子和家长都搞不清
            「金币 / 种子」到底是什么的直接原因。
            金币是钱（写作文赚、能招募小鸟、开卡包），种子是地图养料。
          */}
          现在有 {coins} 金币（写出来的，能招募小鸟、开文心卡包）
        </p>
      </div>
      {hasHollow && (
        <span className="text-moss-500" title="树洞已打开">
          <IconTreeHollow size={18} />
        </span>
      )}
    </Card>
  )
}

/** 供其它页面复用的成功标记 */
export function MapTick() {
  return (
    <span className="text-inkleaf-600">
      <IconCheck size={14} />
    </span>
  )
}
