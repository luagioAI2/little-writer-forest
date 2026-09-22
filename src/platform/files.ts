/* ============================================================
   文件导出 / 导入适配
   ============================================================

   浏览器里用 <a download>；原生（Capacitor）里走 Filesystem + Share。
   两条路都实现，调用方只需要 await exportText(...)。
   ============================================================ */

import { isNativePlatform } from './native'

export function isNative(): boolean {
  return isNativePlatform()
}

/** 触发浏览器下载 */
function downloadInBrowser(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 给浏览器一点时间开始下载再回收
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/**
 * 导出一个文本文件。
 * 原生环境下写到缓存目录再调系统分享，这样家长能存到微信/网盘。
 */
export async function exportText(
  filename: string,
  content: string,
  mime = 'application/json',
): Promise<{ ok: boolean; message: string }> {
  if (!isNative()) {
    downloadInBrowser(filename, content, mime)
    return { ok: true, message: `已开始下载 ${filename}` }
  }

  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    const { Share } = await import('@capacitor/share')

    const res = await Filesystem.writeFile({
      path: filename,
      data: content,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    })

    await Share.share({
      title: filename,
      url: res.uri,
      dialogTitle: '保存或分享',
    })
    return { ok: true, message: `已导出 ${filename}` }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : '导出失败',
    }
  }
}

/** 让用户选一个文件并读出文本 */
export function pickTextFile(accept = '.json,.txt'): Promise<{
  name: string
  content: string
} | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    document.body.appendChild(input)

    let settled = false
    const finish = (v: { name: string; content: string } | null) => {
      if (settled) return
      settled = true
      document.body.removeChild(input)
      resolve(v)
    }

    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return finish(null)
      const reader = new FileReader()
      reader.onload = () => finish({ name: file.name, content: String(reader.result ?? '') })
      reader.onerror = () => finish(null)
      reader.readAsText(file)
    }

    // 用户取消时不会触发 change，这里不做超时兜底（会误判）
    input.click()
  })
}

/** 生成带时间戳的文件名 */
export function timestampedName(base: string, ext: string, now = Date.now()): string {
  const d = new Date(now)
  const p = (n: number) => (n < 10 ? `0${n}` : String(n))
  return `${base}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`
}
