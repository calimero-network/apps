package network.calimero.updates.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Article
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import network.calimero.updates.app.AudienceModel
import network.calimero.updates.app.ComposerModel
import network.calimero.updates.core.AskKind
import network.calimero.updates.core.ComposerStart
import network.calimero.updates.core.ComposerState
import network.calimero.updates.core.Limits
import network.calimero.updates.core.Metrics
import network.calimero.updates.core.UpdateTemplate
import network.calimero.updates.generated.CategoryView

/** Write an update: title, category, TL;DR, KPIs, sections and asks, with a preview. A plain native editor. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ComposerScreen(
    audience: AudienceModel,
    start: ComposerStart,
    onDone: (String?) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val model = remember(start) { ComposerModel(audience, start, scope) }
    val state by model.state.collectAsState()
    val error by model.error.collectAsState()
    val publishing by model.isPublishing.collectAsState()
    val categories by audience.categories.collectAsState()
    model.savedAt.collectAsState().value
    model.series.collectAsState().value
    model.contributions.collectAsState().value
    var preview by remember { mutableStateOf(false) }
    var tick by remember { mutableLongStateOf(0L) }

    LaunchedEffect(model) { model.load() }
    LaunchedEffect(Unit) {
        while (true) {
            delay(TICK_MS)
            tick++
        }
    }

    fun close() {
        scope.launch {
            model.flush()
            audience.bump()
            onDone(null)
        }
    }

    Scaffold(
        containerColor = Palette.background,
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = ::close) { Icon(Icons.Outlined.Close, contentDescription = if (model.isEditing) "Cancel" else "Close") } },
                title = {
                    Column {
                        Text(if (model.isEditing) "Edit update" else "New update", fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                        tick.let { Text(model.draftStatus() ?: "Editing published update", color = Palette.ink2, fontSize = 11.sp) }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Palette.background),
            )
        },
        bottomBar = {
            if (state != null) {
                Surface(color = Palette.surface, shadowElevation = 4.dp, modifier = Modifier.imePadding()) {
                    Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        ErrorLine(error)
                        model.blocker?.let { blocker ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Outlined.Info, contentDescription = null, tint = Palette.ink2, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(6.dp))
                                Text(blocker, color = Palette.ink2, fontSize = 13.sp)
                            }
                        }
                        PrimaryButton(
                            when {
                                publishing -> "Publishing…"
                                model.isEditing -> "Save changes"
                                else -> "Publish to this audience"
                            },
                            onClick = { scope.launch { model.publish()?.let { onDone(it) } } },
                            enabled = model.blocker == null,
                            busy = publishing,
                            icon = Icons.AutoMirrored.Outlined.Send,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
        },
    ) { padding ->
        val current = state
        when {
            current != null ->
                LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                    modifier = Modifier.fillMaxSize().padding(padding),
                ) {
                    item {
                        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                            listOf("Write", "Preview").forEachIndexed { i, label ->
                                SegmentedButton(
                                    selected = preview == (i == 1),
                                    onClick = { preview = i == 1 },
                                    shape = SegmentedButtonDefaults.itemShape(i, 2),
                                    colors = SegmentedButtonDefaults.colors(activeContainerColor = Palette.lime, activeContentColor = Palette.ink),
                                ) { Text(label) }
                            }
                        }
                    }
                    if (preview) {
                        item { ComposerPreview(current, model, audience) }
                    } else {
                        item { Basics(current, model, categories) }
                        item { MetricsEditor(current, model) }
                        item { SectionsEditor(current, model) }
                        item { AsksEditor(current, model) }
                    }
                }
            error != null -> Box(Modifier.padding(padding).padding(16.dp)) { UpdatesCard { ErrorLine(error) } }
            else -> Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { SkeletonCard(200.dp) }
        }
    }
}

private const val TICK_MS = 30_000L

@Composable
private fun Basics(
    state: ComposerState,
    model: ComposerModel,
    categories: List<CategoryView>,
) {
    var menu by remember { mutableStateOf(false) }
    UpdatesCard {
        InputField(
            state.title,
            { v -> model.update { it.copy(title = v) } },
            "Title — e.g. “June 2026 update”",
            maxLength = Limits.TITLE,
            singleLine = false,
            maxLines = 3,
            textStyle = displayStyle(22.sp),
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Category", fontWeight = FontWeight.SemiBold, fontSize = 15.sp, modifier = Modifier.weight(1f))
            if (categories.isEmpty()) {
                Text("No categories yet — add them in Settings", color = Palette.ink3, fontSize = 13.sp)
            } else {
                Box {
                    val selected = categories.firstOrNull { it.id == state.categoryId }
                    Chip(selected?.let { "${it.emoji} ${it.name}".trim() } ?: "No category", onClick = { menu = true })
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(text = { Text("No category") }, onClick = {
                            menu = false
                            model.update { it.copy(categoryId = "") }
                        })
                        categories.forEach { c ->
                            DropdownMenuItem(text = { Text("${c.emoji} ${c.name}".trim()) }, onClick = {
                                menu = false
                                model.update { it.copy(categoryId = c.id) }
                            })
                        }
                    }
                }
            }
        }
        InputField(
            state.summary,
            { v -> model.update { it.copy(summary = v) } },
            "TL;DR — the one paragraph a busy investor will read.",
            maxLength = Limits.SUMMARY,
            singleLine = false,
            minLines = 2,
            maxLines = 6,
        )
    }
}

@Composable
private fun CardTitle(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text(title, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
    }
}

@Composable
private fun MetricsEditor(
    state: ComposerState,
    model: ComposerModel,
) {
    UpdatesCard {
        CardTitle(Icons.Outlined.BarChart, "KPIs")
        state.metrics.forEachIndexed { index, metric ->
            val previous = model.lastValue(metric.name)
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    InputField(
                        metric.name,
                        { v -> model.setMetric(index) { it.copy(name = v) } },
                        "Name (MRR, Runway…)",
                        modifier = Modifier.weight(1f),
                        textStyle = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink),
                    )
                    IconButton(onClick = { model.removeMetric(index) }) { Icon(Icons.Outlined.Close, contentDescription = "Remove KPI", tint = Palette.ink3) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    InputField(
                        metric.value,
                        { v -> model.setMetric(index) { it.copy(value = v) } },
                        previous?.let { "last: $it" } ?: "Value",
                        modifier = Modifier.weight(1f),
                    )
                    InputField(metric.unit, { v -> model.setMetric(index) { it.copy(unit = v) } }, "unit", modifier = Modifier.width(96.dp))
                }
                if (previous != null) {
                    val delta = if (metric.value.isNotEmpty()) Metrics.delta(previous, metric.value) else null
                    if (delta != null) DeltaLabel(delta) else Text("was $previous", color = Palette.ink3, fontSize = 12.sp)
                }
            }
            HorizontalDivider(color = Palette.hairline)
        }
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            item { Chip("KPI", icon = Icons.Outlined.Add, onClick = { model.addMetric() }) }
            items(model.knownMetrics, key = { it.name }) { known ->
                Chip(known.name, icon = Icons.Outlined.Add, onClick = { model.addMetric(known.name, known.unit) })
            }
        }
        Text("Leave a value blank to skip it this time.", color = Palette.ink3, fontSize = 12.sp)
    }
}

@Composable
private fun SectionsEditor(
    state: ComposerState,
    model: ComposerModel,
) {
    val contributions by model.contributions.collectAsState()
    UpdatesCard {
        CardTitle(Icons.AutoMirrored.Outlined.Article, "Sections")
        state.sections.forEachIndexed { index, section ->
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    InputField(
                        section.title,
                        { v -> model.setSection(index) { it.copy(title = v) } },
                        "Heading (optional)",
                        modifier = Modifier.weight(1f),
                        textStyle = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink),
                    )
                    IconButton(onClick = { model.moveSectionUp(index) }, enabled = index > 0) {
                        Icon(Icons.Outlined.ArrowUpward, contentDescription = "Move up", tint = if (index > 0) Palette.ink3 else Palette.hairline)
                    }
                    IconButton(onClick = { model.removeSection(index) }) { Icon(Icons.Outlined.Close, contentDescription = "Remove section", tint = Palette.ink3) }
                }
                InputField(
                    section.body,
                    { v -> model.setSection(index) { it.copy(body = v) } },
                    UpdateTemplate.placeholder(section.kind),
                    singleLine = false,
                    minLines = 4,
                    maxLines = 14,
                )
            }
        }
        Text("Add section", color = Palette.ink2, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(model.sectionSuggestions, key = { it.kind }) { shape ->
                Chip(shape.title.ifEmpty { "Text" }, icon = Icons.Outlined.Add, onClick = { model.addSection(shape) })
            }
            if (model.thanks != null && !model.hasThanks) {
                item {
                    val n = contributions.size
                    Chip("Thank $n contributor${if (n == 1) "" else "s"}", selected = true, icon = Icons.Outlined.AutoAwesome, onClick = { model.insertThanks() })
                }
            }
        }
    }
}

@Composable
private fun AsksEditor(
    state: ComposerState,
    model: ComposerModel,
) {
    UpdatesCard {
        CardTitle(Icons.Outlined.PanTool, "Asks")
        Text(
            "Specific, answerable requests. Investors reply with one tap on “I can help”, and you accept offers from the Asks tab.",
            color = Palette.ink2,
            fontSize = 13.sp,
        )
        state.asks.forEachIndexed { index, ask ->
            var menu by remember { mutableStateOf(false) }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box {
                        Chip(AskKind.of(ask.kind).label, icon = Glyphs.askKind(ask.kind), onClick = { menu = true })
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            AskKind.all.forEach { kind ->
                                DropdownMenuItem(
                                    text = { Text(kind.label) },
                                    leadingIcon = { Icon(Glyphs.askKind(kind.id), contentDescription = null) },
                                    onClick = {
                                        menu = false
                                        model.setAsk(index) { it.copy(kind = kind.id) }
                                    },
                                )
                            }
                        }
                    }
                    Spacer(Modifier.weight(1f))
                    IconButton(onClick = { model.removeAsk(index) }) { Icon(Icons.Outlined.Close, contentDescription = "Remove ask", tint = Palette.ink3) }
                }
                InputField(ask.title, { v -> model.setAsk(index) { it.copy(title = v) } }, AskKind.of(ask.kind).hint)
                InputField(
                    ask.detail,
                    { v -> model.setAsk(index) { it.copy(detail = v) } },
                    "Detail (optional) — who exactly, and why",
                    singleLine = false,
                    maxLines = 4,
                )
            }
            HorizontalDivider(color = Palette.hairline)
        }
        SecondaryButton("Ask", onClick = { model.addAsk() }, enabled = model.canAddAsk, icon = Icons.Outlined.Add, compact = true)
    }
}

/** Roughly what an investor will see; the real render is the post screen. */
@Composable
private fun ComposerPreview(
    state: ComposerState,
    model: ComposerModel,
    audience: AudienceModel,
) {
    val input = state.toInput()
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Badge("Preview", BadgeTone.MUTED)
            audience.category(state.categoryId)?.let { CategoryChip(it) }
        }
        Text(input.title.ifEmpty { "Untitled" }, style = displayStyle(28.sp))
        if (input.summary.isNotEmpty()) Tldr(input.summary)
        if (input.metrics.isNotEmpty()) KpiGrid(input.metrics) { model.lastValue(it.name) }
        input.sections.forEach { section ->
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (section.title.isNotEmpty()) Text(section.title, style = displayStyle(19.sp))
                Text(section.body, fontSize = 16.sp)
            }
        }
        if (input.asks.isNotEmpty()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.PanTool, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("How you can help", fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
            }
            input.asks.forEach { ask ->
                UpdatesCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Glyphs.askKind(ask.kind), contentDescription = null, tint = Palette.ink2, modifier = Modifier.size(14.dp))
                        Spacer(Modifier.width(4.dp))
                        Text(AskKind.of(ask.kind).label, color = Palette.ink2, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    }
                    Text(ask.title, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                    if (ask.detail.isNotEmpty()) Text(ask.detail, color = Palette.ink2, fontSize = 15.sp)
                    PrimaryButton("I can help", onClick = {}, enabled = false, icon = Icons.Outlined.PanTool, compact = true)
                }
            }
        }
        Spacer(Modifier.height(8.dp))
    }
}
