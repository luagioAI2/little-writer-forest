/* ============================================================
   设置页 —— 家长和孩子的控制台
   ============================================================
   两类人看这一页，语气要同时照顾到：
     · 孩子：头像、昵称、每天写几篇，要好懂好玩
     · 家长：AI 配置、备份恢复、清空数据，要讲清楚、能放心

   最重要的一条：AI 只是帮忙看作文，绝不替孩子写。
   这句话要在配置 AI 的地方明明白白写出来。
   ============================================================ */

import { useState } from 'react'
import type { ReactElement } from 'react'
import { useApp } from '../../store/useApp'
import { Button, Badge, Card, Chip, ConfirmDialog, SectionTitle } from '../../components/ui'
import { PIN_LINK_CLASS, PinGate } from '../../components/PinPad'
import {
  IconBook,
  IconCoin,
  IconCompass,
  IconFolder,
  IconLock,
  IconMagic,
  IconMic,
  IconMoon,
  IconShield,
  IconFlame,
  IconLightbulb,
  IconTree,
  IconUser,
  IconVolume,
} from '../../components/icons'
import LibraryPage from '../library/LibraryPage'
import { SubHeader } from '../../App'
import { AI_PRESETS, DEFAULT_DEEPSEEK_MODEL, testAiConnection } from '../../domain/ai'
import {
  TRANSCRIBE_PRESETS,
  VOLC_TEST_API_KEY,
  defaultTranscribeConfig,
  openAiTranscribeConfig,
  testTranscribeConnection,
  usesStreamingEngine,
} from '../../platform/transcribe'
import { VOLC_ENDPOINTS, resolveEndpoint, testVolcConnection, type VolcEndpoint } from '../../platform/volcengine'
import { isStreamingSupported } from '../../platform/ws-transport'
import { DAILY_GOAL_MAX } from '../../domain/economy'
import { isDefaultHome, resolveHomePoint } from '../../domain/travelStories'
import { DEFAULT_CHILD_NAME, GRADE_GROUPS } from '../../domain/types'
import { exportText, pickTextFile, timestampedName } from '../../platform/files'
import { playSound, setSoundEnabled } from '../../platform/sound'

/* ---------------- 可选头像 ---------------- */
const AVATARS = [
  '🐣', '🐨', '🦊', '🐼', '🐯', '🦁', '🐰', '🐸',
  '🦄', '🐙', '🦖', '🐝', '🌻', '🌈', '⭐', '🚀',
]

const APP_VERSION = 'v1.0.0'

/* ============================================================
   小组件
   ============================================================ */

/** 药丸形开关：44px 起跳，孩子的手指也能一次点中 */
function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`btn-base active:btn-press relative h-11 w-[76px] shrink-0 rounded-pill transition ${
        on ? 'bg-inkleaf-500' : 'bg-ink-150'
      }`}
    >
      <span
        className={`absolute top-1/2 h-8 w-8 -translate-y-1/2 rounded-full bg-white shadow-[var(--hair)] transition-all duration-200 ${
          on ? 'left-[38px]' : 'left-1'
        }`}
      />
    </button>
  )
}

/** 一行设置：左边说明，右边控件 */
function Row({
  icon,
  emoji,
  title,
  desc,
  right,
}: {
  /** 优先用 icon；emoji 仅为兼容旧用法 */
  icon?: ReactElement
  emoji?: string
  title: string
  desc?: string
  right: ReactElement
}) {
  return (
    <div className="flex items-center gap-3 rounded-md bg-white px-3.5 py-3 shadow-[var(--hair)]">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-paper-2 text-ink-600">
        {icon ?? <span className="text-base leading-none">{emoji}</span>}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-ink-900">{title}</div>
        {desc && <div className="mt-0.5 text-xs text-ink-500">{desc}</div>}
      </div>
      {right}
    </div>
  )
}

/* 数字键盘 + 圆点指示器
   ------------------------------------------------------------
   ★ 2026-09-18：原来这里有一套自己的键盘（清空/确定 两键、方块图标、
     外层 `max-w-xs` 且没有卡片底），家长反馈"好窄、别扭"。
     现在统一用 `../../components/PinPad` 的 `PinGate`，
     和日记本那把锁长得一模一样。改样式请改那个文件。 */

/** 密码输入面板 */
function ParentPinPanel({
  title = '请爸爸妈妈来一下',
  hint,
  onPass,
  onCancel,
}: {
  title?: string
  hint?: string
  onPass: () => void
  onCancel?: () => void
}) {
  const settings = useApp((s) => s.settings)
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const [msg, setMsg] = useState('')

  /**
   * 键盘按下。满 4 位**自动校验** —— 所以没有「确定」键。
   *
   * ⚠️ 出错后的处理要跟日记本那把锁**逐字一致**（见 DiaryPage 的 failPin）：
   *    响一声 → 抖 520ms → 再清空。清空前让四个点保持实心，
   *    这样家长能看清"是这 4 位错了"，而不是输完就凭空消失。
   *    红字保留到下一次按键，别用定时器清 —— 会没读完就没了。
   */
  const handleKey = (k: string) => {
    if (error) return
    if (k === 'del') {
      setPin((p) => p.slice(0, -1))
      setMsg('')
      return
    }
    if (pin.length >= 4) return
    const next = pin + k
    setPin(next)
    setMsg('')
    if (next.length < 4) return

    if (next === (settings.parentPin ?? '0000')) {
      onPass()
      return
    }
    playSound('error')
    setError(true)
    setMsg('密码不对，再试一次？')
    window.setTimeout(() => {
      setError(false)
      setPin('')
    }, 520)
  }

  return (
    <PinGate
      title={title}
      hint={hint}
      filled={pin.length}
      error={error}
      message={msg}
      onKey={handleKey}
      disabled={error}
      footer={
        onCancel ? (
          <button type="button" onClick={onCancel} className={PIN_LINK_CLASS}>
            先算了
          </button>
        ) : undefined
      }
    />
  )
}

/** 输入框：统一圆角描边样式 */
const INPUT_CLASS =
  'w-full rounded-md border-0 bg-white px-3 py-2.5 text-sm shadow-[var(--hair-strong)] outline-none focus:shadow-[0_0_0_2px_rgb(55_137_162/0.35)]'

/**
 * 昵称落盘前的统一规整 —— **只此一处**。
 *
 * ★ 空名字不等于「没名字」，而是「还没起名，先这么叫」，
 *   所以在这里就换成默认名，**不能等到界面渲染时再补**：
 *   存档里一旦留下空字符串，`{childName} · 三年级`、`XX 的森林`
 *   这些地方就会渲染成一片空白 —— 家长报的「名字就清除了」正是这个。
 *
 * 规则和引导页「不填也行，那就先叫「小笔苗」」是同一条，
 * 默认名本身收在 `DEFAULT_CHILD_NAME`，两处不会漂移。
 */
function normalizeName(raw: string): string {
  return raw.trim() || DEFAULT_CHILD_NAME
}

/* ============================================================
   页面
   ============================================================ */

export default function SettingsPage({ onBack }: { onBack: () => void }): ReactElement {
  const settings = useApp((s) => s.settings)
  const toast = useApp((s) => s.toast)
  const updateSettings = useApp((s) => s.updateSettings)
  const buildBackup = useApp((s) => s.buildBackup)
  const restoreBackup = useApp((s) => s.restoreBackup)
  const wipe = useApp((s) => s.wipe)
  const wallet = useApp((s) => s.wallet)
  const addCoins = useApp((s) => s.addCoins)

  const [nameDraft, setNameDraft] = useState(settings.childName)

  /**
   * 距离基准点。
   *
   * 界面上不判空 —— `resolveHomePoint` 已经把「拿不到用什么」这条规则
   * 收在 domain 一处了（默认深圳）。这里再兜一次底，规则就会有两份，
   * 迟早对不上。
   */
  const home = resolveHomePoint(settings.homePoint)
  const homeIsDefault = isDefaultHome(settings.homePoint)

  /* 家长密码 —— 进入设置需要 */
  const [parentPinUnlocked, setParentPinUnlocked] = useState(false)

  /* 日记密码 */
  const [confirmClearPin, setConfirmClearPin] = useState(false)

  /* AI 测试 */
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)
  /** 语音转写的测试状态（与 AI 那套分开，两件事互不影响） */
  const [trTesting, setTrTesting] = useState(false)
  const [trMsg, setTrMsg] = useState<{ ok: boolean; text: string } | null>(null)

  /* 数据管理 */
  const [confirmWipe, setConfirmWipe] = useState(false)

  /* 系统题库 */
  const [showLibrary, setShowLibrary] = useState(false)

  const ai = settings.ai

  /* ---------------- 小朋友信息 ---------------- */

  /**
   * 昵称落盘。
   *
   * ★ 原来只在**失焦**时保存（`onBlur={commitName}`，且直接写 `nameDraft.trim()`），
   *   这造成过两个真实故障 —— 家长报「设置了名字，再选择头像，名字就清除了」：
   *
   *   ① **打完名字直接点头像 → 名字压根没存。**
   *      那一下 tap 不一定先让输入框失焦，`onBlur` 就不触发；
   *      而输入框还显示着新名字，看着像存上了。
   *      下次进设置页时 `useState(settings.childName)` 重新初始化，
   *      名字又回到旧的 —— 家长看到的就是「名字没了」。
   *      （复现见 `SettingsPage.test.tsx`：不失焦时 store 仍是旧名。）
   *
   *   ② **清空输入框再失焦 → 把 `''` 原样写进存档。**
   *      空名字会在 `{childName} · 三年级`、`XX 的森林` 里渲染成空白 ——
   *      这就是「名字被清除」的字面来源。现在统一走 `normalizeName` 兜底。
   *
   * 所以改成**边打边存**（不再依赖失焦），点头像时也补存一次。
   * 名字最长 12 个字，逐次落盘的开销可以忽略，换来的是"不会白打"。
   */
  const commitName = (raw: string) => {
    const next = normalizeName(raw)
    if (next === settings.childName) return
    void updateSettings({ childName: next })
  }

  /* ---------------- 日记密码 ---------------- */

  const clearPin = async () => {
    await updateSettings({ diaryPin: null })
    setConfirmClearPin(false)
    toast({ kind: 'info', title: '日记密码已清除' })
  }

  /* ---------------- AI ---------------- */

  const patchAi = (patch: Partial<typeof ai>) => {
    void updateSettings({ ai: { ...ai, ...patch } })
  }

  const runTest = async () => {
    setTesting(true)
    setTestMsg(null)
    const r = await testAiConnection(ai)
    setTesting(false)
    setTestMsg({
      ok: r.ok,
      text: r.ms != null ? `${r.message}（${r.ms}ms）` : r.message,
    })
  }

  /* ---------------- 语音转写 ---------------- */

  /** 老存档可能没有这个字段，所以兜一层默认值再改 */
  const tr = settings.transcribe ?? defaultTranscribeConfig()
  /** 这条配置走的是「边说边传」的流式 */
  const trStreaming = usesStreamingEngine(tr)
  /**
   * 这台设备能不能真的走流式。
   *
   * ⚠️ 桌面上一定是 false —— 浏览器的 WebSocket 设不了请求头，连不上火山
   *    （见 platform/ws-transport.ts）。所以要老实说出来，
   *    否则家长会在电脑上测出一个"配好了但用不了"的结论。
   */
  const trCanStream = isStreamingSupported()

  const patchTr = (patch: Partial<typeof tr>) => {
    void updateSettings({ transcribe: { ...tr, ...patch } })
  }

  const runTrTest = async () => {
    setTrTesting(true)
    setTrMsg(null)
    // 两条路的"测什么"不一样：
    //   流式   —— 只握手，验证密钥/资源开通（发音频要真麦克风，设置页没有）
    //   整包上传 —— 发一小段提示音，验证地址+密钥+模型名
    const r = trStreaming
      ? await testVolcConnection({
          apiKey: tr.apiKey,
          resourceId: tr.resourceId,
          endpoint: resolveEndpoint(tr.model),
        })
      : await testTranscribeConnection(tr)
    setTrTesting(false)
    setTrMsg({
      ok: r.ok,
      text: r.ms != null ? `${r.message}（${r.ms}ms）` : r.message,
    })
  }

  /* ---------------- 数据管理 ---------------- */

  const handleExport = async () => {
    const backup = await buildBackup()
    const r = await exportText(
      timestampedName('小笔苗备份', 'json'),
      JSON.stringify(backup, null, 2),
    )
    toast({
      kind: r.ok ? 'success' : 'warn',
      title: r.ok ? '备份导出成功' : '导出失败',
      detail: r.message,
      emoji: r.ok ? '💾' : '⚠️',
    })
  }

  const handleRestore = async () => {
    const file = await pickTextFile()
    if (!file) return
    const r = await restoreBackup(file.content)
    toast({
      kind: r.ok ? 'success' : 'warn',
      title: r.ok ? '恢复成功' : '恢复失败',
      detail: r.message,
      emoji: r.ok ? '✅' : '⚠️',
    })
  }

  const handleWipe = async () => {
    await wipe()
    setConfirmWipe(false)
    toast({ kind: 'info', title: '数据已清空', detail: '一切重新开始', emoji: '🧹' })
  }

  /* ---------------- 题库导出导入 ---------------- */
  const doExportLibraryJson = useApp((s) => s.exportLibraryJson)
  const doImportLibraryJson = useApp((s) => s.importLibraryJson)

  const handleLibraryExport = async () => {
    const json = doExportLibraryJson()
    const r = await exportText(timestampedName('系统作文题库', 'json'), json)
    toast({
      kind: r.ok ? 'success' : 'warn',
      title: r.ok ? '题库导出成功' : '导出失败',
      detail: r.message,
    })
  }

  const handleLibraryImport = async () => {
    const file = await pickTextFile()
    if (!file) return
    const result = await doImportLibraryJson(file.content)
    if (result.ok) {
      toast({
        kind: 'success',
        title: `导入了 ${result.added} 道题`,
        detail: result.skipped > 0 ? `跳过 ${result.skipped} 道重复题` : undefined,
      })
    } else {
      toast({
        kind: 'warn',
        title: '导入没成功',
        detail: result.error ?? '文件格式不对',
      })
    }
  }

  /* ---------------- 渲染 ---------------- */

  if (showLibrary) {
    return (
      <div className="flex min-h-screen flex-col">
        <SubHeader title="系统作文题库" onBack={() => setShowLibrary(false)} />
        <main className="flex-1">
          <LibraryPage />
        </main>
      </div>
    )
  }

  /* 家长密码验证 */
  if (!parentPinUnlocked) {
    /* ⚠️ 这里原来套了一层 `max-w-xs`（320px），比日记本的 `max-w-md`（448px）
         窄一大截，而且没有卡片底 —— 家长说的「好窄、别扭」就是它。
         `PinGate` 自带 `max-w-md` + 卡片，不要再在外面加宽度限制。 */
    return (
      <ParentPinPanel
        title="家长验证"
        hint="请输入家长密码才能进入设置"
        onPass={() => setParentPinUnlocked(true)}
        onCancel={onBack}
      />
    )
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 pt-safe pb-safe">
      {/* ---------- 返回 ---------- */}
      <div className="flex items-center gap-2">
        <Button tone="ghost" onClick={onBack} ariaLabel="返回">
          ← 返回
        </Button>
        <h1 className="font-display text-xl font-extrabold text-ink-900">设置</h1>
      </div>

      {/* ========== 1. 小朋友信息 ========== */}
      <Card paper>
        <SectionTitle icon={<IconUser size={17} />} title="小朋友信息" sub="让夸奖叫得出名字" />

        <div className="space-y-3">
          <div>
            <div className="mb-1.5 text-xs font-extrabold text-ink-500">昵称</div>
            <input
              value={nameDraft}
              onChange={(e) => {
                setNameDraft(e.target.value)
                /* 边打边存 —— 别把「存下来」这件事押在失焦上（见 commitName 的说明） */
                commitName(e.target.value)
              }}
              onBlur={() => commitName(nameDraft)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              maxLength={12}
              placeholder="比如：豆豆"
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <div className="mb-1.5 text-xs font-extrabold text-ink-500">头像</div>
            <div className="flex flex-wrap gap-2">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  type="button"
                  aria-label={`选头像 ${a}`}
                  onClick={() => {
                    playSound('tap')
                    /* ★ 先把昵称存下来再改头像。
                       这一下 tap 不保证会先让输入框失焦 —— 一旦没失焦，
                       刚打的名字就白打了（家长报的就是这个）。 */
                    commitName(nameDraft)
                    void updateSettings({ avatar: a })
                  }}
                  className={`btn-base active:btn-press grid h-11 w-11 place-items-center rounded-md text-xl ${
                    settings.avatar === a
                      ? 'bg-amber-leaf-400'
                      : 'border-ink-900/10 bg-white'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-xs font-extrabold text-ink-500">年级</div>
            <div className="flex gap-2">
              {GRADE_GROUPS.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => void updateSettings({ grade: g.grades[0] })}
                  className={`btn-base active:btn-press flex flex-1 flex-col items-center gap-1 rounded-card py-3 text-center ${
                    g.grades.includes(settings.grade)
                      ? 'bg-inkleaf-50 text-ink-900 shadow-[var(--hair-leaf)]'
                      : 'bg-white text-ink-500 shadow-[var(--hair)]'
                  }`}
                >
                  <span className="text-2xl">{g.emoji}</span>
                  <span className="text-2xs font-bold">{g.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 新手引导重看入口。
              ★ 为什么用「把 guideDone 置回 false」而不是另开一个预览弹窗：
                引导本来就由 `guideDone` 驱动（见 App.tsx），置回 false 之后
                外壳下一帧就把引导渲染出来 —— 不需要第二套"预览"代码路径。
                代价是这一屏会被引导整个盖住，而这正是我们要的效果。
              ⚠️ 只动 guideDone，**不动 onboarded** —— 否则会把昵称和年级
                再问一遍，而那是他一年才改一次的东西（见 types.ts 的说明）。 */}
          <Row
            icon={<IconLightbulb size={17} />}
            title="新手引导"
            desc="怎么用这个 App —— 包括「按住说话」那个手势"
            right={
              <Button
                tone="quiet"
                onClick={() => void updateSettings({ guideDone: false })}
              >
                再看一遍
              </Button>
            }
          />
        </div>
      </Card>

      {/* ========== 2. 家长密码 ========== */}
      <Card paper>
        <SectionTitle icon={<IconShield size={17} />} title="家长密码" sub="进入设置需要，默认 0000" />
        <div className="space-y-2">
          <div className="rounded-md bg-inkleaf-50 shadow-[var(--hair-leaf)] px-3.5 py-3 text-sm font-extrabold text-ink-900">
            当前密码：{settings.parentPin ?? '0000'}
          </div>
          <Button
            full
            onClick={() => {
              const next = window.prompt('输入新的 4 位家长密码（只能填数字）：', settings.parentPin ?? '0000')
              if (next && /^\d{4}$/.test(next)) {
                void updateSettings({ parentPin: next })
                toast({ kind: 'success', title: '家长密码已更新' })
              } else if (next) {
                toast({ kind: 'warn', title: '密码格式不对', detail: '需要 4 位数字' })
              }
            }}
          >
            修改家长密码
          </Button>
        </div>
      </Card>

      {/* ========== 3. 日记密码 ========== */}
      <Card paper>
        <SectionTitle icon={<IconLock size={17} />} title="日记密码" sub="4 位数字，只有孩子自己知道" />

        {settings.diaryPin ? (
          <div className="space-y-2">
            <div className="rounded-md bg-inkleaf-50 shadow-[var(--hair-leaf)] px-3.5 py-3 text-sm font-extrabold text-ink-900">
              ✅ 已经设置好了（••••）
            </div>
            <Button full tone="danger" onClick={() => setConfirmClearPin(true)}>
              清除密码
            </Button>
            <p className="text-[11px] leading-relaxed text-ink-500">
              密码明文存在这台设备上，不会上传。孩子忘了密码时，可以在这里清掉。
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-ink-500">还没有设置日记密码。</p>
            <Button
              full
              onClick={() => {
                const pin = window.prompt('设置 4 位日记密码（只能填数字）：')
                if (pin && /^\d{4}$/.test(pin)) {
                  void updateSettings({ diaryPin: pin })
                  toast({ kind: 'success', title: '日记密码已设置' })
                } else if (pin) {
                  toast({ kind: 'warn', title: '密码格式不对', detail: '需要 4 位数字' })
                }
              }}
            >
              设置日记密码
            </Button>
          </div>
        )}
      </Card>

      {/* ========== 3. AI 设置 ========== */}
      <Card paper>
        <SectionTitle
          icon={<IconMagic size={17} />}
          title="AI 设置"
          sub="配好了：点评更细腻，改作文也听得懂大白话"
        />

        <div className="space-y-3">
          {/* 模式 */}
          <div className="flex gap-2">
            <Chip active={ai.mode === 'local'} onClick={() => patchAi({ mode: 'local' })}>
              🌱 本地引擎
            </Chip>
            <Chip active={ai.mode === 'remote'} onClick={() => patchAi({ mode: 'remote' })}>
              ☁️ 远程 AI
            </Chip>
          </div>

          <p className="text-xs leading-relaxed text-ink-500">
            {ai.mode === 'local'
              ? '本地引擎不联网，随时能用。点评是固定套路；改作文只认「把 X 改成 Y」这种句式，孩子说得随意一点就会认错。'
              : '远程 AI 需要填接口地址和密钥。点评更像真人老师，改作文能听懂「我觉得小猫不太好」这种大白话。'}
          </p>

          {ai.mode === 'remote' && (
            <div className="space-y-3">
              {/* 预设 */}
              <div>
                <div className="mb-1.5 text-xs font-extrabold text-ink-500">一键填入常用服务</div>
                <div className="flex flex-wrap gap-2">
                  {AI_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => {
                        playSound('tap')
                        patchAi({ baseUrl: p.baseUrl, model: p.model, mode: 'remote' })
                      }}
                      className="btn-base active:btn-press rounded-pill border-0 bg-white shadow-[var(--hair-strong)] bg-white px-3 py-2 text-xs font-extrabold text-ink-800"
                      title={p.note}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-extrabold text-ink-500">接口地址 baseUrl</div>
                <input
                  value={ai.baseUrl}
                  onChange={(e) => patchAi({ baseUrl: e.target.value })}
                  placeholder="https://api.deepseek.com/v1"
                  className={INPUT_CLASS}
                />
              </div>

              <div>
                <div className="mb-1.5 text-xs font-extrabold text-ink-500">密钥 API Key</div>
                <input
                  value={ai.apiKey}
                  type="password"
                  onChange={(e) => patchAi({ apiKey: e.target.value })}
                  placeholder="sk-..."
                  className={INPUT_CLASS}
                />
              </div>

              <div>
                <div className="mb-1.5 text-xs font-extrabold text-ink-500">模型名 model</div>
                <input
                  value={ai.model}
                  onChange={(e) => patchAi({ model: e.target.value })}
                  placeholder={DEFAULT_DEEPSEEK_MODEL}
                  className={INPUT_CLASS}
                />
              </div>

              <Row
                icon={<IconShield size={17} />}
                title="AI 失败时自动用本地引擎"
                desc="网络不好也不会卡住，孩子照样能写完"
                right={
                  <Toggle
                    on={ai.fallbackToLocal}
                    onChange={(v) => patchAi({ fallbackToLocal: v })}
                    label="AI 失败时回退本地引擎"
                  />
                }
              />

              {/* 附加提示词 */}
              <div className="space-y-1.5">
                <div className="mb-1 text-xs font-extrabold text-ink-500">
                  附加提示词（可选）
                </div>
                <textarea
                  value={ai.extraPrompt ?? ''}
                  onChange={(e) => patchAi({ extraPrompt: e.target.value })}
                  placeholder="比如：描写细致、多用修辞手法、注意段落衔接"
                  rows={3}
                  className={`${INPUT_CLASS} resize-none`}
                />
                <p className="text-[11px] leading-relaxed text-ink-500">
                  AI 点评和改范文时会参考这些要求。其中比喻、拟人、通感、叠词，
                  本地引擎也会尽量落实；排比、对话、成语这类要按内容现写，
                  得配好 AI 才做得到。不填就按默认标准来。
                </p>
              </div>

              {/* 测试连接 */}
              <div className="space-y-2">
                <Button full tone="quiet" disabled={testing} onClick={() => void runTest()}>
                  {testing ? '正在测试…' : '测试连接'}
                </Button>
                {testMsg && (
                  <div
                    className={`rounded-md px-3.5 py-2.5 text-xs font-bold leading-relaxed ${
                      testMsg.ok
                        ? 'bg-inkleaf-50 text-ink-900 shadow-[var(--hair-leaf)]'
                        : 'bg-clay-50 text-ink-900 shadow-[inset_0_0_0_1px_rgb(168_80_63/0.18)]'
                    }`}
                  >
                    {testMsg.ok ? '✅ ' : '⚠️ '}
                    {testMsg.text}
                  </div>
                )}
              </div>

              {/* 给家长的说明 */}
              <div className="space-y-1.5 rounded-md bg-mist-50 shadow-[var(--hair)] px-3.5 py-3 text-xs leading-relaxed text-ink-700">
                <p>🔐 密钥只保存在这台设备上，不会上传到任何服务器。</p>
                <p>✍️ 改作文时，AI 只按孩子自己说的那句话动手：最小改动、不扩写、不换他的用词。听不懂就直说，不会自己乱改。</p>
                <p>📶 不填也能用，本地引擎随时待命。</p>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* ========== 3.5 语音转文字 ========== */}
      <Card paper>
        <SectionTitle
          icon={<IconMic size={17} />}
          title="语音转文字"
          sub={trStreaming ? '密钥已内置，不用填' : '要不要自己填，看下面的说明'}
        />

        <div className="space-y-3">
          {/* ★ 这一段说明很重要：家长会以为"AI 设置里填过 Key 了，这里应该自动好"。
             但出题评分用的是对话大模型，DeepSeek 那类**没有语音识别接口**，
             是另一个服务。不说清楚家长会一直在那边找原因。 */}
          <div className="space-y-1.5 rounded-md bg-mist-50 shadow-[var(--hair)] px-3.5 py-3 text-xs leading-relaxed text-ink-700">
            {trStreaming ? (
              <>
                <p>
                  🎙️ 孩子按住麦克风说话，<strong>字会边说边长出来</strong>，松手几乎不用等。
                </p>
                <p>
                  🚀 因为声音是<strong>边说边传</strong>的 —— 孩子还在说的时候，音频已经
                  一段段到服务端了，所以松手之后只剩收尾（实测 150 毫秒）。
                </p>
                <p>✅ 密钥已经内置，这里不用填任何东西，装好就能用。</p>
                <p>
                  💰 这条路<strong>按说话时长计费</strong>（约 ¥2.2 / 小时）。
                  想省钱可以切到下面的「硅基流动」，那条免费。
                </p>
                <p>
                  🆚 和上面的「AI 设置」<strong>不是一回事</strong>：那边填的 DeepSeek
                  是评作文的，它没有语音识别功能，填了也不能转文字。
                </p>
              </>
            ) : (
              <>
                <p>
                  🔊 孩子按住麦克风说话，先<strong>录下来</strong>再传到网上转成文字。
                </p>
                <p>
                  🆚 这条路和上面的「AI 设置」<strong>不是一回事</strong>：上面填的
                  DeepSeek 是用来评作文的，它没有语音识别功能，<strong>填了也不能转文字</strong>，
                  所以这里要单独配一次。
                </p>
                <p>🆓 「硅基流动」注册免费，语音识别模型本身也是免费的。</p>
                <p>⚠️ 模型别选 SenseVoice —— 实测它会时不时不理人，默认的 Qwen3-ASR 稳得多。</p>
                <p>📴 不填也能用：手机自带的识别服务还能试，不行还有键盘输入。</p>
              </>
            )}
          </div>

          {/* 走哪一条路 */}
          <div>
            <div className="mb-1.5 text-xs font-extrabold text-ink-500">用哪一条路</div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  playSound('tap')
                  patchTr({
                    ...defaultTranscribeConfig(),
                    /* ⚠️ 只有**已经在这条路上**时才保留家长填的密钥。
                       从硅基流动切过来时必须换成内置的火山密钥 ——
                       那个 `sk-` 密钥是另一家服务的，带着它去连火山只会握手被拒，
                       表现就是"录音突然不出字了"，而且报错很难懂。
                       （这正是 MEMORY §七 那类"两条路共用同一个字段"的病。） */
                    apiKey: trStreaming && tr.apiKey.trim() ? tr.apiKey : VOLC_TEST_API_KEY,
                  })
                }}
                className={`btn-base active:btn-press rounded-pill border-0 px-3 py-2 text-xs font-extrabold shadow-[var(--hair-strong)] ${
                  trStreaming ? 'bg-amber-leaf-400 text-ink-900' : 'bg-white text-ink-800'
                }`}
              >
                火山 · 边说边传（推荐）
              </button>
              <button
                type="button"
                onClick={() => {
                  playSound('tap')
                  patchTr(openAiTranscribeConfig())
                }}
                className={`btn-base active:btn-press rounded-pill border-0 px-3 py-2 text-xs font-extrabold shadow-[var(--hair-strong)] ${
                  trStreaming ? 'bg-white text-ink-800' : 'bg-amber-leaf-400 text-ink-900'
                }`}
              >
                硅基流动 · 免费
              </button>
            </div>
          </div>

          {/* ⚠️ 流式只在手机 App 里能用 —— 必须说出来。
              否则家长会在电脑上测出一个"配好了但用不了"的结论，
              然后去反复检查一个根本没问题的配置（这个坑在"测试按钮发静音"
              那次已经吃过一回，见 platform/transcribe.ts 的说明）。 */}
          {trStreaming && !trCanStream && (
            <div className="rounded-md bg-clay-50 px-3.5 py-3 text-xs leading-relaxed text-ink-700 shadow-[inset_0_0_0_1px_rgb(168_80_63/0.18)]">
              这条路<strong>只在手机 App 里能用</strong>。电脑浏览器里连不上 ——
              浏览器的 WebSocket 不允许带自定义请求头，而火山的密钥必须放在请求头里
              （查询串和子协议两条绕行路都被服务端拒了，实测 HTTP 403 / 400）。
              在手机上装好 App 就能用。
            </div>
          )}

          {trStreaming ? (
            <>
              <div>
                <div className="mb-1.5 text-xs font-extrabold text-ink-500">识别方式</div>
                <div className="flex flex-wrap gap-2">
                  {(['duplex', 'nostream', 'async'] as VolcEndpoint[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        playSound('tap')
                        patchTr({ model: k })
                      }}
                      title={VOLC_ENDPOINTS[k].note}
                      className={`btn-base active:btn-press rounded-pill border-0 px-3 py-2 text-xs font-extrabold shadow-[var(--hair-strong)] ${
                        resolveEndpoint(tr.model) === k
                          ? 'bg-amber-leaf-400 text-ink-900'
                          : 'bg-white text-ink-800'
                      }`}
                    >
                      {VOLC_ENDPOINTS[k].label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-500">
                  {VOLC_ENDPOINTS[resolveEndpoint(tr.model)].note}
                </p>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-extrabold text-ink-500">密钥 API Key</div>
                <input
                  value={tr.apiKey}
                  type="password"
                  onChange={(e) => patchTr({ apiKey: e.target.value })}
                  placeholder="已内置"
                  className={INPUT_CLASS}
                />
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-500">
                  已经内置了一个可用的密钥。想换成自己的，直接覆盖这里就行。
                </p>
              </div>
            </>
          ) : (
            <>
              {/* 一键填入 */}
              <div>
                <div className="mb-1.5 text-xs font-extrabold text-ink-500">一键填入常用服务</div>
                <div className="flex flex-wrap gap-2">
                  {TRANSCRIBE_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => {
                        playSound('tap')
                        patchTr({ baseUrl: p.baseUrl, model: p.model })
                      }}
                      className="btn-base active:btn-press rounded-pill border-0 bg-white shadow-[var(--hair-strong)] bg-white px-3 py-2 text-xs font-extrabold text-ink-800"
                      title={p.note}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-extrabold text-ink-500">接口地址 baseUrl</div>
                <input
                  value={tr.baseUrl}
                  onChange={(e) => patchTr({ baseUrl: e.target.value })}
                  placeholder="https://api.siliconflow.cn/v1"
                  className={INPUT_CLASS}
                />
              </div>

              <div>
                <div className="mb-1.5 text-xs font-extrabold text-ink-500">密钥 API Key</div>
                <input
                  value={tr.apiKey}
                  type="password"
                  onChange={(e) => patchTr({ apiKey: e.target.value })}
                  placeholder="sk-..."
                  className={INPUT_CLASS}
                />
              </div>

              <div>
                <div className="mb-1.5 text-xs font-extrabold text-ink-500">识别模型 model</div>
                <input
                  value={tr.model}
                  onChange={(e) => patchTr({ model: e.target.value })}
                  placeholder="FunAudioLLM/SenseVoiceSmall"
                  className={INPUT_CLASS}
                />
              </div>
            </>
          )}

          {/* 测试连接 */}
          <div className="space-y-2">
            <Button full tone="quiet" disabled={trTesting} onClick={() => void runTrTest()}>
              {trTesting ? '正在测试…' : '测试连接'}
            </Button>
            {trMsg && (
              <div
                className={`rounded-md px-3.5 py-2.5 text-xs font-bold leading-relaxed ${
                  trMsg.ok
                    ? 'bg-inkleaf-50 text-ink-900 shadow-[var(--hair-leaf)]'
                    : 'bg-clay-50 text-ink-900 shadow-[inset_0_0_0_1px_rgb(168_80_63/0.18)]'
                }`}
              >
                {trMsg.ok ? '✅ ' : '⚠️ '}
                {trMsg.text}
              </div>
            )}
            <p className="text-[11px] leading-relaxed text-ink-500">
              {trStreaming
                ? '测试只做一次握手，用来确认密钥、以及「流式语音识别」服务开通了没有（不发音频）。'
                : '测试会发一小段提示音过去：服务端只要能收下并回话，就说明地址和密钥是对的（它当然听不懂提示音，所以回"没听清"也算通过）。'}
            </p>
          </div>
        </div>
      </Card>

      {/* ========== 4. 声音与震动 ========== */}
      <Card paper>
        <SectionTitle icon={<IconMic size={17} />} title="声音与震动" sub="给操作一点即时反馈" />
        <div className="space-y-2">
          <Row
            icon={<IconVolume size={17} />}
            title="音效"
            desc="点击、掉卡、升段都有声音"
            right={
              <Toggle
                on={settings.soundOn}
                onChange={(v) => {
                  void updateSettings({ soundOn: v })
                  if (v) {
                    // 打开时立刻响一声，让家长确认真的有效
                    setSoundEnabled(true)
                    playSound('success')
                  }
                }}
                label="音效开关"
              />
            }
          />
          <Row
            icon={<IconMoon size={17} />}
            title="震动"
            desc="抽到好卡时会轻轻震一下"
            right={
              <Toggle
                on={settings.hapticsOn}
                onChange={(v) => void updateSettings({ hapticsOn: v })}
                label="震动开关"
              />
            }
          />
        </div>
      </Card>

      {/* ========== 5. 学习目标 ========== */}
      <Card paper>
        <SectionTitle icon={<IconFlame size={17} />} title="学习目标" sub="每天想写几篇作文（日记不算）" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: DAILY_GOAL_MAX }, (_, i) => i + 1).map((n) => (
            <Chip
              key={n}
              active={settings.dailyGoal === n}
              onClick={() => void updateSettings({ dailyGoal: n })}
            >
              {n} 篇 / 天
            </Chip>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-ink-500">
          目标定小一点更容易坚持，连续完成会有额外的签到加成。
          每天最多 {DAILY_GOAL_MAX} 篇有金币和卡片 —— 才气是有限的；
          写超了也照样给评分和经验，不会拦着你写。
        </p>
      </Card>

      {/* ========== 6. 距离基准点 ========== */}
      <Card paper>
        <SectionTitle
          icon={<IconCompass size={17} />}
          title="距离基准点"
          sub="小鸟飞了多远，是从这儿开始算的"
        />
        <div className="flex items-center gap-2.5 rounded-md bg-ink-50 px-3.5 py-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-white text-inkleaf-600 shadow-[var(--hair)]">
            <IconCompass size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-sm font-bold text-ink-900">{home.name}</div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">
              {homeIsDefault ? '还没读到定位，先用这个点算。' : '已按设置的位置计算。'}
            </p>
          </div>
          {homeIsDefault && <Badge tone="neutral">默认</Badge>}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
          没设过位置、也没读到定位时，就用默认的「深圳」——
          宁可偏一两百公里，也比不给这个数字强：距离是这趟旅行最有分量的东西。
        </p>
      </Card>

      {/* ========== 7. 系统作文题库 ========== */}
      <Card paper>
        <SectionTitle
          icon={<IconFolder size={17} />}
          title="系统作文题库"
          sub="导出来就能打印，或者换设备接着用"
        />
        <div className="space-y-2">
          <Button full onClick={() => void handleLibraryExport()}>
            📤 导出题库（JSON）
          </Button>
          <Button full onClick={() => void handleLibraryImport()}>
            📥 导入题库（累加）
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
          导入是累加的：只往题库里加，不会覆盖已有的题。同一道题导两次也只算一道。
          手写的数据文件（题目 + 图片地址）也能直接导进来。
        </p>
      </Card>

      {/* ========== 8. 数据管理 ========== */}
      <Card paper>
        <SectionTitle icon={<IconBook size={17} />} title="数据管理" sub="所有数据都存在这台设备上" />
        <div className="space-y-2">
          <Button full onClick={() => void handleExport()}>
            💾 导出备份
          </Button>
          <Button full onClick={() => void handleRestore()}>
            📥 恢复备份
          </Button>
          <Button full tone="danger" onClick={() => setConfirmWipe(true)}>
            🧹 清空全部数据
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
          建议定期导出备份保存到电脑或网盘。清空后作文、日记、题库、卡片都会被删除，无法找回。
        </p>
      </Card>

      {/* ========== 调试 ========== */}
      <Card paper>
        <SectionTitle icon={<IconCoin size={17} />} title="调试" sub="开发测试用" />
        <div className="space-y-2">
          <div className="rounded-md bg-inkleaf-50 shadow-[var(--hair-leaf)] px-3.5 py-3 text-sm font-extrabold text-ink-900">
            当前金币：{wallet.coins}
          </div>
          <Button
            full
            onClick={() => {
              void addCoins(2000 - wallet.coins)
              toast({ kind: 'success', title: '金币已设为 2000' })
            }}
          >
            金币设为 2000
          </Button>
          <Button
            full
            tone="quiet"
            onClick={() => {
              void addCoins(1000)
              toast({ kind: 'success', title: '加了 1000 金币' })
            }}
          >
            +1000 金币
          </Button>
        </div>
      </Card>

      {/* ========== 7. 关于 ========== */}
      <Card paper>
        <SectionTitle icon={<IconTree size={17} />} title="关于" />
        <div className="space-y-1.5 text-xs leading-relaxed text-ink-700">
          <p className="font-display text-sm font-extrabold text-ink-900">
            「小笔苗 · 作文森林」{APP_VERSION}
          </p>
          <p>
            这是一个陪小学生、初中生练写作的小工具：看图出题、开口就说、写完就有点评，
            还有卡牌和连续签到，让"坚持写"这件事变得好玩。
          </p>
          <p>核心原则只有一条：AI 帮你看，但不替你写。</p>
          {/* ★★ ODbL 署名 —— 法律要求，不许删。
              广东那批旅游点（`src/data/landmarks-gd.json`）是从
              OpenStreetMap 生成的衍生数据库，ODbL 要求署名。
              为什么要单独一段、而且写"贡献者"：ODbL 的规范署名格式就是
              「© OpenStreetMap contributors」，写成「来自某地图公司」不合规。 */}
          <p className="pt-1 text-[11px] leading-relaxed text-ink-500">
            旅游点数据来自 © OpenStreetMap 贡献者（ODbL 授权）。
          </p>
        </div>
      </Card>

      {/* ---------- 确认对话框 ---------- */}
      <ConfirmDialog
        open={confirmClearPin}
        danger
        title="清除日记密码？"
        desc="清除后，任何人打开日记页都能直接看到内容。"
        confirmText="清除"
        cancelText="再想想"
        onConfirm={() => void clearPin()}
        onCancel={() => setConfirmClearPin(false)}
      />

      <ConfirmDialog
        open={confirmWipe}
        danger
        title="清空全部数据？"
        desc="作文、日记、题库、卡片、金币都会消失，且无法恢复。建议先导出备份。"
        confirmText="确认清空"
        cancelText="再想想"
        onConfirm={() => void handleWipe()}
        onCancel={() => setConfirmWipe(false)}
      />
    </div>
  )
}
