package network.calimero.pixart.ui

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Brush
import androidx.compose.material.icons.outlined.CenterFocusWeak
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.IosShare
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.TextFields
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import network.calimero.pixart.app.ArtworkModel
import network.calimero.pixart.app.BitmapRaster
import network.calimero.pixart.app.Compositor
import network.calimero.pixart.core.BlendMode
import network.calimero.pixart.core.BlobStore
import network.calimero.pixart.core.LayerRow
import network.calimero.pixart.core.PixartFormat
import network.calimero.pixart.core.Viewport
import java.io.File
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/** One project, view-only: the composed image with pinch and pan, the layer list (show and hide on this phone only), export as PNG, and its details. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
@Suppress("LongMethod", "LongParameterList", "CyclomaticComplexMethod")
fun ArtworkScreen(
    backend: MeroAppBackend,
    teamId: String,
    contextId: String,
    name: String,
    blobs: BlobStore,
    onBack: () -> Unit,
) {
    val model = remember(backend, contextId) { ArtworkModel(backend, teamId, contextId, name, blobs, Compositor) }
    val phase by model.phase.collectAsState()
    val title by model.name.collectAsState()
    val document by model.document.collectAsState()
    val layers by model.layers.collectAsState()
    val overrides by model.overrides.collectAsState()
    val missing by model.missing.collectAsState()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var viewport by remember { mutableStateOf(Viewport()) }
    var viewSize by remember { mutableStateOf(IntSize.Zero) }
    var didFit by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    var layersOpen by remember { mutableStateOf(false) }
    var infoOpen by remember { mutableStateOf(false) }
    var exporting by remember { mutableStateOf(false) }
    var exportFailed by remember { mutableStateOf(false) }
    val barSpace = with(LocalDensity.current) { 76.dp.toPx() }

    LaunchedEffect(model) { model.open() }
    LaunchedEffect(model) { model.live() }

    fun fitted(): Viewport {
        val d = document ?: return viewport
        return Viewport.fit(d.width.toDouble(), d.height.toDouble(), viewSize.width.toDouble(), viewSize.height - barSpace.toDouble())
    }
    LaunchedEffect(document, viewSize) {
        if (!didFit && document != null && viewSize.width > 0) {
            didFit = true
            viewport = fitted()
        }
    }

    Scaffold(
        containerColor = PixartTheme.stage,
        topBar = {
            TopAppBar(
                title = { Text(title.ifEmpty { "Project" }, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") } },
                actions = {
                    IconButton(onClick = { menuOpen = true }) { Icon(Icons.Outlined.MoreVert, contentDescription = "Project options") }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        DropdownMenuItem(
                            text = { Text("Share project link") },
                            leadingIcon = { Icon(Icons.Outlined.Link, contentDescription = null) },
                            onClick = {
                                menuOpen = false
                                shareLink(context, model.shareLink, title)
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("Fit to screen") },
                            leadingIcon = { Icon(Icons.Outlined.CenterFocusWeak, contentDescription = null) },
                            onClick = {
                                menuOpen = false
                                viewport = fitted()
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("About this project") },
                            leadingIcon = { Icon(Icons.Outlined.Info, contentDescription = null) },
                            onClick = {
                                menuOpen = false
                                infoOpen = true
                            },
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = PixartTheme.ground),
            )
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize().onSizeChanged { viewSize = it }) {
            when (val p = phase) {
                ArtworkModel.Phase.Loading ->
                    Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        CircularProgressIndicator(color = PixartTheme.ink, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
                        Text("Opening project…", style = PixartTheme.body(14, color = PixartTheme.muted))
                    }
                is ArtworkModel.Phase.Failed -> Box(Modifier.align(Alignment.Center)) { ErrorState(p.message) { scope.launch { model.open() } } }
                ArtworkModel.Phase.Ready -> {
                    ArtworkCanvas(
                        model = model,
                        viewport = viewport,
                        onViewport = { viewport = it },
                        onDoubleTap = {
                            val fit = fitted()
                            viewport =
                                if (abs(viewport.scale - fit.scale) < 0.001) {
                                    fit.zoomed(2.5, viewSize.width / 2.0, (viewSize.height - barSpace) / 2.0)
                                } else {
                                    fit
                                }
                        },
                    )
                    Column(Modifier.fillMaxSize().padding(vertical = 12.dp).navigationBarsPadding(), horizontalAlignment = Alignment.CenterHorizontally) {
                        if (overrides.isNotEmpty() || missing > 0) {
                            Notice(
                                missing = missing,
                                hasOverrides = overrides.isNotEmpty(),
                                onReset = { scope.launch { model.resetVisibility() } },
                            )
                        }
                        Spacer(Modifier.weight(1f))
                        BottomBar(
                            layerCount = layers.size,
                            exporting = exporting,
                            onLayers = { layersOpen = true },
                            onFit = { viewport = fitted() },
                            onExport = {
                                scope.launch {
                                    exporting = true
                                    val ok = exportAndShare(context, model, title)
                                    exporting = false
                                    if (!ok) exportFailed = true
                                }
                            },
                        )
                    }
                }
            }
        }
    }

    if (layersOpen) {
        LayersSheet(
            rows = model.rows(layers, overrides),
            hasOverrides = overrides.isNotEmpty(),
            onToggle = { id -> scope.launch { model.toggle(id) } },
            onReset = { scope.launch { model.resetVisibility() } },
            onDismiss = { layersOpen = false },
        )
    }
    if (infoOpen) ProjectInfoSheet(model, onDismiss = { infoOpen = false })
    if (exportFailed) {
        AlertDialog(
            onDismissRequest = { exportFailed = false },
            title = { Text("Couldn't export the image") },
            text = { Text("The image could not be drawn. Try again once every layer has loaded.") },
            confirmButton = { TextButton(onClick = { exportFailed = false }) { Text("OK") } },
        )
    }
}

/** Draw the PNG, put it in the cache, and hand it to the share sheet. */
private suspend fun exportAndShare(
    context: Context,
    model: ArtworkModel,
    title: String,
): Boolean {
    val png = model.exportPng() ?: return false
    val file =
        withContext(Dispatchers.IO) {
            runCatching {
                val dir = File(context.cacheDir, "exports").apply { mkdirs() }
                File(dir, PixartFormat.fileName(title)).apply { writeBytes(png) }
            }.getOrNull()
        } ?: return false
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    val send =
        Intent(Intent.ACTION_SEND)
            .setType("image/png")
            .putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    context.startActivity(Intent.createChooser(send, "Export image"))
    return true
}

/** The composite at the viewport, over a checkerboard, with pinch and pan. */
@Composable
private fun ArtworkCanvas(
    model: ArtworkModel,
    viewport: Viewport,
    onViewport: (Viewport) -> Unit,
    onDoubleTap: () -> Unit,
) {
    val image by model.image.collectAsState()
    val rendering by model.rendering.collectAsState()
    val document by model.document.collectAsState()
    val bitmap = remember(image) { (image as? BitmapRaster)?.bitmap?.asImageBitmap() }
    var current by remember { mutableStateOf(viewport) }
    current = viewport
    Box(Modifier.fillMaxSize().clipToBounds()) {
        Canvas(
            Modifier
                .fillMaxSize()
                .semantics { contentDescription = "Artwork" }
                .pointerInput(Unit) {
                    detectTransformGestures { centroid, pan, zoom, _ ->
                        onViewport(current.zoomed(zoom.toDouble(), centroid.x.toDouble(), centroid.y.toDouble()).panned(pan.x.toDouble(), pan.y.toDouble()))
                    }
                }.pointerInput(Unit) { detectTapGestures(onDoubleTap = { onDoubleTap() }) },
        ) {
            val d = document ?: return@Canvas
            val x = viewport.offsetX.toFloat()
            val y = viewport.offsetY.toFloat()
            val w = (d.width.toDouble() * viewport.scale).toFloat()
            val h = (d.height.toDouble() * viewport.scale).toFloat()
            // Shadow, then the checkerboard over the visible part only.
            drawRect(Color.Black.copy(alpha = 0.06f), Offset(x - 1, y + 2), Size(w + 2, h + 2))
            val left = max(0f, x)
            val top = max(0f, y)
            val right = min(size.width, x + w)
            val bottom = min(size.height, y + h)
            if (right > left && bottom > top) {
                drawRect(Color.White, Offset(left, top), Size(right - left, bottom - top))
                val cell = 10.dp.toPx()
                var cy = floor((top - y) / cell).toInt()
                while (y + cy * cell < bottom) {
                    var cx = floor((left - x) / cell).toInt()
                    while (x + cx * cell < right) {
                        if ((cx + cy) % 2 != 0) {
                            val ox = max(left, x + cx * cell)
                            val oy = max(top, y + cy * cell)
                            drawRect(
                                CHECKER,
                                Offset(ox, oy),
                                Size(min(right, x + (cx + 1) * cell) - ox, min(bottom, y + (cy + 1) * cell) - oy),
                            )
                        }
                        cx++
                    }
                    cy++
                }
            }
            bitmap?.let {
                drawImage(
                    it,
                    dstOffset = IntOffset(x.toInt(), y.toInt()),
                    dstSize = IntSize(ceil(w).toInt(), ceil(h).toInt()),
                    filterQuality = if (viewport.scale > 3) FilterQuality.None else FilterQuality.High,
                )
            }
        }
        if (bitmap == null || rendering) {
            Surface(shape = CircleShape, color = PixartTheme.surface.copy(alpha = 0.9f), modifier = Modifier.align(Alignment.Center)) {
                CircularProgressIndicator(color = PixartTheme.ink, strokeWidth = 2.dp, modifier = Modifier.padding(10.dp).size(20.dp))
            }
        }
    }
}

private val CHECKER = Color(0xFFE9E9E6)

/** A line under the title when this phone's view differs from the document. */
@Composable
private fun Notice(
    missing: Int,
    hasOverrides: Boolean,
    onReset: () -> Unit,
) {
    Row(
        Modifier
            .padding(horizontal = 16.dp)
            .background(PixartTheme.surface.copy(alpha = 0.94f), RoundedCornerShape(50))
            .border(PixartTheme.hairline, PixartTheme.line, RoundedCornerShape(50))
            .padding(horizontal = 14.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            if (missing > 0) Icons.Outlined.WarningAmber else Icons.Outlined.VisibilityOff,
            contentDescription = null,
            tint = PixartTheme.ink,
            modifier = Modifier.size(16.dp),
        )
        Spacer(Modifier.width(8.dp))
        val text =
            when {
                missing == 1 -> "1 layer's pixels couldn't be loaded"
                missing > 1 -> "$missing layers' pixels couldn't be loaded"
                else -> "Only on this phone: some layers are shown or hidden"
            }
        Text(text, style = PixartTheme.body(13, FontWeight.Medium, PixartTheme.ink), maxLines = 2)
        if (hasOverrides) {
            TextButton(onClick = onReset, contentPadding = PaddingValues(horizontal = 8.dp)) {
                Text("Reset", style = PixartTheme.body(13, FontWeight.SemiBold, PixartTheme.ink))
            }
        }
    }
}

/** Layers, fit and export, floating over the artwork. */
@Composable
private fun BottomBar(
    layerCount: Int,
    exporting: Boolean,
    onLayers: () -> Unit,
    onFit: () -> Unit,
    onExport: () -> Unit,
) {
    Row(
        Modifier
            .shadow(12.dp, RoundedCornerShape(50), ambientColor = Color.Black.copy(alpha = 0.08f), spotColor = Color.Black.copy(alpha = 0.08f))
            .background(PixartTheme.surface, RoundedCornerShape(50))
            .border(PixartTheme.hairline, PixartTheme.line, RoundedCornerShape(50))
            .padding(4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            Modifier.height(44.dp).clickable(onClick = onLayers).padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(Icons.Outlined.Layers, contentDescription = null, tint = PixartTheme.ink, modifier = Modifier.size(20.dp))
            Text("Layers", style = PixartTheme.body(15, FontWeight.SemiBold, PixartTheme.ink))
            if (layerCount > 0) Text("$layerCount", style = PixartTheme.body(15, FontWeight.SemiBold, PixartTheme.muted))
        }
        IconButton(onClick = onFit, modifier = Modifier.size(44.dp)) {
            Icon(Icons.Outlined.CenterFocusWeak, contentDescription = "Fit to screen", tint = PixartTheme.ink)
        }
        Row(
            Modifier
                .height(44.dp)
                .background(PixartTheme.lime, RoundedCornerShape(50))
                .clickable(enabled = !exporting, onClick = onExport)
                .padding(horizontal = 16.dp)
                .semantics { contentDescription = "Export, shares the image as a PNG" },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (exporting) {
                CircularProgressIndicator(color = PixartTheme.ink, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
            } else {
                Icon(Icons.Outlined.IosShare, contentDescription = null, tint = PixartTheme.ink, modifier = Modifier.size(20.dp))
            }
            Text("Export", style = PixartTheme.body(15, FontWeight.SemiBold, PixartTheme.ink))
        }
    }
}

/** The folder tree, front-most first. The eye shows or hides a layer on this phone only. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LayersSheet(
    rows: List<LayerRow>,
    hasOverrides: Boolean,
    onToggle: (String) -> Unit,
    onReset: () -> Unit,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = PixartTheme.ground, sheetState = rememberModalBottomSheetState()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) {
                if (hasOverrides) TextButton(onClick = onReset) { Text("Reset", color = PixartTheme.ink) }
            }
            Text("Layers", style = PixartTheme.heading(17))
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                TextButton(onClick = onDismiss) { Text("Done", color = PixartTheme.ink, fontWeight = FontWeight.SemiBold) }
            }
        }
        LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(16.dp)) {
            if (rows.isEmpty()) {
                item { EmptyState(Icons.Outlined.Layers, "No layers yet", "Layers added on the web or desktop show up here.") }
            } else {
                item {
                    Column(Modifier.fillMaxWidth().card(0.dp)) {
                        rows.forEachIndexed { i, row ->
                            LayerRowView(row) { onToggle(row.id) }
                            if (i < rows.size - 1) {
                                Box(
                                    Modifier
                                        .fillMaxWidth()
                                        .padding(start = 60.dp)
                                        .height(PixartTheme.hairline)
                                        .background(PixartTheme.line),
                                )
                            }
                        }
                    }
                }
            }
            item {
                Text(
                    "Showing or hiding a layer here changes only what this phone shows and exports. Everyone else sees the project as it is.",
                    style = PixartTheme.body(12, color = PixartTheme.muted),
                    modifier = Modifier.padding(top = 10.dp, start = 4.dp, end = 4.dp, bottom = 24.dp),
                )
            }
        }
    }
}

@Composable
private fun LayerRowView(
    row: LayerRow,
    onToggle: () -> Unit,
) {
    val layer = row.layer
    Row(
        Modifier
            .fillMaxWidth()
            .padding(start = 12.dp + (min(row.depth, 6) * 18).dp, end = 6.dp, top = 8.dp, bottom = 8.dp)
            .alpha(if (row.visible && !row.hiddenByFolder) 1f else 0.45f),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(32.dp).background(PixartTheme.sunken, RoundedCornerShape(8.dp)), contentAlignment = Alignment.Center) {
            Icon(kindIcon(layer.kind), contentDescription = null, tint = PixartTheme.ink2, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    layer.name.ifEmpty { "Untitled layer" },
                    style = PixartTheme.body(15, FontWeight.Medium, PixartTheme.ink),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (layer.locked) {
                    Spacer(Modifier.width(6.dp))
                    Icon(Icons.Outlined.Lock, contentDescription = "Locked", tint = PixartTheme.faint, modifier = Modifier.size(12.dp))
                }
            }
            Text(subtitle(row), style = PixartTheme.body(12, color = PixartTheme.muted), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        IconButton(onClick = onToggle, modifier = Modifier.size(40.dp)) {
            Box(
                Modifier.size(40.dp).background(if (row.overridden) PixartTheme.lime.copy(alpha = 0.6f) else Color.Transparent, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (row.visible) Icons.Outlined.Visibility else Icons.Outlined.VisibilityOff,
                    contentDescription = if (row.visible) "Hide on this phone" else "Show on this phone",
                    tint = if (row.overridden) PixartTheme.ink else PixartTheme.muted,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
    }
}

private fun kindIcon(kind: String): ImageVector =
    when (kind) {
        "group" -> Icons.Outlined.Folder
        "text" -> Icons.Outlined.TextFields
        "fill" -> Icons.Outlined.Brush
        "adjustment" -> Icons.Outlined.Tune
        else -> Icons.Outlined.Image
    }

private fun subtitle(row: LayerRow): String {
    val layer = row.layer
    val parts = ArrayList<String>()
    parts +=
        when (layer.kind) {
            "group" -> "Folder"
            "text" -> "Text"
            "fill" -> "Fill"
            "adjustment" -> "Adjustment"
            else -> if (layer.blobId.isEmpty()) "Empty" else "Image"
        }
    val blend = BlendMode.of(layer.blendMode)
    if (blend != BlendMode.NORMAL) parts += blend.label
    if (layer.opacity < 100u) parts += "${layer.opacity}%"
    if (row.overridden) parts += if (row.visible) "Shown here" else "Hidden here"
    return parts.joinToString(" · ")
}

/** Name, size, members, access and the ids. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ProjectInfoSheet(
    model: ArtworkModel,
    onDismiss: () -> Unit,
) {
    val title by model.name.collectAsState()
    val document by model.document.collectAsState()
    val layers by model.layers.collectAsState()
    val members by model.members.collectAsState()
    val role by model.role.collectAsState()
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = PixartTheme.ground) {
        Column(
            Modifier.padding(16.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("About this project", style = PixartTheme.heading(17), modifier = Modifier.align(Alignment.CenterHorizontally))
            Column(Modifier.fillMaxWidth().card(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(title.ifEmpty { "Project" }, style = PixartTheme.heading(20))
                document?.description?.takeIf { it.isNotEmpty() }?.let { Text(it, style = PixartTheme.body(15)) }
                document?.let { d ->
                    Text(
                        listOf(
                            PixartFormat.size(d.width, d.height),
                            PixartFormat.count(layers.size, "layer", "layers"),
                            PixartFormat.count(d.memberCount.toInt(), "member", "members"),
                        ).joinToString(" · "),
                        style = PixartTheme.body(14, color = PixartTheme.muted),
                    )
                }
                Text(
                    when (role) {
                        "owner" -> "You own this project. Edit it on the web or desktop."
                        "admin" -> "You are an admin. Edit it on the web or desktop."
                        "editor" -> "You can edit this project on the web or desktop."
                        "viewer" -> "You have view-only access."
                        else -> "Checking your access…"
                    },
                    style = PixartTheme.body(14),
                )
            }
            if (members.isNotEmpty()) {
                Column(Modifier.fillMaxWidth().card(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    SectionLabel("Members")
                    members.forEach { m ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Avatar(m.id, model.nameFor(m.id), 30.dp)
                            Spacer(Modifier.width(10.dp))
                            Text(model.nameFor(m.id), style = PixartTheme.body(15, color = PixartTheme.ink))
                            if (m.id == model.account) Text("  You", style = PixartTheme.body(13, color = PixartTheme.muted))
                            if (m.id == document?.owner) Text("  Owner", style = PixartTheme.body(13, color = PixartTheme.muted))
                        }
                    }
                }
            }
            DetailsDisclosure(
                listOf("Project (context)" to model.contextId, "Team" to model.teamId, "Owner" to (document?.owner ?: "—")),
                Modifier.fillMaxWidth().card(),
            )
            Spacer(Modifier.height(16.dp))
        }
    }
}
