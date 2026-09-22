#!/usr/bin/env node
/* ============================================================
   图片入库助手 —— 把「贴进来的图」或「你给的图片路径」变成
   public/photos/ 里的图 + 一段可以直接粘进题库条目的 images JSON
   ============================================================

   为什么要有这个脚本：题库条目的 images 有两种来源，
   而这两种来源各自都有一堆手工活和坑：

     · 贴图  → 图落在 WorkBuddy 的 blob 库里，文件名是 sha256，
               没有原名、没有后缀线索，靠眼睛找很容易拿错
     · 路径  → 直接能用，但手机原图 3-5 MB，原样放进 public/
               会被打进 APK，包体积悄悄涨十几 MB

   所以这里把「找到图 → 编号命名 → 压到合理尺寸 → 吐出 images JSON」
   一条做完，并且**每一步都报出来**（这个项目最恨静默）。

   ⚠️ 一条硬规矩：**缩放后如果反而更大，就保留原图。**
      这不是杞人忧天 —— canvas 重编码 PNG 时拿不到原图的压缩优化，
      实测 828×1792 的 PNG 缩到 739×1600 之后反而从 591 KB 涨到 680 KB。
      所以脚本会把「原图 / 缩放·PNG / 缩放·JPEG」都算出来，**挑最小的那个**。
      宁可什么都没省，也不能悄悄把包撑大。

   用法
   ------------------------------------------------------------
   # ① 看看最近贴进来的图（只列，不拷）—— 用来确认哪几张是刚贴的
   node scripts/inbox-photo.mjs --recent 5

   # ② 从路径拷（可以混着给多个文件，也可以给目录）
   node scripts/inbox-photo.mjs --slug rain-campus "E:/photos/雨.jpg" "E:/photos/操场.png"

   # ③ 把上一步列出来的 blob 直接拷进来
   node scripts/inbox-photo.mjs --slug rain-campus "<blob 路径>" "<blob 路径>"

   选项
   ------------------------------------------------------------
   --slug <短名>   文件名前缀，必填（--recent 除外）。最终是 <短名>-1.jpg
   --max <像素>    最长边超过就等比缩小，默认 1600
   --min-kb <KB>   单张小于这个大小就原样拷贝、不动它，默认 400
   --no-convert    只允许同格式缩放，不往 JPEG 转（截图里文字多时有用）
   --recent [N]    列出最近 N 张（默认 5）贴进来的图，只列不拷
   ============================================================ */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'])

/** 贴进来的图落在哪：WorkBuddy 的内容寻址 blob 库，blobs/<sha 前两位>/<sha256>.<ext> */
const BLOB_DIR = join(homedir(), '.workbuddy-ai', 'blobs')

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  join(homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
].filter(Boolean)

const ROOT = resolve(process.cwd())
const PHOTO_DIR = join(ROOT, 'public', 'photos')

/* ---------------- 参数 ---------------- */

function fail(msg) {
  console.error(`\n✖ ${msg}\n`)
  process.exit(2)
}

function parseArgs(argv) {
  const opts = { sources: [], slug: '', max: 1600, minKb: 400, recent: null, convert: true }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--slug') opts.slug = argv[++i] ?? ''
    else if (a === '--max') opts.max = Number(argv[++i])
    else if (a === '--min-kb') opts.minKb = Number(argv[++i])
    else if (a === '--no-convert') opts.convert = false
    else if (a === '--recent') {
      const next = argv[i + 1]
      if (next && /^\d+$/.test(next)) {
        opts.recent = Number(next)
        i += 1
      } else opts.recent = 5
    } else if (a.startsWith('--')) fail(`不认识的选项：${a}`)
    else opts.sources.push(a)
  }
  return opts
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`

/* ---------------- 一、列出最近贴进来的图 ---------------- */

function listRecent(n) {
  if (!existsSync(BLOB_DIR)) return []
  const out = []
  for (const bucket of readdirSync(BLOB_DIR)) {
    const dir = join(BLOB_DIR, bucket)
    let entries
    try {
      if (!statSync(dir).isDirectory()) continue
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (!IMAGE_EXT.has(extname(name).toLowerCase())) continue
      try {
        const st = statSync(join(dir, name))
        out.push({ path: join(dir, name), mtime: st.mtimeMs, size: st.size })
      } catch {
        /* 读不到就跳过 */
      }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, n)
}

function cmdRecent(n) {
  const rows = listRecent(n)
  if (rows.length === 0) {
    console.log(`\n没有在 blob 库里找到图片（${BLOB_DIR}）`)
    console.log('贴进来的图应该落在那个目录。找不到就直接用图片路径。\n')
    return
  }
  console.log(`\n最近贴进来的 ${rows.length} 张图（${BLOB_DIR}）\n`)
  console.log('  时间      大小        路径')
  console.log('  --------  ----------  ------------------------------------------')
  for (const r of rows) {
    console.log(
      `  ${new Date(r.mtime).toTimeString().slice(0, 8)}  ${kb(r.size).padStart(10)}  ${r.path}`,
    )
  }
  console.log('\n下一步：确认哪几张是你要的，然后')
  console.log(`  node scripts/inbox-photo.mjs --slug <短名> "<上面的路径>" ...\n`)
}

/* ---------------- 二、收集来源 ---------------- */

function collectSources(sources) {
  const files = []
  for (const s of sources) {
    const p = resolve(s)
    if (!existsSync(p)) fail(`找不到：${s}`)
    if (statSync(p).isDirectory()) {
      const inside = readdirSync(p)
        .filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()))
        .sort()
        .map((f) => join(p, f))
      if (inside.length === 0) fail(`目录里没有图片：${s}`)
      files.push(...inside)
    } else {
      if (!IMAGE_EXT.has(extname(p).toLowerCase())) fail(`不是图片文件：${s}`)
      files.push(p)
    }
  }
  return files
}

/* ---------------- 三、编码候选（无新依赖：借 headless Chrome 的 canvas） ---------------- */

const mimeOf = (ext) =>
  ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png'

const bytesOfDataUrl = (url) => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')

/** 把图缩放后编成几种格式的候选，交给调用方挑最小的 */
async function encodeCandidates(src, maxEdge) {
  const chrome = CHROME_CANDIDATES.find((p) => existsSync(p))
  if (!chrome) throw new Error('找不到 Chrome')

  const dataUrl = `data:${mimeOf(extname(src).toLowerCase())};base64,${readFileSync(src).toString('base64')}`
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  try {
    const page = await browser.newPage()
    const enc = await page.evaluate(
      async (url, limit) => {
        const img = new Image()
        img.src = url
        await img.decode()
        const scale = Math.min(1, limit / Math.max(img.naturalWidth, img.naturalHeight))
        const w = Math.max(1, Math.round(img.naturalWidth * scale))
        const h = Math.max(1, Math.round(img.naturalHeight * scale))
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d')
        ctx.drawImage(img, 0, 0, w, h)

        // 有透明像素就不能转 JPEG，否则透明处会变成黑块
        const px = ctx.getImageData(0, 0, w, h).data
        let hasAlpha = false
        for (let i = 3; i < px.length; i += 4) {
          if (px[i] < 255) {
            hasAlpha = true
            break
          }
        }

        return {
          srcW: img.naturalWidth,
          srcH: img.naturalHeight,
          w,
          h,
          hasAlpha,
          png: c.toDataURL('image/png'),
          jpeg: hasAlpha ? null : c.toDataURL('image/jpeg', 0.82),
        }
      },
      dataUrl,
      maxEdge,
    )
    return {
      ...enc,
      candidates: [
        { buf: bytesOfDataUrl(enc.png), ext: '.png', how: '缩放 · PNG' },
        ...(enc.jpeg ? [{ buf: bytesOfDataUrl(enc.jpeg), ext: '.jpg', how: '缩放 · JPEG' }] : []),
      ],
    }
  } finally {
    await browser.close()
  }
}

/* ---------------- 四、主流程 ---------------- */

/** 为一张图挑出最终要落盘的那份字节：原图 / 缩放后的各格式里最小的 */
async function pickWinner(src, opts) {
  const original = readFileSync(src)
  const before = original.length
  let winner = { buf: original, ext: extname(src).toLowerCase(), how: '原样' }
  let dims = null

  if (before <= opts.minKb * 1024) return { winner, before, dims }

  const enc = await encodeCandidates(src, opts.max)
  dims = enc
  const pool = opts.convert
    ? enc.candidates
    : enc.candidates.filter((c) => c.ext === extname(src).toLowerCase())

  const best = pool.reduce((a, b) => (b.buf.length < a.buf.length ? b : a))
  if (best.buf.length < before) winner = best
  else winner = { buf: original, ext: extname(src).toLowerCase(), how: '缩放反而更大，留原图' }

  return { winner, before, dims }
}

async function cmdCopy(opts) {
  if (!opts.slug) fail('缺 --slug（文件名前缀），比如 --slug rain-campus')
  if (!/^[a-z0-9][a-z0-9-]*$/.test(opts.slug)) {
    fail(`--slug 只能用小写字母、数字、连字符：${opts.slug}`)
  }

  const files = collectSources(opts.sources)
  if (files.length === 0) fail('一个来源都没给')

  mkdirSync(PHOTO_DIR, { recursive: true })

  const results = []
  let chromeBroken = false
  let index = 0

  for (const src of files) {
    index += 1
    let picked
    try {
      picked = await pickWinner(src, opts)
    } catch (err) {
      chromeBroken = true
      const buf = readFileSync(src)
      picked = {
        winner: { buf, ext: extname(src).toLowerCase(), how: '原样（缩放没跑成）' },
        before: buf.length,
        dims: null,
      }
      console.log(`  ⚠ ${basename(src)}：${err.message}`)
    }

    const name = `${opts.slug}-${index}${picked.winner.ext}`
    const dest = join(PHOTO_DIR, name)
    writeFileSync(dest, picked.winner.buf)

    results.push({
      name,
      src,
      before: picked.before,
      after: picked.winner.buf.length,
      how: picked.winner.how,
      dims: picked.dims
        ? `${picked.dims.srcW}×${picked.dims.srcH} → ${picked.dims.w}×${picked.dims.h}`
        : '',
    })
  }

  const totalBefore = results.reduce((n, r) => n + r.before, 0)
  const totalAfter = results.reduce((n, r) => n + r.after, 0)

  console.log(`\n拷进 public/photos/ 的 ${results.length} 张：\n`)
  console.log('  文件                          原大小 → 新大小   做了什么')
  console.log('  ----------------------------  ----------------  -----------------------------')
  for (const r of results) {
    const size = `${kb(r.before)} → ${kb(r.after)}`
    const how = r.dims ? `${r.how}  ${r.dims}` : r.how
    console.log(`  ${r.name.padEnd(28)}  ${size.padStart(16)}  ${how}`)
  }

  console.log(`\n合计：${kb(totalBefore)} → ${kb(totalAfter)}`)
  if (totalAfter < totalBefore) {
    console.log(`（省了 ${((1 - totalAfter / totalBefore) * 100).toFixed(0)}%，这些体积本来会整个进 APK）`)
  } else if (totalAfter > totalBefore) {
    console.log('（变大了 —— 说明这次没有可省的，或者缩放没跑成，看上面每行）')
  }
  if (chromeBroken) {
    console.log('\n⚠ 有图的缩放没跑成（上面标了「原样」的），会按原尺寸打进 APK。')
    console.log('  多半是 Chrome 没找到。设个 CHROME_PATH 再试，或者手动压一下。')
  }

  console.log('\n把这段粘进题库条目的 images 里（sceneKey 记得换成真的兜底插画）：\n')
  const images = results.map((r, i) => ({
    imageUrl: `/photos/${r.name}`,
    ...(results.length > 1 ? { caption: `第 ${i + 1} 幅` } : {}),
  }))
  console.log(
    JSON.stringify(images, null, 2)
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n'),
  )
  console.log('\n然后跑闸门确认能导进去：\n  npm run inbox:check\n')
}

/* ---------------- 入口 ---------------- */

const opts = parseArgs(process.argv.slice(2))
if (opts.recent !== null) cmdRecent(opts.recent)
else await cmdCopy(opts)
