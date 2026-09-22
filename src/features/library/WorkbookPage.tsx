/* ============================================================
   我的作文本 —— 孩子自己收藏的作文
   ============================================================
   每篇作文写完后，孩子在点评页点「收藏」才会进到这里。
   这是孩子自己的「作品集」，跟系统题库完全分开。
   ============================================================ */

import { useState } from 'react'
import { useApp } from '../../store/useApp'
import type { Work } from '../../domain/types'
import { categoryMeta } from '../../domain/types'
import { ScoreView } from '../compose/ScoreView'
import { Button, Card, EmptyState, SectionTitle, Sheet, Stars } from '../../components/ui'
import { IconBook, IconStarFilled } from '../../components/icons'

export default function WorkbookPage() {
  const works = useApp((s) => s.works)
  const toggleWorkFavorite = useApp((s) => s.toggleWorkFavorite)

  const favorites = works
    .filter((w) => w.favorite && w.score)
    .sort((a, b) => (b.scoredAt ?? b.createdAt) - (a.scoredAt ?? a.createdAt))

  const [preview, setPreview] = useState<Work | null>(null)

  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex-1 space-y-3 p-4">
        <SectionTitle
          icon={<IconBook size={17} />}
          title="我的作文本"
          sub={`共 ${favorites.length} 篇收藏的作文`}
        />

        {favorites.length === 0 ? (
          <EmptyState
            mood="happy"
            title="还没有收藏的作文"
            desc="写完一篇点评后，点「收藏这篇 · 放进我的作文本」就能在这里看到"
          />
        ) : (
          <div className="space-y-2.5">
            {favorites.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => setPreview(w)}
                className="w-full text-left"
              >
                <Card className="flex items-center gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-leaf-50 text-amber-leaf-500">
                    <IconStarFilled size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-display text-sm font-bold text-ink-900">
                      {w.title}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-2xs text-ink-500">
                      <span>{categoryMeta(w.category ?? 'event').label}</span>
                      <span>·</span>
                      <span>
                        {new Date(w.scoredAt ?? w.createdAt).toLocaleDateString('zh-CN', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                      {w.score && (
                        <>
                          <span>·</span>
                          <Stars count={w.score.stars} size="sm" />
                        </>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 text-amber-leaf-400">
                    <IconStarFilled size={14} />
                  </span>
                </Card>
              </button>
            ))}
          </div>
        )}
      </main>

      {/* 详情抽屉 */}
      <Sheet open={!!preview} onClose={() => setPreview(null)} title={preview?.title ?? ''}>
        {preview && preview.score && (
          <div className="space-y-3 p-4">
            <ScoreView key={preview.id} score={preview.score} />
            <Card tone="tint">
              <p className="whitespace-pre-wrap font-prose text-sm leading-loose text-ink-800">
                {preview.text}
              </p>
            </Card>
            <Button
              full
              onClick={() => void toggleWorkFavorite(preview.id)}
              icon={<IconStarFilled size={16} />}
            >
              {preview.favorite ? '取消收藏' : '收藏'}
            </Button>
          </div>
        )}
      </Sheet>
    </div>
  )
}
