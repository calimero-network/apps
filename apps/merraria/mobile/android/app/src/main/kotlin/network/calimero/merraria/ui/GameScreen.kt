package network.calimero.merraria.ui

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.HapticFeedbackConstants
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AddBox
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Hardware
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Share
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
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.webkit.WebViewAssetLoader
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.launch
import network.calimero.merraria.app.GameButton
import network.calimero.merraria.app.GameModel
import network.calimero.merraria.app.GamePhase
import network.calimero.merraria.app.GameState
import network.calimero.merraria.app.HudSlot
import network.calimero.merraria.app.MerrariaText
import network.calimero.merraria.app.PlayerSettings
import network.calimero.merraria.app.WorldRef
import network.calimero.merraria.app.WorldsModel

/** The bundled game: `assets/www/index.html`, served from the APK, in its game-only mode. */
private const val GAME_URL = "https://appassets.androidplatform.net/assets/www/index.html?host=native"

/**
 * One world, full screen: the bundled game, with the touch controls over it. The screen stays awake
 * while it is open, the system bars hide, and the game pauses (and saves) when the app leaves the
 * foreground. Back opens the pause menu. (iOS `GameScreen`.)
 */
@Composable
fun GameScreen(
    backend: MeroAppBackend,
    ref: WorldRef,
    settings: PlayerSettings,
    onShare: (String) -> Unit,
    onClose: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val model = remember(ref) { GameModel(backend, ref, settings, scope) }
    val state by model.state.collectAsState()
    var page by remember { mutableIntStateOf(0) }
    val density = LocalDensity.current.density
    val view = LocalView.current

    LaunchedEffect(model) { model.start() }
    LaunchedEffect(state.phase) { if (state.phase == GamePhase.Left) onClose() }
    ImmersiveWhileShown(view)
    PauseWhenBackgrounded(model)
    BackHandler {
        if (state.paused) model.resume() else model.pause()
    }

    fun close() {
        model.stop()
        onClose()
    }

    Box(Modifier.fillMaxSize().background(MerrariaColors.GameGround)) {
        key(page) { GameWebView(model) }
        // Taps on the world pick the tile the mine and place buttons act on.
        Box(
            Modifier.fillMaxSize().pointerInput(model) {
                detectTapGestures { offset ->
                    view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                    model.tap(offset.x.toDouble(), offset.y.toDouble(), density.toDouble())
                }
            },
        )
        ControlsOverlay(model, state)
        when (val phase = state.phase) {
            GamePhase.Loading -> LoadingCover(ref.name, onClose = ::close)
            is GamePhase.Failed ->
                FailedCover(phase.message, onRetry = {
                    model.retry()
                    page++
                }, onClose = ::close)
            else -> Unit
        }
        if (state.paused && state.phase == GamePhase.Playing) {
            PauseMenu(model, state, backend, onShare)
        }
    }
}

/** The WebView, wired to [model]: the page posts to `MeroBridgeAndroid`, and `model.send` evaluates each message's script. */
@SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
@Composable
private fun GameWebView(model: GameModel) {
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { context ->
            val assets =
                WebViewAssetLoader
                    .Builder()
                    .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
                    .build()
            val main = Handler(Looper.getMainLooper())
            WebView(context).apply {
                setBackgroundColor(android.graphics.Color.rgb(0x0B, 0x14, 0x0E))
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.mediaPlaybackRequiresUserGesture = true
                isVerticalScrollBarEnabled = false
                isHorizontalScrollBarEnabled = false
                overScrollMode = View.OVER_SCROLL_NEVER
                isFocusable = false
                // The page takes no touches: the controls and the tap layer above it are native.
                setOnTouchListener { _, _ -> true }
                webViewClient =
                    object : WebViewClient() {
                        override fun shouldInterceptRequest(
                            view: WebView,
                            request: WebResourceRequest,
                        ): WebResourceResponse? = assets.shouldInterceptRequest(request.url)

                        // The game never navigates; nothing else is loaded in this view.
                        override fun shouldOverrideUrlLoading(
                            view: WebView,
                            request: WebResourceRequest,
                        ): Boolean = request.url.host != "appassets.androidplatform.net"
                    }
                addJavascriptInterface(
                    object {
                        @JavascriptInterface
                        fun postMessage(message: String) {
                            main.post { model.receive(message) }
                        }
                    },
                    "MeroBridgeAndroid",
                )
                val web = this
                model.send = { message -> main.post { web.evaluateJavascript(message.script, null) } }
                loadUrl(GAME_URL)
            }
        },
        onRelease = { web ->
            model.send = null
            web.removeJavascriptInterface("MeroBridgeAndroid")
            web.stopLoading()
            web.destroy()
        },
    )
}

/** Full screen and awake while the game is shown; the system bars come back on a swipe. */
@Composable
private fun ImmersiveWhileShown(view: View) {
    DisposableEffect(view) {
        val window = (view.context as? Activity)?.window
        val controller = window?.let { WindowCompat.getInsetsController(it, view) }
        controller?.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller?.hide(WindowInsetsCompat.Type.systemBars())
        view.keepScreenOn = true
        onDispose {
            controller?.show(WindowInsetsCompat.Type.systemBars())
            view.keepScreenOn = false
        }
    }
}

@Composable
private fun PauseWhenBackgrounded(model: GameModel) {
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner, model) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_PAUSE) model.pause() }
        owner.lifecycle.addObserver(observer)
        onDispose {
            owner.lifecycle.removeObserver(observer)
            model.stop()
        }
    }
}

// ---- controls ----------------------------------------------------------------------------------

/** D-pad bottom left, hotbar bottom centre, mine / place / jump bottom right, pause top left. */
@Composable
private fun ControlsOverlay(
    model: GameModel,
    state: GameState,
) {
    if (state.phase != GamePhase.Playing) return
    val view = LocalView.current
    Box(Modifier.fillMaxSize().safeDrawingPadding().padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 8.dp)) {
        RoundControl(Icons.Filled.Pause, "Pause", 44.dp, Modifier.align(Alignment.TopStart)) {
            view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
            model.pause()
        }
        if (!state.connected) {
            Row(
                Modifier
                    .align(Alignment.TopCenter)
                    .clip(CircleShape)
                    .background(MerrariaColors.Control)
                    .border(Hairline, MerrariaColors.ControlLine, CircleShape)
                    .padding(horizontal = 12.dp, vertical = 7.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircularProgressIndicator(Modifier.size(14.dp), color = Color.White, strokeWidth = 2.dp)
                Text("Syncing the world…", style = Type.body(13, FontWeight.Medium, Color.White))
            }
        }
        Row(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                HoldControl(Icons.Filled.ChevronLeft, "Move left", 62.dp, RoundedCornerShape(16.dp), model, GameButton.LEFT)
                HoldControl(Icons.Filled.ChevronRight, "Move right", 62.dp, RoundedCornerShape(16.dp), model, GameButton.RIGHT)
            }
            Box(Modifier.weight(1f), contentAlignment = Alignment.BottomCenter) {
                Hotbar(state.slots, state.selected) { slot ->
                    view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                    model.select(slot)
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Bottom) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    HoldControl(Icons.Filled.AddBox, "Place", 52.dp, CircleShape, model, GameButton.PLACE)
                    HoldControl(Icons.Filled.Hardware, "Mine", 52.dp, CircleShape, model, GameButton.MINE)
                }
                HoldControl(Icons.Filled.ArrowUpward, "Jump", 70.dp, CircleShape, model, GameButton.JUMP)
            }
        }
    }
}

/** A button that acts while a finger is on it: lime while held, dark glass otherwise. */
@Composable
private fun HoldControl(
    icon: ImageVector,
    label: String,
    size: Dp,
    shape: Shape,
    model: GameModel,
    button: GameButton,
) {
    var held by remember { mutableStateOf(false) }
    val view = LocalView.current
    Box(
        Modifier
            .size(size)
            .clip(shape)
            .background(if (held) MerrariaColors.Lime else MerrariaColors.Control)
            .border(Hairline, MerrariaColors.ControlLine, shape)
            .semantics { contentDescription = label }
            .pointerInput(button) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    held = true
                    view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                    model.press(button)
                    waitForUpOrCancellation()
                    held = false
                    model.release(button)
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = if (held) MerrariaColors.Ink else Color.White, modifier = Modifier.size(size * 0.46f))
    }
}

/** A plain tap button in the controls' style. */
@Composable
private fun RoundControl(
    icon: ImageVector,
    label: String,
    size: Dp,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(MerrariaColors.Control)
            .border(Hairline, MerrariaColors.ControlLine, CircleShape)
            .clickable(onClickLabel = label, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = label, tint = Color.White, modifier = Modifier.size(size * 0.42f))
    }
}

/** The hotbar: each placeable tile with how many the player holds. Tap to pick what Place puts down. */
@Composable
private fun Hotbar(
    slots: List<HudSlot>,
    selected: Int,
    onSelect: (Int) -> Unit,
) {
    Row(
        Modifier.widthIn(max = (9 * 42 + 8).dp).horizontalScroll(rememberScrollState()).padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        slots.forEachIndexed { index, slot ->
            val on = index == selected
            val shape = RoundedCornerShape(10.dp)
            Column(
                Modifier
                    .size(width = 38.dp, height = 44.dp)
                    .clip(shape)
                    .background(if (on) MerrariaColors.Lime else MerrariaColors.Control)
                    .border(Hairline, if (on) MerrariaColors.Ink else MerrariaColors.ControlLine, shape)
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClickLabel = "${slot.name}, ${slot.count}",
                    ) { onSelect(index) },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
            ) {
                TileSwatch(slot.color, 18.dp)
                Text(
                    "${slot.count}",
                    style = Type.body(11, FontWeight.Bold, if (on) MerrariaColors.Ink else Color.White).copy(fontSize = 11.sp),
                )
            }
        }
    }
}

// ---- covers ------------------------------------------------------------------------------------

@Composable
private fun LoadingCover(
    name: String,
    onClose: () -> Unit,
) {
    Box(Modifier.fillMaxSize().background(MerrariaColors.GameGround)) {
        Column(
            Modifier.align(Alignment.Center),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            AppMark(56.dp)
            CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp)
            Text("Loading $name…", style = Type.body(15, FontWeight.Medium, Color.White))
        }
        RoundControl(
            Icons.Filled.Close,
            "Close",
            44.dp,
            Modifier.safeDrawingPadding().padding(start = 16.dp, top = 10.dp),
            onClose,
        )
    }
}

@Composable
private fun FailedCover(
    message: String,
    onRetry: () -> Unit,
    onClose: () -> Unit,
) {
    Box(Modifier.fillMaxSize().background(Color(0x8C000000)), contentAlignment = Alignment.Center) {
        Card(Modifier.widthIn(max = 440.dp).padding(24.dp), padding = 20.dp) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Warning, contentDescription = null, tint = MerrariaColors.Danger)
                Text("Could not open this world", style = Type.heading(18))
            }
            Text(message, style = Type.body(14, color = MerrariaColors.Ink2), maxLines = 6, overflow = TextOverflow.Ellipsis)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SecondaryButton(onClick = onClose, modifier = Modifier.weight(1f)) { ButtonLabel("Back to worlds") }
                PrimaryButton(onClick = onRetry, modifier = Modifier.weight(1f)) { ButtonLabel("Try again") }
            }
        }
    }
}

// ---- pause menu --------------------------------------------------------------------------------

/** Paused: back to the game, invite friends, zoom, the world's ids behind Details, leave. */
@Composable
private fun PauseMenu(
    model: GameModel,
    state: GameState,
    backend: MeroAppBackend,
    onShare: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var inviting by remember { mutableStateOf(false) }
    var leaving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val ref = model.ref

    Box(
        Modifier
            .fillMaxSize()
            .background(Color(0x80000000))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { model.resume() },
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .safeDrawingPadding()
                .padding(vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.weight(1f, fill = false))
            Card(
                Modifier
                    .widthIn(max = 460.dp)
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
                padding = 20.dp,
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    AppMark(36.dp)
                    Column {
                        Text(ref.name, style = Type.heading(19), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("Paused · the world keeps going for everyone else", style = Type.body(13, color = MerrariaColors.Muted))
                    }
                }
                error?.let { ErrorBanner(it) { error = null } }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    SecondaryButton(
                        onClick = {
                            inviting = true
                            error = null
                            scope.launch {
                                runCatching { WorldsModel.inviteLink(backend, ref) }
                                    .onSuccess(onShare)
                                    .onFailure { error = MerrariaText.error(it) }
                                inviting = false
                            }
                        },
                        enabled = !inviting && !leaving,
                        modifier = Modifier.weight(1f),
                    ) {
                        if (inviting) {
                            CircularProgressIndicator(Modifier.size(18.dp), color = MerrariaColors.Ink, strokeWidth = 2.dp)
                        } else {
                            Icon(Icons.Filled.Share, contentDescription = null, modifier = Modifier.size(18.dp))
                        }
                        ButtonLabel("Invite friends")
                    }
                    PrimaryButton(onClick = model::resume, enabled = !leaving, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Filled.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                        ButtonLabel("Back to game")
                    }
                }
                ZoomRow(state.zoom) { model.setZoom(it) }
                Disclosure("Details") {
                    DetailRow("World (context)", ref.contextId)
                    DetailRow("Namespace", ref.namespaceId)
                    ref.groupId?.let { DetailRow("Group", it) }
                }
                SecondaryButton(
                    onClick = {
                        leaving = true
                        scope.launch { model.leave() }
                    },
                    enabled = !leaving,
                    destructive = true,
                ) {
                    if (leaving) {
                        CircularProgressIndicator(Modifier.size(18.dp), color = MerrariaColors.Danger, strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null, modifier = Modifier.size(18.dp))
                    }
                    ButtonLabel(if (leaving) "Saving…" else "Save & leave world")
                }
            }
            Spacer(Modifier.weight(1f, fill = false))
        }
    }
}
