package network.calimero.calendar.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import network.calimero.calendar.data.CalEvent
import network.calimero.calendar.data.CalendarMath
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.TextStyle
import java.util.Locale

private val HOUR = 52.dp
private val GUTTER = 44.dp

/** The week and day views: day headers, an all-day strip, and a 24-hour grid of event blocks. */
@Composable
fun TimeGrid(
    days: List<LocalDate>,
    events: List<CalEvent>,
    onEvent: (CalEvent) -> Unit,
    onNewAt: (LocalDate, Int) -> Unit,
    onDay: (LocalDate) -> Unit,
) {
    val zone = ZoneId.systemDefault()
    val today = LocalDate.now(zone)
    val scroll = rememberScrollState()
    val density = LocalDensity.current
    LaunchedEffect(days.first()) { scroll.scrollTo(with(density) { (HOUR * 7).roundToPx() }) }

    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.surface),
    ) {
        if (days.size > 1) {
            Row(Modifier.padding(start = GUTTER, top = 6.dp, bottom = 6.dp)) {
                days.forEach { day ->
                    Column(
                        Modifier
                            .weight(1f)
                            .clickable { onDay(day) },
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(day.dayOfWeek.getDisplayName(TextStyle.NARROW, Locale.getDefault()), style = Tokens.label)
                        Box(
                            Modifier
                                .padding(top = 2.dp)
                                .size(28.dp)
                                .clip(CircleShape)
                                .background(if (day == today) Tokens.ink else Color.Transparent),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                "${day.dayOfMonth}",
                                fontSize = 14.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = if (day == today) Color.White else Tokens.ink,
                            )
                        }
                    }
                }
            }
        }
        AllDayStrip(days, events, zone, onEvent)
        HorizontalDivider(color = Tokens.line)
        Box(
            Modifier
                .fillMaxSize()
                .verticalScroll(scroll),
        ) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(HOUR * 24),
            ) {
                for (hour in 0 until 24) {
                    Text(
                        "%02d:00".format(hour),
                        fontSize = 11.sp,
                        color = Tokens.faint,
                        textAlign = TextAlign.End,
                        modifier =
                            Modifier
                                .width(GUTTER - 6.dp)
                                .offset(y = HOUR * hour - 6.dp),
                    )
                    HorizontalDivider(
                        color = Tokens.line,
                        modifier =
                            Modifier
                                .padding(start = GUTTER)
                                .offset(y = HOUR * hour),
                    )
                }
                Row(
                    Modifier
                        .fillMaxSize()
                        .padding(start = GUTTER),
                ) {
                    days.forEach { day ->
                        DayColumn(day, events, zone, isToday = day == today, onEvent = onEvent, onNewAt = { onNewAt(day, it) }, modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

@Composable
private fun AllDayStrip(
    days: List<LocalDate>,
    events: List<CalEvent>,
    zone: ZoneId,
    onEvent: (CalEvent) -> Unit,
) {
    val perDay = days.map { day -> CalendarMath.eventsOn(events, day, zone).filter { it.allDay } }
    if (perDay.all { it.isEmpty() }) return
    Row(Modifier.padding(start = GUTTER, end = 2.dp, bottom = 6.dp)) {
        perDay.forEach { list ->
            Column(Modifier.weight(1f).padding(horizontal = 1.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                list.take(2).forEach { event ->
                    Text(
                        event.title,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Medium,
                        color = Tokens.ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(4.dp))
                                .background(Tokens.eventColor(event.color).copy(alpha = 0.18f))
                                .clickable { onEvent(event) }
                                .padding(horizontal = 4.dp, vertical = 2.dp),
                    )
                }
                if (list.size > 2) Text("+${list.size - 2}", fontSize = 10.sp, color = Tokens.muted)
            }
        }
    }
}

@Composable
private fun DayColumn(
    day: LocalDate,
    events: List<CalEvent>,
    zone: ZoneId,
    isToday: Boolean,
    onEvent: (CalEvent) -> Unit,
    onNewAt: (Int) -> Unit,
    modifier: Modifier,
) {
    val hourPx = with(LocalDensity.current) { HOUR.toPx() }
    BoxWithConstraints(
        modifier
            .fillMaxHeight()
            .pointerInput(day) { detectTapGestures { offset -> onNewAt((offset.y / hourPx).toInt().coerceIn(0, 23)) } },
    ) {
        val width = maxWidth
        CalendarMath.layoutDay(events, day, zone).forEach { placed ->
            val colWidth = width / placed.columns
            val color = Tokens.eventColor(placed.event.color)
            Row(
                Modifier
                    .offset(x = colWidth * placed.column, y = HOUR * (placed.startMinute / 60f))
                    .width(colWidth)
                    .height(HOUR * ((placed.endMinute - placed.startMinute) / 60f))
                    .padding(1.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(color.copy(alpha = 0.16f))
                    .clickable { onEvent(placed.event) },
            ) {
                Box(
                    Modifier
                        .width(3.dp)
                        .fillMaxHeight()
                        .background(color),
                )
                Column(Modifier.padding(horizontal = 4.dp, vertical = 2.dp)) {
                    Text(placed.event.title, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = Tokens.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(hourMinute.format(placed.event.start.atZone(zone)), fontSize = 10.sp, color = Tokens.muted, maxLines = 1)
                }
            }
        }
        if (isToday) {
            val now = LocalTime.now(zone)
            val minutes = now.hour * 60 + now.minute
            Box(
                Modifier
                    .offset(y = HOUR * (minutes / 60f))
                    .fillMaxWidth()
                    .height(2.dp)
                    .background(Tokens.now),
            )
        }
        Spacer(Modifier.width(0.dp))
    }
}
