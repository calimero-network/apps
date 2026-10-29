package network.calimero.models.ui

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject

/**
 * The 3D viewport: `viewer.html`, bundled with the app, in a web view.
 *
 * That page is the web studio's own three.js drawing code (lights, grid, shading, materials, the
 * mesh format), built into one local file by `mobile/viewer/build.mjs`; iOS ships the same file.
 * Nothing is loaded from the network: the scene and its blobs come from this side.
 * (Swift `ViewportController`.)
 */
@SuppressLint("SetJavaScriptEnabled")
class ViewportController(
    context: Context,
    private val scope: CoroutineScope,
) {
    enum class Shading(
        val wire: String,
    ) {
        SOLID("solid"),
        RENDERED("rendered"),
    }

    val webView: WebView = WebView(context)
    var ready by mutableStateOf(false)
        private set

    /** Blobs the page is waiting for. */
    var pending by mutableIntStateOf(0)
        private set
    var problem by mutableStateOf<String?>(null)
        private set
    var shading by mutableStateOf(Shading.SOLID)
        private set
    var grid by mutableStateOf(true)
        private set

    /** A tap in the viewport picked this object, or nothing. */
    var onPick: (String?) -> Unit = {}

    /** Reads a blob's bytes for the page. */
    var blob: suspend (String) -> ByteArray? = { null }

    private var scene: String? = null
    private var selected: String? = null
    private val main = Handler(Looper.getMainLooper())

    init {
        webView.settings.javaScriptEnabled = true
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = false
        webView.setBackgroundColor(VIEWPORT_ARGB)
        webView.overScrollMode = View.OVER_SCROLL_NEVER
        webView.isVerticalScrollBarEnabled = false
        webView.isHorizontalScrollBarEnabled = false
        webView.addJavascriptInterface(Bridge(), "MMNative")
        webView.loadUrl("file:///android_asset/viewer.html")
    }

    /** The scene, as `SceneModel.viewerJson()` gives it. */
    fun setScene(json: String) {
        scene = json
        run("window.mmViewer.setScene($json)")
    }

    fun select(id: String?) {
        selected = id
        run("window.mmViewer.select(${literal(id)})")
    }

    /** Frame one object, or the whole scene. */
    fun frame(id: String?) = run("window.mmViewer.frame(${literal(id)})")

    fun toggleShading() {
        shading = if (shading == Shading.SOLID) Shading.RENDERED else Shading.SOLID
        run("window.mmViewer.setShading('${shading.wire}')")
    }

    fun toggleGrid() {
        grid = !grid
        run("window.mmViewer.setGrid($grid)")
    }

    fun destroy() {
        webView.removeJavascriptInterface("MMNative")
        webView.destroy()
    }

    private fun run(js: String) {
        if (ready) webView.evaluateJavascript(js, null)
    }

    private fun receive(
        type: String,
        id: String?,
        count: Int?,
        message: String?,
    ) {
        when (type) {
            "ready" -> {
                ready = true
                scene?.let { run("window.mmViewer.setScene($it)") }
                run("window.mmViewer.setShading('${shading.wire}')")
                run("window.mmViewer.setGrid($grid)")
                selected?.let { select(it) }
            }
            "blob" -> {
                if (id == null || !id.all { it.isLetterOrDigit() }) return
                scope.launch {
                    val data = blob(id)
                    val arg = data?.let { "'" + Base64.encodeToString(it, Base64.NO_WRAP) + "'" } ?: "null"
                    run("window.mmViewer.setBlob('$id', $arg)")
                }
            }
            "pick" -> {
                selected = id
                onPick(id)
            }
            "progress" -> pending = count ?: 0
            "error" -> problem = message
        }
    }

    /** Messages from the page arrive on a binder thread; handled on the main one. */
    private inner class Bridge {
        @JavascriptInterface
        fun postMessage(raw: String) {
            val obj = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull() ?: return

            fun str(key: String) = (obj[key] as? JsonPrimitive)?.contentOrNull
            val type = str("type") ?: return
            val id = str("id")
            val count = (obj["pending"] as? JsonPrimitive)?.intOrNull
            val message = str("message")
            main.post { receive(type, id, count, message) }
        }
    }

    private companion object {
        const val VIEWPORT_ARGB = 0xFF24262B.toInt()
        val json = Json { ignoreUnknownKeys = true }

        fun literal(id: String?): String = id?.let { JsonPrimitive(it).toString() } ?: "null"
    }
}
