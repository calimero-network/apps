@file:Suppress("MatchingDeclarationName")

package network.calimero.design.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.HideImage
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch
import network.calimero.design.app.BoardModel
import network.calimero.design.core.BoardScene
import network.calimero.design.core.Rect
import network.calimero.design.core.Screens

/** One slide of Present: a screen, or the whole board when it has none. */
data class Slide(
    val id: String,
    val name: String,
    val frame: Rect,
) {
    companion object {
        fun of(
            scene: BoardScene,
            boardName: String,
        ): List<Slide> {
            if (scene.screens.isNotEmpty()) return scene.screens.map { Slide(it.id, it.name, it.frame) }
            val b = scene.bounds ?: return emptyList()
            val pad = 24.0
            return listOf(Slide("board", boardName.ifEmpty { "Board" }, Rect(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2)))
        }
    }
}

/** Full screen, one slide at a time; swipe between them. Tap shows or hides the controls. */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PresentScreen(
    model: BoardModel,
    cache: ImageCache,
    onClose: () -> Unit,
) {
    val scene by model.scene.collectAsState()
    val name by model.name.collectAsState()
    val slides = remember(scene, name) { Slide.of(scene, name) }
    val pager = rememberPagerState { slides.size }
    val scope = rememberCoroutineScope()
    var chrome by remember { mutableStateOf(true) }
    var showAll by remember { mutableStateOf(false) }

    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(DesignTheme.stage)) {
            if (slides.isEmpty()) {
                Box(Modifier.align(Alignment.Center)) {
                    EmptyState(Icons.Outlined.HideImage, "Nothing to present", "This board is empty.", dark = true)
                }
            } else {
                HorizontalPager(state = pager, modifier = Modifier.fillMaxSize()) { i ->
                    SlideView(slides[i], model, cache, Modifier.pointerInput(Unit) { detectTapGestures(onTap = { chrome = !chrome }) })
                }
            }
            AnimatedVisibility(chrome, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.fillMaxSize()) {
                Box(Modifier.fillMaxSize().safeDrawingPadding()) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        RoundIcon(Icons.Filled.Close, "Stop presenting", onClose)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                slides.getOrNull(pager.currentPage)?.name.orEmpty(),
                                style = DesignTheme.heading(16).copy(color = Color.White),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            if (slides.isNotEmpty()) {
                                Text("${pager.currentPage + 1} of ${slides.size}", style = DesignTheme.body(13, color = Color.White.copy(alpha = 0.6f)))
                            }
                        }
                        if (slides.size > 1) RoundIcon(Icons.Outlined.GridView, "All screens") { showAll = true }
                    }
                    if (slides.size > 1) {
                        Row(Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            slides.indices.forEach { i ->
                                Box(
                                    Modifier
                                        .size(width = if (i == pager.currentPage) 18.dp else 6.dp, height = 6.dp)
                                        .background(if (i == pager.currentPage) DesignTheme.lime else Color.White.copy(alpha = 0.3f), CircleShape),
                                )
                            }
                        }
                    }
                }
            }
        }
        if (showAll) {
            ModalBottomSheet(onDismissRequest = { showAll = false }, containerColor = DesignTheme.ground) {
                Text("All screens", style = DesignTheme.heading(17), modifier = Modifier.align(Alignment.CenterHorizontally))
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(150.dp),
                    modifier = Modifier.padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    itemsIndexed(slides, key = { _, s -> s.id }) { i, slide ->
                        Column(
                            Modifier.clickable {
                                showAll = false
                                scope.launch { pager.scrollToPage(i) }
                            },
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            val selected = i == pager.currentPage
                            BoxWithConstraints(
                                Modifier
                                    .fillMaxWidth()
                                    .height(110.dp)
                                    .background(DesignTheme.sunken, RoundedCornerShape(10.dp))
                                    .border(if (selected) 2.dp else DesignTheme.hairline, if (selected) DesignTheme.ink else DesignTheme.line, RoundedCornerShape(10.dp)),
                                contentAlignment = Alignment.Center,
                            ) {
                                val density = LocalDensity.current
                                val wPx = with(density) { maxWidth.toPx() }
                                val hPx = with(density) { maxHeight.toPx() }
                                val s = minOf(wPx / slide.frame.width, hPx / slide.frame.height)
                                SlideCanvas(
                                    slide,
                                    model,
                                    cache,
                                    s,
                                    Modifier.size(with(density) { (slide.frame.width * s).toFloat().toDp() }, with(density) { (slide.frame.height * s).toFloat().toDp() }),
                                )
                            }
                            Text("${i + 1}. ${slide.name}", style = DesignTheme.body(13, FontWeight.Medium, DesignTheme.ink), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RoundIcon(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: () -> Unit,
) {
    Box(
        Modifier.size(40.dp).background(Color.White.copy(alpha = 0.14f), CircleShape).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, contentDescription = label, tint = Color.White, modifier = Modifier.size(18.dp)) }
}

/** A slide fitted to the space it has: whole, or at a readable width and scrolling when long. */
@Composable
private fun SlideView(
    slide: Slide,
    model: BoardModel,
    cache: ImageCache,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        val density = LocalDensity.current
        val viewW = with(density) { maxWidth.toPx() }.toDouble()
        val viewH = with(density) { maxHeight.toPx() }.toDouble()
        val (scale, scrolls) = Screens.fit(slide.frame.width, slide.frame.height, viewW, viewH)
        val w = with(density) { (slide.frame.width * scale).toFloat().toDp() }
        val h = with(density) { (slide.frame.height * scale).toFloat().toDp() }
        if (scrolls) {
            Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), contentAlignment = Alignment.TopCenter) {
                SlideCanvas(slide, model, cache, scale, Modifier.size(w, h))
            }
        } else {
            SlideCanvas(slide, model, cache, scale, Modifier.size(w, h))
        }
    }
}

/** The slide's area of the board, clipped at its edge. */
@Composable
private fun SlideCanvas(
    slide: Slide,
    model: BoardModel,
    cache: ImageCache,
    scale: Double,
    modifier: Modifier = Modifier,
) {
    val scene by model.scene.collectAsState()
    val images by model.images.collectAsState()
    val nodes = remember(scene, slide) { scene.nodesIn(slide.frame) }
    Canvas(modifier.background(Color.White).clipToBounds()) {
        drawIntoCanvas { c ->
            val nc = c.nativeCanvas
            nc.save()
            nc.scale(scale.toFloat(), scale.toFloat())
            nc.translate(-slide.frame.x.toFloat(), -slide.frame.y.toFloat())
            SceneRenderer.draw(nc, nodes, images, cache)
            nc.restore()
        }
    }
}
