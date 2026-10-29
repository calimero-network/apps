package network.calimero.blocks.ui

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import android.view.HapticFeedbackConstants
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.webkit.WebViewAssetLoader
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import network.calimero.blocks.app.BlocksText
import network.calimero.blocks.app.BridgeCodec
import network.calimero.blocks.app.GameInsets
import network.calimero.blocks.app.GameModel
import network.calimero.blocks.app.PlayerSettings
import network.calimero.blocks.app.WorldRef

/**
 * The game, full screen and landscape: the web app's three.js engine in a WebView, served from the
 * `assets/game` folder bundled into the app, with its contract calls answered by [GameModel] through
 * the signed-in session. The menu is native. (iOS `GameScreen`.)
 */
@Composable
fun GameScreen(
    backend: MeroAppBackend,
    world: WorldRef,
    myId: String,
    settings: PlayerSettings,
    scope: CoroutineScope,
    onShare: (String) -> Unit,
    onExit: () -> Unit,
) {
    val model =
        remember(world) {
            GameModel(backend, world, myId, settings.playerName, settings.sensitivity.value, scope)
        }
    val phase by model.phase.collectAsState()
    val sensitivity by settings.sensitivity.collectAsState()
    val view = LocalView.current
    var menuOpen by remember { mutableStateOf(false) }
    var menuError by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }

    LaunchedEffect(model) { model.prepare() }
    LaunchedEffect(sensitivity) { model.setSensitivity(sensitivity) }
    LandscapeImmersive()
    PauseOnBackground(model) { menuOpen }

    DisposableEffect(model) {
        model.onMenu = {
            view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
            model.pause()
            menuOpen = true
        }
        model.onHaptic = { style ->
            view.performHapticFeedback(
                if (style == "selection") HapticFeedbackConstants.CLOCK_TICK else HapticFeedbackConstants.KEYBOARD_TAP,
            )
        }
        onDispose { model.stop() }
    }

    val density = LocalDensity.current
    val direction = LocalLayoutDirection.current
    val safe = WindowInsets.safeDrawing
    val insets =
        with(density) {
            GameInsets(
                top =
                    safe
                        .getTop(this)
                        .toDp()
                        .value
                        .toDouble(),
                left =
                    safe
                        .getLeft(this, direction)
                        .toDp()
                        .value
                        .toDouble(),
                bottom =
                    safe
                        .getBottom(this)
                        .toDp()
                        .value
                        .toDouble(),
                right =
                    safe
                        .getRight(this, direction)
                        .toDp()
                        .value
                        .toDouble(),
            )
        }
    LaunchedEffect(insets) { model.setInsets(insets) }

    Box(Modifier.fillMaxSize().background(Sky)) {
        when (val current = phase) {
            GameModel.Phase.Joining -> GameStatus("Joining ${world.name}…")
            is GameModel.Phase.Failed ->
                GameFailure(
                    message = current.message,
                    onRetry = {
                        attempt += 1
                        scope.launch { model.retry() }
                    },
                    onBack = onExit,
                )
            GameModel.Phase.Loading, GameModel.Phase.Playing -> key(attempt) { GameWebView(model) }
        }
        if (menuOpen) {
            PauseMenu(
                world = world,
                settings = settings,
                error = menuError,
                onDismissError = { menuError = null },
                onResume = {
                    menuOpen = false
                    model.resume()
                },
                onInvite = {
                    view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                    menuError = null
                    scope.launch {
                        runCatching { model.inviteLink() }
                            .onSuccess(onShare)
                            .onFailure { menuError = BlocksText.error(it) }
                    }
                },
                onLeave = {
                    scope.launch { model.leave() }
                    onExit()
                },
            )
        }
    }
}

private val Sky = Color(0xFF87C4EB)

/** Landscape, edge to edge with the system bars hidden, and the screen kept awake, while the game is up. */
@Composable
private fun LandscapeImmersive() {
    val context = LocalContext.current
    val view = LocalView.current
    DisposableEffect(Unit) {
        val activity = context.findActivity()
        val previous = activity?.requestedOrientation ?: ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        view.keepScreenOn = true
        val controller = activity?.window?.let { WindowCompat.getInsetsController(it, view) }
        controller?.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller?.hide(WindowInsetsCompat.Type.systemBars())
        onDispose {
            controller?.show(WindowInsetsCompat.Type.systemBars())
            view.keepScreenOn = false
            activity?.requestedOrientation = previous
        }
    }
}

/** The game pauses when the app leaves the screen, and resumes on return unless the menu is open. */
@Composable
private fun PauseOnBackground(
    model: GameModel,
    menuOpen: () -> Boolean,
) {
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner, model) {
        val observer =
            LifecycleEventObserver { _, event ->
                when (event) {
                    Lifecycle.Event.ON_PAUSE -> model.pause()
                    Lifecycle.Event.ON_RESUME -> if (!menuOpen()) model.resume()
                    else -> Unit
                }
            }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
}

private tailrec fun Context.findActivity(): Activity? =
    when (this) {
        is Activity -> this
        is ContextWrapper -> baseContext.findActivity()
        else -> null
    }

/** The native pause menu over the paused game. (iOS `PauseMenu`.) */
@Composable
private fun PauseMenu(
    world: WorldRef,
    settings: PlayerSettings,
    error: String?,
    onDismissError: () -> Unit,
    onResume: () -> Unit,
    onInvite: () -> Unit,
    onLeave: () -> Unit,
) {
    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.45f))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onResume),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier
                .padding(vertical = 16.dp)
                .widthIn(max = 380.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(BlocksColors.Surface)
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = {})
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                AppMark(40.dp)
                Column {
                    Text(world.name, style = Type.heading(20), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("Paused", style = Type.body(13, color = BlocksColors.Muted))
                }
            }
            PrimaryButton(onClick = onResume) {
                Icon(Icons.Filled.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                ButtonLabel("Resume")
            }
            SecondaryButton(onClick = onInvite) {
                Icon(Icons.Filled.PersonAdd, contentDescription = null, modifier = Modifier.size(18.dp))
                ButtonLabel("Invite friends")
            }
            SensitivitySlider(settings)
            error?.let { ErrorBanner(it, onDismissError) }
            SecondaryButton(onClick = onLeave) {
                Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null, modifier = Modifier.size(18.dp))
                ButtonLabel("Save & leave world")
            }
            Disclosure("Details") {
                DetailRow("World (context)", world.contextId)
                DetailRow("Namespace", world.namespaceId)
            }
        }
    }
}

@Composable
private fun GameStatus(title: String) {
    Box(Modifier.fillMaxSize().background(BlocksColors.Ground), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            AppMark(52.dp)
            CircularProgressIndicator(color = BlocksColors.Ink, strokeWidth = 2.dp)
            Text(title, style = Type.body(15, color = BlocksColors.Ink2))
        }
    }
}

@Composable
private fun GameFailure(
    message: String,
    onRetry: () -> Unit,
    onBack: () -> Unit,
) {
    Box(Modifier.fillMaxSize().background(BlocksColors.Ground).padding(24.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Icon(Icons.Filled.Warning, contentDescription = null, tint = BlocksColors.Danger, modifier = Modifier.size(30.dp))
            Text("Couldn't open this world", style = Type.heading(20))
            Text(
                message,
                style = Type.body(14, color = BlocksColors.Muted),
                textAlign = TextAlign.Center,
                modifier = Modifier.widthIn(max = 460.dp),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                SecondaryButton(onClick = onBack, fullWidth = false) { ButtonLabel("Back to worlds") }
                PrimaryButton(onClick = onRetry, fullWidth = false) { ButtonLabel("Try again") }
            }
        }
    }
}

/** The WebView that runs the game page from the app's assets. */
@SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
@Composable
private fun GameWebView(model: GameModel) {
    val scope = rememberCoroutineScope()
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { context ->
            val assets = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context)).build()
            WebView(context).apply {
                setBackgroundColor(Sky.toArgb())
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.mediaPlaybackRequiresUserGesture = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                isHapticFeedbackEnabled = true
                webViewClient =
                    object : WebViewClient() {
                        override fun shouldInterceptRequest(
                            view: WebView,
                            request: WebResourceRequest,
                        ): WebResourceResponse? = assets.shouldInterceptRequest(request.url)

                        /** Only the bundled page: nothing navigates the game elsewhere. */
                        override fun shouldOverrideUrlLoading(
                            view: WebView,
                            request: WebResourceRequest,
                        ): Boolean = request.url.host != WebViewAssetLoader.DEFAULT_DOMAIN
                    }
                val webView = this
                model.outbox = { message ->
                    webView.post { webView.evaluateJavascript(BridgeCodec.script(message), null) }
                }
                addJavascriptInterface(
                    object {
                        @JavascriptInterface
                        fun postMessage(text: String) {
                            scope.launch { model.receive(text) }
                        }
                    },
                    "MeroBlocksAndroid",
                )
                loadUrl(PAGE_URL)
            }
        },
        onRelease = { webView ->
            model.outbox = null
            webView.removeJavascriptInterface("MeroBlocksAndroid")
            webView.destroy()
        },
    )
}

/** The bundled page (`assets/game/index.html`), on the asset loader's https origin. */
const val PAGE_URL = "https://${WebViewAssetLoader.DEFAULT_DOMAIN}/assets/game/index.html"
