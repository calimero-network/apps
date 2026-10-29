package network.calimero.kombat.ui

import android.annotation.SuppressLint
import android.graphics.Color
import android.os.Looper
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import network.calimero.kombat.app.BridgeInbound
import network.calimero.kombat.app.GameHost

/** Where the game page ships: app/src/main/assets/game, built by scripts/build-web.sh. */
const val GAME_PAGE = "file:///android_asset/game/index.html"

/**
 * The game page (the web app's engine) in a WebView, loaded from the APK's assets: nothing is fetched
 * at runtime. (iOS `GameWebView`.)
 *
 * The bridge is two calls: the page posts JSON strings to `MeroBridgeAndroid.postMessage`
 * ([BridgeInbound]), and the host's messages run as `window.meroGame.receive(…)`
 * ([network.calimero.kombat.app.BridgeOutbound.script]). Contract calls never leave the app through
 * the page: they come here and go out through the generated client.
 */
@SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
@Composable
fun GameWebView(
    host: GameHost,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val webView =
        remember {
            WebView(context).apply {
                setBackgroundColor(Color.rgb(0x0B, 0x0B, 0x0C))
                settings.javaScriptEnabled = true
                // The engine's sound is synthesised WebAudio; the pad is native, so there is no web
                // gesture to unlock it with.
                settings.mediaPlaybackRequiresUserGesture = false
                settings.blockNetworkLoads = true
                settings.allowContentAccess = false
                settings.setSupportZoom(false)
                isVerticalScrollBarEnabled = false
                isHorizontalScrollBarEnabled = false
                overScrollMode = View.OVER_SCROLL_NEVER
                isFocusable = false
                isClickable = false
                // Touches belong to the native pad above the page.
                setOnTouchListener { _, _ -> true }
                webViewClient =
                    object : WebViewClient() {
                        // The page is a local asset and stays one: no navigation anywhere else.
                        override fun shouldOverrideUrlLoading(
                            view: WebView,
                            request: WebResourceRequest,
                        ): Boolean = !request.url.toString().startsWith("file:///android_asset/")
                    }
            }
        }

    DisposableEffect(webView, host) {
        webView.addJavascriptInterface(PageBridge(host, scope), "MeroBridgeAndroid")
        host.deliver = { message ->
            if (Looper.myLooper() == Looper.getMainLooper()) {
                webView.evaluateJavascript(message.script, null)
            } else {
                webView.post { webView.evaluateJavascript(message.script, null) }
            }
        }
        webView.loadUrl(GAME_PAGE)
        onDispose {
            host.deliver = null
            webView.removeJavascriptInterface("MeroBridgeAndroid")
            webView.destroy()
        }
    }

    AndroidView(factory = { webView }, modifier = modifier)
}

/** What the page posts to: runs on WebView's JS thread, hands each message to the main thread. */
private class PageBridge(
    private val host: GameHost,
    private val scope: CoroutineScope,
) {
    @JavascriptInterface
    fun postMessage(body: String) {
        val message = BridgeInbound.decode(body) ?: return
        scope.launch(Dispatchers.Main.immediate) { host.receive(message) }
    }
}
