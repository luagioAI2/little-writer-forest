package com.littlewriterforest.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;

/**
 * 语音识别 —— 安卓原生那一半。
 *
 * ============================================================
 * 为什么必须有这个插件
 * ============================================================
 *
 * 浏览器里的语音识别走 Web Speech API（webkitSpeechRecognition），
 * 但**安卓 WebView 里没有这个能力**：对象可能存在，底层却没有任何识别服务。
 * 之前 App 直接用了它，结果就是「在写作文页点一下麦克风就崩」。
 *
 * 安卓上正确的做法是用系统的 SpeechRecognizer
 * （它背后是设备厂商/Google 的识别服务，离线或在线由系统决定）。
 * 所以这里把系统能力包成一个 Capacitor 插件，
 * 前端拿到的是和浏览器版**同一套接口**（start / stop / cancel + 事件）。
 *
 * ============================================================
 * 设计取舍
 * ============================================================
 *
 *  · 连续听：系统的 SpeechRecognizer 说一句就结束，但孩子口述作文是
 *    「一句一句慢慢说」。所以在一句结果/一次"没听清"之后自动续上，
 *    直到用户按停。停顿时长放宽到 3 秒 —— 小孩想词比大人慢。
 *
 *  · 沉默是常态，不是错误：NO_MATCH / SPEECH_TIMEOUT 不上报给前端，
 *    直接静默重来，避免界面上动不动弹一句"出错了"。
 *
 *  · 一切都在主线程：SpeechRecognizer 要求创建与调用都在主线程。
 *
 *  · 任何一步失败都 reject / notify，绝不让异常穿到系统层 ——
 *    前端有兜底（退回键盘输入），但前提是我们能"说话"而不是崩。
 */
@CapacitorPlugin(
    name = "LittleSpeech",
    permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone") }
)
public class LittleSpeechPlugin extends Plugin {

    /** 一次会话里最多自动续听多少次，防止极端情况下无限重启 */
    private static final int MAX_RESTARTS = 400;
    /** 续听前的间隔：太短会和上一句抢麦，太长孩子会以为"断了" */
    private static final long RESTART_DELAY_MS = 260L;
    /** 音量事件节流：onRmsChanged 触发极密，全量过桥会把 WebView 淹掉 */
    private static final long LEVEL_THROTTLE_MS = 90L;

    private SpeechRecognizer recognizer;
    private boolean listening = false;
    private boolean userStopped = false;
    private boolean continuous = true;
    private String lang = "zh-CN";
    private int restarts = 0;
    private long lastLevelAt = 0L;

    private final Handler handler = new Handler(Looper.getMainLooper());

    /* ============================================================
       能力探测
       ============================================================ */

    @PluginMethod
    public void available(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", canRecognize());
        ret.put("permission", getPermissionState("microphone").toString());
        call.resolve(ret);
    }

    private boolean canRecognize() {
        try {
            return SpeechRecognizer.isRecognitionAvailable(getContext());
        } catch (Throwable t) {
            return false;
        }
    }

    /* ============================================================
       开始 / 停止 / 取消
       ============================================================ */

    @PluginMethod
    public void start(PluginCall call) {
        Boolean cont = call.getBoolean("continuous");
        this.continuous = cont == null || cont;

        String requestedLang = call.getString("lang");
        if (requestedLang != null && !requestedLang.isEmpty()) {
            this.lang = requestedLang;
        }

        if (!canRecognize()) {
            call.reject("device-unsupported");
            return;
        }

        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
            return;
        }

        begin(call);
    }

    @PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            begin(call);
        } else {
            call.reject("permission-denied");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        // 用户按停：让系统把最后半句吐出来（onResults），然后自然收尾
        userStopped = true;
        continuous = false;
        runOnUi(() -> {
            try {
                if (recognizer != null) recognizer.stopListening();
            } catch (Throwable ignored) {
                /* 没在听就无所谓 */
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        userStopped = true;
        continuous = false;
        runOnUi(this::release);
        call.resolve();
    }

    /* ============================================================
       内部
       ============================================================ */

    private void begin(final PluginCall call) {
        userStopped = false;
        continuous = true;
        restarts = 0;
        lastLevelAt = 0L;

        final Context context = getContext();
        runOnUi(() -> {
            try {
                release();
                recognizer = SpeechRecognizer.createSpeechRecognizer(context);
                recognizer.setRecognitionListener(recognitionListener);
                listening = true;
                recognizer.startListening(buildIntent());
                notifyEvent("start", null);
                if (call != null) call.resolve();
            } catch (Throwable t) {
                listening = false;
                release();
                if (call != null) call.reject("start-failed");
                notifyError("start-failed", "语音识别没能启动，请用下面的键盘输入");
            }
        });
    }

    private Intent buildIntent() {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());

        /* 孩子的节奏比大人慢：一句话说完停一下很正常，
           默认的静默判定太短，会把他一句话切成三四段。 */
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 3000L);
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 3000L);
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 2500L);
        return intent;
    }

    /** 一句结束/一次没听清之后，自己接着听 —— 直到用户按停 */
    private void restartSoon() {
        if (userStopped || !continuous) {
            notifyEvent("end", null);
            release();
            return;
        }
        if (restarts++ > MAX_RESTARTS) {
            notifyError("too-many-restarts", "听得太久了，先歇一会儿吧");
            notifyEvent("end", null);
            release();
            return;
        }
        handler.postDelayed(
            () -> {
                if (userStopped || !continuous || recognizer == null) return;
                try {
                    listening = true;
                    recognizer.startListening(buildIntent());
                } catch (Throwable t) {
                    notifyEvent("end", null);
                    release();
                }
            },
            RESTART_DELAY_MS
        );
    }

    private void release() {
        listening = false;
        final SpeechRecognizer current = recognizer;
        recognizer = null;
        if (current == null) return;
        try {
            current.cancel();
        } catch (Throwable ignored) {
            /* 忽略 */
        }
        try {
            current.destroy();
        } catch (Throwable ignored) {
            /* 忽略 */
        }
    }

    private void runOnUi(Runnable task) {
        try {
            if (getActivity() != null) {
                getActivity().runOnUiThread(task);
            } else {
                handler.post(task);
            }
        } catch (Throwable t) {
            handler.post(task);
        }
    }

    /* ============================================================
       系统回调 → 前端事件
       ============================================================ */

    private final RecognitionListener recognitionListener = new RecognitionListener() {
        @Override
        public void onReadyForSpeech(Bundle params) {
            listening = true;
            runOnUi(() -> notifyEvent("ready", null));
        }

        @Override
        public void onBeginningOfSpeech() {
            runOnUi(() -> notifyEvent("speechStart", null));
        }

        @Override
        public void onRmsChanged(float rmsdB) {
            long now = SystemClock.uptimeMillis();
            if (now - lastLevelAt < LEVEL_THROTTLE_MS) return;
            lastLevelAt = now;
            final float level = rmsdB;
            runOnUi(() -> {
                JSObject data = new JSObject();
                data.put("rms", level);
                notifyEvent("level", data);
            });
        }

        @Override
        public void onBufferReceived(byte[] buffer) {
            /* 用不上 */
        }

        @Override
        public void onEndOfSpeech() {
            runOnUi(() -> notifyEvent("speechEnd", null));
        }

        @Override
        public void onError(int error) {
            listening = false;

            boolean benign =
                error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT;

            // 沉默 / 没听清是常态，不打扰孩子，静默续听
            runOnUi(() -> {
                if (benign) {
                    restartSoon();
                } else {
                    // 非良性错误才告诉孩子 —— 良性的一律静默续听
                    notifyError(errorCode(error), errorMessage(error));
                    notifyEvent("end", null);
                    release();
                }
            });
        }

        @Override
        public void onResults(Bundle results) {
            listening = false;
            final String text = firstResult(results);
            /* ★ 必须切回主线程再 notifyListeners。
               这个回调是识别服务（另一个进程 / 另一个 binder 线程）打进来的，
               而 Capacitor 的 notifyListeners 最终要落到 WebView 上执行 JS ——
               在非主线程直接调，轻则事件排不进去、重则抛
               "Only the original thread that created a view hierarchy can touch its views"。
               被 catch(Throwable) 吃掉之后，表现就是**识别结果静默丢失**：
               录音明明在跑，文字一个字都不出来。

               这就是"录音有、文字没有"最可能的元凶之一：
               它只在最后一句（onResults）上出错，而中间的 onPartialResults
               有时反而侥幸能过 —— 于是看上去像"偶尔灵、偶尔不灵"。
               包一层 runOnUi，让所有事件都从主线程发出去。 */
            runOnUi(() -> {
                if (text != null && !text.isEmpty()) {
                    JSObject data = new JSObject();
                    data.put("text", text);
                    data.put("isFinal", true);
                    notifyEvent("result", data);
                }
                restartSoon();
            });
        }

        @Override
        public void onPartialResults(Bundle partialResults) {
            final String text = firstResult(partialResults);
            if (text == null || text.isEmpty()) return;
            // 同样切回主线程（见 onResults 的说明）
            runOnUi(() -> {
                JSObject data = new JSObject();
                data.put("text", text);
                data.put("isFinal", false);
                notifyEvent("partial", data);
            });
        }

        @Override
        public void onEvent(int eventType, Bundle params) {
            /* 用不上 */
        }
    };

    @SuppressWarnings("unchecked")
    private String firstResult(Bundle bundle) {
        if (bundle == null) return null;
        try {
            ArrayList<String> list = bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            if (list == null || list.isEmpty()) return null;
            return list.get(0);
        } catch (Throwable t) {
            return null;
        }
    }

    private String errorCode(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_AUDIO:
                return "audio";
            case SpeechRecognizer.ERROR_CLIENT:
                return "client";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "not-allowed";
            case SpeechRecognizer.ERROR_NETWORK:
                return "network";
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "network-timeout";
            case SpeechRecognizer.ERROR_NO_MATCH:
                return "no-match";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "busy";
            case SpeechRecognizer.ERROR_SERVER:
                return "server";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "no-speech";
            default:
                return "unknown";
        }
    }

    private String errorMessage(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "没有麦克风权限，请在系统设置里允许使用麦克风";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
            case SpeechRecognizer.ERROR_SERVER:
                return "语音识别需要联网，请检查网络";
            case SpeechRecognizer.ERROR_AUDIO:
                return "麦克风被别的应用占用了，等一下再试";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "语音识别正忙，稍等一下再点";
            default:
                return "语音识别出错了，用下面的键盘输入也可以";
        }
    }

    private void notifyEvent(String eventName, JSObject data) {
        try {
            notifyListeners(eventName, data == null ? new JSObject() : data);
        } catch (Throwable ignored) {
            /* 前端没挂监听也不该出事 */
        }
    }

    private void notifyError(String code, String message) {
        JSObject data = new JSObject();
        data.put("code", code);
        data.put("message", message);
        notifyEvent("error", data);
    }

    /* ============================================================
       生命周期
       ============================================================ */

    @Override
    protected void handleOnPause() {
        // 退到后台就别占着麦克风了
        if (listening) {
            userStopped = true;
            continuous = false;
            runOnUi(this::release);
        }
    }

    @Override
    protected void handleOnDestroy() {
        userStopped = true;
        continuous = false;
        release();
    }
}
