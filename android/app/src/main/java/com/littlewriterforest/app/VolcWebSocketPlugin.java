package com.littlewriterforest.app;

import android.os.Handler;
import android.os.Looper;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Iterator;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

/**
 * WebSocket 中转 —— 一个**只会搬字节**的哑管道。
 *
 * ============================================================
 * 为什么非要有这个插件（不是"顺便用原生更稳"，是没别的路）
 * ============================================================
 *
 * 火山引擎的流式语音识别要在 WebSocket 握手时带 `X-Api-Key` /
 * `X-Api-Resource-Id` 这类请求头。而：
 *
 *   · **浏览器的 WebSocket API 不能自定义请求头** ——
 *     `new WebSocket(url, protocols)` 根本没有 headers 参数，
 *     这是 WHATWG 标准的限制，不是 WebView 的缺陷。
 *
 *   · 想绕过去的两条路都试过，**都堵死**（scripts/_probe-ws-auth.mjs 实测）：
 *       查询串传凭据   → HTTP 403
 *       子协议传凭据   → HTTP 400
 *     服务端只从**请求头**里读 resource id，报文原话是
 *     "get resource id empty"。
 *
 * 所以流式这条路在 WebView 里**根本连不上**，只能在原生侧开 socket。
 * OkHttp 的 WebSocket 支持自定义头，且 Capacitor 的 Android 侧本来就用它那一套。
 *
 * ============================================================
 * 边界：插件**不碰**协议
 * ------------------------------------------------------------
 * 这里只做四件事：连接 / 发字节 / 收字节 / 关闭。
 * v3 的二进制分帧、事件、文本提取全部留在 TypeScript
 * （src/platform/volcengine.ts）—— 那边能在 vitest 里跑，这边不能。
 * 插件里只要出现一点协议知识，就再也测不了了。
 *
 * ⚠️ 所有 notifyListeners 都必须**回到主线程**再发。
 *    OkHttp 的回调是从它自己的线程池打进来的，直接发有两个后果：
 *    JS 侧收到事件的时机不确定，而且一旦抛异常会被 WebSocketListener
 *    的框架吞掉 —— 表现成"事件偶尔丢"，极难查。
 *    （同一个坑本项目在 LittleSpeechPlugin 上已经踩过一次：
 *      binder 线程直发事件，异常被 catch 吃掉，最后一句永远收不到。）
 */
@CapacitorPlugin(name = "VolcWs")
public class VolcWebSocketPlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());
    private OkHttpClient client;
    private WebSocket socket;
    /** 还没结算的 connect 调用 —— 用它防止 onOpen/onFailure 重复结算同一个 call */
    private PluginCall pendingConnect;

    private OkHttpClient client() {
        if (client == null) {
            client = new OkHttpClient.Builder()
                    // 长静音时保活：孩子思考的时候会停好几秒不说话
                    .pingInterval(20, TimeUnit.SECONDS)
                    .build();
        }
        return client;
    }

    /** 统一从这里发事件：一定在主线程 */
    private void emit(final String event, final JSObject data) {
        main.post(new Runnable() {
            @Override
            public void run() {
                try {
                    notifyListeners(event, data);
                } catch (Throwable ignored) {
                    // 界面已经走了，事件没人收 —— 不该反过来影响 socket
                }
            }
        });
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url required");
            return;
        }

        Request.Builder rb = new Request.Builder().url(url);
        JSObject headers = call.getObject("headers");
        if (headers != null) {
            for (Iterator<String> it = headers.keys(); it.hasNext(); ) {
                String k = it.next();
                String v = headers.getString(k);
                if (k != null && v != null) rb.addHeader(k, v);
            }
        }

        closeSocket();
        pendingConnect = call;

        socket = client().newWebSocket(rb.build(), new WebSocketListener() {
            @Override
            public void onOpen(WebSocket ws, Response response) {
                PluginCall c = pendingConnect;
                pendingConnect = null;
                JSObject d = new JSObject();
                d.put("status", response.code());
                if (c != null) c.resolve(d);
                emit("open", d);
            }

            @Override
            public void onMessage(WebSocket ws, String text) {
                JSObject d = new JSObject();
                d.put("text", text);
                emit("message", d);
            }

            @Override
            public void onMessage(WebSocket ws, ByteString bytes) {
                JSObject d = new JSObject();
                d.put("data", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
                emit("message", d);
            }

            @Override
            public void onFailure(WebSocket ws, Throwable t, Response response) {
                PluginCall c = pendingConnect;
                pendingConnect = null;
                socket = null;

                String msg = t == null ? "websocket failure" : String.valueOf(t.getMessage());
                JSObject d = new JSObject();
                d.put("message", msg);
                // 握手被拒时 OkHttp 会把响应带进来（403/400 都在这里）
                if (response != null) {
                    d.put("status", response.code());
                    try {
                        if (response.body() != null) {
                            d.put("body", response.body().string());
                        }
                    } catch (Throwable ignored) {
                        // 拿不到报文就算了，状态码已经够定位
                    }
                }
                if (c != null) c.reject(msg);
                emit("error", d);
            }

            @Override
            public void onClosed(WebSocket ws, int code, String reason) {
                socket = null;
                JSObject d = new JSObject();
                d.put("code", code);
                d.put("reason", reason == null ? "" : reason);
                emit("close", d);
            }
        });
    }

    @PluginMethod
    public void send(PluginCall call) {
        String b64 = call.getString("data");
        WebSocket ws = socket;
        if (ws == null) {
            call.reject("not connected");
            return;
        }
        if (b64 == null) {
            call.reject("data required");
            return;
        }
        try {
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            if (!ws.send(ByteString.of(bytes))) {
                call.reject("send queue full or closed");
                return;
            }
            call.resolve();
        } catch (Throwable t) {
            call.reject(String.valueOf(t.getMessage()));
        }
    }

    @PluginMethod
    public void close(PluginCall call) {
        closeSocket();
        call.resolve();
    }

    private void closeSocket() {
        WebSocket ws = socket;
        socket = null;
        if (ws != null) {
            try {
                ws.close(1000, "client close");
            } catch (Throwable ignored) {
                // 已经断了
            }
        }
    }

    @Override
    protected void handleOnDestroy() {
        closeSocket();
        super.handleOnDestroy();
    }
}
