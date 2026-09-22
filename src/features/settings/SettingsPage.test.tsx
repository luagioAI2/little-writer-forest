/* ============================================================
   设置 · 小朋友信息 —— 昵称与头像
   ============================================================

   真实故障（家长报）：
     「另外 设置了名字。再选择头像，名字就清除了。这个 BUG 没修复。」

   查下来是同一段代码里的**两个**毛病（都在昵称的落盘上）：

   ① **只在失焦时保存** —— `onBlur={commitName}`。
      打完名字**直接点头像**时，那一下 tap 不一定先让输入框失焦，
      于是 `onBlur` 不触发、名字压根没存；而输入框还显示着新名字，
      看着像存上了。下次进设置页 `useState(settings.childName)` 重新初始化，
      名字又回到旧的 —— 家长看到的就是「名字没了」。

   ② **空名字原样落盘** —— 清空输入框再失焦会把 `''` 写进存档。
      空名字在 `{childName} · 三年级`、`XX 的森林` 里渲染成一片空白 ——
      这才是「名字被清除」的字面来源。

   修法：**边打边存**（不再依赖失焦）+ 点头像时补存一次 +
   落盘前统一走 `normalizeName`（空 → `DEFAULT_CHILD_NAME`）。

   本文件钉住三件事：
     ① 打完名字**不失焦**直接点头像，名字必须存下来；
     ② 任何操作之后，存档里的名字**都不许是空字符串**；
     ③ 头像本身照常能选上（别为了修名字把头像弄坏了）。

   ⚠️ `fake-indexeddb/auto` 必须第一个 import —— db.ts 在模块顶层就
   `new LittleWriterDb()`，构造时要能拿到全局 indexedDB。
   ============================================================ */

import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useApp } from '../../store/useApp'
import { DEFAULT_CHILD_NAME } from '../../domain/types'
import SettingsPage from './SettingsPage'

/** 过家长密码（默认 0000） */
function unlock() {
  for (let i = 0; i < 4; i++) {
    fireEvent.click(screen.getByRole('button', { name: '数字 0' }))
  }
}

function openSettings() {
  render(<SettingsPage onBack={() => {}} />)
  unlock()
  return screen.getByPlaceholderText('比如：豆豆') as HTMLInputElement
}

function avatarBtn(emoji: string) {
  return screen.getByRole('button', { name: `选头像 ${emoji}` })
}

/** 存档里的名字 */
function savedName() {
  return useApp.getState().settings.childName
}

beforeEach(() => {
  useApp.setState({
    settings: {
      ...useApp.getState().settings,
      childName: DEFAULT_CHILD_NAME,
      avatar: '🌱',
      parentPin: null,
    },
  })
})

describe('设置 · 昵称与头像', () => {
  it('★★ 打完名字**不失焦**直接点头像 —— 名字必须存下来（真实故障）', async () => {
    const input = openSettings()

    /* 只改内容，**故意不触发 blur** —— 真机上点按钮不保证会先失焦 */
    fireEvent.change(input, { target: { value: '豆豆' } })
    fireEvent.click(avatarBtn('🐰'))

    await waitFor(() => expect(useApp.getState().settings.avatar).toBe('🐰'))
    expect(savedName()).toBe('豆豆')
  })

  it('对照：先失焦再点头像，结果同样是存下来的（原路径不能被改坏）', async () => {
    const input = openSettings()

    fireEvent.change(input, { target: { value: '豆豆' } })
    fireEvent.blur(input)
    fireEvent.click(avatarBtn('🦊'))

    await waitFor(() => expect(useApp.getState().settings.avatar).toBe('🦊'))
    expect(savedName()).toBe('豆豆')
  })

  it('★ 清空昵称不会留下空字符串 —— 回到默认名（原来会写成 `\'\'`，界面变空白）', async () => {
    const input = openSettings()

    fireEvent.change(input, { target: { value: '豆豆' } })
    expect(savedName()).toBe('豆豆')

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    expect(savedName()).toBe(DEFAULT_CHILD_NAME)
    expect(savedName()).not.toBe('')
  })

  it('★ 只打了空格也算没起名 —— 不会存成一串空格', async () => {
    const input = openSettings()

    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)

    expect(savedName()).toBe(DEFAULT_CHILD_NAME)
  })

  it('★ 头像按钮不能把名字弄丢 —— 连点几个头像，名字始终在', async () => {
    const input = openSettings()
    fireEvent.change(input, { target: { value: '豆豆' } })

    for (const e of ['🐣', '🐼', '🚀']) {
      fireEvent.click(avatarBtn(e))
      await waitFor(() => expect(useApp.getState().settings.avatar).toBe(e))
      expect(savedName()).toBe('豆豆')
    }
  })

  it('★ 扫一遍：各种操作组合之后，存档里的名字都不许是空字符串', async () => {
    const input = openSettings()

    /* 打完就点头像 */
    fireEvent.change(input, { target: { value: '朵朵' } })
    fireEvent.click(avatarBtn('⭐'))
    expect(savedName()).not.toBe('')

    /* 清空后点头像 */
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(avatarBtn('🌈'))
    expect(savedName()).not.toBe('')

    /* 清空后失焦 */
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(savedName()).not.toBe('')

    /* 再来一次正常的 */
    fireEvent.change(input, { target: { value: '朵朵' } })
    fireEvent.click(avatarBtn('🌻'))
    expect(savedName()).toBe('朵朵')

    expect(savedName()).not.toBe('')
  })

  it('昵称和头像互不干扰 —— 改名字不会把头像清掉', async () => {
    const input = openSettings()

    fireEvent.click(avatarBtn('🐸'))
    await waitFor(() => expect(useApp.getState().settings.avatar).toBe('🐸'))

    fireEvent.change(input, { target: { value: '豆豆' } })

    expect(savedName()).toBe('豆豆')
    expect(useApp.getState().settings.avatar).toBe('🐸')
  })
})
