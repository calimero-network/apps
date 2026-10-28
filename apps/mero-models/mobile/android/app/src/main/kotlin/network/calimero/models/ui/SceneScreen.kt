@file:Suppress("MatchingDeclarationName")

package network.calimero.models.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.CenterFocusStrong
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Contrast
import androidx.compose.material.icons.outlined.GridOn
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.ViewInAr
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import network.calimero.models.core.BlobLoading
import network.calimero.models.core.CheckOut
import network.calimero.models.core.ModelsFormat
import network.calimero.models.core.OutlineRow
import network.calimero.models.core.SceneModel
import network.calimero.models.generated.LockView
import network.calimero.models.generated.MemberView
import network.calimero.models.generated.SceneObject

/** The panel under the viewport. (Swift `PanelTab`.) */
enum class PanelTab(
    val title: String,
) {
    OBJECTS("Objects"),
    CHECK_OUTS("Check-outs"),
    PEOPLE("People"),
}

/** One scene, view only: the 3D viewport on top, and the objects, check-outs and members under it. */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SceneScreen(
    backend: MeroAppBackend,
    studioId: String,
    contextId: String,
    name: String,
    blobs: BlobLoading,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val model = remember(backend, contextId) { SceneModel(backend, studioId, contextId, name, blobs) }
    val viewport = remember { ViewportController(context, scope) }
    DisposableEffect(viewport) { onDispose { viewport.destroy() } }

    val phase by model.phase.collectAsState()
    val title by model.name.collectAsState()
    val viewerScene by model.viewerScene.collectAsState()
    val selectedId by model.selectedId.collectAsState()
    val objects by model.objects.collectAsState()
    var tab by remember { mutableStateOf(PanelTab.OBJECTS) }
    var panelOpen by remember { mutableStateOf(true) }
    var showAbout by remember { mutableStateOf(false) }
    var sharing by remember { mutableStateOf(false) }
    var shareError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(model) {
        viewport.blob = { id -> model.blob(id) }
        viewport.onPick = { id -> model.select(id) }
        model.open()
        model.live()
    }
    LaunchedEffect(viewerScene) { model.viewerJson()?.let { viewport.setScene(it) } }

    fun pick(id: String) {
        model.select(id)
        viewport.select(id)
        viewport.frame(id)
    }

    fun share() {
        sharing = true
        scope.launch {
            try {
                shareLink(context, model.shareLink(), title)
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                shareError = ModelsFormat.errorText(e)
            } finally {
                sharing = false
            }
        }
    }

    Scaffold(
        containerColor = ModelsTheme.ground,
        topBar = {
            TopAppBar(
                title = { Text(title.ifEmpty { "Scene" }, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") } },
                actions = {
                    IconButton(onClick = ::share, enabled = !sharing) {
                        if (sharing) {
                            CircularProgressIndicator(color = ModelsTheme.ink, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                        } else {
                            Icon(Icons.Outlined.Share, contentDescription = "Share link")
                        }
                    }
                    IconButton(onClick = { showAbout = true }) { Icon(Icons.Outlined.Info, contentDescription = "About this scene") }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = ModelsTheme.ground),
            )
        },
    ) { padding ->
        val p = phase
        if (p is SceneModel.Phase.Failed) {
            Box(Modifier.padding(padding).fillMaxSize(), contentAlignment = Alignment.Center) {
                ErrorState(p.message) { scope.launch { model.open() } }
            }
        } else {
            Column(Modifier.padding(padding).fillMaxSize()) {
                Box(Modifier.weight(1f).fillMaxWidth().background(ModelsTheme.viewport)) {
                    AndroidView(factory = { viewport.webView }, modifier = Modifier.fillMaxSize())
                    Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.Top) {
                        if (viewport.pending > 0) {
                            StatusChip(if (viewport.pending == 1) "Loading 1 asset…" else "Loading ${viewport.pending} assets…")
                        }
                        Spacer(Modifier.weight(1f))
                        ViewportControls(viewport)
                    }
                    val selected = objects.firstOrNull { it.id == selectedId }
                    if (selected != null) {
                        Box(Modifier.align(Alignment.BottomCenter).padding(12.dp)) {
                            SelectedCard(model, selected, frame = { viewport.frame(selected.id) }) {
                                model.select(null)
                                viewport.select(null)
                            }
                        }
                    }
                    if (p is SceneModel.Phase.Loading) {
                        Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
                            Text("Opening the scene…", style = ModelsTheme.body(14, color = Color.White.copy(alpha = 0.7f)))
                        }
                    } else if (objects.isEmpty()) {
                        Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Icon(Icons.Outlined.ViewInAr, contentDescription = null, tint = Color.White.copy(alpha = 0.6f), modifier = Modifier.size(30.dp))
                            Text("This scene is empty", style = ModelsTheme.heading(16).copy(color = Color.White))
                            Text("Objects added in the studio show up here.", style = ModelsTheme.body(14, color = Color.White.copy(alpha = 0.6f)))
                        }
                    }
                }
                ScenePanel(model, tab, { tab = it }, panelOpen, { panelOpen = it }, ::pick)
            }
        }
    }

    if (showAbout) AboutSheet(model) { showAbout = false }
    shareError?.let { message ->
        AlertDialog(
            onDismissRequest = { shareError = null },
            title = { Text("Couldn't make a link") },
            text = { Text(message) },
            confirmButton = { TextButton(onClick = { shareError = null }) { Text("OK") } },
        )
    }
}

/** Fit, shading and grid, floating over the viewport's corner. */
@Composable
private fun ViewportControls(viewport: ViewportController) {
    val shape = RoundedCornerShape(12.dp)
    Column(
        Modifier
            .background(Color.Black.copy(alpha = 0.45f), shape)
            .border(ModelsTheme.hairline, Color.White.copy(alpha = 0.12f), shape),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Control(Icons.Outlined.CenterFocusStrong, "Fit the scene") { viewport.frame(null) }
        HorizontalDivider(Modifier.width(28.dp), color = Color.White.copy(alpha = 0.12f))
        val solid = viewport.shading == ViewportController.Shading.SOLID
        Control(if (solid) Icons.Outlined.Contrast else Icons.Outlined.AutoAwesome, if (solid) "Solid shading" else "Rendered shading") {
            viewport.toggleShading()
        }
        HorizontalDivider(Modifier.width(28.dp), color = Color.White.copy(alpha = 0.12f))
        Control(Icons.Outlined.GridOn, if (viewport.grid) "Hide grid" else "Show grid", on = viewport.grid) { viewport.toggleGrid() }
    }
}

@Composable
private fun Control(
    icon: ImageVector,
    label: String,
    on: Boolean = true,
    action: () -> Unit,
) {
    Box(Modifier.size(44.dp).clickable(onClick = action).semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
        Icon(icon, contentDescription = null, tint = if (on) Color.White else Color.White.copy(alpha = 0.45f), modifier = Modifier.size(20.dp))
    }
}

/** A small dark pill over the viewport. */
@Composable
private fun StatusChip(text: String) {
    Row(
        Modifier.background(Color.Black.copy(alpha = 0.45f), RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CircularProgressIndicator(color = Color.White, strokeWidth = 1.5.dp, modifier = Modifier.size(12.dp))
        Spacer(Modifier.width(6.dp))
        Text(text, style = ModelsTheme.body(13, FontWeight.Medium, Color.White))
    }
}

/** The picked object: what it is, its size, and who has it checked out. */
@Composable
private fun SelectedCard(
    model: SceneModel,
    obj: SceneObject,
    frame: () -> Unit,
    close: () -> Unit,
) {
    val lock = model.lock(obj.id)
    Column(
        Modifier.fillMaxWidth().shadow(12.dp, ModelsTheme.cardShape).card(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            KindTile(obj.kind, 36.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(obj.name.ifEmpty { ModelsFormat.kindLabel(obj.kind) }, style = ModelsTheme.heading(16), maxLines = 1, overflow = TextOverflow.Ellipsis)
                val parts = mutableListOf(ModelsFormat.kindLabel(obj.kind))
                model.mesh(obj.id)?.let {
                    parts += "${ModelsFormat.compact(it.triangleCount.toLong())} triangles"
                    parts += "${ModelsFormat.compact(it.vertexCount.toLong())} vertices"
                }
                if (!obj.visible) parts += "Hidden"
                Text(parts.joinToString(" · "), style = ModelsTheme.body(13, color = ModelsTheme.muted), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            RoundIcon(Icons.Outlined.CenterFocusStrong, "Frame", frame)
            Spacer(Modifier.width(8.dp))
            RoundIcon(Icons.Outlined.Close, "Close", close)
        }
        LockLine(lock, lock?.let { if (it.mine) "you" else model.nameFor(it.holder) })
    }
}

@Composable
private fun RoundIcon(
    icon: ImageVector,
    label: String,
    action: () -> Unit,
) {
    Box(
        Modifier
            .size(34.dp)
            .clip(CircleShape)
            .background(ModelsTheme.sunken)
            .clickable(onClick = action)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = ModelsTheme.ink, modifier = Modifier.size(17.dp))
    }
}

/** "Checked out by Ana 2h ago, until 18:00", or "Not checked out". */
@Composable
private fun LockLine(
    lock: LockView?,
    holderName: String?,
) {
    Row(verticalAlignment = Alignment.Top) {
        Icon(
            if (lock == null) Icons.Outlined.LockOpen else Icons.Filled.Lock,
            contentDescription = null,
            tint =
                when {
                    lock == null -> ModelsTheme.faint
                    lock.mine -> ModelsTheme.ink
                    else -> ModelsTheme.amber
                },
            modifier = Modifier.size(15.dp),
        )
        Spacer(Modifier.width(8.dp))
        if (lock != null) {
            Text(
                "Checked out by ${holderName ?: "someone"} ${ModelsFormat.relativeTime(lock.since.toLong())}, until ${ModelsFormat.until(lock.expiresAt.toLong())}",
                style = ModelsTheme.body(13),
            )
        } else {
            Text("Not checked out", style = ModelsTheme.body(13, color = ModelsTheme.muted))
        }
    }
}

/** Objects, check-outs and people, in tabs under the viewport. */
@Suppress("LongMethod", "LongParameterList")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ScenePanel(
    model: SceneModel,
    tab: PanelTab,
    onTab: (PanelTab) -> Unit,
    open: Boolean,
    onOpen: (Boolean) -> Unit,
    pick: (String) -> Unit,
) {
    val objects by model.objects.collectAsState()
    val locks by model.locks.collectAsState()
    val members by model.members.collectAsState()
    val selectedId by model.selectedId.collectAsState()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().background(ModelsTheme.ground)) {
        HorizontalDivider(thickness = ModelsTheme.hairline, color = ModelsTheme.line)
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            PanelTab.entries.forEach { t ->
                val count =
                    when (t) {
                        PanelTab.OBJECTS -> objects.size
                        PanelTab.CHECK_OUTS -> locks.size
                        PanelTab.PEOPLE -> members.size
                    }
                val on = tab == t
                Row(
                    Modifier
                        .padding(end = 6.dp)
                        .height(34.dp)
                        .clip(RoundedCornerShape(50))
                        .background(if (on) ModelsTheme.lime else ModelsTheme.surface)
                        .then(if (on) Modifier else Modifier.border(ModelsTheme.hairline, ModelsTheme.line, RoundedCornerShape(50)))
                        .clickable {
                            onTab(t)
                            onOpen(true)
                        }.padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(t.title, style = ModelsTheme.body(14, FontWeight.SemiBold, ModelsTheme.ink))
                    Spacer(Modifier.width(5.dp))
                    Text("$count", style = ModelsTheme.body(14, FontWeight.SemiBold, if (on) ModelsTheme.ink.copy(alpha = 0.6f) else ModelsTheme.faint))
                }
            }
            Spacer(Modifier.weight(1f))
            Box(
                Modifier
                    .size(34.dp)
                    .clip(CircleShape)
                    .background(ModelsTheme.surface)
                    .border(ModelsTheme.hairline, ModelsTheme.line, CircleShape)
                    .clickable { onOpen(!open) }
                    .semantics { contentDescription = if (open) "Collapse" else "Expand" },
                contentAlignment = Alignment.Center,
            ) {
                Icon(if (open) Icons.Outlined.KeyboardArrowDown else Icons.Outlined.KeyboardArrowUp, contentDescription = null, tint = ModelsTheme.ink2)
            }
        }
        AnimatedVisibility(open) {
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = {
                    scope.launch {
                        refreshing = true
                        model.refresh()
                        refreshing = false
                    }
                },
                modifier = Modifier.fillMaxWidth().height(280.dp),
            ) {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 2.dp)) {
                    when (tab) {
                        PanelTab.OBJECTS -> {
                            if (objects.isEmpty()) item { EmptyState(Icons.Outlined.ViewInAr, "No objects", "Objects added in the studio show up here.") }
                            items(model.outline(), key = { it.id }) { row ->
                                ObjectRow(row, row.id == selectedId, row.lock?.let { if (it.mine) "You" else model.nameFor(it.holder) }) { pick(row.id) }
                            }
                        }
                        PanelTab.CHECK_OUTS -> {
                            val rows = model.checkOuts()
                            if (rows.isEmpty()) {
                                item {
                                    EmptyState(
                                        Icons.Outlined.LockOpen,
                                        "Nothing is checked out",
                                        "When someone checks out an object or texture in the studio, it shows here with who has it.",
                                    )
                                }
                            }
                            items(rows, key = { it.assetId }) { c ->
                                CheckOutRow(c) { if (c.assetKind != "texture" && c.assetKind != "object") pick(c.assetId) }
                            }
                        }
                        PanelTab.PEOPLE -> {
                            if (members.isEmpty()) item { EmptyState(Icons.Outlined.Group, "Nobody has joined yet", "Members appear once they open the scene.") }
                            items(members, key = { it.id }) { m -> MemberRow(m, model.nameFor(m.id), m.id == model.account) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ObjectRow(
    row: OutlineRow,
    selected: Boolean,
    holderName: String?,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (selected) ModelsTheme.lime.copy(alpha = 0.35f) else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(start = 8.dp + (minOf(row.depth, 6) * 18).dp, end = 8.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        KindTile(row.obj.kind, 30.dp)
        Spacer(Modifier.width(10.dp))
        Text(
            row.obj.name.ifEmpty { ModelsFormat.kindLabel(row.obj.kind) },
            style = ModelsTheme.body(15, if (selected) FontWeight.SemiBold else FontWeight.Normal, if (row.obj.visible) ModelsTheme.ink else ModelsTheme.faint),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false),
        )
        if (!row.obj.visible) {
            Spacer(Modifier.width(6.dp))
            Icon(Icons.Outlined.VisibilityOff, contentDescription = "Hidden", tint = ModelsTheme.faint, modifier = Modifier.size(14.dp))
        }
        Spacer(Modifier.weight(1f))
        row.lock?.let { lock ->
            val tint = if (lock.mine) ModelsTheme.ink else ModelsTheme.amber
            Icon(Icons.Filled.Lock, contentDescription = null, tint = tint, modifier = Modifier.size(12.dp))
            Spacer(Modifier.width(4.dp))
            Text(holderName.orEmpty(), style = ModelsTheme.body(12, FontWeight.Medium, tint), maxLines = 1)
        }
    }
}

@Composable
private fun CheckOutRow(
    c: CheckOut,
    onClick: () -> Unit,
) {
    Row(
        Modifier
            .padding(horizontal = 4.dp, vertical = 6.dp)
            .fillMaxWidth()
            .clip(ModelsTheme.cardShape)
            .clickable(onClick = onClick)
            .card(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        KindTile(c.assetKind, 36.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(c.assetName, style = ModelsTheme.heading(15), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                "${c.holderName} · since ${ModelsFormat.relativeTime(c.since)} · until ${ModelsFormat.until(c.expiresAt)}",
                style = ModelsTheme.body(13, color = ModelsTheme.muted),
                maxLines = 2,
            )
        }
        Icon(Icons.Filled.Lock, contentDescription = null, tint = if (c.mine) ModelsTheme.ink else ModelsTheme.amber, modifier = Modifier.size(15.dp))
    }
}

@Composable
private fun MemberRow(
    m: MemberView,
    name: String,
    isMe: Boolean,
) {
    Row(
        Modifier.padding(horizontal = 4.dp, vertical = 6.dp).fillMaxWidth().card(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(m.id, name, 36.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(if (isMe) "$name (you)" else name, style = ModelsTheme.heading(15), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(ModelsFormat.shortId(m.id), style = ModelsTheme.body(12, color = ModelsTheme.muted).copy(fontFamily = FontFamily.Monospace))
        }
        RoleBadge(m.role)
    }
}

/** Counts, your access, and the ids behind Details. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AboutSheet(
    model: SceneModel,
    onDismiss: () -> Unit,
) {
    val objects by model.objects.collectAsState()
    val meshes by model.meshes.collectAsState()
    val textures by model.textures.collectAsState()
    val members by model.members.collectAsState()
    val info by model.info.collectAsState()
    val title by model.name.collectAsState()
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = ModelsTheme.ground) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(title.ifEmpty { "Scene" }, style = ModelsTheme.heading(17), modifier = Modifier.align(Alignment.CenterHorizontally))
            Column(Modifier.fillMaxWidth().card(4.dp)) {
                Stat("Objects", "${objects.size}")
                HorizontalDivider(color = ModelsTheme.line)
                Stat("Meshes", "${meshes.size}")
                HorizontalDivider(color = ModelsTheme.line)
                Stat("Textures", "${textures.size}")
                HorizontalDivider(color = ModelsTheme.line)
                Stat("Triangles", ModelsFormat.compact(meshes.sumOf { it.triangleCount.toLong() }))
                HorizontalDivider(color = ModelsTheme.line)
                Stat("Members", "${members.size}")
            }
            Column(Modifier.fillMaxWidth().card(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Your access", style = ModelsTheme.heading(15))
                    Spacer(Modifier.weight(1f))
                    info?.myRole?.let { RoleBadge(it) }
                }
                Text(
                    "This app shows scenes; modelling, check-outs and roles are in Mero Models on the web or desktop.",
                    style = ModelsTheme.body(14, color = ModelsTheme.muted),
                )
            }
            DetailsDisclosure(
                listOf(
                    "Scene (context)" to model.contextId,
                    "Studio (namespace)" to model.studioId,
                    "Your account" to model.account,
                ),
                Modifier.fillMaxWidth().card(),
            )
        }
    }
}

@Composable
private fun Stat(
    label: String,
    value: String,
) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 11.dp)) {
        Text(label, style = ModelsTheme.body(15))
        Spacer(Modifier.weight(1f))
        Text(value, style = ModelsTheme.body(15, FontWeight.SemiBold, ModelsTheme.ink))
    }
}
