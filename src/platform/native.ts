/* ============================================================
   原生环境探测
   ============================================================
   单独成文件，避免 platform/files 与 platform/native 互相引用。
   ============================================================ */

export function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  if (cap?.isNativePlatform) {
    try {
      return cap.isNativePlatform()
    } catch {
      return false
    }
  }
  // 退而求其次：APK 里页面来自 file:// 或 capacitor://
  const proto = window.location.protocol
  return proto === 'file:' || proto === 'capacitor:' || proto === 'ionic:'
}
