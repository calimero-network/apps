package network.calimero.design.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.filled.Navigation
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.CropFree
import androidx.compose.material.icons.outlined.FitScreen
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.launch
import network.calimero.design.app.BoardModel
import network.calimero.design.app.Viewer
import network.calimero.design.core.BlobLoading
import network.calimero.design.core.Point
import network.calimero.design.core.Viewport
import kotlin.math.roundToInt

/** One board, read-only: pan and pinch, present, read and add comments, see who else is here. */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BoardScreen(
    backend: MeroAppBackend,
    teamId: String,
    contextId: String,
    name: String,
    blobs: BlobLoading,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val model = remember(backend, contextId) { BoardModel(backend, teamId, contextId, name, scope, blobs, Fonts.measure) }
    val cache = remember(contextId) { ImageCache() }
    val phase by model.phase.collectAsState()
    val title by model.name.collectAsState()
    val scene by model.scene.collectAsState()
    val comments by model.comments.collectAsState()
    val viewers by model.viewers.collectAsState()
    var viewport by remember { mutableStateOf(Viewport()) }
    var size by remember { mutableStateOf(IntSize.Zero) }
    var didFit by remember { mutableStateOf(false) }
    var presenting by remember { mutableStateOf(false) }
    var commentsOpen by remember { mutableStateOf(false) }
    var openThread by remember { mutableStateOf<String?>(null) }
    var infoOpen by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    val bottomBarPx = with(androidx.compose.ui.platform.LocalDensity.current) { 80.dp.toPx() }

    fun fit() {
        viewport = Viewport.fit(scene.bounds, size.width.toDouble(), size.height.toDouble() - bottomBarPx)
    }

    LaunchedEffect(model) { model.open() }
    LaunchedEffect(model) { model.live() }
    LaunchedEffect(phase, size) {
        if (!didFit && phase == BoardModel.Phase.Ready && size.width > 0) {
            didFit = true
            fit()
        }
    }

    Scaffold(
        containerColor = Color.White,
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text(title.ifEmpty { "Board" }, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") } },
                actions = {
                    if (viewers.isNotEmpty()) ViewerStack(viewers)
                    Box {
                        IconButton(onClick = { menuOpen = true }) { Icon(Icons.Outlined.MoreHoriz, contentDescription = "Board options") }
                        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }, containerColor = DesignTheme.surface) {
                            DropdownMenuItem(
                                text = { Text("Share board link") },
                                leadingIcon = { Icon(Icons.Outlined.Share, null) },
                                onClick = {
                                    menuOpen = false
                                    shareLink(context, model.shareLink, title)
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Fit to screen") },
                                leadingIcon = { Icon(Icons.Outlined.FitScreen, null) },
                                onClick = {
                                    menuOpen = false
                                    fit()
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("About this board") },
                                leadingIcon = { Icon(Icons.Outlined.Info, null) },
                                onClick = {
                                    menuOpen = false
                                    infoOpen = true
                                },
                            )
                        }
                    }
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = DesignTheme.ground),
            )
        },
    ) { padding ->
        Box(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .background(Color.White)
                .onSizeChanged { size = it },
        ) {
            when (val p = phase) {
                BoardModel.Phase.Loading ->
                    Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        CircularProgressIndicator(color = DesignTheme.ink, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
                        Text("Opening board…", style = DesignTheme.body(14, color = DesignTheme.muted))
                    }
                is BoardModel.Phase.Failed -> Box(Modifier.align(Alignment.Center)) { ErrorState(p.message) { scope.launch { model.open() } } }
                BoardModel.Phase.Ready -> {
                    val images by model.images.collectAsState()
                    Canvas(
                        Modifier
                            .fillMaxSize()
                            .clipToBounds()
                            .pointerInput(Unit) {
                                detectTransformGestures { centroid, pan, zoom, _ ->
                                    viewport = viewport.zoomed(zoom.toDouble(), centroid.x.toDouble(), centroid.y.toDouble()).panned(pan.x.toDouble(), pan.y.toDouble())
                                }
                            }.pointerInput(Unit) { detectTapGestures(onDoubleTap = { fit() }) },
                    ) {
                        drawIntoCanvas { c ->
                            val nc = c.nativeCanvas
                            nc.save()
                            nc.translate(viewport.offsetX.toFloat(), viewport.offsetY.toFloat())
                            nc.scale(viewport.scale.toFloat(), viewport.scale.toFloat())
                            SceneRenderer.draw(nc, scene.nodes, images, cache)
                            nc.restore()
                        }
                    }
                    viewers.forEach { v ->
                        val pt = viewport.viewPoint(v.point)
                        ViewerPointer(v, Modifier.offset { IntOffset(pt.x.roundToInt(), pt.y.roundToInt()) })
                    }
                    comments.forEachIndexed { index, comment ->
                        val pt = viewport.viewPoint(Point(comment.x.toDouble(), comment.y.toDouble()))
                        CommentPin(
                            number = index + 1,
                            label = "Comment ${index + 1} by ${model.nameFor(comment.author)}",
                            modifier = Modifier.offset { IntOffset(pt.x.roundToInt(), pt.y.roundToInt() - 28.dp.roundToPx()) },
                        ) {
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            openThread = comment.id
                            commentsOpen = true
                        }
                    }
                    if (scene.nodes.isEmpty()) {
                        Box(Modifier.align(Alignment.Center)) {
                            EmptyState(Icons.Outlined.CropFree, "This board is empty", "Shapes, text and images added on the web or desktop show up here.")
                        }
                    }
                    BottomBar(
                        commentCount = comments.size,
                        present = {
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            presenting = true
                        },
                        comments = {
                            openThread = null
                            commentsOpen = true
                        },
                        fit = { fit() },
                        modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 12.dp),
                    )
                }
            }
        }
    }

    if (presenting) PresentScreen(model, cache) { presenting = false }
    if (commentsOpen) {
        val center = viewport.canvasPoint(size.width / 2.0, size.height / 2.0)
        CommentsSheet(model, newCommentAt = center, openThread = openThread) { commentsOpen = false }
    }
    if (infoOpen) BoardInfoSheet(model) { infoOpen = false }
}

/** A comment's pin: a lime bubble with its number, its point at the bottom left. */
@Composable
private fun CommentPin(
    number: Int,
    label: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp, bottomEnd = 14.dp, bottomStart = 0.dp)
    Box(
        modifier
            .defaultMinSize(28.dp, 28.dp)
            .shadow(3.dp, shape)
            .background(DesignTheme.lime, shape)
            .border(1.5.dp, DesignTheme.ink, shape)
            .clickable(onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Text("$number", style = DesignTheme.body(12, FontWeight.Bold, DesignTheme.ink))
    }
}

/** Someone else's pointer: an arrow in their colour with their name. */
@Composable
private fun ViewerPointer(
    viewer: Viewer,
    modifier: Modifier = Modifier,
) {
    val color = DesignTheme.memberColor(viewer.account)
    Row(modifier.semantics { contentDescription = "${viewer.name} is here" }) {
        Icon(Icons.Filled.Navigation, contentDescription = null, tint = color, modifier = Modifier.size(16.dp).rotate(-30f))
        Text(
            viewer.name,
            style = DesignTheme.body(11, FontWeight.SemiBold, Color.White),
            modifier = Modifier.padding(top = 10.dp).background(color, CircleShape).padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }
}

/** Up to three avatars of the people here, then a count. */
@Composable
private fun ViewerStack(viewers: List<Viewer>) {
    val label = if (viewers.size == 1) "1 other person here" else "${viewers.size} other people here"
    Row(Modifier.padding(end = 4.dp).semantics { contentDescription = label }) {
        viewers.take(3).forEachIndexed { i, v ->
            Avatar(v.account, v.name, 26.dp, Modifier.offset(x = (-8 * i).dp).border(2.dp, Color.White, CircleShape))
        }
        if (viewers.size > 3) {
            Box(
                Modifier
                    .offset(x = (-24).dp)
                    .size(26.dp)
                    .background(DesignTheme.sunken, CircleShape)
                    .border(2.dp, Color.White, CircleShape),
                contentAlignment = Alignment.Center,
            ) { Text("+${viewers.size - 3}", style = DesignTheme.body(11, FontWeight.SemiBold, DesignTheme.ink)) }
        }
    }
}

/** Present, comments and fit, floating over the board. */
@Composable
private fun BottomBar(
    commentCount: Int,
    present: () -> Unit,
    comments: () -> Unit,
    fit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .shadow(8.dp, CircleShape)
            .background(DesignTheme.surface.copy(alpha = 0.96f), CircleShape)
            .border(DesignTheme.hairline, DesignTheme.line, CircleShape)
            .padding(4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            Modifier
                .height(44.dp)
                .background(DesignTheme.lime, CircleShape)
                .clickable(onClick = present)
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.PlayArrow, contentDescription = null, tint = DesignTheme.ink, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(6.dp))
            Text("Present", style = DesignTheme.body(15, FontWeight.SemiBold, DesignTheme.ink))
        }
        Row(
            Modifier
                .height(44.dp)
                .clickable(onClick = comments)
                .padding(horizontal = 14.dp)
                .semantics { contentDescription = if (commentCount == 1) "1 comment" else "$commentCount comments" },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.ChatBubbleOutline, contentDescription = null, tint = DesignTheme.ink, modifier = Modifier.size(20.dp))
            if (commentCount > 0) {
                Spacer(Modifier.width(6.dp))
                Text("$commentCount", style = DesignTheme.body(15, FontWeight.SemiBold, DesignTheme.ink))
            }
        }
        IconButton(onClick = fit, modifier = Modifier.size(44.dp)) {
            Icon(Icons.Outlined.FitScreen, contentDescription = "Fit to screen", tint = DesignTheme.ink)
        }
    }
}

/** Name, size, members and the ids. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BoardInfoSheet(
    model: BoardModel,
    onDismiss: () -> Unit,
) {
    val name by model.name.collectAsState()
    val elements by model.elements.collectAsState()
    val scene by model.scene.collectAsState()
    val comments by model.comments.collectAsState()
    val members by model.members.collectAsState()
    val role by model.role.collectAsState()
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = DesignTheme.ground) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("About this board", style = DesignTheme.heading(17), modifier = Modifier.align(Alignment.CenterHorizontally))
            Column(Modifier.fillMaxWidth().card(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(name.ifEmpty { "Board" }, style = DesignTheme.heading(20))
                val layers = if (elements.size == 1) "1 layer" else "${elements.size} layers"
                val screens = if (scene.screens.size == 1) "1 screen" else "${scene.screens.size} screens"
                val count = if (comments.size == 1) "1 comment" else "${comments.size} comments"
                Text("$layers · $screens · $count", style = DesignTheme.body(14, color = DesignTheme.muted))
                Text(
                    when (role) {
                        "admin" -> "You are an admin of this board."
                        "editor" -> "You can edit and comment on this board."
                        "viewer" -> "You have view-only access."
                        else -> "Checking your access…"
                    },
                    style = DesignTheme.body(14),
                )
            }
            if (members.isNotEmpty()) {
                Column(Modifier.fillMaxWidth().card(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    SectionLabel("Members")
                    members.forEach { m ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Avatar(m.id, model.nameFor(m.id), 30.dp)
                            Spacer(Modifier.width(10.dp))
                            Text(model.nameFor(m.id), style = DesignTheme.body(15, color = DesignTheme.ink))
                            if (m.id == model.account) {
                                Spacer(Modifier.width(6.dp))
                                Text("You", style = DesignTheme.body(13, color = DesignTheme.muted))
                            }
                        }
                    }
                }
            }
            DetailsDisclosure(listOf("Board (context)" to model.contextId, "Team" to model.teamId), Modifier.fillMaxWidth().card())
            Spacer(Modifier.height(8.dp))
        }
    }
}
