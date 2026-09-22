package com.littlewriterforest.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

/**
 * 应用入口。
 *
 * 三件事，前两件必须发生在 super.onCreate() 之前：
 *
 *   1. registerPlugin —— Capacitor 的插件是在 super.onCreate() 里建桥的，
 *      晚一步注册就再也挂不上去了。
 *
 *   2. installSplashScreen —— 让 core-splashscreen 收尾启动主题：
 *      它会在第一帧画出来后把主题换成 postSplashScreenTheme（见 styles.xml），
 *      于是「墨夜底 + 自己的图标」的系统开场画面能干净地交给 App 自己的开场画面，
 *      不会先白一下、也不会在顶上闪出一条系统标题栏。
 *
 *   3. ★ 给 WebView 放行麦克风（下面详述）—— 这一步在 super.onCreate() 之后。
 *
 * 全都包了 try/catch：启动路径上任何一点小问题都不该让 App 起不来。
 */
public class MainActivity extends BridgeActivity {

    /** 我们自己发起运行时权限请求时用的请求码 */
    private static final int REQ_RECORD_AUDIO = 0x5A17;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        try {
            registerPlugin(LittleSpeechPlugin.class);
        } catch (Throwable ignored) {
            // 插件挂不上只会让语音退回键盘输入，不影响 App 启动
        }

        try {
            registerPlugin(VolcWebSocketPlugin.class);
        } catch (Throwable ignored) {
            // 挂不上就退回「整包上传」那条转写路，不影响 App 启动
        }

        try {
            SplashScreen.installSplashScreen(this);
        } catch (Throwable ignored) {
            // 主题没配好也不该让 App 起不来
        }

        super.onCreate(savedInstanceState);

        try {
            allowWebViewMicrophone();
        } catch (Throwable ignored) {
            // 配不上就退回系统识别 / 键盘输入，不能因此起不来
        }
    }

    /* ============================================================
       为什么必须自己接管 WebView 的麦克风权限
       ------------------------------------------------------------
       云端语音转写那条路（录下来 → 上传识别）走的是 **WebView 里的
       getUserMedia + MediaRecorder**，不是原生录音。
       而 WebView 的 getUserMedia 默认是**被拒绝**的：

         网页侧 navigator.mediaDevices.getUserMedia()
           → WebView 回调 onPermissionRequest()
             → 默认实现直接 deny()

       默认那一下 deny 之后，前端拿到的就是一个权限异常，
       表现正是"按住了、也松手了，但什么都没发生 / 提示麦克风打不开"。

       ⚠️ AndroidManifest 里的 RECORD_AUDIO 只管**系统权限**，
       它跟"WebView 允不允许这个页面用麦克风"是两件事，缺一不可。
       只声明不接管 onPermissionRequest，就是"装了麦克风但没插线"。

       原生识别那条路不受影响：它走 LittleSpeechPlugin 的
       requestPermissionForAlias，是 Capacitor 自己那套。
       ============================================================ */
    private void allowWebViewMicrophone() {
        if (getBridge() == null || getBridge().getWebView() == null) return;

        final android.webkit.WebView webView = getBridge().getWebView();

        // 先确认系统权限本身拿到了；没有就主动要一次（用系统对话框）
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                    this,
                    new String[] { Manifest.permission.RECORD_AUDIO },
                    REQ_RECORD_AUDIO);
        }

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    // ★ 只在**系统权限确实已授予**时才放行。
                    //   否则等于绕过用户意愿，是安全问题。
                    boolean micOk = ContextCompat.checkSelfPermission(
                            MainActivity.this, Manifest.permission.RECORD_AUDIO)
                            == PackageManager.PERMISSION_GRANTED;
                    if (!micOk) {
                        request.deny();
                        return;
                    }
                    for (String res : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) {
                            request.grant(new String[] { res });
                            return;
                        }
                    }
                    // 请求的不是麦克风（理论上不会走到）—— 明确拒绝，不默认放行
                    request.deny();
                });
            }
        });
    }
}
