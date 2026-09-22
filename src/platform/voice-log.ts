/* ============================================================
   语音链路的诊断日志
   ============================================================

   为什么单独一个文件：这条链路上有三个环节分属不同模块 ——
     录音器（speech.ts）、按住说话按钮（VoiceComposer.tsx）、
     上传转写（transcribe.ts）。
   它们各自都可能"默默失败"，而失败在界面上长得**一模一样**：
   「按住说了，一个字没出来」。

   要能一眼分清是没录到、没传出去、还是服务端没回话，
   三段日志就必须用同一个标签，`adb logcat` 里一次捞全。
   所以标签和格式化放在这里，谁都能用。

   日志出现在两处，都不需要额外配置：
     · 电脑/浏览器：开发者工具的 Console；
     · 安卓真机：`adb logcat`，标签 `Capacitor/Console`。

   ⚠️ 真机那条**只有 debug 包才有**：Capacitor 的 `android.loggingBehavior`
      默认值是 `debug`，即 `loggingEnabled = isDebug`（见 Capability 源码
      CapConfig.java 的 initLogging）。所以 release 包不会把孩子说的话
      写进系统日志 —— 这个默认值刚好是我们想要的，
      **不要**为了调试把它改成 production。

   真机验收：`npm run apk`（debug 包）+ `npm run verify:device`。
   ============================================================ */

/** 日志标签。`scripts/verify-device.mjs` 按它过滤 logcat，改这里要同步改那边。 */
export const VOICE_LOG_TAG = '[语音转写]'

/** 打印一条带统一标签的诊断。第二个参数是结构化补充信息，方便 logcat 里扫读。 */
export function voiceDiag(msg: string, extra?: Record<string, unknown>): void {
  console.log(`${VOICE_LOG_TAG} ${msg}`, extra ?? '')
}

/**
 * 日志里不要把整段话都打出去 —— 孩子说的话属于隐私，
 * 而且真机日志没人会去删。够判断"识别对了没"就行。
 */
export function clip(text: string, max = 60): string {
  return text.length <= max ? text : `${text.slice(0, max)}…(${text.length}字)`
}
