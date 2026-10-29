package network.calimero.standup.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import network.calimero.standup.app.BoardModel
import network.calimero.standup.app.TeamModel
import network.calimero.standup.core.Days
import network.calimero.standup.core.ErrorText
import network.calimero.standup.core.Limits
import network.calimero.standup.generated.UpdateView

/** The Standup tab: the week strip, your update, the team's, who is waiting and who is blocked. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StandupTab(
    team: TeamModel,
    board: BoardModel,
    onLogDecision: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val version by team.version.collectAsState()
    val teamName by team.teamName.collectAsState()
    // Collected so the derived values below recompose with them.
    val day by board.day.collectAsState()
    val dayView by board.dayView.collectAsState()
    val week by board.week.collectAsState()
    val blockers by board.blockers.collectAsState()
    val decided by board.decided.collectAsState()
    val previous by board.previous.collectAsState()
    val loading by board.isLoading.collectAsState()
    val error by board.error.collectAsState()
    val me by team.me.collectAsState()
    val members by team.members.collectAsState()
    var composing by remember { mutableStateOf(false) }
    var helping by remember { mutableStateOf<UpdateView?>(null) }

    LaunchedEffect(board, version) { board.load() }
    Track(week, previous, me, members, dayView)

    Scaffold(
        containerColor = Palette.background,
        topBar = {
            TabBar(team.title.ifEmpty { teamName }) {
                IconButton(onClick = { composing = true }) { Icon(Icons.Outlined.EditNote, contentDescription = "Post update") }
            }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = loading && dayView != null,
            onRefresh = { scope.launch { board.load() } },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxSize()) {
                item { WeekStrip(board, day) { d -> scope.launch { board.select(d) } } }
                if (error != null && dayView == null) {
                    item { SyncingCard(error) }
                } else if (error != null) {
                    item { ErrorLine(error) }
                }
                item { MyUpdateCard(team, board, onCompose = { composing = true }) }

                item {
                    SectionLabel(
                        "Team",
                        trailing =
                            board.others.size
                                .takeIf { it > 0 }
                                ?.let { "$it posted" },
                    )
                }
                if (dayView == null && loading) item { Muted("Loading…") }
                if (dayView != null && board.others.isEmpty()) {
                    item {
                        Muted(
                            if (board.isToday) {
                                "Nobody else has posted today yet. Updates appear here as teammates' nodes sync."
                            } else {
                                "Nobody else posted for ${board.dayTitle.lowercase()}."
                            },
                        )
                    }
                }
                items(board.others, key = { it.author }) { u ->
                    UpdateCard(team, board, u, onLogDecision = { onLogDecision(u.day) }, onHelp = { helping = u })
                }

                if (board.isToday && dayView != null) {
                    item { SectionLabel("Not posted yet") }
                    item {
                        val waiting = board.waiting
                        if (waiting.isEmpty()) {
                            Muted("Everyone the app knows about has posted.")
                        } else {
                            StandupCard {
                                for (m in waiting) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Avatar(m.account, m.name, 28.dp)
                                        Spacer(Modifier.width(10.dp))
                                        Text(team.name(m.account, m.name), fontSize = 15.sp)
                                    }
                                }
                            }
                        }
                    }
                }

                item { SectionLabel("Blocked right now") }
                if (blockers.isEmpty()) {
                    item { Muted("Nothing is blocking anyone.") }
                }
                items(blockers, key = { "blocked:" + it.author }) { u ->
                    StandupCard {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Avatar(u.author, u.authorName, 28.dp)
                            Spacer(Modifier.width(10.dp))
                            Text(team.name(u.author, u.authorName), fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                            LinkButton(board.describe(u.day), onClick = { scope.launch { board.select(u.day) } })
                        }
                        RichTextView(u.blockers, color = Palette.danger)
                        Helpers(team, u)
                    }
                }

                if (decided.isNotEmpty()) {
                    item { SectionLabel(if (board.isToday) "Decided today" else "Decided on ${board.dayTitle}") }
                    item {
                        StandupCard {
                            for (d in decided) {
                                Text(
                                    androidx.compose.ui.text.buildAnnotatedString {
                                        pushStyle(
                                            androidx.compose.ui.text
                                                .SpanStyle(fontWeight = FontWeight.SemiBold),
                                        )
                                        append(d.title)
                                        pop()
                                        pushStyle(
                                            androidx.compose.ui.text
                                                .SpanStyle(color = Palette.ink2),
                                        )
                                        append(" — ${d.decision}")
                                        pop()
                                    },
                                    fontSize = 15.sp,
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    if (composing) UpdateSheet(board, onDismiss = { composing = false })
    helping?.let { u -> HelpSheet(board, u, onDismiss = { helping = null }) }
}

/** A team whose state has not arrived yet (just joined): say so, not just the error. */
@Composable
private fun SyncingCard(error: String?) {
    StandupCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            androidx.compose.material3.CircularProgressIndicator(Modifier.size(18.dp), color = Palette.ink, strokeWidth = 2.dp)
            Spacer(Modifier.width(10.dp))
            Text("Syncing this team…", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }
        Muted("Its updates arrive from the other members' nodes. This can take a minute after joining.")
        ErrorLine(error)
    }
}

/** Seven days around the selected one, a dot per day someone posted, red if anyone was blocked. */
@Composable
private fun WeekStrip(
    board: BoardModel,
    day: String,
    onSelect: (String) -> Unit,
) {
    val today = board.today
    StandupCard(padding = 10.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { onSelect(Days.shift(day, -1)) }) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, contentDescription = "Previous day")
            }
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.SpaceBetween) {
                for (d in board.weekDays) {
                    val (count, blocked) = board.summary(d)
                    val future = board.isFuture(d)
                    val selected = d == day
                    Surface(
                        onClick = { onSelect(d) },
                        enabled = !future,
                        shape = RoundedCornerShape(10.dp),
                        color = if (selected) Palette.lime else Palette.surface,
                        border = if (d == today && !selected) BorderStroke(1.dp, Palette.ink) else null,
                        modifier = Modifier.width(38.dp),
                    ) {
                        Column(Modifier.padding(vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(Days.weekdayShort(d), fontSize = 11.sp, color = if (future) Palette.ink3 else Palette.ink2)
                            Text(Days.dayNumber(d), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = if (future) Palette.ink3 else Palette.ink)
                            Row(Modifier.height(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                if (count > 0) Box(Modifier.size(6.dp).clip(CircleShape).background(if (blocked) Palette.danger else Palette.ink))
                                if (count > 1) Text(" $count", fontSize = 9.sp, color = Palette.ink2)
                            }
                        }
                    }
                }
            }
            IconButton(onClick = { onSelect(Days.shift(day, 1)) }, enabled = day < today) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = "Next day")
            }
        }
        Row(Modifier.padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(board.dayTitle, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            if (day != today) LinkButton("Today", onClick = { onSelect(today) })
        }
    }
}

/** Your update for the day: posted, or the prompt to post it. */
@Composable
private fun MyUpdateCard(
    team: TeamModel,
    board: BoardModel,
    onCompose: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val mine = board.mine
    var confirming by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    StandupCard {
        if (mine != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(mine.author, mine.authorName)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text("Your update", fontWeight = FontWeight.SemiBold)
                    Text(Days.relative(mine.editedAt), fontSize = 13.sp, color = Palette.ink3)
                }
                Badge("Posted")
            }
            Fields(mine)
            Helpers(team, mine)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SecondaryButton("Edit", onClick = onCompose, icon = Icons.Outlined.Edit)
                SecondaryButton(if (busy) "Withdrawing…" else "Withdraw", onClick = { confirming = true }, enabled = !busy, icon = Icons.Outlined.Delete, color = Palette.danger)
            }
            ErrorLine(error)
        } else {
            Text(
                if (board.isToday) "Your update for today" else "Your update for ${board.dayTitle}",
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
            )
            val carried = board.carriedFrom
            Muted(
                if (carried != null) {
                    "Started from your ${board.describe(carried).lowercase()} update"
                } else {
                    "Takes a few seconds: done, next, anything in your way."
                },
            )
            PrimaryButton("Post update", onClick = onCompose, icon = Icons.Outlined.EditNote, modifier = Modifier.fillMaxWidth())
        }
    }
    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text("Withdraw your update?") },
            text = { Text("It disappears from the team's day. You can post again.") },
            confirmButton = {
                LinkButton("Withdraw", color = Palette.danger, onClick = {
                    confirming = false
                    busy = true
                    scope.launch {
                        error = runCatching { board.withdraw() }.exceptionOrNull()?.let(ErrorText::describe)
                        busy = false
                    }
                })
            },
            dismissButton = { LinkButton("Cancel", onClick = { confirming = false }) },
            containerColor = Palette.surface,
        )
    }
}

/** A teammate's update. */
@Composable
private fun UpdateCard(
    team: TeamModel,
    board: BoardModel,
    update: UpdateView,
    onLogDecision: () -> Unit,
    onHelp: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var menu by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val me by team.me.collectAsState()
    StandupCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(update.author, update.authorName)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(team.name(update.author, update.authorName), fontWeight = FontWeight.SemiBold)
                Text(
                    Days.relative(update.editedAt) + if (update.editedAt != update.createdAt) " · edited" else "",
                    fontSize = 13.sp,
                    color = Palette.ink3,
                )
            }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "More") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = { Text("Log decision") },
                        leadingIcon = { Icon(Icons.Outlined.Verified, contentDescription = null) },
                        onClick = {
                            menu = false
                            onLogDecision()
                        },
                    )
                }
            }
        }
        Fields(update)
        if (update.blockers.isNotEmpty()) {
            Helpers(team, update)
            if (board.offered(update)) {
                LinkButton("Withdraw your offer", onClick = {
                    scope.launch { error = runCatching { board.withdrawHelp(update) }.exceptionOrNull()?.let(ErrorText::describe) }
                })
            } else if (me != null) {
                Chip("I can help", leading = { Icon(Icons.Outlined.PanTool, contentDescription = null, Modifier.size(16.dp)) }, onClick = onHelp)
            }
            ErrorLine(error)
        }
    }
}

/** Done / Next / Blocked. */
@Composable
private fun Fields(update: UpdateView) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (update.done.isNotEmpty()) Field("Done", update.done)
        if (update.next.isNotEmpty()) Field("Next", update.next)
        if (update.blockers.isNotEmpty()) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(Palette.dangerSoft)
                    .padding(10.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.WarningAmber, contentDescription = null, tint = Palette.danger, modifier = Modifier.size(14.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Blocked", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Palette.danger)
                }
                RichTextView(update.blockers)
            }
        }
    }
}

@Composable
private fun Field(
    label: String,
    text: String,
) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Palette.ink2)
        RichTextView(text)
    }
}

/** Who offered help on a blocker. */
@Composable
private fun Helpers(
    team: TeamModel,
    update: UpdateView,
) {
    for (h in update.helpers) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(h.account, h.name, 22.dp)
            Spacer(Modifier.width(8.dp))
            Text(team.name(h.account, h.name), fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            Text(if (h.note.isNotEmpty()) " — ${h.note}" else " can help", fontSize = 14.sp, color = Palette.ink2)
        }
    }
}

/** Post or edit your update: one sheet, three fields, carried forward from your last. */
@Composable
private fun UpdateSheet(
    board: BoardModel,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val editing = board.mine != null
    var draft by remember { mutableStateOf(board.draft) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val title =
        when {
            editing -> "Edit your update"
            board.isToday -> "Today's update"
            else -> "Update for ${board.dayTitle}"
        }
    StandupSheet(title, onDismiss) {
        board.carriedFrom?.let { Muted("Started from your ${board.describe(it).lowercase()} update") }
        LabeledField("Done", draft.done, { draft = draft.copy(done = it) }, "What got done since your last update", Limits.FIELD, minLines = 3)
        LabeledField("Next", draft.next, { draft = draft.copy(next = it) }, "What you are on next", Limits.FIELD, minLines = 2)
        LabeledField("Blockers", draft.blockers, { draft = draft.copy(blockers = it) }, "Anything in your way? Leave empty if not", Limits.FIELD)
        Text("Start a line with - for a list. Links and `code` just work.", fontSize = 13.sp, color = Palette.ink3)
        ErrorLine(error)
        PrimaryButton(
            if (busy) {
                "Posting…"
            } else if (editing) {
                "Save"
            } else {
                "Post"
            },
            busy = busy,
            enabled = !draft.isEmpty,
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                busy = true
                scope.launch {
                    try {
                        board.post(draft)
                        onDismiss()
                    } catch (e: Exception) {
                        error = ErrorText.describe(e)
                    } finally {
                        busy = false
                    }
                }
            },
        )
        LinkButton("Cancel", onClick = onDismiss, modifier = Modifier.fillMaxWidth())
    }
}

/** "I can help", with an optional note. */
@Composable
private fun HelpSheet(
    board: BoardModel,
    update: UpdateView,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var note by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    StandupSheet("Offer help", onDismiss) {
        RichTextView(update.blockers, color = Palette.danger)
        LabeledField(null, note, { note = it }, "How? (optional)", Limits.HELP)
        ErrorLine(error)
        PrimaryButton(if (busy) "Offering…" else "Offer help", busy = busy, icon = Icons.Outlined.PanTool, modifier = Modifier.fillMaxWidth(), onClick = {
            busy = true
            scope.launch {
                try {
                    board.offerHelp(update, note)
                    onDismiss()
                } catch (e: Exception) {
                    error = ErrorText.describe(e)
                } finally {
                    busy = false
                }
            }
        })
    }
}
