/* ============================================================
   录音工具 —— dataURL ⇄ Blob
   ============================================================

   为什么单独一个文件（而不是留在 VoiceComposer 里）：

   这个函数是**纯函数、不含 React**，但它守着一个真机上的坑；
   而 `scripts/transcribe-e2e.test.ts` 要拿它把一段 WAV 变成 Blob
   去打真实服务。留在组件文件里的话，组件不 export 它，
   端到端测试就只能**抄一份** —— 抄的那份会和真的这份慢慢漂移，
   于是「测过了」和「线上跑的」不是同一段代码。
   这个项目已经吃过一次这个亏（见 `assets/scenes.tsx` 的注释：
   两条路径的兜底行为必须一致，否则同一个 bug 要修两遍）。

   所以挪出来，让**只有一份**。
   ============================================================ */

/**
 * 把录音器给的 dataURL 还原成 Blob。
 *
 * 录音器那边存的本来就是 dataURL（`<audio src>` 能直接放），
 * 而上传要的是二进制，所以在这里转回来一次。
 *
 * ⚠️ 用 `atob` 而不是 `fetch(dataUrl)`：安卓 WebView 里对 data: 协议
 * 发 fetch 属于混合内容，会被拦掉 —— 而且报错很难懂。
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return new Blob([], { type: 'audio/webm' })

  const header = dataUrl.slice(0, comma)
  const body = dataUrl.slice(comma + 1)
  const mime = /data:([^;]+)/.exec(header)?.[1] ?? 'audio/webm'

  // 录音器用的是 readAsDataURL，默认 base64；以防万一也认一下明文
  if (!header.includes('base64')) {
    return new Blob([decodeURIComponent(body)], { type: mime })
  }

  const bin = atob(body)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}
