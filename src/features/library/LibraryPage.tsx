/* ============================================================
   系统作文题库 —— 浏览、搜索、导入导出
   ============================================================
   系统题库 = 内置 136 道题 + AI 出的题 + 你自己导入的题。
   这一页的核心任务：
     · 让孩子能快速找到想做的那道题（搜索 / 随机）
     · 让家长能把题库导出去（打印、换设备、备份）
   ============================================================ */

import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { useApp } from '../../store/useApp'
import {
  Button,
  Card,
  Chip,
  ConfirmDialog,
  EmptyState,
  SectionTitle,
  Sheet,
} from '../../components/ui'
import { IconBook, IconSearch } from '../../components/icons'
import { PromptImageArt, promptImageCaption } from '../../assets/scenes'
import {
  exportLibraryJson,
  exportLibraryMarkdown,
  libraryStats,
  randomFromLibrary,
  searchLibrary,
} from '../../domain/library'
import type { LibraryItem, LibraryQuery, LibrarySort } from '../../domain/library'
import { CATEGORIES, categoryMeta, gradeLabel } from '../../domain/types'
import type { CompositionCategory, GradeLevel } from '../../domain/types'
import { exportText, pickTextFile, timestampedName } from '../../platform/files'
import { navigateTo } from '../../shell/events'

/* 页面之间没有 props 通道，用外壳的导航事件切到写作页。
   以前这里是手写的 CustomEvent 字符串 —— 跟 shell/events.ts 里的
   事件名是两份拷贝，改名时会静默失联。统一走 navigateTo。 */
function goCompose(): void {
  navigateTo('compose')
}

const SORT_LABEL: Record<LibrarySort, string> = {
  recent: '最近使用',
  used: '用得最多',
  grade: '按年级',
  title: '按标题',
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border-0 bg-white shadow-[var(--hair)] bg-white px-2 py-2 text-center">
      <div className="tnum font-display text-lg font-extrabold text-ink-900">{value}</div>
      <div className="text-[11px] font-bold text-ink-500">{label}</div>
    </div>
  )
}

const INPUT_CLASS =
  'w-full rounded-md border-0 bg-white shadow-[var(--hair-strong)] bg-white px-3 py-2.5 text-sm outline-none focus:shadow-[0_0_0_2px_rgb(55_137_162/0.35)]'

/* ============================================================
   页面
   ============================================================ */

export default function LibraryPage(): ReactElement {
  const library = useApp((s) => s.library)
  const settings = useApp((s) => s.settings)
  const toast = useApp((s) => s.toast)
  const removeFromLibrary = useApp((s) => s.removeFromLibrary)
  const toggleLibraryFavorite = useApp((s) => s.toggleLibraryFavorite)
  const importLibraryJson = useApp((s) => s.importLibraryJson)
  const clearLibrary = useApp((s) => s.clearLibrary)
  const setPendingPrompt = useApp((s) => s.setPendingPrompt)

  const [keyword, setKeyword] = useState('')
  const [category, setCategory] = useState<CompositionCategory | 'all'>('all')
  const [grade, setGrade] = useState<GradeLevel | 'all'>('all')
  const [favoriteOnly, setFavoriteOnly] = useState(false)
  const [aiOnly, setAiOnly] = useState(false)
  const [sort, setSort] = useState<LibrarySort>('recent')

  const [preview, setPreview] = useState<LibraryItem | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<LibraryItem | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  const stats = useMemo(() => libraryStats(library), [library])

  const results = useMemo(() => {
    const query: LibraryQuery = {
      keyword: keyword.trim() || undefined,
      category: category === 'all' ? undefined : category,
      grade: grade === 'all' ? undefined : grade,
      favoriteOnly: favoriteOnly || undefined,
      aiOnly: aiOnly || undefined,
      sort,
    }
    return searchLibrary(library, query)
  }, [library, keyword, category, grade, favoriteOnly, aiOnly, sort])

  /* ---------------- 动作 ---------------- */

  // 别叫 usePrompt —— 以 use 开头会被 ESLint 当成 hook，
  // 而它只是在事件回调里跑的普通函数。改名避免误判。
  const choosePrompt = (item: LibraryItem) => {
    /* 关键一步：把题目交出去。
       以前这里只 dispatch 了一次跳转 + 弹了个 toast，题目本身谁也没拿到 ——
       写作页重新挂载后仍停在「出题」步、一道题都没选中，
       孩子看到的就是「点了『就用这题』，页面跳过去但什么都做不了」。
       现在写进 store 的 pendingPrompt，写作页挂载时自取（见 ComposePage）。 */
    setPendingPrompt(item)
    setPreview(null)
    goCompose()
    toast({
      kind: 'success',
      title: '题目选好啦',
      detail: `《${item.title}》—— 去作文页开始写吧`,
      emoji: '✏️',
    })
  }

  const pickRandom = () => {
    const item = randomFromLibrary(library, { grade: settings.grade })
    if (!item) {
      toast({ kind: 'warn', title: '题库还是空的', emoji: '📭' })
      return
    }
    setPreview(item)
  }

  const handleDelete = async (id: string) => {
    await removeFromLibrary(id)
    setConfirmDelete(null)
    setPreview(null)
    toast({ kind: 'info', title: '题目删掉了', emoji: '🗑️' })
  }

  const handleExportJson = async () => {
    const r = await exportText(
      timestampedName('系统作文题库', 'json'),
      exportLibraryJson(library),
    )
    toast({
      kind: r.ok ? 'success' : 'warn',
      title: r.ok ? '题库导出成功' : '导出失败',
      detail: r.message,
      emoji: r.ok ? '💾' : '⚠️',
    })
  }

  const handleExportMarkdown = async () => {
    const r = await exportText(
      timestampedName('系统作文题库', 'md'),
      exportLibraryMarkdown(library),
      'text/markdown',
    )
    toast({
      kind: r.ok ? 'success' : 'warn',
      title: r.ok ? '已导出可打印版' : '导出失败',
      detail: r.message,
      emoji: r.ok ? '🖨️' : '⚠️',
    })
  }

  const handleImport = async () => {
    const file = await pickTextFile()
    if (!file) return
    const r = await importLibraryJson(file.content)

    if (!r.ok) {
      // 有具体原因就把原因念出来 —— 手写的数据文件里少个字段，
      // 只说「导入失败」等于让人回去逐行猜
      toast({
        kind: 'warn',
        title: '导入失败',
        detail: r.problems.length > 0 ? r.problems.join('；') : (r.error ?? '文件格式不对'),
        emoji: '⚠️',
      })
      return
    }

    const parts: string[] = []
    if (r.added > 0) parts.push(`新增 ${r.added} 题`)
    if (r.skipped > 0) parts.push(`跳过 ${r.skipped} 题（库里已经有了）`)
    if (parts.length === 0) parts.push('没有新的题')

    toast({
      kind: r.invalid > 0 ? 'warn' : 'success',
      title: r.invalid > 0 ? '导入完成，有数据被跳过' : '导入成功',
      detail: parts.join('，') + (r.problems.length > 0 ? `　${r.problems[0]}` : ''),
      emoji: r.invalid > 0 ? '⚠️' : '📥',
    })
  }

  const handleClear = async () => {
    await clearLibrary()
    setConfirmClear(false)
    toast({ kind: 'info', title: '题库已清空', emoji: '🧹' })
  }

  /* ---------------- 渲染 ---------------- */

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 pt-safe pb-safe">
      {/* ---------- 标题 ---------- */}
      <SectionTitle
        icon={<IconBook size={17} />}
        title="系统作文题库"
        sub="AI 出过的题都会存在这里"
        right={
          library.length > 0 ? (
            <Button size="sm" tone="quiet" onClick={pickRandom}>
              🎲 随机抽一题
            </Button>
          ) : undefined
        }
      />

      {library.length === 0 ? (
        /* ---------- 空题库 ---------- */
        <Card paper>
          <EmptyState
            mood="curious"
            title="题库还是空的"
            desc="去「作文」页出一道题，生成的题目会自动存到这里，以后就能反复用啦。"
            action={
              <Button tone="primary" onClick={goCompose}>
                去作文页出一题 →
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {/* ---------- 统计 ---------- */}
          <Card paper>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatBox label="题目总数" value={`${stats.total}`} />
              <StatBox label="收藏" value={`${stats.favorites}`} />
              <StatBox label="累计使用" value={`${stats.totalUses}`} />
              <StatBox label="AI 生成" value={`${stats.bySource.ai}`} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <span
                  key={c.key}
                  className="rounded-pill border-0 bg-white shadow-[var(--hair)] bg-white px-2.5 py-1 text-[11px] font-bold text-ink-700"
                >
                  {c.emoji} {c.label} {stats.byCategory[c.key]}
                </span>
              ))}
            </div>
            {stats.mostUsed && (
              <p className="mt-2 text-xs text-ink-500">
                做得最多的一题：《{stats.mostUsed.title}》共 {stats.mostUsed.timesUsed} 次
              </p>
            )}
          </Card>

          {/* ---------- 搜索与筛选 ---------- */}
          <Card paper>
            <div className="space-y-3">
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜题目、搜引导语…"
                className={INPUT_CLASS}
              />

              <div className="flex flex-wrap gap-2">
                <Chip active={category === 'all'} onClick={() => setCategory('all')}>
                  全部
                </Chip>
                {CATEGORIES.map((c) => (
                  <Chip
                    key={c.key}
                    active={category === c.key}
                    onClick={() => setCategory(c.key)}
                  >
                    {c.emoji} {c.label}
                  </Chip>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Chip active={favoriteOnly} onClick={() => setFavoriteOnly((v) => !v)}>
                  ⭐ 只看收藏
                </Chip>
                <Chip active={aiOnly} onClick={() => setAiOnly((v) => !v)}>
                  🤖 只看 AI 出的
                </Chip>
              </div>

              <div className="flex flex-wrap gap-2">
                <select
                  value={grade === 'all' ? 'all' : String(grade)}
                  onChange={(e) =>
                    setGrade(e.target.value === 'all' ? 'all' : (Number(e.target.value) as GradeLevel))
                  }
                  className={`${INPUT_CLASS} flex-1`}
                  aria-label="按年级筛选"
                >
                  <option value="all">全部年级</option>
                  {([1, 2, 3, 4, 5, 6, 7, 8, 9] as GradeLevel[]).map((g) => (
                    <option key={g} value={g}>
                      {gradeLabel(g)}
                    </option>
                  ))}
                </select>

                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as LibrarySort)}
                  className={`${INPUT_CLASS} flex-1`}
                  aria-label="排序方式"
                >
                  {(Object.keys(SORT_LABEL) as LibrarySort[]).map((s) => (
                    <option key={s} value={s}>
                      {SORT_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </Card>

          {/* ---------- 题目列表 ---------- */}
          {results.length === 0 ? (
            <Card paper>
              <EmptyState
                icon={<IconSearch size={17} />}
                title="没有找到符合条件的题"
                desc="换个关键词或者清掉筛选条件试试？"
                action={
                  <Button
                    onClick={() => {
                      setKeyword('')
                      setCategory('all')
                      setGrade('all')
                      setFavoriteOnly(false)
                      setAiOnly(false)
                    }}
                  >
                    清空筛选
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="space-y-2.5">
              {results.map((it) => {
                const cat = categoryMeta(it.category)
                return (
                  <div
                    key={it.id}
                    onClick={() => setPreview(it)}
                    className="cursor-pointer rounded-md bg-white p-3.5 shadow-[var(--hair)] transition hover:bg-amber-leaf-50/60 hover:shadow-[var(--hair-amber)]"
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="text-xl">{cat.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <h3 className="truncate font-display text-base font-extrabold text-ink-900">
                            {it.title}
                          </h3>
                          <span className="shrink-0 rounded-pill bg-paper-2 px-2 py-0.5 text-[10px] font-extrabold text-ink-700">
                            {cat.label}
                          </span>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-ink-700">
                          {it.lead}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-500">
                          <span>
                            {gradeLabel(it.minGrade)}–{gradeLabel(it.maxGrade)}
                          </span>
                          <span>
                            {it.wordRange[0]}-{it.wordRange[1]} 字
                          </span>
                          <span>用过 {it.timesUsed} 次</span>
                          <span>
                            {it.source === 'ai'
                              ? 'AI 出的'
                              : it.source === 'imported'
                                ? '导入的'
                                : '本地出的'}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={it.favorite ? '取消收藏' : '收藏'}
                        onClick={(e) => {
                          e.stopPropagation()
                          void toggleLibraryFavorite(it.id)
                        }}
                        className="btn-base active:btn-press grid h-11 w-11 shrink-0 place-items-center rounded-full border-0 bg-white shadow-[var(--hair-strong)] bg-white text-lg shadow-[var(--hair)]"
                      >
                        {it.favorite ? '⭐' : '☆'}
                      </button>
                    </div>

                    <div className="mt-2 flex gap-2" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" onClick={() => choosePrompt(it)}>
                        就用这题
                      </Button>
                      <Button size="sm" tone="danger" onClick={() => setConfirmDelete(it)}>
                        删除
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ---------- 导入导出 ---------- */}
      <Card paper>
        <SectionTitle icon={<IconBook size={17} />} title="题库导出 / 导入" sub="导出来就能打印，或者换设备接着用" />
        <div className="space-y-2">
          <Button full disabled={library.length === 0} onClick={() => void handleExportJson()}>
            💾 导出 JSON（完整备份）
          </Button>
          <Button full disabled={library.length === 0} onClick={() => void handleExportMarkdown()}>
            🖨️ 导出 Markdown（方便打印）
          </Button>
          <Button full onClick={() => void handleImport()}>
            📥 导入题库
          </Button>
          <p className="px-1 text-[11px] leading-relaxed text-ink-500">
            导入是<strong className="font-bold text-ink-700">累加</strong>的：只往题库里加，不会覆盖已有的题。
            同一道题导两次也只算一道。手写的数据文件（题目 + 图片地址）也能直接导进来。
          </p>
          <Button
            full
            tone="danger"
            disabled={library.length === 0}
            onClick={() => setConfirmClear(true)}
          >
            🧹 清空题库
          </Button>
        </div>
      </Card>

      {/* ---------- 题目预览 ---------- */}
      <Sheet
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.title}
        footer={
          preview ? (
            <div className="flex gap-2">
              <Button
                full
                onClick={() => {
                  void toggleLibraryFavorite(preview.id)
                  // 本地同步预览里的收藏态，避免要重开才更新
                  setPreview({ ...preview, favorite: !preview.favorite })
                }}
              >
                {preview.favorite ? '⭐ 取消收藏' : '☆ 收藏'}
              </Button>
              <Button full tone="primary" onClick={() => choosePrompt(preview)}>
                就用这题写
              </Button>
            </div>
          ) : undefined
        }
      >
        {preview && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-pill bg-paper-2 px-2 py-0.5 font-extrabold text-ink-700">
                {categoryMeta(preview.category).emoji} {categoryMeta(preview.category).label}
              </span>
              <span className="text-ink-500">
                {gradeLabel(preview.minGrade)}–{gradeLabel(preview.maxGrade)}
              </span>
              <span className="text-ink-500">
                {preview.wordRange[0]}-{preview.wordRange[1]} 字
              </span>
              {preview.timesUsed > 0 && (
                <span className="text-ink-500">用过 {preview.timesUsed} 次</span>
              )}
            </div>

            <p className="text-sm font-bold leading-relaxed text-ink-800">{preview.lead}</p>

            {preview.images.length > 0 ? (
              <div className="space-y-3">
                {preview.images.map((img, i) => (
                  <div key={i}>
                    <PromptImageArt image={img} className="w-full rounded-md" />
                    <div className="mt-1 text-center text-[11px] text-ink-500">
                      {promptImageCaption(img)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink-500">这道题没有配图。</p>
            )}

            <Button full tone="danger" onClick={() => setConfirmDelete(preview)}>
              删除这道题
            </Button>
          </div>
        )}
      </Sheet>

      {/* ---------- 确认对话框 ---------- */}
      <ConfirmDialog
        open={Boolean(confirmDelete)}
        danger
        title="删掉这道题？"
        desc="只从题库里移除，不会影响已经写过的作文。"
        confirmText="删掉"
        cancelText="再想想"
        onConfirm={() => {
          if (confirmDelete) void handleDelete(confirmDelete.id)
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      <ConfirmDialog
        open={confirmClear}
        danger
        title="清空整个题库？"
        desc="所有题目都会消失，且无法恢复。建议先导出备份。"
        confirmText="确认清空"
        cancelText="再想想"
        onConfirm={() => void handleClear()}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  )
}
