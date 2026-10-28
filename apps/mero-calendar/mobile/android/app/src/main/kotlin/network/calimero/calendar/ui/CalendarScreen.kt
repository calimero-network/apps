package network.calimero.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.EventAvailable
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberSwipeToDismissBoxState
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.calendar.app.CalendarMode
import network.calimero.calendar.app.CalendarModel
import network.calimero.calendar.app.CalendarState
import network.calimero.calendar.data.CalEvent
import network.calimero.calendar.data.CalendarMath
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

/** What the event sheet is showing: a new event on a day, or an existing one. */
sealed interface EventTarget {
    data class New(
        val day: LocalDate,
        /** Start at this hour (a tap on the week/day grid); null for the default time. */
        val hour: Int? = null,
    ) : EventTarget

    data class Existing(
        val event: CalEvent,
    ) : EventTarget
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CalendarScreen(
    model: CalendarModel,
    onBack: () -> Unit,
) {
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    var menu by remember { mutableStateOf(false) }
    var sheet by remember { mutableStateOf<EventTarget?>(null) }
    var members by remember { mutableStateOf(false) }
    var details by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<CalEvent?>(null) }

    LaunchedEffect(model) { model.start() }
    LaunchedEffect(model) { model.watch() }

    val refresh: () -> Unit = {
        scope.launch {
            refreshing = true
            model.load()
            refreshing = false
        }
    }

    Scaffold(
        containerColor = Tokens.ground,
        topBar = {
            TopAppBar(
                title = { Text(model.calendar.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
                actions = {
                    IconButton(onClick = { sheet = EventTarget.New(state.selected) }) { Icon(Icons.Filled.Add, contentDescription = "New event") }
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "More") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text("Members") }, onClick = {
                                menu = false
                                members = true
                            })
                            DropdownMenuItem(text = { Text("Your name") }, onClick = {
                                menu = false
                                model.askName()
                            })
                            DropdownMenuItem(text = { Text("Details") }, onClick = {
                                menu = false
                                details = true
                            })
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Tokens.ground),
            )
        },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            ModePicker(state.mode, model::setMode)
            PeriodHeader(state, onStep = model::step, onToday = model::today)
            state.error?.let {
                Box(Modifier.padding(horizontal = Tokens.gutter, vertical = 4.dp)) { ErrorBanner(it) { scope.launch { model.load() } } }
            }
            if (state.loading) {
                Loading()
                return@Column
            }
            val open: (CalEvent) -> Unit = { sheet = EventTarget.Existing(it) }
            val newAt: (LocalDate, Int) -> Unit = { day, hour -> sheet = EventTarget.New(day, hour) }
            val ownerName: (CalEvent) -> String? = { if (model.canEdit(it)) null else model.nameOf(it.owner) }
            val swipe = Modifier.swipeToStep(model::step)
            when (state.mode) {
                CalendarMode.MONTH ->
                    PullToRefreshBox(refreshing, refresh, Modifier.fillMaxSize().then(swipe)) {
                        MonthView(state, onSelect = model::select, onEvent = open, ownerName = ownerName)
                    }
                CalendarMode.WEEK ->
                    Box(swipe) {
                        TimeGrid(CalendarMath.week(state.selected), state.events, onEvent = open, onNewAt = newAt, onDay = {
                            model.select(it)
                            model.setMode(CalendarMode.DAY)
                        })
                    }
                CalendarMode.DAY -> Box(swipe) { TimeGrid(listOf(state.selected), state.events, onEvent = open, onNewAt = newAt, onDay = {}) }
                CalendarMode.AGENDA ->
                    PullToRefreshBox(refreshing, refresh, Modifier.fillMaxSize()) {
                        AgendaView(state, canDelete = model::canEdit, onEvent = open, onDelete = { deleting = it }, ownerName = ownerName)
                    }
            }
        }
    }

    sheet?.let { target ->
        EventSheet(model = model, target = target, members = state.members, onDismiss = { sheet = null })
    }
    if (members) MembersSheet(state.members, model.account, onDismiss = { members = false })
    if (details) {
        AppSheet("Details", onDismiss = { details = false }) {
            DetailsRows(
                listOf(
                    "Calendar" to model.calendar.name,
                    "Team" to model.team.name,
                    "Calendar id (context)" to model.calendar.contextId,
                    "Group id" to model.calendar.groupId,
                    "Team id (namespace)" to model.team.id,
                    "Your account" to model.account,
                ),
            )
            Text("Private events are kept on this device and are never sent to your relay or your team.", style = Tokens.caption)
        }
    }
    if (state.askName) {
        NameSheet(initial = model.lastName, onSave = { model.saveName(it) }, onSkip = model::skipName)
    }
    deleting?.let { event ->
        DeleteDialog(onConfirm = {
            deleting = null
            scope.launch { runCatching { model.delete(event) }.onFailure { model.load() } }
        }, onDismiss = { deleting = null })
    }
}

@Composable
fun DeleteDialog(
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Delete this event?") },
        confirmButton = { TextButton(onClick = onConfirm) { Text("Delete", color = Tokens.danger) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel", color = Tokens.ink) } },
        containerColor = Tokens.surface,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ModePicker(
    mode: CalendarMode,
    onMode: (CalendarMode) -> Unit,
) {
    SingleChoiceSegmentedButtonRow(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = Tokens.gutter, vertical = 4.dp),
    ) {
        CalendarMode.entries.forEachIndexed { index, item ->
            SegmentedButton(
                selected = item == mode,
                onClick = { onMode(item) },
                shape = SegmentedButtonDefaults.itemShape(index, CalendarMode.entries.size),
                icon = {},
                colors =
                    SegmentedButtonDefaults.colors(
                        activeContainerColor = Tokens.lime,
                        activeContentColor = Tokens.ink,
                        activeBorderColor = Tokens.line,
                        inactiveContainerColor = Tokens.surface,
                        inactiveContentColor = Tokens.ink,
                        inactiveBorderColor = Tokens.line,
                    ),
            ) { Text(item.label, fontSize = 13.sp, fontWeight = FontWeight.Medium) }
        }
    }
}

private val monthTitle = DateTimeFormatter.ofPattern("MMMM yyyy", Locale.getDefault())
private val shortDay = DateTimeFormatter.ofPattern("MMM d", Locale.getDefault())
private val dayTitle = DateTimeFormatter.ofPattern("EEEE, MMM d", Locale.getDefault())
private val sectionDay = DateTimeFormatter.ofPattern("EEEE, MMMM d", Locale.getDefault())
private val agendaDay = DateTimeFormatter.ofPattern("EEEE, MMM d", Locale.getDefault())
val hourMinute: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm", Locale.getDefault())

/** "October 2026", "Oct 26 – Nov 1, 2026", "Wednesday, Oct 28" or "Upcoming". */
fun periodTitle(
    mode: CalendarMode,
    day: LocalDate,
): String =
    when (mode) {
        CalendarMode.MONTH -> monthTitle.format(day)
        CalendarMode.WEEK -> {
            val week = CalendarMath.week(day)
            "${shortDay.format(week.first())} – ${shortDay.format(week.last())}, ${week.last().year}"
        }
        CalendarMode.DAY -> dayTitle.format(day)
        CalendarMode.AGENDA -> "Upcoming"
    }

@Composable
private fun PeriodHeader(
    state: CalendarState,
    onStep: (Int) -> Unit,
    onToday: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(start = Tokens.gutter, end = 8.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(periodTitle(state.mode, state.selected), style = Tokens.heading.copy(fontSize = 20.sp), modifier = Modifier.weight(1f))
        Text(
            "Today",
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            color = Tokens.ink,
            modifier =
                Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(Tokens.surface)
                    .clickable(onClick = onToday)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
        )
        if (state.mode != CalendarMode.AGENDA) {
            IconButton(onClick = { onStep(-1) }) { Icon(Icons.Filled.ChevronLeft, contentDescription = "Previous") }
            IconButton(onClick = { onStep(1) }) { Icon(Icons.Filled.ChevronRight, contentDescription = "Next") }
        }
    }
}

@Composable
private fun MonthView(
    state: CalendarState,
    onSelect: (LocalDate) -> Unit,
    onEvent: (CalEvent) -> Unit,
    ownerName: (CalEvent) -> String?,
) {
    val zone = ZoneId.systemDefault()
    val today = LocalDate.now(zone)
    val grid = CalendarMath.monthGrid(state.selected)
    val dayEvents = CalendarMath.eventsOn(state.events, state.selected, zone)
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = Tokens.gutter, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            Card {
                Column(Modifier.padding(vertical = 10.dp, horizontal = 6.dp)) {
                    Row(Modifier.fillMaxWidth()) {
                        grid.take(CalendarMath.WEEK_DAYS).forEach { d ->
                            Text(
                                d.dayOfWeek.getDisplayName(TextStyle.NARROW, Locale.getDefault()),
                                style = Tokens.label,
                                textAlign = TextAlign.Center,
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                    grid.chunked(CalendarMath.WEEK_DAYS).forEach { week ->
                        Row(Modifier.fillMaxWidth()) {
                            week.forEach { day ->
                                MonthCell(
                                    day = day,
                                    inMonth = day.month == state.selected.month,
                                    isToday = day == today,
                                    isSelected = day == state.selected,
                                    colors = CalendarMath.eventsOn(state.events, day, zone).take(3).map { Tokens.eventColor(it.color) },
                                    onClick = { onSelect(day) },
                                    modifier = Modifier.weight(1f),
                                )
                            }
                        }
                    }
                }
            }
        }
        item {
            Text(sectionDay.format(state.selected), style = Tokens.label, modifier = Modifier.padding(top = 8.dp, bottom = 2.dp))
        }
        if (dayEvents.isEmpty()) {
            item {
                Card { Text("No events", style = Tokens.caption, modifier = Modifier.padding(16.dp)) }
            }
        } else {
            items(dayEvents, key = { it.id }) { EventRow(it, ownerName(it), onClick = { onEvent(it) }) }
        }
    }
}

@Composable
private fun MonthCell(
    day: LocalDate,
    inMonth: Boolean,
    isToday: Boolean,
    isSelected: Boolean,
    colors: List<Color>,
    onClick: () -> Unit,
    modifier: Modifier,
) {
    Column(
        modifier
            .aspectRatio(0.9f)
            .clip(RoundedCornerShape(10.dp))
            .clickable(onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        val bg =
            when {
                isSelected -> Tokens.lime
                isToday -> Tokens.ink
                else -> Color.Transparent
            }
        val fg =
            when {
                isToday && !isSelected -> Color.White
                !inMonth -> Tokens.faint
                else -> Tokens.ink
            }
        Box(
            Modifier
                .size(32.dp)
                .clip(CircleShape)
                .background(bg),
            contentAlignment = Alignment.Center,
        ) {
            Text("${day.dayOfMonth}", color = fg, fontSize = 15.sp, fontWeight = if (isToday || isSelected) FontWeight.SemiBold else FontWeight.Normal)
        }
        Spacer(Modifier.height(3.dp))
        Row(Modifier.height(5.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            colors.forEach { c ->
                Box(
                    Modifier
                        .size(5.dp)
                        .clip(CircleShape)
                        .background(if (inMonth) c else c.copy(alpha = 0.4f)),
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AgendaView(
    state: CalendarState,
    canDelete: (CalEvent) -> Boolean,
    onEvent: (CalEvent) -> Unit,
    onDelete: (CalEvent) -> Unit,
    ownerName: (CalEvent) -> String?,
) {
    val zone = ZoneId.systemDefault()
    val today = LocalDate.now(zone)
    val days =
        (0 until AGENDA_DAYS)
            .map { state.selected.plusDays(it.toLong()) }
            .map { it to CalendarMath.eventsOn(state.events, it, zone) }
            .filter { it.second.isNotEmpty() }
    if (days.isEmpty()) {
        LazyColumn(Modifier.fillMaxSize()) {
            item { EmptyState(Icons.Filled.EventAvailable, "Nothing coming up", "Tap + to add an event.") }
        }
        return
    }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = Tokens.gutter, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        days.forEach { (day, events) ->
            item(key = "h-$day") {
                Text(
                    when (day) {
                        today -> "Today"
                        today.plusDays(1) -> "Tomorrow"
                        else -> agendaDay.format(day)
                    },
                    style = Tokens.label,
                    modifier = Modifier.padding(top = 10.dp, bottom = 2.dp),
                )
            }
            items(events, key = { "$day-${it.id}" }) { event ->
                if (canDelete(event)) {
                    val swipe =
                        rememberSwipeToDismissBoxState(confirmValueChange = { value ->
                            if (value == SwipeToDismissBoxValue.EndToStart) onDelete(event)
                            false
                        })
                    SwipeToDismissBox(
                        state = swipe,
                        enableDismissFromStartToEnd = false,
                        backgroundContent = {
                            Box(
                                Modifier
                                    .fillMaxSize()
                                    .clip(RoundedCornerShape(Tokens.cardRadius))
                                    .background(Tokens.danger)
                                    .padding(end = 20.dp),
                                contentAlignment = Alignment.CenterEnd,
                            ) { Icon(Icons.Filled.Delete, contentDescription = "Delete", tint = Color.White) }
                        },
                    ) { EventRow(event, ownerName(event), onClick = { onEvent(event) }) }
                } else {
                    EventRow(event, ownerName(event), onClick = { onEvent(event) })
                }
            }
        }
    }
}

/** An event card: time, color bar, title, and a meta line (private, people, organiser). */
@Composable
fun EventRow(
    event: CalEvent,
    ownerName: String?,
    onClick: () -> Unit,
) {
    val zone = ZoneId.systemDefault()
    val color = Tokens.eventColor(event.color)
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(Tokens.cardRadius),
        color = color.copy(alpha = 0.08f).compositeOver(Tokens.surface),
        border = BorderStroke(Tokens.hairline, Tokens.line),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier
                .height(IntrinsicSize.Min)
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.width(52.dp)) {
                if (event.allDay) {
                    Text("All day", fontSize = 12.sp, color = Tokens.muted, fontWeight = FontWeight.Medium)
                } else {
                    Text(hourMinute.format(event.start.atZone(zone)), fontSize = 13.sp, color = Tokens.ink, fontWeight = FontWeight.Medium)
                    Text(hourMinute.format(event.end.atZone(zone)), fontSize = 12.sp, color = Tokens.muted)
                }
            }
            Box(
                Modifier
                    .width(4.dp)
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(2.dp))
                    .background(color),
            )
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(event.title, style = Tokens.body.copy(fontWeight = FontWeight.Medium), maxLines = 2, overflow = TextOverflow.Ellipsis)
                val hasMeta = event.isPrivate || event.peers.isNotEmpty() || ownerName != null
                if (hasMeta) {
                    Spacer(Modifier.height(2.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (event.isPrivate) {
                            Icon(Icons.Filled.Lock, contentDescription = null, tint = Tokens.muted, modifier = Modifier.size(13.dp))
                            Spacer(Modifier.width(3.dp))
                            Text("Private", fontSize = 12.sp, color = Tokens.muted)
                            Spacer(Modifier.width(10.dp))
                        }
                        if (event.peers.isNotEmpty()) {
                            Icon(Icons.Filled.Group, contentDescription = null, tint = Tokens.muted, modifier = Modifier.size(13.dp))
                            Spacer(Modifier.width(3.dp))
                            Text("${event.peers.size + 1}", fontSize = 12.sp, color = Tokens.muted)
                            Spacer(Modifier.width(10.dp))
                        }
                        if (ownerName != null) Text(ownerName, fontSize = 12.sp, color = Tokens.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}

/** A horizontal swipe steps the period: left for the next one, right for the previous. */
fun Modifier.swipeToStep(onStep: (Int) -> Unit): Modifier =
    pointerInput(onStep) {
        var total = 0f
        detectHorizontalDragGestures(
            onDragStart = { total = 0f },
            onDragEnd = {
                val threshold = 80.dp.toPx()
                if (total < -threshold) {
                    onStep(1)
                } else if (total > threshold) {
                    onStep(-1)
                }
            },
        ) { _, dx -> total += dx }
    }

private const val AGENDA_DAYS = 90
