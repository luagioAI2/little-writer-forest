/* ============================================================
   语音写作台 —— 孩子说，孩子改  ·  v3
   ============================================================

   两种模式，靠一个开关切换：

     说作文 —— 孩子口述，文字追加到正文
     说修改 —— 孩子说「把棍子改成竹签」，改完正文（按钮文案是「改作文」）

   ★ 「改作文」有两条实现，按 AI 配没配好自动选：

     AI 配好了  → domain/ai.ts 的 parseEditInstruction：大模型**只把
                  孩子的口语翻译成结构化指令**（换/插/删/补/撤/拒），
                  正文交给 domain/voiceEdit.ts 的确定性引擎执行。
     AI 没配好  → 直接用本地正则解析 + 精确替换（老路子）。

   ⚠️ 这里记两次**需求变更**，都是边界问题，不是实现细节。

     第一次（2026-09-17）：原本「改作文绝不允许 AI 参与」，因为本地精确
     替换听不懂自然口语 —— 「我觉得小猫改成小狗更好」会被抓成
     「我觉得小猫」→「小狗更好」，然后报"找不到"，而语音识别的输出
     恰好就是这种带语气词、带标点的文本。于是改成走大模型。

     第二次（2026-09-19）：走大模型的第一版**让模型返回改好的全文** ——
     那是"AI 帮写"，越界了。家长把边界重新划了一遍：

       「不许 AI 帮改写。是**不许 AI 帮写**，不是不允许改写。
         把正在去掉可以，小明后面加小红可以，把小明改成大明可以。
         但不允许 AI 自己生产内容 —— 类似『给这个句子加点比喻』都不行。」

     所以现在的分工是：**模型管听懂，引擎管动笔**。模型返回的 JSON 里
     根本没有"正文"这个字段，它想替孩子写也没地方放。
     不靠提示词求它别写，靠**接口形状让它写不了**。
     详见 domain/ai.ts 四·五节的完整说明。

   语音不可用时（部分安卓 WebView），自动退化为键盘输入 +
   手动选择"要改哪个词"，功能闭环不断。

   v3 新增
     · ink 模式 —— 渲染成墨夜语言，供沉浸写作与树洞使用
     · voiceOnly —— 只用声音，不给键盘入口（日记专用）。
       键盘会让孩子把日记写成"作文"，而日记应该是说给自己听的话。
     · emoji 全部换成线性图标；波形加宽，让"在听"看得见。
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AiConfig, EditOperation, Utterance } from '../domain/types'
import {
  applyEdit,
  applyReplaceAt,
  replacePairOf,
  revisionPraise,
  sentenceChange,
  undoEdit,
  type EditResult,
} from '../domain/voiceEdit'
import { parseEditInstruction, remoteMissingFields, shouldUseRemote } from '../domain/ai'
import { countWords } from '../domain/scoring'
import {
  createRecorder,
  createRecognizer,
  isRecordingSupported,
  isSpeechRecognitionSupported,
  probeSpeechSupport,
  usesNativeSpeech,
  type Recognizer,
} from '../platform/speech'
import { canHoldToTalk } from '../platform/transcribe'
import { isStreamingSupported } from '../platform/ws-transport'
import {
  dropWarmVolcStream,
  openVolcStream,
  resolveEndpoint,
  warmVolcStream,
  type VolcStream,
} from '../platform/volcengine'
import { createPcmCapture, warmUpMicrophone, type PcmCapture } from '../platform/pcm-capture'
import { voiceDiag } from '../platform/voice-log'
import type { TranscribeConfig } from '../domain/types'
import { playSound } from '../platform/sound'
import { tapFeedback } from '../platform/haptics'
import { Button } from './ui'
import { IconCheck, IconMic, IconPen, IconStop, IconUndo, IconWrench } from './icons'

type Mode = 'append' | 'edit'

interface Props {
  text: string
  utterances: Utterance[]
  edits: EditOperation[]
  onChange: (next: { text: string; utterances: Utterance[]; edits: EditOperation[] }) => void
  /** 建议字数下限，用于提示 */
  minWords?: number
  placeholder?: string
  /** 墨夜场景（沉浸写作 / 树洞） */
  ink?: boolean
  /**
   * 只用声音，不给键盘入口 —— 日记专用。
   * 理由：键盘会让孩子把日记写成"作文"，而日记该是说给自己听的话。
   */
  voiceOnly?: boolean
  /** 是否显示「说作文 / 改作文」切换。日记不需要改稿流程 */
  allowEditMode?: boolean
  /**
   * 语音转写配置（录音 → 上传 → 文字）。
   *
   * 有它就优先走「按住说话」的云端转写；
   * 没有（老存档 / 家长没配）就退回到系统识别那套老行为。
   *
   * 为什么优先用它：国行机（华为等）上系统识别服务经常不可用，
   * 而云端这条路不依赖手机系统，是更可靠的那条。
   */
  transcribe?: TranscribeConfig
  /**
   * AI 配置（改作文走大模型用）。
   *
   * 配好了就自动走大模型；没配（密钥空）就退回本地精确替换 ——
   * 不报错、不阻断，孩子照样能改作文。
   */
  ai?: AiConfig
}

export function VoiceComposer({
  text,
  utterances,
  edits,
  onChange,
  minWords = 0,
  placeholder = '按下麦克风，把你看到的、想到的说出来吧～',
  ink = false,
  voiceOnly = false,
  allowEditMode = true,
  transcribe,
  ai,
}: Props) {
  const [mode, setMode] = useState<Mode>('append')
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null)
  /** 正在上传转写（"按住说话"松手之后的那一小段等待） */
  const [transcribing, setTranscribing] = useState(false)

  /**
   * 诊断计数器：这一轮到底收到了几条识别结果。
   *
   * 为什么要有它：真机上"点一下没反应"有很多种死法，
   * 而它们肉眼看起来**完全一样**（按钮亮了、也在听、就是没字）。
   * 只靠"有没有字"没法区分：
   *   · 0 条 → 识别服务压根没送结果（权限 / 服务 / 启动失败）
   *   · >0 条但正文没变 → 是下面这段追加逻辑或 onchange 的问题
   * 所以这里留一个可见的数字。孩子看不到（它很轻），
   * 但排查时一眼就能定位到是哪一半坏了。
   * 正常情况下它只会显示"已收到 N 句"。
   */
  const [resultCount, setResultCount] = useState(0)
  const [lastRaw, setLastRaw] = useState('')
  /**
   * 这一轮**确实听过而且已经结束**，才值得报"没收到结果"。
   *
   * ⚠️ 必须是"已结束"而不是"按过开始"。
   * 早先写成"按下开始就置 true"是错的：第一轮没收到结果之后，
   * 这条提示会**一直挂在屏幕上**（因为只有下一次按开始才清零），
   * 孩子后面写完了还在看它。所以收尾时（onEnd / onError）才置位，
   * 而且一旦收到结果就立刻撤掉。
   */
  const [roundEndedEmpty, setRoundEndedEmpty] = useState(false)
  const [candidates, setCandidates] = useState<
    { index: number; context: string; from: string; to: string }[] | null
  >(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualValue, setManualValue] = useState('')
  void placeholder
  /** 音量波形 */
  const [level, setLevel] = useState(0)

  const recRef = useRef<Recognizer | null>(null)
  const recorderRef = useRef<ReturnType<typeof createRecorder> | null>(null)
  const rafRef = useRef<number | null>(null)
  /** 流式转写的会话（边说边传那条路） */
  const volcRef = useRef<VolcStream | null>(null)
  /** 流式的 PCM 采集 */
  const pcmRef = useRef<PcmCapture | null>(null)
  /**
   * socket 还没连上时先攒着的音频。
   *
   * 为什么需要：孩子按下的**瞬间**就可能开口，而建连要 200ms 左右。
   * 如果等连上再开麦，开头那半个字就丢了 —— 表现为"第一个字总是听不见"，
   * 而且越短的句子越明显。所以先开麦、先攒着，连上后一次性补发。
   */
  const earlyChunksRef = useRef<Uint8Array[]>([])

  /**
   * 这一轮**已经识别出来的最后一段文字**（就是上槽里显示的那个）。
   *
   * ★ 为什么要单独记一份：终稿不一定来（服务端可能只下发中间结果，
   *   也可能收尾时连接就断了），而中间结果**我们早就拿到了**。
   *   不记的话，收尾失败时只能回一句"没听清" —— 孩子刚才说的话全白说。
   *   ➜ 收尾失败时拿它兜底落进正文（见 finishVolcRound）。
   *
   * ⚠️ 每一轮开始必须清空（见 beginHold）—— 否则上一轮的字会补进这一轮。
   */
  const lastInterimRef = useRef('')
  /** 用 ref 拿最新的 text，避免闭包里拿到旧值 */
  const stateRef = useRef({ text, utterances, edits, mode })
  stateRef.current = { text, utterances, edits, mode }

  /**
   * 语音能力。
   *
   * 先用同步探测给个初值（浏览器看有没有 SpeechRecognition 对象），
   * 挂载后再异步问一次真话 —— 原生 App 要问系统有没有识别服务，
   * 问不到就老实显示"这台设备不支持"，而不是等孩子点了才报错。
   */
  const [speechOk, setSpeechOk] = useState(() => isSpeechRecognitionSupported())
  const nativeSpeech = usesNativeSpeech()
  /** 原生识别自己占着麦克风，这里不能再开 getUserMedia 去抢 */
  const recordOk = isRecordingSupported() && !nativeSpeech

  useEffect(() => {
    let alive = true
    void probeSpeechSupport().then((ok) => {
      if (alive) setSpeechOk(ok)
    })
    return () => {
      alive = false
    }
  }, [])

  const words = useMemo(() => countWords(text), [text])

  /* ---------------- 提交变更 ---------------- */

  const commit = useCallback(
    (next: { text: string; utterances?: Utterance[]; edits?: EditOperation[] }) => {
      const cur = stateRef.current
      onChange({
        text: next.text,
        utterances: next.utterances ?? cur.utterances,
        edits: next.edits ?? cur.edits,
      })
    },
    [onChange],
  )

  /* ---------------- 预热（进写作页就把该做的做掉） ---------------- */

  /** 用 ref 拿最新的 transcribe，免得 prewarm 因为依赖变化被反复重建 */
  const warmCfgRef = useRef(transcribe)
  warmCfgRef.current = transcribe

  /**
   * 把"按下去才做的事"提前做掉：**开麦 + 握手**。
   *
   * ★ 为什么值得：按下到出字之间有两段固定开销 ——
   *   `getUserMedia`（首次可能要弹权限、开设备，几百毫秒）
   *   和 WebSocket 握手（实测约 160ms，占冷连接总耗时的四成多）。
   *   孩子对"按下去多久有反应"极其敏感，而这两段**本来就可以
   *   挪到进页面的时候**去做。
   *
   *   更关键的是：松手比开麦快的时候，采集还没建好图就被停掉了，
   *   这一轮**一个字节都没采到** —— 表现成"说了话，什么都没出来"。
   *   开麦提前之后，这个窗口基本消失。
   *
   * ⚠️ 只负责"更快"，不负责"能用"：任何一步失败都不报错、不阻断 ——
   *   按下时会照常现连、照常开麦（也就是今天的行为）。
   */
  const prewarm = useCallback(() => {
    const cfg = warmCfgRef.current
    if (!canHoldToTalk(cfg)) return
    // ① 麦克风：把权限询问 + 设备打开的开销提前摊掉
    void warmUpMicrophone()
    // ② WebSocket：把握手做完，按下时直接复用
    warmVolcStream({
      apiKey: cfg?.apiKey ?? '',
      resourceId: cfg?.resourceId,
      endpoint: resolveEndpoint(cfg?.model),
    })
  }, [])

  /**
   * ★ 进写作页就预热（家长 2026-10-02 要的：「能否进入写作页面就是有录音的，
   *   就建立好链接」）。
   *
   * 放在挂载时而不是按下时，理由见上面 prewarm 的说明。
   * ⚠️ 这里的 `warmUpMicrophone()` 会**真的把麦克风打开一瞬间**再立刻关掉
   *    （系统状态栏的麦克风图标会闪一下）。这是刻意的取舍：
   *    不真开一次，预热就没有意义。
   */
  useEffect(() => {
    prewarm()
  }, [prewarm])

  /* ---------------- 处理一句识别结果 ---------------- */

  /** 这一轮收到的结果条数（用 ref 记，收尾时要读最新值，不能读闭包里的旧 state） */
  const gotCountRef = useRef(0)

  /**
   * 改作文要不要让大模型帮忙"听懂"。
   *
   * 三个条件都要：有配置、密钥/地址/模型齐了（`shouldUseRemote`）。
   *
   * ★★ 2026-09-21 家长定：「改作文 必须是 AI 模型 处理。」
   *    所以缺条件时**不再退回本地正则**（原来的 `editLocally` 已删），
   *    而是当场说清缺的是哪一样（见下面 `handleFinal` 的 `!useAiRevise` 分支）。
   *    ⚠️ 这里以前写的是「缺一个就退回本地正则 —— 静默降级是**故意的**，
   *       改作文是核心玩法，不该因为没配 AI 就整个不可用」。
   *       那条理由已经被家长自己推翻了：他要的是**准确**，
   *       不是"看起来还能用"—— 降级降得看不出来，等于把配置故障伪装成功能缺陷。
   */
  const useAiRevise = Boolean(ai && shouldUseRemote(ai))

  /**
   * 大模型那条路：**只让它听懂，不让它动笔**。
   *
   *   孩子说一句口语 → parseEditInstruction 翻成结构化指令
   *                   → 本地 applyEdit 执行 → 正文
   *
   * ★ 模型返回的东西里没有"正文"这个字段，它想替孩子写都没地方放。
   *   这条链路的形状本身就守住了"不许 AI 帮写"，不靠提示词求它自觉。
   *   详见 domain/ai.ts 四·五节。
   */
  const editViaAi = useCallback(
    async (instruction: string) => {
      const cur = stateRef.current
      setTranscribing(true)
      try {
        voiceDiag('改作文走 AI 解析', { 指令: clip(instruction, 30), 原文字数: cur.text.length })
        const r = await parseEditInstruction({
          cfg: ai as AiConfig,
          text: cur.text,
          instruction,
        })

        if (!r.ok || !r.intent) {
          /*
           * ★★ 2026-09-21 家长定：「改作文 必须是 AI 模型 处理。」
           *    所以这里**不再静默退回本地**。
           *
           *    以前这一支是 `editLocally(instruction)` —— 后果很坏：
           *    key 失效 / 余额用尽 / 被限流 / 网络不通 / 模型名写错，
           *    在界面上和「孩子说得太随意」**长得一模一样**，都是「没太听懂」。
           *    家长永远看不出"AI 根本没跑"，只会觉得"这功能不行 / 配置没生效"。
           *    （这正是 MEMORY §三 那条：降级了必须让人看得出来。）
           *
           *    现在把**真实原因**原样端出来：`r.message` 里已经分好了
           *    "没配好 / 连不上 / 模型没听懂"，不再被本地那句"没太听懂"顶掉。
           *
           *    ⚠️ 但"拒绝"仍然不走这里：refuse 的 ok 是 true，
           *       它会一路走到 applyEdit 去说「这句得你自己写」。
           */
          voiceDiag('AI 没解析出来（按约定不退回本地）', { reason: r.reason })
          playSound('error')
          setFeedback({ text: r.message, ok: false })
          return
        }

        const intent = r.intent
        // 传 'ai'：正文照旧由引擎生成（每个字都是孩子说的），
        // 但记录和回执都要说准"这一下是谁动手的"
        const result: EditResult = applyEdit(cur.text, intent, Date.now(), 'ai')

        if (result.ok && result.operation) {
          /*
           * ★ 把**孩子的原话**一起记进这条记录（2026-09-21 家长要的
           *   「修正内容 就是输入的话的内容」）。
           *
           *   ⚠️ 记的是 `instruction`（转写之后他说的那句），不是 `intent`、
           *      也不是引擎生成的回执 —— 修改记录里「你说」那一栏要逐字是他说的。
           *      拿模型改写过的字去填，就等于把他没说过的话记在他头上。
           */
          commit({
            text: result.text,
            edits: [...cur.edits, { ...result.operation, said: instruction }],
          })
          playSound('success')
          setFeedback({ text: result.message, ok: true })
          return
        }

        if (result.reason === 'ambiguous' && result.candidates) {
          const pair = replacePairOf(intent)
          if (pair) {
            setCandidates(
              result.candidates.map((c) => ({
                index: c.index,
                context: c.context,
                from: pair.from,
                to: pair.to,
              })),
            )
            setFeedback({ text: result.message, ok: false })
            return
          }
        }

        playSound('error')
        setFeedback({ text: result.message, ok: false })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        voiceDiag('AI 解析抛了异常（按约定不退回本地）', { err: msg })
        /*
         * ★ 2026-09-21：这里以前也是 `editLocally(instruction)` ——
         *   和上面那一支**同一个病**：网络不通 / 密钥失效 / 超时，
         *   在界面上都变成本地那句"没太听懂"，家长分不清
         *   该去查网络还是该怪孩子说得随意。
         *   （这一支才是真正接住"连不上"的地方 —— 上一版只改了上面那一支，
         *     漏了这一支，等于没改。）
         *   现在把真实原因端出来，并指向设置里那个能自查的按钮。
         */
        playSound('error')
        setFeedback({ text: `AI 没连上：${clip(msg, 50)}。去设置里点「测试连接」看看`, ok: false })
      } finally {
        setTranscribing(false)
      }
    },
    [ai, commit],
  )

  const handleFinal = useCallback(
    (raw: string) => {
      const cur = stateRef.current

      // 先记账（诊断用，见 resultCount 的说明），再干活
      gotCountRef.current += 1
      setResultCount(gotCountRef.current)
      setLastRaw(raw)
      // 收到了就撤掉"一句都没收到"的提示
      setRoundEndedEmpty(false)

      if (cur.mode === 'append') {
        // 口述正文：追加
        const base = cur.text.trim()
        const sep = base === '' ? '' : /[。！？.!?]$/.test(base) ? '' : '。'
        const nextText = base + sep + raw
        const utt: Utterance = {
          id: `utt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          text: raw,
          at: Date.now(),
        }
        commit({ text: nextText, utterances: [...cur.utterances, utt] })
        setFeedback({ text: `记下了：「${clip(raw, 22)}」`, ok: true })
        return
      }

      // 修改模式
      /*
       * ★★ 2026-09-21 家长定：「改作文 必须是 AI 模型 处理。」
       *
       *   所以这里**只剩一条路**：大模型把口语翻成结构化指令，
       *   正文一律由本地引擎 applyEdit 执行（详见 ai.ts 四·五节）。
       *
       *   ⚠️ 以前 AI 没配好时会**偷偷用本地正则顶上**（`editLocally`），
       *      家长因此分不清"AI 根本没跑"和"孩子说得太随意" ——
       *      两条路的失败文案长得一样，都是「没太听懂」。
       *      现在缺什么就说什么，让他知道该去设置里补哪一样。
       */
      if (!useAiRevise) {
        /*
         * ⚠️ `ai` 可能是 **undefined**（全新安装、或从没进过设置页），
         *    所以这里**不能**写 `remoteMissingFields(ai as AiConfig)` ——
         *    它内部第一行就读 `cfg.mode`，传 undefined 会当场抛 TypeError。
         *    那个 `as AiConfig` 骗过了编译器（`ai` 的类型是 `AiConfig | undefined`），
         *    但骗不过运行时：孩子按一下麦克风，回执里出现的是一句
         *    「Cannot read properties of undefined」。
         */
        const missing = ai ? remoteMissingFields(ai) : []
        playSound('error')
        setFeedback({
          text:
            ai && ai.mode === 'remote' && missing.length > 0
              ? `改作文要用 AI 才听得懂，还缺${missing.join('、')} —— 去设置里补上`
              : '改作文要用 AI 才听得懂 —— 去设置里选「远程 AI」并填好密钥',
          ok: false,
        })
        return
      }

      void editViaAi(raw)
    },
    [commit, useAiRevise, editViaAi, ai],
  )

  /* ---------------- 一轮收尾 ---------------- */

  /**
   * 这一轮听完了（正常按停、或出错收尾）。
   *
   * 集中在一处判断，是因为"收尾"有多个入口（onEnd / onError / stopListening），
   * 分散写会让诊断提示的时机前后不一致 —— 这一轮的教训就是
   * 状态置位太早/太晚都会留下一条错位的提示。
   */
  const endRound = useCallback(() => {
    if (gotCountRef.current === 0) setRoundEndedEmpty(true)
    /* 一轮用完，预热槽就空了 —— 立刻备好下一条，
       让"连着说两句"的第二次也走热连接。 */
    prewarm()
  }, [prewarm])

  /* ---------------- 开始 / 停止 ---------------- */

  const startListening = useCallback(async () => {
    setFeedback(null)
    setCandidates(null)
    setInterim('')
    /* 新一轮：诊断状态清零。
       roundEndedEmpty 置 false —— 这一轮还什么都没发生，不该挂着提示。
       （它唯一置 true 的地方是 endRound()，见那里的说明。） */
    setResultCount(0)
    setLastRaw('')
    setRoundEndedEmpty(false)
    gotCountRef.current = 0
    playSound('record-start')
    tapFeedback()

    /* 整条启动链路包一层兜底。
       麦克风这一块在真机上千奇百怪（没权限、被别的应用占着、
       系统没有识别服务……），任何一种都不该把页面崩掉 ——
       失败就退回键盘输入，孩子的作文一个字都不会丢。 */
    try {
      if (speechOk) {
        const rec = createRecognizer({
          onInterim: (t) => setInterim(t),
          onFinal: (t) => handleFinal(t),
          onError: (msg) => {
            setFeedback({ text: msg, ok: false })
            setListening(false)
            // 报错收尾：也算这一轮结束了，交给统一的收尾判定
            endRound()
          },
          onEnd: () => {
            setListening(false)
            endRound()
          },
          // 原生识别自带音量，波形照样能画
          onLevel: (l) => setLevel(l),
        })
        recRef.current = rec
        rec.start()
        setListening(true)
      } else {
        // 没有语音识别 —— 提示孩子改用键盘
        setFeedback({
          text: '这台设备不支持语音识别，请用下面的「键盘输入」',
          ok: false,
        })
        setManualOpen(true)
        return
      }

      // 浏览器里顺带录音：仅用于波形反馈，让"在听"这件事看得见。
      // （原生识别不能用这条 —— 会和系统识别抢麦克风）
      if (recordOk) {
        try {
          const recorder = createRecorder()
          recorderRef.current = recorder
          await recorder.start()
          const tick = () => {
            const r = recorderRef.current
            if (r) setLevel(r.getLevel())
            rafRef.current = requestAnimationFrame(tick)
          }
          rafRef.current = requestAnimationFrame(tick)
        } catch {
          /* 拿不到麦克风就不画波形，不影响识别 */
        }
      }
    } catch (err) {
      setListening(false)
      setLevel(0)
      setFeedback({
        text: err instanceof Error && err.message ? err.message : '麦克风没能打开，用键盘输入也一样可以写',
        ok: false,
      })
      setManualOpen(true)
    }
  }, [speechOk, recordOk, handleFinal, endRound])

  /* ============================================================
     按住说话（云端转写）
     ------------------------------------------------------------
     为什么要做成"按住"：孩子对微信语音那个动作是**已经会了**的，
     不用教。而"点一下开始、再点一下结束"有个隐蔽的坑 ——
     孩子会忘记按停，于是一直录，最后转出来一大段。

     按住 → 松手，本身就是个**自然的结束信号**，不需要孩子记住任何状态。

     录下来的音频传到云端转写（见 platform/transcribe.ts），
     拿回的文字**交给同一个 handleFinal** ——
     于是"说作文就追加、改作文就解析指令"的规则只有一份，
     不会出现两条路径行为漂移。
     ============================================================ */

  /** 这一轮"按住"的起始时间，用来判断是不是误触 */
  const holdStartRef = useRef(0)
  /** 松手后还要不要走完转写（用户中途放弃时置 false） */
  const holdActiveRef = useRef(false)

  /**
   * 孩子**已经松手**了 —— 和"还在按住""中途放弃"是**三件事**。
   *
   * ★ 为什么必须单独一个 ref，而不是复用 holdActiveRef：
   *   按下要等两件异步的事（`getUserMedia` 拿到麦克风、流式还要等 WebSocket
   *   握手），而**松手是同步的**。所以"松手跑在就绪前面"是常态，不是异常。
   *
   *   那一刻 endHold 手里什么都没有可收尾 —— 但音频已经在采、连接还在路上，
   *   这一轮**不是废的**（探针日志里那句 `有音频: true` 就是证据）。
   *   所以要留一个"我松手了，请收尾"的意图，给 beginHold 的尾巴看见：
   *
   *     holdActive=true                    → 还在按住
   *     holdActive=false, released=true    → 松手比就绪快，等就绪后**收尾**
   *     holdActive=false, released=false   → 中途放弃（手指滑出 / 卸载），收掉
   */
  const holdReleasedRef = useRef(false)

  /**
   * 这一轮流式建连的 promise。
   *
   * 松手比握手快时，endHold 没有 session 可收 —— 它靠这条 promise 知道
   * "连接还在路上"，而不是当场判死刑（见 endHold 里那段说明）。
   */
  const volcConnectRef = useRef<Promise<VolcStream> | null>(null)

  /**
   * 第几轮"按住" —— 用来认出"我这条尾巴已经过期了"。
   *
   * ★ 为什么需要：`beginHold` 要 await（开麦、握手），而孩子完全可能在这段
   *   窗口里**又按一次**（"松手太快"的孩子本来就在反复点）。那就会出现
   *   上一轮的尾巴和新一轮的尾巴同时在跑，而它们共用
   *   `earlyChunksRef` / `volcRef` / `volcConnectRef` 这几个 ref ——
   *   上一轮的尾巴一旦接着往下写，就会把新一轮攒下的音频和会话搅乱
   *   （表现为"连着按两次，第二次的文字是第一次的、或者干脆没有"）。
   *   所以每条尾巴都记住自己属于第几轮，过期了就**只收拾自己**。
   */
  const roundSeqRef = useRef(0)

  /**
   * 有没有可用的「按住说话」—— 也就是"能不能走火山流式"。
   *
   * ★ 判定**只有这一份**：`canHoldToTalk`（platform/transcribe.ts）。
   *   它同时决定两件事，两处必须是同一个答案：
   *     · 这个麦克风按钮是「按住说话」还是「点一下开始」；
   *     · 新手引导第二屏教孩子**哪个手势**。
   *   两处各写一遍，就会出现"引导教按住、按钮却是点击"——
   *   孩子按住不动，界面毫无反应，于是认定麦克风坏了。
   *
   * ⚠️ 桌面 / 网页上它一定是 false：浏览器的 WebSocket 设不了请求头，
   *   连不上火山（见 ws-transport.ts 顶部说明）。
   *
   * ⛔ 2026-10-02 起**没有"流式不可用就退回整包上传"这一支了** ——
   *   那条路连代码一起删了（家长：「去掉硅基流动的东西，只使用火山」）。
   *   所以这里不再是"选哪条路"，而是"这条路能不能用"。
   */
  const canTranscribe = canHoldToTalk(transcribe)

  /**
   * 流式那一轮的**收尾**：发最后一包 → 等终稿 → 把文字交给 handleFinal。
   *
   * ★ 只有这一个收尾入口，两个调用点：
   *     · `endHold` —— 松手时连接**已经就绪**（常见情形）；
   *     · `beginHold` 的尾巴 —— 松手比握手快，连接就绪后由它补收尾。
   *
   *   两处各写一遍，就会出现"一条路把文字交出去、另一条忘了"的漂移，
   *   而漂移的表现恰好是"有时候有字、有时候没有"——最难查的那种。
   */
  const finishVolcRound = useCallback(
    async (session: VolcStream, pcm: PcmCapture | null, hadAudio: boolean) => {
      setTranscribing(true)
      try {
        voiceDiag('流式开始收尾', {
          按住ms: Date.now() - holdStartRef.current,
          音频ms: pcm?.getDurationMs(),
        })
        const r = await session.finish()
        if (r.ok) {
          voiceDiag('流式成功', { ms: r.ms, 字数: r.text.length })
          // ★ 走和系统识别**完全相同**的处理函数
          handleFinal(r.text)
          endRound()
          return
        }

        /* ★★ 兜底：**已经识别出来的字，一个字都不许丢**。
         *
         * 家长 2026-10-02 报的就是这一条：「录音文字已经识别，但是如果
         * 松开过快，就不会处理」—— 上槽明明已经长出字了，正文却一个字没变。
         *
         * 为什么会有这种状态：终稿那一条消息可能压根不来（服务端只给了
         * 中间结果），也可能收尾时连接被关掉 / 报错 —— 而**中间结果我们
         * 早就拿到了**（它就在上槽里显示着）。这时候把它扔掉、只回一句
         * "没听清"，孩子刚才说的话就白说了。
         *
         * ⚠️ 只有一种情况**不许**兜底：`'cancelled'` —— 那是孩子自己放弃的
         *    （手指滑出按钮 / 离开页面）。把他不要的东西写进作文更糟。
         *    这就是 `'cancelled'` 必须和 `'empty'` 分开的原因。 */
        const salvaged = lastInterimRef.current.trim()
        if (r.reason !== 'cancelled' && salvaged) {
          voiceDiag('没拿到终稿，用已经识别出来的中间结果兜底', {
            reason: r.reason,
            字数: salvaged.length,
          })
          handleFinal(salvaged)
          endRound()
          return
        }

        /* 松手比开麦还快 → 一个字节都没采到。
         * 这时候说"没听清"是**甩锅**：根本不是听不清，是压根没录上。
         * 说清原因，孩子才知道该按住多说一会儿。 */
        if (!hadAudio && r.reason !== 'cancelled') {
          voiceDiag('这一轮没采到音频（松手比开麦快）', {
            按住ms: Date.now() - holdStartRef.current,
          })
          setFeedback({ text: '松手太快啦，还没开始录呢 —— 按住说完再松手', ok: false })
          endRound()
          return
        }

        setFeedback({ text: r.message, ok: false })
        endRound()
      } catch (err) {
        voiceDiag('流式收尾抛了异常', {
          err: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        })
        setFeedback({ text: '转文字失败了，再试一次', ok: false })
        endRound()
      } finally {
        setTranscribing(false)
      }
    },
    [handleFinal, endRound],
  )

  const beginHold = useCallback(async () => {
    /* ⚠️ 上一轮还在收尾（`transcribing`）时按下，会被这里挡掉。
       以前是**静悄悄**挡掉 —— 孩子按了、说了，界面什么反应都没有，
       看起来就像"松开太快所以不处理"。
       现在至少给一句回执：让他知道不是坏了，是上一句还在转。 */
    if (transcribing) {
      voiceDiag('上一轮还在收尾，这一次按下被忽略', {})
      setFeedback({ text: '上一句还在转成文字，等一下再按', ok: false })
      return
    }
    setFeedback(null)
    setCandidates(null)
    setInterim('')
    setResultCount(0)
    setLastRaw('')
    setRoundEndedEmpty(false)
    gotCountRef.current = 0
    /* ⚠️ 每一轮都要清 —— 否则上一轮的中间结果会补进这一轮（见 lastInterimRef） */
    lastInterimRef.current = ''

    holdActiveRef.current = true
    holdReleasedRef.current = false
    holdStartRef.current = Date.now()
    /* 这一轮的编号 —— 尾巴靠它认出"我过期了"（见 roundSeqRef 的说明） */
    const seq = ++roundSeqRef.current

    /* ⚠️ 这里**不再**预热了。原来那行 `warmUpTranscribe()` 是给「整包上传」
       那条 HTTP 路用的（发一个 GET /models 把 DNS/TCP/TLS 摊开）——
       那条路已经删了（2026-10-02）。
       流式这条路的预热换了个时机：**进写作页就做**（见上面 prewarm 的说明），
       按下的时候连接早就在手里了。 */

    playSound('record-start')
    tapFeedback()
    setListening(true)

    /* 流式那条路的建连 promise。
       提到 try 外面是因为 catch 里要用它：麦克风没开成的时候，
       这条连接可能已经在路上了 —— 不主动收掉就漏一条连到火山的
       socket（没人持有它，只能等服务端自己超时）。 */
    let connecting: Promise<VolcStream> | null = null

    try {
      /* ---------------- 流式：边说边传 ----------------
         顺序很关键：**先开麦，再等建连**。
         反过来的话，孩子按下的瞬间就开口，开头那半个字会丢在建连的
         200ms 里 —— 越短的句子越明显（"第一个字总是听不见"）。
         所以采集立刻开始，音频先攒在 earlyChunksRef，连上后补发。 */
      if (canTranscribe) {
        earlyChunksRef.current = []
        volcRef.current = null

        const capture = createPcmCapture({
          onChunk: (bytes) => {
            const s = volcRef.current
            if (s) s.pushAudio(bytes)
            else earlyChunksRef.current.push(bytes)
          },
        })
        pcmRef.current = capture

        // 同时存进外层变量 —— 麦克风开失败时 catch 要用它把这条连接收掉
        const connectPromise = openVolcStream(
          {
            apiKey: transcribe?.apiKey ?? '',
            resourceId: transcribe?.resourceId,
            endpoint: resolveEndpoint(transcribe?.model),
          },
          {
            onInterim: (t) => {
              // ★ 记一份 —— 收尾拿不到终稿时靠它兜底（见 finishVolcRound）
              lastInterimRef.current = t
              setInterim(t)
            },
          },
        )
        connecting = connectPromise
        volcConnectRef.current = connectPromise

        await capture.start()

        const session = await connectPromise

        /* ★ 过期检查必须排在**动任何共享 ref 之前**。
           孩子在这段窗口里又按了一次的话，`earlyChunksRef` / `volcRef` /
           `volcConnectRef` 现在都属于**新一轮**了 —— 这里只要碰一下，
           就会把新一轮的音频和会话搅乱（见 roundSeqRef 的说明）。
           过期的尾巴只收拾自己那条连接，别的什么都不许动。 */
        if (roundSeqRef.current !== seq) {
          voiceDiag('这一轮已过期（孩子又按了一次），只收掉自己的连接', {
            过期轮: seq,
            当前轮: roundSeqRef.current,
          })
          session.cancel()
          return
        }

        volcConnectRef.current = null

        /* ★ 先补发"建连期间攒下的音频"，再决定这一轮归谁收尾。
           孩子按下的**瞬间**就可能开口，而那些包全在 earlyChunksRef 里 ——
           先判断归谁收尾、再补发的话，一旦走了收尾分支就会把它们漏掉。 */
        for (const c of earlyChunksRef.current) session.pushAudio(c)
        earlyChunksRef.current = []
        volcRef.current = session

        if (holdActiveRef.current) {
          // 还在按住：正常，开始画波形
          const tickVolc = () => {
            const p = pcmRef.current
            if (p) setLevel(p.getLevel())
            rafRef.current = requestAnimationFrame(tickVolc)
          }
          rafRef.current = requestAnimationFrame(tickVolc)
          return
        }

        if (holdReleasedRef.current) {
          /* ★ 松手比握手快 —— 这一轮由**这里**收尾。
             ⚠️ 这里以前是 `session.cancel(); return`：把已经握上手的连接、
             连同已经采到的音频（探针日志那句 `有音频: true`）整段扔掉；
             而 endHold 那边因为手里没有 session，只能报一句「网络有点慢」。
             两句提示都在甩锅，孩子说的字全丢。
             现在正常收尾：音频早就发出去了，只差一次收尾往返（实测中位 150ms）。 */
          voiceDiag('松手比握手快，连接就绪后补收尾', {
            按住ms: Date.now() - holdStartRef.current,
            音频ms: capture.getDurationMs(),
          })
          await finishVolcRound(session, capture, capture.getDurationMs() > 0)
          return
        }

        // 中途放弃（手指滑出按钮 / 组件卸载）—— 收掉，不要结果
        session.cancel()
        return
      }

      /* ⛔ 这里原来是「整包上传：录完再传」那一支（MediaRecorder → 上传）。
         2026-10-02 家长定「只使用火山」，那条路连代码一起删了。
         ⚠️ `canTranscribe` 为假时按钮走的是"点一下开始"那套，
            压根不会进 beginHold —— 所以这里**不该**有第二条路。
            真走到这里就是 bug，留一条日志让人看得见。 */
      voiceDiag('按下了"按住说话"，但流式这条路不可用（不该发生）', {})
    } catch (err) {
      holdActiveRef.current = false
      setListening(false)
      setLevel(0)

      /* 麦克风开失败，但 socket 可能已经在连了。
         收掉它，并且**接住这个 promise**：不接的话它会变成
         未处理的 rejection（插件没注册那条路会 reject），
         控制台多一条没人看得懂的报错。 */
      const orphan = connecting
      if (orphan) {
        void orphan.then((s) => s.cancel()).catch(() => {})
      }
      pcmRef.current?.cancel()
      pcmRef.current = null
      volcRef.current = null
      earlyChunksRef.current = []

      voiceDiag('麦克风打开失败', {
        err: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      })
      setFeedback({
        text:
          err instanceof Error && err.message
            ? err.message
            : '麦克风没能打开，用键盘输入也一样可以写',
        ok: false,
      })
      setManualOpen(true)
    }
  }, [transcribing, transcribe, canTranscribe, finishVolcRound])

  const endHold = useCallback(async () => {
    // 不是"按住"这一路（比如按键被别的路径触发），不做处理
    if (!holdActiveRef.current) return
    holdActiveRef.current = false

    const durationMs = Date.now() - holdStartRef.current

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setLevel(0)
    setListening(false)

    playSound('record-stop')

    /* ---------------- 流式：松手只是"发最后一包" ----------------
       这里是整条链路最大的区别所在：音频**早就已经发过去了**，
       所以松手之后只剩一次收尾往返（实测中位 150ms）。
       而且文字在孩子说话时就已经在屏幕上长了（onInterim）。 */
    if (canTranscribe) {
      const pcm = pcmRef.current
      const session = volcRef.current

      /* ★ 顺序不能反：**先收采集，再清 volcRef**。
         pcm.stop() 会把缓冲区里最后不足一包的那点音频 flush 出来
         （0~200ms，平均 100ms 左右），而 onChunk 是拿 `volcRef.current`
         判断"连上了没有"的 —— 先清掉的话，这一包会被当成"还没连上"
         塞进 earlyChunksRef，然后**永远发不出去**。
         表现成最后一个字（或半个字）被吃掉，而且**不报任何错**，
         只在"有时候结尾少个字"这种模糊反馈里露头。
         实测过：这条顺序写反过，每次松手都丢尾巴。 */
      const captureHadAudio = pcm?.stop() ?? false
      pcmRef.current = null
      holdReleasedRef.current = true
      volcRef.current = null
      /* ⚠️ 这里**刻意不再清 earlyChunksRef**。
         松手比握手快时，那些包还要靠 beginHold 的尾巴补发出去 ——
         以前在这里清掉，等于把已经采到的音频直接扔了。 */

      /* ★ 松手比握手快：连接还在路上，而音频已经在 earlyChunksRef 里。
         不在这里判死刑 —— beginHold 的尾巴会等连接就绪，然后由它补收尾。
         （以前这一支报的是「网络有点慢，再试一次」：明明跟网络无关，
           而且那一轮**本来救得回来**，只是被这里丢掉了。）

         ⚠️ 所以这里**不需要**再加一个"等多久就算了"的上限：
            握手本身有 8 秒上限（ws-transport 的 CONNECT_TIMEOUT_MS），
            超了会走失败分支，由尾巴把真实原因说出来。
            等待期间界面显示的是「正在转成文字…」，而这一轮真的还有救 ——
            比当场丢掉、还甩锅给网络诚实。 */
      if (!session) {
        if (volcConnectRef.current) {
          voiceDiag('松手比握手快，等连接就绪再收尾', {
            按住ms: durationMs,
            有音频: captureHadAudio,
          })
          return
        }
        // 连接已经不在了（beginHold 的 catch 收掉了，或压根没建起来）：
        // 麦克风那条真实原因已经由 beginHold 说过，这里不重复打扰
        voiceDiag('松手时既没有会话、也没有在途连接', {
          按住ms: durationMs,
          有音频: captureHadAudio,
        })
        endRound()
        return
      }

      await finishVolcRound(session, pcm, captureHadAudio)
      return
    }

    /* ⛔ 这里原来是「整包上传」那一支（`recorder.stop()` → 上传 → 转写）。
       2026-10-02 那条路已删 —— 见 beginHold 里的说明。
       ⚠️ 流式那一支在上面已经 `return` 了，能走到这里的只有
          "按下了按住说话、但流式不可用"这种不该发生的情况。 */
    voiceDiag('松手时没有可用的转写会话（不该发生）', { 按住ms: durationMs })
  }, [endRound, canTranscribe, finishVolcRound])

  /** 中途放弃（手指滑出按钮、或组件卸载）*/
  const cancelHold = useCallback(() => {
    if (!holdActiveRef.current) return
    holdActiveRef.current = false
    // ★ 真·放弃：把"松手了请收尾"那个意图也撤掉，
    //   否则 beginHold 的尾巴会以为孩子松手了，去把这一轮收尾（见那三个 ref 的说明）
    holdReleasedRef.current = false
    // 手指滑出按钮了。这条日志专门用来解释"为什么没有后面的上传日志"，
    // 免得把"用户主动放弃"误判成"录音链路断了"。
    voiceDiag('中途放弃（手指滑出按钮）', { 按住ms: Date.now() - holdStartRef.current })
    recorderRef.current?.cancel()
    recorderRef.current = null
    // 流式那两样也要收掉：采集还开着的话麦克风指示灯会一直亮，
    // 而 socket 不收掉会一直挂到服务端超时
    pcmRef.current?.cancel()
    pcmRef.current = null
    volcRef.current?.cancel()
    volcRef.current = null
    earlyChunksRef.current = []
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setLevel(0)
    setListening(false)
  }, [])

  const stopListening = useCallback(() => {
    playSound('record-stop')
    /* ★ 这里刻意**不等** settled()，也刻意不立刻把会话丢掉太多东西。
       为什么不写 `await recRef.current.settled()`：
       本组件的每一句结果都是走 onFinal 回调直接写进正文的，
       按停之后**没有任何"读攒下来的文本"的动作** —— 没有那个
       320ms 的竞态（那是背诵页独有的，见 ReciteView）。
       所以不需要阻塞在这里。

       但也**不能像以前那样立刻把会话扔了**：真机上 stopListening() 之后
       系统还会把最后一句送回来（这个窗口见 speech.ts 的
       NATIVE_RESULT_GRACE_MS，1600ms）。以前这里 `recRef.current = null`
       是在 stop() 之后立刻执行的，可那只是断开**本组件**的引用 ——
       模块级的 currentNativeSession 还在，最后一句照样收得到，
       所以改作文一直是好的。保留引用、让识别器自己按窗口收尾就够了。 */
    recRef.current?.stop()
    recRef.current = null
    recorderRef.current?.cancel()
    recorderRef.current = null
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setLevel(0)
    setInterim('')
    setListening(false)
  }, [])

  // 卸载时彻底停掉，避免麦克风一直开着
  useEffect(() => {
    return () => {
      // 按住说话中途离开页面：把录音收掉，别让麦克风一直开着
      holdActiveRef.current = false
      // 同理：卸载 = 真·放弃，别让 beginHold 的尾巴去收尾
      holdReleasedRef.current = false
      recRef.current?.abort()
      recorderRef.current?.cancel()
      pcmRef.current?.cancel()
      volcRef.current?.cancel()
      // 预热的那条连接也要收掉 —— 离开页面还挂着一条 socket 纯属浪费
      dropWarmVolcStream()
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  /* ---------------- 候选选择 ---------------- */

  const pickCandidate = (c: { index: number; from: string; to: string }) => {
    const cur = stateRef.current
    const r = applyReplaceAt(cur.text, c.index, c.from, c.to, Date.now())
    if (r.ok && r.operation) {
      commit({ text: r.text, edits: [...cur.edits, r.operation] })
      playSound('success')
      setFeedback({ text: r.message, ok: true })
    }
    setCandidates(null)
  }

  /* ---------------- 撤销 ---------------- */

  const doUndo = () => {
    const cur = stateRef.current
    const back = undoEdit(cur.edits)
    if (!back) {
      setFeedback({ text: '还没有可以撤销的修改', ok: false })
      playSound('error')
      return
    }
    commit({ text: back.text, edits: back.edits })
    playSound('tap')
    setFeedback({ text: '退回上一步啦', ok: true })
  }

  /* ---------------- 键盘输入 ---------------- */

  const submitManual = () => {
    const v = manualValue.trim()
    if (!v) return
    handleFinal(v)
    setManualValue('')
    setManualOpen(false)
  }

  /* ============================================================
     样式表：同一套结构，两种世界的皮
     ============================================================ */

  const S = {
    segment: ink ? 'bg-black/25 shadow-[var(--hair-light)]' : 'bg-white shadow-[var(--hair-strong)]',
    segmentOn: ink
      ? 'bg-white/[0.13] text-[var(--color-night-text)]'
      : 'bg-amber-leaf-400 text-ink-900',
    segmentOff: ink ? 'text-[var(--color-night-text-3)]' : 'text-ink-600',
    hint: ink ? 'text-[var(--color-night-text-3)]' : 'text-ink-600',
    hint2: ink ? 'text-[var(--color-night-text-2)]' : 'text-ink-700',
    iconBtn: ink
      ? 'bg-white/[0.07] text-[var(--color-night-text-2)] shadow-[var(--hair-light)]'
      : 'bg-white text-ink-600 shadow-[var(--hair-strong)]',
    listenBox: ink
      ? 'bg-white/[0.06] shadow-[var(--hair-light)]'
      : 'bg-amber-leaf-50 shadow-[var(--hair-amber)]',
    feedbackOk: ink
      ? 'bg-inkleaf-300/[0.14] text-[var(--color-night-text)] shadow-[var(--hair-light)]'
      : 'bg-inkleaf-50 text-ink-900 shadow-[var(--hair-leaf)]',
    feedbackBad: ink
      ? 'bg-amber-leaf-300/[0.13] text-[var(--color-night-text)] shadow-[var(--hair-light)]'
      : 'bg-clay-50 text-ink-900 shadow-[inset_0_0_0_1px_rgb(168_80_63/0.2)]',
    panel: ink ? 'bg-white/[0.05] shadow-[var(--hair-light)]' : 'bg-paper-2 shadow-[var(--hair)]',
    panelItem: ink
      ? 'bg-white/[0.06] text-[var(--color-night-text)] shadow-[var(--hair-light)]'
      : 'bg-white text-ink-800 shadow-[var(--hair)]',
  }

  /* ---------------- 渲染 ---------------- */

  /**
   * 有几处是 AI 按孩子的话改的。
   *
   * ⚠️ 界面文案必须靠它区分，不能一律说成"你自己改的" ——
   *    改作文接了大模型之后，那句话就是**对孩子说假话**。
   *    孩子做的是"决定改哪里"，这份功劳照认，但话得说准。
   */
  const aiEditCount = useMemo(() => edits.filter((e) => e.by === 'ai').length, [edits])

  return (
    <div className="space-y-3">
      {/* ---- 模式切换 ---- */}
      {allowEditMode && (
        <div className="flex items-center gap-2">
          <div className={`flex flex-1 gap-1 rounded-pill p-1 ${S.segment}`}>
            <ModeButton
              active={mode === 'append'}
              onClick={() => {
                setMode('append')
                setFeedback(null)
                setCandidates(null)
              }}
              icon={<IconPen size={15} />}
              label="说作文"
              on={S.segmentOn}
              off={S.segmentOff}
            />
            <ModeButton
              active={mode === 'edit'}
              onClick={() => {
                setMode('edit')
                setFeedback(null)
                setCandidates(null)
              }}
              icon={<IconWrench size={15} />}
              label="改作文"
              on={S.segmentOn}
              off={S.segmentOff}
            />
          </div>
          <button
            type="button"
            onClick={doUndo}
            disabled={edits.length === 0}
            className={`btn-base active:btn-press grid h-11 w-11 shrink-0 place-items-center rounded-full disabled:opacity-35 ${S.iconBtn}`}
            aria-label="撤销上一步修改"
          >
            <IconUndo size={18} />
          </button>
        </div>
      )}

      {/* ---- 模式说明 ----
           ★ 2026-09-21 家长要求去掉「一句一句慢慢说，我会记下来。」
             （原话：「一句一句慢慢说，我会记下来 去掉。」）——
             说作文那边不再有这行说明。

           改作文这边**留着**：「改哪里由你决定」是这条路的边界说明
           （AI 只负责翻译成指令，不代写），删了孩子就不知道边界在哪。

           ⚠️ 顺手把「说作文」那个分支整段删掉，而不是留一个空 <p> ——
             空段落虽然看不见，照样占一行高度。 */}
      {allowEditMode && mode === 'edit' && (
        <p className={`px-1 text-xs leading-relaxed ${S.hint}`}>
          想改哪里就直说，比如「把棍子改成竹签」。改哪里由你决定。
        </p>
      )}

      {/* ---- 实时识别中 ----
           ⚠️ 这一块**故意不在这里渲染**。
           以前它是 `{listening && <div .../>}` 放在麦克风按钮**上方**：
           手指一按下，这里凭空长出一条约 60px 的状态条，
           把下面的麦克风按钮整体往下推 —— 手指还按在原来的位置，
           按钮已经跑了。浏览器随即发 pointercancel，
           `onPointerCancel` 又是 cancelHold，于是录音当场被丢掉，
           表现就是「刚按下去就松开了」。

           ★ 现在它渲染在麦克风按钮**上方**那个**固定高度**的槽位里
           （见下面「麦克风主按钮」那段）。
           注意两件事要**同时**成立才安全：
             ① 槽位**永远渲染**（不是 `{listening && …}`）→ 按下时不新增元素；
             ② 槽位高度**写死 48px** → 里面换内容也不改变高度。
           满足这两条，槽位在按钮上面还是下面都**不会顶动按钮**。

           ★ 2026-09-20 家长要求从"按钮下面"挪到"按钮上面"：
             「听到的内容应该在话筒上面，现在是在话筒下面，
               导致有时候不好看，被手遮住。」
             按住说话时手是**往下盖**的，槽位在按钮下面就会被手挡掉。 */}

      {/* ---- 诊断行：只在"听了一轮却一句都没收到"时出现 ----
          正常情况下它一直不显示。
          它出现 = 识别服务没送回任何结果（不是界面把字吞了），
          这时候孩子看到的提示要指向真正该做的事，而不是干等。 */}
      {!listening && roundEndedEmpty && (
        <p className={`px-1 text-xs leading-relaxed ${S.hint}`}>
          这一轮没有收到任何识别结果。请确认：① 系统设置里允许「小笔苗」使用麦克风；
          ② 手机装有可用的语音识别服务（部分国行 ROM 需要手动安装）。
          也可以用下面的「键盘输入」先写。
        </p>
      )}

      {/* ---- 诊断行：收到了结果，但正文一个字都没变 ----
          说明识别是好的，问题在"把结果写进正文"这一段，排查方向完全不同。

          ⚠️ 只在**说作文**模式下报这一条。改作文模式下"正文没变"是**正常结果** ——
          孩子说「把棍子改成竹签」，如果原文里根本没有"棍子"，系统本来就不改，
          这不是程序问题。把它报成"程序问题"会让家长去截一堆无用的图。 */}
      {!listening && mode === 'append' && resultCount > 0 && lastRaw && !text.trim() && (
        <p className={`px-1 text-xs leading-relaxed ${S.hint}`}>
          收到了识别结果（「{clip(lastRaw, 18)}」），但没能写进正文。
          这是程序问题，麻烦把这句话截图反馈。
        </p>
      )}

      {/* ---- 麦克风主按钮 ----
           配了云端转写就用「按住说话」（孩子对微信语音那个动作已经会了）；
           没配则保留原来的"点一下开始/再点一下停止"。 */}
      <div className="flex flex-col items-center gap-3 py-2">
        {/* ★ 上槽：实时识别状态 —— 必须在按钮**上方**。
            家长 2026-09-20：「听到的内容应该在话筒上面，现在是在话筒下面，
            导致有时候不好看，被手遮住。」按住说话时手是往下盖的。

            ⚠️ 它**永远渲染**（不是 `{listening && <div/>}`）、高度**写死 48px**，
              闲着时里面是**空的**。这两条是防历史上那个 bug：
              按下时凭空长出一条 ~60px 的状态条 → 把按钮往下推 →
              手指还在原位、按钮已经跑了 → 浏览器发 pointercancel → 录音当场丢掉。
              「永远渲染 + 高度写死」这两条不变，放上面还是下面都不会顶动按钮。

            ★ 2026-09-21 提示语挪到按钮**下方**（见下槽）——
              于是这里闲着时就是空的，只负责在听时显示状态。 */}
        <div className="flex h-12 w-full items-center">
          {listening && (
            <div
              className={`flex h-full w-full items-center gap-3.5 rounded-md px-4 ${S.listenBox}`}
            >
              <Waveform level={level} ink={ink} />
              <span className={`min-w-0 flex-1 truncate text-sm font-medium ${S.hint2}`}>
                {interim || (resultCount > 0 ? `已收到 ${resultCount} 句` : '我在听……')}
              </span>
              <span
                className={`h-2 w-2 shrink-0 rounded-full anim-breathe ${
                  ink ? 'bg-[#e8b3a6]' : 'bg-danger'
                }`}
              />
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={
            canTranscribe
              ? undefined
              : listening
                ? stopListening
                : () => void startListening()
          }
          // 按住说话：pointer 事件比 mouse/touch 更省事 ——
          // 一套代码同时覆盖触摸和鼠标，而且能 setPointerCapture
          onPointerDown={
            canTranscribe
              ? (e) => {
                  // 捕获指针：手指滑出按钮再松开，我们仍然收得到 pointerup，
                  // 不会出现"录音一直开着"的僵尸状态
                  e.currentTarget.setPointerCapture?.(e.pointerId)
                  void beginHold()
                }
              : undefined
          }
          onPointerUp={canTranscribe ? () => void endHold() : undefined}
          /* ★ pointercancel 走**收尾**，不走放弃。
             它经常是"冤枉"的：布局一抖、系统手势一插、通知栏一拉，
             浏览器就会发它。这种时候把孩子刚说的话整段丢掉是最差的选择 ——
             收尾至少把他已经说的留下（`endHold` 自己会挡掉重复调用）。
             `cancelHold`（真·放弃）留给 onBlur：那是焦点真的离开了。 */
          onPointerCancel={canTranscribe ? () => void endHold() : undefined}
          // 松手在按钮外（键盘/辅助设备触发 click）时兜底
          onBlur={canTranscribe ? cancelHold : undefined}
          aria-label={
            transcribing
              ? '正在转成文字'
              : listening
                ? canTranscribe
                  ? '松手结束说话'
                  : '停止说话'
                : canTranscribe
                  ? '按住说话'
                  : '开始说话'
          }
          className={`btn-base relative grid h-[84px] w-[84px] place-items-center rounded-full text-white ${
            canTranscribe ? 'select-none touch-none' : 'active:btn-press'
          } ${
            listening
              ? 'bg-[#a8503f]'
              : transcribing
                ? 'bg-moss-400'
                : mode === 'edit' && allowEditMode
                  ? 'bg-moss-400'
                  : 'bg-inkleaf-500'
          }`}
          style={{
            boxShadow: listening
              ? '0 8px 28px -10px rgb(168 80 63 / 0.6)'
              : '0 8px 28px -10px rgb(16 163 104 / 0.55)',
          }}
        >
          <span className="relative z-10">
            {listening ? <IconStop size={30} /> : <IconMic size={32} />}
          </span>
          {listening && (
            <>
              <span className="absolute inset-0 rounded-full bg-[#a8503f]/60 anim-pulse-ring" />
              <span
                className="absolute inset-0 rounded-full bg-[#a8503f]/60 anim-pulse-ring"
                style={{ animationDelay: '0.55s' }}
              />
            </>
          )}
        </button>

        {/* ★ 下槽：提示语 —— 在按钮**下面**。
            家长 2026-09-21：「按住说话 放在 说话按钮下。现在说话按钮 稍微 下了点。」
            （上一版把唯一的槽整个挪到了按钮上方，于是按钮离屏幕底边近了 60px。）

            ★ 两个槽**都永远渲染 + 都写死 48px**，一个在按钮上方、一个在下方，
              于是**总高度恒定** → 按下麦克风时按钮一动都不动。
            ⚠️ 这就是"分上下两个槽"能成立的前提：**两个都必须常驻**。
              只让上面那个按需出现，就会退回"按下时按钮被顶走、录音丢掉"那个老 bug。
              也正因为按钮下面仍有这 48px，按钮的高度回到了改造前的位置。 */}
        <div className="flex h-12 w-full items-center justify-center">
          <span className={`w-full text-center text-xs font-semibold ${S.hint}`}>
            {listening
              ? canTranscribe
                ? '松手就结束'
                : '再点一下结束'
              : transcribing
                ? '正在转成文字…'
                : mode === 'edit' && allowEditMode
                  ? canTranscribe
                    ? '按住说你想改什么'
                    : '点一下，说你想改什么'
                  : canTranscribe
                    ? '按住说话吧'
                    : '点一下，开始说'}
          </span>
        </div>

        {/* 键盘兜底：日记明确不给这个入口 */}
        {!voiceOnly ? (
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setManualOpen((v) => !v)
                setManualValue('')
              }}
              className={`text-xs font-medium underline decoration-dotted underline-offset-4 ${
                ink ? 'text-mist-300' : 'text-mist-500'
              }`}
            >
              {manualOpen ? '收起键盘输入' : '不方便说话？用键盘输入'}
            </button>

            {/* ★ 这台设备没有云端转写时，必须把话说明白。
                **只有网页 / 桌面会走到这里**（APK 上 `isStreamingSupported()` 恒为真）。

                为什么非要这一段：桌面 Chrome **有** `SpeechRecognition` 对象，
                所以上面那句「这台设备不支持语音识别」（`!speechOk` 那段）**不会出现**；
                而浏览器自带的识别在国内连不上服务端 —— 孩子按下去只会看到
                「我在听……」，一个字都不回来，也没有任何解释。
                所以这里主动把人引到真正能用的路上：键盘，或输入法自带的语音输入。

                ⚠️ 判据用 `isStreamingSupported()` 而**不是** `!canTranscribe`：
                   后者在「APK 上没配密钥」时也为假，而那种情况是在手机上，
                   说一句"请在手机 App 里用"是错的。
                ⚠️ 这段在 APK 上**恒不渲染** → 不增加任何高度，
                   因此碰不到「按下时按钮一动都不动」那条红线（见本文件上方注释）。 */}
            {!isStreamingSupported() && (
              <p className={`max-w-[18rem] text-center text-2xs leading-relaxed ${S.hint}`}>
                这台设备没有云端语音转写，语音输入请在手机 App 里用。
                <br />
                也可以打字，或用输入法自带的语音输入（Windows 按 Win+H）。
              </p>
            )}
          </div>
        ) : (
          <p className={`max-w-[16rem] text-center text-2xs leading-relaxed ${S.hint}`}>
            日记只用声音写。
            <br />
            说出来的才是心里话，打字会变成作文。
          </p>
        )}
      </div>

      {/* ---- 键盘输入 ---- */}
      {manualOpen && !voiceOnly && (
        <div className={`space-y-2 rounded-md p-3 ${S.panel}`}>
          <p className={`text-xs font-medium ${S.hint2}`}>
            {mode === 'append' ? '输入想说的内容：' : '输入修改指令，例如「把棍子改成竹签」：'}
          </p>
          <div className="flex gap-2">
            <input
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitManual()
              }}
              placeholder={mode === 'append' ? '今天……' : '把 A 改成 B'}
              className={`min-w-0 flex-1 rounded-sm px-3 py-2.5 text-sm outline-none ${
                ink
                  ? 'bg-black/30 text-[var(--color-night-text)] shadow-[var(--hair-light)] placeholder:text-[var(--color-night-text-3)]'
                  : 'bg-white shadow-[var(--hair)] focus:shadow-[var(--hair-leaf)]'
              }`}
            />
            <Button tone="plain" onClick={submitManual} disabled={!manualValue.trim()}>
              确定
            </Button>
          </div>
        </div>
      )}

      {/* ---- 反馈 ---- */}
      {feedback && (
        <div
          className={`flex items-start gap-2 rounded-md px-3.5 py-2.5 text-sm font-medium anim-fade-in ${
            feedback.ok ? S.feedbackOk : S.feedbackBad
          }`}
        >
          <span className="mt-0.5 shrink-0">
            {feedback.ok ? <IconCheck size={15} strokeWidth={2.4} /> : <IconUndo size={15} />}
          </span>
          <span className="min-w-0 flex-1 leading-relaxed">{feedback.text}</span>
        </div>
      )}

      {/* ---- 多处匹配：让孩子自己挑 ---- */}
      {candidates && candidates.length > 0 && (
        <div className={`rounded-md p-3.5 ${S.panel}`}>
          <p className={`mb-2.5 text-sm font-semibold ${ink ? S.hint2 : 'text-ink-900'}`}>
            这句里有 {candidates.length} 个地方，你想改哪一个？
          </p>
          <div className="space-y-2">
            {candidates.map((c, i) => (
              <button
                key={i}
                type="button"
                onClick={() => pickCandidate(c)}
                className={`btn-base active:btn-press w-full rounded-sm px-3 py-2.5 text-left text-sm font-medium ${S.panelItem}`}
              >
                <span className={ink ? 'text-[var(--color-night-text-3)]' : 'text-ink-400'}>
                  {i + 1}.{' '}
                </span>
                {c.context}
                <span className={`ml-1 text-xs ${ink ? 'text-moss-200' : 'text-moss-500'}`}>
                  → 改成「{c.to}」
                </span>
              </button>
            ))}
            <Button full size="sm" tone="quiet" onClick={() => setCandidates(null)}>
              先不改了
            </Button>
          </div>
        </div>
      )}

      {/* ---- 修改记录 ---- */}
      {edits.length > 0 && (
        <div className={`rounded-md px-3.5 py-3 ${S.panel}`}>
          <div className={`mb-2 text-xs font-semibold ${S.hint2}`}>
            {aiEditCount === 0
              ? `你自己的修改 · ${edits.length} 处`
              : aiEditCount === edits.length
                ? `按你的话改的 · ${edits.length} 处`
                : `修改记录 · ${edits.length} 处`}
          </div>
          {/*
            ★ 2026-09-21 家长：「我希望是 **表明作文原文**，
              **修正内容 就是输入的话的内容**。」

              所以每条记录改成三行 —— 原文那句 / 改成 / 你说的话：

              · 「原文」「改成」取的是**改动处所在的那一整句**（`sentenceChange`），
                不是被换掉的那两个字。光看「小猫 → 小狗」孩子不知道是在说哪一句。
              · 「你说」是**逐字的原话**（`e.said`），只有 AI 那条路才填得出来 ——
                孩子自己动手改的没有"输入的话"，那一行就不渲染。

            ⚠️ 从每条 1 行变成 3 行，所以条数从 6 降到 3 ——
              否则面板会有十几行高，把下面的东西全顶走。
          */}
          <div className="space-y-2">
            {edits.slice(-3).map((e) => {
              const { beforeSentence, afterSentence } = sentenceChange(e.before, e.after)
              const label = `w-8 shrink-0 ${ink ? 'text-[var(--color-night-text-3)]' : 'text-ink-400'}`
              return (
                <div key={e.id} className="space-y-0.5 text-xs">
                  <div className="flex items-baseline gap-2">
                    <span className={label}>原文</span>
                    <span
                      className={`min-w-0 flex-1 truncate line-through ${
                        ink ? 'text-[var(--color-night-text-3)]' : 'text-ink-400'
                      }`}
                    >
                      {clip(beforeSentence, 40)}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className={label}>改成</span>
                    <span
                      className={`min-w-0 flex-1 truncate ${
                        ink ? 'text-inkleaf-200' : 'text-inkleaf-700'
                      }`}
                    >
                      {clip(afterSentence, 40)}
                    </span>
                    {/* 标出来这一处是 AI 按孩子的话改的 —— 不标的话，
                        孩子会以为是自己动的手，界面上那句话就成了假话 */}
                    {e.by === 'ai' && (
                      <span
                        className={`shrink-0 text-[10px] font-semibold ${
                          ink ? 'text-inkleaf-300/70' : 'text-ink-400'
                        }`}
                      >
                        AI 按你说的
                      </span>
                    )}
                  </div>
                  {e.said && (
                    <div className="flex items-baseline gap-2">
                      <span className={label}>你说</span>
                      <span
                        className={`min-w-0 flex-1 truncate ${S.hint}`}
                        title={e.said}
                      >
                        {clip(e.said, 40)}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <p
            className={`mt-2.5 border-t pt-2 text-xs font-semibold ${
              ink
                ? 'border-white/[0.08] text-inkleaf-300'
                : 'border-ink-900/[0.07] text-inkleaf-600'
            }`}
          >
            {revisionPraise(edits.length, aiEditCount)}
          </p>
        </div>
      )}

      {/* ---- 语音片段留档 ---- */}
      {utterances.length > 0 && (
        <details className={`rounded-md px-3.5 py-2.5 ${S.panel}`}>
          <summary className={`cursor-pointer text-xs font-medium ${S.hint}`}>
            你一共说了 {utterances.length} 句话 · 点开看看
          </summary>
          <div className="mt-2 space-y-1.5">
            {utterances.map((u) => (
              <div key={u.id} className={`flex gap-2 text-xs ${S.hint2}`}>
                <span className="mt-0.5 shrink-0 opacity-60">
                  <IconMic size={13} />
                </span>
                <span className="min-w-0 flex-1 leading-relaxed">{u.text}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ---- 能力提示 ---- */}
      {!speechOk && (
        <div
          className={`rounded-md px-3.5 py-2.5 text-xs leading-relaxed ${
            ink
              ? 'bg-amber-leaf-300/[0.12] text-[var(--color-night-text-2)] shadow-[var(--hair-light)]'
              : 'bg-clay-50 text-ink-700 shadow-[inset_0_0_0_1px_rgb(168_80_63/0.18)]'
          }`}
        >
          这台设备不支持语音识别。
          {voiceOnly ? (
            <>
              <br />
              日记需要在支持语音的设备上写（比如手机上的 App）。
            </>
          ) : (
            <>
              <br />
              先用「键盘输入」也一样可以写。
            </>
          )}
        </div>
      )}

      {/* 字数提示只在纸面场景显示 —— 沉浸时由页面的进度条负责 */}
      {!ink && minWords > 0 && words > 0 && words < minWords && (
        <p className={`px-1 text-xs ${S.hint}`}>再写 {minWords - words} 字就到建议字数啦</p>
      )}
    </div>
  )
}

/* ============================================================
   子组件
   ============================================================ */

function ModeButton({
  active,
  onClick,
  icon,
  label,
  on,
  off,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  on: string
  off: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`btn-base active:btn-press flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-pill px-3 text-sm font-semibold transition-colors ${
        active ? on : off
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

/** 录音音量波形 —— 让"在听"看得见 */
function Waveform({ level, ink }: { level: number; ink: boolean }) {
  const bars = 7
  return (
    <span className="flex h-7 shrink-0 items-center gap-[3px]" aria-hidden>
      {Array.from({ length: bars }, (_, i) => {
        // 中间的条更高，形成对称的波形观感
        const center = Math.abs(i - (bars - 1) / 2)
        const factor = 1 - center / bars
        const h = 6 + level * 22 * factor + 4
        return (
          <span
            key={i}
            className={`w-[3px] rounded-pill transition-[height] duration-75 ${
              ink ? 'bg-inkleaf-300' : 'bg-amber-leaf-400'
            }`}
            style={{ height: `${Math.min(26, h)}px` }}
          />
        )
      })}
    </span>
  )
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}
